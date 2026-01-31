import { motion } from 'framer-motion';
import { useState, useRef, useEffect } from 'react';
import {
    X,
    Play,
    Pause,
    Volume2,
    VolumeX,
    SkipBack,
    SkipForward,
    Download,
    Repeat,
    Shuffle,
    Music
} from 'lucide-react';

interface AudioPreviewProps {
    src: string;
    title?: string;
    artist?: string;
    cover?: string;
    onClose: () => void;
    onDownload?: () => void;
}

export function AudioPreview({
    src,
    title = 'Audio',
    artist,
    cover,
    onClose,
    onDownload,
}: AudioPreviewProps) {
    const audioRef = useRef<HTMLAudioElement>(null);
    const progressRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isMuted, setIsMuted] = useState(false);
    const [isLooping, setIsLooping] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);

    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
        const handleDurationChange = () => setDuration(audio.duration);
        const handleEnded = () => {
            if (!isLooping) setIsPlaying(false);
        };

        audio.addEventListener('timeupdate', handleTimeUpdate);
        audio.addEventListener('durationchange', handleDurationChange);
        audio.addEventListener('ended', handleEnded);

        return () => {
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.removeEventListener('durationchange', handleDurationChange);
            audio.removeEventListener('ended', handleEnded);
        };
    }, [isLooping]);

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
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const togglePlay = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const toggleMute = () => {
        if (audioRef.current) {
            audioRef.current.muted = !isMuted;
            setIsMuted(!isMuted);
        }
    };

    const toggleLoop = () => {
        if (audioRef.current) {
            audioRef.current.loop = !isLooping;
            setIsLooping(!isLooping);
        }
    };

    const skip = (seconds: number) => {
        if (audioRef.current) {
            audioRef.current.currentTime += seconds;
        }
    };

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!progressRef.current || !audioRef.current) return;
        const rect = progressRef.current.getBoundingClientRect();
        const pos = (e.clientX - rect.left) / rect.width;
        audioRef.current.currentTime = pos * duration;
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseFloat(e.target.value);
        setVolume(value);
        if (audioRef.current) {
            audioRef.current.volume = value;
            setIsMuted(value === 0);
        }
    };

    const formatTime = (time: number) => {
        if (isNaN(time)) return '0:00';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <audio ref={audioRef} src={src} preload="metadata" />

            {/* Close button */}
            <button
                onClick={onClose}
                className="absolute top-4 right-4 p-3 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
                <X size={24} />
            </button>

            {/* Player card */}
            <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="w-full max-w-md mx-4 p-8 rounded-3xl bg-gradient-to-b from-white/10 to-white/5 backdrop-blur-md border border-white/10"
            >
                {/* Album art */}
                <div className="relative w-48 h-48 mx-auto mb-8 rounded-2xl overflow-hidden shadow-2xl">
                    {cover ? (
                        <img src={cover} alt={title} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
                            <Music size={64} className="text-white/50" />
                        </div>
                    )}
                    {isPlaying && (
                        <motion.div
                            className="absolute inset-0 bg-black/20"
                            animate={{ opacity: [0.2, 0.4, 0.2] }}
                            transition={{ duration: 2, repeat: Infinity }}
                        />
                    )}
                </div>

                {/* Title and artist */}
                <div className="text-center mb-8">
                    <h2 className="text-xl font-bold text-white mb-1 truncate">{title}</h2>
                    {artist && <p className="text-white/60 truncate">{artist}</p>}
                </div>

                {/* Progress bar */}
                <div className="mb-6">
                    <div
                        ref={progressRef}
                        onClick={handleProgressClick}
                        className="h-1.5 bg-white/20 rounded-full cursor-pointer group"
                    >
                        <motion.div
                            className="h-full bg-primary rounded-full relative"
                            style={{ width: `${(currentTime / duration) * 100 || 0}%` }}
                        >
                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity" />
                        </motion.div>
                    </div>
                    <div className="flex justify-between mt-2 text-sm text-white/60">
                        <span>{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                    </div>
                </div>

                {/* Controls */}
                <div className="flex items-center justify-center gap-6">
                    {/* Shuffle (placeholder) */}
                    <button className="text-white/40 hover:text-white transition-colors">
                        <Shuffle size={20} />
                    </button>

                    {/* Skip back */}
                    <button
                        onClick={() => skip(-10)}
                        className="text-white hover:text-primary transition-colors"
                    >
                        <SkipBack size={28} />
                    </button>

                    {/* Play/Pause */}
                    <button
                        onClick={togglePlay}
                        className="w-16 h-16 rounded-full bg-primary hover:bg-primary/90 flex items-center justify-center text-white transition-colors shadow-lg shadow-primary/30"
                    >
                        {isPlaying ? <Pause size={28} /> : <Play size={28} className="ml-1" />}
                    </button>

                    {/* Skip forward */}
                    <button
                        onClick={() => skip(10)}
                        className="text-white hover:text-primary transition-colors"
                    >
                        <SkipForward size={28} />
                    </button>

                    {/* Loop */}
                    <button
                        onClick={toggleLoop}
                        className={`transition-colors ${isLooping ? 'text-primary' : 'text-white/40 hover:text-white'}`}
                    >
                        <Repeat size={20} />
                    </button>
                </div>

                {/* Volume and download */}
                <div className="flex items-center justify-between mt-8">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleMute}
                            className="text-white/60 hover:text-white transition-colors"
                        >
                            {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
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

                    {onDownload && (
                        <button
                            onClick={onDownload}
                            className="text-white/60 hover:text-white transition-colors"
                        >
                            <Download size={20} />
                        </button>
                    )}
                </div>
            </motion.div>
        </motion.div>
    );
}
