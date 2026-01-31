import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  phone?: string;
  storageMode: 'managed' | 'byod';
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Actions
  setUser: (user: User | null) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
  phone: string;
  storageMode: 'managed' | 'byod';
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,

      setUser: (user) => set({ user, isAuthenticated: !!user }),

      login: async (email, password) => {
        set({ isLoading: true });
        // Simulate API call
        await new Promise((resolve) => setTimeout(resolve, 1500));
        
        // Mock user for demo
        set({
          user: {
            id: '1',
            name: 'Demo User',
            email,
            storageMode: 'managed',
          },
          isAuthenticated: true,
          isLoading: false,
        });
      },

      register: async (data) => {
        set({ isLoading: true });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        
        set({
          user: {
            id: '1',
            name: data.name,
            email: data.email,
            phone: data.phone,
            storageMode: data.storageMode,
          },
          isAuthenticated: true,
          isLoading: false,
        });
      },

      logout: () => {
        set({ user: null, isAuthenticated: false });
      },

      setLoading: (isLoading) => set({ isLoading }),
    }),
    {
      name: 'hcloud-auth',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);
