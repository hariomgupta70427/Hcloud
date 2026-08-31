# HCloud — Architecture V3

**Status:** architecture locked by owner decision, 2026-08-24. This document is the single source
of truth for HCloud's architecture.
**Measurements in §2 were taken live on 2026-08-24 and remain valid.**

Sections marked 🔒 are **irreversible once users hold data**. Do not change them without a
migration path.

---

## 1. Decision

**Primary backend is `account` mode: mtcute running in the browser, speaking MTProto directly to
Telegram. Zero hops for both reads and writes. Telegram is also the database.**

Onboarding is exactly one step: **the user scans a QR code inside Telegram.** Nothing else. No
BotFather, no user-supplied `api_id`, no manual channel creation. The app ships its own
`api_id`/`api_hash`, as every third-party Telegram client does. "Use your own `api_id`" exists
only as a hidden Settings escape hatch — never in onboarding.

`bot` mode (Bot API + 19 MiB chunks + Cloudflare Worker) is demoted to a **hard-capped demo**:
100 MB total, 5 files, 24 h TTL, in a **dedicated channel the operator owns** — never a personal
DM. It is kept because it is already validated end-to-end (§2.3) and because it is the only path
that can serve a visitor who has no Telegram session.

Both sit behind one `StorageBackend` interface (§5). **No code in Stage 0 or Stage 1 may assume a
single backend.**

Never market "unlimited storage" in the UI or the repo.

---

## 2. Verified findings (carried forward, still valid)

### 2.1 Production is down from one line-level bug

Four of five Vercel functions crash at module load; `OPTIONS` 500s too, proving the crash precedes
handler code.

| Endpoint | Status | Relative import? |
|---|---|---|
| `/api/telegram/stream` | 200 | **no** |
| `/api/telegram/session-token` | 500 `FUNCTION_INVOCATION_FAILED` | `../_lib/*` |
| `/api/telegram/managed-upload` | 500 | `../_lib/*` |
| `/api/telegram/send-code` | 500 | `../_lib/*` |
| `/api/telegram/verify-code` | 500 | `../_lib/*` |

Cause: `"type": "module"` in root `package.json` → functions load as ESM → ESM requires explicit
extensions on relative specifiers. Reproduced locally (`ERR_MODULE_NOT_FOUND`, fixed by adding
`.js`). Contributing cause: **`api/` is covered by no tsconfig** (`tsconfig.json` has
`"files": []`; `tsconfig.app.json` is `"include": ["src"]`), so these files were never type-checked.

This supersedes the earlier note blaming gramjs-on-Vercel: `managed-upload.ts` and
`session-token.ts` import no gramjs and crash identically.

### 2.2 Bot API measured limits (governs `bot` mode only)

| Test | Result |
|---|---|
| `getFile` at 19 MiB / 20 MiB (20 971 520 B) | works |
| `getFile` at 25 MiB | `400 "file is too big"` |
| `Range: bytes=1000-1999` on `/file/bot…` | **`206`** + correct `Content-Range` |
| CORS on file endpoint, 200 response | **absent** (the `*` on 404s is a trap) |
| `OPTIONS` preflight to `api.telegram.org` | `405` |
| CORS on `sendDocument` / `getFile` / `getMe` | **`Access-Control-Allow-Origin: *`** |
| 12 × 2 MiB `sendDocument`, 4-way parallel | 12/12 OK, no 429, no `retry_after` |

Consequence: a browser can **write** to Telegram over Bot API but never **read** (no CORS, and
`Range` is not CORS-safelisted so it would need a preflight, which 405s).

### 2.3 `bot` mode validated end-to-end

45 MB → three 19 MiB chunks → reassembled with 6 ranged GETs:

```
original: 47185920 bytes  sha256=0294b2143b24739f...
rebuilt : 47185920 bytes  sha256=0294b2143b24739f...
RESULT: BYTE-EXACT via 6 ranged requests across 3 Telegram messages
```

### 2.4 Cloudflare Workers free tier

100 k req/day · **no egress cap or charge** · never sleeps · 100 MB request body (Vercel is
~4.5 MB) · unlimited streaming duration · 50 subrequests/invocation · 10 ms CPU (irrelevant — piping
a body is I/O) · Cache API objects to 512 MB.

### 2.5 Infrastructure reality

- The **Render relay is still alive** (`/health` 200 in 0.26 s). Oracle was never provisioned;
  `deploy/oracle/` is unused scaffolding. The CSP naming `hcloud.onrender.com` is therefore
  currently **correct** — do not change it until the replacement is live.
- Managed mode currently writes to the **operator's personal DM** (`"type":"private"`). Fixed by
  the dedicated-channel requirement above.
- `/api/telegram/{delete,download,list,share}` return 200 only because the SPA rewrite serves
  `index.html` for unknown `/api` paths. They are not endpoints.

---

## 3. Risks that must be retired early

### R1 — WSS reachability — ✅ RETIRED 2026-08-24

Account mode depends entirely on `wss://*.web.telegram.org/apiws`. The prior project note claimed
this endpoint **timed out** on the owner's ISP, which would have made account mode impossible.

**Measured — that note is stale. All five DCs connect, from every origin:**

```
OK   DC1 pluto   OPEN       1285ms  handshake ok
OK   DC2 venus   OPEN        820ms  handshake ok
OK   DC3 aurora  OPEN       2186ms  handshake ok
OK   DC4 vesta   OPEN        843ms  handshake ok
OK   DC5 flora   OPEN       1087ms  handshake ok
5/5 DC endpoints reachable over WSS

Origin check against venus:
OK   telegram own origin  OPEN   787ms
OK   HCloud production    OPEN   698ms   <- https://hcloud-pi.vercel.app
OK   localhost dev        OPEN   694ms
OK   no Origin header     OPEN   703ms
```

Telegram's WSS endpoint accepts **any** `Origin`, so it works from the production domain and from
localhost. The earlier failure was either raw TCP MTProto (a different transport) or a transient
ISP condition.

