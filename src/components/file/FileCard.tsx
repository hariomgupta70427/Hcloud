import { motion } from 'framer-motion';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  Edit3,
  Move
} from 'lucide-react';
import { FileItem } from '@/services/fileService';
import { cn } from '@/lib/utils';
import { useState } from 'react';

interface FileCardProps {
  file: FileItem;
  isSelected: boolean;
  onSelect: () => void;
  onClick?: () => void;
  onStar: () => void;
  onDelete: () => void;
  onRename?: () => void;
  onShare?: () => void;
  onMove?: () => void;
  onDownload?: () => void;
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
  if (!bytes) return '';
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

export function FileCard({
  file,
  isSelected,
  onSelect,
  onClick,
  onStar,
  onDelete,
  onRename,
  onShare,
  onMove,
  onDownload
}: FileCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const Icon = getFileIcon(file);
  const iconColor = getFileColor(file);

  const handleClick = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      onSelect();
    } else {
      onClick?.();
    }
  };

  const handleDoubleClick = () => {
    onClick?.();
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -2 }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={cn(
        "file-card group cursor-pointer",
        isSelected && "ring-2 ring-primary border-primary"
      )}
    >
      {/* Thumbnail / Icon */}
      <div className="relative h-36 flex items-center justify-center bg-muted/30 overflow-hidden">
        {file.thumbnail ? (
          <img
            src={file.thumbnail}
            alt={file.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <Icon className={cn("w-16 h-16", iconColor)} />
        )}

        {/* Star button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStar();
          }}
          className={cn(
            "absolute top-2 left-2 p-1.5 rounded-lg transition-all",
            file.isStarred
              ? "text-yellow-500 bg-yellow-500/10"
              : "text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted"
          )}
        >
          <Star size={16} fill={file.isStarred ? 'currentColor' : 'none'} />
        </button>

        <div className="absolute top-2 right-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="p-1.5 rounded-lg text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted/80 hover:text-foreground transition-all focus:opacity-100 focus:outline-none"
              >
                <MoreVertical size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {file.type !== 'folder' && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownload?.();
                  }}
                >
                  <Download size={14} className="mr-2" />
                  Download
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onShare?.();
                }}
              >
                <Share2 size={14} className="mr-2" />
                Share
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onRename?.();
                }}
              >
                <Edit3 size={14} className="mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onMove?.();
                }}
              >
                <Move size={14} className="mr-2" />
                Move
              </DropdownMenuItem>
              <div className="h-px bg-border my-1" />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                <Trash2 size={14} className="mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Shared indicator */}
        {file.isShared && (
          <div className="absolute bottom-2 right-2 p-1 rounded bg-primary/10">
            <Share2 size={12} className="text-primary" />
          </div>
        )}
      </div>

      {/* File info */}
      <div className="p-3">
        <p className="font-medium text-foreground truncate" title={file.name}>
          {file.name}
        </p>
        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
          {file.type === 'file' && file.size && (
            <>
              <span>{formatFileSize(file.size)}</span>
              <span>•</span>
            </>
          )}
          <span>{formatDate(file.updatedAt)}</span>
        </div>
      </div>
    </motion.div>
  );
}
