import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, User, Camera, Save, AlertCircle, Loader2, Upload } from 'lucide-react';

// Resize + compress an image file to a small JPEG data URL so it can be stored
// directly in Firestore (no separate storage bucket needed for avatars).
function resizeImageToDataURL(file: File, maxSize = 256): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new window.Image();
            img.onload = () => {
                let { width, height } = img;
                if (width > height && width > maxSize) {
                    height = Math.round((height * maxSize) / width);
                    width = maxSize;
                } else if (height > maxSize) {
                    width = Math.round((width * maxSize) / height);
                    height = maxSize;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('Canvas not supported'));
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = () => reject(new Error('Failed to load image'));
            img.src = reader.result as string;
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

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
    const [isProcessingImage, setIsProcessingImage] = useState(false);
    const [error, setError] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setError('Please choose an image file');
            return;
        }
        setIsProcessingImage(true);
        setError('');
        try {
            const dataUrl = await resizeImageToDataURL(file);
            setAvatar(dataUrl);
        } catch (err) {
            setError('Failed to process image');
        } finally {
            setIsProcessingImage(false);
            // Reset so selecting the same file again re-triggers change
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

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
                            {/* Avatar */}
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-foreground">Profile Picture</label>
                                <div className="flex items-center gap-4">
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="relative w-20 h-20 rounded-xl bg-muted flex items-center justify-center overflow-hidden flex-shrink-0 group border-2 border-transparent hover:border-primary transition-colors"
                                        title="Upload profile picture"
                                    >
                                        {avatar ? (
                                            <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                                        ) : (
                                            <Camera size={24} className="text-muted-foreground" />
                                        )}
                                        <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                            {isProcessingImage ? (
                                                <Loader2 size={20} className="text-white animate-spin" />
                                            ) : (
                                                <Camera size={20} className="text-white" />
                                            )}
                                        </span>
                                    </button>
                                    <div className="flex-1 space-y-2">
                                        <button
                                            type="button"
                                            onClick={() => fileInputRef.current?.click()}
                                            disabled={isProcessingImage}
                                            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm font-medium disabled:opacity-50"
                                        >
                                            <Upload size={16} />
                                            {isProcessingImage ? 'Processing...' : 'Upload from device'}
                                        </button>
                                        {avatar && (
                                            <button
                                                type="button"
                                                onClick={() => setAvatar('')}
                                                className="block text-xs text-muted-foreground hover:text-destructive transition-colors"
                                            >
                                                Remove picture
                                            </button>
                                        )}
                                    </div>
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        onChange={handleFileSelect}
                                        className="hidden"
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
