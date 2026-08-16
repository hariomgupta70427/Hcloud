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
      hmr: true,
    },
    plugins: [
      react(),
      // Minimal polyfills. gramjs (which needed crypto/stream/vm/zlib/http
      // shims) no longer runs in the browser — all MTProto work happens on the
      // Render server — so only the small set that library code still touches is
      // shimmed. Dropping the rest removes a large amount of dead weight from
      // the bundle and the crypto-browserify shim that required eval().
      nodePolyfills({
        include: ['buffer', 'process', 'util', 'events'],
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
      // Source maps are NOT emitted for production: they would publish the
      // entire readable source of the app to anyone who opens devtools.
      sourcemap: mode !== 'production',
      chunkSizeWarningLimit: 1600,
      rollupOptions: {
        output: {
          // Split the heaviest vendor code so the initial page load doesn't
          // have to parse everything at once.
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-firebase': ['firebase/app', 'firebase/auth', 'firebase/firestore'],
            'vendor-motion': ['framer-motion'],
          },
        },
      },
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
      // NOTE: no Telegram credentials are exposed to the client.
      // TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID have always been server-only.
      // TELEGRAM_API_ID / TELEGRAM_API_HASH were briefly exposed here for an
      // abandoned in-browser MTProto upload path; they are secrets that grant
      // access to the Telegram app itself, so they are now server-only too and
      // live exclusively on Vercel + Render.
    },
  };
});
