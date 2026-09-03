import { HASH_BLOCK_SIZE } from '@/lib/contentHash';

/**
 * The persisted description of an uploaded file.
 *
 * This is the record that survives a page reload, which is what makes the 2.3a
 * gate meaningful: after a reload the File handle is gone, so a read-back digest
 * can only have come from Telegram.
 */

/** Bump when the manifest shape changes. */
export const MANIFEST_SCHEMA_VERSION = 1;

/**
 * 🔒 THE MERKLE ROOT IS OVER PLAINTEXT.
 *
 * Decided deliberately, 2026-09-03, because the root doubles as the dedupe id and
 * so becomes a permanent format commitment the moment any digest is stored.
 *
 * WHY PLAINTEXT:
 *
 * 1. It verifies the property that actually matters — the bytes the user gets back
 *    are the bytes they put in. A ciphertext root would still pass if decryption
 *    were broken, certifying storage integrity while serving garbage.
 *
 * 2. The usual objection to plaintext roots is cross-user correlation: equal roots
 *    reveal that two people hold the same file. That does not apply here, because
 *    there is no shared index to correlate against — each user's index lives in
 *    their OWN storage channel (§5.1). Dedupe is intra-user by construction, so the
 *    leak has nobody to leak to.
 *
 * 3. AES-256-CTR (§4.3) preserves length and byte offsets, so plaintext block
 *    boundaries stay aligned to the 1 MiB read chunk. Hashing plaintext costs
 *    nothing structurally.
 *
 * 4. It keeps 2.3a's digests valid when encryption lands. They are plaintext roots
 *    today with `encryption: null`, and they remain plaintext roots afterwards —
 *    no silent invalidation, no migration.
 *
 * WHAT WE GIVE UP, AND HOW IT IS RECOVERED: a plaintext root cannot verify stored
 * bytes without decrypting them. That is what the out-of-band per-block integrity
 * tags in §4.3 are for. Tags detect tampering with the ciphertext; the Merkle root
 * proves the plaintext round-tripped. Both properties, from two mechanisms, rather
 * than one mechanism doing neither job well.
 *
 * Consequence for the read path: read-back MUST decrypt before hashing once
 * encryption exists. Hashing ciphertext and comparing to a plaintext root would
 * report corruption on every encrypted file.
 */
export type HashDomain = 'plaintext';

export const HASH_DOMAIN: HashDomain = 'plaintext';

export interface UploadedPart {
    /** Index in the ordered part sequence. */
    index: number;
    /** Bytes in this part. */
    size: number;
    /** Durable coordinates. A file_id is bot/session-scoped; these are not. */
    chatId: string;
    messageId: number;
}

export interface FileManifest {
    /** Manifest shape version. */
    schemaVersion: number;

    /**
     * Hash block size in bytes, recorded explicitly.
     *
     * The Merkle root is the dedupe id, so the block size is part of the digest's
     * meaning: the same file hashed at a different block size yields a different
     * root. Storing it means a future change is a detectable migration rather than
     * silent mismatches against every digest already written.
     */
    hashBlockSize: number;

    /** Whether the root covers plaintext or ciphertext. See HASH_DOMAIN. */
    hashDomain: HashDomain;

    id: string;
    name: string;
    mimeType: string;
    size: number;

    /** Merkle root over the hash blocks — the file's identity and dedupe key. */
    contentRoot: string;
    /** Per-block digests, so a mismatch localises to one block. */
    contentBlocks: string[];

    /** Encryption parameters, or null while files are stored as plaintext. */
    encryption: null;

    parts: UploadedPart[];

    /** Wall-clock, for the lab UI. */
    uploadedAt: string;
    uploadMs: number;
}

/** Build a manifest with the format fields filled in from the single source. */
export function buildManifest(
    fields: Omit<FileManifest, 'schemaVersion' | 'hashBlockSize' | 'hashDomain' | 'encryption'>
): FileManifest {
    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        hashBlockSize: HASH_BLOCK_SIZE,
        hashDomain: HASH_DOMAIN,
        encryption: null,
        ...fields,
    };
}

/**
 * Reject a manifest whose digest cannot be compared against a fresh hash.
 *
 * Called before verifying a read-back. Without this, a manifest written under a
 * different block size or hash domain would produce a mismatch that looks like
 * data corruption, sending the reader hunting for a transfer bug that is not there.
 */
export function assertComparable(m: FileManifest): void {
    if (m.hashBlockSize !== HASH_BLOCK_SIZE) {
        throw new Error(
            `manifest hashBlockSize ${m.hashBlockSize} != current ${HASH_BLOCK_SIZE} — ` +
            `digests are not comparable across block sizes; this needs a migration, not a retry`
        );
    }
    if (m.hashDomain !== HASH_DOMAIN) {
        throw new Error(
            `manifest hashDomain "${m.hashDomain}" != current "${HASH_DOMAIN}" — ` +
            `hashing a different domain would report corruption on every file`
        );
    }
    if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
        throw new Error(
            `manifest schemaVersion ${m.schemaVersion} != current ${MANIFEST_SCHEMA_VERSION}`
        );
    }
}
