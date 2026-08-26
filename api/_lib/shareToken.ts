import crypto from 'crypto';

/**
 * Self-contained share capabilities.
 *
 * WHY THIS EXISTS
 * ---------------
 * Public sharing used to work by letting an ANONYMOUS client read the file's
 * Firestore document (`allow get: if resource.data.isShared == true`). That
 * could not be made safe: Firestore rules authorise whole documents and cannot
 * restrict which FIELDS are returned. Every visitor holding a share link
 * therefore received:
 *   • shareSettings.streamToken        — a capability valid for up to 7 days
 *   • shareSettings.passwordVerifier   — and the salt
 * So the "password protected" gate in SharedFilePage, which only ever ran in
 * the browser, could be bypassed by reading the document directly and using the
 * token it handed over.
 *
 * The fix is to stop putting secrets in client-readable storage at all. A share
 * link now carries an opaque AES-256-GCM blob that only the server can decrypt.
 * Firestore holds no token and no verifier, and anonymous reads are denied.
 *
 * Layout, identical in shape to the stream token so there is one scheme to
 * reason about:  base64url( iv(12) | tag(16) | ciphertext )
 *
 * The blob also carries the display metadata (name, size, mimeType) so the
 * public page needs no database read whatsoever. That metadata is a snapshot
 * from share time — a later rename is not reflected, which is an acceptable
 * trade for removing the entire anonymous-read surface.
 */

// Must match api/telegram/session-token.ts exactly, or nothing round-trips.
const SECRET = process.env.STREAM_TOKEN_SECRET || process.env.TELEGRAM_API_HASH || '';
const KEY = crypto.createHash('sha256').update(SECRET).digest();

export const MAX_SHARE_TTL = 7 * 24 * 60 * 60; // 7 days

export interface SharePayload {
    /** Firestore document id — for revocation checks and logging only. */
    fileId: string;
    /** Bot-mode file handle. */
    telegramFileId?: string;
    /** Account/BYOD-mode message coordinates. */
    telegramMessageId?: number;
    storageType: 'managed' | 'byod';
    /** Display metadata, snapshotted at share time. */
    name: string;
    size: number;
    mimeType: string;
    /** scrypt verifier; absent means the share has no password. */
    pwSalt?: string;
    pwHash?: string;
    /** Unix seconds. */
    exp: number;
}

/** Derive a scrypt verifier for a share password. */
export function hashSharePassword(password: string, saltHex?: string): { salt: string; hash: string } {
    const salt = saltHex ?? crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 32).toString('hex');
    return { salt, hash };
}

/**
 * Constant-time password check. A plain `===` on hex digests leaks timing
 * information about how many leading bytes matched, which is exactly the signal
 * an attacker needs to grind a verifier byte by byte.
 */
export function verifySharePassword(password: string, salt: string, expectedHash: string): boolean {
    const { hash } = hashSharePassword(password, salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

export function createShareCapability(payload: Omit<SharePayload, 'exp'>, ttlSeconds: number): string {
    if (!SECRET) throw new Error('Share capability secret not configured');
    const ttl = Math.min(Math.max(1, ttlSeconds), MAX_SHARE_TTL);
    const full: SharePayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttl };

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(full), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

/** Decrypt and validate. Returns null on a bad key, tampering, or expiry. */
export function readShareCapability(blob: string): SharePayload | null {
    if (!SECRET || !blob) return null;
    try {
        const raw = Buffer.from(blob, 'base64url');
        if (raw.length < 28) return null; // 12 iv + 16 tag minimum

        const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        const decrypted = Buffer.concat([
            decipher.update(raw.subarray(28)),
            decipher.final(),
        ]).toString('utf8');

        const payload = JSON.parse(decrypted) as SharePayload;
        if (!payload.fileId || !payload.storageType) return null;
        if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
        return payload;
    } catch {
        // Wrong key, tampered ciphertext, or malformed input all land here.
        return null;
    }
}

/**
 * What a public visitor is allowed to know BEFORE proving the password.
 * Deliberately excludes every Telegram handle and the verifier — knowing a file
 * is called "taxes.pdf" is harmless; knowing how to fetch it is not.
 */
export function publicMetadata(p: SharePayload) {
    return {
        name: p.name,
        size: p.size,
        mimeType: p.mimeType,
        requiresPassword: Boolean(p.pwHash),
        expiresAt: p.exp,
    };
}
