import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { ProfileCard, ProfileEditForm, StorageInfo } from '@/components/profile';

export default function ProfilePage() {
    const navigate = useNavigate();
    const { user } = useAuthStore();
    const [showEditForm, setShowEditForm] = useState(false);

    if (!user) {
        return null;
    }

    const handleSaveProfile = async (data: { name: string; phone?: string; avatar?: string }) => {
        // In a real app, this would call an API
        console.log('Saving profile:', data);
        await new Promise((resolve) => setTimeout(resolve, 1000));
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

            {/* Storage Info */}
            <StorageInfo
                usedBytes={1024 * 1024 * 1024 * 2.5} // 2.5 GB
                fileCount={156}
                storageMode={user.storageMode}
            />

            {/* Activity */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="p-6 rounded-2xl bg-card border border-border"
            >
                <h3 className="font-semibold text-foreground mb-4">Recent Activity</h3>
                <div className="space-y-4">
                    {[
                        { action: 'Uploaded 3 files', time: '2 hours ago' },
                        { action: 'Shared document.pdf', time: '5 hours ago' },
                        { action: 'Created folder "Projects"', time: 'Yesterday' },
                        { action: 'Updated profile picture', time: '3 days ago' },
                    ].map((item, index) => (
                        <div key={index} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                            <span className="text-foreground">{item.action}</span>
                            <span className="text-sm text-muted-foreground">{item.time}</span>
                        </div>
                    ))}
                </div>
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
