// Telegram Bot API Service for file storage
// All Bot API calls are proxied through /api/telegram/* serverless functions
// so the bot token NEVER appears in the client bundle.

import { resolveMimeType } from '@/lib/fileTypes';
import { getIdTokenHeader } from '@/lib/authHeader';

// Managed (Bot API) limits.
//
// The Bot API itself accepts 50MB, but the managed upload travels to the Vercel
// function base64-encoded inside a JSON body — which inflates it by ~33% — and
// that function's body parser caps at 55MB. So the real ceiling is ~40MB of
// original bytes. Advertising 50MB made 41-50MB files fail with an opaque 413.
export const MAX_FILE_SIZE = 40 * 1024 * 1024; // 40 MB of original bytes

// Bot API `getFile` refuses files larger than this, so anything bigger can be
// uploaded but never retrieved again. useUpload blocks these before uploading.
export const MAX_MANAGED_RETRIEVABLE_SIZE = 20 * 1024 * 1024; // 20 MB

export interface TelegramUploadResult {
    success: boolean;
    fileId?: string;
    uniqueFileId?: string;
    fileName?: string;
    mimeType?: string;
    fileSize?: number;
    thumbnail?: string;
    error?: string;
}

export interface TelegramFileInfo {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_path?: string;
}

export interface UploadProgressCallback {
    (progress: number): void;
}

/**
 * Base64-encode an ArrayBuffer without freezing the UI.
 *
 * The previous implementation was
 *   `new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), '')`
 * which performed one string concatenation per byte — ~40 million of them for a
 * 40MB file, on the main thread. The tab visibly hung for seconds. Encoding in
 * 32KB windows is dramatically faster and stays under the argument limit that
 * makes the spread form throw RangeError.
 */
function bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const WINDOW = 32 * 1024;
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
 * POST a JSON body with REAL upload progress.
 *
 * fetch() cannot report request-upload progress, which is why the old code
 * emitted fake 10/30/90/100 milestones and appeared frozen at 30% for the whole
 * transfer. XMLHttpRequest still exposes `upload.onprogress`, so the bar now
 * tracks actual bytes on the wire.
 */
function postJsonWithProgress(
    url: string,
    body: string,
    onProgress?: UploadProgressCallback,
    headers?: Record<string, string>
): Promise<{ ok: boolean; status: number; data: any }> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        for (const [key, value] of Object.entries(headers ?? {})) {
            xhr.setRequestHeader(key, value);
        }
        xhr.responseType = 'text';

        if (onProgress) {
            xhr.upload.onprogress = (e) => {
                if (!e.lengthComputable) return;
                // Cap at 95%: the remaining time is Telegram accepting the file,
                // which we cannot observe. Never show 100% before it's stored.
                onProgress(Math.min(95, Math.round((e.loaded / e.total) * 95)));
            };
        }

        xhr.onload = () => {
            let data: any = {};
            try {
                data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
            } catch {
                data = { error: `Server returned a non-JSON response (${xhr.status})` };
            }
            resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, data });
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.ontimeout = () => reject(new Error('Upload timed out'));
        xhr.onabort = () => reject(new Error('Upload cancelled'));

        xhr.send(body);
    });
}

/**
 * Upload a file to managed storage via the server-side Bot API proxy.
 *
 * ALWAYS uses `sendDocument`. The earlier code routed images through
 * `sendPhoto` and video through `sendVideo`, both of which make Telegram
 * RE-ENCODE the file — a cloud drive silently returning a compressed JPEG
 * instead of the original PNG is data loss, so document mode is the only
 * correct choice here.
 *
 * @param mimeType Resolved MIME type from resolveMimeType(). Do not pass raw
 *   `file.type` — it is empty for many media containers on Windows.
 */
