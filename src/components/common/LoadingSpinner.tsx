import { motion } from 'framer-motion';
import { Loader2, Cloud } from 'lucide-react';

interface LoadingSpinnerProps {
    size?: 'sm' | 'md' | 'lg';
    fullScreen?: boolean;
    message?: string;
}

const sizes = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
};

export function LoadingSpinner({ size = 'md', message }: LoadingSpinnerProps) {
    return (
        <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className={`${sizes[size]} animate-spin`} />
            {message && <span className="text-sm">{message}</span>}
        </div>
    );
}

export function FullPageLoader({ message = 'Loading...' }: { message?: string }) {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
        >
            {/* Logo animation */}
            <motion.div
                animate={{
                    scale: [1, 1.1, 1],
                }}
                transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
                className="w-20 h-20 rounded-2xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/30 mb-6"
            >
                <Cloud size={40} className="text-white" />
            </motion.div>

            {/* Loading text */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-center"
            >
                <h2 className="text-xl font-bold text-foreground mb-2">HCloud</h2>
                <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">{message}</span>
                </div>
            </motion.div>

            {/* Animated dots */}
            <motion.div className="flex gap-1 mt-8">
                {[0, 1, 2].map((i) => (
                    <motion.div
                        key={i}
                        animate={{
                            scale: [1, 1.5, 1],
                            opacity: [0.5, 1, 0.5],
                        }}
                        transition={{
                            duration: 1,
                            repeat: Infinity,
                            delay: i * 0.2,
                        }}
                        className="w-2 h-2 rounded-full bg-primary"
                    />
                ))}
            </motion.div>
        </motion.div>
    );
}

export function InlineLoader({ message }: { message?: string }) {
    return (
        <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-3 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                {message && <span>{message}</span>}
            </div>
        </div>
    );
}

export function ButtonLoader() {
    return (
        <Loader2 className="w-4 h-4 animate-spin" />
    );
}
