#!/usr/bin/env node
/**
 * Serves dist/ with the EXACT Content-Security-Policy from vercel.json.
 *
 * WHY: `vite dev` and `vite preview` apply no CSP, so a feature can work locally
 * and be blocked in production by a policy nobody tested. Browser MTProto is
 * exactly that kind of feature — it needs 'wasm-unsafe-eval' for mtcute's WASM
 * crypto and wss://*.web.telegram.org in connect-src.
 *
 * Usage:
 *   npm run build
 *   npm run serve:csp        # http://localhost:4178
 *
 * The CSP is read live from vercel.json, so it cannot drift from what deploys.
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const PORT = Number(process.env.PORT ?? 4178);
const ROOT = 'dist';

const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
const CSP = vercel.headers
    .flatMap((g) => g.headers)
    .find((h) => h.key === 'Content-Security-Policy').value;

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

/** Marks our responses so an existing server can be recognised as this script. */
const SIGNATURE = 'hcloud-csp-preview';

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = join(ROOT, decodeURIComponent(url.pathname));
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(ROOT, 'index.html'); // SPA fallback
    const body = readFileSync(p);
    res.setHeader('Content-Type', TYPES[extname(p)] ?? 'application/octet-stream');
    // Same policy Vercel applies to non-/api paths.
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('X-Served-By', SIGNATURE);
    res.end(body);
});

/**
 * A bare `listen` failure surfaced as an unhandled 'error' event and a raw
 * EADDRINUSE stack trace, which says nothing actionable. Usually the port is held
 * by an earlier run of THIS script, in which case there is nothing to fix — it is
 * already serving the current dist/. Detect that and say so.
 */
server.on('error', async (err) => {
    if (err.code !== 'EADDRINUSE') {
        console.error(`[serve:csp] ${err.code ?? 'error'}: ${err.message}`);
        process.exit(1);
    }

    const existing = await probe(PORT);
    if (existing === SIGNATURE) {
        console.log(
            `[serve:csp] already running on http://localhost:${PORT} (this same script) — reusing it.\n` +
            `            It serves dist/ from disk on every request, so a rebuild is picked up automatically.`
        );
        process.exit(0);
    }

    console.error(
        `[serve:csp] port ${PORT} is in use by something else.\n` +
        `            Use another port:  PORT=4179 npm run serve:csp\n` +
        `            Or free this one:  netstat -ano | findstr :${PORT}    then  taskkill /PID <pid> /F`
    );
    process.exit(1);
});

/** Returns the X-Served-By value of whatever holds the port, or null. */
function probe(port) {
    return new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500 }, (res) => {
            res.resume();
            resolve(res.headers['x-served-by'] ?? null);
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => {
            req.destroy();
            resolve(null);
        });
    });
}

server.listen(PORT, () => {
    console.log(`[serve:csp] serving dist/ with the production CSP on http://localhost:${PORT}`);
    console.log(`[serve:csp] gate page: http://localhost:${PORT}/lab/account`);
});
