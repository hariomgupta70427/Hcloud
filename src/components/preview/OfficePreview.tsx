import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, ExternalLink, Download, FileText, Loader2 } from 'lucide-react';

interface OfficePreviewProps {
    src: string;
    title?: string;
    onClose: () => void;
    onDownload?: () => void;
}

export function OfficePreview({
    src,
    title = 'Document',
    onClose,
    onDownload,
}: OfficePreviewProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    // Google Docs Viewer URL
    const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(src)}&embedded=true`;

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex flex-col bg-black/95"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-black/50 border-b border-white/10">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/20">
                        <FileText size={20} className="text-blue-400" />
                    </div>
                    <span className="text-white font-medium truncate max-w-xs">{title}</span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => window.open(src, '_blank')}
                        className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                        title="Open original"
                    >
                        <ExternalLink size={20} />
                    </button>

                    {onDownload && (
                        <button
                            onClick={onDownload}
                            className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                            title="Download"
                        >
                            <Download size={20} />
                        </button>
                    )}

                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden relative bg-white">
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
                        <div className="flex flex-col items-center gap-3">
                            <Loader2 className="w-8 h-8 text-primary animate-spin" />
                            <p className="text-sm text-gray-500">Loading document preview...</p>
                        </div>
                    </div>
                )}

                {error ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                        <FileText size={64} className="text-gray-300 mb-4" />
                        <h3 className="text-xl font-medium text-gray-900 mb-2">Cannot preview document</h3>
                        <p className="text-gray-500 max-w-md mx-auto mb-6">
                            This document type might not be supported by the viewer or the file might be private.
                        </p>
                        <button
                            onClick={() => window.open(src, '_blank')}
                            className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                        >
                            Download File
                        </button>
                    </div>
                ) : (
                    <iframe
                        src={viewerUrl}
                        className="w-full h-full border-0"
                        onLoad={() => setLoading(false)}
                        onError={() => {
                            setLoading(false);
                            setError(true);
                        }}
                        title={title}
                    />
                )}
            </div>
        </motion.div>
    );
}
