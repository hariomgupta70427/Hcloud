import {
  Home,
  FolderOpen,
  Star,
  Clock,
  Share2,
  Trash2,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  path: string;
  icon: LucideIcon;
  label: string;
}

// Single source of truth for the primary navigation — shared by the desktop
// Sidebar and the mobile slide-in drawer so the two never drift apart.
export const navItems: NavItem[] = [
  { path: '/dashboard', icon: Home, label: 'Dashboard' },
  { path: '/dashboard/files', icon: FolderOpen, label: 'My Files' },
  { path: '/dashboard/starred', icon: Star, label: 'Starred' },
  { path: '/dashboard/recent', icon: Clock, label: 'Recent' },
  { path: '/dashboard/shared', icon: Share2, label: 'Shared' },
  { path: '/dashboard/trash', icon: Trash2, label: 'Trash' },
  { path: '/dashboard/settings', icon: Settings, label: 'Settings' },
];

// Managed accounts get a fixed Telegram Bot API quota; BYOD is effectively
// unlimited (the user's own Telegram account).
export const MANAGED_QUOTA = 50 * 1024 * 1024 * 1024; // 50 GB

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

// A tab is active on an exact match for the dashboard root, or a prefix match
// for every nested section.
export const isNavActive = (path: string, pathname: string): boolean => {
  if (path === '/dashboard') return pathname === '/dashboard';
  return pathname.startsWith(path);
};
