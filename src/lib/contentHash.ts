/**
 * Content hashing for account mode.
 *
 * WHY BLOCK HASHES AND A MERKLE ROOT, not one SHA-256 over the whole file:
 * WebCrypto has no incremental digest — `crypto.subtle.digest` takes a complete
 * buffer. Hashing a 2.5 GB file in one call means holding 2.5 GB in memory, which
 * is not viable in a browser. Per-block hashing is streaming-friendly, gives
 * block-level integrity for free (so a mismatch localises to one block instead of
 * "somewhere in the file"), and reuses the 1 MiB boundary the read path already
 * aligns to. Locked in ARCHITECTURE-V3 §4.4.
 */

/** Must equal the streaming read chunk and the cipher block. §4.3 / §4.4. */
export const HASH_BLOCK_SIZE = 1024 * 1024;

export function toHex(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
    // TS 5.8 types Uint8Array as Uint8Array<ArrayBufferLike>, which BufferSource
    // rejects because it could in principle be backed by a SharedArrayBuffer.
    // Ours never is — they all come from `new Uint8Array(n)` or a Blob read.
    return new Uint8Array(await crypto.subtle.digest('SHA-256', data as unknown as BufferSource));
}

/**
 * Merkle root over the ordered block digests.
 *
 * A plain concatenate-and-hash would also work, but a Merkle tree lets a future
 * version prove a single block without shipping every hash — worth the few extra
 * lines now rather than a format change later.
 *
 * An odd node at any level is promoted unchanged (no duplication), so the root is
 * stable for any block count.
 */
export async function merkleRoot(blockDigests: Uint8Array[]): Promise<string> {
    if (blockDigests.length === 0) return toHex(await sha256(new Uint8Array(0)));

    let level = blockDigests;
    while (level.length > 1) {
        const next: Uint8Array[] = [];
        for (let i = 0; i < level.length; i += 2) {
            if (i + 1 === level.length) {
                next.push(level[i]);
                continue;
            }
            const pair = new Uint8Array(level[i].length + level[i + 1].length);
            pair.set(level[i], 0);
            pair.set(level[i + 1], level[i].length);
            next.push(await sha256(pair));
        }
        level = next;
    }
    return toHex(level[0]);
}

export interface ContentHash {
    /** Merkle root over the 1 MiB block digests — the file's identity. */
    root: string;
    /** Per-block digests, hex. Used to localise a mismatch to one block. */
    blocks: string[];
    /** Bytes actually hashed. Compared explicitly, because a truncated read
     *  otherwise produces a confidently wrong digest. */
    byteLength: number;
}

/**
 * Incremental hasher.
 *
 * Fed arbitrarily-sized chunks (Telegram parts are 512 KiB, blocks are 1 MiB, and
 * they do not line up), it buffers across boundaries so block digests are taken at
 * exact 1 MiB offsets regardless of how the bytes arrived. Getting this wrong would
 * make two hashes of identical content disagree purely because of chunking.
 */
export class BlockHasher {
    private pending: Uint8Array = new Uint8Array(HASH_BLOCK_SIZE);
    private pendingLen = 0;
    private digests: Uint8Array[] = [];
    private total = 0;

    async update(chunk: Uint8Array): Promise<void> {
        this.total += chunk.byteLength;
        let offset = 0;
        while (offset < chunk.byteLength) {
            const room = HASH_BLOCK_SIZE - this.pendingLen;
            const take = Math.min(room, chunk.byteLength - offset);
            this.pending.set(chunk.subarray(offset, offset + take), this.pendingLen);
            this.pendingLen += take;
            offset += take;
            if (this.pendingLen === HASH_BLOCK_SIZE) {
                this.digests.push(await sha256(this.pending));
                this.pendingLen = 0;
            }
        }
    }

