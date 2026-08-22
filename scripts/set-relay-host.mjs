#!/usr/bin/env node
/**
 * Point the frontend at a relay host.
 *
 *   node scripts/set-relay-host.mjs https://relay.yourdomain.com
 *
 * WHY THIS SCRIPT EXISTS
 * The relay origin has to appear in three places, and one of them cannot read
 * environment variables:
 *
 *   1. vercel.json  — the Content-Security-Policy is a static string, so
 *                     `connect-src` and `media-src` must contain the literal
 *                     origin. Miss this and media silently fails to load with
 *                     only a CSP console error.
 *   2. .env / .env.production — VITE_UPLOAD_SERVER_URL, baked into the bundle.
 *   3. Vercel env   — UPLOAD_SERVER_URL, used server-side by the stream proxy.
 *
 * Editing the CSP by hand is exactly the kind of step that gets forgotten, so
 * this does all of it and prints the one command left for you to run.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const raw = process.argv[2];
if (!raw) {
    console.error('Usage: node scripts/set-relay-host.mjs https://relay.yourdomain.com');
    process.exit(1);
}

let origin;
try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') {
        console.error(`Refusing "${raw}": the relay must be https.`);
        console.error('Browsers block mixed content, so an http relay cannot serve media to your site.');
        process.exit(1);
    }
    // Origin only — no path, no trailing slash.
    origin = url.origin;
} catch {
    console.error(`"${raw}" is not a valid URL.`);
    process.exit(1);
}

console.log(`Relay origin: ${origin}\n`);
let changed = 0;

// ---------------------------------------------------------------------------
// 1. vercel.json — rewrite the relay origin inside the CSP
// ---------------------------------------------------------------------------
const vercelPath = join(ROOT, 'vercel.json');
const vercel = JSON.parse(readFileSync(vercelPath, 'utf8'));

const cspHeader = vercel.headers
    ?.flatMap((group) => group.headers ?? [])
    .find((h) => h.key === 'Content-Security-Policy');

if (!cspHeader) {
    console.error('Could not find a Content-Security-Policy header in vercel.json.');
    process.exit(1);
}

/**
 * Hosts that belong to Firebase/Google and must never be treated as the relay.
 * Anything else in connect-src/media-src is a relay origin from a previous run
 * and gets replaced, so switching hosts never leaves a stale entry behind.
 */
const INFRA_SUFFIXES = [
    'google.com', 'googleapis.com', 'gstatic.com',
    'firebaseapp.com', 'firebaseio.com',
];

function isInfraToken(token) {
    if (!/^(https|wss):\/\//.test(token)) return true;  // 'self', blob:, data: …
    if (token.includes('*')) return true;                // wildcard infra entries
    let host;
    try {
        host = new URL(token.replace(/^wss:/, 'https:')).hostname;
    } catch {
        return true; // not parseable — leave it alone
    }
    return INFRA_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/** Rewrite one directive: drop old relay origins, ensure the new one is present. */
function setRelayIn(csp, directive) {
    const parts = csp.split(';').map((p) => p.trim()).filter(Boolean);
    const index = parts.findIndex((p) => p === directive || p.startsWith(`${directive} `));
    if (index === -1) {
        console.error(`CSP has no "${directive}" directive — refusing to guess.`);
        process.exit(1);
    }

    const tokens = parts[index].split(/\s+/);
    const name = tokens.shift();
    const kept = tokens.filter(isInfraToken);
    kept.push(origin);

    parts[index] = [name, ...new Set(kept)].join(' ');
    return parts.join('; ');
}

const before = cspHeader.value;
let next = before;
for (const directive of ['connect-src', 'media-src']) {
    next = setRelayIn(next, directive);
}
cspHeader.value = next;

if (next !== before) {
    writeFileSync(vercelPath, JSON.stringify(vercel, null, 4) + '\n');
    console.log('updated  vercel.json  (CSP connect-src + media-src)');
    changed++;
} else {
    console.log('ok       vercel.json  (CSP already correct)');
}

// Re-validate the schema: a stray property here fails the Vercel build.
for (const [i, group] of (vercel.headers ?? []).entries()) {
    for (const key of Object.keys(group)) {
        if (!['source', 'headers', 'has', 'missing'].includes(key)) {
            console.error(`vercel.json: invalid property headers[${i}].${key}`);
            process.exit(1);
        }
    }
    for (const [j, h] of (group.headers ?? []).entries()) {
        for (const key of Object.keys(h)) {
            if (!['key', 'value'].includes(key)) {
                console.error(`vercel.json: invalid property headers[${i}].headers[${j}].${key}`);
                process.exit(1);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Local env files — VITE_UPLOAD_SERVER_URL
// ---------------------------------------------------------------------------
function upsertEnv(file, key, value) {
    const path = join(ROOT, file);
    if (!existsSync(path)) return false;

    const text = readFileSync(path, 'utf8');
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');

    let next;
    if (re.test(text)) {
        if (re.exec(text)[0] === line) {
            console.log(`ok       ${file}  (${key} already correct)`);
            return false;
        }
        next = text.replace(re, line);
    } else {
        next = text.replace(/\n*$/, '\n') + `\n# Relay origin (set by scripts/set-relay-host.mjs)\n${line}\n`;
    }
    writeFileSync(path, next);
    console.log(`updated  ${file}  (${key})`);
    return true;
}

for (const file of ['.env', '.env.production', '.env.example']) {
    if (upsertEnv(file, 'VITE_UPLOAD_SERVER_URL', origin)) changed++;
}

// ---------------------------------------------------------------------------
// 3. What you still have to do
// ---------------------------------------------------------------------------
console.log(`
${changed} file(s) changed.

Remaining steps — these touch Vercel, so they cannot be scripted from here:

  1. Set the server-side relay URL on Vercel (all three environments):

       vercel env rm UPLOAD_SERVER_URL production --yes 2>/dev/null
       printf '${origin}' | vercel env add UPLOAD_SERVER_URL production
       printf '${origin}' | vercel env add UPLOAD_SERVER_URL preview
       printf '${origin}' | vercel env add UPLOAD_SERVER_URL development

  2. Set the client-side value the bundle is built with:

       printf '${origin}' | vercel env add VITE_UPLOAD_SERVER_URL production
       printf '${origin}' | vercel env add VITE_UPLOAD_SERVER_URL preview
       printf '${origin}' | vercel env add VITE_UPLOAD_SERVER_URL development

  3. Commit vercel.json and redeploy.

  4. Confirm the relay is reachable and its CORS allows your site:

       curl -sS ${origin}/health
`);
