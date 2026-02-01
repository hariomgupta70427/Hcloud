import { motion, AnimatePresence } from 'framer-motion';
import { Download, X, Smartphone } from 'lucide-react';
import { usePWA } from '@/hooks/usePWA';
import { useState, useEffect } from 'react';

export function PWAInstallPrompt() {
    const { isInstallable, isInstalled, isStandalone, isIOS, promptInstall } = usePWA();
    const [showPrompt, setShowPrompt] = useState(false);
    const [showIOSInstructions, setShowIOSInstructions] = useState(false);

    useEffect(() => {
        // Don't show if already installed or embedded in standalone mode
        if (isInstalled || isStandalone) return;

        // Show prompt after a delay
        const timer = setTimeout(() => {
            if (isInstallable || isIOS) {
                setShowPrompt(true);
            }
        }, 5000); // Show after 5 seconds

        return () => clearTimeout(timer);
    }, [isInstallable, isIOS, isInstalled, isStandalone]);

    const handleInstall = async () => {
        if (isIOS) {
            setShowIOSInstructions(true);
        } else {
            const installed = await promptInstall();
            if (installed) {
                setShowPrompt(false);
            }
        }
    };

    const handleDismiss = () => {
        setShowPrompt(false);
        setShowIOSInstructions(false);
        // Don't show again for 7 days
        localStorage.setItem('pwa-prompt-dismissed', Date.now().toString());
    };

    // Check if dismissed recently
    useEffect(() => {
        const dismissed = localStorage.getItem('pwa-prompt-dismissed');
        if (dismissed) {
            const dismissedTime = parseInt(dismissed, 10);
            const sevenDays = 7 * 24 * 60 * 60 * 1000;
            if (Date.now() - dismissedTime < sevenDays) {
                setShowPrompt(false);
            }
        }
    }, []);

    if (!showPrompt || isInstalled || isStandalone) return null;

    return (
        <AnimatePresence>
            {showPrompt && (
                <motion.div
                    initial={{ opacity: 0, y: 50 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 50 }}
                    className="install-banner"
                >
                    <button
                        onClick={handleDismiss}
                        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <X size={20} />
                    </button>

                    {showIOSInstructions ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-primary/10">
                                    <Smartphone className="w-6 h-6 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-foreground">Install on iOS</h3>
                                    <p className="text-sm text-muted-foreground">Follow these steps</p>
                                </div>
                            </div>

                            <ol className="text-sm text-muted-foreground space-y-2 pl-4">
                                <li>1. Tap the <strong>Share</strong> button (box with arrow)</li>
                                <li>2. Scroll down and tap <strong>"Add to Home Screen"</strong></li>
                                <li>3. Tap <strong>"Add"</strong> in the top right</li>
                            </ol>

                            <button
                                onClick={handleDismiss}
                                className="w-full px-4 py-2 rounded-lg bg-muted text-sm font-medium hover:bg-muted/80 transition-colors"
                            >
                                Got it
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-start gap-4">
                            <div className="p-3 rounded-xl gradient-primary flex-shrink-0">
                                <Download className="w-6 h-6 text-white" />
                            </div>

                            <div className="flex-1">
                                <h3 className="font-semibold text-foreground mb-1">
                                    Install HCloud App
                                </h3>
                                <p className="text-sm text-muted-foreground mb-3">
                                    Get quick access and offline features by installing our app.
                                </p>

                                <div className="flex gap-2">
                                    <button
                                        onClick={handleInstall}
                                        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                                    >
                                        Install Now
                                    </button>
                                    <button
                                        onClick={handleDismiss}
                                        className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        Maybe Later
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
