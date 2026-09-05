/// <reference lib="webworker" />
import { BaseTelegramClient, IdbStorage, TelegramWorker } from '@mtcute/web';

/**
 * The ONE MTProto client for this browser.
 *
 * Runs inside a SharedWorker, so every tab talks to this single instance over a
 * MessagePort instead of opening its own connection. That is not an optimisation
 * — it is the correctness requirement from ARCHITECTURE-V3 §6 and R3. Two clients
 * sharing one `auth_key` race on `msg_id`/`seq` and can trigger
 * `AUTH_KEY_DUPLICATED`, which invalidates the session for every tab at once.
 *
 * Nothing here reaches the network on load. The client connects lazily on the
 * first call from a port, so opening the app does not start a Telegram
 * connection until something actually needs one.
 *
 * The session lives in IndexedDB (`IdbStorage`) and NEVER leaves the device.
 * Encrypting it under a PIN-derived key is a later step in Stage 2.2; this file
 * deliberately does not import Firebase, our API, or anything that could
 * exfiltrate it.
 */

// api_id/api_hash are compile-time constants injected by vite.config.ts `define`.
// They ARE client-visible, by design — browser MTProto cannot work otherwise, and
// every third-party Telegram client ships its own. They are app identifiers and
// grant access to no account. See ARCHITECTURE-V3 §14; do not "fix" this.
const apiId = Number(import.meta.env.TELEGRAM_API_ID);
const apiHash = String(import.meta.env.TELEGRAM_API_HASH ?? '');

if (!Number.isFinite(apiId) || apiId <= 0 || !apiHash) {
    // Fail loudly here rather than letting the handshake fail with something
    // cryptic three layers down.
    throw new Error(
        'mtproto worker: TELEGRAM_API_ID / TELEGRAM_API_HASH are missing from the build. ' +
        'Check the define block in vite.config.ts and the Vercel environment.'
    );
}

const client = new BaseTelegramClient({
    apiId,
    apiHash,
    storage: new IdbStorage('hcloud-mtproto'),
    // mtcute's web entry defaults to its WebSocket transport, which is what makes
    // this work from a browser at all: raw TCP MTProto is impossible here, and the
    // wss://*.web.telegram.org endpoints are reachable from any origin (R1).
});

const worker = new TelegramWorker({
    client,
    // Keep the worker alive when the last tab closes so a reload does not force a
    // fresh handshake. 'destroy' would make every navigation re-do the auth-key
    // exchange.
    onLastDisconnected: 'nothing',
});

worker.mount();
