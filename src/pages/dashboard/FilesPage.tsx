import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, FolderPlus, Upload, Filter, ArrowUpDown, AlertCircle, Search, Trash2, Star } from 'lucide-react';
import { useFileStore } from '@/stores/fileStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { FileCard } from '@/components/file/FileCard';
import { FileRow } from '@/components/file/FileRow';
import { UploadModal } from '@/components/file/UploadModal';
import { FolderBreadcrumb } from '@/components/file/FolderBreadcrumb';
import { NewFolderDialog } from '@/components/file/NewFolderDialog';
import { RenameDialog } from '@/components/file/RenameDialog';
import { DeleteConfirmDialog } from '@/components/file/DeleteConfirmDialog';
import { ShareDialog } from '@/components/file/ShareDialog';
import { MoveDialog } from '@/components/file/MoveDialog';
import { FileCardSkeleton } from '@/components/common/Skeleton';
import { EmptyState } from '@/components/common/EmptyState';
import { PreviewModal } from '@/components/preview/PreviewModal';
import { FileItem } from '@/services/fileService';
import * as fileService from '@/services/fileService';
import { getFileCategory } from '@/lib/fileTypes';
import { useUpload } from '@/hooks/useUpload';
import { useFileActions } from '@/hooks/useFileActions';
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
  const { viewMode, searchQuery, setSearchQuery } = useUIStore();
  const { uploadFiles, uploadingFiles, isUploading, clearCompleted } = useUpload();

  const [showUpload, setShowUpload] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'date' | 'size'>('name');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Page-level drag & drop handlers
  const handlePageDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }, []);

  const handlePageDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only hide if leaving the page container itself
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  }, []);

  const handlePageDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  }, []);

  // Dialog states
  const [renameFile, setRenameFile] = useState<FileItem | null>(null);
  const [deleteFile, setDeleteFile] = useState<FileItem | null>(null);
  const [shareFile, setShareFile] = useState<FileItem | null>(null);
  const [moveFile, setMoveFile] = useState<FileItem | null>(null);

  // Preview / open / download are handled by the shared hook so this page
  // cannot drift out of sync with Starred, Recent, Shared and the Dashboard.
  const {
    previewFile,
    isLoadingPreview,
    openFile,
    downloadFile,
    downloadPreviewFile,
    closePreview,
  } = useFileActions({
    onOpenFolder: (folder) => navigateToFolder(folder.id, folder.name),
  });

  const [searchResults, setSearchResults] = useState<FileItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [allFolders, setAllFolders] = useState<FileItem[]>([]);

  // Load files on mount and when folder changes
  useEffect(() => {
    if (user?.id && !searchQuery) {
      loadFiles(user.id, currentFolder);
      setSearchResults([]); // Clear search results when navigating
    }
  }, [user?.id, currentFolder, loadFiles, searchQuery]);

  // Load all folders only when MoveDialog is about to open
  useEffect(() => {
    if (user?.id && moveFile) {
      fileService.getAllFolders(user.id).then(setAllFolders).catch(console.error);
    }
  }, [user?.id, moveFile]);

  // Global search when searchQuery changes
  useEffect(() => {
    if (!user?.id || !searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const performSearch = async () => {
      setIsSearching(true);
      try {
        const results = await fileService.searchFiles(user.id, searchQuery.trim());
        setSearchResults(results);
      } catch (error) {
        console.error('Search failed:', error);
        toast.error('Search failed');
      } finally {
        setIsSearching(false);
      }
    };

    // Debounce search
    const timeoutId = setTimeout(performSearch, 300);
    return () => clearTimeout(timeoutId);
  }, [user?.id, searchQuery]);

  // Use search results when searching, otherwise use folder files
  const displayFiles = searchQuery.trim() ? searchResults : files;

  // Sort display files
  const filteredFiles = displayFiles
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
    })
    .filter((file) => {
      if (!filterType) return true;
      if (filterType === 'folders') return file.type === 'folder';
      if (file.type === 'folder') return false;

      // Classify by MIME *and* filename. A mime-only test used to hide every
      // .mkv/.flac/.m4v file from the Videos/Audio filters, because the browser
      // reports no type for those and they were stored as octet-stream.
      const category = getFileCategory(file.name, file.mimeType);
      switch (filterType) {
        case 'images': return category === 'image';
        case 'videos': return category === 'video';
        case 'audio': return category === 'audio';
        case 'documents': return category === 'document';
        case 'archives': return category === 'archive';
        case 'code': return category === 'code';
        default: return true;
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
    if (!shareFile) return '';
    // Do NOT close the dialog here — the ShareDialog needs to stay open to
    // display the generated link so the user can copy it. Closing it (the old
    // behaviour) is exactly why "I can't get the link" happened.
    //
    // No BYOD session is threaded through any more: the session never leaves the
    // device, and the store supplies the file metadata the mint endpoint needs.
    return await shareItem(shareFile.id, settings);
  };

  const handleFileAction = async (action: string, file: FileItem) => {
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
        // Delegated to the shared hook: it asks the server for
        // `Content-Disposition: attachment` (the only thing that actually forces
        // a save for cross-origin BYOD URLs) and cleans up any blob it created.
        await downloadFile(file);
        break;
    }
  };

  return (
    <div
      className="space-y-6 relative"
      onDragOver={handlePageDragOver}
      onDragLeave={handlePageDragLeave}
      onDrop={handlePageDrop}
    >
      {/* Drag overlay */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-50 bg-primary/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="p-8 rounded-2xl bg-card border-2 border-dashed border-primary shadow-2xl text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <Upload className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold text-foreground">Drop files to upload</h3>
            <p className="text-sm text-muted-foreground mt-1">Files will be uploaded to the current folder</p>
          </div>
        </div>
      )}
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
          <div className="relative">
            <button
              onClick={() => setShowFilterMenu(!showFilterMenu)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                filterType
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              <Filter size={16} />
              {filterType ? filterType.charAt(0).toUpperCase() + filterType.slice(1) : 'Filter'}
              {filterType && (
                <span
                  onClick={(e) => { e.stopPropagation(); setFilterType(null); setShowFilterMenu(false); }}
                  className="ml-1 w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center text-xs hover:bg-primary/40"
                >
                  ×
                </span>
              )}
            </button>
            {showFilterMenu && (
              <div className="absolute top-full mt-1 right-0 w-48 bg-card border border-border rounded-xl shadow-lg z-50 py-1 overflow-hidden">
                {[
                  { id: 'images', label: '🖼️ Images' },
                  { id: 'videos', label: '🎬 Videos' },
                  { id: 'audio', label: '🎵 Audio' },
                  { id: 'documents', label: '📄 Documents' },
                  { id: 'archives', label: '📦 Archives' },
                  { id: 'code', label: '💻 Code' },
                  { id: 'folders', label: '📁 Folders' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => { setFilterType(filterType === opt.id ? null : opt.id); setShowFilterMenu(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                      filterType === opt.id
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

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
      <UploadModal
        isOpen={showUpload}
        onClose={() => setShowUpload(false)}
        onFilesSelected={handleFilesSelected}
        uploadingFiles={uploadingFiles}
        isUploading={isUploading}
        onClearCompleted={clearCompleted}
      />

      {/* Search indicator */}
      {searchQuery.trim() && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-lg bg-primary/10 border border-primary/20 flex items-center gap-2 text-sm text-primary"
        >
          <Search size={16} />
          <span>
            {isSearching
              ? 'Searching...'
              : `Found ${filteredFiles.length} result${filteredFiles.length !== 1 ? 's' : ''} for "${searchQuery}"`
            }
          </span>
          <button
            onClick={() => setSearchQuery('')}
            className="ml-auto text-xs underline hover:no-underline"
          >
            Clear search
          </button>
        </motion.div>
      )}

      {/* Loading State */}
      {isLoading || isSearching ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <FileCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredFiles.length === 0 ? (
        searchQuery.trim() ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-16 text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
              <Search size={32} className="text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">No files found</h3>
            <p className="text-muted-foreground text-sm mb-4">
              No files or folders match "{searchQuery}"
            </p>
            <button
              onClick={() => setSearchQuery('')}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              Clear Search
            </button>
          </motion.div>
        ) : (
          <EmptyState
            type={currentFolder ? 'folder' : 'files'}
            onAction={() => setShowUpload(true)}
          />
        )
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
                onClick={() => openFile(file)}
                onStar={() => toggleStar(file.id)}
                onDelete={() => setDeleteFile(file)}
                onRename={() => setRenameFile(file)}
                onShare={() => setShareFile(file)}
                onMove={() => setMoveFile(file)}
                onDownload={() => downloadFile(file)}
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
                    onClick={() => openFile(file)}
                    onStar={() => toggleStar(file.id)}
                    onDelete={() => setDeleteFile(file)}
                    onRename={() => setRenameFile(file)}
                    onShare={() => setShareFile(file)}
                    onMove={() => setMoveFile(file)}
                    onDownload={() => downloadFile(file)}
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
            className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 px-6 py-3 rounded-2xl bg-card border border-border shadow-2xl z-40"
          >
            <span className="text-sm font-medium text-foreground">
              {selectedFiles.length} item{selectedFiles.length > 1 ? 's' : ''} selected
            </span>
            <div className="w-px h-5 bg-border" />
            <button
              onClick={async () => {
                for (const id of selectedFiles) {
                  try { await toggleStar(id); } catch { /* ignore */ }
                }
                clearSelection();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Star selected"
            >
              <Star size={14} />
              Star
            </button>
            <button
              onClick={async () => {
                if (!confirm(`Delete ${selectedFiles.length} item${selectedFiles.length > 1 ? 's' : ''}?`)) return;
                for (const id of selectedFiles) {
                  try { await deleteItem(id); } catch { /* ignore */ }
                }
                clearSelection();
                toast.success(`Deleted ${selectedFiles.length} item${selectedFiles.length > 1 ? 's' : ''}`);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete selected"
            >
              <Trash2 size={14} />
              Delete
            </button>
            <div className="w-px h-5 bg-border" />
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
          existingLink={shareFile.isShared ? `${window.location.origin}/s/${shareFile.id}` : undefined}
          onClose={() => setShareFile(null)}
          onCreateLink={handleShare}
          onCopyLink={() => toast.success('Link copied to clipboard')}
        />
      )}

      {moveFile && (
        <MoveDialog
          isOpen={!!moveFile}
          fileName={moveFile.name}
          currentFolderId={moveFile.parentId || undefined}
          folders={allFolders.filter(f => f.id !== moveFile.id).map(f => ({
            id: f.id,
            name: f.name,
            parentId: f.parentId || undefined,
          }))}
          onClose={() => setMoveFile(null)}
          onMove={(folderId) => handleMove(folderId)}
        />
      )}

      {/* File Preview Modal */}
      <PreviewModal
        file={previewFile}
        isOpen={!!previewFile}
        onClose={closePreview}
        onDownload={downloadPreviewFile}
      />
    </div>
  );
}
