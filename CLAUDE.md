# HCloud — working rules

Architecture source of truth: **`docs/ARCHITECTURE-V3.md`**. Read it before changing anything
structural. Sections marked 🔒 there are irreversible once users hold data.

---

## Secrets

**No secret may ever carry a `VITE_` prefix.** Vite inlines anything `VITE_`-prefixed into the
client bundle, so a `VITE_` variable is public by definition — it ships to every visitor. Server-only
secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`,
`STREAM_TOKEN_SECRET`, `ADMIN_SECRET`) are read only by `api/` functions and never referenced from
`src/`.

The six `FIREBASE_*` values are the one exception, and they are not secrets: Firebase web config is
a set of public identifiers, and security comes from Firestore rules. They are injected via
`vite.config.ts` `define` and are allowlisted in the scanner.

**Never use `.gitignore` to "fix" a leak or hide a tracked file.** `.gitignore` has no effect on a
file that is already tracked, so this hides nothing and creates false confidence. If a secret has
been committed: **rotate the credential, and say so plainly.** Record it in
`docs/ARCHITECTURE-V3.md`. Suppressing the evidence is itself a defect.

`npm run build` runs `scripts/check-bundle-secrets.mjs`. It fails the build on a real secret value,
a secret-shaped literal, or a `VITE_`-named secret in the environment. Do not weaken or skip it.

## Documentation

`docs/ARCHITECTURE-V3.md` is the source of truth and **must never be gitignored**. It was
previously excluded from the repo, which meant the architecture of record existed only on one
machine. Keep it committed.

## Data model

**`parentId` is `string | null` — never `''`.** Root is `null`. Root listings query
`where('parentId', '==', null)`, which `''` can never match, so a single `parentId: ''` write makes
a file invisible in every folder view and effectively deletes it. All reads and writes go through
`normalizeParentId()` in `src/lib/parentId.ts`; regression tests are in
`src/test/parentId.test.ts`. That module deliberately imports no Firebase so it stays unit-testable.

**Every destructive operation goes through the single funnel** with confirmation and an undo
window. No page implements its own delete. Soft delete sets a trash flag and keeps the Telegram
message; hard delete removes the Telegram message and may only be performed by that one function.

## Git

- **Branch per stage. Never commit to main.** Merge only after the preview deployment is green.
- Conventional commit messages: `type(scope): summary` — `feat`, `fix`, `chore`, `docs`, `test`,
  `refactor`, `perf`.
- **Commit messages must never mention Claude, Claude Code, AI, or any assistant**, and must never
  contain `Co-Authored-By` trailers, "Generated with" footers, emoji trailers, or session links.
  Plain conventional commits only. `.claude/settings.json` enforces this, but the rule stands
  regardless of tooling.
- Never change `user.name` or `user.email`.
- One commit per logical change.

## Process

- One stage per session. At the end of a stage, update `docs/ARCHITECTURE-V3.md` and append the
  proof artifacts.
- **A stage is not complete without its gate artifacts pasted into the doc.** Do not self-declare
  completion. Gates are listed per stage in the architecture doc and include, as applicable:
  HTTP/curl transcripts, a SHA-256 match on a >2 GB multi-part file, resume-after-refresh, a
  500-file folder upload, a 10 000-file list at 60 fps, a seek-storm run,
  `FILE_REFERENCE_EXPIRED` recovery, and emulator output proving anonymous reads are DENIED.
- Nothing in Stage 0 or Stage 1 may assume a single storage backend — both `account` and `bot` mode
  sit behind one `StorageBackend` interface.

## Invariants

Violating any of these is a bug regardless of what else works:

1. In `account` mode, file bytes never touch our infrastructure.
2. Telegram is the source of truth; the index is derived and rebuildable from it.
3. Sessions and secrets never leave the device and never appear in a `VITE_` variable.
4. `parentId` is `string | null`, never `''`.
5. One MTProto client per browser, owned by the SharedWorker.
6. Every destructive operation goes through the single funnel.

Never market "unlimited storage" in the UI or the repo.

## Build & verify

```bash
npm run typecheck:api    # api/ is ESM — relative imports need explicit .js extensions
npm run check:secrets    # scans dist/ for secrets
npm run build            # typecheck:api && vite build && check:secrets
npm test                 # vitest
```

`api/` runs as ESM because the root `package.json` sets `"type": "module"`. Extensionless relative
imports crash the function at module load in production (`FUNCTION_INVOCATION_FAILED` on every
request, including `OPTIONS`). `api/tsconfig.json` uses `moduleResolution: NodeNext` so this is a
compile error rather than an outage — keep it wired into `build`.
