import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { ProfileCard, ProfileEditForm, StorageInfo } from '@/components/profile';
import * as fileService from '@/services/fileService';
import { FileItem } from '@/services/fileService';

// Relative time formatter for the activity list ("2 hours ago", "Yesterday").
function formatRelativeTime(date: Date): string {
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays} days ago`;
    return date.toLocaleDateString();
}

export default function ProfilePage() {
    const navigate = useNavigate();
    const { user, updateProfile } = useAuthStore();
    const [showEditForm, setShowEditForm] = useState(false);
    const [stats, setStats] = useState<{ totalFiles: number; totalFolders: number; totalSize: number } | null>(null);
    const [recentActivity, setRecentActivity] = useState<FileItem[]>([]);

    // Load real storage stats + recent files for this user.
    useEffect(() => {
        if (!user?.id) return;
        fileService.getStorageStats(user.id).then(setStats).catch(console.error);
        fileService.getRecentFiles(user.id, 5).then(setRecentActivity).catch(console.error);
    }, [user?.id]);

    if (!user) {
        return null;
    }

    const handleSaveProfile = async (data: { name: string; phone?: string; avatar?: string }) => {
        await updateProfile(data);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <button
                    onClick={() => navigate(-1)}
                    className="p-2 rounded-lg hover:bg-muted transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 className="text-2xl font-bold text-foreground">Profile</h1>
                    <p className="text-muted-foreground">Manage your personal information</p>
                </div>
            </div>

            {/* Profile Card */}
            <ProfileCard
                user={user}
                onEditProfile={() => setShowEditForm(true)}
            />

            {/* Storage Info — real values from Firestore */}
            <StorageInfo
                usedBytes={stats?.totalSize ?? 0}
                fileCount={stats?.totalFiles ?? 0}
                storageMode={user.storageMode}
            />

            {/* Activity — real recent files */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="p-6 rounded-2xl bg-card border border-border"
            >
                <h3 className="font-semibold text-foreground mb-4">Recent Activity</h3>
                {recentActivity.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">No recent activity yet.</p>
                ) : (
                    <div className="space-y-4">
                        {recentActivity.map((item) => (
                            <div key={item.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                                <span className="text-foreground truncate mr-4">{item.name}</span>
                                <span className="text-sm text-muted-foreground flex-shrink-0">
                                    {formatRelativeTime(item.updatedAt)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </motion.div>

            {/* Edit Form Modal */}
            <ProfileEditForm
                isOpen={showEditForm}
                user={user}
                onClose={() => setShowEditForm(false)}
                onSave={handleSaveProfile}
            />
        </div>
    );
}
