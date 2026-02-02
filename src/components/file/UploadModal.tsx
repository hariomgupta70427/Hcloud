import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { UploadZone } from '@/components/file/UploadZone';
import { UploadingFile } from '@/hooks/useUpload';
import { createPortal } from 'react-dom';

interface UploadModalProps {
    isOpen: boolean;
    onClose: () => void;
    onFilesSelected: (files: FileList) => void;
    uploadingFiles: UploadingFile[];
    isUploading: boolean;
    onClearCompleted: () => void;
}

export function UploadModal({
    isOpen,
    onClose,
    onFilesSelected,
    uploadingFiles,
    isUploading,
    onClearCompleted,
}: UploadModalProps) {
    // Use portal to render modal at document body level
    // This ensures the modal is not affected by any parent container styling
    const modalContent = (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop - covers entire screen */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => !isUploading && onClose()}
                        className="fixed inset-0 bg-black/80 backdrop-blur-sm"
                        style={{ zIndex: 99998 }}
                    />

                        /* Modal Container - centered using flexbox */
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 flex items-center justify-center p-4 !m-0 !inset-0"
                        style={{ zIndex: 99999, pointerEvents: 'none' }}
                    >
                        {/* Modal Content */}
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 20 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl overflow-hidden relative"
                            onClick={(e) => e.stopPropagation()}
                            style={{ pointerEvents: 'auto', margin: 'auto' }}
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                                <h2 className="text-xl font-semibold text-foreground">Upload Files</h2>
                                <button
                                    onClick={() => !isUploading && onClose()}
                                    className="p-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50"
                                    disabled={isUploading}
                                >
                                    <X size={20} className="text-muted-foreground" />
                                </button>
                            </div>

                            {/* Body */}
                            <div className="p-6">
                                {/* Upload Zone */}
                                <UploadZone onFilesSelected={onFilesSelected} />

                                {/* Upload Progress */}
                                {uploadingFiles.length > 0 && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        className="mt-4 space-y-2 max-h-48 overflow-y-auto"
                                    >
                                        {uploadingFiles.map((item, index) => (
                                            <div
                                                key={`${item.file.name}-${index}`}
                                                className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                                            >
                                                {item.status === 'uploading' && (
                                                    <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
                                                )}
                                                {item.status === 'success' && (
                                                    <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                                                )}
                                                {item.status === 'error' && (
                                                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                                                )}
                                                {item.status === 'pending' && (
                                                    <div className="w-4 h-4 rounded-full border-2 border-muted-foreground flex-shrink-0" />
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium truncate text-foreground">{item.file.name}</p>
                                                    {item.status === 'uploading' && (
                                                        <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                                                            <motion.div
                                                                className="h-full bg-primary rounded-full"
                                                                initial={{ width: 0 }}
                                                                animate={{ width: `${item.progress}%` }}
                                                            />
                                                        </div>
                                                    )}
                                                    {item.status === 'error' && (
                                                        <p className="text-xs text-red-500">{item.error}</p>
                                                    )}
                                                </div>
                                                <span className="text-xs text-muted-foreground flex-shrink-0">
                                                    {item.status === 'uploading' ? `${item.progress}%` : ''}
                                                </span>
                                            </div>
                                        ))}
                                    </motion.div>
                                )}
                            </div>

                            {/* Footer */}
                            <div className="flex justify-end gap-2 px-6 py-4 border-t border-border bg-muted/30">
                                {uploadingFiles.some(f => f.status === 'success' || f.status === 'error') && (
                                    <button
                                        onClick={onClearCompleted}
                                        className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        Clear Completed
                                    </button>
                                )}
                                <button
                                    onClick={onClose}
                                    disabled={isUploading}
                                    className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                                >
                                    {isUploading ? 'Uploading...' : 'Done'}
                                </button>
                            </div>
                        </motion.div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );

    // Use createPortal to render at document body level
    // This ensures the modal is always centered on screen
    if (typeof document !== 'undefined') {
        return createPortal(modalContent, document.body);
    }

    return null;
}
