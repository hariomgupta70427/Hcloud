import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execSync } from "node:child_process";
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '');

  /**
   * Build fingerprint, injected into the bundle.
   *
   * WHY: a browser tab holding a stale bundle produced a gate transcript that
   * looked valid but came from pre-fix code. It took a string-by-string diff of
   * dist/ to establish that. Stamping the build into the first line of every log
   * makes a transcript self-identifying, so this can never be ambiguous again.
   *
   * Do NOT rely on external signals (dcOptions counts, timings) to infer which
   * build ran — Telegram can change those whenever it likes.
   */
  let buildSha = 'unknown';
  try {
    buildSha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
    if (dirty) buildSha += '-dirty';
  } catch {
    // A build outside a git checkout still works; it just cannot self-identify.
  }
  const buildTime = new Date().toISOString();

  return {
    server: {
      port: 5173,
      strictPort: false,
      host: 'localhost',
      hmr: true,
    },
    plugins: [
      react(),
      // Minimal polyfills, and deliberately NO Buffer global.
      //
      // Injecting a fake `Buffer` is actively harmful, not merely dead weight.
      // Libraries feature-detect with `typeof Buffer !== 'undefined'` and then
      // take their Node code path — but the browser `buffer` package (6.0.3) does
      // not implement every encoding Node's does. @fuman/utils (used by mtcute)
      // does exactly this:
      //
      //     if (typeof Buffer !== 'undefined')
      //         return Buffer.from(bytes).toString(url ? 'base64url' : 'base64')
      //
      // With the polyfill present that throws `TypeError: Unknown encoding:
      // base64url`, which broke QR login. With no Buffer at all it uses its own
      // pure-JS base64, which handles base64url correctly. Removing the shim FIXED
      // the feature.
      //
      // gramjs, which is what originally needed crypto/stream/vm/zlib shims, no
      // longer runs in the browser at all.
      nodePolyfills({
        include: ['process', 'util', 'events'],
        globals: {
          Buffer: false,
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
      // Telegram app credentials for browser MTProto (account mode).
      // These ARE client-visible and that is BY DESIGN: browser MTProto cannot
      // work without them, and every third-party Telegram client ships its own.
      // They are app identifiers and grant access to no account. The mitigation
      // is multiple registered api_ids selected by remote config (R5), not
      // secrecy. See ARCHITECTURE-V3 section 14 — do NOT remove these.
      'import.meta.env.TELEGRAM_API_ID': JSON.stringify(env.TELEGRAM_API_ID),
      'import.meta.env.TELEGRAM_API_HASH': JSON.stringify(env.TELEGRAM_API_HASH),
      // Build fingerprint — see the note above. Never secret.
      '__BUILD_SHA__': JSON.stringify(buildSha),
      '__BUILD_TIME__': JSON.stringify(buildTime),
      // NOTE: no Telegram credentials are exposed to the client.
      // TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID have always been server-only.
      // TELEGRAM_API_ID / TELEGRAM_API_HASH were briefly exposed here for an
      // abandoned in-browser MTProto upload path; they are secrets that grant
      // access to the Telegram app itself, so they are now server-only too and
      // live exclusively on Vercel + Render.
    },
  };
});
