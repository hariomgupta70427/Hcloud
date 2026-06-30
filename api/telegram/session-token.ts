import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

/**
 * Exchange a Telegram session string for a short-lived stream token.
 * This avoids putting the full session string in URL query parameters,
 * which would leak into server logs, browser history, and Referer headers.
 *
 * POST /api/telegram/session-token
 * Body: { session: string, messageId: number }
 * Returns: { token: string } (valid for 10 minutes)
 */

// In-memory token store (per Vercel instance).
// Each token maps to { session, messageId, expiresAt }.
const tokenStore = new Map<string, { session: string; messageId: number; expiresAt: number }>();

// Clean expired tokens every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of tokenStore.entries()) {
        if (val.expiresAt < now) tokenStore.delete(key);
    }
}, 5 * 60 * 1000);

export function getSessionFromToken(token: string): { session: string; messageId: number } | null {
    const entry = tokenStore.get(token);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
        tokenStore.delete(token);
        return null;
    }
    return { session: entry.session, messageId: entry.messageId };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { session, messageId } = req.body;

        if (!session || !messageId) {
            return res.status(400).json({ error: 'session and messageId are required' });
        }

        // Generate a random token
        const token = crypto.randomBytes(32).toString('hex');

        // Store with 10-minute TTL
        tokenStore.set(token, {
            session,
            messageId: parseInt(messageId),
            expiresAt: Date.now() + 10 * 60 * 1000,
        });

        return res.status(200).json({ token });
    } catch (error: any) {
        console.error('[session-token] Error:', error);
        return res.status(500).json({ error: 'Failed to create token' });
    }
}
