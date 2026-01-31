import { motion } from 'framer-motion';
import { useState } from 'react';
import { 
  User, 
  Bell, 
  Shield, 
  Palette, 
  HardDrive, 
  LogOut,
  ChevronRight,
  Sun,
  Moon,
  Monitor
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { useNavigate } from 'react-router-dom';

const settingsSections = [
  {
    id: 'profile',
    title: 'Profile',
    icon: User,
    description: 'Update your personal information',
  },
  {
    id: 'notifications',
    title: 'Notifications',
    icon: Bell,
    description: 'Manage email and push notifications',
  },
  {
    id: 'security',
    title: 'Security',
    icon: Shield,
    description: 'Password and two-factor authentication',
  },
  {
    id: 'storage',
    title: 'Storage',
    icon: HardDrive,
    description: 'Manage your storage settings',
  },
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const { theme, setTheme } = useUIStore();
  const [activeSection, setActiveSection] = useState('appearance');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your account preferences
        </p>
      </div>

      {/* User Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-6 rounded-xl bg-card border border-border"
      >
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl gradient-primary flex items-center justify-center text-white text-2xl font-bold">
            {user?.name?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-foreground">{user?.name || 'User'}</h2>
            <p className="text-muted-foreground">{user?.email || 'user@example.com'}</p>
            <span className="inline-block mt-2 px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary capitalize">
              {user?.storageMode || 'managed'} Storage
            </span>
          </div>
        </div>
      </motion.div>

      {/* Appearance */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="p-6 rounded-xl bg-card border border-border"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 rounded-lg bg-primary/10">
            <Palette className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Appearance</h3>
            <p className="text-sm text-muted-foreground">Customize how HCloud looks</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { value: 'light' as const, icon: Sun, label: 'Light' },
            { value: 'dark' as const, icon: Moon, label: 'Dark' },
            { value: 'system' as const, icon: Monitor, label: 'System' },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setTheme(option.value)}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                theme === option.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/30'
              }`}
            >
              <option.icon className={`w-6 h-6 ${theme === option.value ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className={`text-sm font-medium ${theme === option.value ? 'text-primary' : 'text-foreground'}`}>
                {option.label}
              </span>
            </button>
          ))}
        </div>
      </motion.div>

      {/* Settings Sections */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="rounded-xl bg-card border border-border overflow-hidden"
      >
        {settingsSections.map((section, index) => (
          <button
            key={section.id}
            className={`w-full flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors ${
              index !== settingsSections.length - 1 ? 'border-b border-border' : ''
            }`}
          >
            <div className="p-2 rounded-lg bg-muted">
              <section.icon className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="flex-1 text-left">
              <h4 className="font-medium text-foreground">{section.title}</h4>
              <p className="text-sm text-muted-foreground">{section.description}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>
        ))}
      </motion.div>

      {/* Logout */}
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        onClick={handleLogout}
        className="w-full flex items-center justify-center gap-2 p-4 rounded-xl border border-destructive/50 text-destructive hover:bg-destructive/10 transition-colors"
      >
        <LogOut size={20} />
        <span className="font-medium">Sign Out</span>
      </motion.button>
    </div>
  );
}