Residual risk, not yet retired: this was measured from Node. A browser adds no CORS restriction to
the WebSocket handshake itself, but it does enforce the CSP `connect-src` allowlist (see R2), and
the DC's response to a **real MTProto handshake** over that socket is still unverified — only TCP
+ WS upgrade is proven. Confirm the full auth-key exchange in Task 2.0.

### R2 — CSP needs `wasm-unsafe-eval`

mtcute's crypto is WebAssembly. The current policy is `script-src 'self' …`. It needs
`'wasm-unsafe-eval'` added — narrow, and **not** the blanket `unsafe-eval` that made the gramjs
browser attempt untenable. `connect-src` must also gain `wss://*.web.telegram.org`.

### R3 — Session-revocation reasoning corrected

Telegram does not revoke a session for changing IP (mobile clients roam constantly). The real
hazard is **one `auth_key` used concurrently by two clients** — `msg_id`/`seq` races and
`AUTH_KEY_DUPLICATED`. Per-device QR login plus one SharedWorker-owned client (§6) already
prevents this, so the design is correct; only the stated reason changes. Do not build logic that
expects Telegram to revoke on IP change.

### R4 — Public share links conflict with "session never leaves the device" 🔴

A public visitor has no MTProto session, so someone must serve the bytes. But the operator's bot
**cannot read account-mode parts**: `getFile` caps at 20 MiB (§2.2) and parts are 1 GiB (§4).
So there is no path from an account-mode file to an anonymous visitor without either
(a) the session leaving the device — forbidden by this spec, or
(b) re-uploading the content into a bot-readable channel as 19 MiB chunks.

**Recommendation:** public share links are a **`bot`-mode capability only**. Sharing an
account-mode file performs an explicit, progress-visible **re-upload into the operator's shared
channel in 19 MiB chunks**, gated by a size cap, and the resulting link is served by the Worker.
Present it in the UI as "publish a public copy", because that is what it is. Do not silently
promise share links for multi-GB account-mode files.

### R5 — `api_id` flagging

Register 2–3 `api_id`s. The app reads which to use from a **remote JSON config the operator
controls**, so a single flagged `api_id` is a config change, not an outage. Add a client-side
per-user rate guard so one user cannot burn the shared `api_id`'s reputation.

### R6 — Firestore's justification (required by the decision)

Firebase Auth is **removed**; Telegram login is the identity. That leaves Firestore with one
candidate job: public-share metadata. But per R4 public shares are bot-mode only, and the Worker
already needs a capability token — which is self-contained and needs no database.

**Decision: delete Firestore.** Share metadata lives in the operator's own share channel (bot
mode can read it) or inside the capability token itself. Keeping a second source of truth next to
"Telegram is the database" is exactly the split-brain this rewrite exists to remove. Revisit only
if a concrete need appears that a token cannot satisfy.

### R7 — iOS Safari

Service-Worker-served ranged media is unreliable on iOS Safari (it bypasses the SW for media
element requests in several versions). **Document the limitation and ship an explicit fallback**:
direct download, or a size-capped in-memory blob for short files. Do not let it silently appear as
"video won't play".

### R8 — Leaked bot token in git history — ACCEPTED RISK, mitigated by rotation

**What happened.** The operator's Telegram bot token was hardcoded as a fallback in
`src/services/telegramService.ts`:

```
const TELEGRAM_BOT_TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '<token>';
```

Committed in **b8c9ad4 (2026-02-01)**, still present in **332ed31 (2026-02-04)**. Both are
ancestors of `main` on a public repository, so the token was public for roughly 6.5 months. Both
the `VITE_`-prefixed variable *and* the hardcoded fallback placed it in the deployed JavaScript,
readable by every visitor. `TELEGRAM_CHAT_ID` leaked in the same file. `TELEGRAM_API_HASH` never
did. Verified by scanning all 523 blobs across all refs; HEAD is clean.

An earlier attempt to fix this added `src/services/telegramService.ts` to `.gitignore`. That did
nothing — the file was already tracked, and `.gitignore` has no effect on a tracked file. The
entry only created false confidence. It has been removed.

**THE LEAK WAS EXPLOITED — confirmed 2026-08-27.** This is no longer theoretical.
A tamper check (`getMyDescription` / `getMyShortDescription`) found the bot's public
profile rewritten into VPN referral spam:

```
description (340 chars):
  Не работают любимые сайты? Попробуйте EmNetwork - 3 дня бесплатно и скидка 30% ...
  https://t.me/EmNetworkBot?start=nurmanbeknesterov   (x4)
short_description (80 chars):
  EmNetwork не страшны никакие интернет-блокировки - проверьте сами: @EmNetworkBot
```

Only a token holder can call `setMyDescription`. Scope of the compromise:

- **Profile-only monetisation.** `getMyName` was intact (`Hcloud`) and `getMyCommands`
  empty, so no attempt to impersonate the service or add commands.
- **No webhook was ever set**, so the attacker was not reading updates or harvesting
  messages. This is why the earlier "no sign of misuse" check came back clean — it
  looked at webhooks and pending updates, which this attack does not need.
- **Rotation removed access but did not undo the edit.** Both fields were cleared
  manually on 2026-08-27 and verified empty.

Lesson recorded: after any credential leak, audit **mutable state the credential
could have changed**, not just whether access still works.

**Decision (owner, 2026-08-24): the token is rotated in @BotFather; history is NOT rewritten.**

Rationale:
- Once the token is revoked the leaked string is worthless.
- `git filter-repo` rewrites every SHA in the repository.
- GitHub keeps unreachable objects addressable regardless, so the leaked blob stays retrievable
  even after a force-push.

Net: the security benefit is approximately zero and the cost is real. Revisit only as optional
hygiene, never as a security control. Rotation keeps the same bot id, so existing `file_id`s and
channel access survive.

