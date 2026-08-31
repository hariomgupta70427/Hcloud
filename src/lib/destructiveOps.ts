/**
 * The single funnel every destructive operation goes through.
 *
 * WHY THIS EXISTS
 * ---------------
 * Deletion was implemented ad hoc per screen: FilesPage used a native
 * `confirm()`, TrashPage used two more, and `deleteItem` recursed into children
 * and hard-deleted them while bypassing trash entirely. There was no undo
 * anywhere, and nothing distinguished "move to trash" from "destroy the bytes".
 *
 * Two rules this enforces, from ARCHITECTURE-V3 §8:
 *
 *   SOFT delete (`trash`)  — sets a trash flag. The Telegram message is KEPT.
 *                            Reversible by flipping the flag back.
 *   HARD delete (`purge`)  — removes the Telegram message. Irreversible.
 *
 * The undo window is what makes `purge` safe to offer at all: the irreversible
 * step is DEFERRED until the window elapses. Undo cancels it, so the message is
 * never touched. Contrast the obvious-but-wrong design — delete now, "undo" by
 * re-uploading — which cannot work once the bytes are gone.
 *
 * Deliberately free of Firebase, Telegram and React imports: the caller supplies
 * `commit` and `rollback`, and timing is injected. That keeps the ordering rules
 * unit-testable, which is the only way to have a regression test for
 * "undo must prevent the purge" at all.
 */

export type DestructiveKind = 'trash' | 'restore' | 'purge';

/** How long the user has to undo, per kind. */
export const UNDO_WINDOW_MS: Record<DestructiveKind, number> = {
    trash: 7000,
    restore: 7000,
    // Longer: this is the one that cannot be taken back.
    purge: 10000,
};

export interface DestructiveRequest {
    kind: DestructiveKind;
    /** Ids being acted on. Used for labelling and for conflict detection. */
    itemIds: string[];
    /**
     * Performs the actual change.
     * For `trash`/`restore` this runs IMMEDIATELY (it is reversible).
     * For `purge` it runs only after the undo window elapses.
     */
    commit: () => Promise<void>;
    /** Reverses an already-applied reversible op. Required for trash/restore. */
    rollback?: () => Promise<void>;
}

export interface PendingOp {
    readonly id: string;
    readonly kind: DestructiveKind;
    readonly itemIds: readonly string[];
    /** Resolves when the op has finally settled (committed, undone, or failed). */
    readonly settled: Promise<DestructiveOutcome>;
    /** Cancel if still possible. Returns true if the op was actually undone. */
    undo: () => Promise<boolean>;
}

export type DestructiveOutcome =
    | { status: 'committed'; kind: DestructiveKind }
    | { status: 'undone'; kind: DestructiveKind }
    | { status: 'failed'; kind: DestructiveKind; error: unknown };

export interface FunnelClock {
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
}

const realClock: FunnelClock = {
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

let seq = 0;
const nextId = () => `op_${++seq}`;

/**
 * Creates an isolated funnel. Production uses the module-level singleton below;
 * tests create their own so state never leaks between cases.
 */
export function createDestructiveFunnel(clock: FunnelClock = realClock) {
    const pending = new Map<string, PendingOp>();

    /** Ids with an in-flight deferred purge — used to reject double-purge. */
    const purging = new Set<string>();

    function request(req: DestructiveRequest): PendingOp {
        if (req.itemIds.length === 0) {
            throw new Error('A destructive operation needs at least one item');
        }
        if (req.kind !== 'purge' && !req.rollback) {
            // A reversible op with no rollback is a lie: the UI would offer undo
            // and silently do nothing.
            throw new Error(`${req.kind} requires a rollback to be undoable`);
        }
        if (req.kind === 'purge') {
            const clash = req.itemIds.find((id) => purging.has(id));
            if (clash) {
                throw new Error(`A delete is already pending for ${clash}`);
            }
        }

        const id = nextId();
        let resolveSettled!: (o: DestructiveOutcome) => void;
        const settled = new Promise<DestructiveOutcome>((r) => {
            resolveSettled = r;
        });

        // 'armed'  = reversible work applied, or deferred work not yet started
        // 'closed' = terminal; undo can no longer change anything
        let state: 'armed' | 'closed' = 'armed';
        let timer: unknown = null;

        const finish = (outcome: DestructiveOutcome) => {
            state = 'closed';
            if (timer !== null) clock.clearTimer(timer);
            timer = null;
            pending.delete(id);
            if (op.kind === 'purge') op.itemIds.forEach((i) => purging.delete(i));
            resolveSettled(outcome);
        };

        const op: PendingOp = {
            id,
            kind: req.kind,
            itemIds: [...req.itemIds],
            settled,
            undo: async () => {
                if (state === 'closed') return false;

                if (req.kind === 'purge') {
                    // The irreversible step never ran. Cancelling the timer is
                    // the entire undo — nothing to reverse.
                    finish({ status: 'undone', kind: req.kind });
                    return true;
                }

                try {
                    await req.rollback!();
                    finish({ status: 'undone', kind: req.kind });
                    return true;
                } catch (error) {
                    finish({ status: 'failed', kind: req.kind, error });
                    return false;
                }
            },
        };

        pending.set(id, op);

        if (req.kind === 'purge') {
            req.itemIds.forEach((i) => purging.add(i));
            // Defer the irreversible work. This is the safety property.
            timer = clock.setTimer(() => {
                timer = null;
                if (state === 'closed') return;
                state = 'closed';
                req.commit()
                    .then(() => finish({ status: 'committed', kind: req.kind }))
                    .catch((error) => finish({ status: 'failed', kind: req.kind, error }));
            }, UNDO_WINDOW_MS[req.kind]);
        } else {
            // Reversible: apply now so the UI updates immediately, and keep the
            // op undoable for the window.
            req.commit()
                .then(() => {
                    if (state === 'closed') return;
                    timer = clock.setTimer(() => {
                        timer = null;
                        if (state === 'closed') return;
                        finish({ status: 'committed', kind: req.kind });
                    }, UNDO_WINDOW_MS[req.kind]);
                })
                .catch((error) => finish({ status: 'failed', kind: req.kind, error }));
        }

        return op;
    }

    return {
        request,
        /** Ops still inside their undo window. */
        pendingOps: () => Array.from(pending.values()),
        /** True while an irreversible purge is still deferred for this id. */
        isPurgePending: (itemId: string) => purging.has(itemId),
    };
}

/** The one funnel the app uses. No page may delete outside this. */
export const destructiveFunnel = createDestructiveFunnel();
