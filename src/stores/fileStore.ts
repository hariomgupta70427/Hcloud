import { create } from 'zustand';
import * as fileService from '@/services/fileService';
import { FileItem } from '@/services/fileService';

// Re-export FileItem type
export type { FileItem };

interface FileState {
  files: FileItem[];
  currentFolder: string | null;
  currentFolderPath: { id: string | null; name: string }[];
  selectedFiles: string[];
  isLoading: boolean;
  uploadProgress: Record<string, number>;
  error: string | null;

  // Actions
  setFiles: (files: FileItem[]) => void;
  loadFiles: (userId: string, folderId?: string | null) => Promise<void>;
  loadStarredFiles: (userId: string) => Promise<void>;
  loadRecentFiles: (userId: string) => Promise<void>;
  loadSharedFiles: (userId: string) => Promise<void>;
  loadTrashFiles: (userId: string) => Promise<void>;
  addFile: (file: FileItem) => void;
  removeFile: (id: string) => void;
  updateFile: (id: string, updates: Partial<FileItem>) => void;
  setCurrentFolder: (folderId: string | null, folderName?: string) => void;
  navigateToFolder: (folderId: string | null, folderName?: string) => void;
  navigateUp: () => void;
  selectFile: (id: string, multiSelect?: boolean) => void;
  clearSelection: () => void;
  toggleStar: (id: string) => Promise<void>;
  createFolder: (name: string, userId: string) => Promise<FileItem>;
  renameItem: (id: string, newName: string) => Promise<void>;
  moveItem: (id: string, targetFolderId: string | null) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  shareItem: (id: string, settings: { password?: string; expiresAt?: Date }) => Promise<string>;
  setLoading: (loading: boolean) => void;
  setUploadProgress: (fileId: string, progress: number) => void;
  removeUploadProgress: (fileId: string) => void;
  setError: (error: string | null) => void;
}

