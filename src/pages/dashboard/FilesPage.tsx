import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, FolderPlus, Upload, Filter, ArrowUpDown, AlertCircle } from 'lucide-react';
import { useFileStore } from '@/stores/fileStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { FileCard } from '@/components/file/FileCard';
import { FileRow } from '@/components/file/FileRow';
import { UploadZone } from '@/components/file/UploadZone';
import { FolderBreadcrumb } from '@/components/file/FolderBreadcrumb';
import { NewFolderDialog } from '@/components/file/NewFolderDialog';
import { RenameDialog } from '@/components/file/RenameDialog';
import { DeleteConfirmDialog } from '@/components/file/DeleteConfirmDialog';
import { ShareDialog } from '@/components/file/ShareDialog';
import { MoveDialog } from '@/components/file/MoveDialog';
import { FileCardSkeleton } from '@/components/common/Skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { FileItem } from '@/services/fileService';
import * as fileService from '@/services/fileService';

export default function FilesPage() {
  const { user } = useAuthStore();
  const {
    files,
    currentFolder,
    currentFolderPath,
    selectedFiles,
    isLoading,
    error,
    loadFiles,
    navigateToFolder,
    selectFile,
    clearSelection,
    toggleStar,
    deleteItem,
    createFolder,
    renameItem,
    moveItem,
    shareItem,
  } = useFileStore();
  const { viewMode, searchQuery } = useUIStore();

  const [showUpload, setShowUpload] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('name');

  // Dialog states
  const [renameFile, setRenameFile] = useState<FileItem | null>(null);
  const [deleteFile, setDeleteFile] = useState<FileItem | null>(null);
  const [shareFile, setShareFile] = useState<FileItem | null>(null);
  const [moveFile, setMoveFile] = useState<FileItem | null>(null);

  // Load files on mount and when folder changes
  useEffect(() => {
    if (user?.id) {
      loadFiles(user.id, currentFolder);
    }
  }, [user?.id, currentFolder, loadFiles]);

  // Filter files by search query
  const filteredFiles = files
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

  const handleFilesSelected = async (fileList: FileList) => {
    if (!user?.id) return;

    // TODO: Implement Telegram upload
    // For now, just log and close
    console.log('Files to upload:', Array.from(fileList));
    setShowUpload(false);
  };

  const handleCreateFolder = async (name: string) => {
    if (!user?.id) return;
    try {
      await createFolder(name, user.id);
      setShowNewFolder(false);
    } catch (err) {
      console.error('Failed to create folder:', err);
    }
  };

  const handleRename = async (newName: string) => {
    if (!renameFile) return;
    try {
      await renameItem(renameFile.id, newName);
      setRenameFile(null);
    } catch (err) {
      console.error('Failed to rename:', err);
    }
  };

  const handleDelete = async () => {
    if (!deleteFile) return;
    try {
      await deleteItem(deleteFile.id);
      setDeleteFile(null);
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const handleMove = async (targetFolderId: string | null) => {
    if (!moveFile) return;
    try {
      await moveItem(moveFile.id, targetFolderId);
      setMoveFile(null);
    } catch (err) {
      console.error('Failed to move:', err);
    }
  };

  const handleShare = async (settings: { password?: string; expiresAt?: Date }) => {
    if (!shareFile) return;
    try {
      await shareItem(shareFile.id, settings);
      setShareFile(null);
    } catch (err) {
      console.error('Failed to share:', err);
    }
  };

  const handleFileClick = (file: FileItem) => {
    if (file.type === 'folder') {
      navigateToFolder(file.id, file.name);
    } else {
      // Open file preview
      selectFile(file.id);
    }
  };

  const handleFileAction = (action: string, file: FileItem) => {
    switch (action) {
      case 'rename':
        setRenameFile(file);
        break;
      case 'delete':
        setDeleteFile(file);
        break;
      case 'share':
        setShareFile(file);
        break;
      case 'move':
        setMoveFile(file);
        break;
      case 'star':
        toggleStar(file.id);
        break;
      case 'download':
        // TODO: Implement download
        console.log('Download:', file);
        break;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <FolderBreadcrumb
            items={currentFolderPath.map(p => ({ id: p.id, name: p.name }))}
            onNavigate={(id) => navigateToFolder(id)}
          />
          <h1 className="text-2xl font-bold text-foreground mt-2">
            {currentFolderPath[currentFolderPath.length - 1]?.name || 'My Files'}
          </h1>
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
          <button
            onClick={() => setShowNewFolder(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
          >
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

      {/* Error Alert */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 flex items-center gap-2 text-sm text-destructive"
          >
            <AlertCircle size={16} />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Loading State */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <FileCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredFiles.length === 0 ? (
        <EmptyState
          type={currentFolder ? 'folder' : 'files'}
          onAction={() => setShowUpload(true)}
        />
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
                onSelect={() => selectFile(file.id)}
                onClick={() => handleFileClick(file)}
                onStar={() => toggleStar(file.id)}
                onDelete={() => setDeleteFile(file)}
                onRename={() => setRenameFile(file)}
                onShare={() => setShareFile(file)}
                onMove={() => setMoveFile(file)}
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
                    onSelect={() => selectFile(file.id)}
                    onClick={() => handleFileClick(file)}
                    onStar={() => toggleStar(file.id)}
                    onDelete={() => setDeleteFile(file)}
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

      {/* Dialogs */}
      <NewFolderDialog
        isOpen={showNewFolder}
        onClose={() => setShowNewFolder(false)}
        onConfirm={handleCreateFolder}
      />

      {renameFile && (
        <RenameDialog
          isOpen={!!renameFile}
          fileName={renameFile.name}
          onClose={() => setRenameFile(null)}
          onConfirm={handleRename}
        />
      )}

      {deleteFile && (
        <DeleteConfirmDialog
          isOpen={!!deleteFile}
          fileName={deleteFile.name}
          isFolder={deleteFile.type === 'folder'}
          onClose={() => setDeleteFile(null)}
          onConfirm={handleDelete}
        />
      )}

      {shareFile && (
        <ShareDialog
          isOpen={!!shareFile}
          file={shareFile}
          onClose={() => setShareFile(null)}
          onShare={handleShare}
        />
      )}

      {moveFile && (
        <MoveDialog
          isOpen={!!moveFile}
          file={moveFile}
          folders={files.filter(f => f.type === 'folder' && f.id !== moveFile.id)}
          onClose={() => setMoveFile(null)}
          onMove={handleMove}
        />
      )}
    </div>
  );
}
