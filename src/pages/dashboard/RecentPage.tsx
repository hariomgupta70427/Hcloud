import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { useFileStore } from '@/stores/fileStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { FileCard } from '@/components/file/FileCard';
import { FileRow } from '@/components/file/FileRow';
import { FileCardSkeleton } from '@/components/common/Skeleton';
import { PreviewModal } from '@/components/preview/PreviewModal';
import { useFileActions } from '@/hooks/useFileActions';

export default function RecentPage() {
  const { user } = useAuthStore();
  const {
    files,
    selectedFiles,
    isLoading,
    loadRecentFiles,
    selectFile,
    toggleStar,
    deleteItem,
  } = useFileStore();
  const { viewMode } = useUIStore();
  const { previewFile, openFile, downloadFile, downloadPreviewFile, closePreview } = useFileActions();

  // Load recent files on mount
  useEffect(() => {
    if (user?.id) {
      loadRecentFiles(user.id);
    }
  }, [user?.id, loadRecentFiles]);

  // Store already returns files sorted by updatedAt desc, limited to 20.
  const recentFiles = files;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Recent</h1>
        <p className="text-muted-foreground mt-1">Recently modified files</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <FileCardSkeleton key={i} />
          ))}
        </div>
      ) : recentFiles.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20"
        >
          <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
            <Clock className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">No recent files</h3>
          <p className="text-muted-foreground">Your recently accessed files will appear here</p>
        </motion.div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {recentFiles.map((file) => (
            <FileCard
              key={file.id}
              file={file}
              isSelected={selectedFiles.includes(file.id)}
              onSelect={() => selectFile(file.id)}
              onClick={() => openFile(file)}
              onStar={() => toggleStar(file.id)}
              onDelete={() => deleteItem(file.id)}
              onDownload={() => downloadFile(file)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/30 text-left">
                <th className="py-3 px-4 text-sm font-medium text-muted-foreground">Name</th>
                <th className="py-3 px-4 text-sm font-medium text-muted-foreground">Size</th>
                <th className="py-3 px-4 text-sm font-medium text-muted-foreground">Modified</th>
                <th className="py-3 px-4 text-sm font-medium text-muted-foreground text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recentFiles.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  isSelected={selectedFiles.includes(file.id)}
                  onSelect={() => selectFile(file.id)}
                  onClick={() => openFile(file)}
                  onStar={() => toggleStar(file.id)}
                  onDelete={() => deleteItem(file.id)}
                  onDownload={() => downloadFile(file)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PreviewModal
        file={previewFile}
        isOpen={!!previewFile}
        onClose={closePreview}
        onDownload={downloadPreviewFile}
      />
    </div>
  );
}