**Standing controls that replace the bad fix:**
1. No secret may carry a `VITE_` prefix — anything `VITE_` is inlined into the bundle by Vite and
   is public by definition.
2. `npm run check:secrets` (`scripts/check-bundle-secrets.mjs`) runs as part of `npm run build`
   and fails it if a secret value, a secret-shaped literal, or a `VITE_`-named secret is present.
3. Never use `.gitignore` to hide a leak. Rotate the credential and say so.

**Verified current exposure — none.** Searched both local `dist/` and the live deployed bundle for
the real values, not just patterns:

| Secret | local `dist/` | live bundle |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | clean | clean |
| `TELEGRAM_API_HASH` / `API_ID` / `CHAT_ID` | clean | clean |
| `FIREBASE_API_KEY` | present (expected) | present (expected) |

Firebase web config is a set of public identifiers, not credentials; security comes from Firestore
rules. It is explicitly allowlisted in the scanner. `vite.config.ts` needs no change — its
`define` block injects only the six `FIREBASE_*` values and deliberately excludes all Telegram
credentials.

Guard verified in both directions:

```
clean dist/ ................................... exit 0
real bot token planted in dist/ ............... exit 1  (caught by value AND pattern)
PEM private key planted ....................... exit 1
VITE_TELEGRAM_BOT_TOKEN present in env ........ exit 1  (even with a clean bundle)
VITE_STREAM_TOKEN_SECRET / VITE_TELEGRAM_API_HASH /
  VITE_ADMIN_PASSWORD / VITE_PRIVATE_KEY ...... exit 1
VITE_UPLOAD_SERVER_URL / VITE_API_BASE_URL /
  VITE_APP_TITLE (benign) ..................... exit 0
```

---

## 4. 🔒 File layout — LOCKED

### 4.1 Parts

- Every file is an **ordered sequence of parts**. Uniform for all file sizes, including a 1-part file.
- `PART_SIZE = 1 GiB = 1 073 741 824 B`. Every part except the last is exactly `PART_SIZE`.
- Each part is one Telegram document in the user's storage channel.
- 1 GiB with 512 KiB upload parts = exactly **2048** `upload.saveBigFilePart` calls, comfortably
  under Telegram's per-file part ceiling, and safely under the 2 GB non-premium document limit.

### 4.2 No in-band header 🔒

**Part payloads contain nothing but file bytes (or ciphertext).** No envelope header is prepended.

This is deliberate and load-bearing: any in-band header would shift the payload and break the
`upload.getFile` alignment rules (§7.3), destroying seekability. All envelope metadata —
`schemaVersion`, encryption parameters, hashes — lives in the **index record** (§5.2), which is
where versioning belongs. The "versioned envelope" requirement is satisfied by
`schemaVersion` on every index record and every part descriptor.

### 4.3 Encryption, aligned to the read chunk 🔒

Designed now so encrypted files can be added later **without changing the layout**.

- `CIPHER_BLOCK = 1 MiB = 1 048 576 B`, identical to the streaming read chunk.
- **AES-256-CTR**, counter derived from the absolute plaintext block index, nonce per file.
- CTR is chosen because **ciphertext length == plaintext length**. Byte offsets are therefore
  preserved exactly, so 4096-alignment and the 1 MiB boundary rule keep holding, and an encrypted
  file streams and seeks identically to a plaintext one. This is the property that a length-
  expanding mode (GCM with inline tags) would destroy.
- **Integrity tags are stored out-of-band** in the index record, never inline, for the same reason.
- Encrypted or not, the parts are byte-addressable the same way. `encryption: null` is the
  plaintext case.

### 4.4 Hashing and dedupe 🔒

- SHA-256 per 1 MiB plaintext block; the file's content hash is the **Merkle root** of the block
  hashes.
- Chosen because WebCrypto cannot hash incrementally — per-block hashing is streaming-friendly,
  gives block-level integrity for free, reuses the cipher-block boundary, and yields a stable
  file identity for dedupe.
- On upload, look up the root hash in the index; if present, write a new index record pointing at
  the **existing parts** instead of re-uploading.

---

## 5. 🔒 Telegram as the database

### 5.1 Structure

Per user, inside their own storage channel:

- **Oplog** — append-only. Each mutation is one Telegram message. Small ops go as message text;
  anything larger goes as a tiny document.
- **Snapshot** — a periodically written compacted document containing the whole index.
- **Pointer** — the channel's **pinned message is the latest snapshot**.

Recovery / cold start: read the pinned snapshot → read every message after the snapshot's
`message_id` → apply ops in order. Cross-device sync arrives through MTProto updates; the client
mirrors everything into IndexedDB.

Compaction: write a new snapshot, pin it, then oplog messages older than it may be deleted.

### 5.2 Records

Every record carries `v` (`schemaVersion`) from day one.

```jsonc
// Index record — a file
{
  "v": 1,
  "kind": "file",
  "id": "<uuid>",
  "name": "movie.mkv",
  "parentId": null,              // string | null. NEVER "". Root is null.
  "size": 5368709120,
  "mime": "video/x-matroska",
  "hash": "<merkle-root-sha256>",
  "createdAt": 0, "updatedAt": 0,
  "trashed": false,
  "encryption": null,            // or { alg:"AES-256-CTR", blockSize:1048576, nonce:"<b64>", tags:"<ref>" }
  "parts": [
    { "i": 0, "size": 1073741824, "chatId": "-100…", "messageId": 123,
      "fileId": "…", "fileRef": "<b64>", "dcId": 2 }
  ]
}

// Index record — a folder
{ "v":1, "kind":"folder", "id":"<uuid>", "name":"Movies", "parentId":null,
  "createdAt":0, "updatedAt":0, "trashed":false }

// Oplog op
{ "v":1, "op":"put"|"ren"|"mv"|"trash"|"restore"|"del", "ts":0, "id":"<uuid>", /* ...delta */ }
```

