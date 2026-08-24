import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';
type ViewMode = 'grid' | 'list';

interface UIState {
  theme: Theme;
  sidebarCollapsed: boolean;
  viewMode: ViewMode;
  searchQuery: string;
  
  // Actions
  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setViewMode: (mode: ViewMode) => void;
  setSearchQuery: (query: string) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      viewMode: 'grid',
      searchQuery: '',

      setTheme: (theme) => {
        const root = window.document.documentElement;
        root.classList.remove('light', 'dark');
        
        if (theme === 'system') {
          const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          root.classList.add(systemTheme);
        } else {
          root.classList.add(theme);
        }
        
        set({ theme });
      },

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      
      setViewMode: (viewMode) => set({ viewMode }),
      
      setSearchQuery: (searchQuery) => set({ searchQuery }),
    }),
    {
      name: 'hcloud-ui',
      partialize: (state) => ({ 
        theme: state.theme, 
        sidebarCollapsed: state.sidebarCollapsed,
        viewMode: state.viewMode,
      }),
    }
  )
);

// Initialize theme on load.
// This runs at module scope, BEFORE React mounts, so anything that throws here
// white-screens the entire app with no error boundary to catch it. A single
// corrupt 'hcloud-ui' entry (or localStorage being unavailable in a locked-down
// browser) used to be enough. Never let this block throw.
if (typeof window !== 'undefined') {
  let theme: Theme = 'dark';
  try {
    const stored = localStorage.getItem('hcloud-ui');
    if (stored) {
      const parsed = JSON.parse(stored)?.state?.theme;
      if (parsed === 'light' || parsed === 'dark' || parsed === 'system') {
        theme = parsed;
      }
    }
  } catch {
    // Corrupt JSON or inaccessible storage — fall back to the default.
  }

  try {
    const root = window.document.documentElement;
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  } catch {
    // Nothing sensible to do if the DOM/matchMedia is unavailable.
  }
}