export const useFileStore = create<FileState>((set, get) => ({
  files: [],
  currentFolder: null,
  currentFolderPath: [{ id: null, name: 'My Files' }],
  selectedFiles: [],
  isLoading: false,
  uploadProgress: {},
  error: null,

  setFiles: (files) => set({ files }),

  loadFiles: async (userId, folderId = null) => {
    set({ isLoading: true, error: null });
    try {
      const files = await fileService.getFilesInFolder(userId, folderId);
      set({ files, isLoading: false });
    } catch (error) {
      console.error('Error loading files:', error);
      set({ isLoading: false, error: 'Failed to load files' });
    }
  },

  loadStarredFiles: async (userId) => {
    set({ isLoading: true, error: null });
    try {
      const files = await fileService.getStarredFiles(userId);
      set({ files, isLoading: false });
    } catch (error) {
      console.error('Error loading starred files:', error);
      set({ isLoading: false, error: 'Failed to load starred files' });
    }
  },

  loadRecentFiles: async (userId) => {
    set({ isLoading: true, error: null });
    try {
      const files = await fileService.getRecentFiles(userId);
      set({ files, isLoading: false });
    } catch (error) {
      console.error('Error loading recent files:', error);
      set({ isLoading: false, error: 'Failed to load recent files' });
    }
  },

  loadSharedFiles: async (userId) => {
    set({ isLoading: true, error: null });
    try {
      const files = await fileService.getSharedFiles(userId);
      set({ files, isLoading: false });
    } catch (error) {
      console.error('Error loading shared files:', error);
      set({ isLoading: false, error: 'Failed to load shared files' });
    }
  },

  loadTrashFiles: async (userId) => {
    set({ isLoading: true, error: null });
    try {
      const files = await fileService.getTrashItems(userId);
      set({ files, isLoading: false });
    } catch (error) {
      console.error('Error loading trash:', error);
      set({ isLoading: false, error: 'Failed to load trash' });
    }
  },

  addFile: (file) => set((state) => ({ files: [...state.files, file] })),

  removeFile: (id) => set((state) => ({
    files: state.files.filter((f) => f.id !== id),
    selectedFiles: state.selectedFiles.filter((fid) => fid !== id),
  })),

  updateFile: (id, updates) => set((state) => ({
    files: state.files.map((f) => (f.id === id ? { ...f, ...updates } : f)),
  })),

  setCurrentFolder: (folderId, folderName) => {
    if (folderId === null) {
      set({
        currentFolder: null,
        currentFolderPath: [{ id: null, name: 'My Files' }],
        selectedFiles: []
      });
    } else {
      set({ currentFolder: folderId, selectedFiles: [] });
    }
  },

  navigateToFolder: (folderId, folderName = 'Folder') => {
    const { currentFolderPath } = get();

    // Check if we're navigating to a folder in our path
    const existingIndex = currentFolderPath.findIndex((p) => p.id === folderId);

    if (existingIndex !== -1) {
      // Navigate back in path
      set({
        currentFolder: folderId,
        currentFolderPath: currentFolderPath.slice(0, existingIndex + 1),
        selectedFiles: [],
      });
    } else {
      // Navigate into new folder
      set({
        currentFolder: folderId,
        currentFolderPath: [...currentFolderPath, { id: folderId, name: folderName }],
        selectedFiles: [],
      });
    }
  },

  navigateUp: () => {
    const { currentFolderPath } = get();
    if (currentFolderPath.length > 1) {
      const newPath = currentFolderPath.slice(0, -1);
      const parentFolder = newPath[newPath.length - 1];
      set({
        currentFolder: parentFolder.id,
        currentFolderPath: newPath,
        selectedFiles: [],
      });
    }
  },

  selectFile: (id, multiSelect = false) => set((state) => {
    if (multiSelect) {
      const isSelected = state.selectedFiles.includes(id);
      return {
        selectedFiles: isSelected
          ? state.selectedFiles.filter((fid) => fid !== id)
          : [...state.selectedFiles, id],
      };
    }
    return { selectedFiles: [id] };
  }),

  clearSelection: () => set({ selectedFiles: [] }),

  toggleStar: async (id) => {
    try {
      const newStarred = await fileService.toggleStar(id);
      set((state) => ({
        files: state.files.map((f) =>
          f.id === id ? { ...f, isStarred: newStarred } : f
        ),
      }));
    } catch (error) {
      console.error('Error toggling star:', error);
      throw error;
    }
  },

  createFolder: async (name, userId) => {
    const { currentFolder } = get();
    try {
      const folder = await fileService.createFolder({
        name,
        parentId: currentFolder,
        userId,
      });
      set((state) => ({ files: [folder, ...state.files] }));
      return folder;
    } catch (error) {
      console.error('Error creating folder:', error);
      throw error;
    }
  },

  renameItem: async (id, newName) => {
    try {
      await fileService.renameItem(id, newName);
      set((state) => ({
        files: state.files.map((f) =>
          f.id === id ? { ...f, name: newName } : f
        ),
      }));
    } catch (error) {
      console.error('Error renaming item:', error);
      throw error;
    }
  },

  moveItem: async (id, targetFolderId) => {
    try {
      await fileService.moveItem(id, targetFolderId);
      // Remove from current view if moved to different folder
      set((state) => ({
        files: state.files.filter((f) => f.id !== id),
        selectedFiles: state.selectedFiles.filter((fid) => fid !== id),
      }));
    } catch (error) {
      console.error('Error moving item:', error);
      throw error;
    }
  },

  deleteItem: async (id) => {
    try {
      await fileService.moveToTrash(id);
      set((state) => ({
        files: state.files.filter((f) => f.id !== id),
        selectedFiles: state.selectedFiles.filter((fid) => fid !== id),
      }));
    } catch (error) {
      console.error('Error deleting item:', error);
      throw error;
    }
  },

  shareItem: async (id, settings) => {
    try {
      const shareLink = await fileService.shareFile(id, settings);
      set((state) => ({
        files: state.files.map((f) =>
          f.id === id ? { ...f, isShared: true } : f
        ),
      }));
      return shareLink;
    } catch (error) {
      console.error('Error sharing item:', error);
      throw error;
    }
  },

  setLoading: (isLoading) => set({ isLoading }),

  setUploadProgress: (fileId, progress) => set((state) => ({
    uploadProgress: { ...state.uploadProgress, [fileId]: progress },
  })),

  removeUploadProgress: (fileId) => set((state) => {
    const { [fileId]: _, ...rest } = state.uploadProgress;
    return { uploadProgress: rest };
  }),

  setError: (error) => set({ error }),
}));
