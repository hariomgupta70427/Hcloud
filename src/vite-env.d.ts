/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_APP_TITLE: string
    // more env variables...
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

declare global {
    interface Window {
        // Buffer is intentionally absent — see src/polyfills.ts.
        process: any;
    }
}

/**
 * Build fingerprint, injected by vite.config.ts `define`.
 * Stamped into the first line of every gate log so a transcript can never be
 * ambiguous about which build produced it.
 */
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;
