import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { HardDrive } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useFileStore } from '@/stores/fileStore';
import { getStorageStats } from '@/services/fileService';
import { MANAGED_QUOTA, formatBytes } from './navConfig';

// Real-data storage card. Reads getStorageStats so the panel always reflects
// the true file count + usage; shared by the desktop Sidebar and mobile drawer.
export default function StoragePanel() {
  const { user } = useAuthStore();
  const { files } = useFileStore();
  const [stats, setStats] = useState({ totalFiles: 0, totalSize: 0 });

  const isByod = user?.storageMode === 'byod';

  // Refresh on mount and whenever the file list changes (upload/delete).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    getStorageStats(user.id)
      .then((s) => {
        if (!cancelled) setStats({ totalFiles: s.totalFiles, totalSize: s.totalSize });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user?.id, files.length]);

  const usedPct = Math.min(100, (stats.totalSize / MANAGED_QUOTA) * 100);

  return (
    <div className="p-3 rounded-xl bg-sidebar-accent/60">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <HardDrive size={14} className="text-sidebar-foreground/60" />
          <span className="text-xs font-medium text-sidebar-foreground/80">Storage</span>
        </div>
        <span className="text-[10px] font-medium text-sidebar-foreground/60">
          {stats.totalFiles} {stats.totalFiles === 1 ? 'file' : 'files'}
        </span>
      </div>
      <div className="h-1.5 bg-sidebar-border rounded-full overflow-hidden mb-1.5">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(usedPct, stats.totalSize > 0 ? 3 : 0)}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="h-full rounded-full gradient-primary"
        />
      </div>
      <p className="text-[10px] text-sidebar-foreground/50">
        {isByod
          ? `${formatBytes(stats.totalSize)} used • Unlimited (BYOD)`
          : `${formatBytes(stats.totalSize)} of ${formatBytes(MANAGED_QUOTA)} used`}
      </p>
    </div>
  );
}
