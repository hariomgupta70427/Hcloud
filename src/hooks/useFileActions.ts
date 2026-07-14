import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { FileItem } from '@/services/fileService';
import { useAuthStore } from '@/stores/authStore';
import { getFileFromTelegram, getManagedStreamUrl } from '@/services/telegramService';
import { downloadBYODFile } from '@/services/chunkedUploadService';
import { getPreviewType, PreviewFile } from '@/components/preview/PreviewModal';

/**
 * Shared file-action hook.
 *
 * This centralises the "open / preview / download" pipeline so every page
 * (Files, Starred, Recent, Shared, Dashboard) uses the exact same, correct
 * logic instead of each re-implementing (or omitting) it. Previously only
 * FilesPage had a working preview pipeline; the secondary pages had no
 * onClick wiring at all, so nothing opened.
 */
export function useFileActions(options?: { onOpenFolder?: (file: FileItem) => void }) {
    const { user } = useAuthStore();
    const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);

    const closePreview = useCallback(() => setPreviewFile(null), []);

    // Open a file: navigate folders, stream media, or blob-load other types.
    const openFile = useCallback(async (file: FileItem) => {
        if (file.type === 'folder') {
            options?.onOpenFolder?.(file);
            return;
        }

        if (!file.telegramFileId) {
            toast.error('File not available');
            return;
        }

        const previewType = getPreviewType(file.name, file.mimeType);
        const isByod = file.storageType === 'byod' && !!file.telegramMessageId && !!user?.byodConfig?.telegramSession;

        // ── Managed streamed types: audio / video (native player) and office
        //    (Google Docs Viewer, which needs a PUBLIC ABSOLUTE URL). BYOD files
        //    do NOT stream through Vercel — gramjs only runs reliably on the
        //    dedicated Render server — so BYOD (any type) takes the blob path.
        if (!isByod && (previewType === 'audio' || previewType === 'video' || previewType === 'office')) {
            setPreviewFile({
                id: file.id,
                name: file.name,
                url: `${window.location.origin}${getManagedStreamUrl(file.telegramFileId)}`,
                type: previewType,
                mimeType: file.mimeType,
            });
            return;
        }

        // ── Everything else: fetch a blob URL first ──
        //   - BYOD: download via the Render server (persistent gramjs).
        //   - Managed non-media: same-origin stream proxy URL.
        setIsLoadingPreview(true);
        toast.loading('Loading file...', { id: 'file-loading' });

        try {
            let downloadUrl: string | undefined;

            if (isByod) {
                const result = await downloadBYODFile(file.telegramMessageId!, user!.byodConfig!.telegramSession!);
                if (result.success && result.blobUrl) {
                    downloadUrl = result.blobUrl;
                } else {
                    toast.error(result.error || 'Failed to load file', { id: 'file-loading' });
                    setIsLoadingPreview(false);
                    return;
                }
            } else {
                const result = await getFileFromTelegram(file.telegramFileId);
                if (result.success && result.downloadUrl) {
                    downloadUrl = result.downloadUrl;
                }
            }

            if (downloadUrl) {
                // For code files, fetch the text so CodePreview can render it.
                let textContent: string | undefined;
                if (previewType === 'code') {
                    try {
                        const textRes = await fetch(downloadUrl);
                        if (textRes.ok) {
                            textContent = await textRes.text();
                        }
                    } catch (err) {
                        console.warn('Failed to fetch code content:', err);
                    }
                }

                setPreviewFile({
                    id: file.id,
                    name: file.name,
                    url: downloadUrl,
                    type: previewType,
                    mimeType: file.mimeType,
                    content: textContent,
                });
                toast.dismiss('file-loading');
            } else {
                toast.error('Failed to load file', { id: 'file-loading' });
            }
        } catch (error) {
            console.error('Failed to load file:', error);
            toast.error('Failed to load file', { id: 'file-loading' });
        } finally {
            setIsLoadingPreview(false);
        }
    }, [user, options]);

    // Download a file directly to the user's device.
    const downloadFile = useCallback(async (file: FileItem) => {
        if (file.type === 'folder' || !file.telegramFileId) return;

        const toastId = toast.loading(`Preparing download: ${file.name}`);
        try {
            if (file.storageType === 'byod' && file.telegramMessageId && user?.byodConfig?.telegramSession) {
                const result = await downloadBYODFile(file.telegramMessageId, user.byodConfig.telegramSession);
                if (result.success && result.blobUrl) {
                    const link = document.createElement('a');
                    link.href = result.blobUrl;
                    link.download = file.name;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(result.blobUrl!), 30000);
                    toast.dismiss(toastId);
                    toast.success('Download started');
                } else {
                    toast.error(result.error || 'Failed to download', { id: toastId });
                }
            } else {
                const result = await getFileFromTelegram(file.telegramFileId);
                if (result.success && result.downloadUrl) {
                    const link = document.createElement('a');
                    link.href = result.downloadUrl;
                    link.download = file.name;
                    link.target = '_blank';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    toast.dismiss(toastId);
                    toast.success('Download started');
                } else {
                    toast.error('Failed to get download link', { id: toastId });
                }
            }
        } catch (e) {
            toast.error('Download failed', { id: toastId });
        }
    }, [user]);

    // Download the currently-previewed file (from within the modal).
    const downloadPreviewFile = useCallback((pf: PreviewFile) => {
        try {
            const link = document.createElement('a');
            link.href = pf.url;
            link.download = pf.name;
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            toast.success(`Downloading ${pf.name}`);
        } catch (error) {
            console.error('Download failed:', error);
            toast.error('Download failed');
        }
    }, []);

    return {
        previewFile,
        isLoadingPreview,
        openFile,
        downloadFile,
        downloadPreviewFile,
        closePreview,
    };
}
