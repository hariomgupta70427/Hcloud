import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FolderOpen, ChevronRight, Folder, Plus } from 'lucide-react';

interface FolderItem {
    id: string;
    name: string;
    parentId?: string;
}

interface MoveDialogProps {
    isOpen: boolean;
    fileName: string;
    currentFolderId?: string;
    folders: FolderItem[];
    onClose: () => void;
    onMove: (folderId: string | null) => void;
    onCreateFolder?: (name: string, parentId?: string) => void;
    isLoading?: boolean;
}

export function MoveDialog({
    isOpen,
    fileName,
    currentFolderId,
    folders,
    onClose,
    onMove,
    onCreateFolder,
    isLoading = false,
}: MoveDialogProps) {
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [showNewFolder, setShowNewFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');

    useEffect(() => {
        if (isOpen) {
            setSelectedFolderId(null);
            setExpandedFolders(new Set());
            setShowNewFolder(false);
            setNewFolderName('');
        }
    }, [isOpen]);

    // Build folder tree
    const rootFolders = folders.filter((f) => !f.parentId);
    const getChildren = (parentId: string) => folders.filter((f) => f.parentId === parentId);

    const toggleExpand = (folderId: string) => {
        const newExpanded = new Set(expandedFolders);
        if (newExpanded.has(folderId)) {
            newExpanded.delete(folderId);
        } else {
            newExpanded.add(folderId);
        }
        setExpandedFolders(newExpanded);
    };

    const handleCreateFolder = () => {
        if (newFolderName.trim() && onCreateFolder) {
            onCreateFolder(newFolderName.trim(), selectedFolderId || undefined);
            setNewFolderName('');
            setShowNewFolder(false);
        }
    };

    const renderFolder = (folder: FolderItem, depth: number = 0) => {
        const children = getChildren(folder.id);
        const hasChildren = children.length > 0;
        const isExpanded = expandedFolders.has(folder.id);
        const isSelected = selectedFolderId === folder.id;
        const isCurrent = folder.id === currentFolderId;

        return (
            <div key={folder.id}>
                <button
                    onClick={() => setSelectedFolderId(folder.id)}
                    disabled={isCurrent}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${isSelected
                            ? 'bg-primary/10 text-primary'
                            : isCurrent
                                ? 'opacity-50 cursor-not-allowed'
                                : 'hover:bg-muted text-foreground'
                        }`}
                    style={{ paddingLeft: `${12 + depth * 20}px` }}
                >
                    {hasChildren && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand(folder.id);
                            }}
                            className="p-0.5 hover:bg-muted rounded"
                        >
                            <ChevronRight
                                size={14}
                                className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            />
                        </button>
                    )}
                    {!hasChildren && <div className="w-5" />}
                    <Folder size={18} className={isSelected ? 'text-primary' : 'text-muted-foreground'} />
                    <span className="flex-1 text-left truncate">{folder.name}</span>
                    {isCurrent && <span className="text-xs text-muted-foreground">(current)</span>}
                </button>

                {isExpanded && children.map((child) => renderFolder(child, depth + 1))}
            </div>
        );
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
                    onClick={(e) => e.target === e.currentTarget && onClose()}
                >
                    <motion.div
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="w-full max-w-md bg-card rounded-2xl border border-border shadow-xl"
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg bg-primary/10">
                                    <FolderOpen size={18} className="text-primary" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-semibold text-foreground">Move to</h2>
                                    <p className="text-sm text-muted-foreground truncate max-w-[200px]">{fileName}</p>
                                </div>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Folder list */}
                        <div className="p-4 max-h-80 overflow-y-auto">
                            {/* Root (My Files) */}
                            <button
                                onClick={() => setSelectedFolderId(null)}
                                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors mb-1 ${selectedFolderId === null
                                        ? 'bg-primary/10 text-primary'
                                        : 'hover:bg-muted text-foreground'
                                    }`}
                            >
                                <FolderOpen size={18} />
                                <span className="font-medium">My Files</span>
                            </button>

                            {/* Folder tree */}
                            <div className="space-y-0.5">
                                {rootFolders.map((folder) => renderFolder(folder))}
                            </div>

                            {/* New folder */}
                            {showNewFolder ? (
                                <div className="flex items-center gap-2 mt-3 p-2 rounded-lg bg-muted">
                                    <Folder size={18} className="text-muted-foreground" />
                                    <input
                                        type="text"
                                        value={newFolderName}
                                        onChange={(e) => setNewFolderName(e.target.value)}
                                        placeholder="Folder name"
                                        className="flex-1 bg-transparent outline-none text-sm"
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleCreateFolder();
                                            if (e.key === 'Escape') setShowNewFolder(false);
                                        }}
                                    />
                                    <button
                                        onClick={handleCreateFolder}
                                        disabled={!newFolderName.trim()}
                                        className="px-3 py-1 rounded-lg bg-primary text-primary-foreground text-sm disabled:opacity-50"
                                    >
                                        Create
                                    </button>
                                </div>
                            ) : (
                                onCreateFolder && (
                                    <button
                                        onClick={() => setShowNewFolder(true)}
                                        className="flex items-center gap-2 w-full px-3 py-2 mt-3 rounded-lg border-2 border-dashed border-border hover:border-primary hover:text-primary transition-colors text-muted-foreground"
                                    >
                                        <Plus size={18} />
                                        <span>New folder</span>
                                    </button>
                                )
                            )}
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 p-4 border-t border-border">
                            <button
                                onClick={onClose}
                                disabled={isLoading}
                                className="flex-1 px-4 py-3 rounded-xl border border-border hover:bg-muted transition-colors font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => onMove(selectedFolderId)}
                                disabled={isLoading}
                                className="flex-1 px-4 py-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Moving...
                                    </span>
                                ) : (
                                    'Move here'
                                )}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
