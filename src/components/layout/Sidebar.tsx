import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Cloud, 
  FolderOpen, 
  Star, 
  Clock, 
  Users, 
  Trash2, 
  Settings, 
  HelpCircle,
  ChevronLeft,
  Upload,
  Infinity as InfinityIcon
} from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

const navItems = [
  { icon: FolderOpen, label: 'My Files', path: '/dashboard/files' },
  { icon: Star, label: 'Starred', path: '/dashboard/starred' },
  { icon: Clock, label: 'Recent', path: '/dashboard/recent' },
  { icon: Users, label: 'Shared', path: '/dashboard/shared' },
  { icon: Trash2, label: 'Trash', path: '/dashboard/trash' },
];

const bottomItems = [
  { icon: Settings, label: 'Settings', path: '/dashboard/settings' },
  { icon: HelpCircle, label: 'Help', path: '/help' },
];

export function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { sidebarCollapsed, toggleSidebar } = useUIStore();

  return (
    <motion.aside
      initial={false}
      animate={{ width: sidebarCollapsed ? 72 : 260 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="h-screen flex flex-col bg-sidebar border-r border-sidebar-border overflow-hidden"
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border">
        <Link to="/dashboard" className="flex items-center gap-3">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg gradient-primary flex items-center justify-center shadow-glow">
            <Cloud className="w-5 h-5 text-white" />
          </div>
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="font-bold text-xl text-foreground whitespace-nowrap overflow-hidden"
              >
                HCloud
              </motion.span>
            )}
          </AnimatePresence>
        </Link>
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg hover:bg-sidebar-accent transition-colors text-muted-foreground hover:text-foreground"
        >
          <motion.div
            animate={{ rotate: sidebarCollapsed ? 180 : 0 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronLeft size={18} />
          </motion.div>
        </button>
      </div>

      {/* Upload Button */}
      <div className="p-4">
        <motion.button
          onClick={() => navigate('/dashboard/files')}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className={cn(
            "w-full flex items-center justify-center gap-2 rounded-xl gradient-primary text-white font-medium shadow-lg shadow-primary/25 transition-all",
            sidebarCollapsed ? "h-10 px-2" : "h-11 px-4"
          )}
        >
          <Upload size={18} />
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.span
                initial={{ opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                className="whitespace-nowrap overflow-hidden"
              >
                Upload
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1 overflow-y-auto scrollbar-hide">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || 
            (item.path === '/dashboard/files' && location.pathname === '/dashboard');
          
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "sidebar-item",
                isActive && "active",
                sidebarCollapsed && "justify-center px-2"
              )}
            >
              <item.icon size={20} className="flex-shrink-0" />
              <AnimatePresence>
                {!sidebarCollapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className="whitespace-nowrap overflow-hidden"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          );
        })}
      </nav>

      {/* Storage Indicator */}
      <div className={cn(
        "mx-3 mb-3 p-3 rounded-xl bg-sidebar-accent",
        sidebarCollapsed && "p-2"
      )}>
        <div className={cn(
          "flex items-center gap-3",
          sidebarCollapsed && "justify-center"
        )}>
          <div className="flex-shrink-0 p-2 rounded-lg bg-primary/10">
            <InfinityIcon size={16} className="text-primary" />
          </div>
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <p className="text-xs text-muted-foreground">Storage</p>
                <p className="text-sm font-semibold text-foreground">Unlimited</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="px-3 pb-4 space-y-1 border-t border-sidebar-border pt-3">
        {bottomItems.map((item) => {
          const isActive = location.pathname === item.path;
          
          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "sidebar-item",
                isActive && "active",
                sidebarCollapsed && "justify-center px-2"
              )}
            >
              <item.icon size={20} className="flex-shrink-0" />
              <AnimatePresence>
                {!sidebarCollapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className="whitespace-nowrap overflow-hidden"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </Link>
          );
        })}
      </div>
    </motion.aside>
  );
}
