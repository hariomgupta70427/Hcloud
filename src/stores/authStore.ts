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
  register: (data: RegisterData) => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (updates: { name?: string; phone?: string; avatar?: string }) => Promise<void>;
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

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),

      // Initialize auth state listener
      initAuth: () => {
        set({ isLoading: true });

        const unsubscribe = authService.onAuthStateChange((user) => {
          if (user) {
            set({ user, isAuthenticated: true, isLoading: false });
          } else {
            set({ user: null, isAuthenticated: false, isLoading: false });
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
