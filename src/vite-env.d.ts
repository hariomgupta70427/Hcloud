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
