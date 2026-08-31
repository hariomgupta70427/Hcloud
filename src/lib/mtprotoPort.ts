import { TelegramClient, TelegramWorkerPort } from '@mtcute/web';

/**
 * Page-side handle to the single MTProto client in the SharedWorker.
 *
 * One `TelegramWorkerPort` per tab, all pointing at the same SharedWorker, which
 * owns the only real connection (§6). `TelegramClient` is then layered on top of
 * the port purely to get the high-level methods (`signInQr`, `getMe`, …) — it does
 * not create a second client.
 */

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
