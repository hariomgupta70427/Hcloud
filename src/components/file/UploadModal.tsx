import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { UploadZone } from '@/components/file/UploadZone';
import { UploadingFile } from '@/hooks/useUpload';

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
    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => !isUploading && onClose()}
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            backdropFilter: 'blur(4px)',
                            zIndex: 9998,
                        }}
                    />

                    {/* Modal */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        style={{
                            position: 'fixed',
                            top: '50%',
                            left: '50%',
                            transform: 'translate(-50%, -50%)',
                            zIndex: 9999,
                            width: '90%',
                            maxWidth: '500px',
                            maxHeight: '80vh',
                            overflowY: 'auto',
                            padding: '24px',
                            borderRadius: '16px',
                            backgroundColor: 'var(--card, #1a1a1a)',
                            border: '1px solid var(--border, #333)',
                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                        }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-foreground">Upload Files</h2>
                            <button
                                onClick={() => !isUploading && onClose()}
                                className="p-2 rounded-lg hover:bg-muted transition-colors"
                                disabled={isUploading}
                            >
                                <X size={20} className="text-muted-foreground" />
                            </button>
                        </div>

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
                                            <p className="text-sm font-medium truncate">{item.file.name}</p>
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

                        {/* Footer */}
                        <div className="mt-4 flex justify-end gap-2">
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
                                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                            >
                                {isUploading ? 'Uploading...' : 'Close'}
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
