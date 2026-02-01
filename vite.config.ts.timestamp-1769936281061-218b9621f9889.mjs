// vite.config.ts
import { defineConfig } from "file:///D:/Work/Github%20Repo/Hcloud/HaRiverse%20Hcloud/node_modules/vite/dist/node/index.js";
import react from "file:///D:/Work/Github%20Repo/Hcloud/HaRiverse%20Hcloud/node_modules/@vitejs/plugin-react-swc/index.js";
import path from "path";
var __vite_injected_original_dirname = "D:\\Work\\Github Repo\\Hcloud\\HaRiverse Hcloud";
var vite_config_default = defineConfig({
  server: {
    port: 8080,
    strictPort: true,
    watch: {
      // Use polling for file watching (works better on Windows)
      usePolling: true,
      interval: 1e3
    },
    hmr: false
    // Disable WebSocket HMR to avoid connection issues
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  },
  build: {
    sourcemap: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJEOlxcXFxXb3JrXFxcXEdpdGh1YiBSZXBvXFxcXEhjbG91ZFxcXFxIYVJpdmVyc2UgSGNsb3VkXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJEOlxcXFxXb3JrXFxcXEdpdGh1YiBSZXBvXFxcXEhjbG91ZFxcXFxIYVJpdmVyc2UgSGNsb3VkXFxcXHZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9EOi9Xb3JrL0dpdGh1YiUyMFJlcG8vSGNsb3VkL0hhUml2ZXJzZSUyMEhjbG91ZC92aXRlLmNvbmZpZy50c1wiO2ltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ2aXRlXCI7XG5pbXBvcnQgcmVhY3QgZnJvbSBcIkB2aXRlanMvcGx1Z2luLXJlYWN0LXN3Y1wiO1xuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIjtcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDgwODAsXG4gICAgc3RyaWN0UG9ydDogdHJ1ZSxcbiAgICB3YXRjaDoge1xuICAgICAgLy8gVXNlIHBvbGxpbmcgZm9yIGZpbGUgd2F0Y2hpbmcgKHdvcmtzIGJldHRlciBvbiBXaW5kb3dzKVxuICAgICAgdXNlUG9sbGluZzogdHJ1ZSxcbiAgICAgIGludGVydmFsOiAxMDAwLFxuICAgIH0sXG4gICAgaG1yOiBmYWxzZSwgLy8gRGlzYWJsZSBXZWJTb2NrZXQgSE1SIHRvIGF2b2lkIGNvbm5lY3Rpb24gaXNzdWVzXG4gIH0sXG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICBcIkBcIjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyY1wiKSxcbiAgICB9LFxuICB9LFxuICBidWlsZDoge1xuICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFpVSxTQUFTLG9CQUFvQjtBQUM5VixPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBS3pDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQSxJQUNaLE9BQU87QUFBQTtBQUFBLE1BRUwsWUFBWTtBQUFBLE1BQ1osVUFBVTtBQUFBLElBQ1o7QUFBQSxJQUNBLEtBQUs7QUFBQTtBQUFBLEVBQ1A7QUFBQSxFQUNBLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxXQUFXO0FBQUEsRUFDYjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
