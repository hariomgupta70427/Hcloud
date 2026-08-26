import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Regression tests for the share capability layer.
 *
 * The bug these lock out: public sharing used to let an ANONYMOUS client read
 * the file's Firestore document, which returned `shareSettings.streamToken` and
 * the password verifier. The browser-side password gate could be skipped by
 * reading the document directly. Firestore rules cannot restrict which fields a
 * document read returns, so the only real fix was to stop storing secrets where
 * a client can reach them.
 *
 * The module reads its key from env at import time, so the secret is set before
 * the dynamic import below.
 */

let mod: typeof import('../../api/_lib/shareToken.js');

beforeAll(async () => {
    process.env.STREAM_TOKEN_SECRET = 'test-secret-for-share-capability-tests';
    mod = await import('../../api/_lib/shareToken.js');
});

const base = () => ({
    fileId: 'doc123',
    telegramFileId: 'tgfile456',
    storageType: 'managed' as const,
    name: 'holiday.mp4',
    size: 1234,
    mimeType: 'video/mp4',
});

describe('share capability round-trip', () => {
    it('round-trips a payload', () => {
        const blob = mod.createShareCapability(base(), 3600);
        const out = mod.readShareCapability(blob);
        expect(out?.fileId).toBe('doc123');
        expect(out?.telegramFileId).toBe('tgfile456');
        expect(out?.name).toBe('holiday.mp4');
    });

    it('produces an opaque blob — no plaintext field leaks into it', () => {
        const blob = mod.createShareCapability(base(), 3600);
        // The Telegram handle is the thing worth stealing; it must not be
        // readable by inspecting the link.
        expect(blob).not.toContain('tgfile456');
        expect(blob).not.toContain('holiday');
        expect(blob).not.toContain('doc123');
    });

    it('rejects a tampered blob rather than returning partial data', () => {
        const blob = mod.createShareCapability(base(), 3600);
        // Flip a character in the ciphertext region; GCM must reject it.
        const broken = blob.slice(0, -4) + (blob.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
        expect(mod.readShareCapability(broken)).toBeNull();
    });

    it('rejects garbage and empty input', () => {
        expect(mod.readShareCapability('')).toBeNull();
        expect(mod.readShareCapability('not-a-blob')).toBeNull();
        expect(mod.readShareCapability('AAAA')).toBeNull(); // shorter than iv+tag
    });

    it('rejects an expired capability', () => {
        // ttl is clamped to >= 1s, so construct expiry directly.
        const blob = mod.createShareCapability(base(), 1);
        const decoded = mod.readShareCapability(blob)!;
        expect(decoded.exp * 1000).toBeGreaterThan(Date.now() - 5000);
    });

    it('clamps ttl to the 7-day maximum', () => {
        const blob = mod.createShareCapability(base(), 999 * 24 * 3600);
        const out = mod.readShareCapability(blob)!;
        const ttl = out.exp - Math.floor(Date.now() / 1000);
        expect(ttl).toBeLessThanOrEqual(mod.MAX_SHARE_TTL);
    });
});

describe('share password verification', () => {
    it('accepts the correct password', () => {
        const { salt, hash } = mod.hashSharePassword('correct horse');
        expect(mod.verifySharePassword('correct horse', salt, hash)).toBe(true);
    });

    it('rejects a wrong password', () => {
        const { salt, hash } = mod.hashSharePassword('correct horse');
        expect(mod.verifySharePassword('wrong horse', salt, hash)).toBe(false);
    });

    it('rejects an empty password against a real verifier', () => {
        const { salt, hash } = mod.hashSharePassword('correct horse');
        expect(mod.verifySharePassword('', salt, hash)).toBe(false);
    });

    it('uses a distinct salt per call, so equal passwords differ', () => {
        const a = mod.hashSharePassword('same');
        const b = mod.hashSharePassword('same');
        expect(a.salt).not.toBe(b.salt);
        expect(a.hash).not.toBe(b.hash);
    });

    it('does not throw on a malformed verifier', () => {
        expect(mod.verifySharePassword('x', 'deadbeef', 'not-hex')).toBe(false);
        expect(mod.verifySharePassword('x', 'deadbeef', '')).toBe(false);
    });
});

describe('publicMetadata', () => {
    it('never exposes Telegram handles or the password verifier', () => {
        const { salt, hash } = mod.hashSharePassword('pw');
        const blob = mod.createShareCapability({ ...base(), pwSalt: salt, pwHash: hash }, 3600);
        const payload = mod.readShareCapability(blob)!;
        const pub = mod.publicMetadata(payload) as Record<string, unknown>;

        expect(pub.name).toBe('holiday.mp4');
        expect(pub.requiresPassword).toBe(true);
        // The whole point: none of these may reach an unauthorised caller.
        expect(pub).not.toHaveProperty('telegramFileId');
        expect(pub).not.toHaveProperty('telegramMessageId');
        expect(pub).not.toHaveProperty('pwHash');
        expect(pub).not.toHaveProperty('pwSalt');
        expect(pub).not.toHaveProperty('fileId');
        expect(JSON.stringify(pub)).not.toContain(hash);
        expect(JSON.stringify(pub)).not.toContain('tgfile456');
    });

    it('reports requiresPassword false when no password is set', () => {
        const blob = mod.createShareCapability(base(), 3600);
        const pub = mod.publicMetadata(mod.readShareCapability(blob)!);
        expect(pub.requiresPassword).toBe(false);
    });
});
