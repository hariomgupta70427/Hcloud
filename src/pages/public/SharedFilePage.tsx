import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Download, FileText, FileCode, File as FileIcon, Image as ImageIcon,
    Film, Music, AlertCircle, Loader2, Shield, Cloud, CloudOff, ExternalLink,
} from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { FileItem } from '@/services/fileService';
import { getPreviewType, PreviewType } from '@/components/preview/PreviewModal';
import { toast } from 'sonner';

// Bot API getFile only exposes a file_path for files <= 20MB. Larger managed
// files simply cannot be streamed/downloaded through the managed proxy.
const MANAGED_LIMIT = 20 * 1024 * 1024;

const TYPE_META: Record<PreviewType, { icon: typeof FileIcon; label: string }> = {
    image: { icon: ImageIcon, label: 'Image' },
    video: { icon: Film, label: 'Video' },
    audio: { icon: Music, label: 'Audio' },
    pdf: { icon: FileText, label: 'PDF Document' },
    office: { icon: FileText, label: 'Office Document' },
    code: { icon: FileCode, label: 'Code / Text' },
    unknown: { icon: FileIcon, label: 'File' },
};

function formatSize(bytes?: number): string {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

type MediaState = 'loading' | 'ready' | 'error';

export default function SharedFilePage() {
    const { id } = useParams<{ id: string }>();
    const [file, setFile] = useState<FileItem | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);

    // Password state
    const [password, setPassword] = useState('');
    const [isLocked, setIsLocked] = useState(false);
    const [passwordHash, setPasswordHash] = useState<string | null>(null);

    // Preview state
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [mediaState, setMediaState] = useState<MediaState>('loading');

    useEffect(() => {
        const fetchFile = async () => {
            if (!id) return;
            try {
                const snapshot = await getDoc(doc(db, 'files', id));

                if (!snapshot.exists()) {
                    setError('File not found or access denied');
                    return;
                }

                const data = snapshot.data();

                if (!data.isShared) {
                    setError('This file is not shared publicly.');
                    return;
                }

                if (data.shareSettings?.expiresAt) {
                    const expires = data.shareSettings.expiresAt.toDate();
                    if (new Date() > expires) {
                        setError('This share link has expired.');
                        return;
                    }
                }

                const fileData = { id: snapshot.id, ...data } as FileItem;
                setFile(fileData);

                if (data.shareSettings?.password) {
                    setPasswordHash(data.shareSettings.password);
                    setIsLocked(true);
                } else {
                    loadPreviewUrl(fileData);
                }
            } catch (err) {
                console.error(err);
                setError('Error loading file. You may need permission.');
            } finally {
                setLoading(false);
            }
        };

        fetchFile();
    }, [id]);

    // Build the managed stream URL for previewable types. BYOD and oversized
    // managed files are handled inline in the preview area (no URL set).
    const loadPreviewUrl = (fileData: FileItem) => {
        if (!fileData.telegramFileId) return;
        if (fileData.storageType === 'byod') return;
        if ((fileData.size ?? 0) > MANAGED_LIMIT) return;

        const previewable: PreviewType[] = ['image', 'video', 'audio', 'pdf'];
        const type = getPreviewType(fileData.name, fileData.mimeType);
        if (!previewable.includes(type)) return;

        setMediaState('loading');
        setPreviewUrl(`/api/telegram/stream?fileId=${encodeURIComponent(fileData.telegramFileId)}`);
    };

    const handleDownload = () => {
        if (!file?.telegramFileId) return;

        if (file.storageType === 'byod') {
            toast.error('This file lives on the owner’s Telegram and can’t be downloaded from a public link.');
            return;
        }
        if ((file.size ?? 0) > MANAGED_LIMIT) {
            toast.error('Files larger than 20MB can’t be served through the managed bot.');
            return;
        }

        setDownloading(true);
        try {
            const link = document.createElement('a');
            link.href = `/api/telegram/stream?fileId=${encodeURIComponent(file.telegramFileId)}`;
            link.download = file.name;
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            toast.success('Download started');
        } catch {
            toast.error('Download error');
        } finally {
            setDownloading(false);
        }
    };

    const checkPassword = () => {
        if (!passwordHash) return;
        // SHA-256 hash comparison
        crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
            .then(hashBuffer => {
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                if (hashHex === passwordHash) {
                    setIsLocked(false);
                    if (file) loadPreviewUrl(file);
                } else {
                    toast.error('Incorrect password');
                }
            })
            .catch(() => {
                toast.error('Verification failed');
            });
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <span className="text-sm text-muted-foreground">Loading shared file...</span>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card p-8 rounded-2xl border border-border shadow-xl max-w-md w-full text-center"
                >
                    <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-foreground mb-2">Access Denied</h1>
                    <p className="text-muted-foreground mb-6">{error}</p>
                    <Link to="/auth" className="text-primary hover:underline">Go to HCloud</Link>
                </motion.div>
            </div>
        );
    }

    if (isLocked) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card p-8 rounded-2xl border border-border shadow-xl max-w-md w-full text-center"
                >
                    <Shield className="w-12 h-12 text-primary mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-foreground mb-2">Protected File</h1>
                    <p className="text-muted-foreground mb-6">Enter password to view this file</p>
                    <input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && checkPassword()}
                        className="w-full px-4 py-3 rounded-xl bg-muted border-2 border-transparent focus:border-primary outline-none mb-4"
                        placeholder="Password"
                        autoFocus
                    />
                    <button
                        onClick={checkPassword}
                        className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-medium"
                    >
                        Unlock
                    </button>
                </motion.div>
            </div>
        );
    }

    const previewType: PreviewType = file ? getPreviewType(file.name, file.mimeType) : 'unknown';
    const TypeIcon = TYPE_META[previewType].icon;
    const isByod = file?.storageType === 'byod';
    const tooLarge = !isByod && (file?.size ?? 0) > MANAGED_LIMIT;
    const downloadAvailable = !!file?.telegramFileId && !isByod && !tooLarge;

    // A tasteful, self-explaining fallback card used whenever inline preview
    // isn't possible (unsupported type, BYOD, oversized, or a media error).
    const FallbackCard = ({ icon: Icon, title, subtitle }: {
        icon: typeof FileIcon; title: string; subtitle: string;
    }) => (
        <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Icon className="w-9 h-9 text-primary" />
            </div>
            <div>
                <p className="font-semibold text-foreground">{title}</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">{subtitle}</p>
            </div>
            {downloadAvailable && (
                <button
                    onClick={handleDownload}
                    disabled={downloading}
                    className="mt-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-all flex items-center gap-2 text-sm font-medium disabled:opacity-50"
                >
                    {downloading ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />}
                    Download to view
                </button>
            )}
        </div>
    );

    const renderPreview = () => {
        if (!file) return null;

        if (isByod) {
            return (
                <FallbackCard
                    icon={CloudOff}
                    title="Preview requires the file owner"
                    subtitle="This file is stored on the owner’s own Telegram account and can only be opened by them."
                />
            );
        }

        if (tooLarge) {
            return (
                <FallbackCard
                    icon={AlertCircle}
                    title="File too large to stream"
                    subtitle="Files over 20MB can’t be served through the managed bot and aren’t available on public links."
                />
            );
        }

        // Media error or unsupported type -> download-to-view fallback.
        if (!previewUrl || mediaState === 'error') {
            return (
                <FallbackCard
                    icon={TypeIcon}
                    title={mediaState === 'error' ? 'Preview couldn’t load' : 'Preview not available'}
                    subtitle={mediaState === 'error'
                        ? 'Something went wrong loading this file. You can still download it.'
                        : 'This file type can’t be previewed in the browser. Download it to view.'}
                />
            );
        }

        return (
            <div className="relative w-full">
                <AnimatePresence>
                    {mediaState === 'loading' && (
                        <motion.div
                            initial={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-10 flex items-center justify-center bg-muted/40 backdrop-blur-sm"
                        >
                            <Loader2 className="w-8 h-8 text-primary animate-spin" />
                        </motion.div>
                    )}
                </AnimatePresence>

                {previewType === 'image' && (
                    <img
                        src={previewUrl}
                        alt={file.name}
                        className="w-full max-h-[600px] object-contain bg-black/[0.02]"
                        onLoad={() => setMediaState('ready')}
                        onError={() => setMediaState('error')}
                    />
                )}

                {previewType === 'video' && (
                    <video
                        src={previewUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full max-h-[600px] bg-black"
                        onLoadedData={() => setMediaState('ready')}
                        onError={() => setMediaState('error')}
                    />
                )}

                {previewType === 'audio' && (
                    <div className="flex flex-col items-center justify-center gap-6 px-6 py-16">
                        <div className="w-24 h-24 rounded-2xl bg-primary/10 flex items-center justify-center">
                            <Music className="w-10 h-10 text-primary" />
                        </div>
                        <audio
                            src={previewUrl}
                            controls
                            preload="metadata"
                            className="w-full max-w-md"
                            onLoadedData={() => setMediaState('ready')}
                            onError={() => setMediaState('error')}
                        />
                    </div>
                )}

                {previewType === 'pdf' && (
                    <iframe
                        src={previewUrl}
                        title={file.name}
                        className="w-full h-[75vh] bg-white"
                        onLoad={() => setMediaState('ready')}
                    />
                )}
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <header className="bg-card/80 backdrop-blur border-b border-border px-4 sm:px-6 py-4 flex items-center justify-between sticky top-0 z-20">
                <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Cloud className="text-primary" size={20} />
                    </div>
                    <span className="font-bold text-xl text-foreground">HCloud</span>
                </div>
                <Link to="/auth" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                    Sign in
                </Link>
            </header>

            <main className="flex-1 container mx-auto px-4 sm:px-6 py-8 sm:py-12 flex justify-center">
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="w-full max-w-4xl flex flex-col gap-6"
                >
                    {/* File meta card */}
                    <div className="bg-card rounded-2xl border border-border shadow-sm p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-5">
                        <div className="w-14 h-14 shrink-0 rounded-2xl bg-primary/10 flex items-center justify-center">
                            <TypeIcon className="w-7 h-7 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h1 className="text-lg sm:text-xl font-bold text-foreground truncate" title={file?.name}>
                                {file?.name}
                            </h1>
                            <p className="text-sm text-muted-foreground mt-0.5">
                                {TYPE_META[previewType].label} &middot; {formatSize(file?.size)} &middot; Shared via HCloud
                            </p>
                        </div>
                        <button
                            onClick={handleDownload}
                            disabled={downloading || !downloadAvailable}
                            title={downloadAvailable ? 'Download file' : 'Download unavailable for this file'}
                            className="w-full sm:w-auto px-6 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-all shadow-lg hover:shadow-primary/25 flex items-center justify-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                        >
                            {downloading ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
                            Download
                        </button>
                    </div>

                    {/* Preview card */}
                    <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
                        {renderPreview()}
                    </div>

                    <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                        <ExternalLink size={12} />
                        <Link to="/auth" className="hover:text-primary transition-colors">
                            Get your own secure cloud storage with HCloud
                        </Link>
                    </p>
                </motion.div>
            </main>
        </div>
    );
}
