import { motion, AnimatePresence } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw, Download, ChevronLeft, ChevronRight } from 'lucide-react';

interface ImagePreviewProps {
    src: string;
    alt?: string;
    onClose: () => void;
    onDownload?: () => void;
    images?: { src: string; alt?: string }[];
    currentIndex?: number;
    onNavigate?: (index: number) => void;
}

export function ImagePreview({
    src,
    alt = 'Image preview',
    onClose,
    onDownload,
    images,
    currentIndex = 0,
    onNavigate,
}: ImagePreviewProps) {
    const [scale, setScale] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const imageRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const hasMultiple = images && images.length > 1;
    const canGoPrev = hasMultiple && currentIndex > 0;
    const canGoNext = hasMultiple && currentIndex < images.length - 1;

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowLeft' && canGoPrev) onNavigate?.(currentIndex - 1);
            if (e.key === 'ArrowRight' && canGoNext) onNavigate?.(currentIndex + 1);
            if (e.key === '+' || e.key === '=') handleZoomIn();
            if (e.key === '-') handleZoomOut();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [canGoPrev, canGoNext, currentIndex, onClose, onNavigate]);

    // Reset on image change
    useEffect(() => {
        setScale(1);
        setRotation(0);
        setPosition({ x: 0, y: 0 });
    }, [src]);

    const handleZoomIn = () => setScale((s) => Math.min(s + 0.5, 5));
    const handleZoomOut = () => setScale((s) => Math.max(s - 0.5, 0.5));
    const handleRotate = () => setRotation((r) => r + 90);
    const handleReset = () => {
        setScale(1);
        setRotation(0);
        setPosition({ x: 0, y: 0 });
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setScale((s) => Math.max(0.5, Math.min(5, s + delta)));
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            {/* Toolbar */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2 rounded-xl bg-black/50 backdrop-blur-md border border-white/10">
                <button
                    onClick={handleZoomOut}
                    className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                    title="Zoom out"
                >
                    <ZoomOut size={20} />
                </button>
                <span className="text-white text-sm font-medium min-w-[4rem] text-center">
                    {Math.round(scale * 100)}%
                </span>
                <button
                    onClick={handleZoomIn}
                    className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                    title="Zoom in"
                >
                    <ZoomIn size={20} />
                </button>
                <div className="w-px h-6 bg-white/20" />
                <button
                    onClick={handleRotate}
                    className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                    title="Rotate"
                >
                    <RotateCw size={20} />
                </button>
                {onDownload && (
                    <>
                        <div className="w-px h-6 bg-white/20" />
                        <button
                            onClick={onDownload}
                            className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                            title="Download"
                        >
                            <Download size={20} />
                        </button>
                    </>
                )}
            </div>

            {/* Close button */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 p-3 rounded-xl bg-black/50 hover:bg-black/70 text-white transition-colors"
            >
                <X size={24} />
            </button>

            {/* Navigation arrows */}
            {canGoPrev && (
                <button
                    onClick={() => onNavigate?.(currentIndex - 1)}
                    className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-xl bg-black/50 hover:bg-black/70 text-white transition-colors"
                >
                    <ChevronLeft size={28} />
                </button>
            )}
            {canGoNext && (
                <button
                    onClick={() => onNavigate?.(currentIndex + 1)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-xl bg-black/50 hover:bg-black/70 text-white transition-colors"
                >
                    <ChevronRight size={28} />
                </button>
            )}

            {/* Image */}
            <motion.div
                ref={containerRef}
                className="relative max-w-[90vw] max-h-[85vh] cursor-grab active:cursor-grabbing overflow-hidden"
                onWheel={handleWheel}
                drag={scale > 1}
                dragConstraints={containerRef}
                dragElastic={0.1}
                onDoubleClick={handleReset}
            >
                <motion.img
                    ref={imageRef}
                    src={src}
                    alt={alt}
                    animate={{
                        scale,
                        rotate: rotation,
                        x: position.x,
                        y: position.y,
                    }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    className="max-w-full max-h-[85vh] object-contain select-none"
                    draggable={false}
                />
            </motion.div>

            {/* Image counter */}
            {hasMultiple && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg bg-black/50 text-white text-sm">
                    {currentIndex + 1} / {images.length}
                </div>
            )}
        </motion.div>
    );
}
