import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import {
    X,
    Download,
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    ZoomOut,
    FileText
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
    const [numPages, setNumPages] = useState<number>(0);
    const [currentPage, setCurrentPage] = useState(1);
    const [scale, setScale] = useState(1);
    const [loading, setLoading] = useState(true);

    // For now, we'll use an iframe embed. For better control, install react-pdf
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 2));
    const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col bg-black/95"
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
                    {/* Zoom controls */}
                    <button
                        onClick={handleZoomOut}
                        className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                        title="Zoom out"
                    >
                        <ZoomOut size={20} />
                    </button>
                    <span className="text-white text-sm min-w-[4rem] text-center">
                        {Math.round(scale * 100)}%
                    </span>
                    <button
                        onClick={handleZoomIn}
                        className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                        title="Zoom in"
                    >
                        <ZoomIn size={20} />
                    </button>

                    <div className="w-px h-6 bg-white/20 mx-2" />

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

            {/* PDF Content */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-4">
                <div
                    className="bg-white rounded-lg shadow-2xl overflow-hidden relative"
                    style={{ transform: `scale(${scale})`, transformOrigin: 'center center' }}
                >
                    {loading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
                            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                        </div>
                    )}
                    {/* Use object tag for better blob URL support */}
                    <object
                        data={src}
                        type="application/pdf"
                        className="w-[800px] h-[90vh]"
                        onLoad={() => setLoading(false)}
                    >
                        {/* Fallback content when PDF cannot be displayed */}
                        <div className="w-[800px] h-[90vh] flex flex-col items-center justify-center bg-gray-100 p-8">
                            <FileText size={64} className="text-gray-400 mb-4" />
                            <p className="text-gray-600 text-lg mb-2">Cannot preview PDF in browser</p>
                            <p className="text-gray-500 text-sm mb-6">Download the file to view it</p>
                            {onDownload && (
                                <button
                                    onClick={onDownload}
                                    className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-2"
                                >
                                    <Download size={20} />
                                    Download PDF
                                </button>
                            )}
                        </div>
                    </object>
                </div>
            </div>

            {/* Footer - page navigation (placeholder for react-pdf) */}
            <div className="flex items-center justify-center gap-4 py-3 bg-black/50 border-t border-white/10">
                <span className="text-white/60 text-sm">
                    Use scroll to navigate pages. For better experience, download the file.
                </span>
            </div>
        </motion.div>
    );
}
