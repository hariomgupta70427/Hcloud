import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as authService from '@/services/authService';
import { UserData, RegisterData } from '@/services/authService';

interface AuthState {
  user: UserData | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
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
      isInitialized: false,
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

        // Show the persisted user immediately so the dashboard renders without a
        // flash of the login screen — but treat it as UNCONFIRMED until Firebase
        // says otherwise. `isAuthenticated` here means "the UI may render",
        // not "we hold a valid credential".
        if (persistedUser) {
          set({ isAuthenticated: true, isLoading: false, isInitialized: true });
        } else {
          set({ isLoading: true });
        }

        const unsubscribe = authService.onAuthStateChange((user) => {
          if (user) {
            // Firebase confirmed the session — refresh with authoritative data
            // from Firestore (this is also what restores byodConfig.telegramSession,
            // which is deliberately not persisted to localStorage).
            set({ user, isAuthenticated: true, isLoading: false, isInitialized: true, error: null });
            return;
          }

          // Firebase reports NO signed-in user.
          //
          // This case used to keep the persisted user "logged in" forever, on the
          // theory that Firebase might just be slow to restore from IndexedDB.
          // The result was a dashboard that looked signed in but held no
          // credential, so every authenticated operation failed at once:
          //   • Firestore reads/writes -> "Missing or insufficient permissions"
          //     (rules see request.auth == null)
          //   • Render upload/stream    -> 401 "Missing or invalid Authorization
          //     header" (getIdToken has no currentUser to read)
          //   • Telegram re-verification -> could not save byodConfig
          // and no amount of retrying could fix it, because the UI never offered
          // a way back to the login screen.
          //
          // onAuthStateChange fires only AFTER Firebase has finished restoring
          // persistence, so a null here is authoritative: the session is gone.
          // Clear it and let the router send the user to login.
          if (get().user) {
            console.warn('[auth] Firebase session is no longer valid — signing out locally.');
          }
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            isInitialized: true,
          });
        });

        return unsubscribe;
      },
    }),
    {
      name: 'hcloud-auth',
      // SECURITY: never persist the Telegram session to localStorage.
      //
      // `byodConfig.telegramSession` is a FULL-ACCOUNT MTProto credential — it
      // grants read/write access to the user's entire Telegram account, not just
      // their HCloud files. Keeping it in localStorage meant any XSS on the site
      // (or any browser extension with page access) could exfiltrate it and take
      // over the account outright.
      //
      // Dropping it here is safe because initAuth()'s onAuthStateChange callback
      // reloads the full user document — session included — from Firestore on
      // every start. The persisted copy exists only so the UI can render
      // instantly before Firebase confirms; it never needs the credential.
      partialize: (state) => ({
        user: state.user
          ? {
              ...state.user,
              byodConfig: state.user.byodConfig
                ? { ...state.user.byodConfig, telegramSession: '' }
                : state.user.byodConfig,
            }
          : null,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
