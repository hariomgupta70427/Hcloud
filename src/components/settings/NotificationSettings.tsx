import { useState } from 'react';
import { motion } from 'framer-motion';
import { Bell, Mail, MessageSquare, Smartphone, Check } from 'lucide-react';

interface NotificationSetting {
    id: string;
    label: string;
    description: string;
    enabled: boolean;
}

interface NotificationSettingsProps {
    initialSettings?: NotificationSetting[];
    onSave?: (settings: NotificationSetting[]) => Promise<void>;
}

const defaultSettings: NotificationSetting[] = [
    {
        id: 'email_uploads',
        label: 'Upload confirmations',
        description: 'Receive email when file uploads complete',
        enabled: true,
    },
    {
        id: 'email_shares',
        label: 'Shared file activity',
        description: 'Get notified when someone accesses your shared files',
        enabled: true,
    },
    {
        id: 'email_storage',
        label: 'Storage alerts',
        description: 'Alert when storage is running low',
        enabled: true,
    },
    {
        id: 'push_uploads',
        label: 'Push notifications',
        description: 'Browser notifications for important updates',
        enabled: false,
    },
];

export function NotificationSettings({ initialSettings = defaultSettings, onSave }: NotificationSettingsProps) {
    const [settings, setSettings] = useState(initialSettings);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const toggleSetting = async (id: string) => {
        const newSettings = settings.map((s) =>
            s.id === id ? { ...s, enabled: !s.enabled } : s
        );
        setSettings(newSettings);

        if (onSave) {
            setIsSaving(true);
            try {
                await onSave(newSettings);
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
            } finally {
                setIsSaving(false);
            }
        }
    };

    const getIcon = (id: string) => {
        if (id.startsWith('email')) return Mail;
        if (id.startsWith('push')) return Smartphone;
        if (id.startsWith('sms')) return MessageSquare;
        return Bell;
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-2xl bg-card border border-border"
        >
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                        <Bell size={20} className="text-primary" />
                    </div>
                    <div>
                        <h3 className="font-semibold text-foreground">Notifications</h3>
                        <p className="text-sm text-muted-foreground">Manage your notification preferences</p>
                    </div>
                </div>
                {saved && (
                    <span className="flex items-center gap-1 text-sm text-green-500">
                        <Check size={16} />
                        Saved
                    </span>
                )}
            </div>

            <div className="space-y-3">
                {settings.map((setting) => {
                    const Icon = getIcon(setting.id);
                    return (
                        <label
                            key={setting.id}
                            className="flex items-center gap-4 p-4 rounded-xl border border-border hover:bg-muted/50 cursor-pointer transition-colors"
                        >
                            <Icon size={20} className="text-muted-foreground flex-shrink-0" />
                            <div className="flex-1">
                                <span className="font-medium text-foreground">{setting.label}</span>
                                <p className="text-sm text-muted-foreground">{setting.description}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => toggleSetting(setting.id)}
                                disabled={isSaving}
                                className={`relative w-12 h-7 rounded-full transition-colors ${setting.enabled ? 'bg-primary' : 'bg-muted'
                                    }`}
                            >
                                <motion.div
                                    animate={{ x: setting.enabled ? 22 : 2 }}
                                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                                    className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md"
                                />
                            </button>
                        </label>
                    );
                })}
            </div>
        </motion.div>
    );
}
