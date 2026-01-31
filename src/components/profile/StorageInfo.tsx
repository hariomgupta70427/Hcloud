import { motion } from 'framer-motion';
import { Infinity as InfinityIcon, HardDrive, TrendingUp } from 'lucide-react';

interface StorageInfoProps {
    usedBytes: number;
    totalBytes?: number; // undefined for unlimited
    fileCount: number;
    storageMode: 'managed' | 'byod';
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function StorageInfo({ usedBytes, totalBytes, fileCount, storageMode }: StorageInfoProps) {
    const isUnlimited = !totalBytes;
    const percentage = isUnlimited ? 0 : Math.min((usedBytes / totalBytes) * 100, 100);

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
                    <h3 className="font-semibold text-foreground">Storage</h3>
                    <p className="text-sm text-muted-foreground">
                        {storageMode === 'managed' ? 'Managed by HCloud' : 'Your own server'}
                    </p>
                </div>
            </div>

            {/* Storage bar */}
            <div className="space-y-3">
                {isUnlimited ? (
                    <div className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20">
                        <InfinityIcon size={24} className="text-primary" />
                        <div>
                            <p className="font-semibold text-foreground">Unlimited Storage</p>
                            <p className="text-sm text-muted-foreground">
                                {formatBytes(usedBytes)} used across {fileCount} files
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="h-3 bg-muted rounded-full overflow-hidden">
                            <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${percentage}%` }}
                                transition={{ duration: 0.5, ease: 'easeOut' }}
                                className={`h-full rounded-full ${percentage > 90
                                        ? 'bg-destructive'
                                        : percentage > 70
                                            ? 'bg-yellow-500'
                                            : 'bg-primary'
                                    }`}
                            />
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">
                                {formatBytes(usedBytes)} of {formatBytes(totalBytes)} used
                            </span>
                            <span className="font-medium text-foreground">
                                {percentage.toFixed(1)}%
                            </span>
                        </div>
                    </>
                )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 mt-6">
                <div className="p-4 rounded-xl bg-muted/50">
                    <p className="text-2xl font-bold text-foreground">{fileCount}</p>
                    <p className="text-sm text-muted-foreground">Total files</p>
                </div>
                <div className="p-4 rounded-xl bg-muted/50">
                    <p className="text-2xl font-bold text-foreground">{formatBytes(usedBytes)}</p>
                    <p className="text-sm text-muted-foreground">Used storage</p>
                </div>
            </div>

            {!isUnlimited && percentage > 80 && (
                <div className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                    <TrendingUp size={16} className="text-yellow-600" />
                    <p className="text-sm text-yellow-600">
                        You're running low on storage. Consider upgrading your plan.
                    </p>
                </div>
            )}
        </motion.div>
    );
}
