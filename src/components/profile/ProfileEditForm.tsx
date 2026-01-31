import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Camera, Save, AlertCircle, Loader2 } from 'lucide-react';

interface ProfileEditFormProps {
    isOpen: boolean;
    user: {
        name: string;
        email: string;
        phone?: string;
        avatar?: string;
    };
    onClose: () => void;
    onSave: (data: { name: string; phone?: string; avatar?: string }) => Promise<void>;
}

export function ProfileEditForm({ isOpen, user, onClose, onSave }: ProfileEditFormProps) {
    const [name, setName] = useState(user.name);
    const [phone, setPhone] = useState(user.phone || '');
    const [avatar, setAvatar] = useState(user.avatar || '');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim()) {
            setError('Name is required');
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            await onSave({
                name: name.trim(),
                phone: phone.trim() || undefined,
                avatar: avatar.trim() || undefined,
            });
            onClose();
        } catch (err) {
            setError('Failed to save profile');
        } finally {
            setIsLoading(false);
        }
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
                                    <User size={18} className="text-primary" />
                                </div>
                                <h2 className="text-lg font-semibold text-foreground">Edit Profile</h2>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="p-4 space-y-4">
                            {/* Avatar URL */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground">Avatar URL</label>
                                <div className="flex gap-3">
                                    <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
                                        {avatar ? (
                                            <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                                        ) : (
                                            <Camera size={24} className="text-muted-foreground" />
                                        )}
                                    </div>
                                    <input
                                        type="url"
                                        value={avatar}
                                        onChange={(e) => setAvatar(e.target.value)}
                                        className="flex-1 px-4 py-3 rounded-xl bg-muted border-2 border-transparent focus:border-primary outline-none text-sm"
                                        placeholder="https://example.com/avatar.jpg"
                                    />
                                </div>
                            </div>

                            {/* Name */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground">Full Name</label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => {
                                        setName(e.target.value);
                                        setError('');
                                    }}
                                    className="w-full px-4 py-3 rounded-xl bg-muted border-2 border-transparent focus:border-primary outline-none"
                                    placeholder="Enter your name"
                                />
                            </div>

                            {/* Email (read-only) */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground">Email</label>
                                <input
                                    type="email"
                                    value={user.email}
                                    disabled
                                    className="w-full px-4 py-3 rounded-xl bg-muted border-2 border-transparent outline-none opacity-60 cursor-not-allowed"
                                />
                                <p className="text-xs text-muted-foreground">Email cannot be changed</p>
                            </div>

                            {/* Phone */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground">Phone</label>
                                <input
                                    type="tel"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    className="w-full px-4 py-3 rounded-xl bg-muted border-2 border-transparent focus:border-primary outline-none"
                                    placeholder="+1 234 567 8900"
                                />
                            </div>

                            {/* Error */}
                            {error && (
                                <div className="flex items-center gap-2 text-destructive text-sm">
                                    <AlertCircle size={14} />
                                    <span>{error}</span>
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-3 pt-2">
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
                                    disabled={isLoading}
                                    className="flex-1 px-4 py-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" />
                                            Saving...
                                        </>
                                    ) : (
                                        <>
                                            <Save size={18} />
                                            Save Changes
                                        </>
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
