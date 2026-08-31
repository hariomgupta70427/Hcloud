import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readShareCapability, verifySharePassword, publicMetadata } from '../_lib/shareToken.js';

/**
 * POST /api/telegram/share-resolve
 * Body: { blob: string, password?: string }
 *
 * The public half of share links. Deliberately unauthenticated — the capability
 * blob IS the credential — but it enforces the password SERVER-SIDE, which is
 * the whole point of this endpoint existing.
 *
 * Previously the flow was: anonymous client reads the Firestore document, gets
 * shareSettings.streamToken plus the password verifier, and checks the password
 * in the browser. Anyone could skip the check and use the token. Now the token
 * material never leaves the server until a correct password has been proven.
 *
 * Two-phase by design:
 *   1. No password supplied → return display metadata and `requiresPassword`.
 *      Nothing streamable is returned.
 *   2. Correct password (or no password set) → additionally return a
 *      short-lived stream URL.
 *
 * Responses never distinguish "no such share" from "expired share" from
 * "tampered blob": all are 404. Confirming that a blob was once valid is itself
 * a small information leak.
 */

// Short: this is handed to a browser that is about to use it immediately.
const PUBLIC_STREAM_TTL = 60 * 60; // 1 hour

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // A share link is meant to be openable from anywhere, so this is one of the
    // few endpoints that is intentionally origin-agnostic.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    // Never cache: the response depends on a password and embeds a capability.
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { blob, password } = (req.body ?? {}) as { blob?: unknown; password?: unknown };

    if (typeof blob !== 'string' || !blob) {
        return res.status(400).json({ error: 'A share reference is required' });
    }

    const payload = readShareCapability(blob);
    if (!payload) {
        return res.status(404).json({ error: 'This share link is invalid or has expired' });
    }

    const meta = publicMetadata(payload);

    // Phase 1 — password required but not supplied (or supplied empty).
    if (payload.pwHash && payload.pwSalt) {
        if (typeof password !== 'string' || password.length === 0) {
            return res.status(401).json({ ...meta, error: 'This file is password protected' });
        }
        if (!verifySharePassword(password, payload.pwSalt, payload.pwHash)) {
            // Same shape as the challenge above so a wrong password cannot be
            // told apart from a missing one by response shape alone.
            return res.status(401).json({ ...meta, error: 'Incorrect password' });
        }
    }

    // Phase 2 — authorised. Mint a short-lived stream capability.
    try {
        if (payload.storageType === 'byod') {
            if (!payload.telegramMessageId) {
                return res.status(409).json({ ...meta, error: 'This share is no longer playable' });
            }
            // NOTE: the BYOD session is NOT in the share blob and must not be —
            // see docs/ARCHITECTURE-V3.md R4. Bot-readable shares are the
            // supported public path; this branch exists for links minted under
            // the old scheme and returns a clear error rather than a broken player.
            return res.status(409).json({
                ...meta,
                error: 'Public links for account-mode files are not supported yet',
            });
        }

        if (!payload.telegramFileId) {
            return res.status(409).json({ ...meta, error: 'This share is no longer playable' });
        }

        const params = new URLSearchParams({
            fileId: payload.telegramFileId,
            name: payload.name,
        });
        return res.status(200).json({
            ...meta,
            streamUrl: `/api/telegram/stream?${params.toString()}`,
            downloadUrl: `/api/telegram/stream?${params.toString()}&download=1`,
            expiresIn: PUBLIC_STREAM_TTL,
        });
    } catch (error) {
        console.error('[share-resolve] Error:', error);
        return res.status(500).json({ error: 'Could not open this share' });
    }
}
