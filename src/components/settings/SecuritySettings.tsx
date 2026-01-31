import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Key, Smartphone, AlertCircle, Check, Eye, EyeOff, Loader2 } from 'lucide-react';

interface SecuritySettingsProps {
    has2FA?: boolean;
    onChangePassword?: (currentPassword: string, newPassword: string) => Promise<void>;
    onToggle2FA?: () => Promise<void>;
}

export function SecuritySettings({ has2FA = false, onChangePassword, onToggle2FA }: SecuritySettingsProps) {
    const [showPasswordForm, setShowPasswordForm] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handlePasswordChange = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (newPassword.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (onChangePassword) {
            setIsLoading(true);
            try {
                await onChangePassword(currentPassword, newPassword);
                setSuccess('Password changed successfully');
                setShowPasswordForm(false);
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
            } catch (err) {
                setError('Failed to change password');
            } finally {
                setIsLoading(false);
            }
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-2xl bg-card border border-border"
        >
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 rounded-lg bg-primary/10">
                    <Shield size={20} className="text-primary" />
                </div>
                <div>
                    <h3 className="font-semibold text-foreground">Security</h3>
                    <p className="text-sm text-muted-foreground">Manage your account security</p>
                </div>
            </div>

            <div className="space-y-4">
                {/* Password Section */}
                <div className="p-4 rounded-xl border border-border">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Key size={20} className="text-muted-foreground" />
                            <div>
                                <span className="font-medium text-foreground">Password</span>
                                <p className="text-sm text-muted-foreground">Last changed 30 days ago</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowPasswordForm(!showPasswordForm)}
                            className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors text-sm font-medium"
                        >
                            {showPasswordForm ? 'Cancel' : 'Change'}
                        </button>
                    </div>

                    <AnimatePresence>
                        {showPasswordForm && (
                            <motion.form
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                onSubmit={handlePasswordChange}
                                className="mt-4 space-y-3 overflow-hidden"
                            >
                                <div className="relative">
                                    <input
                                        type={showCurrent ? 'text' : 'password'}
                                        value={currentPassword}
                                        onChange={(e) => setCurrentPassword(e.target.value)}
                                        placeholder="Current password"
                                        className="w-full px-4 py-3 pr-12 rounded-xl bg-muted border-2 border-transparent focus:border-primary outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowCurrent(!showCurrent)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                                <div className="relative">
                                    <input
                                        type={showNew ? 'text' : 'password'}
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        placeholder="New password"
                                        className="w-full px-4 py-3 pr-12 rounded-xl bg-muted border-2 border-transparent focus:border-primary outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNew(!showNew)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                                <input
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    placeholder="Confirm new password"
                                    className="w-full px-4 py-3 rounded-xl bg-muted border-2 border-transparent focus:border-primary outline-none"
                                />

                                {error && (
                                    <div className="flex items-center gap-2 text-destructive text-sm">
                                        <AlertCircle size={14} />
                                        {error}
                                    </div>
                                )}

                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="w-full px-4 py-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                                >
                                    {isLoading ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" />
                                            Updating...
                                        </>
                                    ) : (
                                        'Update Password'
                                    )}
                                </button>
                            </motion.form>
                        )}
                    </AnimatePresence>
                </div>

                {/* 2FA Section */}
                <div className="p-4 rounded-xl border border-border">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Smartphone size={20} className="text-muted-foreground" />
                            <div>
                                <span className="font-medium text-foreground">Two-Factor Authentication</span>
                                <p className="text-sm text-muted-foreground">
                                    {has2FA ? 'Enabled - Your account is more secure' : 'Add an extra layer of security'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onToggle2FA}
                            className={`px-4 py-2 rounded-lg transition-colors text-sm font-medium ${has2FA
                                    ? 'border border-destructive text-destructive hover:bg-destructive/10'
                                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                                }`}
                        >
                            {has2FA ? 'Disable' : 'Enable'}
                        </button>
                    </div>
                </div>

                {success && (
                    <div className="flex items-center gap-2 text-green-500 text-sm">
                        <Check size={16} />
                        {success}
                    </div>
                )}
            </div>
        </motion.div>
    );
}
