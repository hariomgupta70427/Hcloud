import { useState, useEffect } from 'react';

interface PWAInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface UsePWAReturn {
    isInstalled: boolean;
    isInstallable: boolean;
    isStandalone: boolean;
    isIOS: boolean;
    isAndroid: boolean;
    promptInstall: () => Promise<boolean>;
    platform: 'ios' | 'android' | 'desktop' | 'unknown';
}

export function usePWA(): UsePWAReturn {
    const [installPromptEvent, setInstallPromptEvent] = useState<PWAInstallPromptEvent | null>(null);
    const [isInstalled, setIsInstalled] = useState(false);

    // Detect platform
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    // Check if running in standalone mode (installed PWA)
    const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true ||
        document.referrer.includes('android-app://');

    const platform = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';

    useEffect(() => {
        // Check if already installed
        if (isStandalone) {
            setIsInstalled(true);
        }

        // Listen for the beforeinstallprompt event
        const handleBeforeInstallPrompt = (e: Event) => {
            e.preventDefault();
            setInstallPromptEvent(e as PWAInstallPromptEvent);
        };

        // Listen for app installed event
        const handleAppInstalled = () => {
            setIsInstalled(true);
            setInstallPromptEvent(null);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, [isStandalone]);

    const promptInstall = async (): Promise<boolean> => {
        if (!installPromptEvent) {
            return false;
        }

        await installPromptEvent.prompt();
        const { outcome } = await installPromptEvent.userChoice;

        if (outcome === 'accepted') {
            setIsInstalled(true);
            return true;
        }

        return false;
    };

    return {
        isInstalled,
        isInstallable: !!installPromptEvent,
        isStandalone,
        isIOS,
        isAndroid,
        promptInstall,
        platform,
    };
}
