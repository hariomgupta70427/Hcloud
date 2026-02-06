/**
 * Browser Polyfills
 * These are needed for Node.js packages to work in the browser
 */

import { Buffer } from 'buffer';

// Make Buffer available globally (needed by GramJS/telegram package)
if (typeof window !== 'undefined') {
    (window as any).Buffer = Buffer;
    (globalThis as any).Buffer = Buffer;
}

// Ensure global is defined
if (typeof global === 'undefined') {
    (window as any).global = globalThis;
}
