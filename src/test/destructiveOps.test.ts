import { describe, it, expect, vi } from 'vitest';
import {
    createDestructiveFunnel,
    UNDO_WINDOW_MS,
    type FunnelClock,
} from '@/lib/destructiveOps';

/**
 * One regression test per bug this funnel exists to prevent.
 *
 * A controllable clock is used rather than real timers so the ordering rules are
 * asserted deterministically — the point is WHEN the irreversible step runs
 * relative to undo, and a sleep-based test would only prove it eventually does.
 */
function manualClock() {
    let queue: Array<{ fn: () => void; at: number; handle: number }> = [];
    let now = 0;
    let h = 0;
    const clock: FunnelClock = {
        setTimer: (fn, ms) => {
            const handle = ++h;
            queue.push({ fn, at: now + ms, handle });
            return handle;
        },
        clearTimer: (handle) => {
            queue = queue.filter((t) => t.handle !== handle);
        },
    };
    return {
        clock,
        /** Advance time and fire anything due. */
        advance(ms: number) {
            now += ms;
            const due = queue.filter((t) => t.at <= now);
            queue = queue.filter((t) => t.at > now);
            due.forEach((t) => t.fn());
        },
        pendingTimers: () => queue.length,
    };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('soft delete (trash) keeps the Telegram message', () => {
    it('applies immediately and is reversible', async () => {
        const { clock, advance } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        const commit = vi.fn().mockResolvedValue(undefined);
        const rollback = vi.fn().mockResolvedValue(undefined);

        const op = funnel.request({ kind: 'trash', itemIds: ['f1'], commit, rollback });
        await flush();

        // Reversible work runs now so the UI can update.
        expect(commit).toHaveBeenCalledTimes(1);

        expect(await op.undo()).toBe(true);
        expect(rollback).toHaveBeenCalledTimes(1);
        await expect(op.settled).resolves.toEqual({ status: 'undone', kind: 'trash' });
        advance(UNDO_WINDOW_MS.trash + 1);
    });

    it('refuses a reversible op with no rollback rather than faking undo', () => {
        const { clock } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        expect(() =>
            funnel.request({ kind: 'trash', itemIds: ['f1'], commit: vi.fn() })
        ).toThrow(/rollback/);
    });
});

describe('hard delete (purge) defers the irreversible step', () => {
    it('does NOT touch the message until the undo window elapses', async () => {
        const { clock, advance } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        const commit = vi.fn().mockResolvedValue(undefined);

        const op = funnel.request({ kind: 'purge', itemIds: ['f1'], commit });
        await flush();

        // The whole safety property: nothing destroyed yet.
        expect(commit).not.toHaveBeenCalled();

        advance(UNDO_WINDOW_MS.purge - 1);
        expect(commit).not.toHaveBeenCalled();

        advance(2);
        await flush();
        expect(commit).toHaveBeenCalledTimes(1);
        await expect(op.settled).resolves.toEqual({ status: 'committed', kind: 'purge' });
    });

    it('UNDO PREVENTS THE PURGE ENTIRELY — the message is never deleted', async () => {
        const { clock, advance } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        const commit = vi.fn().mockResolvedValue(undefined);

        const op = funnel.request({ kind: 'purge', itemIds: ['f1'], commit });
        await flush();

        expect(await op.undo()).toBe(true);

        // Advance well past the window: the deferred work must not fire.
        advance(UNDO_WINDOW_MS.purge * 5);
        await flush();

        expect(commit).not.toHaveBeenCalled();
        await expect(op.settled).resolves.toEqual({ status: 'undone', kind: 'purge' });
    });

    it('undo after the window is refused and does not double-run commit', async () => {
        const { clock, advance } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        const commit = vi.fn().mockResolvedValue(undefined);

        const op = funnel.request({ kind: 'purge', itemIds: ['f1'], commit });
        advance(UNDO_WINDOW_MS.purge + 1);
        await flush();

        expect(commit).toHaveBeenCalledTimes(1);
        expect(await op.undo()).toBe(false);
        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('clears the pending timer on undo so nothing is left armed', async () => {
        const { clock, pendingTimers } = manualClock();
        const funnel = createDestructiveFunnel(clock);

        const op = funnel.request({ kind: 'purge', itemIds: ['f1'], commit: vi.fn() });
        expect(pendingTimers()).toBe(1);
        await op.undo();
        expect(pendingTimers()).toBe(0);
    });
});

describe('funnel bookkeeping', () => {
    it('rejects a second purge for an item already pending — no double delete', async () => {
        const { clock } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        funnel.request({ kind: 'purge', itemIds: ['f1'], commit: vi.fn() });

        expect(() =>
            funnel.request({ kind: 'purge', itemIds: ['f1'], commit: vi.fn() })
        ).toThrow(/already pending/);
    });

    it('allows a purge for a different item concurrently', async () => {
        const { clock, advance } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        const a = vi.fn().mockResolvedValue(undefined);
        const b = vi.fn().mockResolvedValue(undefined);

        funnel.request({ kind: 'purge', itemIds: ['f1'], commit: a });
        const opB = funnel.request({ kind: 'purge', itemIds: ['f2'], commit: b });

        // Undoing one must not cancel the other.
        await opB.undo();
        advance(UNDO_WINDOW_MS.purge + 1);
        await flush();

        expect(a).toHaveBeenCalledTimes(1);
        expect(b).not.toHaveBeenCalled();
    });

    it('reports a pending purge so the UI can hide the item', async () => {
        const { clock } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        const op = funnel.request({ kind: 'purge', itemIds: ['f1'], commit: vi.fn() });

        expect(funnel.isPurgePending('f1')).toBe(true);
        expect(funnel.isPurgePending('other')).toBe(false);
        await op.undo();
        expect(funnel.isPurgePending('f1')).toBe(false);
    });

    it('releases the item after a committed purge', async () => {
        const { clock, advance } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        funnel.request({ kind: 'purge', itemIds: ['f1'], commit: vi.fn().mockResolvedValue(undefined) });

        advance(UNDO_WINDOW_MS.purge + 1);
        await flush();
        expect(funnel.isPurgePending('f1')).toBe(false);
    });

    it('rejects an empty item list', () => {
        const { clock } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        expect(() =>
            funnel.request({ kind: 'purge', itemIds: [], commit: vi.fn() })
        ).toThrow(/at least one item/);
    });

    it('surfaces a commit failure instead of reporting success', async () => {
        const { clock, advance } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        const boom = new Error('telegram refused');

        const op = funnel.request({
            kind: 'purge',
            itemIds: ['f1'],
            commit: vi.fn().mockRejectedValue(boom),
        });
        advance(UNDO_WINDOW_MS.purge + 1);
        await flush();

        await expect(op.settled).resolves.toEqual({
            status: 'failed',
            kind: 'purge',
            error: boom,
        });
    });

    it('surfaces a rollback failure rather than claiming the undo worked', async () => {
        const { clock } = manualClock();
        const funnel = createDestructiveFunnel(clock);
        const op = funnel.request({
            kind: 'trash',
            itemIds: ['f1'],
            commit: vi.fn().mockResolvedValue(undefined),
            rollback: vi.fn().mockRejectedValue(new Error('write failed')),
        });
        await flush();

        expect(await op.undo()).toBe(false);
        await expect(op.settled).resolves.toMatchObject({ status: 'failed', kind: 'trash' });
    });
});
