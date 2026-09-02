import type { TelegramClient } from '@mtcute/web';
import { kvGet, kvSet } from '@/lib/accountState';

/**
 * Finding and creating the user's storage channel, WITHOUT relying on its title.
 *
 * A title is user-editable and not unique: resolving by
 * `iterDialogs()` + `title === 'HCloud Storage'` (the first version of this) breaks
 * the moment the user renames the channel, and would happily adopt an unrelated
 * channel that happens to share the name. Title must never be load-bearing.
 *
 * Resolution order:
 *   1. channel id from local session state — the fast path on a known device;
 *      validated against the marker before use, so a stale or wrong id is caught.
 *   2. pinned bootstrap marker scan — the new-device path. Every candidate channel
 *      is checked by reading its PINNED message, not its title.
 *   3. create, post the marker, pin it, store the id.
 *
 * The marker is a pinned message carrying `schemaVersion` and a random
 * installation id. Pinned specifically so discovery is one `getFullChat` call
 * rather than a history scan, and so a user who reads their own channel can see
 * what it is.
 */

/** Bump when the marker payload shape changes. */
export const CHANNEL_SCHEMA_VERSION = 1;

/**
 * Deliberately not the channel title. This string identifies the channel's ROLE;
 * the title is cosmetic and may be anything.
 */
const MARKER_PREFIX = 'HCLOUD-STORAGE-MARKER';

export interface ChannelMarker {
    schemaVersion: number;
    installationId: string;
    createdAt: string;
}

export interface ResolvedChannel {
    id: number;
    title: string;
    marker: ChannelMarker;
    /** How this channel was found — surfaced so the gate transcript can show it. */
    origin: 'created' | 'reused-stored-id' | 'adopted-via-marker';
}

function buildMarker(): { marker: ChannelMarker; text: string } {
    const marker: ChannelMarker = {
        schemaVersion: CHANNEL_SCHEMA_VERSION,
        installationId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
    };
    // One line of human-readable context, then the machine payload. The payload is
    // parsed; the prose is for whoever opens the channel in Telegram.
    const text =
        `${MARKER_PREFIX}\n` +
        `This channel stores HCloud files. Do not delete or unpin this message.\n` +
        JSON.stringify(marker);
    return { marker, text };
}

function parseMarker(text: string | null | undefined): ChannelMarker | null {
    if (!text || !text.startsWith(MARKER_PREFIX)) return null;
    // Take the last line that parses as our object, so extra prose can be added
    // later without breaking older clients.
    for (const line of text.split('\n').reverse()) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) continue;
        try {
            const parsed = JSON.parse(trimmed) as ChannelMarker;
            if (typeof parsed.schemaVersion === 'number' && typeof parsed.installationId === 'string') {
                return parsed;
            }
        } catch {
            /* keep looking */
        }
    }
    return null;
}

/** Read a channel's pinned message and parse the marker, if any. */
async function readMarker(tg: TelegramClient, peer: number): Promise<ChannelMarker | null> {
    const full = await tg.getFullChat(peer);
    const pinnedId = full.pinnedMsgId;
    if (!pinnedId) return null;
    const [msg] = await tg.getMessages(peer, [pinnedId]);
    return parseMarker(msg?.text);
}

const STORED_ID_KEY = 'storageChannelId';

export interface ResolveOpts {
    /** Title used ONLY when creating. Never used to find an existing channel. */
    title?: string;
    /** Progress reporting for the gate transcript. */
    log?: (line: string) => void;
}

/**
 * Resolve the storage channel, creating it if necessary.
 * Never matches on title.
 */
export async function resolveStorageChannel(
    tg: TelegramClient,
    opts: ResolveOpts = {}
): Promise<ResolvedChannel> {
    const title = opts.title ?? 'HCloud Storage';
    const log = opts.log ?? (() => {});

    // ── 1. Fast path: an id we already stored, validated by its marker ─────────
    const storedId = await kvGet<number>(STORED_ID_KEY);
    if (typeof storedId === 'number') {
        try {
            const marker = await readMarker(tg, storedId);
            if (marker) {
                const full = await tg.getFullChat(storedId);
                log(`reused existing channel ${storedId} (stored id, marker v${marker.schemaVersion} ok)`);
                return { id: storedId, title: full.title ?? title, marker, origin: 'reused-stored-id' };
            }
            // The id resolves but is not ours (or the marker was unpinned). Fall
            // through to discovery rather than trusting it.
            log(`stored channel id ${storedId} has no valid marker — rediscovering`);
        } catch (err) {
            log(`stored channel id ${storedId} did not resolve (${err instanceof Error ? err.message : String(err)}) — rediscovering`);
        }
    }

    // ── 2. New-device path: find OUR channel by its pinned marker ─────────────
    for await (const dialog of tg.iterDialogs({ archived: 'keep' })) {
        const peer = dialog.peer;
        if (!('chatType' in peer) || peer.chatType !== 'channel') continue;
        try {
            const marker = await readMarker(tg, peer.id);
            if (!marker) continue;
            await kvSet(STORED_ID_KEY, peer.id);
            log(`reused existing channel ${peer.id} (adopted via pinned marker, installation ${marker.installationId.slice(0, 8)})`);
            return { id: peer.id, title: peer.title, marker, origin: 'adopted-via-marker' };
        } catch {
            // A channel we cannot read the pinned message of is not ours.
            continue;
        }
    }

    // ── 3. Create ─────────────────────────────────────────────────────────────
    const { marker, text } = buildMarker();
    const created = await tg.createChannel({
        title,
        description: 'HCloud file storage. Managed automatically — do not delete.',
    });
    const msg = await tg.sendText(created.id, text);
    await tg.pinMessage({ chatId: created.id, message: msg.id });
    await kvSet(STORED_ID_KEY, created.id);
    log(`created channel ${created.id} (marker v${marker.schemaVersion} pinned, installation ${marker.installationId.slice(0, 8)})`);
    return { id: created.id, title: created.title, marker, origin: 'created' };
}

/** Forget the cached channel id. Used by session reset and revocation. */
export async function forgetStorageChannel(): Promise<void> {
    await kvSet(STORED_ID_KEY, undefined);
}
