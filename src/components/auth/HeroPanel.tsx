import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, Shield, Zap, Globe } from 'lucide-react';

interface HeroPanelProps {
    mode: 'login' | 'signup';
}

const heroContent = {
    login: {
        title: 'Welcome Back',
        subtitle: 'Access your files from anywhere, anytime.',
        features: [
            { icon: Shield, text: 'End-to-end encrypted storage' },
            { icon: Zap, text: 'Lightning fast streaming' },
            { icon: Globe, text: 'Access from any device' },
        ],
    },
    signup: {
        title: 'Start Your Cloud Journey',
        subtitle: 'Free unlimited storage with enterprise-grade security.',
        features: [
            { icon: Cloud, text: 'Unlimited cloud storage' },
            { icon: Shield, text: 'Your data, your control' },
            { icon: Zap, text: 'Stream media instantly' },
        ],
    },
};

export function HeroPanel({ mode }: HeroPanelProps) {
    const content = heroContent[mode];

    return (
        <div className="relative h-full w-full overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary/90 to-primary/70">
            {/* Animated background elements */}
            <div className="absolute inset-0">
                {/* Floating blobs */}
                <motion.div
                    animate={{
                        x: [0, 30, -20, 0],
                        y: [0, -40, 20, 0],
                        scale: [1, 1.2, 0.9, 1],
                    }}
                    transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-white/10 blur-3xl"
                />
                <motion.div
                    animate={{
                        x: [0, -30, 20, 0],
                        y: [0, 30, -40, 0],
                        scale: [1, 0.9, 1.2, 1],
                    }}
                    transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute -bottom-20 -left-20 w-72 h-72 rounded-full bg-white/10 blur-3xl"
                />
                <motion.div
                    animate={{
                        x: [0, 20, -15, 0],
                        y: [0, -20, 30, 0],
                    }}
                    transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute top-1/3 left-1/4 w-40 h-40 rounded-full bg-white/5 blur-2xl"
                />

                {/* Grid pattern overlay */}
                <div
                    className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: `radial-gradient(circle, white 1px, transparent 1px)`,
                        backgroundSize: '24px 24px',
                    }}
                />
            </div>

            {/* Content */}
            <div className="relative z-10 flex h-full flex-col items-center justify-center px-8 lg:px-12 text-white text-center">
                {/* Logo */}
                <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    className="mb-8"
                >
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 shadow-xl">
                        <Cloud className="w-8 h-8 text-white" />
                    </div>
                </motion.div>

                {/* Animated text morph */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={mode}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.35, ease: 'easeOut' }}
                        className="space-y-3"
                    >
                        <h1 className="text-3xl lg:text-4xl font-bold tracking-tight">
                            {content.title}
                        </h1>
                        <p className="text-white/80 text-base lg:text-lg max-w-sm mx-auto">
                            {content.subtitle}
                        </p>
                    </motion.div>
                </AnimatePresence>

                {/* Features list */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={mode + '-features'}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -15 }}
                        transition={{ duration: 0.35, delay: 0.1, ease: 'easeOut' }}
                        className="mt-10 space-y-4"
                    >
                        {content.features.map((feature, index) => {
                            const Icon = feature.icon;
                            return (
                                <motion.div
                                    key={feature.text}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.2 + index * 0.1 }}
                                    className="flex items-center gap-3 text-white/90"
                                >
                                    <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/15 backdrop-blur-sm">
                                        <Icon className="w-4 h-4" />
                                    </div>
                                    <span className="text-sm font-medium">{feature.text}</span>
                                </motion.div>
                            );
                        })}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
}
