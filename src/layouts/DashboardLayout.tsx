import { Outlet, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { MobileBottomNav } from '@/components/pwa/MobileBottomNav';
import { PWAInstallPrompt } from '@/components/pwa/PWAInstallPrompt';

export default function DashboardLayout() {
  const { isAuthenticated, isLoading } = useAuthStore();

  // Show loading state while auth is initializing
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="pwa-spinner" />
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar - hidden on mobile */}
      <div className="mobile-hide-sidebar">
        <Sidebar />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6 scroll-smooth mobile-main-padding">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <MobileBottomNav />

      {/* PWA Install Prompt */}
      <PWAInstallPrompt />
    </div>
  );
}
