import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

/**
 * Stateless, self-contained stream tokens.
 *
 * A token is an AES-256-GCM encrypted, base64url-encoded blob of
 * `{ session, messageId, exp }`. Because everything the stream endpoint needs
 * lives *inside* the token, ANY serverless instance can validate it — the old
 * in-memory Map only worked when the mint and the stream request happened to
 * land on the same Vercel instance, which is why BYOD streaming failed
 * intermittently.
 *
 * Encryption (not just signing) is essential: the token travels in URLs and,
 * for shared files, is stored in Firestore — so the raw Telegram session must
 * never be readable from it.
 *
 * POST /api/telegram/session-token
 * Body: { session: string, messageId: number, ttlSeconds?: number }
 * Returns: { token: string }
 */

// Key material: prefer an explicit secret, else derive from the server-only
// TELEGRAM_API_HASH (always present wherever streaming runs). Never a client value.
const SECRET = process.env.STREAM_TOKEN_SECRET || process.env.TELEGRAM_API_HASH || '';
const KEY = crypto.createHash('sha256').update(SECRET).digest(); // 32 bytes for AES-256

const DEFAULT_TTL = 10 * 60;          // 10 minutes (dashboard playback)
const MAX_TTL = 7 * 24 * 60 * 60;      // 7 days (shared links)

interface TokenPayload { session: string; messageId: number; exp: number }

/** Encrypt a payload into an opaque, URL-safe token. */
export function createStreamToken(session: string, messageId: number, ttlSeconds = DEFAULT_TTL): string {
    if (!SECRET) throw new Error('Stream token secret not configured');
    const ttl = Math.min(Math.max(1, ttlSeconds), MAX_TTL);
    const payload: TokenPayload = {
        session,
        messageId,
        // NOTE: Date.now() is fine here — this file only runs server-side on Vercel.
        exp: Math.floor(Date.now() / 1000) + ttl,
    };

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
    const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    // iv(12) | tag(16) | ciphertext  -> base64url
    return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

/** Decrypt and validate a token. Returns null if invalid, tampered, or expired. */
export function getSessionFromToken(token: string): { session: string; messageId: number } | null {
    if (!SECRET || !token) return null;
    try {
        const raw = Buffer.from(token, 'base64url');
        if (raw.length < 28) return null; // 12 iv + 16 tag minimum
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const ciphertext = raw.subarray(28);

        const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]).toString('utf8');

        const payload = JSON.parse(decrypted) as TokenPayload;
        if (!payload.session || !payload.messageId) return null;
        if (payload.exp && payload.exp * 1000 < Date.now()) return null;

        return { session: payload.session, messageId: payload.messageId };
    } catch {
        // Bad key, tampered ciphertext, or malformed token all land here.
        return null;
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (!SECRET) {
        return res.status(500).json({ error: 'Stream token secret not configured on server' });
    }

    try {
        const { session, messageId, ttlSeconds } = req.body;

        if (!session || !messageId) {
            return res.status(400).json({ error: 'session and messageId are required' });
        }

        const token = createStreamToken(session, parseInt(messageId), ttlSeconds);
        return res.status(200).json({ token });
    } catch (error: any) {
        console.error('[session-token] Error:', error);
        return res.status(500).json({ error: error.message || 'Failed to create token' });
    }
}
