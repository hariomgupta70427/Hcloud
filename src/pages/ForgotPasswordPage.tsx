import { AnimatedBackground } from '@/components/auth/AnimatedBackground';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen flex">
      {/* Left side - Animated Background */}
      <div className="hidden lg:block lg:w-1/2 xl:w-3/5 bg-background">
        <AnimatedBackground />
      </div>
      
      {/* Right side - Forgot Password Form */}
      <div className="w-full lg:w-1/2 xl:w-2/5 flex items-center justify-center p-8 bg-card">
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
