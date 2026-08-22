/**
 * Chunked upload & download for BYOD files.
 *
 * All traffic goes to the HCloud relay — a small Node server that owns the
 * Telegram MTProto client (gramjs), because gramjs can run neither on Vercel nor
 * in the browser. See deploy/oracle/ for how the relay is hosted.
 */

import { getIdTokenHeader, isAuthError } from '@/lib/authHeader';

// Chunk size: 8MB (larger = fewer HTTP requests = faster upload)
const CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Relay origin, baked in at build time from VITE_UPLOAD_SERVER_URL.
 *
 * Deliberately has NO hardcoded fallback host. A wrong-but-plausible default is
 * the worst outcome here: the app would keep pointing at a decommissioned server
 * and fail with confusing network errors. An empty value fails loudly instead,
 * naming the variable that needs setting.
 */
export const UPLOAD_SERVER_URL = (import.meta.env.VITE_UPLOAD_SERVER_URL || '').replace(/\/$/, '');

if (!UPLOAD_SERVER_URL) {
    console.error(
        '[relay] VITE_UPLOAD_SERVER_URL is not set. BYOD upload, download and ' +
        'streaming will not work. Set it to your relay origin (e.g. ' +
        'https://relay.yourdomain.com) and rebuild.'
    );
}

const RELAY_NOT_CONFIGURED =
    'File storage is not configured for this deployment. Please contact support.';

/** Throws a user-facing error when the relay origin is missing. */
function requireRelay(): string {
    if (!UPLOAD_SERVER_URL) throw new Error(RELAY_NOT_CONFIGURED);
    return UPLOAD_SERVER_URL;
}

const API_CHUNK = `${UPLOAD_SERVER_URL}/upload/chunk`;
const API_FINALIZE = `${UPLOAD_SERVER_URL}/upload/finalize`;
const API_DOWNLOAD = `${UPLOAD_SERVER_URL}/download`;

/**
 * Get authorization headers with the Firebase ID token.
 *
 * Throws NotSignedInError when there is no live session. It previously returned
 * just `{'Content-Type': ...}` in that case, so the request went out with no
 * Authorization header and the relay answered `401 Missing or invalid
 * Authorization header` — which then got retried four times, making an expired
 * session look like a broken server.
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
    return {
        'Content-Type': 'application/json',
        ...(await getIdTokenHeader()),
    };
}

/**
 * Get a SECURE streaming URL for a BYOD file, usable directly as the `src`
 * of <audio>/<video>/<img> or an <iframe> for any content type.
 *
 * How it works:
 *   1. Ask the Vercel /api/telegram/session-token endpoint to mint a short-lived,
 *      AES-256-GCM encrypted token that wraps { session, messageId, exp }.
 *   2. Point the media element at the relay's PUBLIC /token-stream?token= route,
 *      which decrypts the token and streams the bytes from Telegram with full
 *      HTTP Range support (so seeking in audio/video works).
 *
 * The raw Telegram session never appears in the URL, logs, or history — only
 * the opaque, expiring token does. The bytes flow browser <- relay directly
 * (no Vercel proxy hop), so playback is as fast as the server allows.
 *
 * @param opts.forDownload Ask the server for `Content-Disposition: attachment`.
 *   Required for real downloads: the HTML `download` attribute is ignored on
 *   cross-origin URLs, so without this a "Download" click just opens the file
 *   in a new tab and plays it.
 */
export async function getByodStreamUrl(
    messageId: number,
    session: string,
    opts?: { forDownload?: boolean }
): Promise<string | null> {
    try {
        const relay = requireRelay();

        const res = await fetch('/api/telegram/session-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await getIdTokenHeader()) },
            body: JSON.stringify({ session, messageId }),
        });
        if (!res.ok) {
            console.error('[getByodStreamUrl] Token mint failed:', res.status);
            return null;
        }
        const data = await res.json();
        if (!data?.token) return null;

        const suffix = opts?.forDownload ? '&download=1' : '';
        return `${relay}/token-stream?token=${encodeURIComponent(data.token)}${suffix}`;
    } catch (err) {
        console.error('[getByodStreamUrl] Failed to mint stream token:', err);
        return null;
    }
}

