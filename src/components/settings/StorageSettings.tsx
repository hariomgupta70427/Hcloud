import { motion } from 'framer-motion';
import { HardDrive, Cloud, Server, ArrowRight, Info, CheckCircle } from 'lucide-react';

interface StorageSettingsProps {
    currentMode: 'managed' | 'byod';
    isVerified?: boolean;
    onSwitchMode?: () => void;
    onConnect?: () => void;
}

export function StorageSettings({ currentMode, isVerified = false, onSwitchMode, onConnect }: StorageSettingsProps) {
    const isByod = currentMode === 'byod';

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-2xl bg-card border border-border"
        >
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-primary/10">
                    <HardDrive size={20} className="text-primary" />
                </div>
                <div>
                    <h3 className="font-semibold text-foreground">Storage Mode</h3>
                    <p className="text-sm text-muted-foreground">Choose how your files are stored</p>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                {/* Managed Storage */}
                <div
                    className={`relative p-5 rounded-xl border-2 transition-colors ${!isByod
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30'
                        }`}
                >
                    {!isByod && (
                        <div className="absolute top-3 right-3">
                            <CheckCircle size={20} className="text-primary" />
                        </div>
                    )}
                    <div className="flex items-center gap-3 mb-3">
                        <div className={`p-2 rounded-lg ${!isByod ? 'bg-primary/10' : 'bg-muted'}`}>
                            <Cloud size={20} className={!isByod ? 'text-primary' : 'text-muted-foreground'} />
                        </div>
                        <span className="font-semibold text-foreground">Managed Storage</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                        HCloud manages your storage. Simple, reliable, and no setup required.
                    </p>
                    <ul className="space-y-2 text-sm">
                        <li className="flex items-center gap-2 text-muted-foreground">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                            Unlimited storage capacity
                        </li>
                        <li className="flex items-center gap-2 text-muted-foreground">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                            Automatic backups
                        </li>
                        <li className="flex items-center gap-2 text-muted-foreground">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                            Zero configuration
                        </li>
                    </ul>
                </div>

                {/* BYOD Storage */}
                <div
                    className={`relative p-5 rounded-xl border-2 transition-colors ${isByod
                        ? 'border-green-500 bg-green-500/5'
                        : 'border-border hover:border-green-500/30'
                        }`}
                >
                    {isByod && (
                        <div className="absolute top-3 right-3">
                            <CheckCircle size={20} className="text-green-500" />
                        </div>
                    )}
                    <div className="flex items-center gap-3 mb-3">
                        <div className={`p-2 rounded-lg ${isByod ? 'bg-green-500/10' : 'bg-muted'}`}>
                            <Server size={20} className={isByod ? 'text-green-500' : 'text-muted-foreground'} />
                        </div>
                        <span className="font-semibold text-foreground">Own Server</span>
                        <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 text-xs font-medium">
                            Advanced
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                        Use your own infrastructure. Full control over your data storage.
                    </p>
                    <ul className="space-y-2 text-sm">
                        <li className="flex items-center gap-2 text-muted-foreground">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Complete data ownership
                        </li>
                        <li className="flex items-center gap-2 text-muted-foreground">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Custom storage location
                        </li>
                        <li className="flex items-center gap-2 text-muted-foreground">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            Requires phone verification
                        </li>
                    </ul>

                    {isByod && (
                        <div className="mt-4 flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <span className={`px-2 py-1 rounded-lg text-xs font-medium ${isVerified
                                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                                    : 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400'
                                    }`}>
                                    {isVerified ? '✓ Verified' : '⚠ Verification pending'}
                                </span>
                            </div>

                            {!isVerified && onConnect && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onConnect(); }}
                                    className="mt-2 w-full px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
                                >
                                    Connect Telegram
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Info box */}
            <div className="mt-4 flex items-start gap-3 p-4 rounded-xl bg-muted/50">
                <Info size={18} className="text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                    <p>
                        Switching storage modes will not delete your existing files.
                        Your current files will remain accessible until you migrate them.
                    </p>
                </div>
            </div>

            {/* Switch button */}
            {onSwitchMode && (
                <button
                    onClick={onSwitchMode}
                    className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-border hover:bg-muted transition-colors text-sm font-medium"
                >
                    Switch to {isByod ? 'Managed Storage' : 'Own Server'}
                    <ArrowRight size={16} />
                </button>
            )}
        </motion.div>
    );
}
