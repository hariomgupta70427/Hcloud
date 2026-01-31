import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { FileCard } from '@/components/file/FileCard';
import { FileRow } from '@/components/file/FileRow';

export default function SharedPage() {
  const { files, selectedFiles, selectFile, toggleStar, removeFile } = useFileStore();
  const { viewMode } = useUIStore();

  const sharedFiles = files.filter(f => f.isShared);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Shared</h1>
        <p className="text-muted-foreground mt-1">
          {sharedFiles.length} shared item{sharedFiles.length !== 1 ? 's' : ''}
        </p>
      </div>

      {sharedFiles.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20"
        >
          <div className="w-20 h-20 rounded-2xl bg-green-500/10 flex items-center justify-center mb-4">
            <Users className="w-10 h-10 text-green-500" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">No shared files</h3>
          <p className="text-muted-foreground">Files you share with others will appear here</p>
        </motion.div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {sharedFiles.map((file) => (
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
              {sharedFiles.map((file) => (
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
