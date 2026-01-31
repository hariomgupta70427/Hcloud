import { motion } from 'framer-motion';
import { Camera, Mail, Phone, Cloud, HardDrive } from 'lucide-react';

interface User {
    id: string;
    name: string;
    email: string;
    phone?: string;
    avatar?: string;
    storageMode: 'managed' | 'byod';
}

interface ProfileCardProps {
    user: User;
    onEditAvatar?: () => void;
    onEditProfile?: () => void;
}

export function ProfileCard({ user, onEditAvatar, onEditProfile }: ProfileCardProps) {
    const initials = user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-2xl bg-card border border-border"
        >
            {/* Avatar Section */}
            <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="relative group">
                    {user.avatar ? (
                        <img
                            src={user.avatar}
                            alt={user.name}
                            className="w-24 h-24 rounded-2xl object-cover ring-4 ring-primary/10"
                        />
                    ) : (
                        <div className="w-24 h-24 rounded-2xl gradient-primary flex items-center justify-center text-white text-2xl font-bold ring-4 ring-primary/10">
                            {initials}
                        </div>
                    )}
                    {onEditAvatar && (
                        <button
                            onClick={onEditAvatar}
                            className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <Camera className="text-white" size={24} />
                        </button>
                    )}
                </div>

                <div className="flex-1 text-center sm:text-left">
                    <h2 className="text-2xl font-bold text-foreground">{user.name}</h2>

                    <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-center sm:justify-start gap-2 text-muted-foreground">
                            <Mail size={16} />
                            <span className="text-sm">{user.email}</span>
                        </div>

                        {user.phone && (
                            <div className="flex items-center justify-center sm:justify-start gap-2 text-muted-foreground">
                                <Phone size={16} />
                                <span className="text-sm">{user.phone}</span>
                            </div>
                        )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2 justify-center sm:justify-start">
                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${user.storageMode === 'managed'
                                ? 'bg-primary/10 text-primary'
                                : 'bg-green-500/10 text-green-600 dark:text-green-400'
                            }`}>
                            {user.storageMode === 'managed' ? (
                                <>
                                    <Cloud size={12} />
                                    Managed Storage
                                </>
                            ) : (
                                <>
                                    <HardDrive size={12} />
                                    Own Server
                                </>
                            )}
                        </span>
                    </div>
                </div>

                {onEditProfile && (
                    <button
                        onClick={onEditProfile}
                        className="px-4 py-2 rounded-xl border border-border hover:bg-muted transition-colors text-sm font-medium"
                    >
                        Edit Profile
                    </button>
                )}
            </div>
        </motion.div>
    );
}
