export const APP_NAME = 'HCloud';
export const APP_DESCRIPTION = 'Unlimited cloud storage powered by Telegram';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export const FILE_ICONS: Record<string, string> = {
  'application/pdf': 'file-text',
  'application/msword': 'file-text',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'file-text',
  'application/vnd.ms-excel': 'file-spreadsheet',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'file-spreadsheet',
  'application/vnd.ms-powerpoint': 'file-presentation',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'file-presentation',
  'text/plain': 'file-text',
  'text/html': 'file-code',
  'text/css': 'file-code',
  'text/javascript': 'file-code',
  'application/json': 'file-code',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/svg+xml': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'audio/mpeg': 'music',
  'audio/wav': 'music',
  'application/zip': 'file-archive',
  'application/x-rar-compressed': 'file-archive',
  'application/x-7z-compressed': 'file-archive',
};

export const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'date-desc', label: 'Date (Newest)' },
  { value: 'date-asc', label: 'Date (Oldest)' },
  { value: 'size-desc', label: 'Size (Largest)' },
  { value: 'size-asc', label: 'Size (Smallest)' },
];

export const FILE_TYPE_FILTERS = [
  { value: 'all', label: 'All Files' },
  { value: 'folder', label: 'Folders' },
  { value: 'document', label: 'Documents' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' },
  { value: 'archive', label: 'Archives' },
];

export const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB
export const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks for upload
