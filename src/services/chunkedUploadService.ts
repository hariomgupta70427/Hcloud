/**
 * Chunked Upload Service for BYOD
 * Splits large files into chunks and uploads via dedicated Render server
 * Used ONLY for files >50MB (to avoid cold start delays for small files)
 */

// Chunk size: 4MB (safe for most servers)
const CHUNK_SIZE = 4 * 1024 * 1024;

// Upload server URL - Render deployment
const UPLOAD_SERVER_URL = import.meta.env.VITE_UPLOAD_SERVER_URL || 'https://hcloud.onrender.com';

const API_CHUNK = `${UPLOAD_SERVER_URL}/upload/chunk`;
const API_FINALIZE = `${UPLOAD_SERVER_URL}/upload/finalize`;

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
        const response = await fetch(API_CHUNK, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
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
        const response = await fetch(API_FINALIZE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
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
 * Read a file chunk as base64
 */
async function readChunkAsBase64(file: File, start: number, end: number): Promise<string> {
    const slice = file.slice(start, end);
    const arrayBuffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Convert to base64
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/**
 * Upload a large file using chunked upload
 * @param file The file to upload
 * @param session Telegram session string
 * @param onProgress Progress callback
 */
export async function uploadFileChunked(
    file: File,
    session: string,
    onProgress?: (progress: UploadProgress) => void
): Promise<ChunkedUploadResult> {
    console.log(`[ChunkedUpload] Starting chunked upload for: ${file.name} (${file.size} bytes)`);

    // Calculate total chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId = generateUploadId();

    console.log(`[ChunkedUpload] File will be split into ${totalChunks} chunks of ${CHUNK_SIZE / 1024 / 1024}MB each`);
    console.log(`[ChunkedUpload] Upload ID: ${uploadId}`);

    // Report initial progress
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

        console.log(`[ChunkedUpload] Uploading chunk ${i + 1}/${totalChunks} (bytes ${start}-${end})`);

        // Read chunk as base64
        const chunkData = await readChunkAsBase64(file, start, end);

        // Upload chunk with retry logic
        let attempts = 0;
        const maxAttempts = 3;
        let result: { success: boolean; error?: string } = { success: false };

        while (attempts < maxAttempts) {
            attempts++;
            result = await uploadChunk(
                uploadId,
                i,
                totalChunks,
                chunkData,
                file.name,
                file.type || 'application/octet-stream',
                session
            );

            if (result.success) {
                break;
            }

            console.warn(`[ChunkedUpload] Chunk ${i} failed (attempt ${attempts}/${maxAttempts}): ${result.error}`);

            if (attempts < maxAttempts) {
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
            }
        }

        if (!result.success) {
            return {
                success: false,
                error: `Failed to upload chunk ${i + 1}: ${result.error}`
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
        console.log(`[ChunkedUpload] Upload complete! MessageId: ${finalResult.messageId}, FileId: ${finalResult.fileId}`);
    }

    return finalResult;
}
