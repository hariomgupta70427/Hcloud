import crypto from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Firebase ID-token verification for the Vercel API functions.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every function under api/ used to be completely unauthenticated. That meant
 * anyone on the internet could:
 *   • POST to /api/telegram/managed-upload and store arbitrary files in the
 *     operator's Telegram chat using the operator's bot token, and
 *   • POST to /api/telegram/session-token to have ANY session string wrapped
 *     into a stream capability valid for up to 7 days.
 *
 * The Render server already verified Firebase tokens properly; these functions
 * never got the same treatment. This module is that treatment.
 *
 * It verifies the RS256 SIGNATURE, not just the claims. A JWT payload is plain
 * base64 — checking `aud`/`iss`/`exp` without verifying the signature is not
 * authentication at all, because anyone can hand-write a payload.
 *
 * No firebase-admin dependency: Node's crypto can verify RS256 against Google's
 * published X.509 certificates directly.
 */

const FIREBASE_PROJECT_ID =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    '';

const CERT_URL =
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export interface AuthedUser {
    uid: string;
    email?: string;
}

// Serverless instances are reused between invocations, so this cache survives
// across requests on a warm instance and avoids refetching the certs each time.
let cachedCerts: Record<string, string> = {};
let certsFetchedAt = 0;

async function getCerts(): Promise<Record<string, string>> {
    const now = Date.now();
    if (Object.keys(cachedCerts).length > 0 && now - certsFetchedAt < 3600_000) {
        return cachedCerts;
    }
    const res = await fetch(CERT_URL);
    if (!res.ok) return cachedCerts; // fall back to (possibly stale) cache
    cachedCerts = (await res.json()) as Record<string, string>;
    certsFetchedAt = now;
    return cachedCerts;
}

/**
 * Verify a Firebase ID token. Returns the user on success, null on any failure.
 */
export async function verifyIdToken(idToken: string): Promise<AuthedUser | null> {
    try {
        if (!FIREBASE_PROJECT_ID) {
            // Refusing is the safe default: without knowing which project to
            // trust, any Firebase project's users would be accepted.
            console.error('[auth] FIREBASE_PROJECT_ID is not set — rejecting request');
            return null;
        }

        const parts = idToken.split('.');
        if (parts.length !== 3) return null;
        const [rawHeader, rawPayload, rawSignature] = parts;

        const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString());
        if (header.alg !== 'RS256' || !header.kid) return null;

        const certs = await getCerts();
        const cert = certs[header.kid];
        if (!cert) return null; // unknown key id (rotation, or a forged header)

        const verifier = crypto.createVerify('RSA-SHA256');
        verifier.update(`${rawHeader}.${rawPayload}`);
        if (!verifier.verify(cert, Buffer.from(rawSignature, 'base64url'))) {
            return null;
        }

        // Signature verified — the claims can now be trusted.
        const payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString());
        const nowSec = Math.floor(Date.now() / 1000);

        if (!payload.sub || typeof payload.sub !== 'string') return null;
        if (!payload.exp || payload.exp <= nowSec) return null;
        if (payload.iat && payload.iat > nowSec + 60) return null; // clock skew allowance
        if (payload.aud !== FIREBASE_PROJECT_ID) return null;
        if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;

        return { uid: payload.sub, email: payload.email };
    } catch {
        return null;
    }
}

/**
 * Require a signed-in caller. On failure this writes the 401 response and
 * returns null, so handlers can simply do:
 *
 *   const user = await requireAuth(req, res);
 *   if (!user) return;
 */
export async function requireAuth(
    req: VercelRequest,
    res: VercelResponse
): Promise<AuthedUser | null> {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Authentication required' });
        return null;
    }

    const user = await verifyIdToken(header.slice(7));
    if (!user) {
        res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
        return null;
    }
    return user;
}
