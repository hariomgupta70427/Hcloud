/**
 * Service-worker registration.
 *
 * Lives in a module (rather than an inline <script> in index.html) so the
 * Content-Security-Policy can be `script-src 'self'` with no 'unsafe-inline'.
 */
export function registerServiceWorker(): void {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register('/sw.js')
            .catch((error) => {
                // A failed registration only costs offline support — never
                // surface it to the user or block startup.
                console.warn('[App] Service Worker registration failed:', error);
            });
    });
}
