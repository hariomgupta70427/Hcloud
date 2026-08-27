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

**Still outstanding for Stage 0:** a managed upload and a Range stream against production, which
are blocked on the rotated bot token reaching Vercel (§R8). Those transcripts get appended here.

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

Artifacts (a) and (b) need the Firebase CLI authenticated to `hcloud-6e7eb`
(`firebase login`) so the new rules can be deployed, plus one real shared file. The
CLI is installed (14.17.0) but not authed.

Note for whoever captures them: a 403 on a **nonexistent** document proves nothing —
it fails the old `isShared` condition too. The artifact must use a genuinely shared
document id.

#### Follow-ups found during Stage 1 — not fixed here

- **Hard delete reclaims no Telegram storage.** `telegramService.deleteFromTelegram`
  is a hardcoded `return false`, so `purgeItem` removes the index record and leaves
  the bytes in Telegram forever. Needs Bot API `deleteMessage` for `bot` mode and
  `messages.deleteMessages` for `account` mode.
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
