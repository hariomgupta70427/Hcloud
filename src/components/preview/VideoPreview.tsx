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
        if (!document.fullscreenElement) {
            await videoRef.current?.parentElement?.requestFullscreen();
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

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/95"
            onClick={(e) => e.target === e.currentTarget && onClose()}
            onMouseMove={handleMouseMove}
        >
            {/* Close button */}
            <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: showControls ? 1 : 0 }}
                onClick={onClose}
                className="absolute top-4 right-4 p-3 rounded-xl bg-black/50 hover:bg-black/70 text-white transition-colors z-10"
            >
                <X size={24} />
            </motion.button>

            {/* Title */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: showControls ? 1 : 0 }}
                className="absolute top-4 left-4 text-white font-medium z-10"
            >
                {title}
            </motion.div>

            {/* Video container */}
            <div className="relative w-full max-w-5xl mx-4">
                <video
                    ref={videoRef}
                    src={src}
                    poster={poster}
                    className="w-full rounded-lg"
                    onClick={togglePlay}
                />

                {/* Play overlay */}
                {!isPlaying && (
                    <motion.button
                        initial={{ scale: 0.8, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.8, opacity: 0 }}
                        onClick={togglePlay}
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center hover:bg-white/30 transition-colors">
                            <Play size={36} className="text-white ml-1" fill="white" />
                        </div>
                    </motion.button>
                )}

                {/* Controls */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: showControls ? 1 : 0, y: showControls ? 0 : 20 }}
                    className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent rounded-b-lg"
                >
                    {/* Progress bar */}
                    <div
                        ref={progressRef}
                        onClick={handleProgressClick}
                        className="h-1 bg-white/30 rounded-full mb-4 cursor-pointer group"
                    >
                        <div
                            className="h-full bg-primary rounded-full relative"
                            style={{ width: `${(currentTime / duration) * 100}%` }}
                        >
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {/* Play/Pause */}
                        <button onClick={togglePlay} className="text-white hover:text-primary transition-colors">
                            {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                        </button>

                        {/* Skip buttons */}
                        <button onClick={() => skip(-10)} className="text-white hover:text-primary transition-colors">
                            <SkipBack size={20} />
                        </button>
                        <button onClick={() => skip(10)} className="text-white hover:text-primary transition-colors">
                            <SkipForward size={20} />
                        </button>

                        {/* Time */}
                        <div className="text-white text-sm">
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </div>

                        <div className="flex-1" />

                        {/* Volume */}
                        <div className="flex items-center gap-2 group">
                            <button onClick={toggleMute} className="text-white hover:text-primary transition-colors">
                                {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                            </button>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                value={isMuted ? 0 : volume}
                                onChange={handleVolumeChange}
                                className="w-20 accent-primary opacity-0 group-hover:opacity-100 transition-opacity"
                            />
                        </div>

                        {/* Download */}
                        {onDownload && (
                            <button onClick={onDownload} className="text-white hover:text-primary transition-colors">
                                <Download size={20} />
                            </button>
                        )}

                        {/* Fullscreen */}
                        <button onClick={toggleFullscreen} className="text-white hover:text-primary transition-colors">
                            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
                        </button>
                    </div>
                </motion.div>
            </div>
        </motion.div>
    );
}
