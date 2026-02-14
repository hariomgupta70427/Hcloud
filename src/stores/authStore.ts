import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as authService from '@/services/authService';
import { UserData, RegisterData } from '@/services/authService';

interface AuthState {
  user: UserData | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  setUser: (user: UserData | null) => void;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (updates: { name?: string; phone?: string; avatar?: string }) => Promise<void>;
  updateBYODConfig: (config: { telegramSession: string; telegramUserId: string; verified: boolean }) => Promise<void>;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  initAuth: () => () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      setUser: (user) => set({ user, isAuthenticated: !!user }),

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const user = await authService.signIn(email, password);
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error: any) {
          let message = 'Login failed';
          if (error.code === 'auth/user-not-found') {
            message = 'No account found with this email';
          } else if (error.code === 'auth/wrong-password') {
            message = 'Incorrect password';
          } else if (error.code === 'auth/invalid-email') {
            message = 'Invalid email address';
          } else if (error.code === 'auth/too-many-requests') {
            message = 'Too many attempts. Please try again later';
          }
          set({ isLoading: false, error: message });
          throw new Error(message);
        }
      },

      loginWithGoogle: async () => {
        set({ isLoading: true, error: null });
        try {
          const user = await authService.signInWithGoogle();
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error: any) {
          let message = 'Google sign-in failed';
          if (error.code === 'auth/popup-closed-by-user') {
            message = 'Sign-in popup was closed';
          } else if (error.code === 'auth/popup-blocked') {
            message = 'Please enable popups for this site';
          } else if (error.code === 'auth/cancelled-popup-request') {
            message = 'Sign-in was cancelled';
          }
          set({ isLoading: false, error: message });
          throw new Error(message);
        }
      },

      register: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const user = await authService.signUp(data);
          set({
            user,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (error: any) {
          let message = 'Registration failed';
          if (error.code === 'auth/email-already-in-use') {
            message = 'An account with this email already exists';
          } else if (error.code === 'auth/invalid-email') {
            message = 'Invalid email address';
          } else if (error.code === 'auth/weak-password') {
            message = 'Password should be at least 6 characters';
          }
          set({ isLoading: false, error: message });
          throw new Error(message);
        }
      },

      logout: async () => {
        try {
          await authService.signOut();
          set({ user: null, isAuthenticated: false });
        } catch (error) {
          console.error('Logout error:', error);
        }
      },

      resetPassword: async (email) => {
        set({ isLoading: true, error: null });
        try {
          await authService.resetPassword(email);
          set({ isLoading: false });
        } catch (error: any) {
          let message = 'Failed to send reset email';
          if (error.code === 'auth/user-not-found') {
            message = 'No account found with this email';
          }
          set({ isLoading: false, error: message });
          throw new Error(message);
        }
      },

      updateProfile: async (updates) => {
        const { user } = get();
        if (!user) throw new Error('Not authenticated');

        set({ isLoading: true, error: null });
        try {
          await authService.updateProfile(user.id, updates);
          set({
            user: { ...user, ...updates },
            isLoading: false,
          });
        } catch (error) {
          set({ isLoading: false, error: 'Failed to update profile' });
          throw error;
        }
      },

      updateBYODConfig: async (config) => {
        const { user } = get();
        if (!user) throw new Error('Not authenticated');

        set({ isLoading: true, error: null });
        try {
          await authService.updateBYODConfig(user.id, config);
          set({
            user: {
              ...user,
              storageMode: 'byod',
              byodConfig: config
            },
            isLoading: false,
          });
        } catch (error) {
          set({ isLoading: false, error: 'Failed to update BYOD configuration' });
          throw error;
        }
      },

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),

      // Initialize auth state listener
      // IMPORTANT: Firebase's onAuthStateChanged only UPDATES user data.
      // It NEVER triggers logout. Only the explicit logout() action can clear the session.
      // This ensures PWA and multi-device sessions persist correctly.
      initAuth: () => {
        const persistedUser = get().user;

        // If we have a persisted user, trust it immediately (no loading state)
        if (persistedUser) {
          set({ isAuthenticated: true, isLoading: false });
        } else {
          set({ isLoading: true });
        }

        const unsubscribe = authService.onAuthStateChange((user) => {
          if (user) {
            // Firebase confirmed user - update with fresh data from Firestore
            set({ user, isAuthenticated: true, isLoading: false });
          } else {
            // Firebase says no user - but we DON'T log out automatically!
            // This can happen on PWA resume, multi-device, or slow IndexedDB restore.
            // We only clear loading state if we had no persisted user.
            if (!get().user) {
              // No persisted user either - genuinely not logged in
              set({ isAuthenticated: false, isLoading: false });
            }
            // If we DO have a persisted user, we keep them logged in.
            // The only way to log out is the explicit logout() action.
            set({ isLoading: false });
          }
        });

        return unsubscribe;
      },
    }),
    {
      name: 'hcloud-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated
      }),
    }
  )
);
