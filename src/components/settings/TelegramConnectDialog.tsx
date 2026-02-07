import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Phone, Check, Loader2, ArrowRight, Lock } from 'lucide-react';
import { sendTelegramCode, verifyTelegramCode } from '@/services/telegramBYODService';
import { useAuthStore } from '@/stores/authStore';
import { toast } from 'sonner';
import { AuthInput, AuthButton } from '@/components/auth/AuthInput';

interface TelegramConnectDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConnect: () => void;
}

export function TelegramConnectDialog({ isOpen, onClose, onConnect }: TelegramConnectDialogProps) {
    const { user, updateBYODConfig } = useAuthStore();
    const [step, setStep] = useState<'phone' | 'otp'>('phone');
    const [phone, setPhone] = useState(user?.phone || '');
    const [isLoading, setIsLoading] = useState(false);

    // OTP State
    const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '']);
    const [phoneCodeHash, setPhoneCodeHash] = useState('');
    const [sessionString, setSessionString] = useState('');
    const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

    // 2FA State
    const [isTwoFactorAuth, setIsTwoFactorAuth] = useState(false);
    const [twoFactorPassword, setTwoFactorPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // Reset state when opened
    useEffect(() => {
        if (isOpen) {
            setStep('phone');
            setPhone(user?.phone || '');
            setOtpDigits(['', '', '', '', '']);
            setIsTwoFactorAuth(false);
            setTwoFactorPassword('');
        }
    }, [isOpen, user]);

    const handleSendCode = async (e?: React.FormEvent) => {
        e?.preventDefault();

        if (!phone || phone.length < 10) {
            toast.error('Please enter a valid phone number');
            return;
        }

        setIsLoading(true);
        try {
            const result = await sendTelegramCode(phone);

            if (result.success && result.phoneCodeHash) {
                setPhoneCodeHash(result.phoneCodeHash);
                if (result.sessionString) setSessionString(result.sessionString);
                setStep('otp');
                toast.success('Verification code sent to your Telegram app');
            } else {
                toast.error(result.error || 'Failed to send code');
            }
        } catch (error) {
            console.error('Send code error:', error);
            toast.error('Failed to send verification code');
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerify = async () => {
        const code = otpDigits.join('');
        if (code.length !== 5) {
            toast.error('Please enter the 5-digit code');
            return;
        }

        if (isTwoFactorAuth && !twoFactorPassword) {
            toast.error('Please enter your 2FA password');
            return;
        }

        setIsLoading(true);
        try {
            const result = await verifyTelegramCode(
                phone,
                code,
                phoneCodeHash,
                sessionString,
                isTwoFactorAuth ? twoFactorPassword : undefined
            );

            if (result.success && result.session) {
                // Save session in BYOD config
                await updateBYODConfig({
                    telegramSession: result.session,
                    telegramUserId: result.user?.id || '',
                    verified: true
                });

                toast.success('Telegram connected successfully!');
                onConnect();
                onClose();
            } else if (result.needsPassword) {
                setIsTwoFactorAuth(true);
                if (result.sessionString) setSessionString(result.sessionString);
                toast.info('Two-step verification required');
            } else {
                toast.error(result.error || 'Verification failed');
            }
        } catch (error) {
            console.error('Verify error:', error);
            toast.error('Failed to verify code');
        } finally {
            setIsLoading(false);
        }
    };

    const handleOtpChange = (index: number, value: string) => {
        if (value.length > 1) { // Handle paste
            const digits = value.slice(0, 5).split('');
            const newDigits = [...otpDigits];
            digits.forEach((d, i) => {
                if (index + i < 5) newDigits[index + i] = d;
            });
            setOtpDigits(newDigits);
            const focusIndex = Math.min(index + digits.length, 4);
            otpInputRefs.current[focusIndex]?.focus();
        } else {
            const newDigits = [...otpDigits];
            newDigits[index] = value;
            setOtpDigits(newDigits);
            if (value && index < 4) otpInputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
            otpInputRefs.current[index - 1]?.focus();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
                    <h3 className="text-lg font-semibold text-foreground">Connect Telegram</h3>
                    <button onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
                        <X size={18} className="text-muted-foreground" />
                    </button>
                </div>

                <div className="p-6">
                    <AnimatePresence mode="wait">
                        {step === 'phone' ? (
                            <motion.form
                                key="phone"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                onSubmit={handleSendCode}
                                className="space-y-4"
                            >
                                <div className="text-center mb-6">
                                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-3">
                                        <Phone className="w-6 h-6 text-primary" />
                                    </div>
                                    <p className="text-sm text-muted-foreground">
                                        Enter your phone number to connect your Telegram account for storage.
                                    </p>
                                </div>

                                <AuthInput
                                    label="Phone Number"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    placeholder="+1234567890"
                                    icon={<Phone size={18} />}
                                    required
                                />

                                <AuthButton type="submit" isLoading={isLoading}>
                                    Send Code <ArrowRight className="ml-2 w-4 h-4" />
                                </AuthButton>
                            </motion.form>
                        ) : (
                            <motion.div
                                key="otp"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="space-y-6"
                            >
                                <div className="text-center">
                                    <h3 className="font-semibold text-foreground">Enter Verification Code</h3>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Sent to your Telegram app
                                    </p>
                                </div>

                                {isTwoFactorAuth ? (
                                    <div className="space-y-4">
                                        <div className="p-3 bg-amber-500/10 rounded-lg flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                                            <Lock size={16} />
                                            Two-Step Verification Required
                                        </div>
                                        <AuthInput
                                            label="Cloud Password"
                                            type={showPassword ? 'text' : 'password'}
                                            value={twoFactorPassword}
                                            onChange={(e) => setTwoFactorPassword(e.target.value)}
                                            placeholder="Enter your password"
                                            showPasswordToggle
                                            isPasswordVisible={showPassword}
                                            onPasswordToggle={() => setShowPassword(!showPassword)}
                                        />
                                    </div>
                                ) : (
                                    <div className="flex gap-2 justify-center">
                                        {otpDigits.map((digit, i) => (
                                            <input
                                                key={i}
                                                ref={el => otpInputRefs.current[i] = el}
                                                type="text"
                                                inputMode="numeric"
                                                maxLength={5}
                                                value={digit}
                                                onChange={e => handleOtpChange(i, e.target.value.replace(/\D/g, ''))}
                                                onKeyDown={e => handleKeyDown(i, e)}
                                                className="w-12 h-14 text-center text-xl font-semibold rounded-xl border border-border bg-muted/50 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all outline-none"
                                            />
                                        ))}
                                    </div>
                                )}

                                <div className="space-y-3">
                                    <AuthButton onClick={handleVerify} isLoading={isLoading}>
                                        {isTwoFactorAuth ? 'Unlock & Connect' : 'Verify & Connect'}
                                    </AuthButton>

                                    <button
                                        onClick={() => setStep('phone')}
                                        className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        Change phone number
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    );
}
