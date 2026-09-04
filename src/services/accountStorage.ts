import type { TelegramClient } from '@mtcute/web';
import { BlockHasher, type ContentHash } from '@/lib/contentHash';
import { buildManifest, type FileManifest } from '@/lib/fileManifest';

/**
 * Account-mode upload and read-back over MTProto.
 *
 * Both directions go browser <-> Telegram. Nothing here touches our infrastructure,
 * which is invariant 1.
 */

/** Telegram's protocol part size for large-file upload. */
export const PROTOCOL_PART_SIZE = 512 * 1024;

/**
 * Parts sent in parallel per connection.
 *
 * mtcute owns the connection pool and its own adaptive part sizing, so this is the
 * per-connection parallelism rather than a hand-rolled sender count. Reimplementing
 * the scheduler to hit a literal "4 senders" would mean duplicating retry, backoff
 * and DC-migration handling that already works here.
 */
export const UPLOAD_PARTS_IN_PARALLEL = 4;

export interface UploadProgress {
    /** Bytes handed to Telegram so far. */
    bytesSent: number;
    total: number;
    /** Bytes per second over a recent window, not a whole-run average. */
    bytesPerSecond: number;
    /** 0-100, byte-derived — never a chunk count. */
    percent: number;
    phase: 'hashing' | 'uploading' | 'finalising' | 'done';
}

export interface UploadResult {
    manifest: FileManifest;
    sourceHash: ContentHash;
}

/**
 * Throughput over a sliding window.
 *
 * A whole-run average is misleading on a long upload — it hides a stall behind a
 * good first minute. This reports what the last few seconds actually did.
 */
class Rate {
    private samples: Array<{ t: number; bytes: number }> = [];
    private readonly windowMs = 3000;

    push(bytes: number): void {
        const t = performance.now();
        this.samples.push({ t, bytes });
        while (this.samples.length > 1 && t - this.samples[0].t > this.windowMs) {
            this.samples.shift();
        }
    }

    perSecond(): number {
        if (this.samples.length < 2) return 0;
        const first = this.samples[0];
        const last = this.samples[this.samples.length - 1];
        const dt = (last.t - first.t) / 1000;
        if (dt <= 0) return 0;
        return (last.bytes - first.bytes) / dt;
    }
}

/**
 * Hash the file, upload it, and post it to the channel.
 *
 * The source digest is computed by slicing the File, so a multi-GB file is never
 * resident. It is computed BEFORE upload deliberately: it is the reference the
 * read-back is compared against, and it must not be derived from anything the
 * upload path touched.
 */
export async function uploadFileToChannel(
    tg: TelegramClient,
    channelId: number,
    file: File,
    onProgress: (p: UploadProgress) => void,
    log: (line: string) => void
): Promise<UploadResult> {
    const started = performance.now();

    // ── 1. Source digest, from the File itself ─────────────────────────────────
    log(`hashing ${file.name} (${file.size} bytes) in 1 MiB blocks`);
    onProgress({ bytesSent: 0, total: file.size, bytesPerSecond: 0, percent: 0, phase: 'hashing' });

    const hasher = new BlockHasher();
    for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
        const end = Math.min(offset + 1024 * 1024, file.size);
        await hasher.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
        onProgress({
            bytesSent: 0,
            total: file.size,
            bytesPerSecond: 0,
            percent: Math.round((end / file.size) * 100),
            phase: 'hashing',
        });
    }
    const sourceHash = await hasher.finish();
    log(`source root ${sourceHash.root} over ${sourceHash.blocks.length} block(s), ${sourceHash.byteLength} bytes`);

    // ── 2. Upload ─────────────────────────────────────────────────────────────
    const rate = new Rate();
    rate.push(0);

    const uploaded = await tg.uploadFile({
        file,
        fileName: file.name,
        fileSize: file.size,
        fileMime: file.type || 'application/octet-stream',
        partSize: PROTOCOL_PART_SIZE / 1024, // mtcute takes KiB; 512 KiB -> 512
        requestsPerConnection: UPLOAD_PARTS_IN_PARALLEL,
        progressCallback: (sent, total) => {
            rate.push(sent);
            onProgress({
                bytesSent: sent,
                total,
                bytesPerSecond: rate.perSecond(),
                // Byte-derived, so a slow part shows as slow rather than as a jump.
                percent: total > 0 ? Math.round((sent / total) * 100) : 0,
                phase: 'uploading',
            });
        },
    });

    log(`upload complete, posting to channel ${channelId}`);
    onProgress({
        bytesSent: file.size,
        total: file.size,
        bytesPerSecond: rate.perSecond(),
        percent: 100,
        phase: 'finalising',
    });

    // ── 3. Post it, so the bytes have durable coordinates ─────────────────────
    // chatId + messageId are the durable key: a file_id is session-scoped, these are
    // not. ARCHITECTURE-V3 §5.2.
    const msg = await tg.sendMedia(channelId, {
        type: 'document',
        file: uploaded,
        fileName: file.name,
    });

    const uploadMs = Math.round(performance.now() - started);
    log(`posted as message ${msg.id} in ${channelId} (${uploadMs} ms total)`);

    const manifest = buildManifest({
        id: crypto.randomUUID(),
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        contentRoot: sourceHash.root,
        contentBlocks: sourceHash.blocks,
        parts: [{ index: 0, size: file.size, chatId: String(channelId), messageId: msg.id }],
        uploadedAt: new Date().toISOString(),
        uploadMs,
    });

    onProgress({
        bytesSent: file.size,
        total: file.size,
        bytesPerSecond: 0,
        percent: 100,
        phase: 'done',
    });

    return { manifest, sourceHash };
}

export interface ReadBackResult {
    hash: ContentHash;
    /** Where the bytes came from. Printed, because a digest of the wrong source
     *  proves nothing. */
    provenance: string;
    elapsedMs: number;
}

/**
 * Read the file back from Telegram and hash what comes off the wire.
 *
 * The digest is computed ONLY from bytes yielded by the download iterator. Nothing
 * here can see the original `File`: the caller looks the manifest up after a page
 * reload, by which point the File handle no longer exists.
 */
export async function readBackFromChannel(
    tg: TelegramClient,
    manifest: FileManifest,
    onProgress: (bytesRead: number, total: number, bytesPerSecond: number) => void,
    log: (line: string) => void
): Promise<ReadBackResult> {
    const part = manifest.parts[0];
    const chatId = Number(part.chatId);
    const started = performance.now();

    log(`fetching message ${part.messageId} from channel ${chatId}`);
    const [msg] = await tg.getMessages(chatId, [part.messageId]);
    if (!msg) {
        throw new Error(`message ${part.messageId} not found in ${chatId} — cannot read back`);
    }
    const media = msg.media;
    if (!media || media.type !== 'document') {
        throw new Error(`message ${part.messageId} carries no document`);
    }

    const provenance =
        `upload.getFile via mtcute downloadAsIterable, ` +
        `chatId=${chatId} messageId=${part.messageId} fileId=${media.fileId.slice(0, 24)}…`;
    log(`bytes come from: ${provenance}`);

    const hasher = new BlockHasher();
    const rate = new Rate();
    rate.push(0);
    let read = 0;

    for await (const chunk of tg.downloadAsIterable(media)) {
        await hasher.update(chunk);
        read += chunk.byteLength;
        rate.push(read);
        onProgress(read, manifest.size, rate.perSecond());
    }

    const hash = await hasher.finish();
    const elapsedMs = Math.round(performance.now() - started);
    log(`read back ${hash.byteLength} bytes in ${elapsedMs} ms, root ${hash.root}`);

    return { hash, provenance, elapsedMs };
}
