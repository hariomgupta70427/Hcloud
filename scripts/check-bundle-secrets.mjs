#!/usr/bin/env node
/**
 * Fails the build if something that must stay server-side is reachable from the
 * client bundle.
 *
 * WHY THIS EXISTS
 * ---------------
 * The operator's Telegram bot token was hardcoded as a fallback in
 * src/services/telegramService.ts and committed in b8c9ad4 (2026-02-01):
 *
 *     const TELEGRAM_BOT_TOKEN = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '<token>';
 *
 * It stayed public for ~6.5 months. It WAS harvested: whoever found it used
 * setMyDescription to turn the bot's public profile into VPN referral spam.
 * Rotation fixed access; it did not undo the profile edit. Code review did not
 * catch the leak — a build-time check does.
 *
 * HOW IT DECIDES
 * --------------
 * An explicit ALLOW-LIST, not a pattern guess. Two mechanisms put values in the
 * bundle and both are covered:
 *   1. `VITE_`-prefixed vars, which Vite inlines automatically.
 *   2. `vite.config.ts` `define`, which inlines ANY name — this is how the
 *      unprefixed FIREBASE_* values reach dist/, and it is the same mechanism
 *      that previously carried the bot token. A missing VITE_ prefix is
 *      therefore NOT evidence that something is server-only.
 *
 * Run after `vite build`. Exits non-zero on any finding.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = process.argv[2] ?? 'dist';

/**
 * MAY appear in the client bundle. Everything here is a public identifier, not a
 * credential.
 */
const CLIENT_ALLOWED = new Set([
    // Firebase web config. Public by design — security comes from Firestore
    // rules, never from hiding these. https://firebase.google.com/docs/projects/api-keys
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
    // Relay origin. A hostname the browser must connect to; not a secret.
    'VITE_UPLOAD_SERVER_URL',
    'VITE_API_BASE_URL',
]);

/**
 * MUST NEVER appear in the client bundle. A hit here is a live incident.
 */
const CLIENT_FORBIDDEN = [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
    'STREAM_TOKEN_SECRET',
    'ADMIN_SECRET',
];

/**
 * EXPECTED to become client-visible in Stage 2, and that is not a leak.
 *
 * Browser MTProto (account mode) cannot work without api_id/api_hash, and every
 * third-party Telegram client ships its own — Telegram Web included. They are
 * app identifiers, not user credentials: they grant no access to any account.
 * The mitigation is 2-3 registered api_ids selected by remote config (R5), not
 * secrecy.
 *
 * Listed explicitly so nobody "fixes" this later by ripping them out and
 * breaking account mode.
 */
const CLIENT_EXPECTED_STAGE2 = ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH'];

/**
 * Node shims that must NOT be bundled for the browser.
 *
 * These are fingerprints of the shim IMPLEMENTATION, not of feature detection.
 * `typeof Buffer < "u"` guards are expected and fine — libraries use them to pick
 * a browser path, and with no Buffer present they pick correctly.
 *
 * Why this is enforced: injecting a fake `Buffer` global broke QR login.
 * @fuman/utils (used by mtcute) does
 *     if (typeof Buffer !== 'undefined') return Buffer.from(b).toString('base64url')
 * and the browser `buffer` package does not implement base64url, so it threw
 * `TypeError: Unknown encoding: base64url`. Removing the shim FIXED the feature.
 * An incomplete polyfill is worse than none, because feature detection then lies.
 */
const NODE_SHIM_PATTERNS = [
    { name: 'buffer package shim', re: /Unknown encoding: |INSPECT_MAX_BYTES|_isBuffer/g },
    { name: 'Buffer global assignment', re: /(?:window|globalThis|self)\.Buffer\s*=/g },
];

/** Shape patterns, to catch a hardcoded literal with no backing env var. */
const PATTERNS = [
    { name: 'Telegram bot token', re: /\b\d{8,12}:[A-Za-z0-9_-]{30,45}\b/g },
    { name: 'PEM private key', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
    { name: 'GCP service account key', re: /"private_key_id"\s*:|"type"\s*:\s*"service_account"/g },
    { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g },
    { name: 'Slack token', re: /\bxox[abprs]-[0-9A-Za-z-]{10,}/g },
];

/**
 * A VITE_-prefixed name that reads like a secret is a defect on its own, even if
 * the bundle does not reference it yet — the next line of code will.
 */
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
const notes = [];

// 1. A VITE_-prefixed secret-looking name in the environment.
for (const key of Object.keys(process.env)) {
    if (SECRET_NAME_RE.test(key) && !CLIENT_ALLOWED.has(key)) {
        findings.push({
            what: `env var ${key} is VITE_-prefixed and reads like a secret`,
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

    // 2. Forbidden values, matched exactly against the build environment.
    for (const name of CLIENT_FORBIDDEN) {
        const value = process.env[name];
        // Short values collide with unrelated numbers; require some length.
        if (!value || value.length < 8) continue;
        if (content.includes(value)) {
            findings.push({
                what: `value of ${name} is in the client bundle`,
                where: rel,
                fix: 'stop referencing it from src/ and remove it from the vite define block — it must be server-only',
            });
        }
    }

    // 3. Stage 2 identifiers: report, do not fail.
    for (const name of CLIENT_EXPECTED_STAGE2) {
        const value = process.env[name];
        if (!value || value.length < 8) continue;
        if (content.includes(value)) {
            notes.push(`${name} is in ${rel} — expected for account mode, not a leak`);
        }
    }

    // 4. Node shims. A re-added Buffer polyfill must fail the build.
    for (const { name, re } of NODE_SHIM_PATTERNS) {
        const matches = content.match(re);
        if (matches) {
            findings.push({
                what: `${name} is bundled for the browser (matched "${String(matches[0]).slice(0, 24)}")`,
                where: rel,
                fix: 'remove the Node polyfill — see the note in vite.config.ts; an incomplete Buffer breaks feature detection',
            });
        }
    }

    // 5. Shape match, for literals with no env var behind them.
    for (const { name, re } of PATTERNS) {
        const matches = content.match(re);
        if (matches) {
            findings.push({
                what: `${name} pattern found (starts "${String(matches[0]).slice(0, 12)}…")`,
                where: rel,
                fix: 'delete the literal and read it from server-only config',
            });
        }
    }
}

for (const note of notes) console.log(`[check-bundle-secrets] note: ${note}`);

if (findings.length > 0) {
    console.error('\n[check-bundle-secrets] BUILD FAILED — server-only values reachable from the client:\n');
    for (const f of findings) {
        console.error(`  ✗ ${f.what}`);
        console.error(`      in:  ${f.where}`);
        console.error(`      fix: ${f.fix}\n`);
    }
    console.error(`${findings.length} finding(s). Both VITE_ vars and vite.config.ts \`define\` inline into the bundle.\n`);
    process.exit(1);
}

console.log(
    `[check-bundle-secrets] OK — scanned ${files.length} files in ${DIST}/. ` +
    `Allow-list: ${CLIENT_ALLOWED.size} public identifiers; forbidden: ${CLIENT_FORBIDDEN.join(', ')}.`
);
