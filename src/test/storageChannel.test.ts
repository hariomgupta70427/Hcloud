import { describe, it, expect, beforeEach } from 'vitest';
import type { TelegramClient } from '@mtcute/web';
import {
    resolveStorageChannel,
    forgetClearedChannels,
    clearedChannelIds,
    ChannelDiscoveryFailedError,
    ChannelRateLimitedError,
    CHANNEL_SCHEMA_VERSION,
} from '@/lib/storageChannel';

/**
 * The invariant under test: a channel may enter the resume cache ONLY on a definite
 * negative — the marker read succeeded and there was no marker.
 *
 * Caching anything else turns "we could not check" into "checked, not ours". A retry
 * then skips the real channel and the scan reaches the create branch, producing a
 * second storage channel while the user's files sit invisible in the first. That is
 * the error-vs-no-match conflation this module exists to prevent, and the cache is a
 * second door into it.
 */

const MARKER =
    'HCLOUD-STORAGE-MARKER\n' +
    'This channel stores HCloud files. Do not delete or unpin this message.\n' +
    JSON.stringify({
        schemaVersion: CHANNEL_SCHEMA_VERSION,
        installationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        createdAt: '2026-01-01T00:00:00.000Z',
    });

interface FakeChannel {
    id: number;
    title: string;
    /** null = read succeeds with no marker; Error = read throws. */
    pinned: string | null | Error;
}

function rpc(text: string, code = 400, seconds?: number) {
    return Object.assign(new Error(`Telegram API error ${code}: ${text}`), { text, code, seconds });
}

/** Minimal client covering only the calls resolveStorageChannel makes. */
function fakeClient(channels: FakeChannel[], onCreate?: () => void) {
    const reads: number[] = [];
    const tg = {
        async *iterDialogs() {
            for (const c of channels) {
                yield { peer: { chatType: 'channel', id: c.id, title: c.title, isCreator: true } };
            }
        },
        async getFullChat(id: number) {
            const c = channels.find((x) => x.id === id)!;
            if (c.pinned instanceof Error) {
                reads.push(id);
                throw c.pinned;
            }
            return { title: c.title, pinnedMsgId: c.pinned === null ? null : 1 };
        },
        async getMessages(id: number) {
            reads.push(id);
            const c = channels.find((x) => x.id === id)!;
            return [{ text: c.pinned as string }];
        },
        async createChannel({ title }: { title: string }) {
            onCreate?.();
            return { id: -1009999, title };
        },
        async sendText() {
            return { id: 1 };
        },
        async pinMessage() {
            return undefined;
        },
    };
    return { tg: tg as unknown as TelegramClient, reads };
}

beforeEach(() => forgetClearedChannels());

describe('resume cache admits only definite negatives', () => {
    it('caches a channel whose read SUCCEEDED with no marker', async () => {
        const { tg } = fakeClient([{ id: -1001, title: 'Notes', pinned: null }]);
        await resolveStorageChannel(tg, { title: 'HCloud Storage' });
        expect(clearedChannelIds()).toEqual([-1001]);
    });

    it('does NOT cache a channel whose read failed with FLOOD_WAIT', async () => {
        const { tg } = fakeClient([{ id: -1002, title: 'Maybe ours', pinned: rpc('FLOOD_WAIT_%d', 420, 0) }]);
        await expect(resolveStorageChannel(tg)).rejects.toBeInstanceOf(ChannelDiscoveryFailedError);
        // The whole point: it must stay checkable.
        expect(clearedChannelIds()).not.toContain(-1002);
        expect(clearedChannelIds()).toEqual([]);
    });

    it('does NOT cache a channel whose read failed permanently', async () => {
        const { tg } = fakeClient([{ id: -1003, title: 'Private', pinned: rpc('CHANNEL_PRIVATE', 400) }]);
        await expect(resolveStorageChannel(tg)).rejects.toBeInstanceOf(ChannelDiscoveryFailedError);
        expect(clearedChannelIds()).not.toContain(-1003);
    }, 15000);

    it('keeps definite negatives found BEFORE a failure, so the retry resumes', async () => {
        const { tg } = fakeClient([
            { id: -1010, title: 'Cleared', pinned: null },
            { id: -1011, title: 'Blew up', pinned: rpc('FLOOD_WAIT_%d', 420, 0) },
        ]);
        await expect(resolveStorageChannel(tg)).rejects.toBeInstanceOf(ChannelDiscoveryFailedError);
        expect(clearedChannelIds()).toEqual([-1010]);
    });
});

describe('an unchecked candidate blocks the create branch', () => {
    it('never creates a channel when a candidate could not be read', async () => {
        let created = false;
        const { tg } = fakeClient(
            [{ id: -1004, title: 'Unreadable', pinned: rpc('CHANNEL_PRIVATE', 400) }],
            () => {
                created = true;
            }
        );
        await expect(resolveStorageChannel(tg)).rejects.toBeInstanceOf(ChannelDiscoveryFailedError);
        // A duplicate channel here is silent data loss.
        expect(created).toBe(false);
    }, 15000);

    it('creates only when every candidate was definitively checked', async () => {
        let created = false;
        const { tg } = fakeClient([{ id: -1005, title: 'Not ours', pinned: null }], () => {
            created = true;
        });
        const r = await resolveStorageChannel(tg);
        expect(created).toBe(true);
        expect(r.origin).toBe('created');
    });
});

describe('flood-wait ceiling', () => {
    it('stops with the real number instead of waiting for hours', async () => {
        const { tg } = fakeClient([{ id: -1006, title: 'x', pinned: rpc('FLOOD_WAIT_%d', 420, 3600) }]);
        const err = await resolveStorageChannel(tg).catch((e) => e);
        expect(err).toBeInstanceOf(ChannelRateLimitedError);
        expect((err as ChannelRateLimitedError).seconds).toBe(3600);
        expect(String(err)).toMatch(/60 minute/);
    });
});

describe('adoption', () => {
    it('adopts a marked channel rather than creating', async () => {
        let created = false;
        const { tg } = fakeClient([{ id: -1007, title: 'Renamed by user', pinned: MARKER }], () => {
            created = true;
        });
        const r = await resolveStorageChannel(tg);
        expect(r.origin).toBe('adopted-via-marker');
        expect(r.id).toBe(-1007);
        expect(created).toBe(false);
        // A match is not a negative, so it must not be cached.
        expect(clearedChannelIds()).not.toContain(-1007);
    });
});
