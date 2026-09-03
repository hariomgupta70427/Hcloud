import { describe, it, expect } from 'vitest';
import {
    buildManifest, assertComparable, HASH_DOMAIN, MANIFEST_SCHEMA_VERSION,
} from '@/lib/fileManifest';
import { HASH_BLOCK_SIZE } from '@/lib/contentHash';

/**
 * The Merkle root is the dedupe id, so block size and hash domain are part of what
 * a digest MEANS. If either drifts, every stored digest silently stops matching and
 * the failure looks like data corruption. These lock that down.
 */
const base = {
    id: 'f1', name: 'v.mp4', mimeType: 'video/mp4', size: 123,
    contentRoot: 'a'.repeat(64), contentBlocks: ['a'.repeat(64)],
    parts: [{ index: 0, size: 123, chatId: '-1001', messageId: 2 }],
    uploadedAt: new Date(0).toISOString(), uploadMs: 5,
};

describe('manifest records the format decisions', () => {
    it('stamps hashBlockSize, hashDomain and schemaVersion from one source', () => {
        const m = buildManifest(base);
        expect(m.hashBlockSize).toBe(HASH_BLOCK_SIZE);
        expect(m.hashDomain).toBe('plaintext');
        expect(m.schemaVersion).toBe(MANIFEST_SCHEMA_VERSION);
        expect(m.encryption).toBeNull();
    });

    it('declares the root is over plaintext, so read-back must decrypt first', () => {
        expect(HASH_DOMAIN).toBe('plaintext');
    });
});

describe('assertComparable refuses incomparable digests', () => {
    it('accepts a current manifest', () => {
        expect(() => assertComparable(buildManifest(base))).not.toThrow();
    });

    it('rejects a different block size as a migration, not a retry', () => {
        const m = { ...buildManifest(base), hashBlockSize: 512 * 1024 };
        expect(() => assertComparable(m)).toThrow(/migration, not a retry/);
    });

    it('rejects a different hash domain rather than reporting corruption', () => {
        const m = { ...buildManifest(base), hashDomain: 'ciphertext' as never };
        expect(() => assertComparable(m)).toThrow(/report corruption/);
    });

    it('rejects an unknown schema version', () => {
        const m = { ...buildManifest(base), schemaVersion: 99 };
        expect(() => assertComparable(m)).toThrow(/schemaVersion/);
    });
});
