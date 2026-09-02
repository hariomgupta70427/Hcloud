import { TelegramClient, TelegramWorkerPort } from '@mtcute/web';
import { kvDestroy } from '@/lib/accountState';

/**
 * Page-side handle to the single MTProto client in the SharedWorker.
 *
 * One `TelegramWorkerPort` per tab, all pointing at the same SharedWorker, which
 * owns the only real connection (§6). `TelegramClient` is then layered on top of
 * the port purely to get the high-level methods (`signInQr`, `getMe`, …) — it does
 * not create a second client.
 */

/** Must match the dbName passed to IdbStorage in the worker. */
export const MTPROTO_DB_NAME = 'hcloud-mtproto';

/** mtcute's IdbStorage object store holding auth keys, one row per DC. */
const AUTH_KEYS_STORE = 'authKeys';

export class SharedWorkerUnavailableError extends Error {
    constructor() {
        super(
            'This browser does not support SharedWorker, which HCloud needs to keep a single ' +
            'Telegram connection across tabs. Safari and some mobile browsers are affected.'
        );
        this.name = 'SharedWorkerUnavailableError';
    }
}

export function isSharedWorkerSupported(): boolean {
    return typeof SharedWorker !== 'undefined';
}

let cached: { port: TelegramWorkerPort<{}>; tg: TelegramClient } | null = null;

/**
 * Connect to the worker. Idempotent per tab — repeated calls return the same
 * port, because each new port counts as another connection on the worker side.
 */
export function getMtprotoClient(): { port: TelegramWorkerPort<{}>; tg: TelegramClient } {
    if (cached) return cached;
    if (!isSharedWorkerSupported()) throw new SharedWorkerUnavailableError();

    // `new URL(..., import.meta.url)` is what lets Vite fingerprint and bundle the
    // worker as its own entry; a bare string path silently breaks in production.
    const worker = new SharedWorker(new URL('../workers/mtprotoWorker.ts', import.meta.url), {
        type: 'module',
        name: 'hcloud-mtproto',
    });

    const port = new TelegramWorkerPort<{}>({ worker });
    // Wrapping the port rather than constructing a client with credentials: the
    // credentials and the connection live in the worker, not here.
    const tg = new TelegramClient({ client: port });

    cached = { port, tg };
    return cached;
}

/**
 * Is a persisted auth key already on this device?
 *
 * This exists because a gate that cannot fail is not a gate. The first version of
 * the Task 2.0 page reported "handshake completed in 88 ms" on a run that performed
 * NO handshake — it had simply reused a key persisted by an earlier login. Timing
 * cannot distinguish the two; the presence of a stored key can.
 *
 * Read directly rather than through the worker: this must be answerable BEFORE the
 * client connects, without causing a connection.
 */
export function hasPersistedAuthKey(): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        const done = (v: boolean) => {
            if (!settled) {
                settled = true;
                resolve(v);
            }
        };

        // Open without a version so this never triggers an upgrade or creates the
        // database — if mtcute has not created it yet, there is no key.
        const req = indexedDB.open(MTPROTO_DB_NAME);
        req.onerror = () => done(false);
        req.onsuccess = () => {
            const db = req.result;
            try {
                if (!db.objectStoreNames.contains(AUTH_KEYS_STORE)) return done(false);
                const countReq = db.transaction(AUTH_KEYS_STORE, 'readonly')
                    .objectStore(AUTH_KEYS_STORE)
                    .count();
                countReq.onsuccess = () => done(countReq.result > 0);
                countReq.onerror = () => done(false);
            } catch {
                done(false);
            } finally {
                // Closing immediately would abort the transaction above; defer.
                setTimeout(() => db.close(), 0);
            }
        };
    });
}

/**
 * Telegram errors that mean "this session is gone". Every one of these is
 * terminal: no amount of retrying will fix it, and continuing to show a signed-in
 * UI is a lie.
 *
 * AUTH_KEY_DUPLICATED is included because it is the exact hazard the
 * one-client-per-browser rule exists to prevent (R3) — if it ever fires, the
 * session must be discarded rather than fought over.
 */
const REVOKED_ERRORS = new Set([
    'AUTH_KEY_UNREGISTERED',
    'AUTH_KEY_INVALID',
    'AUTH_KEY_DUPLICATED',
    'SESSION_REVOKED',
    'SESSION_EXPIRED',
    'USER_DEACTIVATED',
    'USER_DEACTIVATED_BAN',
]);

export function isSessionRevoked(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const text = (err as { text?: unknown }).text;
    return typeof text === 'string' && REVOKED_ERRORS.has(text);
}

/**
 * Tear the local session down completely and drop it from memory.
 *
 * Deleting IndexedDB alone is not enough: the SharedWorker holds the auth key in
 * memory and would keep using it, so the app would look healthy after a revocation
 * until the next cold start. The worker's client must be destroyed first.
 *
 * `reload` defaults to true because a SharedWorker cannot be reliably replaced
 * within a page's lifetime — a reload is the honest way to get a clean one.
 */
export async function resetLocalSession(opts: { reload?: boolean } = {}): Promise<void> {
    const reload = opts.reload ?? true;

    if (cached) {
        try {
            // Terminates the client inside the worker, releasing the auth key.
            await cached.port.unsafeForceDestroy();
        } catch {
            /* it may already be gone; deletion below is what matters */
        }
        cached = null;
    }

    await Promise.all([deleteDb(MTPROTO_DB_NAME), kvDestroy()]);

    if (reload) window.location.reload();
}

function deleteDb(name: string): Promise<void> {
    return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        // A live connection blocks deletion. Resolve anyway — the reload that
        // follows drops the connection, and the next open finds it deleted.
        req.onblocked = () => resolve();
    });
}
