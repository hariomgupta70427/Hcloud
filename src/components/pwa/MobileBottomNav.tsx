import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Home,
    FolderOpen,
    Star,
    Share2,
    Settings
} from 'lucide-react';
import { usePWA } from '@/hooks/usePWA';

const navItems = [
    { icon: Home, label: 'Home', path: '/dashboard' },
    { icon: FolderOpen, label: 'Files', path: '/dashboard/files' },
    { icon: Star, label: 'Starred', path: '/dashboard/starred' },
    { icon: Share2, label: 'Shared', path: '/dashboard/shared' },
    { icon: Settings, label: 'Settings', path: '/dashboard/settings' },
];

export function MobileBottomNav() {
    const location = useLocation();
    const { isStandalone } = usePWA();

    // Only show on mobile (handled via CSS)
    return (
        <motion.nav
            initial={{ y: 100 }}
            animate={{ y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="mobile-bottom-nav"
        >
            <div className="flex items-center justify-around h-full">
                {navItems.map((item) => {
                    const isActive =
                        item.path === '/dashboard'
                            ? location.pathname === '/dashboard'
                            : location.pathname.startsWith(item.path);

                    return (
                        <Link
                            key={item.path}
                            to={item.path}
                            className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${isActive
                                    ? 'text-primary'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            <motion.div
                                whileTap={{ scale: 0.9 }}
                                className="relative"
                            >
                                <item.icon
                                    size={22}
                                    strokeWidth={isActive ? 2.5 : 2}
                                />
                                {isActive && (
                                    <motion.div
                                        layoutId="mobile-nav-indicator"
                                        className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                                        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                    />
                                )}
                            </motion.div>
                            <span className={`text-[10px] mt-1 font-medium ${isActive ? 'text-primary' : ''}`}>
                                {item.label}
                            </span>
                        </Link>
                    );
                })}
            </div>

            {/* Safe area padding for notched devices */}
            <div
                className="bg-card/95"
                style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            />
        </motion.nav>
    );
}
