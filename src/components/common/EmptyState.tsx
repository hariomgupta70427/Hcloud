import { motion } from 'framer-motion';
import {
    FolderOpen,
    Upload,
    Star,
    Clock,
    Users,
    Trash2,
    Search,
    FileQuestion
} from 'lucide-react';

type EmptyStateType =
    | 'files'
    | 'starred'
    | 'recent'
    | 'shared'
    | 'trash'
    | 'search'
    | 'folder'
    | 'default';

interface EmptyStateProps {
    type?: EmptyStateType;
    searchQuery?: string;
    onAction?: () => void;
    actionLabel?: string;
}

const emptyStates: Record<EmptyStateType, {
    icon: React.ElementType;
    title: string;
    description: string;
    actionLabel?: string;
}> = {
    files: {
        icon: FolderOpen,
        title: 'No files yet',
        description: 'Upload your first file to get started with unlimited cloud storage.',
        actionLabel: 'Upload files',
    },
    starred: {
        icon: Star,
        title: 'No starred files',
        description: 'Star important files for quick access. They\'ll appear here.',
    },
    recent: {
        icon: Clock,
        title: 'No recent activity',
        description: 'Files you view or edit will appear here for quick access.',
    },
    shared: {
        icon: Users,
        title: 'No shared files',
        description: 'Files you share with others will appear here.',
    },
    trash: {
        icon: Trash2,
        title: 'Trash is empty',
        description: 'Deleted files will appear here. They\'ll be permanently removed after 30 days.',
    },
    search: {
        icon: Search,
        title: 'No results found',
        description: 'Try different keywords or check your spelling.',
    },
    folder: {
        icon: FolderOpen,
        title: 'This folder is empty',
        description: 'Upload files or create subfolders to organize your content.',
        actionLabel: 'Upload files',
    },
    default: {
        icon: FileQuestion,
        title: 'Nothing here yet',
        description: 'Content will appear here once you add something.',
    },
};

export function EmptyState({
    type = 'default',
    searchQuery,
    onAction,
    actionLabel: customActionLabel,
}: EmptyStateProps) {
    const state = emptyStates[type];
    const Icon = state.icon;
    const actionLabel = customActionLabel || state.actionLabel;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full flex flex-col items-center justify-center py-16 px-4 text-center"
        >
            {/* Animated icon */}
            <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
                className="relative mb-6"
            >
                <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                    <Icon size={40} className="text-primary/60" />
                </div>
                {/* Decorative elements */}
                <motion.div
                    animate={{
                        scale: [1, 1.2, 1],
                        opacity: [0.5, 0.8, 0.5],
                    }}
                    transition={{ duration: 3, repeat: Infinity }}
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary/20"
                />
                <motion.div
                    animate={{
                        scale: [1, 1.3, 1],
                        opacity: [0.3, 0.6, 0.3],
                    }}
                    transition={{ duration: 4, repeat: Infinity, delay: 0.5 }}
                    className="absolute -bottom-1 -left-3 w-4 h-4 rounded-full bg-primary/15"
                />
            </motion.div>

            {/* Text content */}
            <motion.h3
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-xl font-semibold text-foreground mb-2"
            >
                {type === 'search' && searchQuery
                    ? `No results for "${searchQuery}"`
                    : state.title
                }
            </motion.h3>

            <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-muted-foreground max-w-sm"
            >
                {state.description}
            </motion.p>

            {/* Action button */}
            {actionLabel && onAction && (
                <motion.button
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                    onClick={onAction}
                    className="mt-6 px-6 py-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium flex items-center gap-2"
                >
                    <Upload size={18} />
                    {actionLabel}
                </motion.button>
            )}
        </motion.div>
    );
}
