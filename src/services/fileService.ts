import {
    collection,
    doc,
    addDoc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    where,
    serverTimestamp,
    onSnapshot,
    Unsubscribe,
    Timestamp,
    writeBatch
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getIdTokenHeader } from '@/lib/authHeader';
import { normalizeParentId } from '@/lib/parentId';
import { destructiveFunnel } from '@/lib/destructiveOps';

export interface FileItem {
    id: string;
    name: string;
    type: 'file' | 'folder';
    mimeType?: string;
    size?: number;
    telegramFileId?: string;
    telegramMessageId?: number; // Message ID for BYOD files (used for download)
    storageType?: 'managed' | 'byod'; // How file was uploaded
    parentId: string | null;
    userId: string;
    isStarred: boolean;
    isShared: boolean;
    isDeleted?: boolean;
    deletedAt?: Date;
    shareSettings?: {
        // LEGACY, READ-ONLY. These four are never written with a value any more —
        // shareFile writes explicit nulls. Share passwords are hashed and verified
        // server-side (api/_lib/shareToken.ts) and the capability lives in the
        // link fragment, because anything stored here is readable by whoever can
        // read the document. Kept only so old documents still deserialise.
        password?: string;
        passwordSalt?: string;
        passwordVerifier?: string;
        streamToken?: string;
        tokenExpiresAt?: Date;
        /** Whether the link challenges for a password. Not a secret. */
        requiresPassword?: boolean;
        expiresAt?: Date;
        link?: string;
        /** When the minted capability stops working. */
        linkExpiresAt?: Date;
    };
    path: string;
    thumbnail?: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateFolderData {
    name: string;
    parentId: string | null;
    userId: string;
}

export interface UploadFileData {
    name: string;
    mimeType: string;
    size: number;
    telegramFileId: string;
    telegramMessageId?: number; // Message ID for BYOD download
    storageType?: 'managed' | 'byod';
    parentId: string | null;
    userId: string;
    thumbnail?: string;
}

// Collection reference
const filesCollection = collection(db, 'files');

/**
 * `parentId` is `string | null`; root is null and never ''. Defined in
 * src/lib/parentId.ts so it can be unit-tested without initialising Firebase.
 * Re-exported here because this module is the data-access boundary.
 */
export { normalizeParentId };

// Helper to convert Firestore doc to FileItem
function docToFileItem(docId: string, data: any): FileItem {
    return {
        id: docId,
        name: data.name,
        type: data.type,
        mimeType: data.mimeType,
        size: data.size,
        telegramFileId: data.telegramFileId,
        telegramMessageId: data.telegramMessageId,
        storageType: data.storageType,
        parentId: normalizeParentId(data.parentId),
        userId: data.userId,
        isStarred: data.isStarred || false,
        isShared: data.isShared || false,
        isDeleted: data.isDeleted || false,
        deletedAt: data.deletedAt?.toDate?.() || undefined,
        shareSettings: data.shareSettings,
        path: data.path,
        thumbnail: data.thumbnail,
        createdAt: data.createdAt?.toDate?.() || new Date(),
        updatedAt: data.updatedAt?.toDate?.() || new Date(),
    };
}

// Get all files for a user
export async function getUserFiles(userId: string): Promise<FileItem[]> {
    const q = query(
        filesCollection,
        where('userId', '==', userId)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs
        .map((doc) => docToFileItem(doc.id, doc.data()))
        .sort((a, b) => {
            // Folders first
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            // Then by name
            return a.name.localeCompare(b.name);
        });
}

// Search all files by name (global search)
export async function searchFiles(userId: string, searchTerm: string): Promise<FileItem[]> {
    // Firestore doesn't support full-text search, so we fetch all files and filter client-side
    const allFiles = await getUserFiles(userId);
    const term = searchTerm.toLowerCase();

    return allFiles.filter(file =>
        file.name.toLowerCase().includes(term) &&
        !file.isDeleted
    );
}

// Get all folders for a user (for MoveDialog)
export async function getAllFolders(userId: string): Promise<FileItem[]> {
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('type', '==', 'folder')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs
        .map((doc) => docToFileItem(doc.id, doc.data()))
        .filter((folder) => !folder.isDeleted)
        .sort((a, b) => a.name.localeCompare(b.name));
}

// Get files in a specific folder (excluding deleted)
export async function getFilesInFolder(
    userId: string,
    folderId: string | null
): Promise<FileItem[]> {
    const parentId = normalizeParentId(folderId);

    // RECOVERY: the old move-to-root bug wrote `parentId: ''` instead of null.
    // Those rows match neither `== null` nor any real folder id, so the files
    // vanished from every view. Root therefore queries for both and merges, so
    // anything already corrupted shows up again. docToFileItem() normalises the
    // value on the way out, and the next write repairs the row for good.
    const queries = parentId === null
        ? [
            query(filesCollection, where('userId', '==', userId), where('parentId', '==', null)),
            query(filesCollection, where('userId', '==', userId), where('parentId', '==', '')),
        ]
        : [
            query(filesCollection, where('userId', '==', userId), where('parentId', '==', parentId)),
        ];

    const snapshots = await Promise.all(queries.map((q) => getDocs(q)));

    const seen = new Set<string>();
    const items: FileItem[] = [];
    for (const snapshot of snapshots) {
        for (const d of snapshot.docs) {
            if (seen.has(d.id)) continue;
            seen.add(d.id);
            items.push(docToFileItem(d.id, d.data()));
        }
    }

    return items
        .filter((file) => !file.isDeleted)
        .sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
}

// Get starred files
// NOTE: We intentionally avoid orderBy() here. Combining where() + orderBy()
// on different fields requires a Firestore composite index; if that index is
// not deployed the query throws and the page appears empty. We sort client-side
// instead so the feature works without any index deployment.
export async function getStarredFiles(userId: string): Promise<FileItem[]> {
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('isStarred', '==', true)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs
        .map((doc) => docToFileItem(doc.id, doc.data()))
        .filter(f => !f.isDeleted)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

// Get recent files
export async function getRecentFiles(userId: string, limit = 20): Promise<FileItem[]> {
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('type', '==', 'file')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs
        .map((doc) => docToFileItem(doc.id, doc.data()))
        .filter(f => !f.isDeleted)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, limit);
}

// Get shared files
export async function getSharedFiles(userId: string): Promise<FileItem[]> {
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('isShared', '==', true)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs
        .map((doc) => docToFileItem(doc.id, doc.data()))
        .filter(f => !f.isDeleted)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}
// Create a new folder
export async function createFolder(data: CreateFolderData): Promise<FileItem> {
    const parentId = normalizeParentId(data.parentId);

    // Build path
    let path = '/' + data.name;
    if (parentId) {
        const parentDoc = await getDoc(doc(db, 'files', parentId));
        if (parentDoc.exists()) {
            path = parentDoc.data().path + '/' + data.name;
        }
    }

    const folderData = {
        name: data.name,
        type: 'folder',
        parentId,
        userId: data.userId,
        isStarred: false,
        isShared: false,
        isDeleted: false,
        path,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };

    const docRef = await addDoc(filesCollection, folderData);

    return {
        id: docRef.id,
        ...folderData,
        type: 'folder' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

// Add a file record (after uploading to Telegram)
export async function addFileRecord(data: UploadFileData): Promise<FileItem> {
    const parentId = normalizeParentId(data.parentId);

    // Build path
    let path = '/' + data.name;
    if (parentId) {
        const parentDoc = await getDoc(doc(db, 'files', parentId));
        if (parentDoc.exists()) {
            path = parentDoc.data().path + '/' + data.name;
        }
    }

    const fileData: Record<string, any> = {
        name: data.name,
        type: 'file',
        mimeType: data.mimeType,
        size: data.size,
        telegramFileId: data.telegramFileId,
        parentId,
        userId: data.userId,
        isStarred: false,
        isShared: false,
        isDeleted: false,
        path,
        storageType: data.storageType || 'managed',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };

    // Store messageId for BYOD files (needed for streaming/download).
    // Test for null/undefined explicitly: a truthiness check silently dropped a
    // messageId of 0, leaving a BYOD file that could never be retrieved.
    if (data.telegramMessageId !== undefined && data.telegramMessageId !== null) {
        fileData.telegramMessageId = data.telegramMessageId;
    }

    // Firestore rejects explicit `undefined`, so only set this when present.
    if (data.thumbnail) {
        fileData.thumbnail = data.thumbnail;
    }

    const docRef = await addDoc(filesCollection, fileData);

    return {
        id: docRef.id,
        name: fileData.name,
        type: 'file' as const,
        mimeType: fileData.mimeType,
        size: fileData.size,
        telegramFileId: fileData.telegramFileId,
        parentId: fileData.parentId,
        userId: fileData.userId,
        isStarred: false,
        isShared: false,
        path: fileData.path,
        thumbnail: fileData.thumbnail,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
}

// Rename file or folder
export async function renameItem(id: string, newName: string): Promise<void> {
    const docRef = doc(db, 'files', id);
    const fileDoc = await getDoc(docRef);

    if (!fileDoc.exists()) {
        throw new Error('File not found');
    }

    const currentPath = fileDoc.data().path;
    const pathParts = currentPath.split('/');
    pathParts[pathParts.length - 1] = newName;
    const newPath = pathParts.join('/');

    await updateDoc(docRef, {
        name: newName,
        path: newPath,
        updatedAt: serverTimestamp(),
    });
}

// Move file or folder
export async function moveItem(id: string, targetFolderId: string | null): Promise<void> {
    // Normalised here rather than trusted from the caller: writing `''` makes
    // the item unreachable from every folder view. See normalizeParentId.
    const parentId = normalizeParentId(targetFolderId);

    if (parentId === id) {
        throw new Error('A folder cannot be moved into itself');
    }

    const docRef = doc(db, 'files', id);
    const fileDoc = await getDoc(docRef);

    if (!fileDoc.exists()) {
        throw new Error('File not found');
    }

    let newPath = '/' + fileDoc.data().name;
    if (parentId) {
        const targetDoc = await getDoc(doc(db, 'files', parentId));
        if (targetDoc.exists()) {
            newPath = targetDoc.data().path + '/' + fileDoc.data().name;
        }
    }

    await updateDoc(docRef, {
        parentId,
        path: newPath,
        updatedAt: serverTimestamp(),
    });
}

// Toggle star status
export async function toggleStar(id: string): Promise<boolean> {
    const docRef = doc(db, 'files', id);
    const fileDoc = await getDoc(docRef);

    if (!fileDoc.exists()) {
        throw new Error('File not found');
    }

    const newStarred = !fileDoc.data().isStarred;

    await updateDoc(docRef, {
        isStarred: newStarred,
        updatedAt: serverTimestamp(),
    });

    return newStarred;
}

// ── Share password hashing ───────────────────────────────────────────────────
//
// Intentionally EMPTY. Share passwords are hashed and verified server-side in
// api/_lib/shareToken.ts (scrypt + per-share salt + timingSafeEqual).
//
// A browser-side verifier was worse than useless here: the verifier and salt
// were written into a Firestore document that anonymous callers could read, so
// the password was grindable offline AND unnecessary to bypass — the same
// document also carried the stream token. Do not reintroduce client-side
// password crypto for shares.

/**
 * Thrown when a file has no public web share path at all, as opposed to a
 * transient failure. Callers surface the message directly instead of offering a
 * retry that can never succeed.
 */
export class ShareNotAvailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ShareNotAvailableError';
    }
}

/**
 * Create a public share link.
 *
 * The link carries an opaque server-encrypted capability; Firestore stores NO
 * secret. Previously this function hashed the password in the browser and wrote
 * the verifier, the salt and a 7-day `streamToken` into the file document — which
 * anonymous callers could read, because Firestore rules cannot restrict which
 * fields a document read returns. Reading the doc yielded the token and made the
 * password gate pointless.
 *
 * Now: the server mints the capability and hashes the password, and the document
 * records only that the file is shared and when the link expires.
 *
 * Throws with actionable copy rather than returning a link that cannot serve the
 * file. Account-mode (BYOD) files have no public web path at all — see
 * ARCHITECTURE-V3 R4 — and are refused here.
 */
export async function shareFile(
    id: string,
    settings: { password?: string; expiresAt?: Date },
    file?: {
        name: string;
        size?: number;
        mimeType?: string;
        storageType?: 'managed' | 'byod';
        telegramFileId?: string;
        telegramMessageId?: number;
    }
): Promise<string> {
    if (!file?.name) {
        throw new Error('Could not prepare this file for sharing. Please reload and try again.');
    }

    const storageType = file.storageType ?? 'managed';

    if (storageType === 'byod') {
        throw new ShareNotAvailableError(
            "Public web links aren't available for this file — share via Telegram instead."
        );
    }

    const MAX_TTL = 7 * 24 * 60 * 60;
    const ttlSeconds = settings.expiresAt
        ? Math.min(Math.max(60, Math.floor((settings.expiresAt.getTime() - Date.now()) / 1000)), MAX_TTL)
        : MAX_TTL;

    const res = await fetch('/api/telegram/share-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getIdTokenHeader()) },
        body: JSON.stringify({
            fileId: id,
            name: file.name,
            size: file.size ?? 0,
            mimeType: file.mimeType ?? 'application/octet-stream',
            storageType,
            telegramFileId: file.telegramFileId,
            telegramMessageId: file.telegramMessageId,
            password: settings.password,
            ttlSeconds,
        }),
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body?.reason === 'account-mode') {
            throw new ShareNotAvailableError(
                "Public web links aren't available for this file — share via Telegram instead."
            );
        }
        throw new Error(body?.error || 'Could not create a share link. Please try again.');
    }

    const { blob, expiresAt } = await res.json();
    if (!blob) {
        throw new Error('Could not create a share link. Please try again.');
    }

    // The capability lives in the URL FRAGMENT. A fragment is never sent to the
    // server, so it stays out of access logs, Referer headers and analytics —
    // which matters because the fragment is the credential.
    const publicShareLink = `${window.location.origin}/s/${id}#${blob}`;

    await updateDoc(doc(db, 'files', id), {
        isShared: true,
        shareSettings: {
            // No password verifier, no salt, no streamToken. Explicit nulls so any
            // legacy document is actively cleared rather than left carrying a
            // readable secret.
            password: null,
            passwordSalt: null,
            passwordVerifier: null,
            streamToken: null,
            tokenExpiresAt: null,
            requiresPassword: Boolean(settings.password),
            expiresAt: settings.expiresAt ? Timestamp.fromDate(settings.expiresAt) : null,
            linkExpiresAt: expiresAt ? Timestamp.fromDate(new Date(expiresAt)) : null,
        },
        updatedAt: serverTimestamp(),
    });

    return publicShareLink;
}

// Unshare file
export async function unshareFile(id: string): Promise<void> {
    await updateDoc(doc(db, 'files', id), {
        isShared: false,
        shareSettings: null,
        updatedAt: serverTimestamp(),
    });
}

// Delete file or folder
export async function deleteItem(id: string): Promise<void> {
    // If it's a folder, also delete children (in production, use cloud function)
    const docRef = doc(db, 'files', id);
    const fileDoc = await getDoc(docRef);

    if (!fileDoc.exists()) {
        throw new Error('File not found');
    }

    if (fileDoc.data().type === 'folder') {
        // Delete all children
        const q = query(filesCollection, where('parentId', '==', id));
        const snapshot = await getDocs(q);

        for (const childDoc of snapshot.docs) {
            await deleteItem(childDoc.id);
        }
    }

    await deleteDoc(docRef);
}

// Move to trash (soft delete)
export async function moveToTrash(id: string): Promise<void> {
    await updateDoc(doc(db, 'files', id), {
        isDeleted: true,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
}

/**
 * SOFT delete, through the single funnel. The Telegram message is KEPT, so this
 * is fully reversible and the undo simply clears the flag.
 *
 * Use this everywhere a user "deletes" something. `deleteItem` below is a hard
 * Firestore removal that bypasses trash and must not be called from UI code.
 */
export function trashItem(id: string) {
    return destructiveFunnel.request({
        kind: 'trash',
        itemIds: [id],
        commit: () => moveToTrash(id),
        rollback: () => restoreFromTrash(id),
    });
}

/**
 * HARD delete, through the single funnel. Irreversible, so the funnel defers the
 * actual work until the undo window elapses — undo cancels it outright rather
 * than trying to reverse it.
 *
 * FOLLOW-UP (recorded in ARCHITECTURE-V3): this removes the index record but not
 * yet the Telegram message, because telegramService.deleteFromTelegram is a
 * hardcoded no-op. Until that lands, "hard delete" reclaims no Telegram storage.
 */
export function purgeItem(id: string) {
    return destructiveFunnel.request({
        kind: 'purge',
        itemIds: [id],
        commit: () => deleteItem(id),
    });
}

// Restore from trash
export async function restoreFromTrash(id: string): Promise<void> {
    await updateDoc(doc(db, 'files', id), {
        isDeleted: false,
        deletedAt: null,
        updatedAt: serverTimestamp(),
    });
}

// Get trash items
export async function getTrashItems(userId: string): Promise<FileItem[]> {
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('isDeleted', '==', true)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs
        .map((doc) => docToFileItem(doc.id, doc.data()))
        .sort((a, b) => {
            const at = a.deletedAt?.getTime() ?? 0;
            const bt = b.deletedAt?.getTime() ?? 0;
            return bt - at;
        });
}

// Real-time listener for files
export function subscribeToFiles(
    userId: string,
    folderId: string | null,
    callback: (files: FileItem[]) => void
): Unsubscribe {
    // NOTE: We do NOT use where('isDeleted', '!=', true) because a '!=' filter
    // excludes any document that is missing the isDeleted field entirely, and it
    // also forces a composite index. We filter deleted items client-side instead.
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('parentId', '==', folderId)
    );

    return onSnapshot(q, (snapshot) => {
        const files = snapshot.docs
            .map((doc) => docToFileItem(doc.id, doc.data()))
            .filter((file) => !file.isDeleted)
            .sort((a, b) => {
                if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
        callback(files);
    });
}

// Get storage stats
export async function getStorageStats(userId: string): Promise<{
    totalFiles: number;
    totalFolders: number;
    totalSize: number;
}> {
    const q = query(filesCollection, where('userId', '==', userId));
    const snapshot = await getDocs(q);

    let totalFiles = 0;
    let totalFolders = 0;
    let totalSize = 0;

    snapshot.docs.forEach((doc) => {
        const data = doc.data();
        if (data.type === 'file') {
            totalFiles++;
            totalSize += data.size || 0;
        } else {
            totalFolders++;
        }
    });

    return { totalFiles, totalFolders, totalSize };
}
// Permanently delete all trashed items for a user
export async function emptyTrash(userId: string): Promise<void> {
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('isDeleted', '==', true)
    );

    const snapshot = await getDocs(q);

    // A WriteBatch CANNOT be reused after commit() — Firestore throws
    // "A write batch can no longer be used after commit()". The previous version
    // committed at 400 and then kept adding to the same object, so emptying a
    // trash with more than 400 items always failed partway through, leaving the
    // trash half-cleared with no error the user could act on.
    const BATCH_LIMIT = 400; // margin under Firestore's 500-op ceiling
    let batch = writeBatch(db);
    let count = 0;

    for (const d of snapshot.docs) {
        batch.delete(d.ref);
        count++;
        if (count >= BATCH_LIMIT) {
            await batch.commit();
            batch = writeBatch(db); // fresh batch, not the committed one
            count = 0;
        }
    }

    if (count > 0) {
        await batch.commit();
    }
}
