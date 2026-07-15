import { useState, useCallback } from 'react';
import { toast } from 'sonner';
import { FileItem } from '@/services/fileService';
import { useAuthStore } from '@/stores/authStore';
import { getFileFromTelegram, getManagedStreamUrl } from '@/services/telegramService';
import { downloadBYODFile, getByodStreamUrl } from '@/services/chunkedUploadService';
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

        // ── Build a direct STREAM URL for every previewable type ──
        //   • Managed → Vercel Bot-API proxy (same-origin, honours Range).
        //   • BYOD    → Render /token-stream (gramjs lives there; honours Range).
        //     A short-lived encrypted token carries the session, so the raw
        //     session never lands in a URL/log. This is TRUE streaming: the
        //     <video>/<audio>/<img>/pdf element fetches bytes on demand, no
        //     full-file blob download first.
        const streamable = previewType === 'audio' || previewType === 'video'
            || previewType === 'image' || previewType === 'pdf' || previewType === 'office';

        if (streamable) {
            let streamUrl: string | undefined;
            if (isByod) {
                setIsLoadingPreview(true);
                streamUrl = await getByodStreamUrl(file.telegramMessageId!, user!.byodConfig!.telegramSession!);
                setIsLoadingPreview(false);
                if (!streamUrl) {
                    toast.error('Failed to prepare stream');
                    return;
                }
            } else {
                streamUrl = `${window.location.origin}${getManagedStreamUrl(file.telegramFileId)}`;
            }

            setPreviewFile({
                id: file.id,
                name: file.name,
                url: streamUrl,
                type: previewType,
                mimeType: file.mimeType,
            });
            return;
        }

        // ── Non-streamable (code / unknown): fetch the bytes, then render ──
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
                // Stream from Render via a short-lived encrypted token (no session in URL).
                const streamUrl = await getByodStreamUrl(file.telegramMessageId, user.byodConfig.telegramSession);
                if (!streamUrl) {
                    toast.error('Failed to prepare download', { id: toastId });
                    return;
                }
                const link = document.createElement('a');
                link.href = streamUrl;
                link.download = file.name;
                link.target = '_blank';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                toast.dismiss(toastId);
                toast.success('Download started');
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
