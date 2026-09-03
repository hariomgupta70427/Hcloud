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
 *   2. pinned bootstrap marker scan — the new-device path. Enumerates dialogs,
 *      narrows to broadcast channels the user CREATED, then checks each one's
 *      pinned message.
 *   3. create, post the marker, pin it, store the id.
 *
 * THE DANGEROUS EDGE, and why this file is defensive: step 3 must run only on a
 * genuine no-match. If enumeration is cut short — a FLOOD_WAIT, a dropped
 * connection, an unreadable channel — falling through to "create" gives the user a
 * new empty channel while their files sit invisible in the old one. That is silent
 * data loss, so any incomplete scan is a hard stop instead.
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

/**
 * Thrown when discovery could not complete. Deliberately NOT a no-match: the
 * caller must surface this and let the user retry, never create a second channel.
 */
export class ChannelDiscoveryIncompleteError extends Error {
    constructor(message: string, readonly cause?: unknown) {
        super(
            `${message}. Not creating a new channel: your existing files could be in a ` +
            `channel this scan did not reach. Try again in a moment.`
        );
        this.name = 'ChannelDiscoveryIncompleteError';
    }
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

/** A marker read failure that is transient — the scan must not be trusted after it. */
function isTransient(err: unknown): boolean {
    const text = (err as { text?: unknown })?.text;
    if (typeof text !== 'string') {
        // A non-RPC failure (network, aborted) is transient by default. Being
        // pessimistic here is correct: the cost of a false "transient" is one retry,
        // the cost of a false "permanent" is a duplicate channel.
        return true;
    }
    if (text.startsWith('FLOOD_WAIT')) return true;
    if (text.startsWith('TIMEOUT')) return true;
    if (text.includes('MIGRATE')) return true;
    // CHANNEL_PRIVATE / CHAT_FORBIDDEN etc. mean "not ours, and never will be".
    return false;
}

export interface ResolveOpts {
    /** Title used ONLY when creating. Never used to find an existing channel. */
    title?: string;
    /** Progress reporting for the gate transcript. */
    log?: (line: string) => void;
}

/**
 * Resolve the storage channel, creating it only on a genuine no-match.
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
                log(`PATH=stored-id  reused existing channel ${storedId} (marker v${marker.schemaVersion} validated)`);
                return { id: storedId, title: full.title ?? title, marker, origin: 'reused-stored-id' };
            }
            log(`stored channel id ${storedId} has NO valid pinned marker — not ours, rediscovering`);
        } catch (err) {
            if (isTransient(err)) {
                // Do NOT rediscover on a transient failure: enumeration could also
                // fail and we would end up creating a duplicate of a channel we
                // already know the id of.
                throw new ChannelDiscoveryIncompleteError(
                    `could not validate the known channel ${storedId}`, err
                );
            }
            log(`stored channel id ${storedId} did not resolve (${(err as Error)?.message ?? err}) — rediscovering`);
        }
    }

    // ── 2. New-device path: find OUR channel by its pinned marker ─────────────
    //
    // Narrowed to broadcast channels the user CREATED before any marker read.
    // Calling readMarker on every dialog is two RPCs per chat, so an account with a
    // few hundred chats would issue several hundred calls on first login — which is
    // exactly what provokes the FLOOD_WAIT that turns this path into the data-loss
    // path above. isCreator is available from the dialog we already have, so the
    // filter is free.
    const candidates: Array<{ id: number; title: string }> = [];
    try {
        for await (const dialog of tg.iterDialogs({ archived: 'keep' })) {
            const peer = dialog.peer;
            if (!('chatType' in peer)) continue;          // a User, not a chat
            if (peer.chatType !== 'channel') continue;    // broadcast channels only
            if (!peer.isCreator) continue;                // we always create our own
            candidates.push({ id: peer.id, title: peer.title });
        }
    } catch (err) {
        // Enumeration cut short. Treating this as "no match" is what creates a
        // second channel and orphans the user's files.
        throw new ChannelDiscoveryIncompleteError('channel enumeration was cut short', err);
    }

    log(`enumerated dialogs: ${candidates.length} broadcast channel(s) created by this account`);

    const matches: Array<{ id: number; title: string; marker: ChannelMarker }> = [];
    for (const c of candidates) {
        try {
            const marker = await readMarker(tg, c.id);
            if (marker) matches.push({ ...c, marker });
        } catch (err) {
            if (isTransient(err)) {
                // One unreadable candidate makes the whole scan inconclusive.
                throw new ChannelDiscoveryIncompleteError(
                    `could not read the pinned message of channel ${c.id}`, err
                );
            }
            // Permanently unreadable (private, forbidden) — genuinely not ours.
        }
    }

    if (matches.length > 0) {
        // Deterministic tie-break on the marker's own createdAt rather than on id
        // ordering, which relies on Telegram's id allocation staying monotonic.
        matches.sort((a, b) => {
            const ta = Date.parse(a.marker.createdAt);
            const tb = Date.parse(b.marker.createdAt);
            if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
            return a.id - b.id;
        });
        const chosen = matches[0];

        if (matches.length > 1) {
            // Loud, because it means an earlier bug (or a manual copy) produced more
            // than one storage channel and files may be split across them.
            log(`WARNING: ${matches.length} marked channels found — adopting the OLDEST and ignoring the rest.`);
            log(`WARNING: adopted ${chosen.id} (created ${chosen.marker.createdAt}).`);
            for (const m of matches.slice(1)) {
                log(`WARNING: IGNORED marked channel ${m.id} "${m.title}" (created ${m.marker.createdAt}, installation ${m.marker.installationId.slice(0, 8)}) — it may contain files.`);
            }
        }

        await kvSet(STORED_ID_KEY, chosen.id);
        log(`PATH=adopted-via-marker  reused existing channel ${chosen.id} (pinned marker v${chosen.marker.schemaVersion}, installation ${chosen.marker.installationId.slice(0, 8)})`);
        return { id: chosen.id, title: chosen.title, marker: chosen.marker, origin: 'adopted-via-marker' };
    }

    // ── 3. Create — reached only after a COMPLETE scan found nothing ───────────
    log(`no marked channel among ${candidates.length} candidate(s) — creating one`);
    const { marker, text } = buildMarker();
    const created = await tg.createChannel({
        title,
        description: 'HCloud file storage. Managed automatically — do not delete.',
    });
    const msg = await tg.sendText(created.id, text);
    await tg.pinMessage({ chatId: created.id, message: msg.id });
    await kvSet(STORED_ID_KEY, created.id);
    log(`PATH=created  created channel ${created.id} (marker v${marker.schemaVersion} pinned, installation ${marker.installationId.slice(0, 8)})`);
    return { id: created.id, title: created.title, marker, origin: 'created' };
}

/** Forget the cached channel id. Used by session reset and revocation. */
export async function forgetStorageChannel(): Promise<void> {
    await kvSet(STORED_ID_KEY, undefined);
}
