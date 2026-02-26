import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home,
  FolderOpen,
  Star,
  Clock,
  Share2,
  Trash2,
  Settings,
  ChevronLeft,
  ChevronRight,
  Cloud,
  HardDrive,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/dashboard', icon: Home, label: 'Dashboard' },
  { path: '/dashboard/files', icon: FolderOpen, label: 'My Files' },
  { path: '/dashboard/starred', icon: Star, label: 'Starred' },
  { path: '/dashboard/recent', icon: Clock, label: 'Recent' },
  { path: '/dashboard/shared', icon: Share2, label: 'Shared' },
  { path: '/dashboard/trash', icon: Trash2, label: 'Trash' },
  { path: '/dashboard/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/dashboard';
    return location.pathname.startsWith(path);
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: isCollapsed ? 72 : 260 }}
      transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
      className="hidden md:flex flex-col h-screen bg-sidebar-background border-r border-sidebar-border relative z-30 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-sidebar-border flex-shrink-0">
        <AnimatePresence mode="wait">
          {!isCollapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center shadow-glow flex-shrink-0">
                <Cloud className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold text-gradient whitespace-nowrap">HCloud</span>
            </motion.div>
          )}
        </AnimatePresence>
        {isCollapsed && (
          <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center shadow-glow mx-auto">
            <Cloud className="w-5 h-5 text-white" />
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto scrollbar-hide">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={cn(
                'relative w-full flex items-center rounded-xl transition-all duration-200 group',
                isCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-3 py-2.5',
                active
                  ? 'text-primary'
                  : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent'
              )}
            >
              {/* Active indicator — animated pill */}
              {active && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 rounded-xl bg-primary/10 border border-primary/20"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}

              <div className="relative z-10 flex items-center gap-3">
                <Icon
                  size={20}
                  className={cn(
                    'flex-shrink-0 transition-transform duration-200',
                    active ? 'text-primary' : 'group-hover:scale-110'
                  )}
                />
                <AnimatePresence mode="wait">
                  {!isCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={{ duration: 0.2 }}
                      className={cn(
                        'text-sm font-medium whitespace-nowrap overflow-hidden',
                        active ? 'text-primary' : ''
                      )}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Storage usage */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="px-4 py-3 border-t border-sidebar-border"
          >
            <div className="p-3 rounded-xl bg-sidebar-accent/60">
              <div className="flex items-center gap-2 mb-2">
                <HardDrive size={14} className="text-sidebar-foreground/60" />
                <span className="text-xs font-medium text-sidebar-foreground/80">Storage</span>
              </div>
              <div className="h-1.5 bg-sidebar-border rounded-full overflow-hidden mb-1.5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: '35%' }}
                  transition={{ duration: 0.8, delay: 0.3 }}
                  className="h-full rounded-full gradient-primary"
                />
              </div>
              <p className="text-[10px] text-sidebar-foreground/50">
                {user?.storageMode === 'byod' ? 'Unlimited (BYOD)' : '35% of 50MB used'}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* User profile area */}
      <div className="border-t border-sidebar-border px-3 py-3 flex-shrink-0">
        <button
          onClick={() => navigate('/dashboard/profile')}
          className={cn(
            'w-full flex items-center rounded-xl hover:bg-sidebar-accent transition-colors p-2',
            isCollapsed ? 'justify-center' : 'gap-3'
          )}
        >
          <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <AnimatePresence>
            {!isCollapsed && (
              <motion.div
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="text-left overflow-hidden"
              >
                <p className="text-sm font-medium text-sidebar-foreground truncate max-w-[140px]">
                  {user?.name || 'User'}
                </p>
                <p className="text-[10px] text-sidebar-foreground/50 truncate max-w-[140px]">
                  {user?.email}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute top-1/2 -translate-y-1/2 -right-3 w-6 h-6 rounded-full border border-sidebar-border bg-sidebar-background hover:bg-sidebar-accent flex items-center justify-center shadow-sm z-50 transition-colors"
      >
        {isCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </motion.aside>
  );
}
