// Telegram Bot API Service for file storage
// Uses Telegram as a free unlimited file storage backend

// Get credentials from environment variables - no fallbacks for security
const TELEGRAM_BOT_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = import.meta.env.TELEGRAM_CHAT_ID || '';
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

// Validate required environment variables
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Missing required Telegram environment variables. Check your .env file.');
}
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
 * Upload a file to Telegram
 * Files are sent to a private chat and stored permanently
 */
export async function uploadToTelegram(
    file: File,
    caption?: string,
    onProgress?: UploadProgressCallback
): Promise<TelegramUploadResult> {
    console.log('[Telegram] uploadToTelegram called for:', file.name);
    console.log('[Telegram] Bot Token:', TELEGRAM_BOT_TOKEN ? 'Present' : 'MISSING');
    console.log('[Telegram] Chat ID:', TELEGRAM_CHAT_ID);

    try {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
            console.log('[Telegram] File too large:', file.size);
            return {
                success: false,
                error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
            };
        }

        // Create form data
        const formData = new FormData();
        formData.append('chat_id', TELEGRAM_CHAT_ID);
        formData.append('document', file, file.name);

        if (caption) {
            formData.append('caption', caption);
        }

        // Upload with progress tracking using XMLHttpRequest
        const result = await uploadWithProgress(
            `${TELEGRAM_API_BASE}/sendDocument`,
            formData,
            onProgress
        );

        if (!result.ok) {
            const response = await result.json();
            return {
                success: false,
                error: response.description || 'Upload failed',
            };
        }

        const responseData = await result.json();
        console.log('[Telegram] Response:', JSON.stringify(responseData, null, 2));

        if (!responseData.ok) {
            return {
                success: false,
                error: responseData.description || 'Upload failed',
            };
        }

        // Handle different file types in Telegram response
        // When using sendDocument, audio files may still return document
        // but if API returns audio/video/voice object instead, handle it
        const fileData = responseData.result.document
            || responseData.result.audio
            || responseData.result.video
            || responseData.result.voice
            || responseData.result.video_note;

        if (!fileData) {
            console.error('[Telegram] No file data in response:', responseData);
            return {
                success: false,
                error: 'No file data in response',
            };
        }

        return {
            success: true,
            fileId: fileData.file_id,
            uniqueFileId: fileData.file_unique_id,
            fileName: fileData.file_name || file.name,
            mimeType: fileData.mime_type || file.type,
            fileSize: fileData.file_size || file.size,
            thumbnail: fileData.thumbnail?.file_id,
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
 * Upload a photo to Telegram (compressed)
 */
export async function uploadPhotoToTelegram(
    file: File,
    caption?: string,
    onProgress?: UploadProgressCallback
): Promise<TelegramUploadResult> {
    try {
        const formData = new FormData();
        formData.append('chat_id', TELEGRAM_CHAT_ID);
        formData.append('photo', file, file.name);

        if (caption) {
            formData.append('caption', caption);
        }

        const result = await uploadWithProgress(
            `${TELEGRAM_API_BASE}/sendPhoto`,
            formData,
            onProgress
        );

        if (!result.ok) {
            const response = await result.json();
            return {
                success: false,
                error: response.description || 'Photo upload failed',
            };
        }

        const responseData = await result.json();

        if (!responseData.ok) {
            return {
                success: false,
                error: responseData.description || 'Photo upload failed',
            };
        }

        // Get the largest photo size
        const photos = responseData.result.photo;
        const largestPhoto = photos[photos.length - 1];

        return {
            success: true,
            fileId: largestPhoto.file_id,
            uniqueFileId: largestPhoto.file_unique_id,
            fileName: file.name,
            mimeType: file.type,
            fileSize: largestPhoto.file_size,
        };
    } catch (error: any) {
        console.error('Telegram photo upload error:', error);
        return {
            success: false,
            error: error.message || 'Network error during photo upload',
        };
    }
}

/**
 * Upload a video to Telegram
 */
export async function uploadVideoToTelegram(
    file: File,
    caption?: string,
    onProgress?: UploadProgressCallback
): Promise<TelegramUploadResult> {
    try {
        const formData = new FormData();
        formData.append('chat_id', TELEGRAM_CHAT_ID);
        formData.append('video', file, file.name);

        if (caption) {
            formData.append('caption', caption);
        }

        const result = await uploadWithProgress(
            `${TELEGRAM_API_BASE}/sendVideo`,
            formData,
            onProgress
        );

        if (!result.ok) {
            const response = await result.json();
            return {
                success: false,
                error: response.description || 'Video upload failed',
            };
        }

        const responseData = await result.json();

        if (!responseData.ok) {
            return {
                success: false,
                error: responseData.description || 'Video upload failed',
            };
        }

        const video = responseData.result.video;

        return {
            success: true,
            fileId: video.file_id,
            uniqueFileId: video.file_unique_id,
            fileName: file.name,
            mimeType: video.mime_type,
            fileSize: video.file_size,
            thumbnail: video.thumbnail?.file_id,
        };
    } catch (error: any) {
        console.error('Telegram video upload error:', error);
        return {
            success: false,
            error: error.message || 'Network error during video upload',
        };
    }
}

/**
 * Get file info and download URL from Telegram
 */
export async function getFileFromTelegram(fileId: string): Promise<{
    success: boolean;
    downloadUrl?: string;
    fileInfo?: TelegramFileInfo;
    error?: string;
}> {
    try {
        const response = await fetch(`${TELEGRAM_API_BASE}/getFile?file_id=${fileId}`);
        const data = await response.json();

        if (!data.ok) {
            return {
                success: false,
                error: data.description || 'Failed to get file info',
            };
        }

        const fileInfo: TelegramFileInfo = data.result;
        const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

        return {
            success: true,
            downloadUrl,
            fileInfo,
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
 * Download a file from Telegram to blob
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
        const fileResult = await getFileFromTelegram(fileId);

        if (!fileResult.success || !fileResult.downloadUrl) {
            return {
                success: false,
                error: fileResult.error || 'Failed to get download URL',
            };
        }

        // Download with progress
        const response = await fetch(fileResult.downloadUrl);

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
 * Note: This only works within 48 hours of upload
 */
export async function deleteFromTelegram(messageId: number): Promise<boolean> {
    try {
        const response = await fetch(
            `${TELEGRAM_API_BASE}/deleteMessage?chat_id=${TELEGRAM_CHAT_ID}&message_id=${messageId}`,
            { method: 'POST' }
        );
        const data = await response.json();
        return data.ok;
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

/**
 * Helper function for upload with progress tracking
 */
function uploadWithProgress(
    url: string,
    formData: FormData,
    onProgress?: UploadProgressCallback
): Promise<Response> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (event) => {
            if (event.lengthComputable && onProgress) {
                const progress = (event.loaded / event.total) * 100;
                onProgress(Math.round(progress));
            }
        });

        xhr.addEventListener('load', () => {
            resolve(new Response(xhr.response, {
                status: xhr.status,
                statusText: xhr.statusText,
                headers: new Headers({
                    'Content-Type': 'application/json',
                }),
            }));
        });

        xhr.addEventListener('error', () => {
            reject(new Error('Network error'));
        });

        xhr.addEventListener('abort', () => {
            reject(new Error('Upload aborted'));
        });

        xhr.open('POST', url);
        xhr.responseType = 'text';
        xhr.send(formData);
    });
}
