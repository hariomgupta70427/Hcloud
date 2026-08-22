import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { FileItem } from '@/services/fileService';
import { useAuthStore } from '@/stores/authStore';
import { getManagedStreamUrl, getManagedDownloadUrl } from '@/services/telegramService';
import { downloadBYODFile, getByodStreamUrl } from '@/services/chunkedUploadService';
import { getPreviewType, PreviewFile } from '@/components/preview/PreviewModal';

/**
 * Shared file-action hook.
 *
 * This centralises the "open / preview / download" pipeline so every page
 * (Files, Starred, Recent, Shared, Dashboard) uses the exact same, correct
 * logic instead of each re-implementing (or omitting) it.
 */
export function useFileActions(options?: { onOpenFolder?: (file: FileItem) => void }) {
    const { user } = useAuthStore();
    const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);

    // Blob URLs pin their entire contents in memory until revoked. Previewing a
    // few large files used to leak hundreds of megabytes for the rest of the
    // session, so every blob URL we mint is tracked and released.
    const blobUrls = useRef<Set<string>>(new Set());

    const releaseBlobs = useCallback(() => {
        for (const url of blobUrls.current) URL.revokeObjectURL(url);
        blobUrls.current.clear();
    }, []);

    useEffect(() => releaseBlobs, [releaseBlobs]);

    const closePreview = useCallback(() => {
        setPreviewFile(null);
        releaseBlobs();
    }, [releaseBlobs]);

    // Open a file: navigate folders, stream media, or blob-load other types.
    const openFile = useCallback(async (file: FileItem) => {
        if (file.type === 'folder') {
            options?.onOpenFolder?.(file);
            return;
        }

        if (!file.telegramFileId) {
            toast.error('File is not available');
            return;
        }

        const previewType = getPreviewType(file.name, file.mimeType);
        const isByod = file.storageType === 'byod';

        // A BYOD file needs both a message id and the user's session to be
        // retrievable. Say which one is missing rather than failing silently.
        if (isByod) {
            if (!file.telegramMessageId) {
                toast.error('This file is missing its Telegram reference and cannot be opened.');
                return;
            }
            if (!user?.byodConfig?.telegramSession) {
                toast.error('Reconnect your Telegram account in Settings to open this file.');
                return;
            }
        }

        // ── Build a direct STREAM URL for every previewable type ──
        //   • Managed → Vercel Bot-API proxy (same-origin, honours Range).
        //   • BYOD    → relay /token-stream (gramjs lives there; honours Range).
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
                try {
                    streamUrl = await getByodStreamUrl(
                        file.telegramMessageId!,
                        user!.byodConfig!.telegramSession!
                    ) ?? undefined;
                } finally {
                    setIsLoadingPreview(false);
                }
                if (!streamUrl) {
                    toast.error('Could not prepare the stream. Please try again.');
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
                const result = await downloadBYODFile(
                    file.telegramMessageId!,
                    user!.byodConfig!.telegramSession!
                );
                if (result.success && result.blobUrl) {
                    downloadUrl = result.blobUrl;
                    blobUrls.current.add(result.blobUrl);
                } else {
                    toast.error(result.error || 'Failed to load file', { id: 'file-loading' });
                    return;
                }
            } else {
                downloadUrl = getManagedStreamUrl(file.telegramFileId);
            }

            // For code files, fetch the text so CodePreview can render it.
            let textContent: string | undefined;
            if (previewType === 'code') {
                try {
                    const textRes = await fetch(downloadUrl);
                    if (textRes.ok) {
                        textContent = await textRes.text();
                    } else {
                        toast.error('Failed to load file contents', { id: 'file-loading' });
                        return;
                    }
                } catch (err) {
                    console.warn('Failed to fetch code content:', err);
                    toast.error('Failed to load file contents', { id: 'file-loading' });
                    return;
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
        } catch (error) {
            console.error('Failed to load file:', error);
            toast.error('Failed to load file', { id: 'file-loading' });
        } finally {
            setIsLoadingPreview(false);
        }
    }, [user, options]);

    // Download a file directly to the user's device.
    //
    // Both paths ask the SERVER for `Content-Disposition: attachment`. The `<a
    // download>` attribute alone is not enough: browsers ignore it for
    // cross-origin URLs, which is why BYOD "downloads" previously just opened
    // the file in a new tab and started playing it.
    const downloadFile = useCallback(async (file: FileItem) => {
        if (file.type === 'folder' || !file.telegramFileId) return;

        const toastId = toast.loading(`Preparing download: ${file.name}`);
        try {
            let url: string | undefined;

            if (file.storageType === 'byod') {
                if (!file.telegramMessageId || !user?.byodConfig?.telegramSession) {
                    toast.error('Reconnect your Telegram account to download this file.', { id: toastId });
                    return;
                }
                url = await getByodStreamUrl(
                    file.telegramMessageId,
                    user.byodConfig.telegramSession,
                    { forDownload: true }
                ) ?? undefined;
                if (!url) {
                    toast.error('Failed to prepare download', { id: toastId });
                    return;
                }
            } else {
                url = getManagedDownloadUrl(file.telegramFileId, file.name);
            }

            triggerBrowserDownload(url, file.name);
            toast.success('Download started', { id: toastId });
        } catch (e) {
            console.error('Download failed:', e);
            toast.error('Download failed', { id: toastId });
        }
    }, [user]);

    // Download the currently-previewed file (from within the modal).
    const downloadPreviewFile = useCallback((pf: PreviewFile) => {
        try {
            // A preview URL is an inline stream URL; adding download=1 turns it
            // into an attachment without needing to mint a new token.
            const url = pf.url.startsWith('blob:')
                ? pf.url
                : `${pf.url}${pf.url.includes('?') ? '&' : '?'}download=1`;
            triggerBrowserDownload(url, pf.name);
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

/** Click a temporary <a> to start a download without navigating the page away. */
function triggerBrowserDownload(url: string, fileName: string) {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName; // honoured for same-origin and blob: URLs
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
