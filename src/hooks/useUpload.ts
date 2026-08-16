import { useState, useCallback } from 'react';
import { smartUploadToTelegram, TelegramUploadResult } from '@/services/telegramService';
import { uploadFileChunked } from '@/services/chunkedUploadService';
import { addFileRecord } from '@/services/fileService';
import { useAuthStore } from '@/stores/authStore';
import { useFileStore } from '@/stores/fileStore';
import { getFileCategory, resolveMimeType } from '@/lib/fileTypes';
import { toast } from 'sonner';

// Maximum file sizes.
// MANAGED: the Vercel function receives the file base64-encoded inside a JSON
// body, which inflates it by ~33%, and the body parser caps at 55MB. So the
// real ceiling is ~40MB of original bytes, not the 50MB the Bot API allows.
// Advertising 50MB here caused 41-50MB files to pass this check and then die
// with an opaque HTTP 413 at the edge.
const MAX_MANAGED_FILE_SIZE = 40 * 1024 * 1024; // 40MB (base64 + JSON overhead safe)
const MAX_BYOD_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB for BYOD (via chunked server upload)

// The Bot API's getFile only returns a download path for files <= 20MB, so a
// larger MANAGED file uploads fine but can never be streamed or downloaded
// again. Warn instead of silently creating an unusable file.
const MANAGED_STREAMABLE_LIMIT = 20 * 1024 * 1024;

export interface UploadingFile {
    /** Stable identity — never rely on array position, which shifts as rows are cleared. */
    id: string;
    file: File;
    progress: number;
    status: 'pending' | 'uploading' | 'success' | 'error';
    error?: string;
    fileId?: string;
}

export interface UseUploadReturn {
    uploadingFiles: UploadingFile[];
    isUploading: boolean;
    uploadFiles: (files: File[]) => Promise<void>;
    cancelUpload: (id: string) => void;
    clearCompleted: () => void;
}

let uploadRowSeq = 0;
function nextRowId(): string {
    uploadRowSeq += 1;
    return `row_${Date.now()}_${uploadRowSeq}`;
}

