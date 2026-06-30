// Telegram Bot API Service for file storage
// All Bot API calls are proxied through /api/telegram/* serverless functions
// so the bot token NEVER appears in the client bundle.

// Max file sizes for Telegram Bot API
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB for regular uploads
export const MAX_DOCUMENT_SIZE = 2000 * 1024 * 1024; // 2 GB for documents via URL

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
 * Upload a file to Telegram via the server-side proxy.
 * The bot token is only on the server.
 */
export async function uploadToTelegram(
    file: File,
    caption?: string,
    onProgress?: UploadProgressCallback
): Promise<TelegramUploadResult> {
    try {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
            return {
                success: false,
                error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
            };
        }

        // Convert file to base64 for JSON transport
        if (onProgress) onProgress(10);
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        if (onProgress) onProgress(30);

        // Send to our server-side proxy
        const response = await fetch('/api/telegram/managed-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileBase64: base64,
                fileName: file.name,
                mimeType: file.type || 'application/octet-stream',
                method: 'sendDocument',
            }),
        });

        if (onProgress) onProgress(90);

        const result = await response.json();

        if (!response.ok || !result.success) {
            return {
                success: false,
                error: result.error || 'Upload failed',
            };
        }

        if (onProgress) onProgress(100);

        return {
            success: true,
            fileId: result.fileId,
            uniqueFileId: result.uniqueFileId,
            fileName: result.fileName || file.name,
            mimeType: result.mimeType || file.type,
            fileSize: result.fileSize || file.size,
            thumbnail: result.thumbnail,
        };
    } catch (error: any) {
        console.error('Telegram upload error:', error);
        return {
            success: false,
            error: error.message || 'Network error during upload',
        };
    }
}

/**
 * Upload a photo to Telegram (compressed) via server proxy
 */
export async function uploadPhotoToTelegram(
    file: File,
    caption?: string,
    onProgress?: UploadProgressCallback
): Promise<TelegramUploadResult> {
    try {
        if (onProgress) onProgress(10);
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        if (onProgress) onProgress(30);

        const response = await fetch('/api/telegram/managed-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileBase64: base64,
                fileName: file.name,
                mimeType: file.type,
                method: 'sendPhoto',
            }),
        });

        if (onProgress) onProgress(90);
        const result = await response.json();

        if (!response.ok || !result.success) {
            return { success: false, error: result.error || 'Photo upload failed' };
        }

        if (onProgress) onProgress(100);
        return {
            success: true,
            fileId: result.fileId,
            uniqueFileId: result.uniqueFileId,
            fileName: file.name,
            mimeType: result.mimeType || file.type,
            fileSize: result.fileSize || file.size,
        };
    } catch (error: any) {
        console.error('Telegram photo upload error:', error);
        return { success: false, error: error.message || 'Network error during photo upload' };
    }
}

/**
 * Upload a video to Telegram via server proxy
 */
export async function uploadVideoToTelegram(
    file: File,
    caption?: string,
    onProgress?: UploadProgressCallback
): Promise<TelegramUploadResult> {
    try {
        if (onProgress) onProgress(10);
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
            new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        if (onProgress) onProgress(30);

        const response = await fetch('/api/telegram/managed-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileBase64: base64,
                fileName: file.name,
                mimeType: file.type,
                method: 'sendVideo',
            }),
        });

        if (onProgress) onProgress(90);
        const result = await response.json();

        if (!response.ok || !result.success) {
            return { success: false, error: result.error || 'Video upload failed' };
        }

        if (onProgress) onProgress(100);
        return {
            success: true,
            fileId: result.fileId,
            uniqueFileId: result.uniqueFileId,
            fileName: file.name,
            mimeType: result.mimeType || file.type,
            fileSize: result.fileSize || file.size,
            thumbnail: result.thumbnail,
        };
    } catch (error: any) {
        console.error('Telegram video upload error:', error);
        return { success: false, error: error.message || 'Network error during video upload' };
    }
}

/**
 * Get file info and download URL from Telegram.
 * Uses the server-side stream proxy — no bot token needed client-side.
 */
export async function getFileFromTelegram(fileId: string): Promise<{
    success: boolean;
    downloadUrl?: string;
    fileInfo?: TelegramFileInfo;
    error?: string;
}> {
    try {
        // Use the server-side stream proxy as the download URL
        // The stream endpoint handles getFile + download internally
        const downloadUrl = `/api/telegram/stream?fileId=${encodeURIComponent(fileId)}`;

        return {
            success: true,
            downloadUrl,
        };
    } catch (error: any) {
        console.error('Telegram getFile error:', error);
        return {
            success: false,
            error: error.message || 'Network error',
        };
    }
}

/**
 * Get a streaming URL for managed (Bot API) audio/video files.
 * Uses the Vercel proxy at /api/telegram/stream so the browser can
 * play media directly without downloading the full blob first.
 */
export function getManagedStreamUrl(fileId: string): string {
    return `/api/telegram/stream?fileId=${encodeURIComponent(fileId)}`;
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
export async function deleteFromTelegram(messageId: number): Promise<boolean> {
    try {
        // TODO: Create /api/telegram/delete endpoint for server-side delete
        // For now, deletion from Telegram is not critical — Firestore record is removed
        console.warn('deleteFromTelegram: server-side delete endpoint not yet implemented');
        return false;
    } catch {
        return false;
    }
}

/**
 * Smart upload based on file type
 */
export async function smartUploadToTelegram(
    file: File,
    onProgress?: UploadProgressCallback
): Promise<TelegramUploadResult> {
    // Use specific upload method based on file type for better handling
    if (file.type.startsWith('image/') && file.size < 10 * 1024 * 1024) {
        // Use photo upload for images under 10MB (will be compressed)
        return uploadPhotoToTelegram(file, undefined, onProgress);
    } else if (file.type.startsWith('video/')) {
        // Use video upload for better video handling
        return uploadVideoToTelegram(file, undefined, onProgress);
    } else {
        // Use document upload for everything else
        return uploadToTelegram(file, undefined, onProgress);
    }
}
