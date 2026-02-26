import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { HeroPanel } from '@/components/auth/HeroPanel';
import { LoginForm } from '@/components/auth/LoginForm';
import { RegisterForm } from '@/components/auth/RegisterForm';

export type AuthMode = 'login' | 'signup';

export default function AuthPage() {
    const [searchParams] = useSearchParams();
    const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'login';
    const [mode, setMode] = useState<AuthMode>(initialMode);

    const toggleMode = () => {
        setMode(prev => (prev === 'login' ? 'signup' : 'login'));
    };

    return (
        <div className="min-h-screen w-full bg-background flex items-center justify-center p-4 lg:p-8">
            {/* Container */}
            <div className="auth-container w-full max-w-5xl min-h-[600px] lg:min-h-[680px] rounded-3xl overflow-hidden border border-border/50 shadow-2xl bg-card/80 backdrop-blur-sm">
                {/* Desktop: 2-column grid with animated order swap */}
                {/* Mobile: single column with hero as top banner */}
                <div className="grid grid-cols-1 lg:grid-cols-2 h-full min-h-[600px] lg:min-h-[680px]">
                    {/* Hero Panel — slides between left/right on desktop */}
                    <motion.div
                        layout
                        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                        style={{ order: mode === 'login' ? 0 : 1 }}
                        className="hidden lg:block relative"
                    >
                        <div className="absolute inset-0 p-3">
                            <HeroPanel mode={mode} />
                        </div>
                    </motion.div>

                    {/* Mobile Hero Banner */}
                    <div className="lg:hidden relative h-48 overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/90 to-primary/70">
                            {/* Simplified mobile background effects */}
                            <div
                                className="absolute inset-0 opacity-[0.03]"
                                style={{
                                    backgroundImage: `radial-gradient(circle, white 1px, transparent 1px)`,
                                    backgroundSize: '24px 24px',
                                }}
                            />
                        </div>
                        <div className="relative z-10 flex flex-col items-center justify-center h-full px-6 text-center text-white">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={mode}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    transition={{ duration: 0.25 }}
                                >
                                    <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-white/20 backdrop-blur-sm mb-3">
                                        <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
                                        </svg>
                                    </div>
                                    <h1 className="text-xl font-bold">
                                        {mode === 'login' ? 'Welcome Back' : 'Start Your Cloud Journey'}
                                    </h1>
                                    <p className="text-white/80 text-sm mt-1">
                                        {mode === 'login'
                                            ? 'Access your files from anywhere'
                                            : 'Free unlimited storage, enterprise security'}
                                    </p>
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Form Panel — slides to the opposite side of hero */}
                    <motion.div
                        layout
                        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                        style={{ order: mode === 'login' ? 1 : 0 }}
                        className="flex items-center justify-center p-6 sm:p-8 lg:p-12"
                    >
                        <div className="w-full max-w-md">
                            <AnimatePresence mode="wait">
                                {mode === 'login' ? (
                                    <motion.div
                                        key="login"
                                        initial={{ opacity: 0, x: 30 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -30 }}
                                        transition={{ duration: 0.3, ease: 'easeOut' }}
                                    >
                                        <LoginForm onSwitchToSignup={toggleMode} />
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="signup"
                                        initial={{ opacity: 0, x: -30 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: 30 }}
                                        transition={{ duration: 0.3, ease: 'easeOut' }}
                                    >
                                        <RegisterForm onSwitchToLogin={toggleMode} />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </motion.div>
                </div>
            </div>
        </div>
    );
}
