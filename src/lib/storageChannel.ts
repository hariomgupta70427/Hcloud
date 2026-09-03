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
 * THE DANGEROUS EDGE: step 3 must run only on a genuine no-match. If enumeration is
 * cut short — a FLOOD_WAIT, a dropped connection, an unreadable channel — falling
 * through to "create" gives the user a new empty channel while their files sit
 * invisible in the old one. That is silent data loss, so an incomplete scan is a
 * hard stop, and retries are bounded and resumable rather than open-ended.
 */

/** Bump when the marker payload shape changes. */
export const CHANNEL_SCHEMA_VERSION = 1;

/**
 * Deliberately not the channel title. This string identifies the channel's ROLE;
 * the title is cosmetic and may be anything.
 */
const MARKER_PREFIX = 'HCLOUD-STORAGE-MARKER';

/** Attempts at a full resolution before giving up with a terminal error. */
const MAX_ATTEMPTS = 3;

/**
 * Longest FLOOD_WAIT we will sit through silently.
 *
 * Telegram can return waits measured in hours. "Honour it" inside a bounded loop
 * would then mean the UI sits silent for an hour — the same silent hang the bounded
 * retry exists to prevent, just wearing a different hat. Above this, stop and show
 * the real number so the user can decide.
 */
const FLOOD_WAIT_CEILING_SEC = 45;

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
 * One attempt could not complete. Internal: callers see either a resolution, a
 * ChannelRateLimitedError, or ChannelDiscoveryFailedError.
 */
class DiscoveryIncomplete extends Error {
    constructor(message: string, readonly cause?: unknown) {
        super(message);
        this.name = 'DiscoveryIncomplete';
    }
}

/** Rate-limited beyond the ceiling. Terminal for this run, retryable later. */
export class ChannelRateLimitedError extends Error {
    constructor(readonly seconds: number) {
        const mins = Math.ceil(seconds / 60);
        super(
            `Telegram is rate-limiting this account for ${seconds}s (~${mins} min). ` +
            `Not creating a new channel, and not waiting silently — try again in ${mins} minute(s).`
        );
        this.name = 'ChannelRateLimitedError';
    }
}

/** Every bounded attempt failed. Terminal, and explicitly not a no-match. */
export class ChannelDiscoveryFailedError extends Error {
    constructor(readonly attempts: number, readonly cause?: unknown) {
        super(
            `Could not determine your storage channel after ${attempts} attempts. ` +
            `Not creating a new one: your existing files could be in a channel these ` +
            `scans did not reach. Try again in a moment.`
        );
        this.name = 'ChannelDiscoveryFailedError';
    }
}

