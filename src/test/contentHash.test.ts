import { describe, it, expect } from 'vitest';
import {
    BlockHasher,
    hashBlob,
    compareHashes,
    merkleRoot,
    HASH_BLOCK_SIZE,
    toHex,
} from '@/lib/contentHash';

/**
 * The property that matters: a hash must depend only on the BYTES, never on how
 * they were chunked. Telegram parts are 512 KiB and hash blocks are 1 MiB, so the
 * two never line up — if BlockHasher mishandled that, an upload and its read-back
 * would disagree on identical content and look like corruption.
 */

function bytes(n: number, seed = 1): Uint8Array {
    // Deterministic, non-repeating: a constant fill would hide block-ordering bugs.
    const out = new Uint8Array(n);
    let x = seed;
    for (let i = 0; i < n; i++) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        out[i] = x & 0xff;
    }
    return out;
}

async function hashInChunks(data: Uint8Array, chunkSize: number) {
    const h = new BlockHasher();
    for (let o = 0; o < data.byteLength; o += chunkSize) {
        await h.update(data.subarray(o, Math.min(o + chunkSize, data.byteLength)));
    }
    return h.finish();
}

describe('BlockHasher is chunking-invariant', () => {
    it('gives the same root for 512 KiB, 1 MiB and odd-sized feeds', async () => {
        const data = bytes(HASH_BLOCK_SIZE * 2 + 12345);
        const a = await hashInChunks(data, 512 * 1024);
        const b = await hashInChunks(data, HASH_BLOCK_SIZE);
        const c = await hashInChunks(data, 7777);
        const d = await hashInChunks(data, data.byteLength);

        expect(a.root).toBe(b.root);
        expect(a.root).toBe(c.root);
        expect(a.root).toBe(d.root);
        expect(a.byteLength).toBe(data.byteLength);
    });

    it('produces one block digest per 1 MiB plus a short tail', async () => {
        const h = await hashInChunks(bytes(HASH_BLOCK_SIZE * 3 + 1), 100_000);
        expect(h.blocks).toHaveLength(4);
    });

    it('matches hashBlob for the same content', async () => {
        // A real File is used in the browser. jsdom's Blob is partial — its
        // slice() result has no arrayBuffer() — so a stub carrying the real bytes
        // is what actually exercises hashBlob's slicing here.
        const data = bytes(HASH_BLOCK_SIZE + 999);
        const stub = {
            size: data.byteLength,
            slice: (start: number, end: number) => ({
                arrayBuffer: async () => data.slice(start, end).buffer as ArrayBuffer,
            }),
        };
        const viaHasher = await hashInChunks(data, 64 * 1024);
        const viaBlob = await hashBlob(stub);
        expect(viaBlob.root).toBe(viaHasher.root);
        expect(viaBlob.byteLength).toBe(data.byteLength);
    });

    it('handles an exact multiple of the block size with no empty tail block', async () => {
        const h = await hashInChunks(bytes(HASH_BLOCK_SIZE * 2), 333);
        expect(h.blocks).toHaveLength(2);
    });

    it('handles empty input without throwing', async () => {
        const h = await hashInChunks(new Uint8Array(0), 1024);
        expect(h.byteLength).toBe(0);
        expect(h.root).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('hashes are content-sensitive', () => {
    it('differs when a single byte changes', async () => {
        const a = bytes(HASH_BLOCK_SIZE * 2, 1);
        const b = a.slice();
        b[HASH_BLOCK_SIZE + 5] ^= 0xff;
        expect((await hashInChunks(a, 1024)).root).not.toBe((await hashInChunks(b, 1024)).root);
    });

    it('differs when two blocks are swapped — order is part of identity', async () => {
        const one = bytes(HASH_BLOCK_SIZE, 1);
        const two = bytes(HASH_BLOCK_SIZE, 2);
        const ab = new Uint8Array(HASH_BLOCK_SIZE * 2);
        ab.set(one, 0);
        ab.set(two, HASH_BLOCK_SIZE);
        const ba = new Uint8Array(HASH_BLOCK_SIZE * 2);
        ba.set(two, 0);
        ba.set(one, HASH_BLOCK_SIZE);
        expect((await hashInChunks(ab, 4096)).root).not.toBe((await hashInChunks(ba, 4096)).root);
    });
});

describe('merkleRoot', () => {
    it('is stable for an odd number of leaves', async () => {
        const leaves = [bytes(32, 1), bytes(32, 2), bytes(32, 3)];
        expect(await merkleRoot(leaves)).toBe(await merkleRoot(leaves));
    });

    it('returns hex of the expected width', async () => {
        expect(await merkleRoot([bytes(32, 9)])).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('compareHashes localises the first difference', () => {
    it('reports a match for identical content', async () => {
        const data = bytes(HASH_BLOCK_SIZE + 10);
        const r = compareHashes(await hashInChunks(data, 4096), await hashInChunks(data, 65536));
        expect(r.match).toBe(true);
    });

    it('reports the byte offset of the first differing block', async () => {
        const a = bytes(HASH_BLOCK_SIZE * 4, 1);
        const b = a.slice();
        b[HASH_BLOCK_SIZE * 2 + 17] ^= 0xff; // corrupt block index 2
        const r = compareHashes(await hashInChunks(a, 4096), await hashInChunks(b, 4096));

        expect(r.match).toBe(false);
        expect(r.firstDifferingBlock).toBe(2);
        expect(r.firstDifferingOffset).toBe(2 * HASH_BLOCK_SIZE);
    });

    it('flags a 512 KiB protocol-part boundary distinctly from a random offset', async () => {
        // Block 1 starts at 1 MiB, which is also a multiple of 512 KiB.
        const a = bytes(HASH_BLOCK_SIZE * 2, 1);
        const b = a.slice();
        b[HASH_BLOCK_SIZE] ^= 0xff;
        const r = compareHashes(await hashInChunks(a, 4096), await hashInChunks(b, 4096));
        expect(r.reason).toMatch(/boundary/);
    });

    it('reports a truncated read as a byte-count difference, not a block mismatch', async () => {
        const full = bytes(HASH_BLOCK_SIZE * 2);
        const short = full.subarray(0, HASH_BLOCK_SIZE * 2 - 1000);
        const r = compareHashes(await hashInChunks(full, 4096), await hashInChunks(short, 4096));

        expect(r.match).toBe(false);
        expect(r.reason).toMatch(/byte count differs/);
        expect(r.reason).toMatch(/short by 1000/);
    });
});
