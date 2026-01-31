import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { FileCard } from '@/components/file/FileCard';
import { FileRow } from '@/components/file/FileRow';

export default function RecentPage() {
  const { files, selectedFiles, selectFile, toggleStar, removeFile } = useFileStore();
  const { viewMode } = useUIStore();

  const recentFiles = files
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 20);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Recent</h1>
        <p className="text-muted-foreground mt-1">
          Recently modified files
        </p>
      </div>

      {recentFiles.length === 0 ? (
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
              onSelect={selectFile}
              onStar={toggleStar}
              onDelete={removeFile}
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
                  onSelect={selectFile}
                  onStar={toggleStar}
                  onDelete={removeFile}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
