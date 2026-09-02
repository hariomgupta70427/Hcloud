import process from 'process';

/**
 * Browser shims.
 *
 * NOTE: `Buffer` is deliberately NOT polyfilled.
 *
 * Libraries feature-detect it (`typeof Buffer !== 'undefined'`) and switch to a
 * Node code path when it exists. The browser `buffer` package does not support
 * every encoding Node's Buffer does — notably `base64url` — so providing an
 * incomplete Buffer makes libraries fail in ways they would not if it were simply
 * absent. @fuman/utils, which mtcute uses to build the QR login URL, hit exactly
 * this and threw `TypeError: Unknown encoding: base64url`.
 *
 * Removing the shim fixed it: the library falls back to its own pure-JS base64,
 * which is correct. Do not re-add a Buffer global.
 */
if (typeof window !== 'undefined') {
    (window as any).global = window;

    if (!window.process) {
        (window as any).process = process;
    }
}
