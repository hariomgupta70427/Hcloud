import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
    Home,
    FolderOpen,
    Star,
    Upload,
    Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
    { path: '/dashboard', icon: Home, label: 'Home' },
    { path: '/dashboard/files', icon: FolderOpen, label: 'Files' },
    { path: '/dashboard/starred', icon: Star, label: 'Starred' },
    { path: '/dashboard/settings', icon: Settings, label: 'Settings' },
];

export default function MobileBottomNav() {
    const location = useLocation();
    const navigate = useNavigate();

    const isActive = (path: string) => {
        if (path === '/dashboard') return location.pathname === '/dashboard';
        return location.pathname.startsWith(path);
    };

    return (
        <nav className="mobile-bottom-nav md:hidden">
            <div className="flex items-center justify-around h-full px-2 pb-safe">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const active = isActive(item.path);
                    return (
                        <button
                            key={item.path}
                            onClick={() => navigate(item.path)}
                            className={cn(
                                'relative flex flex-col items-center justify-center gap-0.5 min-w-[56px] min-h-[44px] rounded-xl transition-colors',
                                active ? 'text-primary' : 'text-muted-foreground'
                            )}
                        >
                            {/* Active indicator pill */}
                            {active && (
                                <motion.div
                                    layoutId="mobile-active"
                                    className="absolute -top-0.5 w-8 h-1 rounded-full bg-primary"
                                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                                />
                            )}
                            <Icon
                                size={22}
                                className={cn(
                                    'transition-all duration-200',
                                    active ? 'text-primary scale-110' : ''
                                )}
                            />
                            <span className="text-[10px] font-medium leading-tight">{item.label}</span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
