import { useState, useCallback } from 'react';
import { smartUploadToTelegram, MAX_FILE_SIZE, TelegramUploadResult } from '@/services/telegramService';
import { addFileRecord } from '@/services/fileService';
import { useAuthStore } from '@/stores/authStore';
import { useFileStore } from '@/stores/fileStore';
import { toast } from 'sonner';

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

    const updateFile = useCallback((index: number, updates: Partial<UploadingFile>) => {
        setUploadingFiles(files =>
            files.map((f, i) => (i === index ? { ...f, ...updates } : f))
        );
    }, []);

    const uploadSingleFile = useCallback(async (
        file: File,
        index: number
    ): Promise<TelegramUploadResult> => {
        // Check file size
        if (file.size > MAX_FILE_SIZE) {
            return {
                success: false,
                error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
            };
        }

        updateFile(index, { status: 'uploading', progress: 0 });

        // Upload to Telegram with progress
        const result = await smartUploadToTelegram(file, (progress) => {
            updateFile(index, { progress });
        });

        return result;
    }, [updateFile]);

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

    const uploadFiles = useCallback(async (files: File[]) => {
        console.log('[useUpload] uploadFiles called with', files.length, 'files');

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

                // Generate thumbnail if image
                let thumbnail: string | undefined;
                try {
                    thumbnail = await createThumbnail(file);
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
    }, [user, currentFolder, uploadSingleFile, updateFile, uploadingFiles.length, loadFiles]);

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
