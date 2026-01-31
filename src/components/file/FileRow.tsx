import { motion } from 'framer-motion';
import { 
  Folder, 
  FileText, 
  Image, 
  Film, 
  Music, 
  FileArchive,
  FileCode,
  File,
  Star,
  MoreVertical,
  Download,
  Share2,
  Trash2,
  Edit3
} from 'lucide-react';
import { FileItem } from '@/stores/fileStore';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface FileRowProps {
  file: FileItem;
  isSelected: boolean;
  onSelect: (id: string, multiSelect?: boolean) => void;
  onStar: (id: string) => void;
  onDelete: (id: string) => void;
  onDownload?: (id: string) => void;
  onShare?: (id: string) => void;
}

const getFileIcon = (file: FileItem) => {
  if (file.type === 'folder') return Folder;
  
  if (file.mimeType?.startsWith('image/')) return Image;
  if (file.mimeType?.startsWith('video/')) return Film;
  if (file.mimeType?.startsWith('audio/')) return Music;
  if (file.mimeType?.includes('zip') || file.mimeType?.includes('rar') || file.mimeType?.includes('7z')) return FileArchive;
  if (file.mimeType?.includes('pdf') || file.mimeType?.includes('document') || file.mimeType?.includes('word')) return FileText;
  if (file.mimeType?.includes('code') || file.mimeType?.includes('javascript') || file.mimeType?.includes('json')) return FileCode;
  
  return File;
};

const getFileColor = (file: FileItem) => {
  if (file.type === 'folder') return 'text-primary';
  if (file.mimeType?.startsWith('image/')) return 'text-green-500';
  if (file.mimeType?.startsWith('video/')) return 'text-purple-500';
  if (file.mimeType?.startsWith('audio/')) return 'text-pink-500';
  if (file.mimeType?.includes('pdf')) return 'text-red-500';
  if (file.mimeType?.includes('spreadsheet') || file.mimeType?.includes('excel')) return 'text-green-600';
  if (file.mimeType?.includes('presentation') || file.mimeType?.includes('powerpoint')) return 'text-orange-500';
  return 'text-muted-foreground';
};

const formatFileSize = (bytes?: number) => {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

const formatDate = (date: Date) => {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
};

export function FileRow({ file, isSelected, onSelect, onStar, onDelete, onDownload, onShare }: FileRowProps) {
  const [showMenu, setShowMenu] = useState(false);
  const Icon = getFileIcon(file);
  const iconColor = getFileColor(file);

  const handleClick = (e: React.MouseEvent) => {
    onSelect(file.id, e.ctrlKey || e.metaKey);
  };

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={handleClick}
      className={cn(
        "group cursor-pointer border-b border-border/50 transition-colors",
        isSelected ? "bg-primary/5" : "hover:bg-muted/30"
      )}
    >
      {/* Name */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-3">
          <Icon className={cn("w-5 h-5 flex-shrink-0", iconColor)} />
          <span className="font-medium text-foreground truncate max-w-xs" title={file.name}>
            {file.name}
          </span>
          {file.isShared && (
            <Share2 size={14} className="text-primary flex-shrink-0" />
          )}
        </div>
      </td>

      {/* Size */}
      <td className="py-3 px-4 text-sm text-muted-foreground">
        {file.type === 'folder' ? '—' : formatFileSize(file.size)}
      </td>

      {/* Modified */}
      <td className="py-3 px-4 text-sm text-muted-foreground">
        {formatDate(file.updatedAt)}
      </td>

      {/* Actions */}
      <td className="py-3 px-4">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStar(file.id);
            }}
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              file.isStarred 
                ? "text-yellow-500" 
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <Star size={16} fill={file.isStarred ? 'currentColor' : 'none'} />
          </button>

          {file.type !== 'folder' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDownload?.(file.id);
              }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <Download size={16} />
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onShare?.(file.id);
            }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Share2 size={16} />
          </button>

          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <MoreVertical size={16} />
            </button>

            {showMenu && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowMenu(false);
                  }} 
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="absolute right-0 top-8 w-40 py-1 rounded-lg bg-popover border border-border shadow-lg z-50"
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted transition-colors"
                  >
                    <Edit3 size={14} />
                    Rename
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(file.id);
                      setShowMenu(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </motion.div>
              </>
            )}
          </div>
        </div>
      </td>
    </motion.tr>
  );
}
