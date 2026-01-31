import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Pencil, AlertCircle } from 'lucide-react';

interface RenameDialogProps {
    isOpen: boolean;
    currentName: string;
    onClose: () => void;
    onRename: (newName: string) => void;
    isLoading?: boolean;
}

export function RenameDialog({
    isOpen,
    currentName,
    onClose,
    onRename,
    isLoading = false,
}: RenameDialogProps) {
    const [name, setName] = useState(currentName);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setName(currentName);
            setError('');
            // Focus and select filename without extension
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    const lastDot = currentName.lastIndexOf('.');
                    if (lastDot > 0) {
                        inputRef.current.setSelectionRange(0, lastDot);
                    } else {
                        inputRef.current.select();
                    }
                }
            }, 100);
        }
    }, [isOpen, currentName]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const trimmedName = name.trim();

        if (!trimmedName) {
            setError('Name cannot be empty');
            return;
        }

        if (trimmedName === currentName) {
            onClose();
            return;
        }

        // Check for invalid characters
        const invalidChars = /[<>:"/\\|?*]/;
        if (invalidChars.test(trimmedName)) {
            setError('Name contains invalid characters');
            return;
        }

        onRename(trimmedName);
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
                                    <Pencil size={18} className="text-primary" />
                                </div>
                                <h2 className="text-lg font-semibold text-foreground">Rename</h2>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Content */}
                        <form onSubmit={handleSubmit} className="p-4">
                            <div className="space-y-2">
                                <label className="text-sm text-muted-foreground">New name</label>
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value);
                                        setError('');
                                    }}
                                    className={`w-full px-4 py-3 rounded-xl bg-muted border-2 transition-colors outline-none ${error
                                            ? 'border-destructive focus:border-destructive'
                                            : 'border-transparent focus:border-primary'
                                        }`}
                                    placeholder="Enter new name"
                                    disabled={isLoading}
                                />
                                {error && (
                                    <div className="flex items-center gap-2 text-destructive text-sm">
                                        <AlertCircle size={14} />
                                        <span>{error}</span>
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-3 mt-6">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    disabled={isLoading}
                                    className="flex-1 px-4 py-3 rounded-xl border border-border hover:bg-muted transition-colors font-medium"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={isLoading || !name.trim()}
                                    className="flex-1 px-4 py-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
                                >
                                    {isLoading ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Renaming...
                                        </span>
                                    ) : (
                                        'Rename'
                                    )}
                                </button>
                            </div>
                        </form>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
