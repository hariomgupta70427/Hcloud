import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, AlertTriangle } from 'lucide-react';

interface DeleteConfirmDialogProps {
    isOpen: boolean;
    fileName: string;
    isFolder?: boolean;
    itemCount?: number; // For bulk delete
    onClose: () => void;
    onConfirm: () => void;
    isLoading?: boolean;
}

export function DeleteConfirmDialog({
    isOpen,
    fileName,
    isFolder = false,
    itemCount,
    onClose,
    onConfirm,
    isLoading = false,
}: DeleteConfirmDialogProps) {
    const isBulk = itemCount && itemCount > 1;
    const itemType = isFolder ? 'folder' : 'file';

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
                        className="w-full max-w-sm bg-card rounded-2xl border border-border shadow-xl"
                    >
                        {/* Icon */}
                        <div className="pt-6 pb-4 flex justify-center">
                            <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
                                <Trash2 size={32} className="text-destructive" />
                            </div>
                        </div>

                        {/* Content */}
                        <div className="px-6 pb-4 text-center space-y-2">
                            <h2 className="text-xl font-semibold text-foreground">
                                {isBulk
                                    ? `Delete ${itemCount} items?`
                                    : `Delete ${itemType}?`
                                }
                            </h2>

                            {!isBulk && (
                                <p className="text-muted-foreground">
                                    <span className="font-medium text-foreground">{fileName}</span>
                                </p>
                            )}

                            <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/5 text-left mt-4">
                                <AlertTriangle size={18} className="text-destructive flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-muted-foreground">
                                    {isFolder
                                        ? 'This will delete the folder and all its contents. This action cannot be undone.'
                                        : 'This item will be moved to trash. You can restore it within 30 days.'
                                    }
                                </p>
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 p-4 border-t border-border">
                            <button
                                onClick={onClose}
                                disabled={isLoading}
                                className="flex-1 px-4 py-3 rounded-xl border border-border hover:bg-muted transition-colors font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={onConfirm}
                                disabled={isLoading}
                                className="flex-1 px-4 py-3 rounded-xl bg-destructive text-white hover:bg-destructive/90 transition-colors font-medium disabled:opacity-50"
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Deleting...
                                    </span>
                                ) : (
                                    'Delete'
                                )}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
