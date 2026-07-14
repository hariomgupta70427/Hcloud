/**
 * Client-side Telegram (MTProto) service — browser talks DIRECTLY to Telegram.
 *
 * This removes the Render server from the BYOD hot path entirely:
 *
 *   BEFORE:  browser -> Render -> Telegram   (2 hops + cold start)
 *   AFTER:   browser -> Telegram             (1 hop, no server)
 *
 * gramjs runs in the browser using the polyfills already configured in
 * vite.config.ts (buffer/process/stream/crypto-browserify/vm-browserify).
 * The user's own session (BYOD) is what authenticates, so uploads land in
 * their Saved Messages and support up to 2GB (4GB premium).
 *
 * NOTE: this handles the OWNER's uploads/downloads. Public share links for BYOD
 * files still need a server that holds gramjs (a stranger has no session) — that
 * remains the Render /token-stream fallback.
 */

import { TelegramClient, sessions } from 'telegram';
const { StringSession } = sessions;

// Exposed to the client via vite.config.ts `define`.
const API_ID = parseInt(import.meta.env.TELEGRAM_API_ID || '0');
const API_HASH = import.meta.env.TELEGRAM_API_HASH || '';

// Telegram allows 2GB (free) / 4GB (premium). We cap at 2GB for safety.
export const MAX_CLIENT_FILE_SIZE = 2 * 1024 * 1024 * 1024;

export interface ClientUploadResult {
    success: boolean;
    messageId?: number;
    fileId?: string;
    error?: string;
}

export interface ClientDownloadResult {
    success: boolean;
    blobUrl?: string;
    error?: string;
}

// ── Client cache ────────────────────────────────────────────────────────────
// Connecting to Telegram costs a round-trip; reuse a connected client per
// session so back-to-back uploads/opens are instant.
let cachedClient: TelegramClient | null = null;
let cachedSessionKey = '';

async function getClient(session: string): Promise<TelegramClient> {
    if (!API_ID || !API_HASH) {
        throw new Error('Telegram API credentials are not configured');
    }
    if (!session || session.length < 10) {
        throw new Error('Invalid Telegram session');
    }

    // Reuse a live client for the same session.
    if (cachedClient && cachedSessionKey === session) {
        if (cachedClient.connected) return cachedClient;
        try {
            await cachedClient.connect();
            return cachedClient;
        } catch {
            cachedClient = null; // fall through and recreate
        }
    }

    const client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true,
        // Sensible identity so Telegram doesn't flag the session.
        deviceModel: 'HCloud Web',
        systemVersion: 'Web',
        appVersion: '1.0.0',
    });

    await client.connect();

    // Verify the session is actually valid before we rely on it.
    const me = await client.getMe();
    if (!me) {
        await client.disconnect().catch(() => {});
        throw new Error('Telegram session is invalid — please reconnect your account');
    }

    cachedClient = client;
    cachedSessionKey = session;
    return client;
}

/** Whether client-side Telegram is usable (credentials present). */
export function isClientUploadAvailable(): boolean {
    return !!API_ID && !!API_HASH;
}

/**
 * Upload a file straight from the browser to the user's Saved Messages.
 * `onProgress` receives 0–100.
 */
export async function uploadFileClientSide(
    file: File,
    session: string,
    onProgress?: (percent: number) => void,
): Promise<ClientUploadResult> {
    try {
        if (file.size > MAX_CLIENT_FILE_SIZE) {
            return { success: false, error: 'File too large. Maximum size is 2GB.' };
        }

        const client = await getClient(session);

        const result = await client.sendFile('me', {
            file,
            forceDocument: true, // preserve exact bytes (no re-encoding of media)
            // gramjs slices and uploads in parallel workers; 4 is a good browser default.
            workers: 4,
            progressCallback: (uploaded: number, total: number) => {
                if (onProgress && total) {
                    onProgress(Math.min(99, Math.round((Number(uploaded) / Number(total)) * 100)));
                }
            },
        });

        // Pull the stored document's id (used as telegramFileId) + message id.
        let fileId = '';
        const media = (result as any)?.media;
        if (media?.document) fileId = media.document.id?.toString() || '';
        else if (media?.photo) fileId = `photo_${media.photo.id}`;

        onProgress?.(100);
        return { success: true, messageId: result.id, fileId: fileId || String(result.id) };
    } catch (error: any) {
        console.error('[ClientUpload] Upload failed:', error);
        return { success: false, error: error?.message || 'Upload failed' };
    }
}

/**
 * Download a BYOD file from the user's Saved Messages to a blob URL,
 * straight from Telegram (no server). Used for preview + download.
 */
export async function downloadFileClientSide(
    messageId: number,
    session: string,
    onProgress?: (percent: number) => void,
): Promise<ClientDownloadResult> {
    try {
        const client = await getClient(session);

        const messages = await client.getMessages('me', { ids: [messageId] });
        const message = messages?.[0];
        if (!message?.media) {
            return { success: false, error: 'File not found in your Telegram account' };
        }

        const buffer = await client.downloadMedia(message, {
            progressCallback: (downloaded: number, total: number) => {
                if (onProgress && total) {
                    onProgress(Math.min(100, Math.round((Number(downloaded) / Number(total)) * 100)));
                }
            },
        } as any);

        if (!buffer) return { success: false, error: 'Failed to download file' };

        // Preserve the file's real MIME type so <img>/<video>/<audio> render it.
        let mimeType = 'application/octet-stream';
        const media = message.media as any;
        if (media?.document?.mimeType) mimeType = media.document.mimeType;
        else if (media?.photo) mimeType = 'image/jpeg';

        const blob = new Blob([buffer as unknown as BlobPart], { type: mimeType });
        return { success: true, blobUrl: URL.createObjectURL(blob) };
    } catch (error: any) {
        console.error('[ClientUpload] Download failed:', error);
        return { success: false, error: error?.message || 'Download failed' };
    }
}

/** Disconnect and clear the cached client (e.g. on logout). */
export async function disconnectClient(): Promise<void> {
    if (cachedClient) {
        await cachedClient.disconnect().catch(() => {});
        cachedClient = null;
        cachedSessionKey = '';
    }
}
