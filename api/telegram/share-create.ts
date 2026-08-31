import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuth } from '../_lib/firebaseAuth.js';
import { isAllowedOrigin } from '../_lib/cors.js';
import {
    createShareCapability,
    hashSharePassword,
    MAX_SHARE_TTL,
} from '../_lib/shareToken.js';

/**
 * POST /api/telegram/share-create
 * Body: {
 *   fileId, name, size, mimeType, storageType,
 *   telegramFileId?, telegramMessageId?,
 *   password?, ttlSeconds?
 * }
 * Returns: { blob, expiresAt, requiresPassword }
 *
 * Mints the opaque share capability. Authenticated: only a signed-in user may
 * create one, and only the key held on the server can produce a blob the public
 * resolver will accept.
 *
 * The caller supplies the file's fields rather than the server reading Firestore,
 * because these functions have no privileged database access — they verify
 * Firebase ID tokens by hand and hold no service account. That is acceptable
 * here: the fields are the sharer's own file metadata, and forging them grants
 * nothing that sharing the file itself would not. The Telegram handle is the only
 * sensitive input, and a caller can only pass one they already hold.
 *
 * Password hashing happens HERE, server-side. It used to happen in the browser,
 * with the verifier and salt then written into a Firestore document that
 * anonymous readers could fetch — so the verifier was both grindable offline and
 * unnecessary to bypass.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    const origin = req.headers.origin as string | undefined;
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await requireAuth(req, res);
    if (!user) return;

    try {
        const {
            fileId,
            name,
            size,
            mimeType,
            storageType,
            telegramFileId,
            telegramMessageId,
            password,
            ttlSeconds,
        } = (req.body ?? {}) as Record<string, unknown>;

        if (typeof fileId !== 'string' || !fileId) {
            return res.status(400).json({ error: 'fileId is required' });
        }
        if (typeof name !== 'string' || !name) {
            return res.status(400).json({ error: 'name is required' });
        }
        if (storageType !== 'managed' && storageType !== 'byod') {
            return res.status(400).json({ error: 'storageType must be "managed" or "byod"' });
        }

        // R4: an account-mode (BYOD) file cannot be served to a visitor who has
        // no Telegram session, and the operator's bot cannot read 1 GiB parts
        // (getFile caps at 20 MiB). Refuse at mint time with actionable copy
        // rather than handing back a link that resolves to an error later.
        if (storageType === 'byod') {
            return res.status(409).json({
                error: 'Public web links are not available for this file',
                reason: 'account-mode',
                hint: 'Share it through Telegram instead.',
            });
        }

        if (typeof telegramFileId !== 'string' || !telegramFileId) {
            return res.status(400).json({ error: 'telegramFileId is required for managed files' });
        }

        let pwSalt: string | undefined;
        let pwHash: string | undefined;
        if (typeof password === 'string' && password.length > 0) {
            const derived = hashSharePassword(password);
            pwSalt = derived.salt;
            pwHash = derived.hash;
        }

        const requestedTtl =
            typeof ttlSeconds === 'number' && Number.isFinite(ttlSeconds)
                ? Math.floor(ttlSeconds)
                : MAX_SHARE_TTL;

        const blob = createShareCapability(
            {
                fileId,
                telegramFileId,
                telegramMessageId:
                    typeof telegramMessageId === 'number' ? telegramMessageId : undefined,
                storageType,
                name,
                size: typeof size === 'number' ? size : 0,
                mimeType: typeof mimeType === 'string' ? mimeType : 'application/octet-stream',
                pwSalt,
                pwHash,
            },
            requestedTtl
        );

        const effectiveTtl = Math.min(Math.max(1, requestedTtl), MAX_SHARE_TTL);
        return res.status(200).json({
            blob,
            requiresPassword: Boolean(pwHash),
            expiresAt: new Date(Date.now() + effectiveTtl * 1000).toISOString(),
        });
    } catch (error) {
        console.error('[share-create] Error:', error);
        return res.status(500).json({ error: 'Could not create a share link' });
    }
}
