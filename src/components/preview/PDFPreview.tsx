import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import {
    X,
    Download,
    ZoomIn,
    ZoomOut,
    FileText,
    ExternalLink
} from 'lucide-react';

interface PDFPreviewProps {
    src: string;
    title?: string;
    onClose: () => void;
    onDownload?: () => void;
}

export function PDFPreview({
    src,
    title = 'PDF Document',
    onClose,
    onDownload,
}: PDFPreviewProps) {
    const [scale, setScale] = useState(1);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleZoomIn = () => setScale(s => Math.min(3, s + 0.1));
    const handleZoomOut = () => setScale(s => Math.max(0.5, s - 0.1));
    const handleOpenInNewTab = () => window.open(src, '_blank');

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
                    <div className="p-2 rounded-lg bg-red-500/20">
                        <FileText size={20} className="text-red-400" />
                    </div>
                    <span className="text-white font-medium truncate max-w-xs">{title}</span>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleZoomOut}
                        className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                        title="Zoom out"
                    >
                        <ZoomOut size={20} />
                    </button>
                    <span className="text-white/70 text-sm w-12 text-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <button
                        onClick={handleZoomIn}
                        className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                        title="Zoom in"
                    >
                        <ZoomIn size={20} />
                    </button>

                    <div className="w-px h-6 bg-white/10 mx-2" />

                    <button
                        onClick={handleOpenInNewTab}
                        className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                        title="Open in new tab"
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
            <div className="flex-1 overflow-auto bg-zinc-900 p-4 flex items-center justify-center relative">
                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    </div>
                )}

                <iframe
                    src={src}
                    className="w-full h-full bg-white rounded-lg shadow-2xl"
                    style={{
                        transform: `scale(${scale})`,
                        transformOrigin: 'top center',
                        maxWidth: '100%',
                        height: '100%',
                        border: 'none'
                    }}
                    onLoad={() => setLoading(false)}
                    title={title}
                />
            </div>
        </motion.div>
    );
}
