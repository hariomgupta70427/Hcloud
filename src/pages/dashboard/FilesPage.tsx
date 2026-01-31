import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, FolderPlus, Upload, Filter, ArrowUpDown } from 'lucide-react';
import { useFileStore } from '@/stores/fileStore';
import { useUIStore } from '@/stores/uiStore';
import { FileCard } from '@/components/file/FileCard';
import { FileRow } from '@/components/file/FileRow';
import { UploadZone } from '@/components/file/UploadZone';
import { FolderBreadcrumb } from '@/components/file/FolderBreadcrumb';

export default function FilesPage() {
  const { files, currentFolder, selectedFiles, selectFile, clearSelection, toggleStar, removeFile } = useFileStore();
  const { viewMode, searchQuery } = useUIStore();
  const [showUpload, setShowUpload] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('name');

  // Filter files by current folder and search query
  const filteredFiles = files
    .filter(f => f.parentId === currentFolder)
    .filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      // Folders first
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;
      
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'date':
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case 'size':
          return (b.size || 0) - (a.size || 0);
        default:
          return 0;
      }
    });

  const handleFilesSelected = (files: FileList) => {
    console.log('Files selected:', files);
    // Handle upload
    setShowUpload(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <FolderBreadcrumb items={[]} />
          <h1 className="text-2xl font-bold text-foreground mt-2">My Files</h1>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Sort dropdown */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSortBy(sortBy === 'name' ? 'date' : sortBy === 'date' ? 'size' : 'name')}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ArrowUpDown size={16} />
              <span className="capitalize">{sortBy}</span>
            </button>
          </div>

          {/* Filter button */}
          <button className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Filter size={16} />
            Filter
          </button>

          {/* New folder button */}
          <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors">
            <FolderPlus size={18} />
            <span>New Folder</span>
          </button>

          {/* Upload button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl gradient-primary text-white shadow-lg shadow-primary/25"
          >
            <Upload size={18} />
            <span>Upload</span>
          </motion.button>
        </div>
      </div>

      {/* Upload Modal */}
      <AnimatePresence>
        {showUpload && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-40"
              onClick={() => setShowUpload(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-x-4 top-1/2 -translate-y-1/2 max-w-xl mx-auto p-6 rounded-2xl bg-card border border-border shadow-2xl z-50"
            >
              <h2 className="text-xl font-semibold text-foreground mb-4">Upload Files</h2>
              <UploadZone onFilesSelected={handleFilesSelected} />
              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setShowUpload(false)}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Files */}
      {filteredFiles.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20"
        >
          <div className="w-20 h-20 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
            <Upload className="w-10 h-10 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-1">No files yet</h3>
          <p className="text-muted-foreground mb-6">Upload your first file to get started</p>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-6 py-3 rounded-xl gradient-primary text-white shadow-lg shadow-primary/25"
          >
            <Plus size={20} />
            Upload Files
          </button>
        </motion.div>
      ) : viewMode === 'grid' ? (
        <motion.div 
          layout
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
        >
          <AnimatePresence>
            {filteredFiles.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                isSelected={selectedFiles.includes(file.id)}
                onSelect={selectFile}
                onStar={toggleStar}
                onDelete={removeFile}
              />
            ))}
          </AnimatePresence>
        </motion.div>
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
              <AnimatePresence>
                {filteredFiles.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    isSelected={selectedFiles.includes(file.id)}
                    onSelect={selectFile}
                    onStar={toggleStar}
                    onDelete={removeFile}
                  />
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      {/* Selection info */}
      <AnimatePresence>
        {selectedFiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 px-6 py-3 rounded-2xl bg-card border border-border shadow-2xl"
          >
            <span className="text-sm text-foreground">
              {selectedFiles.length} item{selectedFiles.length > 1 ? 's' : ''} selected
            </span>
            <button
              onClick={clearSelection}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Clear
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