`chatId` + `messageId` are the **durable key**. `fileRef` expires and is refreshed via
`messages.getMessages` (§7.4) — never treat it as stable.

### 5.3 Backend interface

```ts
interface StorageBackend {
  readonly kind: 'account' | 'bot';
  readonly capabilities: { maxFileSize: number; publicShare: boolean; resumable: boolean };
  upload(file: File, opts: UploadOpts): Promise<IndexRecord>;
  readRange(rec: IndexRecord, start: number, end: number, signal: AbortSignal): ReadableStream<Uint8Array>;
  delete(rec: IndexRecord, mode: 'soft' | 'hard'): Promise<void>;
}
```

---

## 6. 🔒 Concurrency

- **One SharedWorker owns the single MTProto client.** Every tab talks to it over `MessagePort`.
  Never one client per tab — that is the `AUTH_KEY_DUPLICATED` path (R3).
- Fallback where SharedWorker is unavailable (notably some iOS versions): elect a leader tab via
  `navigator.locks` or a BroadcastChannel lease, and proxy through it.
- **Uploads:** 512 KiB parts via `upload.saveBigFilePart`, 4 parallel senders, adaptive
  concurrency, resumable — persist `file_id` plus an **uploaded-part bitmap** in IndexedDB so a
  refresh resumes instead of restarting.
- Session stored in IndexedDB, **encrypted with a WebCrypto key derived from a user PIN**.

---

## 7. Streaming and MTProto correctness

Each item below requires a test; see §10.

### 7.1 Service Worker
Serves `206 Partial Content` from MTProto chunks (the Telegram Web K model). Read-ahead 2–4
chunks, LRU memory cache, **abort in-flight requests on seek**, correct
`Content-Range` / `Accept-Ranges` / `Content-Length`, real `HEAD` handling, and reads that
**cross part boundaries** transparently.

### 7.2 Player
Native `<video>`/`<audio>` plus a **remux hook** — mp4box.js or ffmpeg.wasm rewrap — for MKV/AVI
containers the browser cannot demux. Gate on `canPlayType()` and remux rather than presenting a
player that cannot work.

### 7.3 🔒 `upload.getFile` alignment
- `offset % 4096 == 0`
- `limit` divides 1 MiB, and `1 MiB % limit == 0`
- a single request must **never cross a 1 MiB boundary**:
  `floor(offset / 1MiB) == floor((offset + limit - 1) / 1MiB)`

Requested byte ranges are widened to satisfy these, then trimmed on output.

### 7.4 Error handling
- `FLOOD_WAIT_x` → honour `x` with jitter; surface as backpressure, never as a failure.
- `FILE_REFERENCE_EXPIRED` → re-fetch via `messages.getMessages(chatId, messageId)`, refresh
  `fileRef`, retry once. This is why §5.2 stores peer + `message_id`.
- DC migration (`FILE_MIGRATE_X` / `PHONE_MIGRATE_X`) → transparent redirect.

---

## 8. 🔒 Data safety at the model level

- `parentId` is `string | null`, **never `''`**. Root queries use `null`. Add a runtime assertion
  on write.
- **All destructive operations route through one function** with confirmation and an undo window.
  No page implements its own delete.
- **Soft delete** = `trashed: true` in the index; the Telegram message is kept.
  **Hard delete** = the Telegram message is deleted. Only the single destructive function may do it.

---

## 9. Monorepo

Extract **`@hcloud/core`** now — protocol, chunker, index/oplog, crypto, backend interface — so
web, Tauri desktop and Android reuse one implementation. Do this before account mode grows, not after.

---

## 10. Order of work

### Stage 0 — Unbreak production (existing bot path) — ✅ CODE COMPLETE, AWAITING DEPLOY

1. ✅ Added explicit `.js` extensions to `../_lib/*` imports in the four crashing functions.
2. ✅ Added `api/tsconfig.json` (`module`/`moduleResolution: NodeNext`), referenced from
   `tsconfig.json`, **and wired into the build**: `"build": "npm run typecheck:api && vite build"`.
   The reference alone was not enough — `vite build` never type-checks `api/`, so without the
   script change the guard would not run in CI.
3. ✅ `parentId` fixed at the model level, per §8 — not just at the call site.
4. ✅ `Header` wired to `uiStore` (restores global search **and** list view).
5. ✅ Deleted the stray JSX text node in `UploadModal.tsx:40`.

Also fixed while in the file: the unguarded module-scope `JSON.parse(localStorage…)` in
`uiStore.ts`, which runs before React mounts and white-screened the app on a corrupt entry.

**Local proof captured:**

```
# The guard actually catches the regression (bug reintroduced deliberately):
api/telegram/session-token.ts(3,29): error TS2835: Relative import paths need
explicit file extensions in ECMAScript imports when '--moduleResolution' is
'node16' or 'nodenext'. Did you mean '../_lib/firebaseAuth.js'?

# All five functions compiled to ESM and loaded under Node, exactly as Vercel does:
  managed-upload.js      LOADED  default=function
  send-code.js           LOADED  default=function
  session-token.js       LOADED  default=function
  stream.js              LOADED  default=function
  verify-code.js         LOADED  default=function

# Suite + typecheck + build:
Test Files  2 passed (2)   Tests  8 passed (8)
api typecheck OK
vite build ✓ built in 25.72s
```

The two gramjs-importing functions (`send-code`, `verify-code`) load fine, which **confirms
gramjs was never the cause of the outage**.

`parentId` regression tests live in `src/test/parentId.test.ts`; the normalizer is in
`src/lib/parentId.ts`, kept free of Firebase imports so it is testable (importing `fileService`
initialises Firebase Auth at module scope and throws without credentials).

**Recovery bonus:** `getFilesInFolder` now queries root for both `null` and `''` and merges, so
files already lost to the old move-to-root bug reappear and are repaired on next write.

