import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '');

  return {
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
    plugins: [
      react(),
      nodePolyfills({
        // Include polyfills for specific modules required by GramJS
        // Added 'crypto', 'net', 'tls' (as mocks)
        include: ['buffer', 'process', 'util', 'stream', 'events', 'path', 'querystring', 'url', 'http', 'https', 'os', 'assert', 'constants', 'zlib', 'crypto', 'net', 'tls'],
        globals: {
          Buffer: true,
          global: true,
          process: true,
        },
        protocolImports: true,
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      sourcemap: true,
      chunkSizeWarningLimit: 1600,
    },
    // Define environment variables
    define: {
      // Polyfill global for libraries that expect it
      'global': 'globalThis',
      'import.meta.env.FIREBASE_API_KEY': JSON.stringify(env.FIREBASE_API_KEY),
      'import.meta.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(env.FIREBASE_AUTH_DOMAIN),
      'import.meta.env.FIREBASE_PROJECT_ID': JSON.stringify(env.FIREBASE_PROJECT_ID),
      'import.meta.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(env.FIREBASE_STORAGE_BUCKET),
      'import.meta.env.FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(env.FIREBASE_MESSAGING_SENDER_ID),
      'import.meta.env.FIREBASE_APP_ID': JSON.stringify(env.FIREBASE_APP_ID),
      'import.meta.env.TELEGRAM_BOT_TOKEN': JSON.stringify(env.TELEGRAM_BOT_TOKEN),
      'import.meta.env.TELEGRAM_CHAT_ID': JSON.stringify(env.TELEGRAM_CHAT_ID),
      'import.meta.env.TELEGRAM_API_ID': JSON.stringify(env.TELEGRAM_API_ID),
      'import.meta.env.TELEGRAM_API_HASH': JSON.stringify(env.TELEGRAM_API_HASH),
    },
  };
});
