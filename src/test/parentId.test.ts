import { describe, it, expect } from 'vitest';
import { normalizeParentId } from '@/lib/parentId';

/**
 * `parentId` is `string | null`, and root is ALWAYS null — never ''.
 *
 * Root listings query `where('parentId', '==', null)`, which '' can never
 * match, so a single `parentId: ''` write makes a file invisible in every
 * folder view. That is what the old
 * `onMove={(folderId) => handleMove(folderId || '')}` did whenever a user moved
 * something to "My Files": the file was silently lost.
 *
 * These lock the invariant at the model level so no future call site can
 * reintroduce it.
 */
describe('normalizeParentId', () => {
    it('maps the empty string to null — the actual bug', () => {
        expect(normalizeParentId('')).toBeNull();
    });

    it('maps whitespace-only strings to null', () => {
        expect(normalizeParentId('   ')).toBeNull();
        expect(normalizeParentId('\t\n')).toBeNull();
    });

    it('passes null and undefined through as null', () => {
        expect(normalizeParentId(null)).toBeNull();
        expect(normalizeParentId(undefined)).toBeNull();
    });

    it('coerces non-string types to null rather than storing them', () => {
        expect(normalizeParentId(0)).toBeNull();
        expect(normalizeParentId(false)).toBeNull();
        expect(normalizeParentId({})).toBeNull();
        expect(normalizeParentId([])).toBeNull();
    });

    it('preserves a real folder id unchanged', () => {
        expect(normalizeParentId('abc123')).toBe('abc123');
    });

    it('trims surrounding whitespace off a real id', () => {
        expect(normalizeParentId('  abc123  ')).toBe('abc123');
    });

    it('never returns the empty string for any input', () => {
        const inputs = ['', ' ', '\n', null, undefined, 0, false, {}, [], 'x'];
        for (const input of inputs) {
            expect(normalizeParentId(input)).not.toBe('');
        }
    });
});