**Deploy proof — CAPTURED 2026-08-25, production `https://hcloud-pi.vercel.app`.**
Stage 0 is on `main` and deployed. All five endpoints answer `OPTIONS` with 200, and the four
authenticated ones now return **401 instead of `500 FUNCTION_INVOCATION_FAILED`** on an
unauthenticated POST:

```
ENDPOINT               OPTIONS  POST-noauth VERDICT
stream                 200      405      OK      <- 405 is correct; GET/HEAD/OPTIONS only
session-token          200      401      OK
managed-upload         200      401      OK
send-code              200      401      OK
verify-code            200      401      OK
```

This closes the Stage 0 gate. Before the fix, every one of the four returned a hard 500 at module
load, including on `OPTIONS`.

**Range stream against production — CAPTURED 2026-08-27.** 512 KiB file, `&name=` passed
so the MIME and filename are correct:

```
$ curl -i -H 'Range: bytes=1000-1999'     'https://hcloud-pi.vercel.app/api/telegram/stream?fileId=<id>&name=probe.bin'
HTTP/1.1 206 Partial Content
Accept-Ranges: bytes
Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges
Cache-Control: private, max-age=3600
Content-Disposition: inline; filename*=UTF-8''probe.bin
Content-Length: 1000
Content-Range: bytes 1000-1999/524288
Content-Type: application/octet-stream
bytes received: 1000

# full GET for comparison
HTTP/1.1 200 OK
Accept-Ranges: bytes
Content-Length: 524288
```

Correct `Content-Range` against a true total of 524288, exactly 1000 bytes delivered, and
`Accept-Ranges` present — which is what makes a `<video>` scrub bar work.

**Managed upload against production — BLOCKED, not by the token.** The rotated token is
live and verified (`getMe` ok, bot id unchanged, webhook empty, 0 pending). The blocker is
that `TELEGRAM_CHAT_ID` is set to the bot's own id, so every upload returns
`403 Forbidden: the bot can't send messages to the bot`. See §14.

### Stage 1 — Data-loss and security (existing bot path) — IN PROGRESS

**Scope trimmed by owner decision, 2026-08-25.** The original scope rewrote
Firestore-backed code that Stage 2.7 deletes outright. With zero users the data-loss
bugs have nothing to damage yet, so paying for that rewrite twice was not worth it.

**DEFERRED to Stage 2: the per-page state-slice refactor of `fileStore.files`.**
Six pages share one array and their effects run after first paint, so navigating
Files -> Trash briefly renders live files in the Trash table with "Delete
Permanently" wired up (S1). The fix is per-page slices — but Stage 2.6 rewrites this
UI anyway, so doing it now means writing it twice. Deferred deliberately, not
forgotten. Until then the destructive funnel is the mitigation: a purge is deferred
behind an undo window rather than applied on click.

**Gate artifact substituted, owner decision.** The original gate was a before/after
403 pair. Capturing the "before" would mean re-deploying the old permissive rules to
production to photograph a `200` with a live `streamToken` — deliberately
reintroducing the vulnerability. Replaced with two stronger artifacts:

- **(a)** an unauthenticated REST read of a **real shared document** returning 403
  under the new rules, and
- **(b)** a field dump of that same document showing **no `streamToken` and no
  password verifier exist at all**.

(b) is the stronger claim: (a) proves the rules deny access today, while (b) proves
there is nothing to leak even if a future rules change regresses.

#### Done

- **Anonymous reads denied.** The `allow get: if resource.data.isShared == true`
  branch is gone. It could not be made safe — rules authorise whole documents and
  cannot restrict which fields return, so every link-holder received
  `shareSettings.streamToken` and the password verifier.
- **Sharing reworked so that is possible.** Links carry an opaque AES-256-GCM
  capability in the URL **fragment** (never sent to a server, so it stays out of
  access logs and `Referer`). `share-create` mints it for an authenticated owner;
  `share-resolve` enforces the password **server-side** and returns nothing
  streamable until it passes. Firestore stores no token and no verifier.
  `SharedFilePage` now imports no Firebase at all.
- **Destructive-op funnel** (`src/lib/destructiveOps.ts`) with a real undo window.
  Soft delete keeps the Telegram message; hard delete is **deferred** until the
  window elapses, so undo cancels it outright rather than trying to reverse it.
- **`emptyTrash` batch bug** fixed — it reused a `WriteBatch` after `commit()`,
  which Firestore rejects, so emptying >400 items always half-failed.
- **`firebase.json`, `firestore.rules`, `firestore.indexes.json` now tracked.**
  They were gitignored: rules changes were unreviewable and a fresh clone could not
  run `firebase deploy --only firestore:rules` at all.

Tests: 34 passing (7 parentId, 13 share capability, 13 destructive funnel, 1 example).

#### Blocked

Nothing. Artifacts captured 2026-08-27 — see below.

#### Gate artifacts — CAPTURED 2026-08-27

Rules deployed to `hcloud-6e7eb`:

```
+  cloud.firestore: rules file firestore.rules compiled successfully
+  firestore: released rules firestore.rules to cloud.firestore
+  Deploy complete!
```

**Artifact (a) — unauthenticated read of a REAL shared document is denied.**

A genuine document with `isShared == true` was created by an authenticated owner,
then read with no `Authorization` header:

```
$ curl -s -i ".../projects/hcloud-6e7eb/databases/(default)/documents/files/idhxMF9xR9KKYjY0Xm6d"
HTTP/1.1 403 Forbidden
{
  "error": {
    "code": 403,
    "message": "Missing or insufficient permissions.",
    "status": "PERMISSION_DENIED"
  }
}
```

This is the artifact that matters. A 403 on a *nonexistent* id proves nothing —
it fails the old `isShared` condition too. This document **was** shared and is
still denied.

**Artifact (b) — the same document contains no secret to leak.** Read back as its
owner:

