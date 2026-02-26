import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./components/ThemeProvider";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { useAuthStore } from "./stores/authStore";
import { motion, AnimatePresence } from "framer-motion";
import { Cloud } from "lucide-react";
import AuthPage from "./pages/AuthPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import DashboardLayout from "./layouts/DashboardLayout";
import DashboardPage from "./pages/dashboard/DashboardPage";
import FilesPage from "./pages/dashboard/FilesPage";
import StarredPage from "./pages/dashboard/StarredPage";
import RecentPage from "./pages/dashboard/RecentPage";
import SharedPage from "./pages/dashboard/SharedPage";
import TrashPage from "./pages/dashboard/TrashPage";
import SettingsPage from "./pages/dashboard/SettingsPage";
import ProfilePage from "./pages/dashboard/ProfilePage";
import SharedFilePage from "./pages/public/SharedFilePage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Premium loading splash screen - shown while auth initializes
function AuthSplashScreen() {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background">
      {/* Ambient gradient background */}
      <div className="absolute inset-0 gradient-mesh opacity-40" />

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative flex flex-col items-center gap-4"
      >
        {/* Animated logo */}
        <motion.div
          animate={{
            boxShadow: [
              "0 0 20px hsl(351 52% 63% / 0.3)",
              "0 0 40px hsl(351 52% 63% / 0.5)",
              "0 0 20px hsl(351 52% 63% / 0.3)",
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
          className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center"
        >
          <Cloud className="w-8 h-8 text-white" />
        </motion.div>

        {/* Brand name */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="text-2xl font-bold text-gradient"
        >
          HCloud
        </motion.h1>

        {/* Loading bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="w-32 h-1 rounded-full bg-muted overflow-hidden"
        >
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{
              duration: 1,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="h-full w-1/2 rounded-full gradient-primary"
          />
        </motion.div>
      </motion.div>
    </div>
  );
}

// Auth initializer component
function AuthInitializer({ children }: { children: React.ReactNode }) {
  const { initAuth, isInitialized } = useAuthStore();

  useEffect(() => {
    // Initialize Firebase auth listener
    const unsubscribe = initAuth();
    return () => unsubscribe();
  }, [initAuth]);

  // Show splash screen until auth is initialized
  return (
    <AnimatePresence mode="wait">
      {!isInitialized ? (
        <AuthSplashScreen key="splash" />
      ) : (
        <motion.div
          key="app"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="h-full"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Protected route wrapper: redirects authenticated users away from auth pages
function AuthRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

const App = () => (
  <ThemeProvider defaultTheme="system" storageKey="hcloud-theme">
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthInitializer>
              <Routes>
                {/* Auth routes — redirect to dashboard if already authenticated */}
                <Route path="/" element={<Navigate to="/auth" replace />} />
                <Route
                  path="/auth"
                  element={
                    <AuthRoute>
                      <AuthPage />
                    </AuthRoute>
                  }
                />
                {/* Legacy routes redirect to unified auth */}
                <Route path="/login" element={<Navigate to="/auth" replace />} />
                <Route path="/register" element={<Navigate to="/auth?mode=signup" replace />} />
                <Route
                  path="/forgot-password"
                  element={
                    <AuthRoute>
                      <ForgotPasswordPage />
                    </AuthRoute>
                  }
                />

                {/* Public Shared File Route */}
                <Route path="/s/:id" element={<SharedFilePage />} />

                {/* Dashboard routes */}
                <Route path="/dashboard" element={<DashboardLayout />}>
                  <Route index element={<DashboardPage />} />
                  <Route path="files" element={<FilesPage />} />
                  <Route path="starred" element={<StarredPage />} />
                  <Route path="recent" element={<RecentPage />} />
                  <Route path="shared" element={<SharedPage />} />
                  <Route path="trash" element={<TrashPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="profile" element={<ProfilePage />} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
            </AuthInitializer>
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </ThemeProvider>
);

export default App;
