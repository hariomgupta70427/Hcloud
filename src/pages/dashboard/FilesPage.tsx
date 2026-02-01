import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, FolderPlus, Upload, Filter, ArrowUpDown, AlertCircle, Loader2, CheckCircle, X } from 'lucide-react';
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
import { PreviewModal, getPreviewType, PreviewFile } from '@/components/preview/PreviewModal';
import { FileItem } from '@/services/fileService';
import * as fileService from '@/services/fileService';
import { getFileFromTelegram } from '@/services/telegramService';
import { useUpload } from '@/hooks/useUpload';
import { toast } from 'sonner';

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
  const { uploadFiles, uploadingFiles, isUploading, clearCompleted } = useUpload();

  const [showUpload, setShowUpload] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('name');

  // Dialog states
  const [renameFile, setRenameFile] = useState<FileItem | null>(null);
  const [deleteFile, setDeleteFile] = useState<FileItem | null>(null);
  const [shareFile, setShareFile] = useState<FileItem | null>(null);
  const [moveFile, setMoveFile] = useState<FileItem | null>(null);

  // Preview state
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

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
    const filesArray = Array.from(fileList);
    await uploadFiles(filesArray);
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

  const handleFileClick = async (file: FileItem) => {
    if (file.type === 'folder') {
      navigateToFolder(file.id, file.name);
    } else {
      // Open file preview by fetching from Telegram
      if (!file.telegramFileId) {
        toast.error('File not available');
        return;
      }

      setIsLoadingPreview(true);
      toast.loading('Loading file...', { id: 'file-loading' });

      try {
        const result = await getFileFromTelegram(file.telegramFileId);

        if (result.success && result.downloadUrl) {
          const previewType = getPreviewType(file.name, file.mimeType);

          setPreviewFile({
            id: file.id,
            name: file.name,
            url: result.downloadUrl,
            type: previewType,
            mimeType: file.mimeType,
          });

          toast.dismiss('file-loading');
        } else {
          toast.error('Failed to load file', { id: 'file-loading' });
        }
      } catch (error: any) {
        console.error('Failed to load file:', error);
        toast.error('Failed to load file', { id: 'file-loading' });
      } finally {
        setIsLoadingPreview(false);
      }
    }
  };

  const handleDownloadFile = async (previewFile: PreviewFile) => {
    try {
      // Create a download link
      const link = document.createElement('a');
      link.href = previewFile.url;
      link.download = previewFile.name;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Downloading ${previewFile.name}`);
    } catch (error) {
      console.error('Download failed:', error);
      toast.error('Download failed');
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
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100]"
              onClick={() => !isUploading && setShowUpload(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{
                position: 'fixed',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 101,
                width: '90%',
                maxWidth: '500px',
                maxHeight: '80vh',
                overflow: 'auto',
              }}
              className="p-6 rounded-2xl bg-card border border-border shadow-2xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-foreground">Upload Files</h2>
                <button
                  onClick={() => !isUploading && setShowUpload(false)}
                  className="p-2 rounded-lg hover:bg-muted transition-colors"
                  disabled={isUploading}
                >
                  <X size={20} className="text-muted-foreground" />
                </button>
              </div>

              <UploadZone onFilesSelected={handleFilesSelected} />

              {/* Upload Progress */}
              {uploadingFiles.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-4 space-y-2 max-h-48 overflow-y-auto"
                >
                  {uploadingFiles.map((item, index) => (
                    <div
                      key={`${item.file.name}-${index}`}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                    >
                      {item.status === 'uploading' && (
                        <Loader2 className="w-4 h-4 text-primary animate-spin" />
                      )}
                      {item.status === 'success' && (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      )}
                      {item.status === 'error' && (
                        <AlertCircle className="w-4 h-4 text-red-500" />
                      )}
                      {item.status === 'pending' && (
                        <div className="w-4 h-4 rounded-full border-2 border-muted-foreground" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.file.name}</p>
                        {item.status === 'uploading' && (
                          <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <motion.div
                              className="h-full bg-primary rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${item.progress}%` }}
                            />
                          </div>
                        )}
                        {item.status === 'error' && (
                          <p className="text-xs text-red-500">{item.error}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {item.status === 'uploading' ? `${item.progress}%` : ''}
                      </span>
                    </div>
                  ))}
                </motion.div>
              )}

              <div className="mt-4 flex justify-end gap-2">
                {uploadingFiles.some(f => f.status === 'success' || f.status === 'error') && (
                  <button
                    onClick={clearCompleted}
                    className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear Completed
                  </button>
                )}
                <button
                  onClick={() => setShowUpload(false)}
                  disabled={isUploading}
                  className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {isUploading ? 'Uploading...' : 'Close'}
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
        onCreate={handleCreateFolder}
      />

      {renameFile && (
        <RenameDialog
          isOpen={!!renameFile}
          currentName={renameFile.name}
          onClose={() => setRenameFile(null)}
          onRename={handleRename}
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
          fileName={shareFile.name}
          onClose={() => setShareFile(null)}
          onCreateLink={async (options) => {
            await handleShare(options);
            return `${window.location.origin}/share/${shareFile.id}`;
          }}
          onCopyLink={(link) => navigator.clipboard.writeText(link)}
        />
      )}

      {moveFile && (
        <MoveDialog
          isOpen={!!moveFile}
          fileName={moveFile.name}
          currentFolderId={moveFile.parentId || undefined}
          folders={files.filter(f => f.type === 'folder' && f.id !== moveFile.id).map(f => ({
            id: f.id,
            name: f.name,
            parentId: f.parentId || undefined,
          }))}
          onClose={() => setMoveFile(null)}
          onMove={(folderId) => handleMove(folderId || '')}
        />
      )}

      {/* File Preview Modal */}
      <PreviewModal
        file={previewFile}
        isOpen={!!previewFile}
        onClose={() => setPreviewFile(null)}
        onDownload={handleDownloadFile}
      />
    </div>
  );
}