```
  name       = gate-artifact-probe.mp4
  isShared   = True
  shareSettings keys:
    expiresAt            nullValue      None
    password             nullValue      None
    passwordSalt         nullValue      None
    passwordVerifier     nullValue      None
    requiresPassword     booleanValue   True
    streamToken          nullValue      None
    tokenExpiresAt       nullValue      None

  SECRET-BEARING FIELDS WITH A VALUE: NONE
```

**Artifact (b) part 2 — static proof, covering every document rather than one.**
Every occurrence of the three secret-bearing field names in the codebase is a type
declaration, a comment, or an explicit `null` write:

```
$ grep -rn 'streamToken|passwordVerifier|passwordSalt' src/ api/
src/services/fileService.ts:41,43,46   type declaration (marked LEGACY, READ-ONLY)
src/services/fileService.ts:527,528,529  passwordSalt: null / passwordVerifier: null / streamToken: null
...remaining matches are comments and one test docstring

$ grep -rn 'crypto.subtle|PBKDF2' src/
  no client-side password crypto remains

$ grep -rn 'firebase|firestore' src/pages/public/SharedFilePage.tsx
  none — the public page has no Firebase import at all
```

So even if a future rules change regressed, there is nothing in these documents to
hand out. That is why (b) is the stronger half of the pair.

Probe cleanup: document deleted (`http=200`) and the throwaway account deleted
(`http=200`). The follow-up owner read returns 403 rather than 404 because the
rules evaluate `resource.data` on a missing document — expected, not a failed
delete.

#### Sharing verified end to end on production — 2026-08-27

Rules and code are back in sync. Full round trip against
`https://hcloud-pi.vercel.app`, password-protected share:

```
1. share-create (authenticated)
     requiresPassword=True  blob len=494  expiresAt=2026-09-07T05:23:55Z

2. share-resolve, NO password                        -> 401
     {"name":"share.bin","size":131072,"requiresPassword":true,
      "error":"This file is password protected"}          <- no streamUrl

3. share-resolve, WRONG password                     -> 401
     {"...","error":"Incorrect password"}                 <- no streamUrl

4. share-resolve, CORRECT password                   -> 200
     {"...","streamUrl":"/api/telegram/stream?fileId=…&name=share.bin",
      "downloadUrl":"…&download=1"}

5. GET the returned streamUrl with Range: bytes=0-99  -> 206
     Content-Range: bytes 0-99/131072
     Content-Length: 100        (100 bytes received)

6. tampered blob                                     -> 404
```

Steps 2 and 3 are the security property: display metadata is returned, but nothing
streamable, and the password is checked server-side. Step 6 confirms GCM rejects a
tampered capability rather than degrading.

**Residual weakness, not fixed in Stage 1 (was S4).** The `streamUrl` handed back in
step 4 is `?fileId=<telegram handle>` with **no auth of its own**, so it is itself a
bearer capability: anyone who obtains that URL can stream without the password, and it
does not expire. The password gate is real, but what it protects is a long-lived
handle rather than a short-lived token.

Not a regression — this is pre-existing behaviour of `/api/telegram/stream`. It is
strictly better than before (the handle used to be readable from Firestore without any
password at all). Proper fix: have `share-resolve` mint a short-TTL stream token and
have the stream endpoint require it, so `?fileId=` stops being accepted from the
public path. Scheduled with the `bot`-mode demo hardening.

#### Follow-ups found during Stage 1 — not fixed here

- **Hard delete reclaims no Telegram storage — CORRECTNESS DEFECT, promoted to
  Stage 2's definition of done. See §16.**
- **Old share links break.** They are `/s/:id` with no fragment, and share documents
  are no longer publicly readable, so they now show "missing its access key. Ask the
  owner to re-share". Acceptable at zero users; noted so it is not rediscovered as a
  bug.
- **Account-mode public links** are refused at mint time with copy pointing at
  Telegram (R4). The Telegram forwarding path itself is Stage 2 work.

### Stage 2 — Account mode
**Task 2.0:** WSS transport is already proven reachable from all five DCs and from the production
origin (R1). What remains is the **full MTProto auth-key exchange over that socket, in a real
browser, under the production CSP** — do that spike before anything else is built.
Then: `@hcloud/core` extraction → SharedWorker client → QR login (`auth.exportLoginToken`) with
phone+code and SRP fallback → auto-create the "HCloud Storage" channel → oplog/snapshot index →
resumable chunked upload → Service Worker streaming → remux hook.

### Stage 3 — Product polish
Virtualized 10 k-file lists, folder upload, drag-to-move, multi-select, URL-addressable folders,
the a11y pass, route-level code splitting, dependency pruning, dead-code removal.

### Stage 4 — Desktop and Android
Tauri desktop with a watched folder; Android; sync via the same oplog. Only after Stage 3.

---

## 11. Proof required per stage — no exceptions

A stage is not complete without these artifacts committed:

- [ ] curl / HTTP transcripts for every endpoint touched
- [ ] **SHA-256 match on a >2 GB multi-part file**, round-tripped
- [ ] resume-after-refresh recording
- [ ] 500-file folder upload
- [ ] 10 000-file list sustaining 60 fps
- [ ] seek-storm test (rapid seeks; verify aborts and no leaked requests)
- [ ] `FILE_REFERENCE_EXPIRED` simulation with successful recovery

---

## 12. Removed by this decision

`api/telegram/send-code.ts`, `api/telegram/verify-code.ts`, `api/telegram/session-token.ts`,
`upload-server/` (the entire relay), `deploy/oracle/`, gramjs from every runtime, Firebase Auth,
Firestore (§R6), the Render dependency, and the `crypto-browserify` / `stream-browserify` /
`vm-browserify` polyfills.

**Sequencing:** these are deleted at the **end of Stage 2**, once account mode is proven — not
during Stage 0 or 1, which still run on the bot path.

---

## 13. Defect inventory (carried forward)

