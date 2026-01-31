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
  shareLink?: string;
}

export interface UploadFile {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  createdAt: Date;
}

export interface ShareSettings {
  isPublic: boolean;
  allowDownload: boolean;
  expiresAt?: Date;
  password?: string;
}