    /** Flushes the final short block. Safe to call once. */
    async finish(): Promise<ContentHash> {
        if (this.pendingLen > 0) {
            this.digests.push(await sha256(this.pending.subarray(0, this.pendingLen)));
            this.pendingLen = 0;
        }
        return {
            root: await merkleRoot(this.digests),
            blocks: this.digests.map(toHex),
            byteLength: this.total,
        };
    }
}

/**
 * The part of `Blob` this module actually needs.
 *
 * A real `File`/`Blob` satisfies this structurally. Declaring it explicitly keeps
 * `hashBlob` testable with a stub carrying real bytes: jsdom's Blob is a partial
 * implementation whose `slice()` result has no `arrayBuffer`, and
 * `new Response(slice)` does not read it correctly either — verified, it returns
 * wrong bytes rather than throwing. A production fallback for that would be a
 * shim that silently corrupts data, which is worse than having none.
 */
export interface SliceableBlob {
    readonly size: number;
    slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

/** Hash a File/Blob by slicing, so the whole thing is never resident. */
export async function hashBlob(
    blob: SliceableBlob,
    onProgress?: (bytesHashed: number) => void
): Promise<ContentHash> {
    const hasher = new BlockHasher();
    for (let offset = 0; offset < blob.size; offset += HASH_BLOCK_SIZE) {
        const end = Math.min(offset + HASH_BLOCK_SIZE, blob.size);
        const slice = blob.slice(offset, end);
        await hasher.update(new Uint8Array(await slice.arrayBuffer()));
        onProgress?.(end);
    }
    return hasher.finish();
}

export interface HashComparison {
    match: boolean;
    /** Index of the first differing 1 MiB block, or -1. */
    firstDifferingBlock: number;
    /** Byte offset where that block starts — the number that says whether this is
     *  a part-boundary bug or a corrupt part. */
    firstDifferingOffset: number;
    reason: string;
}

/**
 * Compare two hashes and localise the first difference.
 *
 * Reports the offset rather than just "mismatch": a difference at an exact
 * multiple of 512 KiB or 1 GiB points at part-boundary handling, while an
 * arbitrary offset points at one corrupt part. That distinction is the whole
 * diagnostic value.
 */
export function compareHashes(source: ContentHash, readBack: ContentHash): HashComparison {
    if (source.byteLength !== readBack.byteLength) {
        // Checked first: a truncated read can still produce matching leading
        // blocks, and reporting "block 0 differs" would be misleading.
        return {
            match: false,
            firstDifferingBlock: -1,
            firstDifferingOffset: -1,
            reason: `byte count differs — source ${source.byteLength}, read-back ${readBack.byteLength} (short by ${source.byteLength - readBack.byteLength})`,
        };
    }

    const n = Math.max(source.blocks.length, readBack.blocks.length);
    for (let i = 0; i < n; i++) {
        if (source.blocks[i] !== readBack.blocks[i]) {
            const offset = i * HASH_BLOCK_SIZE;
            const at512k = offset % (512 * 1024) === 0;
            const at1g = offset % (1024 * 1024 * 1024) === 0;
            return {
                match: false,
                firstDifferingBlock: i,
                firstDifferingOffset: offset,
                reason:
                    `block ${i} differs at byte offset ${offset}` +
                    (at1g ? ' — on a 1 GiB logical-part boundary, suspect part stitching' : '') +
                    (at512k && !at1g ? ' — on a 512 KiB protocol-part boundary, suspect part ordering' : '') +
                    (!at512k ? ' — not on any part boundary, suspect a corrupt part' : ''),
            };
        }
    }

    if (source.root !== readBack.root) {
        // Should be unreachable: equal blocks imply an equal root. If it fires,
        // the Merkle implementation is wrong, not the transfer.
        return {
            match: false,
            firstDifferingBlock: -1,
            firstDifferingOffset: -1,
            reason: 'all block digests match but roots differ — merkleRoot() is broken',
        };
    }

    return { match: true, firstDifferingBlock: -1, firstDifferingOffset: -1, reason: 'identical' };
}