export function useUpload(): UseUploadReturn {
    const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
    const { user } = useAuthStore();
    const { currentFolder, loadFiles } = useFileStore();

    const isUploading = uploadingFiles.some(f => f.status === 'uploading' || f.status === 'pending');

    // Determine if user is BYOD with valid session
    const isBYOD = user?.storageMode === 'byod' && !!user?.byodConfig?.telegramSession;
    const maxFileSize = isBYOD ? MAX_BYOD_FILE_SIZE : MAX_MANAGED_FILE_SIZE;

    // Address rows by stable id rather than array index. The old index-based
    // version wrote progress to the wrong row whenever a second batch of files
    // was added while the first was still uploading.
    const updateFile = useCallback((id: string, updates: Partial<UploadingFile>) => {
        setUploadingFiles(files =>
            files.map(f => (f.id === id ? { ...f, ...updates } : f))
        );
    }, []);

    const uploadSingleFile = useCallback(async (
        file: File,
        rowId: string,
        mimeType: string
    ): Promise<TelegramUploadResult & { messageId?: number }> => {
        // Check file size based on storage mode
        if (file.size > maxFileSize) {
            const sizeMB = Math.round(maxFileSize / (1024 * 1024));
            const sizeStr = sizeMB >= 1000 ? `${(sizeMB / 1000).toFixed(1)}GB` : `${sizeMB}MB`;
            return {
                success: false,
                error: isBYOD
                    ? `File too large. Maximum size is ${sizeStr}`
                    : `File too large. Managed storage supports up to ${sizeStr} — connect your own Telegram account to upload up to 2GB.`,
            };
        }

        updateFile(rowId, { status: 'uploading', progress: 0 });

        // BYOD users: upload via the Render server (browser -> Render -> Telegram).
        // A datacenter server is required because many networks (ISPs) block
        // direct browser->Telegram MTProto connections. Render keeps a warm,
        // pooled Telegram client so this is fast once the server is awake.
        if (isBYOD && user?.byodConfig?.telegramSession) {
            console.log(`[useUpload] BYOD upload via Render: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
            try {
                const result = await uploadFileChunked(
                    file,
                    user.byodConfig.telegramSession,
                    (progress) => {
                        updateFile(rowId, { progress: progress.percent });
                    },
                    mimeType
                );

                return {
                    success: result.success,
                    fileId: result.fileId,
                    messageId: result.messageId,
                    error: result.error,
                };
            } catch (error: any) {
                console.error('[useUpload] BYOD upload error:', error);
                return {
                    success: false,
                    error: error.message || 'Upload failed',
                };
            }
        } else {
            // Managed: Upload via Bot API
            console.log('[useUpload] Managed upload via Bot API');
            return await smartUploadToTelegram(file, (progress) => {
                updateFile(rowId, { progress });
            }, mimeType);
        }
    }, [updateFile, isBYOD, user, maxFileSize]);


    // Generate thumbnail for images
    const createThumbnail = async (file: File): Promise<string | undefined> => {
        return new Promise((resolve) => {
            const objectUrl = URL.createObjectURL(file);
            const done = (value: string | undefined) => {
                URL.revokeObjectURL(objectUrl); // never leak the blob
                resolve(value);
            };
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    // Max dimensions 128x128
                    const maxSize = 128;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxSize) {
                            height *= maxSize / width;
                            width = maxSize;
                        }
                    } else {
                        if (height > maxSize) {
                            width *= maxSize / height;
                            height = maxSize;
                        }
                    }

                    canvas.width = Math.max(1, Math.round(width));
                    canvas.height = Math.max(1, Math.round(height));
                    ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                    done(canvas.toDataURL('image/jpeg', 0.7));
                } catch {
                    // Tainted canvas or unsupported codec — a missing thumbnail
                    // is cosmetic, so never fail the upload over it.
                    done(undefined);
                }
            };
            img.onerror = () => done(undefined);
            img.src = objectUrl;
        });
    };

    // Generate thumbnail for videos
    const createVideoThumbnail = async (file: File): Promise<string | undefined> => {
        return new Promise((resolve) => {
            const objectUrl = URL.createObjectURL(file);
            let settled = false;
            const video = document.createElement('video');

            const done = (value: string | undefined) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                URL.revokeObjectURL(objectUrl);
                video.removeAttribute('src');
                video.remove();
                resolve(value);
            };

            // A container the browser cannot decode (e.g. some .mkv) fires
            // neither onseeked nor onerror, which used to hang the upload
            // forever. Cap the attempt.
            const timeout = setTimeout(() => done(undefined), 8000);

            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;

            video.onloadedmetadata = () => {
                // Seek slightly into the file, but never past its end.
                const target = Number.isFinite(video.duration) && video.duration > 1 ? 1 : 0;
                try {
                    video.currentTime = target;
                } catch {
                    done(undefined);
                }
            };

            video.onseeked = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const maxSize = 320;
                    let width = video.videoWidth;
                    let height = video.videoHeight;
                    if (!width || !height) return done(undefined);

                    const aspect = width / height;
                    if (width > maxSize) {
                        width = maxSize;
                        height = width / aspect;
                    }

                    canvas.width = Math.max(1, Math.round(width));
                    canvas.height = Math.max(1, Math.round(height));
                    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
                    done(canvas.toDataURL('image/jpeg', 0.7));
                } catch (e) {
                    console.warn('Video thumbnail capture failed', e);
                    done(undefined);
                }
            };

            video.onerror = () => done(undefined);
            video.src = objectUrl;
        });
    };

    const uploadFiles = useCallback(async (files: File[]) => {
        if (!user) {
            toast.error('Please sign in to upload files');
            return;
        }
        if (files.length === 0) return;

        console.log(`[useUpload] ${files.length} file(s), mode=${user.storageMode}, BYOD=${isBYOD}`);

        // Each row gets a stable id up front so progress always lands on the
        // right row regardless of what else is in the queue.
        const newRows: UploadingFile[] = files.map(file => ({
            id: nextRowId(),
            file,
            progress: 0,
            status: 'pending',
        }));

        setUploadingFiles(prev => [...prev, ...newRows]);

        for (const row of newRows) {
            const { file, id: rowId } = row;

            // Resolve the real MIME type ONCE, from the filename when the
            // browser gave us nothing useful. Everything downstream (Telegram
            // attributes, stream Content-Type, library filters) depends on it.
            const mimeType = resolveMimeType(file.name, file.type);
            const category = getFileCategory(file.name, mimeType);

            // A managed file over 20MB can be uploaded but never retrieved,
            // because Bot API getFile refuses files that large. Say so before
            // the user waits through the upload.
            if (!isBYOD && file.size > MANAGED_STREAMABLE_LIMIT) {
                const msg = 'Managed storage cannot play or download files over 20MB. Connect your own Telegram account to store large media.';
                updateFile(rowId, { status: 'error', error: msg });
                toast.error(`${file.name}: ${msg}`);
                continue;
            }

            try {
                const result = await uploadSingleFile(file, rowId, mimeType);

                if (!result.success) {
                    updateFile(rowId, { status: 'error', error: result.error || 'Upload failed' });
                    toast.error(`Failed to upload ${file.name}: ${result.error || 'Unknown error'}`);
                    continue;
                }

                // A "successful" upload with no identifier is unusable — the
                // bytes are in Telegram but nothing can ever address them.
                // Previously this fell through both branches silently, so the
                // file simply never appeared and no error was shown.
                if (!result.fileId) {
                    const msg = 'Upload finished but Telegram returned no file id. Please try again.';
                    updateFile(rowId, { status: 'error', error: msg });
                    toast.error(`${file.name}: ${msg}`);
                    continue;
                }

                // BYOD retrieval is keyed on the message id — without it the
                // file can never be streamed or downloaded.
                if (isBYOD && !result.messageId) {
                    const msg = 'Upload finished but Telegram returned no message id. Please try again.';
                    updateFile(rowId, { status: 'error', error: msg });
                    toast.error(`${file.name}: ${msg}`);
                    continue;
                }

                // Thumbnails are best-effort and must never block or fail an upload.
                let thumbnail: string | undefined;
                try {
                    if (category === 'image') {
                        thumbnail = await createThumbnail(file);
                    } else if (category === 'video') {
                        thumbnail = await createVideoThumbnail(file);
                    }
                } catch (e) {
                    console.warn('Thumbnail generation failed', e);
                }

                await addFileRecord({
                    name: file.name,
                    mimeType,
                    size: file.size,
                    telegramFileId: result.fileId,
                    telegramMessageId: result.messageId,
                    storageType: isBYOD ? 'byod' : 'managed',
                    parentId: currentFolder,
                    userId: user.id,
                    thumbnail,
                });

                updateFile(rowId, { status: 'success', progress: 100, fileId: result.fileId });
                toast.success(`Uploaded ${file.name}`);
            } catch (error: any) {
                console.error(`[useUpload] ${file.name} failed:`, error);
                updateFile(rowId, {
                    status: 'error',
                    error: error?.message || 'Upload failed',
                });
                toast.error(`Failed to upload ${file.name}`);
            }
        }

        // Refresh file list
        loadFiles(user.id, currentFolder);
    }, [user, isBYOD, currentFolder, uploadSingleFile, updateFile, loadFiles]);

    const cancelUpload = useCallback((id: string) => {
        setUploadingFiles(files => files.filter(f => f.id !== id));
    }, []);

    const clearCompleted = useCallback(() => {
        setUploadingFiles(files =>
            files.filter(f => f.status !== 'success' && f.status !== 'error')
        );
    }, []);

    return {
        uploadingFiles,
        isUploading,
        uploadFiles,
        cancelUpload,
        clearCompleted,
    };
}
