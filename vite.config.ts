import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
    host: 'localhost',
    watch: {
      // Use polling for file watching (works better on Windows)
      usePolling: true,
      interval: 1000,
    },
    hmr: true, // Re-enable HMR for faster development
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
  },
});
