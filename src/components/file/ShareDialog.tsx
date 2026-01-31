import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Share2, Link, Copy, Check, Lock, Globe, Calendar, ExternalLink } from 'lucide-react';

interface ShareDialogProps {
    isOpen: boolean;
    fileName: string;
    existingLink?: string;
    onClose: () => void;
    onCreateLink: (options: { password?: string; expiresAt?: Date }) => Promise<string>;
    onCopyLink: (link: string) => void;
    isLoading?: boolean;
}

export function ShareDialog({
    isOpen,
    fileName,
    existingLink,
    onClose,
    onCreateLink,
    onCopyLink,
    isLoading = false,
}: ShareDialogProps) {
    const [shareLink, setShareLink] = useState(existingLink || '');
    const [copied, setCopied] = useState(false);
    const [usePassword, setUsePassword] = useState(false);
    const [password, setPassword] = useState('');
    const [useExpiry, setUseExpiry] = useState(false);
    const [expiryDays, setExpiryDays] = useState(7);
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setShareLink(existingLink || '');
            setCopied(false);
        }
    }, [isOpen, existingLink]);

    const handleCreateLink = async () => {
        setIsCreating(true);
        try {
            const expiresAt = useExpiry
                ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000)
                : undefined;
            const link = await onCreateLink({
                password: usePassword ? password : undefined,
                expiresAt,
            });
            setShareLink(link);
        } finally {
            setIsCreating(false);
        }
    };

    const handleCopy = async () => {
        if (shareLink) {
            await navigator.clipboard.writeText(shareLink);
            onCopyLink(shareLink);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
                    onClick={(e) => e.target === e.currentTarget && onClose()}
                >
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="w-full max-w-md bg-card rounded-2xl border border-border shadow-xl"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-primary/10">
                                    <Share2 size={18} className="text-primary" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-foreground">Share</h2>
                                    <p className="text-sm text-muted-foreground truncate max-w-[200px]">{fileName}</p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-4 space-y-4">
                            {/* Link display */}
                            {shareLink ? (
                                <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                        <Globe size={16} className="text-green-500" />
                                        <span className="text-sm text-muted-foreground">Anyone with the link can view</span>
                                    </div>

                                    <div className="flex gap-2">
                                        <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-muted text-sm">
                                            <Link size={16} className="text-muted-foreground flex-shrink-0" />
                                            <span className="truncate text-foreground">{shareLink}</span>
                                        </div>
                                        <button
                                            onClick={handleCopy}
                                            className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
                                        >
                                            {copied ? <Check size={18} /> : <Copy size={18} />}
                                            <span>{copied ? 'Copied!' : 'Copy'}</span>
                                        </button>
                                    </div>

                                    <button
                                        onClick={() => window.open(shareLink, '_blank')}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-muted transition-colors text-sm"
                                    >
                                        <ExternalLink size={16} />
                                        Open link
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* Options */}
                                    <div className="space-y-3">
                                        {/* Password protection */}
                                        <label className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 cursor-pointer transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={usePassword}
                                                onChange={(e) => setUsePassword(e.target.checked)}
                                                className="w-5 h-5 rounded border-border accent-primary"
                                            />
                                            <Lock size={18} className="text-muted-foreground" />
                                            <div className="flex-1">
                                                <span className="text-sm font-medium text-foreground">Password protection</span>
                                                <p className="text-xs text-muted-foreground">Require password to access</p>
                                            </div>
                                        </label>

                                        {usePassword && (
                                            <input
                                                type="password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                placeholder="Enter password"
                                                className="w-full px-4 py-3 rounded-xl bg-muted border-2 border-transparent focus:border-primary outline-none"
                                            />
                                        )}

                                        {/* Expiry */}
                                        <label className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/50 cursor-pointer transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={useExpiry}
                                                onChange={(e) => setUseExpiry(e.target.checked)}
                                                className="w-5 h-5 rounded border-border accent-primary"
                                            />
                                            <Calendar size={18} className="text-muted-foreground" />
                                            <div className="flex-1">
                                                <span className="text-sm font-medium text-foreground">Set expiration</span>
                                                <p className="text-xs text-muted-foreground">Link expires after set time</p>
                                            </div>
                                        </label>

                                        {useExpiry && (
                                            <select
                                                value={expiryDays}
                                                onChange={(e) => setExpiryDays(Number(e.target.value))}
                                                className="w-full px-4 py-3 rounded-xl bg-muted border-2 border-transparent focus:border-primary outline-none"
                                            >
                                                <option value={1}>1 day</option>
                                                <option value={7}>7 days</option>
                                                <option value={30}>30 days</option>
                                                <option value={90}>90 days</option>
                                            </select>
                                        )}
                                    </div>

                                    {/* Create button */}
                                    <button
                                        onClick={handleCreateLink}
                                        disabled={isCreating}
                                        className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
                                    >
                                        {isCreating ? (
                                            <span className="flex items-center justify-center gap-2">
                                                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                Creating link...
                                            </span>
                                        ) : (
                                            <span className="flex items-center justify-center gap-2">
                                                <Link size={18} />
                                                Create share link
                                            </span>
                                        )}
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex gap-3 p-4 border-t border-border">
                            <button
                                onClick={onClose}
                                className="flex-1 px-4 py-3 rounded-xl border border-border hover:bg-muted transition-colors font-medium"
                            >
                                {shareLink ? 'Done' : 'Cancel'}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
