/// <reference lib="webworker" />
import { BaseTelegramClient, IdbStorage, TelegramWorker } from '@mtcute/web';

/**
 * The ONE MTProto client for this browser.
 *
 * Runs inside a SharedWorker, so every tab talks to this single instance over a
 * MessagePort instead of opening its own connection. That is not an optimisation —
 * it is the correctness requirement from ARCHITECTURE-V3 §6 and R3. Two clients
 * sharing one `auth_key` race on `msg_id`/`seq` and can trigger
 * `AUTH_KEY_DUPLICATED`, which invalidates the session for every tab at once.
 *
 * ONE worker name, one client, for the lifetime of the browser session.
 *
 * Session reset and revocation are handled by the `resetSession` custom method
 * below, which rebuilds the client IN PLACE. The obvious alternative — versioning
 * the SharedWorker name so a fresh worker is created — is wrong: a SharedWorker is
 * keyed on (script URL, name), so a new name creates a SECOND worker while the old
 * one lives on as long as any tab holds a port to it. That would put two clients on
 * one auth key, i.e. manufacture the `AUTH_KEY_DUPLICATED` this design exists to
 * avoid.
 *
 * The session lives in IndexedDB (`IdbStorage`) and NEVER leaves the device.
 */

// api_id/api_hash are compile-time constants injected by vite.config.ts `define`.
// They ARE client-visible, by design — browser MTProto cannot work otherwise, and
// every third-party Telegram client ships its own. They are app identifiers and
// grant access to no account. See ARCHITECTURE-V3 §14; do not "fix" this.
const apiId = Number(import.meta.env.TELEGRAM_API_ID);
const apiHash = String(import.meta.env.TELEGRAM_API_HASH ?? '');

if (!Number.isFinite(apiId) || apiId <= 0 || !apiHash) {
    throw new Error(
        'mtproto worker: TELEGRAM_API_ID / TELEGRAM_API_HASH are missing from the build. ' +
        'Check the define block in vite.config.ts and the Vercel environment.'
    );
}

/** Must match MTPROTO_DB_NAME in src/lib/mtprotoPort.ts. */
const DB_NAME = 'hcloud-mtproto';

function createClient(): BaseTelegramClient {
    return new BaseTelegramClient({
        apiId,
        apiHash,
        storage: new IdbStorage(DB_NAME),
        // mtcute's web entry defaults to its WebSocket transport, which is what makes
        // this work from a browser at all: raw TCP MTProto is impossible here, and the
        // wss://*.web.telegram.org endpoints are reachable from any origin (R1).
    });
}

function deleteDb(name: string): Promise<void> {
    return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        // Deletion blocks while a connection is open. The client is closed before we
        // get here, so this should not fire; resolve anyway rather than hang.
        req.onblocked = () => resolve();
    });
}

let client: BaseTelegramClient | null = null;
let worker: TelegramWorker<CustomMethods> | null = null;

/**
 * Tear the client down and build a fresh one, in this same worker.
 *
 * Storage deletion happens HERE rather than in the page, because the worker owns
 * the IndexedDB connection: deleting from the page while the client still holds it
 * open blocks. Doing both on this side removes the cross-context ordering problem
 * entirely.
 *
 * `TelegramWorker.destroy()` only unregisters the message handler and clears the
 * heartbeat — it does not terminate the SharedWorker, and `@mtcute/web`'s
 * `setupSharedWorker()` is idempotent with handlers kept in a swappable Set. So a
 * fresh `TelegramWorker` can mount into the same scope. Verified against
 * @mtcute/core 0.32.1.
 */
async function rebuild(): Promise<void> {
    const oldWorker = worker;
    const oldClient = client;
    worker = null;
    client = null;

    // Unregister first so no request lands on a client that is about to close.
    oldWorker?.destroy();
    if (oldClient) {
        try {
            await oldClient.destroy();
        } catch {
            // Already dead, or the connection was revoked server-side. Either way the
            // point is that it stops being used.
        }
    }

    await deleteDb(DB_NAME);

    client = createClient();
    worker = new TelegramWorker({ client, customMethods, onLastDisconnected: 'nothing' });
    worker.mount();
}

const customMethods = {
    /**
     * Dispose the client, wipe its storage, and construct a fresh one.
     *
     * The response is sent from the handler that is being torn down. `respond` is a
     * captured postMessage bound to the port, not to the handler registry, so it
     * still delivers — but callers are written not to depend on it, because the
     * useful signal is that the NEXT connection lands on a fresh client.
     */
    async resetSession(): Promise<{ rebuilt: true }> {
        await rebuild();
        return { rebuilt: true };
    },
};

type CustomMethods = typeof customMethods;
export type MtprotoCustomMethods = CustomMethods;

client = createClient();
worker = new TelegramWorker({ client, customMethods, onLastDisconnected: 'nothing' });
worker.mount();