export async function uploadToTelegram(
    file: File,
    _caption?: string,
    onProgress?: UploadProgressCallback,
    mimeType?: string
): Promise<TelegramUploadResult> {
    try {
        if (file.size > MAX_FILE_SIZE) {
            return {
                success: false,
                error: `File too large. Managed storage supports up to ${Math.round(MAX_FILE_SIZE / (1024 * 1024))}MB.`,
            };
        }

        const effectiveMime = mimeType || resolveMimeType(file.name, file.type);

        onProgress?.(1);
        const arrayBuffer = await file.arrayBuffer();
        const base64 = bufferToBase64(arrayBuffer);

        const { ok, status, data } = await postJsonWithProgress(
            '/api/telegram/managed-upload',
            JSON.stringify({
                fileBase64: base64,
                fileName: file.name,
                mimeType: effectiveMime,
            }),
            onProgress,
            await getIdTokenHeader()
        );

        if (!ok || !data?.success) {
            // 413 means the body exceeded the function's limit despite our own
            // check — surface something the user can act on.
            let error: string;
            if (status === 413) {
                error = 'File too large for managed storage. Connect your own Telegram account to upload files this size.';
            } else if (status === 401) {
                error = 'Your session expired. Please sign in again and retry.';
            } else {
                error = data?.error || `Upload failed (${status})`;
            }
            return { success: false, error };
        }

        onProgress?.(100);

        return {
            success: true,
            fileId: data.fileId,
            uniqueFileId: data.uniqueFileId,
            fileName: data.fileName || file.name,
            mimeType: data.mimeType || effectiveMime,
            fileSize: data.fileSize || file.size,
            thumbnail: data.thumbnail,
        };
    } catch (error: any) {
        console.error('Telegram upload error:', error);
        return {
            success: false,
            error: error?.message || 'Network error during upload',
        };
    }
}

/**
 * Upload to managed storage.
 *
 * Kept as a named export for call-site clarity; every file type takes the same
 * lossless `sendDocument` path (see uploadToTelegram).
 */
export async function smartUploadToTelegram(
    file: File,
    onProgress?: UploadProgressCallback,
    mimeType?: string
): Promise<TelegramUploadResult> {
    return uploadToTelegram(file, undefined, onProgress, mimeType);
}

/**
 * Get file info and download URL from Telegram.
 * Returns the server-side stream proxy URL, which handles getFile + download
 * internally — no bot token is ever needed client-side.
 */
export async function getFileFromTelegram(fileId: string): Promise<{
    success: boolean;
    downloadUrl?: string;
    fileInfo?: TelegramFileInfo;
    error?: string;
}> {
    return {
        success: true,
        downloadUrl: `/api/telegram/stream?fileId=${encodeURIComponent(fileId)}`,
    };
}

/**
 * Get a streaming URL for managed (Bot API) files.
 * Uses the Vercel proxy at /api/telegram/stream so the browser can
 * play media directly without downloading the full blob first.
 */
export function getManagedStreamUrl(fileId: string): string {
    return `/api/telegram/stream?fileId=${encodeURIComponent(fileId)}`;
}

/**
 * URL that makes the browser SAVE a managed file instead of playing it.
 *
 * `download=1` makes the proxy respond with `Content-Disposition: attachment`,
 * and `name` gives the user their original filename rather than Telegram's
 * internal `documents/file_42.mp4`.
 */
export function getManagedDownloadUrl(fileId: string, fileName: string): string {
    return `/api/telegram/stream?fileId=${encodeURIComponent(fileId)}` +
        `&download=1&name=${encodeURIComponent(fileName)}`;
}

/**
 * Download a file from Telegram to blob via the server-side proxy
 */
export async function downloadFromTelegram(
    fileId: string,
    onProgress?: UploadProgressCallback
): Promise<{
    success: boolean;
    blob?: Blob;
    error?: string;
}> {
    try {
        const downloadUrl = `/api/telegram/stream?fileId=${encodeURIComponent(fileId)}`;
        const response = await fetch(downloadUrl);

        if (!response.ok) {
            return {
                success: false,
                error: `Download failed: ${response.status}`,
            };
        }

        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;

        const reader = response.body?.getReader();
        if (!reader) {
            const blob = await response.blob();
            return { success: true, blob };
        }

        let received = 0;
        const chunks: Uint8Array[] = [];

        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            chunks.push(value);
            received += value.length;

            if (onProgress && total > 0) {
                onProgress((received / total) * 100);
            }
        }
        // Convert Uint8Array chunks to Blob (cast to any to avoid type issues)
        const blob = new Blob(chunks as unknown as BlobPart[]);
        return { success: true, blob };
    } catch (error: any) {
        console.error('Telegram download error:', error);
        return {
            success: false,
            error: error.message || 'Download failed',
        };
    }
}

/**
 * Delete a message from Telegram (to remove file)
 * Note: This only works within 48 hours of upload.
 * Proxied through server-side endpoint.
 */
export async function deleteFromTelegram(_messageId: number): Promise<boolean> {
    // Telegram itself keeps the bytes; HCloud's source of truth for what a user
    // can see is the Firestore record, which IS deleted. Reclaiming Telegram
    // storage would need a server-side endpoint holding the bot token.
    return false;
}
