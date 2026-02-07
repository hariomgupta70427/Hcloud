import { useState, useCallback } from 'react';
import { smartUploadToTelegram, MAX_FILE_SIZE, TelegramUploadResult } from '@/services/telegramService';
import { uploadFileClientSide, MAX_FILE_SIZE as MAX_CLIENT_FILE_SIZE, isClientUploadAvailable } from '@/services/telegramClientUpload';
import { addFileRecord } from '@/services/fileService';
import { useAuthStore } from '@/stores/authStore';
import { useFileStore } from '@/stores/fileStore';
import { toast } from 'sonner';

// Maximum file sizes
const MAX_MANAGED_FILE_SIZE = 50 * 1024 * 1024; // 50MB for Bot API (managed)
const MAX_BYOD_FILE_SIZE = MAX_CLIENT_FILE_SIZE; // 4GB for client-side MTProto (BYOD)

export interface UploadingFile {
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
    cancelUpload: (index: number) => void;
    clearCompleted: () => void;
}

export function useUpload(): UseUploadReturn {
    const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
    const { user } = useAuthStore();
    const { currentFolder, loadFiles } = useFileStore();

    const isUploading = uploadingFiles.some(f => f.status === 'uploading' || f.status === 'pending');

    // Determine if user is BYOD with valid session
    const isBYOD = user?.storageMode === 'byod' && !!user?.byodConfig?.telegramSession;
    const maxFileSize = isBYOD ? MAX_BYOD_FILE_SIZE : MAX_MANAGED_FILE_SIZE;

    const updateFile = useCallback((index: number, updates: Partial<UploadingFile>) => {
        setUploadingFiles(files =>
            files.map((f, i) => (i === index ? { ...f, ...updates } : f))
        );
    }, []);

    const uploadSingleFile = useCallback(async (
        file: File,
        index: number
    ): Promise<TelegramUploadResult> => {
        // Check file size based on storage mode
        if (file.size > maxFileSize) {
            const sizeMB = Math.round(maxFileSize / (1024 * 1024));
            const sizeStr = sizeMB >= 1000 ? `${(sizeMB / 1000).toFixed(1)}GB` : `${sizeMB}MB`;
            return {
                success: false,
                error: `File too large. Maximum size is ${sizeStr}`,
            };
        }

        updateFile(index, { status: 'uploading', progress: 0 });

        // Use client-side upload for BYOD users
        if (isBYOD && user?.byodConfig?.telegramSession) {
            console.log('[useUpload] Using client-side GramJS upload for BYOD');

            if (!isClientUploadAvailable()) {
                return {
                    success: false,
                    error: 'Client-side upload not configured. Missing API credentials.',
                };
            }

            try {
                const result = await uploadFileClientSide(
                    file,
                    user.byodConfig.telegramSession,
                    (progress) => updateFile(index, { progress })
                );

                return {
                    success: result.success,
                    fileId: result.fileId,
                    error: result.error,
                };
            } catch (error: any) {
                console.error('[useUpload] Client upload error:', error);
                return {
                    success: false,
                    error: error.message || 'Client-side upload failed',
                };
            }
        } else {
            // Managed: Upload via Bot API
            console.log('[useUpload] Using Bot API upload for managed storage');
            return await smartUploadToTelegram(file, (progress) => {
                updateFile(index, { progress });
            });
        }
    }, [updateFile, isBYOD, user, maxFileSize]);

    // Generate thumbnail for images
    const createThumbnail = async (file: File): Promise<string | undefined> => {
        if (!file.type.startsWith('image/')) return undefined;

        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
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

                canvas.width = width;
                canvas.height = height;
                ctx?.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.onerror = () => resolve(undefined);
            img.src = URL.createObjectURL(file);
        });
    };

    // Generate thumbnail for videos
    const createVideoThumbnail = async (file: File): Promise<string | undefined> => {
        if (!file.type.startsWith('video/')) return undefined;

        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;

            video.onloadedmetadata = () => {
                video.currentTime = 1; // Seek to 1s
            };

            video.onseeked = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    // Max dimensions 320x180 (16:9ish)
                    const maxSize = 320;
                    let width = video.videoWidth;
                    let height = video.videoHeight;
                    const aspect = width / height;

                    if (width > maxSize) {
                        width = maxSize;
                        height = width / aspect;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx?.drawImage(video, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.7));
                } catch (e) {
                    console.warn('Video thumbnail capture failed', e);
                    resolve(undefined);
                } finally {
                    video.remove();
                }
            };

            video.onerror = () => {
                video.remove();
                resolve(undefined);
            };

            video.src = URL.createObjectURL(file);
        });
    };

    const uploadFiles = useCallback(async (files: File[]) => {
        console.log('[useUpload] uploadFiles called with', files.length, 'files');
        console.log('[useUpload] Storage mode:', user?.storageMode, 'BYOD:', isBYOD);
        console.log('[useUpload] Max file size:', maxFileSize / (1024 * 1024), 'MB');

        if (!user) {
            console.log('[useUpload] No user, showing error toast');
            toast.error('Please sign in to upload files');
            return;
        }

        // Initialize all files as pending
        const newFiles: UploadingFile[] = files.map(file => ({
            file,
            progress: 0,
            status: 'pending',
        }));

        setUploadingFiles(prev => [...prev, ...newFiles]);
        const startIndex = uploadingFiles.length;

        // Upload each file sequentially
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const index = startIndex + i;

            try {
                const result = await uploadSingleFile(file, index);

                // Generate thumbnail
                let thumbnail: string | undefined;
                try {
                    if (file.type.startsWith('image/')) {
                        thumbnail = await createThumbnail(file);
                    } else if (file.type.startsWith('video/')) {
                        thumbnail = await createVideoThumbnail(file);
                    }
                } catch (e) {
                    console.warn('Thumbnail generation failed', e);
                }

                if (result.success && result.fileId) {
                    // Save to Firestore with thumbnail
                    await addFileRecord({
                        name: file.name,
                        mimeType: file.type || 'application/octet-stream',
                        size: file.size,
                        telegramFileId: result.fileId,
                        parentId: currentFolder,
                        userId: user.id,
                        thumbnail: thumbnail
                    });

                    updateFile(index, {
                        status: 'success',
                        progress: 100,
                        fileId: result.fileId,
                    });

                    toast.success(`Uploaded ${file.name}`);
                } else {
                    updateFile(index, {
                        status: 'error',
                        error: result.error || 'Upload failed',
                    });
                    toast.error(`Failed to upload ${file.name}: ${result.error}`);
                }
            } catch (error: any) {
                updateFile(index, {
                    status: 'error',
                    error: error.message || 'Upload failed',
                });
                toast.error(`Failed to upload ${file.name}`);
            }
        }

        // Refresh file list
        if (user) {
            loadFiles(user.id, currentFolder);
        }
    }, [user, isBYOD, maxFileSize, currentFolder, uploadSingleFile, updateFile, uploadingFiles.length, loadFiles]);

    const cancelUpload = useCallback((index: number) => {
        // Remove the file from the upload queue
        setUploadingFiles(files => files.filter((_, i) => i !== index));
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