### Data-loss and security
| # | Defect | Where |
|---|---|---|
| S1 | Trash can hard-delete a live file — six pages share `fileStore.files`; effects run after paint | `fileStore.ts:59-112`, `TrashPage.tsx:99-112` |
| S2 | Move-to-root loses files — `folderId \|\| ''` writes `parentId: ''`; root queries `== null` | `FilesPage.tsx:623`, `fileService.ts:350` |
| S3 | Share passwords are cosmetic — anonymous `get` returns `shareSettings.streamToken` | `firestore.rules:30`, `SharedFilePage.tsx:188-222` |
| S4 | `?fileId=` stream has no auth — any `file_id` streams any managed file | `api/telegram/stream.ts` |
| S5 | `session-token` never binds session→uid | `session-token.ts:112-122` |
| S6 | Telegram client cache keyed on `session.substring(0,50)` — prefix collision leaks another user's client | `upload-server/server.ts:390` |
| S7 | No token revocation — `unshareFile` nulls the doc, minted tokens live up to 7 days | `fileService.ts` |
| S8 | `emptyTrash` reuses a committed `WriteBatch` — throws above 400 items | `fileService.ts:628-643` |

### Tier 1 — visibly broken
| # | Defect | Where |
|---|---|---|
| B1 | Global search does nothing — bound to local `useState`, pipeline reads `uiStore` | `Header.tsx:25,84-85` |
| B2 | Grid/list toggle does nothing — list view unreachable; `setViewMode` has zero callers | `Header.tsx:26` |
| B3 | Stray comment renders as visible text over the upload backdrop | `UploadModal.tsx:40` |
| B4 | Drag-and-drop always uploads to root — `useCallback(…, [])` freezes `currentFolder = null` | `FilesPage.tsx:72-79` |
| B5 | Long videos die at 10:00 — `DEFAULT_TTL = 600`, same URL reused for later ranges | `chunkedUploadService.ts:92` |
| B6 | Backend race on cold start → uploads take the wrong path, files refuse to open after refresh | `authStore.ts:186-187`, `useUpload.ts:56` |
| B7 | mkv/avi/wmv/flv always error — correct-but-undecodable MIME, no `canPlayType()` gate | `fileTypes.ts:28-38` |
| B8 | Managed streams send `application/octet-stream` — `guessMime` reads Telegram's extensionless path | `stream.ts:71` |
| B9 | Folders don't open on 4 of 5 pages — `onOpenFolder` only supplied by FilesPage | `useFileActions.ts:40-43` |
| B10 | Rename/Move are dead menu items outside FilesPage | `StarredPage.tsx:66-75` et al. |
| B11 | Share-page overlay permanently covers the video — no `pointer-events-none` | `SharedFilePage.tsx:363-371` |
| B12 | Public share "Download" streams instead of saving — missing `&download=1` | `SharedFilePage.tsx:162` |
| B13 | Empty text file → blank modal, no close button (`''` is falsy) | `PreviewModal.tsx:147` |
| B14 | Clicking a .zip/.exe buffers the whole file into memory | `useFileActions.ts:113-124` |
| B15 | Create-share fails silently — `try/finally`, no `catch`, and `shareFile` throws | `ShareDialog.tsx:39-53` |
| B16 | Bulk delete always claims success | `FilesPage.tsx:549-557` |
| B17 | Two theme systems; Settings choice discarded on reload; unguarded module-level `JSON.parse` | `ThemeProvider.tsx` vs `uiStore.ts:29-41,63-74` |
| B18 | Spacebar plays but never pauses — stale `togglePlay` closure | `VideoPreview.tsx:87-101` |
| B19 | Preview download saves a file named `stream`, no extension | `useFileActions.ts:204-217` |
| B20 | Can't re-select the same file after failure — input `value` never reset, no retry | `UploadZone.tsx:35-40` |

### Performance and a11y
No pagination or `limit()` anywhere — every list fetches the user's whole collection.
`getStorageStats()` re-runs on every `files.length` change. `searchFiles()` refetches everything
per keystroke. Base64 thumbnails stored inside documents (3–40 KB per row). No virtualization.
~1.4 MB uncompressed JS, zero route splitting. `displayFiles.sort()` mutates Zustand state during
render. React Query mounted with zero `useQuery` calls.
`maximum-scale=1.0, user-scalable=no` plus global `touch-action: manipulation` disable pinch-zoom
(WCAG 1.4.4). Three `aria-label`s outside `components/ui/`; zero `role="dialog"`, focus traps or
focus restoration across seven hand-rolled modals. Scrub bars are `<div onClick>`. Mobile
selection bar sits under the bottom nav.

---

## 14. Environment variables — what reaches the client, and why

**Two mechanisms put a value into the client bundle, and only one is obvious:**

1. A `VITE_` prefix — Vite inlines these automatically.
2. `vite.config.ts` `define` — inlines **any** name, prefix or not. This is how the
   unprefixed `FIREBASE_*` values reach `dist/`, and it is the same mechanism that
   previously carried the bot token.

**So a missing `VITE_` prefix is NOT evidence that something is server-only.** Check
the `define` block too.

### Allowed in the client — public identifiers, not credentials

| Variable | Why it is safe |
|---|---|
| `FIREBASE_API_KEY` | Firebase web config is public by design; security comes from Firestore rules |
| `FIREBASE_AUTH_DOMAIN` | same |
| `FIREBASE_PROJECT_ID` | same |
| `FIREBASE_STORAGE_BUCKET` | same |
| `FIREBASE_MESSAGING_SENDER_ID` | same |
| `FIREBASE_APP_ID` | same |
| `VITE_UPLOAD_SERVER_URL` | a hostname the browser must connect to |
| `VITE_API_BASE_URL` | a path prefix |

### Never in the client

