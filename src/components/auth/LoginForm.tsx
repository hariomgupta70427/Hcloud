import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Mail, Lock, Cloud } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { AuthInput, AuthButton } from './AuthInput';
import { SocialButtons } from './SocialButtons';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  rememberMe: z.boolean().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
  onSwitchToSignup?: () => void;
}

export function LoginForm({ onSwitchToSignup }: LoginFormProps) {
  const navigate = useNavigate();
  const { login, loginWithGoogle, isLoading, error } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      rememberMe: true,
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      await login(data.email, data.password);
      navigate('/dashboard');
    } catch (error) {
      // Error is handled by the store
      console.error('Login error:', error);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      await loginWithGoogle();
      navigate('/dashboard');
    } catch (error) {
      console.error('Google login error:', error);
    }
  };

  // Stagger animation for form children
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.07, delayChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="w-full"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="text-center mb-8">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="inline-flex items-center justify-center w-14 h-14 rounded-xl gradient-primary shadow-glow mb-4 lg:hidden"
        >
          <Cloud className="w-7 h-7 text-white" />
        </motion.div>
        <h2 className="text-2xl font-bold text-foreground">Sign in</h2>
        <p className="text-muted-foreground mt-2">
          Welcome back to HCloud
        </p>
      </motion.div>

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive text-center"
        >
          {error}
        </motion.div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <motion.div variants={itemVariants}>
          <AuthInput
            label="Email"
            type="email"
            placeholder="name@example.com"
            icon={<Mail size={18} />}
            error={errors.email?.message}
            autoComplete="email"
            {...register('email')}
          />
        </motion.div>

        <motion.div variants={itemVariants}>
          <AuthInput
            label="Password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Enter your password"
            icon={<Lock size={18} />}
            showPasswordToggle
            isPasswordVisible={showPassword}
            onPasswordToggle={() => setShowPassword(!showPassword)}
            error={errors.password?.message}
            autoComplete="current-password"
            {...register('password')}
          />
        </motion.div>

        <motion.div variants={itemVariants} className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer group">
            <div className="relative">
              <input
                type="checkbox"
                className="peer sr-only"
                {...register('rememberMe')}
              />
              <div className="w-4 h-4 rounded border-2 border-border peer-checked:bg-primary peer-checked:border-primary transition-all flex items-center justify-center">
                <svg className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </div>
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
              Remember me
            </span>
          </label>
          <a
            href="/forgot-password"
            className="text-sm text-primary font-medium hover:underline transition-colors"
          >
            Forgot password?
          </a>
        </motion.div>

        <motion.div variants={itemVariants}>
          <AuthButton type="submit" isLoading={isLoading}>
            Sign in
          </AuthButton>
        </motion.div>

        <motion.div variants={itemVariants}>
          <SocialButtons
            onGoogleClick={handleGoogleLogin}
            isLoading={isLoading}
          />
        </motion.div>
      </form>

      <motion.p
        variants={itemVariants}
        className="mt-8 text-center text-sm text-muted-foreground"
      >
        Don't have an account?{' '}
        <button
          type="button"
          onClick={onSwitchToSignup}
          className="text-primary font-medium hover:underline transition-colors"
        >
          Create account
        </button>
      </motion.p>
    </motion.div>
  );
}
