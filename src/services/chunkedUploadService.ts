/**
 * Chunked Upload & Download Service for BYOD
 * Handles uploads via Render server and downloads for BYOD files
 */

import { getAuth } from 'firebase/auth';
import { getIdTokenHeader } from '@/lib/authHeader';

// Chunk size: 8MB (larger = fewer HTTP requests = faster upload)
const CHUNK_SIZE = 8 * 1024 * 1024;

// Upload server URL - Render deployment
export const UPLOAD_SERVER_URL = import.meta.env.VITE_UPLOAD_SERVER_URL || 'https://hcloud.onrender.com';

const API_CHUNK = `${UPLOAD_SERVER_URL}/upload/chunk`;
const API_FINALIZE = `${UPLOAD_SERVER_URL}/upload/finalize`;
const API_DOWNLOAD = `${UPLOAD_SERVER_URL}/download`;
const API_HEALTH = `${UPLOAD_SERVER_URL}/health`;

/**
 * Wake the Render instance early.
 *
 * Render's free tier suspends the service after ~15 minutes idle, and the first
 * request afterwards waits ~50 seconds for the container to boot. Firing this
 * as soon as the app loads (and again before an upload) means the boot overlaps
 * with the user browsing, so by the time they actually upload or play something
 * the server is already awake.
 *
 * Deliberately fire-and-forget: a failure here must never surface to the user
 * or block anything.
 */
let lastWarmAt = 0;
export function warmUploadServer(): void {
    const now = Date.now();
    // At most once a minute — repeated pings buy nothing.
    if (now - lastWarmAt < 60_000) return;
    lastWarmAt = now;

    void fetch(API_HEALTH, { method: 'GET', mode: 'cors', cache: 'no-store' })
        .catch(() => { /* server asleep or offline — the real request will retry */ });
}

/**
 * Get authorization headers with Firebase ID token
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) {
        return { 'Content-Type': 'application/json' };
    }
    try {
        const token = await user.getIdToken();
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        };
    } catch {
        return { 'Content-Type': 'application/json' };
    }
}

/**
 * Get a SECURE streaming URL for a BYOD file, usable directly as the `src`
 * of <audio>/<video>/<img> or an <iframe> for any content type.
 *
 * How it works:
 *   1. Ask the Vercel /api/telegram/session-token endpoint to mint a short-lived,
 *      AES-256-GCM encrypted token that wraps { session, messageId, exp }.
 *   2. Point the media element at Render's PUBLIC /token-stream?token= route,
 *      which decrypts the token and streams the bytes from Telegram with full
 *      HTTP Range support (so seeking in audio/video works).
 *
 * The raw Telegram session never appears in the URL, logs, or history — only
 * the opaque, expiring token does. The bytes flow browser <- Render directly
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
        // Overlap the Render cold start with the token mint.
        warmUploadServer();

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
        return `${UPLOAD_SERVER_URL}/token-stream?token=${encodeURIComponent(data.token)}${suffix}`;
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
): Promise<{ success: boolean; error?: string }> {
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

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error || 'Chunk upload failed' };
        }

        return { success: true };
    } catch (error: any) {
        console.error(`[ChunkedUpload] Chunk ${chunkIndex} failed:`, error);
        return { success: false, error: error.message || 'Network error' };
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

        const data = await response.json();

        if (!response.ok) {
            return { success: false, error: data.error || 'Finalize failed' };
        }

        return {
            success: true,
            messageId: data.messageId,
            fileId: data.fileId,
        };
    } catch (error: any) {
        console.error('[ChunkedUpload] Finalize failed:', error);
        return { success: false, error: error.message || 'Network error' };
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

    // Wake the Render instance while we encode the first chunk. On the free tier
    // a sleeping server costs ~50s of cold start, and doing it concurrently with
    // encoding hides most of that latency.
    warmUploadServer();

    // Upload each chunk sequentially
    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);

        // Read chunk as base64
        const chunkData = await readChunkAsBase64(file, start, end);

        // Upload chunk with retry logic
        let attempts = 0;
        const maxAttempts = 4;
        let result: { success: boolean; error?: string } = { success: false };

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

            console.warn(`[ChunkedUpload] Chunk ${i} failed (attempt ${attempts}/${maxAttempts}): ${result.error}`);

            if (attempts < maxAttempts) {
                // Exponential backoff — the first failure is usually the Render
                // cold start, which can take ~50s to resolve.
                await new Promise(resolve => setTimeout(resolve, 1500 * attempts * attempts));
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
 * Download a BYOD file from the Render server
 * Returns a blob URL that can be used for preview/download
 */
export async function downloadBYODFile(
    messageId: number,
    session: string,
): Promise<{ success: boolean; blobUrl?: string; error?: string }> {
    try {
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
