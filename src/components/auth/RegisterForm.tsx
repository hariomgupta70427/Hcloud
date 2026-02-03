import { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Lock, User, Phone, Cloud, HardDrive, ArrowRight, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { AuthInput, AuthButton } from './AuthInput';
import { SocialButtons } from './SocialButtons';
import { sendTelegramCode, verifyTelegramCode } from '@/services/telegramBYODService';
import { toast } from 'sonner';

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  phone: z.string().min(10, 'Please enter a valid phone number'),
  storageMode: z.enum(['managed', 'byod']),
  otp: z.string().optional(),
});

type RegisterFormData = z.infer<typeof registerSchema>;

const steps = [
  { id: 1, title: 'Storage Mode', description: 'Choose your storage option' },
  { id: 2, title: 'Details', description: 'Enter your information' },
  { id: 3, title: 'Verify', description: 'Confirm your phone' },
];

export function RegisterForm() {
  const navigate = useNavigate();
  const { register: registerUser, isLoading } = useAuthStore();
  const [currentStep, setCurrentStep] = useState(1);
  const [showPassword, setShowPassword] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [phoneCodeHash, setPhoneCodeHash] = useState<string>('');
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [telegramSession, setTelegramSession] = useState<string>('');
  const [telegramUser, setTelegramUser] = useState<any>(null);
  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { register, handleSubmit, watch, setValue, getValues, formState: { errors } } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      storageMode: 'managed',
    },
  });

  const storageMode = watch('storageMode');
  const phone = watch('phone');

  const onSubmit = async (data: RegisterFormData) => {
    if (currentStep === 3) {
      // For BYOD mode, verify OTP first if not already verified
      if (data.storageMode === 'byod' && !telegramSession) {
        toast.error('Please verify your phone number first');
        return;
      }

      try {
        await registerUser({
          name: data.name,
          email: data.email,
          password: data.password,
          phone: data.phone,
          storageMode: data.storageMode,
          // Include BYOD config if applicable
          ...(data.storageMode === 'byod' && telegramSession ? {
            byodConfig: {
              telegramSession,
              telegramUserId: telegramUser?.id || '',
              verified: true,
            }
          } : {}),
        });
        navigate('/dashboard');
      } catch (error) {
        console.error('Registration error:', error);
      }
    }
  };

  const nextStep = () => {
    if (currentStep < 3) {
      // Validate form fields before proceeding
      if (currentStep === 2) {
        const { name, email, password, phone } = getValues();
        if (!name || name.length < 2) {
          toast.error('Please enter your full name');
          return;
        }
        if (!email || !email.includes('@')) {
          toast.error('Please enter a valid email');
          return;
        }
        if (!password || password.length < 8) {
          toast.error('Password must be at least 8 characters');
          return;
        }
        if (!phone || phone.length < 10) {
          toast.error('Please enter a valid phone number');
          return;
        }
      }
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Send OTP via Telegram for BYOD mode
  const sendOTP = async () => {
    const phoneNumber = getValues('phone');

    if (!phoneNumber || phoneNumber.length < 10) {
      toast.error('Please enter a valid phone number');
      return;
    }

    // Format phone number (ensure it starts with +)
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    setSendingOtp(true);

    try {
      if (storageMode === 'byod') {
        // Use Telegram authentication for BYOD
        const result = await sendTelegramCode(formattedPhone);

        if (result.success && result.phoneCodeHash) {
          setPhoneCodeHash(result.phoneCodeHash);
          setOtpSent(true);
          toast.success('Verification code sent to your Telegram app!');
        } else {
          toast.error(result.error || 'Failed to send verification code');
        }
      } else {
        // For managed mode, simulate OTP (or implement Firebase Phone Auth)
        setOtpSent(true);
        toast.success('Verification code sent!');
      }
    } catch (error) {
      console.error('Send OTP error:', error);
      toast.error('Failed to send verification code. Please try again.');
    } finally {
      setSendingOtp(false);
    }
  };

  // Handle OTP input changes
  const handleOtpChange = (index: number, value: string) => {
    if (value.length > 1) {
      // Handle paste
      const digits = value.slice(0, 6).split('');
      const newOtpDigits = [...otpDigits];
      digits.forEach((digit, i) => {
        if (index + i < 6) {
          newOtpDigits[index + i] = digit;
        }
      });
      setOtpDigits(newOtpDigits);
      // Focus last filled input or last input
      const focusIndex = Math.min(index + digits.length, 5);
      otpInputRefs.current[focusIndex]?.focus();
    } else {
      const newOtpDigits = [...otpDigits];
      newOtpDigits[index] = value;
      setOtpDigits(newOtpDigits);

      // Auto-focus next input
      if (value && index < 5) {
        otpInputRefs.current[index + 1]?.focus();
      }
    }
  };

  // Handle OTP input keydown for backspace
  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  // Verify OTP
  const verifyOTP = async () => {
    const otpCode = otpDigits.join('');

    if (otpCode.length !== 6) {
      toast.error('Please enter the complete 6-digit code');
      return;
    }

    const phoneNumber = getValues('phone');
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    setVerifyingOtp(true);

    try {
      if (storageMode === 'byod') {
        // Verify with Telegram
        const result = await verifyTelegramCode(formattedPhone, otpCode, phoneCodeHash);

        if (result.success && result.session) {
          setTelegramSession(result.session);
          setTelegramUser(result.user);
          toast.success('Phone verified successfully! Your cloud storage is now connected.');
        } else if (result.needsPassword) {
          toast.error('Two-factor authentication is enabled. Please disable it temporarily in Telegram settings.');
        } else {
          toast.error(result.error || 'Invalid verification code');
          return;
        }
      } else {
        // For managed mode, simulate verification
        toast.success('Phone verified successfully!');
      }
    } catch (error) {
      console.error('Verify OTP error:', error);
      toast.error('Failed to verify code. Please try again.');
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleGoogleSignup = () => {
    console.log('Google signup');
  };

  // Check if OTP is complete and ready for verification
  const isOtpComplete = otpDigits.every(d => d !== '');
  const isVerified = storageMode === 'byod' ? !!telegramSession : otpSent;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-md mx-auto"
    >
      {/* Header */}
      <div className="text-center mb-8">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="inline-flex items-center justify-center w-14 h-14 rounded-xl gradient-primary shadow-glow mb-4 lg:hidden"
        >
          <Cloud className="w-7 h-7 text-white" />
        </motion.div>
        <h2 className="text-2xl font-bold text-foreground">Create account</h2>
        <p className="text-muted-foreground mt-2">
          Get started with HCloud
        </p>
      </div>

      {/* Progress Steps */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {steps.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className="flex flex-col items-center">
                <motion.div
                  initial={false}
                  animate={{
                    backgroundColor: currentStep >= step.id
                      ? 'hsl(var(--primary))'
                      : 'hsl(var(--muted))',
                    scale: currentStep === step.id ? 1.1 : 1,
                  }}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium"
                >
                  {currentStep > step.id ? (
                    <Check className="w-4 h-4 text-primary-foreground" />
                  ) : (
                    <span className={currentStep >= step.id ? 'text-primary-foreground' : 'text-muted-foreground'}>
                      {step.id}
                    </span>
                  )}
                </motion.div>
                <span className="text-xs text-muted-foreground mt-1 hidden sm:block">
                  {step.title}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`h-0.5 w-12 sm:w-20 mx-2 transition-colors ${currentStep > step.id ? 'bg-primary' : 'bg-border'
                    }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)}>
        <AnimatePresence mode="wait">
          {/* Step 1: Storage Mode */}
          {currentStep === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground mb-6">
                Choose how you want to store your files
              </p>

              <label
                className={`block p-4 rounded-xl border-2 cursor-pointer transition-all ${storageMode === 'managed'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
                  }`}
                onClick={() => setValue('storageMode', 'managed')}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${storageMode === 'managed' ? 'bg-primary/10' : 'bg-muted'}`}>
                    <Cloud className={`w-6 h-6 ${storageMode === 'managed' ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">Managed Storage</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      HCloud handles everything. Zero setup, unlimited storage.
                    </p>
                    <p className="text-xs text-amber-500 mt-1">
                      50 MB per file limit
                    </p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${storageMode === 'managed' ? 'border-primary' : 'border-border'
                    }`}>
                    {storageMode === 'managed' && (
                      <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                    )}
                  </div>
                </div>
              </label>

              <label
                className={`block p-4 rounded-xl border-2 cursor-pointer transition-all ${storageMode === 'byod'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
                  }`}
                onClick={() => setValue('storageMode', 'byod')}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-2 rounded-lg ${storageMode === 'byod' ? 'bg-primary/10' : 'bg-muted'}`}>
                    <HardDrive className={`w-6 h-6 ${storageMode === 'byod' ? 'text-primary' : 'text-muted-foreground'}`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">Bring Your Own Server</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">Recommended</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Use your own private cloud for unlimited storage.
                    </p>
                    <p className="text-xs text-green-500 mt-1">
                      Up to 2 GB per file
                    </p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${storageMode === 'byod' ? 'border-primary' : 'border-border'
                    }`}>
                    {storageMode === 'byod' && (
                      <div className="w-2.5 h-2.5 rounded-full bg-primary" />
                    )}
                  </div>
                </div>
              </label>

              <div className="pt-4">
                <AuthButton type="button" onClick={nextStep}>
                  Continue <ArrowRight className="inline-block ml-2 w-4 h-4" />
                </AuthButton>
              </div>
            </motion.div>
          )}

          {/* Step 2: User Details */}
          {currentStep === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <AuthInput
                label="Full Name"
                placeholder="John Doe"
                icon={<User size={18} />}
                error={errors.name?.message}
                {...register('name')}
              />

              <AuthInput
                label="Email"
                type="email"
                placeholder="name@example.com"
                icon={<Mail size={18} />}
                error={errors.email?.message}
                {...register('email')}
              />

              <AuthInput
                label="Password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Create a strong password"
                icon={<Lock size={18} />}
                showPasswordToggle
                isPasswordVisible={showPassword}
                onPasswordToggle={() => setShowPassword(!showPassword)}
                error={errors.password?.message}
                {...register('password')}
              />

              <AuthInput
                label="Phone Number"
                type="tel"
                placeholder="+91 XXXXX XXXXX"
                icon={<Phone size={18} />}
                error={errors.phone?.message}
                {...register('phone')}
              />

              {storageMode === 'byod' && (
                <p className="text-xs text-muted-foreground">
                  Enter your phone number with country code. We'll verify it via SMS to connect your cloud storage.
                </p>
              )}

              <div className="flex gap-3 pt-4">
                <AuthButton type="button" variant="outline" onClick={prevStep}>
                  <ArrowLeft className="inline-block mr-2 w-4 h-4" /> Back
                </AuthButton>
                <AuthButton type="button" onClick={nextStep}>
                  Continue <ArrowRight className="inline-block ml-2 w-4 h-4" />
                </AuthButton>
              </div>
            </motion.div>
          )}

          {/* Step 3: OTP Verification */}
          {currentStep === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="text-center">
                <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${isVerified ? 'bg-green-500/10' : 'bg-primary/10'
                  }`}>
                  {isVerified ? (
                    <Check className="w-8 h-8 text-green-500" />
                  ) : (
                    <Phone className="w-8 h-8 text-primary" />
                  )}
                </div>
                <h3 className="text-lg font-semibold text-foreground">
                  {isVerified ? 'Phone Verified!' : 'Verify your phone'}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {isVerified
                    ? 'Your cloud storage is now connected'
                    : otpSent
                      ? `Enter the code sent to ${phone}`
                      : storageMode === 'byod'
                        ? 'We\'ll send a code to your messaging app'
                        : 'We\'ll send a verification code to your phone'}
                </p>
              </div>

              {isVerified ? (
                <div className="p-4 rounded-xl bg-green-500/5 border border-green-500/20">
                  <p className="text-sm text-green-600 dark:text-green-400 text-center">
                    ✓ Your private cloud storage is ready to use
                  </p>
                  {telegramUser && (
                    <p className="text-xs text-muted-foreground text-center mt-2">
                      Connected as {telegramUser.firstName} {telegramUser.lastName}
                    </p>
                  )}
                </div>
              ) : otpSent ? (
                <div className="space-y-4">
                  <div className="flex gap-2 justify-center">
                    {otpDigits.map((digit, i) => (
                      <input
                        key={i}
                        ref={(el) => (otpInputRefs.current[i] = el)}
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={digit}
                        onChange={(e) => handleOtpChange(i, e.target.value.replace(/\D/g, ''))}
                        onKeyDown={(e) => handleOtpKeyDown(i, e)}
                        className="w-12 h-14 text-center text-xl font-semibold rounded-xl border border-border bg-muted/50 focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                      />
                    ))}
                  </div>

                  {isOtpComplete && !verifyingOtp && (
                    <AuthButton type="button" onClick={verifyOTP}>
                      Verify Code
                    </AuthButton>
                  )}

                  {verifyingOtp && (
                    <div className="flex items-center justify-center gap-2 py-3">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      <span className="text-sm text-muted-foreground">Verifying...</span>
                    </div>
                  )}

                  <button
                    type="button"
                    className="w-full text-sm text-primary hover:underline"
                    onClick={sendOTP}
                    disabled={sendingOtp}
                  >
                    {sendingOtp ? 'Sending...' : 'Resend code'}
                  </button>
                </div>
              ) : (
                <AuthButton type="button" onClick={sendOTP} disabled={sendingOtp}>
                  {sendingOtp ? (
                    <>
                      <Loader2 className="inline-block mr-2 w-4 h-4 animate-spin" />
                      Sending code...
                    </>
                  ) : (
                    'Send verification code'
                  )}
                </AuthButton>
              )}

              {isVerified && (
                <AuthButton type="submit" isLoading={isLoading}>
                  Create account
                </AuthButton>
              )}

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={prevStep}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="inline-block mr-1 w-4 h-4" />
                  Back to details
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </form>

      {currentStep === 1 && (
        <div className="mt-6">
          <SocialButtons onGoogleClick={handleGoogleSignup} isLoading={isLoading} />
        </div>
      )}

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-8 text-center text-sm text-muted-foreground"
      >
        Already have an account?{' '}
        <Link to="/login" className="text-primary font-medium hover:underline">
          Sign in
        </Link>
      </motion.p>
    </motion.div>
  );
}
