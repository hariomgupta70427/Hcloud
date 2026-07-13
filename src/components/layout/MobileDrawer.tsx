import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Cloud, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { navItems, isNavActive } from './navConfig';
import StoragePanel from './StoragePanel';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

// Slide-in navigation drawer for phone widths. The desktop Sidebar is
// display:none on mobile, so this is the only full-nav surface there —
// full route list, real storage panel, and profile access.
export default function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuthStore();

  // Close whenever the route changes (drawer nav or back/forward).
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="md:hidden fixed inset-0 z-[60]">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
          />

          {/* Drawer */}
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 40 }}
            className="absolute left-0 top-0 h-full w-[82%] max-w-[300px] flex flex-col bg-sidebar-background border-r border-sidebar-border shadow-2xl"
          >
            {/* Brand + close */}
            <div className="flex items-center justify-between h-16 px-4 border-b border-sidebar-border flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center shadow-glow">
                  <Cloud className="w-5 h-5 text-white" />
                </div>
                <span className="text-lg font-bold text-gradient">HCloud</span>
              </div>
              <button
                onClick={onClose}
                aria-label="Close menu"
                className="p-2 rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto scrollbar-hide">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = isNavActive(item.path, location.pathname);
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={cn(
                      'relative w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors',
                      active
                        ? 'text-primary'
                        : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent'
                    )}
                  >
                    {active && (
                      <motion.div
                        layoutId="drawer-active"
                        className="absolute inset-0 rounded-xl bg-primary/10 border border-primary/20"
                        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-3">
                      <Icon size={20} className="flex-shrink-0" />
                      <span className="text-sm font-medium">{item.label}</span>
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* Storage usage */}
            <div className="px-4 py-3 border-t border-sidebar-border">
              <StoragePanel />
            </div>

            {/* Profile */}
            <div className="border-t border-sidebar-border px-3 py-3 flex-shrink-0">
              <button
                onClick={() => navigate('/dashboard/profile')}
                className="w-full flex items-center gap-3 rounded-xl hover:bg-sidebar-accent transition-colors p-2"
              >
                <div className="w-8 h-8 rounded-full gradient-primary flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </div>
                <div className="text-left overflow-hidden">
                  <p className="text-sm font-medium text-sidebar-foreground truncate max-w-[180px]">
                    {user?.name || 'User'}
                  </p>
                  <p className="text-[10px] text-sidebar-foreground/50 truncate max-w-[180px]">
                    {user?.email}
                  </p>
                </div>
              </button>
            </div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
}