`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `STREAM_TOKEN_SECRET`, `ADMIN_SECRET`.
Read only by `api/` functions. A hit is a live incident — see R8 for what happened
the one time it was true.

### Expected to become client-visible in Stage 2 — NOT a leak

`TELEGRAM_API_ID` and `TELEGRAM_API_HASH`.

Browser MTProto cannot work without them, and every third-party Telegram client ships
its own — Telegram Web included. They are **app** identifiers, not user credentials:
they grant access to no account. The mitigation is 2–3 registered `api_id`s selected
by remote config (R5), not secrecy.

**Do not "fix" this later by removing them.** Doing so breaks account mode. The
bundle guard reports them as a note and passes.

### Enforcement

`scripts/check-bundle-secrets.mjs` runs inside `npm run build` and enforces this
list explicitly rather than guessing from name patterns. Verified in both directions:

```
clean dist/ ......................................... exit 0
TELEGRAM_CHAT_ID value planted in dist/ ............. exit 1
TELEGRAM_API_HASH planted in dist/ .................. exit 0 + "expected" note
VITE_UPLOAD_SERVER_URL in env ....................... exit 0
VITE_TELEGRAM_BOT_TOKEN in env ...................... exit 1
```

Known limitation: `TELEGRAM_CHAT_ID` is a bare integer, so the exact-value check could
in principle collide with an unrelated number in the bundle. It does not today. If it
ever false-positives, narrow that one entry rather than removing the check.

### Scheduled for removal — do NOT remove yet

| Variable | Remove when | Why it must stay for now |
|---|---|---|
| `UPLOAD_SERVER_URL` | account mode lands | backs the live Render relay |
| `VITE_UPLOAD_SERVER_URL` | account mode lands | same, and it is named in the CSP `connect-src`/`media-src`; removing it before the relay is gone breaks BYOD upload and playback |
| `FIREBASE_PROJECT_ID` (duplication) | Firestore is deleted in Stage 2.7 | currently set per-environment **and** required server-side by `api/_lib/firebaseAuth.ts`, which rejects every authenticated request without it. Consolidate at 2.7, not before. |

### `TELEGRAM_CHAT_ID` — two separate problems

1. **Personal DM, not a channel.** It points at the operator's own DM with the bot, so
   managed mode stores every demo user's files there. Already noted in §2.5; moving it
   to a dedicated operator channel is **part of the bot-mode demo work**, not a new
   item.
2. **Currently misconfigured (found 2026-08-27).** It is set to the **bot's own numeric
   id** — the token's prefix — in both local `.env` and Vercel, most likely copied from
   the rotated token. Every managed upload fails:

```
$ curl -X POST https://hcloud-pi.vercel.app/api/telegram/managed-upload
{"success":false,"error":"Forbidden: the bot can't send messages to the bot"}
[http=400]
```

Reproduced directly against the Bot API: `sendDocument` with `chat_id` = bot id gives
exactly `403 Forbidden: the bot can't send messages to the bot`. A bot cannot message
itself. Fix by pointing it at a real chat or, preferably, the dedicated channel from
problem 1.

---

## 15. Testing hygiene

### Assert the identity you are actually authenticating as

While capturing the Stage 1 rules artifact, a Firestore `create` was denied and the
rules looked broken. They were correct. The script did:

```bash
UID=$(echo "$SU" | ...)      # UID is a READONLY variable in bash
```

`UID` is a bash built-in holding the shell's own user id, so the assignment was
silently ignored and the document was written with `userId: 197612`. The ownership
rule `request.resource.data.userId == request.auth.uid` then correctly refused it.

A silently wrong variable made a correct security rule look like a failure — and the
tempting "fix" would have been to loosen the rule.

**Rule: any future rules test must assert the identity it is authenticating as before
drawing a conclusion from an allow or a deny.** Print the uid from the token and
compare it to the uid being written. Never infer rule correctness from a single
request whose inputs you have not verified.

---

## 16. Known issue: orphaned bytes (hard delete does not delete)

**Severity: correctness defect, not a cosmetic follow-up.** For a storage product,
"delete" that does not delete is a broken promise about the user's data.

`telegramService.deleteFromTelegram` is a hardcoded `return false`. So `purgeItem`
removes the index record and **leaves the bytes in Telegram permanently**, with
nothing left pointing at them. Every hard delete performed so far has orphaned its
content.

### Added to Stage 2's definition of done

Stage 2 is not complete until real deletion works in both backends:

- **`account` mode** — `messages.deleteMessages` over MTProto for every part of the
  file, then remove the index record. Parts are 1 GiB each, so a multi-GB file is
  many messages: deletion must be batched, resumable, and must not leave a partially
  deleted file addressable.
- **`bot` mode** — Bot API `deleteMessage` per chunk in the operator's channel.

Ordering rule: **delete the Telegram messages first, then the index record.** The
reverse orphans bytes on any partial failure, which is exactly the current bug. A
failed message delete must leave the index entry intact so the operation is
retryable.

### Until it works, the UI must not claim storage was reclaimed

No "freed X MB", no storage-used figure that assumes purge worked. Say the record was
removed. Overstating this is worse than saying nothing, because the user then deletes
more to reclaim space that never comes back.

### Finding the existing orphans later

They are recoverable, because Telegram is the source of truth and the index is
derived (invariant 2):

1. Enumerate messages in the storage channel — `messages.getHistory` for `account`
   mode. Bot API cannot read history, so `bot`-mode orphans need the operator's own
   account, not the bot.
2. Build the set of `(chatId, messageId)` pairs referenced by the index (§5.2 stores
   both, precisely so this is possible).
3. Anything in the channel and not in the index is an orphan.

Cost estimate: one `getHistory` pass over the channel, ~100 messages per request, so
a channel with 10 000 messages is ~100 requests plus `FLOOD_WAIT` backoff — minutes,
not hours. Cheap enough to run as a periodic reconciliation job rather than a one-off
migration.

Caveat to check before trusting the result: a message the user posted to that channel
by hand would also appear as an orphan. Reconciliation must report candidates for
review, not delete them automatically.

