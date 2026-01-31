import { motion, AnimatePresence } from 'framer-motion';
import {
    Download,
    Share2,
    Star,
    StarOff,
    Pencil,
    FolderInput,
    Trash2,
    Copy,
    ExternalLink,
    Info
} from 'lucide-react';

interface FileContextMenuProps {
    isOpen: boolean;
    position: { x: number; y: number };
    file: {
        id: string;
        name: string;
        isStarred?: boolean;
    };
    onClose: () => void;
    onDownload?: () => void;
    onShare?: () => void;
    onRename?: () => void;
    onMove?: () => void;
    onDelete?: () => void;
    onToggleStar?: () => void;
    onCopyLink?: () => void;
    onOpenNew?: () => void;
    onViewDetails?: () => void;
}

interface MenuItem {
    icon: React.ElementType;
    label: string;
    onClick?: () => void;
    danger?: boolean;
    divider?: boolean;
}

export function FileContextMenu({
    isOpen,
    position,
    file,
    onClose,
    onDownload,
    onShare,
    onRename,
    onMove,
    onDelete,
    onToggleStar,
    onCopyLink,
    onOpenNew,
    onViewDetails,
}: FileContextMenuProps) {
    const menuItems: MenuItem[] = [
        { icon: Download, label: 'Download', onClick: onDownload },
        { icon: ExternalLink, label: 'Open in new tab', onClick: onOpenNew },
        { icon: Copy, label: 'Copy link', onClick: onCopyLink, divider: true },
        { icon: Share2, label: 'Share', onClick: onShare },
        { icon: file.isStarred ? StarOff : Star, label: file.isStarred ? 'Remove star' : 'Add star', onClick: onToggleStar, divider: true },
        { icon: Pencil, label: 'Rename', onClick: onRename },
        { icon: FolderInput, label: 'Move to...', onClick: onMove },
        { icon: Info, label: 'File details', onClick: onViewDetails, divider: true },
        { icon: Trash2, label: 'Delete', onClick: onDelete, danger: true },
    ];

    // Adjust position to keep menu in viewport
    const adjustedPosition = {
        x: Math.min(position.x, window.innerWidth - 220),
        y: Math.min(position.y, window.innerHeight - 400),
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-50"
                        onClick={onClose}
                        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
                    />

                    {/* Menu */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.1 }}
                        style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
                        className="fixed z-50 w-52 py-2 rounded-xl bg-card border border-border shadow-xl"
                    >
                        {menuItems.map((item, index) => (
                            <div key={index}>
                                {item.divider && index > 0 && (
                                    <div className="my-1 border-t border-border" />
                                )}
                                <button
                                    onClick={() => {
                                        item.onClick?.();
                                        onClose();
                                    }}
                                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${item.danger
                                            ? 'text-destructive hover:bg-destructive/10'
                                            : 'text-foreground hover:bg-muted'
                                        }`}
                                >
                                    <item.icon size={16} className="flex-shrink-0" />
                                    <span>{item.label}</span>
                                </button>
                            </div>
                        ))}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
