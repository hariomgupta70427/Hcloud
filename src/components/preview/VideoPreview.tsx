import { motion } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import {
    X,
    Play,
    Pause,
    Volume2,
    VolumeX,
    Maximize,
    Minimize,
    SkipBack,
    SkipForward,
    Download
} from 'lucide-react';

interface VideoPreviewProps {
    src: string;
    title?: string;
    poster?: string;
    onClose: () => void;
    onDownload?: () => void;
}

export function VideoPreview({
    src,
    title = 'Video',
    poster,
    onClose,
    onDownload,
}: VideoPreviewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [showControls, setShowControls] = useState(true);
    const controlsTimeoutRef = useRef<NodeJS.Timeout>();

    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => setCurrentTime(video.currentTime);
        const handleDurationChange = () => setDuration(video.duration);
        const handleEnded = () => setIsPlaying(false);

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('durationchange', handleDurationChange);
        video.addEventListener('ended', handleEnded);

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('durationchange', handleDurationChange);
            video.removeEventListener('ended', handleEnded);
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === ' ') {
                e.preventDefault();
                togglePlay();
            }
            if (e.key === 'ArrowLeft') skip(-10);
            if (e.key === 'ArrowRight') skip(10);
            if (e.key === 'm') toggleMute();
            if (e.key === 'f') toggleFullscreen();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                videoRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const toggleMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !isMuted;
            setIsMuted(!isMuted);
        }
    };

    const toggleFullscreen = async () => {
        const container = containerRef.current;
        if (!container) return;

        if (!document.fullscreenElement) {
            await container.requestFullscreen();
            setIsFullscreen(true);
        } else {
            await document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    const skip = (seconds: number) => {
        if (videoRef.current) {
            videoRef.current.currentTime += seconds;
        }
    };

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!progressRef.current || !videoRef.current) return;
        const rect = progressRef.current.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        videoRef.current.currentTime = pos * duration;
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseFloat(e.target.value);
        setVolume(value);
        if (videoRef.current) {
            videoRef.current.volume = value;
            setIsMuted(value === 0);
        }
    };

    const formatTime = (time: number) => {
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const handleMouseMove = () => {
        setShowControls(true);
        clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            if (isPlaying) setShowControls(false);
        }, 3000);
    };

    // Always show controls on mobile/touch devices
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    const controlsVisible = isMobile || showControls;

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black"
            onClick={(e) => e.target === e.currentTarget && onClose()}
            onMouseMove={handleMouseMove}
        >
            {/* Close button - always visible */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 p-3 rounded-xl bg-black/70 hover:bg-black/90 text-white transition-colors z-20"
            >
                <X size={24} />
            </button>

            {/* Title - always visible */}
            <div className="absolute top-4 left-4 text-white font-medium z-20 bg-black/50 px-3 py-2 rounded-lg">
                {title}
            </div>

            {/* Video container */}
            <div
                ref={containerRef}
                className="relative w-full h-full flex flex-col items-center justify-center"
            >
                <video
                    ref={videoRef}
                    src={src}
                    poster={poster}
                    className="max-w-full max-h-[calc(100vh-120px)] w-auto h-auto"
                    onClick={togglePlay}
                    playsInline
                    style={{ objectFit: 'contain' }}
                />

                {/* Play overlay */}
                {!isPlaying && (
                    <motion.button
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        onClick={togglePlay}
                        className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                        <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center pointer-events-auto hover:bg-white/30 transition-colors">
                            <Play size={36} className="text-white ml-1" fill="white" />
                        </div>
                    </motion.button>
                )}

                {/* Controls Bar - Fixed at bottom, always visible on mobile */}
                <div
                    className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent pt-16 pb-4 px-4 transition-opacity duration-300 ${controlsVisible ? 'opacity-100' : 'opacity-0'
                        }`}
                >
                    {/* Progress bar */}
                    <div
                        ref={progressRef}
                        onClick={handleProgressClick}
                        className="h-2 bg-white/30 rounded-full mb-4 cursor-pointer group"
                    >
                        <div
                            className="h-full bg-primary rounded-full relative"
                            style={{ width: `${(currentTime / duration) * 100 || 0}%` }}
                        >
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg" />
                        </div>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-center sm:justify-start">
                        {/* Play/Pause */}
                        <button onClick={togglePlay} className="text-white hover:text-primary transition-colors p-2">
                            {isPlaying ? <Pause size={28} /> : <Play size={28} />}
                        </button>

                        {/* Skip buttons - hidden on very small screens */}
                        <button onClick={() => skip(-10)} className="text-white hover:text-primary transition-colors p-2 hidden sm:block">
                            <SkipBack size={24} />
                        </button>
                        <button onClick={() => skip(10)} className="text-white hover:text-primary transition-colors p-2 hidden sm:block">
                            <SkipForward size={24} />
                        </button>

                        {/* Time */}
                        <div className="text-white text-sm font-medium">
                            {formatTime(currentTime)} / {formatTime(duration || 0)}
                        </div>

                        <div className="flex-1" />

                        {/* Volume - hidden on mobile */}
                        <div className="hidden sm:flex items-center gap-2">
                            <button onClick={toggleMute} className="text-white hover:text-primary transition-colors p-2">
                                {isMuted || volume === 0 ? <VolumeX size={24} /> : <Volume2 size={24} />}
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={isMuted ? 0 : volume}
                                onChange={handleVolumeChange}
                                className="w-24 accent-primary"
                            />
                        </div>

                        {/* Download */}
                        {onDownload && (
                            <button onClick={onDownload} className="text-white hover:text-primary transition-colors p-2">
                                <Download size={24} />
                            </button>
                        )}

                        {/* Fullscreen */}
                        <button onClick={toggleFullscreen} className="text-white hover:text-primary transition-colors p-2">
                            {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
                        </button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
