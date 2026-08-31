import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Download, FileText, FileCode, File as FileIcon, Image as ImageIcon,
    Film, Music, AlertCircle, Loader2, Shield, Cloud, CloudOff, ExternalLink,
} from 'lucide-react';
import { getPreviewType, PreviewType } from '@/components/preview/PreviewModal';
import { toast } from 'sonner';

// This page holds no Firebase import at all any more. It used to read the file's
// Firestore document directly, which is what leaked the stream token and the
// password verifier to every visitor. All data now comes from
// /api/telegram/share-resolve, which enforces the password server-side.

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

/** What /api/telegram/share-resolve returns. */
interface ResolvedShare {
    name: string;
    size: number;
    mimeType: string;
    requiresPassword: boolean;
    expiresAt: number;
    streamUrl?: string;
    downloadUrl?: string;
}

export default function SharedFilePage() {
    const [share, setShare] = useState<ResolvedShare | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);

    // Password state. There is no verifier or salt here any more: the password is
    // checked SERVER-SIDE by share-resolve, which returns nothing streamable until
    // it passes. Previously the verifier and the stream token both arrived in the
    // browser from a publicly readable Firestore document, so the gate could be
    // skipped entirely.
    const [password, setPassword] = useState('');
    const [isLocked, setIsLocked] = useState(false);
    const [isCheckingPassword, setIsCheckingPassword] = useState(false);

    // Preview state
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [mediaState, setMediaState] = useState<MediaState>('loading');

    /**
     * The capability lives in the URL fragment. A fragment is never transmitted
     * to a server, so it stays out of access logs and Referer headers — which
     * matters, because the fragment IS the credential.
     */
    const blob = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '';

    /** Single path to the server for both the initial open and the password retry. */
    const resolve = async (pw?: string): Promise<ResolvedShare | null> => {
        const res = await fetch('/api/telegram/share-resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blob, password: pw }),
        });
        const body = await res.json().catch(() => null);

        if (res.status === 401) {
            // Locked, or the supplied password was wrong. The response still
            // carries display metadata but nothing streamable.
            if (body) setShare(body as ResolvedShare);
            setIsLocked(true);
            if (pw) toast.error(body?.error || 'Incorrect password');
            return null;
        }
        if (!res.ok) {
            setError(body?.error || 'This share link is invalid or has expired.');
            return null;
        }

        setIsLocked(false);
        setShare(body as ResolvedShare);
        return body as ResolvedShare;
    };

    useEffect(() => {
        const open = async () => {
            if (!blob) {
                // An old-style link (/s/:id with no fragment) cannot be resolved:
                // the capability is the fragment, and share documents are no
                // longer publicly readable.
                setError('This share link is missing its access key. Ask the owner to re-share the file.');
                setLoading(false);
                return;
            }
            try {
                const resolved = await resolve();
                if (resolved) applyPreview(resolved);
            } catch (err) {
                console.error('Failed to resolve share:', err);
                setError('Could not open this share. Please try again.');
            } finally {
                setLoading(false);
            }
        };
        open();
        // Resolving depends only on the fragment, which does not change in-place.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [blob]);

    /**
     * Use the stream URL the server returned. The page no longer builds URLs
     * itself, because doing so required knowing the Telegram handle — which is
     * exactly what an unauthorised visitor must not receive.
     */
    const applyPreview = (resolved: ResolvedShare) => {
        if (!resolved.streamUrl) return;

        const previewable: PreviewType[] = ['image', 'video', 'audio', 'pdf'];
        const type = getPreviewType(resolved.name, resolved.mimeType);
        if (!previewable.includes(type)) return;

        setMediaState('loading');
        setPreviewUrl(resolved.streamUrl);
    };

    const handleDownload = () => {
        if (!share?.downloadUrl) {
            toast.error('This file is not available for download.');
            return;
        }
        setDownloading(true);
        try {
            const link = document.createElement('a');
            link.href = share.downloadUrl;
            link.download = share.name;
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

    const checkPassword = async () => {
        if (!password) return;
        setIsCheckingPassword(true);
        try {
            const resolved = await resolve(password);
            if (resolved) applyPreview(resolved);
        } catch (err) {
            console.error('Password verification failed:', err);
            toast.error('Verification failed. Please try again.');
        } finally {
            setIsCheckingPassword(false);
        }
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
                        onKeyDown={e => e.key === 'Enter' && !isCheckingPassword && checkPassword()}
                        disabled={isCheckingPassword}
                        className="w-full px-4 py-3 rounded-xl bg-muted border-2 border-transparent focus:border-primary outline-none mb-4 disabled:opacity-60"
                        placeholder="Password"
                        autoFocus
                    />
                    <button
                        onClick={checkPassword}
                        disabled={isCheckingPassword || !password}
                        className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-medium disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                        {/* The check is a server round-trip (scrypt runs there, not
                            here), so show progress or the button feels broken. */}
                        {isCheckingPassword && <Loader2 className="w-4 h-4 animate-spin" />}
                        {isCheckingPassword ? 'Verifying…' : 'Unlock'}
                    </button>
                </motion.div>
            </div>
        );
    }

    const previewType: PreviewType = share ? getPreviewType(share.name, share.mimeType) : 'unknown';
    const TypeIcon = TYPE_META[previewType].icon;
    // The server decides what is servable and simply omits the URLs when it is
    // not. The page no longer re-derives that from storage type or size, which is
    // what let the two disagree.
    const downloadAvailable = !!share?.downloadUrl;

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
        if (!share) return null;

        // Not servable: the resolver returned metadata but no stream URL. That
        // covers account-mode files (no public web path — see ARCHITECTURE-V3 R4)
        // and managed files over the 20 MiB Bot API ceiling.
        if (!share.streamUrl) {
            return (
                <FallbackCard
                    icon={CloudOff}
                    title="Preview not available"
                    subtitle="This file can't be previewed on a public link. Ask the owner to share it through Telegram instead."
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
                        alt={share.name}
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
                        title={share.name}
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
                            <h1 className="text-lg sm:text-xl font-bold text-foreground truncate" title={share?.name}>
                                {share?.name}
                            </h1>
                            <p className="text-sm text-muted-foreground mt-0.5">
                                {TYPE_META[previewType].label} &middot; {formatSize(share?.size)} &middot; Shared via HCloud
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