export interface ChunkedUploadResult {
    success: boolean;
    messageId?: number;
    fileId?: string;
    error?: string;
}

export interface UploadProgress {
    phase: 'preparing' | 'uploading' | 'finalizing';
    chunksUploaded: number;
    totalChunks: number;
    percent: number;
}

/**
 * Generate a unique upload ID
 */
function generateUploadId(): string {
    return `upload_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Upload a single chunk to the server
 */
async function uploadChunk(
    uploadId: string,
    chunkIndex: number,
    totalChunks: number,
    chunkData: string, // base64
    fileName: string,
    mimeType: string,
    session: string
): Promise<{ success: boolean; error?: string; fatal?: boolean }> {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(API_CHUNK, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                uploadId,
                chunkIndex,
                totalChunks,
                chunkData,
                fileName,
                mimeType,
                session,
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            // 401/403 will never succeed on retry — the credential is the problem,
            // not the network. Retrying just delayed the real message by ~15s.
            const fatal = response.status === 401 || response.status === 403;
            return {
                success: false,
                fatal,
                error: fatal
                    ? 'Your session expired. Please sign in again and retry the upload.'
                    : (data.error || `Chunk upload failed (${response.status})`),
            };
        }

        return { success: true };
    } catch (error: any) {
        if (isAuthError(error)) {
            return { success: false, fatal: true, error: error.message };
        }
        console.error(`[ChunkedUpload] Chunk ${chunkIndex} failed:`, error);
        return { success: false, error: error?.message || 'Network error' };
    }
}

/**
 * Finalize the upload (tell server to assemble and upload to Telegram)
 */
async function finalizeUpload(
    uploadId: string,
    session: string
): Promise<ChunkedUploadResult> {
    try {
        const headers = await getAuthHeaders();
        const response = await fetch(API_FINALIZE, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                uploadId,
                session,
            }),
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                return { success: false, error: 'Your session expired. Please sign in again and retry the upload.' };
            }
            return { success: false, error: data.error || `Finalize failed (${response.status})` };
        }

        return {
            success: true,
            messageId: data.messageId,
            fileId: data.fileId,
        };
    } catch (error: any) {
        if (isAuthError(error)) {
            return { success: false, error: error.message };
        }
        console.error('[ChunkedUpload] Finalize failed:', error);
        return { success: false, error: error?.message || 'Network error' };
    }
}

/**
 * Read a slice of the file and base64-encode it.
 *
 * The naive version built the binary string one character at a time
 * (`binary += String.fromCharCode(bytes[i])`), which for an 8MB chunk meant 8
 * million string concatenations on the main thread — the UI froze for a second
 * or more per chunk, so a large video upload felt like the whole site had hung.
 *
 * Encoding in 32KB windows via `String.fromCharCode.apply` is orders of
 * magnitude faster while staying well under the argument-count limit that makes
 * the one-shot spread form throw RangeError on large inputs.
 */
async function readChunkAsBase64(file: File, start: number, end: number): Promise<string> {
    const slice = file.slice(start, end);
    const arrayBuffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const WINDOW = 32 * 1024; // safe for Function.prototype.apply
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += WINDOW) {
        parts.push(String.fromCharCode.apply(
            null,
            bytes.subarray(i, Math.min(i + WINDOW, bytes.length)) as unknown as number[]
        ));
    }
    return btoa(parts.join(''));
}

/**
 * Upload a large file using chunked upload
 * @param file The file to upload
 * @param session Telegram session string
 * @param onProgress Progress callback
 * @param mimeType Resolved MIME type. Pass the value from resolveMimeType() —
 *   NOT raw `file.type`, which is empty for .mkv/.flac/.m4v on Windows and
 *   would make Telegram store the file without audio/video attributes.
 */
export async function uploadFileChunked(
    file: File,
    session: string,
    onProgress?: (progress: UploadProgress) => void,
    mimeType?: string
): Promise<ChunkedUploadResult> {
    // Fail before reading or encoding a single byte if the relay is unconfigured.
    try {
        requireRelay();
    } catch (err: any) {
        return { success: false, error: err.message };
    }

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId = generateUploadId();
    const effectiveMime = mimeType || file.type || 'application/octet-stream';

    console.log(
        `[ChunkedUpload] ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB, ${effectiveMime}) ` +
        `-> ${totalChunks} chunk(s) of ${CHUNK_SIZE / 1024 / 1024}MB [${uploadId}]`
    );

    onProgress?.({
        phase: 'preparing',
        chunksUploaded: 0,
        totalChunks,
        percent: 0,
    });

    // Upload each chunk sequentially
    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);

        // Read chunk as base64
        const chunkData = await readChunkAsBase64(file, start, end);

        // Upload chunk with retry logic
        let attempts = 0;
        const maxAttempts = 4;
        let result: { success: boolean; error?: string; fatal?: boolean } = { success: false };

        while (attempts < maxAttempts) {
            attempts++;
            result = await uploadChunk(
                uploadId,
                i,
                totalChunks,
                chunkData,
                file.name,
                effectiveMime,
                session
            );

            if (result.success) {
                break;
            }

            // An auth failure cannot be retried into success — stop immediately
            // and report the real cause instead of burning through backoff.
            if (result.fatal) {
                return { success: false, error: result.error };
            }

            console.warn(`[ChunkedUpload] Chunk ${i} failed (attempt ${attempts}/${maxAttempts}): ${result.error}`);

            if (attempts < maxAttempts) {
                // Linear backoff for genuinely transient network blips. The old
                // quadratic delay existed to outlast a ~50s free-tier cold start;
                // the relay is always running, so waiting that long only makes a
                // real failure feel like a hang.
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
            }
        }

        if (!result.success) {
            return {
                success: false,
                error: `Failed to upload chunk ${i + 1} of ${totalChunks}: ${result.error}`
            };
        }

        // Report progress
        const percent = Math.round(((i + 1) / totalChunks) * 90); // Reserve 10% for finalization
        onProgress?.({
            phase: 'uploading',
            chunksUploaded: i + 1,
            totalChunks,
            percent,
        });
    }

    console.log('[ChunkedUpload] All chunks uploaded, finalizing...');

    // Report finalization phase
    onProgress?.({
        phase: 'finalizing',
        chunksUploaded: totalChunks,
        totalChunks,
        percent: 95,
    });

    // Finalize - tell server to assemble and upload to Telegram
    const finalResult = await finalizeUpload(uploadId, session);

    if (finalResult.success) {
        onProgress?.({
            phase: 'finalizing',
            chunksUploaded: totalChunks,
            totalChunks,
            percent: 100,
        });
        console.log(`[ChunkedUpload] Complete — messageId=${finalResult.messageId}, fileId=${finalResult.fileId}`);
    }

    return finalResult;
}

/**
 * Download a BYOD file through the relay
 * Returns a blob URL that can be used for preview/download
 */
export async function downloadBYODFile(
    messageId: number,
    session: string,
): Promise<{ success: boolean; blobUrl?: string; error?: string }> {
    try {
        requireRelay();
        console.log(`[BYOD Download] Fetching message ${messageId}...`);
        const headers = await getAuthHeaders();
        const response = await fetch(API_DOWNLOAD, {
            method: 'POST',
            headers,
            body: JSON.stringify({ messageId, session }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return { success: false, error: errorData.error || `Download failed (${response.status})` };
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        console.log(`[BYOD Download] Success: ${(blob.size / 1024 / 1024).toFixed(1)}MB`);
        return { success: true, blobUrl };
    } catch (error: any) {
        console.error('[BYOD Download] Error:', error);
        return { success: false, error: error.message || 'Download failed' };
    }
}
