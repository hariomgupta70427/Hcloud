import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Download, FileText, AlertCircle, Loader2, Shield, Cloud, Play } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { FileItem } from '@/services/fileService';
import { getPreviewType } from '@/components/preview/PreviewModal';
import { toast } from 'sonner';

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

    // Preview URL state
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    useEffect(() => {
        const fetchFile = async () => {
            if (!id) return;
            try {
                const docRef = doc(db, 'files', id);
                const snapshot = await getDoc(docRef);

                if (!snapshot.exists()) {
                    setError('File not found or access denied');
                    setLoading(false);
                    return;
                }

                const data = snapshot.data();

                // Check if shared
                if (!data.isShared) {
                    setError('This file is not shared publicly.');
                    setLoading(false);
                    return;
                }

                // Check expiration
                if (data.shareSettings?.expiresAt) {
                    const expires = data.shareSettings.expiresAt.toDate();
                    if (new Date() > expires) {
                        setError('This share link has expired.');
                        setLoading(false);
                        return;
                    }
                }

                const fileData = { id: snapshot.id, ...data } as FileItem;
                setFile(fileData);

                // Check password protection
                if (data.shareSettings?.password) {
                    setPasswordHash(data.shareSettings.password);
                    setIsLocked(true);
                } else {
                    // No password — load preview immediately
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

    const loadPreviewUrl = async (fileData: FileItem) => {
        if (!fileData.telegramFileId) return;

        const previewType = getPreviewType(fileData.name, fileData.mimeType);
        if (previewType === 'audio' || previewType === 'video' || previewType === 'image' || previewType === 'pdf') {
            setLoadingPreview(true);
            try {
                // Managed files: use the server-side stream proxy
                if (fileData.storageType !== 'byod') {
                    const streamUrl = `/api/telegram/stream?fileId=${encodeURIComponent(fileData.telegramFileId)}`;
                    setPreviewUrl(streamUrl);
                }
                // BYOD files cannot be previewed on shared page (no user session available)
            } catch (err) {
                console.error('Failed to load preview:', err);
            } finally {
                setLoadingPreview(false);
            }
        }
    };

    const handleDownload = async () => {
        if (!file?.telegramFileId) return;
        setDownloading(true);
        try {
            if (file.storageType !== 'byod') {
                const streamUrl = `/api/telegram/stream?fileId=${encodeURIComponent(file.telegramFileId)}`;
                const link = document.createElement('a');
                link.href = streamUrl;
                link.download = file.name;
                link.target = '_blank';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                toast.success('Download started');
            } else {
                toast.error('BYOD files cannot be downloaded from shared links');
            }
        } catch (e) {
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
                <div className="bg-card p-8 rounded-2xl border border-border shadow-xl max-w-md w-full text-center">
                    <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
                    <h1 className="text-xl font-bold text-foreground mb-2">Access Denied</h1>
                    <p className="text-muted-foreground mb-6">{error}</p>
                    <Link to="/auth" className="text-primary hover:underline">Go to HCloud</Link>
                </div>
            </div>
        );
    }

    if (isLocked) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
                <div className="bg-card p-8 rounded-2xl border border-border shadow-xl max-w-md w-full text-center">
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
                    />
                    <button
                        onClick={checkPassword}
                        className="w-full py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors font-medium"
                    >
                        Unlock
                    </button>
                </div>
            </div>
        );
    }

    const previewType = file ? getPreviewType(file.name, file.mimeType) : 'unknown';

    return (
        <div className="min-h-screen bg-background flex flex-col">
            <header className="bg-card border-b border-border px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Cloud className="text-primary" />
                    <span className="font-bold text-xl text-foreground">HCloud</span>
                </div>
                <Link to="/auth" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                    Sign in
                </Link>
            </header>

            <main className="flex-1 container mx-auto p-6 flex flex-col items-center">
                <div className="bg-card rounded-2xl border border-border shadow-sm p-8 w-full max-w-4xl flex flex-col items-center text-center">
                    <div className="w-24 h-24 bg-primary/10 rounded-2xl flex items-center justify-center mb-6">
                        <FileText className="w-12 h-12 text-primary" />
                    </div>

                    <h1 className="text-2xl font-bold text-foreground mb-2">{file?.name}</h1>
                    <p className="text-muted-foreground mb-8">
                        {(file?.size ? (file.size / 1024 / 1024).toFixed(2) : '0')} MB • Shared via HCloud
                    </p>

                    <div className="flex gap-4">
                        <button
                            onClick={handleDownload}
                            disabled={downloading}
                            className="px-8 py-3 bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-all shadow-lg hover:shadow-primary/25 flex items-center gap-2 font-medium disabled:opacity-50"
                        >
                            {downloading ? <Loader2 className="animate-spin" size={20} /> : <Download size={20} />}
                            Download File
                        </button>
                    </div>

                    {/* Preview Section */}
                    <div className="mt-12 w-full rounded-xl border border-border overflow-hidden relative bg-muted/30">
                        {loadingPreview && (
                            <div className="flex items-center justify-center h-64">
                                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                            </div>
                        )}

                        {!loadingPreview && previewUrl && previewType === 'image' && (
                            <img
                                src={previewUrl}
                                alt={file?.name}
                                className="w-full max-h-[600px] object-contain"
                                onError={() => setPreviewUrl(null)}
                            />
                        )}

                        {!loadingPreview && previewUrl && previewType === 'video' && (
                            <video
                                src={previewUrl}
                                controls
                                playsInline
                                preload="metadata"
                                className="w-full max-h-[600px]"
                            />
                        )}

                        {!loadingPreview && previewUrl && previewType === 'audio' && (
                            <div className="flex flex-col items-center justify-center p-12 gap-4">
                                <div className="w-24 h-24 rounded-2xl bg-primary/10 flex items-center justify-center">
                                    <Play className="w-10 h-10 text-primary" />
                                </div>
                                <audio
                                    src={previewUrl}
                                    controls
                                    preload="metadata"
                                    className="w-full max-w-md"
                                />
                            </div>
                        )}

                        {!loadingPreview && !previewUrl && previewType !== 'unknown' && (
                            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                <FileText size={48} className="mb-4" />
                                <p>Preview not available for this file type</p>
                                <p className="text-sm mt-1">Download the file to view it</p>
                            </div>
                        )}

                        {!loadingPreview && previewType === 'unknown' && (
                            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                                <FileText size={48} className="mb-4" />
                                <p>Preview not available</p>
                                <p className="text-sm mt-1">Download the file to view it</p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}
