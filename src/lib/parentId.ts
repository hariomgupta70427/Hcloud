/**
 * The ONLY way a parentId may enter or leave the data model.
 *
 * `parentId` is `string | null`. Root is `null` and NEVER the empty string.
 *
 * This is not a style preference. Root listings query
 * `where('parentId', '==', null)`, which `''` can never match, so a single
 * `parentId: ''` write makes a file invisible in every folder view and
 * effectively deletes it. That is exactly what
 * `onMove={(folderId) => handleMove(folderId || '')}` did whenever a user moved
 * something to "My Files".
 *
 * Applied on write so bad values cannot be stored, and on read so rows already
 * corrupted by the old bug are healed on the way out.
 *
 * Kept in its own module with no Firebase import so it is unit-testable —
 * importing fileService pulls in src/lib/firebase.ts, which initialises Firebase
 * Auth at module scope and throws without credentials.
 */
export function normalizeParentId(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}