function buildMarker(): { marker: ChannelMarker; text: string } {
    const marker: ChannelMarker = {
        schemaVersion: CHANNEL_SCHEMA_VERSION,
        installationId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
    };
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

async function readMarker(tg: TelegramClient, peer: number): Promise<ChannelMarker | null> {
    const full = await tg.getFullChat(peer);
    const pinnedId = full.pinnedMsgId;
    if (!pinnedId) return null;
    const [msg] = await tg.getMessages(peer, [pinnedId]);
    return parseMarker(msg?.text);
}

const STORED_ID_KEY = 'storageChannelId';

/** FLOOD_WAIT seconds, or null if this is not a flood wait. */
function floodWaitSeconds(err: unknown): number | null {
    const e = err as { text?: unknown; seconds?: unknown };
    if (typeof e?.text === 'string' && e.text.startsWith('FLOOD_WAIT')) {
        return typeof e.seconds === 'number' ? e.seconds : 0;
    }
    return null;
}

/** A failure after which the scan must not be trusted. */
function isTransient(err: unknown): boolean {
    const text = (err as { text?: unknown })?.text;
    if (typeof text !== 'string') {
        // A non-RPC failure (network, aborted) is transient by default. Being
        // pessimistic is correct: a false "transient" costs one bounded retry, a
        // false "permanent" costs a duplicate channel.
        return true;
    }
    if (text.startsWith('FLOOD_WAIT')) return true;
    if (text.startsWith('TIMEOUT')) return true;
    if (text.includes('MIGRATE')) return true;
    // CHANNEL_PRIVATE / CHAT_FORBIDDEN etc. mean "not ours, and never will be".
    return false;
}

/**
 * Channels checked this session and confirmed NOT ours.
 *
 * This is what makes a retry resume rather than restart. Each marker read is two
 * RPCs, so re-checking every channel on attempt 2 would multiply exactly the call
 * volume that provoked the FLOOD_WAIT being recovered from. Dialog enumeration
 * itself is re-run — it is paginated and roughly one RPC per 100 dialogs, so it is
 * cheap by comparison and cannot be resumed mid-cursor.
 *
 * Session-scoped on purpose: "no marker" can stop being true if the user pins one,
 * so this must not outlive the page.
 */
const clearedChannels = new Set<number>();

/** Drop the resume cache. Called by session reset so a fresh login rescans. */
export function forgetClearedChannels(): void {
    clearedChannels.clear();
}

/**
 * Read-only view of the resume cache, for tests.
 *
 * Exported because the invariant worth testing is "a failed marker read leaves the
 * channel uncleared", and that is only observable through this set.
 */
export function clearedChannelIds(): number[] {
    return [...clearedChannels];
}

export interface ResolveOpts {
    /** Title used ONLY when creating. Never used to find an existing channel. */
    title?: string;
    /** Progress reporting for the gate transcript. */
    log?: (line: string) => void;
}

type Log = (line: string) => void;

/** One resolution attempt. Throws DiscoveryIncomplete if it could not finish. */
async function attemptResolve(
    tg: TelegramClient,
    title: string,
    log: Log
): Promise<ResolvedChannel> {
    // 1. Fast path: an id we already stored, validated by its marker.
    const storedId = await kvGet<number>(STORED_ID_KEY);
    if (typeof storedId === 'number') {
        try {
            const marker = await readMarker(tg, storedId);
            if (marker) {
                const full = await tg.getFullChat(storedId);
                log(`PATH=stored-id  reused existing channel ${storedId} (marker v${marker.schemaVersion} validated)`);
                return { id: storedId, title: full.title ?? title, marker, origin: 'reused-stored-id' };
            }
            log(`stored channel id ${storedId} has NO valid pinned marker - not ours, rediscovering`);
        } catch (err) {
            // Do NOT rediscover on a transient failure: enumeration could fail too
            // and we would create a duplicate of a channel we already had the id of.
            if (isTransient(err)) {
                throw new DiscoveryIncomplete(`could not validate known channel ${storedId}`, err);
            }
            log(`stored channel id ${storedId} did not resolve permanently - rediscovering`);
        }
    }

    // 2. New-device path: find OUR channel by its pinned marker.
    //
    // Narrowed to broadcast channels the user CREATED before any marker read.
    // readMarker is two RPCs per channel, so checking every dialog would issue
    // hundreds of calls on an account with hundreds of chats - precisely what
    // provokes the FLOOD_WAIT that turns this into the data-loss path. isCreator
    // comes free from the dialog already in hand.
    const candidates: Array<{ id: number; title: string }> = [];
    try {
        for await (const dialog of tg.iterDialogs({ archived: 'keep' })) {
            const peer = dialog.peer;
            if (!('chatType' in peer)) continue;        // a User, not a chat
            if (peer.chatType !== 'channel') continue;  // broadcast channels only
            if (!peer.isCreator) continue;              // we always create our own
            candidates.push({ id: peer.id, title: peer.title });
        }
    } catch (err) {
        // Treating a cut-short enumeration as "no match" is what creates a second
        // channel and orphans the user's files.
        throw new DiscoveryIncomplete('channel enumeration was cut short', err);
    }

    const fresh = candidates.filter((c) => !clearedChannels.has(c.id));
    const skipped = candidates.length - fresh.length;
    log(
        `enumerated ${candidates.length} broadcast channel(s) created by this account` +
        (skipped > 0 ? ` - skipping ${skipped} already checked this session` : '')
    );

    const matches: Array<{ id: number; title: string; marker: ChannelMarker }> = [];
    // Candidates we could not definitively check. A scan that leaves any of these
    // behind is NOT a no-match, so it must not reach the create branch.
    const unchecked: number[] = [];

    for (const c of fresh) {
        let marker: ChannelMarker | null;
        try {
            marker = await readMarker(tg, c.id);
        } catch (err) {
            if (isTransient(err)) {
                // Fail fast so the bounded retry resumes past whatever WAS cleared.
                throw new DiscoveryIncomplete(`could not read pinned message of channel ${c.id}`, err);
            }
            // Permanently unreadable (private, forbidden). Deliberately NOT cleared:
            // "we could not check" is not "checked, not ours". Caching it would let a
            // retry skip the real channel and create a duplicate — the exact
            // error-vs-no-match conflation this file exists to prevent, re-entering
            // through the cache.
            log(`WARNING: channel ${c.id} "${c.title}" is unreadable — cannot rule it out`);
            unchecked.push(c.id);
            continue;
        }

        if (marker) {
            matches.push({ ...c, marker });
        } else {
            // The ONLY definite negative: the read succeeded and there was no marker.
            clearedChannels.add(c.id);
        }
    }

    if (matches.length > 0) {
        // Tie-break on the marker's own createdAt rather than id ordering, which
        // would rely on Telegram's id allocation staying monotonic.
        matches.sort((a, b) => {
            const ta = Date.parse(a.marker.createdAt);
            const tb = Date.parse(b.marker.createdAt);
            if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
            return a.id - b.id;
        });
        const chosen = matches[0];

        if (matches.length > 1) {
            // Loud: more than one means an earlier bug or a manual copy split the
            // user's files across channels.
            log(`WARNING: ${matches.length} marked channels found - adopting the OLDEST, ignoring the rest.`);
            for (const m of matches.slice(1)) {
                log(`WARNING: IGNORED marked channel ${m.id} "${m.title}" (created ${m.marker.createdAt}, installation ${m.marker.installationId.slice(0, 8)}) - it may contain files.`);
            }
        }

        await kvSet(STORED_ID_KEY, chosen.id);
        log(`PATH=adopted-via-marker  reused existing channel ${chosen.id} (pinned marker v${chosen.marker.schemaVersion}, installation ${chosen.marker.installationId.slice(0, 8)})`);
        return { id: chosen.id, title: chosen.title, marker: chosen.marker, origin: 'adopted-via-marker' };
    }

    // 3. Create - reached only after a COMPLETE scan definitively found nothing.
    if (unchecked.length > 0) {
        throw new DiscoveryIncomplete(
            `${unchecked.length} candidate channel(s) could not be checked (${unchecked.join(', ')})`
        );
    }
    log(`no marked channel among ${candidates.length} candidate(s) - creating one`);
    const { marker, text } = buildMarker();
    const created = await tg.createChannel({
        title,
        description: 'HCloud file storage. Managed automatically - do not delete.',
    });
    const msg = await tg.sendText(created.id, text);
    await tg.pinMessage({ chatId: created.id, message: msg.id });
    await kvSet(STORED_ID_KEY, created.id);
    log(`PATH=created  created channel ${created.id} (marker v${marker.schemaVersion} pinned, installation ${marker.installationId.slice(0, 8)})`);
    return { id: created.id, title: created.title, marker, origin: 'created' };
}

/**
 * Resolve the storage channel. Bounded, resumable, and never silent.
 *
 * Outcomes are exactly four, all visible:
 *   - resolved (created / stored-id / adopted-via-marker)
 *   - ChannelRateLimitedError     flood wait above the ceiling, with the real number
 *   - ChannelDiscoveryFailedError attempts exhausted, terminal
 *   - a permanent non-transient error, propagated
 *
 * There is deliberately no path that waits indefinitely, and none that creates a
 * channel after an incomplete scan.
 */
export async function resolveStorageChannel(
    tg: TelegramClient,
    opts: ResolveOpts = {}
): Promise<ResolvedChannel> {
    const title = opts.title ?? 'HCloud Storage';
    const log = opts.log ?? (() => {});
    let last: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await attemptResolve(tg, title, log);
        } catch (err) {
            if (!(err instanceof DiscoveryIncomplete)) throw err; // permanent - surface it
            last = err.cause ?? err;

            const flood = floodWaitSeconds(err.cause);
            if (flood !== null && flood > FLOOD_WAIT_CEILING_SEC) {
                // Do not sit silent for minutes or hours. Show the number.
                log(`attempt ${attempt}/${MAX_ATTEMPTS} hit FLOOD_WAIT ${flood}s - above the ${FLOOD_WAIT_CEILING_SEC}s ceiling, stopping`);
                throw new ChannelRateLimitedError(flood);
            }

            if (attempt === MAX_ATTEMPTS) {
                log(`attempt ${attempt}/${MAX_ATTEMPTS} failed (${err.message}) - no attempts left`);
                break;
            }

            // Honour a short flood wait exactly; otherwise back off.
            const waitMs = flood !== null ? flood * 1000 : Math.min(1000 * 2 ** (attempt - 1), 8000);
            log(`attempt ${attempt}/${MAX_ATTEMPTS} incomplete (${err.message}) - retrying in ${Math.round(waitMs / 1000)}s, resuming past ${clearedChannels.size} cleared channel(s)`);
            await new Promise((r) => setTimeout(r, waitMs));
        }
    }

    throw new ChannelDiscoveryFailedError(MAX_ATTEMPTS, last);
}

/** Forget the cached channel id. Used by session reset and revocation. */
export async function forgetStorageChannel(): Promise<void> {
    await kvSet(STORED_ID_KEY, undefined);
    forgetClearedChannels();
}
