import { useEffect } from "react";
import { lazy, Suspense } from "react";
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

// Pulled out of the main bundle: this page (and only this page) loads mtcute.
const AccountLabPage = lazy(() => import("./pages/lab/AccountLabPage"));
const StorageLabPage = lazy(() => import("./pages/lab/StorageLabPage"));

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

/**
 * Guard for every signed-in route.
 *
 * The dashboard routes previously had NO guard: they rendered whether or not a
 * session existed. Combined with a dead Firebase session that meant the app
 * showed a normal-looking dashboard where every request failed —
 * "Missing or insufficient permissions" from Firestore, 401s from the upload
 * server — with no way back to the login screen. Redirecting here is what turns
 * an expired session into "please sign in again" instead of a broken app.
 *
 * AuthInitializer holds a splash screen until `isInitialized`, so by the time
 * this renders the auth state is settled and the redirect is not a false alarm.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isInitialized } = useAuthStore();

  if (!isInitialized) return null; // splash is still up

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
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
                {/* Task 2.0 gate. Unlisted, no auth: it proves browser MTProto works
                    on the deployed domain under the production CSP.
                    Lazy-loaded on purpose: mtcute is ~1.2MB and must not be in the
                    bundle every visitor downloads to reach the login page. */}
                <Route
                  path="/lab/storage"
                  element={
                    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading storage lab…</div>}>
                      <StorageLabPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/lab/account"
                  element={
                    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading account lab…</div>}>
                      <AccountLabPage />
                    </Suspense>
                  }
                />

                {/* Dashboard routes — require a live session */}
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <DashboardLayout />
                    </ProtectedRoute>
                  }
                >
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
