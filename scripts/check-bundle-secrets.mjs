#!/usr/bin/env node
/**
 * Fails the build if a secret is reachable from the client bundle.
 *
 * WHY THIS EXISTS
 * ---------------
 * The operator's Telegram bot token was hardcoded as a fallback in
 * src/services/telegramService.ts and committed in b8c9ad4 (2026-02-01):
 *
 *     const TELEGRAM_BOT_TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '<token>';
 *
 * Both the `VITE_` var and the hardcoded fallback put the token into the
 * deployed JavaScript, where any visitor could read it. README.md still
 * instructs the reader to set `VITE_TELEGRAM_BOT_TOKEN`, so the mistake is one
 * copy-paste away from returning. Code review did not catch it for six months;
 * a build-time check does.
 *
 * Anything prefixed `VITE_` is inlined into the bundle by Vite. Therefore:
 * NO SECRET MAY EVER HAVE A VITE_ PREFIX.
 *
 * Run after `vite build`. Exits non-zero on any finding.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.argv[2] ?? 'dist';

/**
 * Env vars whose VALUE must never appear in the bundle. Checked only when the
 * variable is present in the build environment (it is on Vercel), which makes
 * this an exact-value check rather than a guess.
 */
const SECRET_ENV_VARS = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'TELEGRAM_API_ID',
    'TELEGRAM_API_HASH',
    'STREAM_TOKEN_SECRET',
    'ADMIN_SECRET',
];

/**
 * Firebase web config is intentionally public — it is a set of identifiers, not
 * credentials. Security comes from Firestore rules and App Check, never from
 * hiding these. They are expected in the bundle and must not fail the build.
 * See https://firebase.google.com/docs/projects/api-keys
 */
const ALLOWED_IN_BUNDLE = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
];

const PATTERNS = [
    { name: 'Telegram bot token', re: /\b\d{8,12}:[A-Za-z0-9_-]{30,45}\b/g },
    { name: 'PEM private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
    { name: 'GCP service account key', re: /"private_key_id"\s*:|"type"\s*:\s*"service_account"/g },
    { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'Slack token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/g },
    { name: 'Generic private key assignment', re: /private_key\s*[:=]\s*["'`]-----BEGIN/g },
];

/** A VITE_ var whose name smells like a secret is a defect on its own. */
const SECRET_NAME_RE = /^VITE_.*(TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_HASH|APIHASH)/i;

const TEXT_EXT = /\.(js|mjs|cjs|css|html|json|map|txt|webmanifest)$/i;

function walk(dir) {
    const out = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) out.push(...walk(full));
        else if (TEXT_EXT.test(entry)) out.push(full);
    }
    return out;
}

const findings = [];

// 1. A VITE_-prefixed secret in the build environment is a defect even if the
//    bundle happens not to reference it yet — the next line of code will.
for (const [key] of Object.entries(process.env)) {
    if (SECRET_NAME_RE.test(key)) {
        findings.push({
            what: `env var ${key} is VITE_-prefixed and looks like a secret`,
            where: 'build environment',
            fix: `rename to ${key.replace(/^VITE_/, '')} so it stays server-only`,
        });
    }
}

if (!existsSync(DIST)) {
    console.error(`[check-bundle-secrets] ${DIST}/ not found — run the build first.`);
    process.exit(1);
}

const files = walk(DIST);

for (const file of files) {
    const rel = relative(process.cwd(), file);
    const content = readFileSync(file, 'utf8');

    // 2. Exact-value match against real secrets from the environment.
    for (const name of SECRET_ENV_VARS) {
        const value = process.env[name];
        // Short values produce false positives (e.g. a numeric api_id colliding
        // with an unrelated number), so require some length to be meaningful.
        if (!value || value.length < 8) continue;
        if (ALLOWED_IN_BUNDLE.includes(name)) continue;
        if (content.includes(value)) {
            findings.push({
                what: `value of ${name} found in the bundle`,
                where: rel,
                fix: `remove the VITE_ prefix / stop referencing it from src/ — it must be server-only`,
            });
        }
    }

    // 3. Shape-based match, which catches hardcoded literals with no env var.
    for (const { name, re } of PATTERNS) {
        const matches = content.match(re);
        if (matches) {
            const sample = String(matches[0]).slice(0, 12);
            findings.push({
                what: `${name} pattern found (starts "${sample}…")`,
                where: rel,
                fix: 'delete the literal and read it from server-only config',
            });
        }
    }
}

if (findings.length > 0) {
    console.error('\n[check-bundle-secrets] BUILD FAILED — secrets reachable from the client bundle:\n');
    for (const f of findings) {
        console.error(`  ✗ ${f.what}`);
        console.error(`      in:  ${f.where}`);
        console.error(`      fix: ${f.fix}\n`);
    }
    console.error(`${findings.length} finding(s). Nothing prefixed VITE_ is private — it ships to every visitor.\n`);
    process.exit(1);
}

console.log(`[check-bundle-secrets] OK — scanned ${files.length} files in ${DIST}/, no secrets found.`);
