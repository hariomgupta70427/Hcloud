/**
 * Allowed browser origins for the API functions.
 *
 * The API used to answer every request with `Access-Control-Allow-Origin: *`,
 * which let any website on the internet call endpoints that upload files with
 * the operator's bot token and mint stream capabilities. Endpoints that perform
 * privileged actions must only be callable from HCloud itself.
 *
 * File-BYTE endpoints are different: a <video src> pointing at the stream proxy
 * is not a CORS request at all, and share links must work when embedded. Those
 * deliberately keep a permissive policy — possession of the file id or the
 * encrypted token is the capability there, not the origin.
 *
 * Configure extra origins with ALLOWED_ORIGINS (comma-separated).
 */

const DEFAULT_ORIGINS = [
    'https://hcloud-pi.vercel.app',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
];

function configuredOrigins(): string[] {
    const fromEnv = (process.env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((o) => o.trim().replace(/\/$/, ''))
        .filter(Boolean);

    // VERCEL_URL is the current deployment's own host — include it so preview
    // deployments work without extra configuration.
    const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';

    return [...DEFAULT_ORIGINS, ...fromEnv, ...(vercelUrl ? [vercelUrl] : [])];
}

export function isAllowedOrigin(origin: string): boolean {
    const normalized = origin.replace(/\/$/, '');
    const allowed = configuredOrigins();
    if (allowed.includes(normalized)) return true;

    // Any preview deployment of this project on vercel.app.
    try {
        const { protocol, hostname } = new URL(normalized);
        if (protocol === 'https:' && /(^|\.)vercel\.app$/.test(hostname)) return true;
    } catch {
        return false;
    }
    return false;
}
