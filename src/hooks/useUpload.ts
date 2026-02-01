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

    const uploadFiles = useCallback(async (files: File[]) => {
        console.log('[useUpload] uploadFiles called with', files.length, 'files');

        if (!user) {
            console.log('[useUpload] No user, showing error toast');
            toast.error('Please sign in to upload files');
            return;
        }

        console.log('[useUpload] User:', user.id);

        // Initialize all files as pending
        const newFiles: UploadingFile[] = files.map(file => ({
            file,
            progress: 0,
            status: 'pending',
        }));

        setUploadingFiles(prev => [...prev, ...newFiles]);
        const startIndex = uploadingFiles.length;

        // Upload each file sequentially (Telegram has rate limits)
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const index = startIndex + i;

            try {
                const result = await uploadSingleFile(file, index);

                if (result.success && result.fileId) {
                    // Save file metadata to Firestore
                    console.log('[useUpload] Telegram upload success, saving to Firestore...');
                    console.log('[useUpload] File data:', {
                        name: file.name,
                        mimeType: file.type,
                        size: file.size,
                        telegramFileId: result.fileId,
                        parentId: currentFolder,
                        userId: user.id,
                    });

                    try {
                        await addFileRecord({
                            name: file.name,
                            mimeType: file.type || 'application/octet-stream',
                            size: file.size,
                            telegramFileId: result.fileId,
                            parentId: currentFolder,
                            userId: user.id,
                        });
                        console.log('[useUpload] Firestore save successful for:', file.name);
                    } catch (firestoreError: any) {
                        console.error('[useUpload] Firestore save failed:', firestoreError);
                        throw firestoreError;
                    }

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
