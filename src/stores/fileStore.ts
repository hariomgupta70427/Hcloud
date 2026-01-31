import { create } from 'zustand';

export interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  mimeType?: string;
  size?: number;
  createdAt: Date;
  updatedAt: Date;
  parentId: string | null;
  isStarred: boolean;
  isShared: boolean;
  thumbnail?: string;
  path: string;
}

interface FileState {
  files: FileItem[];
  currentFolder: string | null;
  selectedFiles: string[];
  isLoading: boolean;
  uploadProgress: Record<string, number>;
  
  // Actions
  setFiles: (files: FileItem[]) => void;
  addFile: (file: FileItem) => void;
  removeFile: (id: string) => void;
  updateFile: (id: string, updates: Partial<FileItem>) => void;
  setCurrentFolder: (folderId: string | null) => void;
  selectFile: (id: string, multiSelect?: boolean) => void;
  clearSelection: () => void;
  toggleStar: (id: string) => void;
  setLoading: (loading: boolean) => void;
  setUploadProgress: (fileId: string, progress: number) => void;
  removeUploadProgress: (fileId: string) => void;
}

// Mock initial files
const mockFiles: FileItem[] = [
  {
    id: '1',
    name: 'Documents',
    type: 'folder',
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-20'),
    parentId: null,
    isStarred: true,
    isShared: false,
    path: '/Documents',
  },
  {
    id: '2',
    name: 'Photos',
    type: 'folder',
    createdAt: new Date('2024-01-10'),
    updatedAt: new Date('2024-01-18'),
    parentId: null,
    isStarred: false,
    isShared: true,
    path: '/Photos',
  },
  {
    id: '3',
    name: 'Projects',
    type: 'folder',
    createdAt: new Date('2024-01-05'),
    updatedAt: new Date('2024-01-22'),
    parentId: null,
    isStarred: false,
    isShared: false,
    path: '/Projects',
  },
  {
    id: '4',
    name: 'report-2024.pdf',
    type: 'file',
    mimeType: 'application/pdf',
    size: 2500000,
    createdAt: new Date('2024-01-20'),
    updatedAt: new Date('2024-01-20'),
    parentId: null,
    isStarred: true,
    isShared: false,
    path: '/report-2024.pdf',
  },
  {
    id: '5',
    name: 'presentation.pptx',
    type: 'file',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    size: 5800000,
    createdAt: new Date('2024-01-18'),
    updatedAt: new Date('2024-01-19'),
    parentId: null,
    isStarred: false,
    isShared: true,
    path: '/presentation.pptx',
  },
  {
    id: '6',
    name: 'budget.xlsx',
    type: 'file',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 150000,
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-21'),
    parentId: null,
    isStarred: false,
    isShared: false,
    path: '/budget.xlsx',
  },
  {
    id: '7',
    name: 'notes.txt',
    type: 'file',
    mimeType: 'text/plain',
    size: 2500,
    createdAt: new Date('2024-01-22'),
    updatedAt: new Date('2024-01-22'),
    parentId: null,
    isStarred: false,
    isShared: false,
    path: '/notes.txt',
  },
  {
    id: '8',
    name: 'logo.png',
    type: 'file',
    mimeType: 'image/png',
    size: 450000,
    createdAt: new Date('2024-01-12'),
    updatedAt: new Date('2024-01-12'),
    parentId: null,
    isStarred: true,
    isShared: false,
    path: '/logo.png',
  },
];

export const useFileStore = create<FileState>((set) => ({
  files: mockFiles,
  currentFolder: null,
  selectedFiles: [],
  isLoading: false,
  uploadProgress: {},

  setFiles: (files) => set({ files }),

  addFile: (file) => set((state) => ({ files: [...state.files, file] })),

  removeFile: (id) => set((state) => ({ 
    files: state.files.filter((f) => f.id !== id),
    selectedFiles: state.selectedFiles.filter((fid) => fid !== id),
  })),

  updateFile: (id, updates) => set((state) => ({
    files: state.files.map((f) => (f.id === id ? { ...f, ...updates } : f)),
  })),

  setCurrentFolder: (folderId) => set({ currentFolder: folderId, selectedFiles: [] }),

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

  toggleStar: (id) => set((state) => ({
    files: state.files.map((f) => 
      f.id === id ? { ...f, isStarred: !f.isStarred } : f
    ),
  })),

  setLoading: (isLoading) => set({ isLoading }),

  setUploadProgress: (fileId, progress) => set((state) => ({
    uploadProgress: { ...state.uploadProgress, [fileId]: progress },
  })),

  removeUploadProgress: (fileId) => set((state) => {
    const { [fileId]: _, ...rest } = state.uploadProgress;
    return { uploadProgress: rest };
  }),
}));
