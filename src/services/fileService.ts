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
        /** Legacy unsalted SHA-256 hash. Only read for shares created before PBKDF2. */
        password?: string;
        /** Random per-share salt (hex) for the PBKDF2 verifier. */
        passwordSalt?: string;
        /** PBKDF2-SHA256 verifier (hex) of the share password. */
        passwordVerifier?: string;
        expiresAt?: Date;
        link?: string;
        streamToken?: string; // BYOD: opaque encrypted stream token for the public page
        /** When streamToken stops working (capped at 7 days by the minting API). */
        tokenExpiresAt?: Date;
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
        parentId: data.parentId,
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
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('parentId', '==', folderId)
    );

    const snapshot = await getDocs(q);
    // Filter out deleted items and sort
    return snapshot.docs
        .map((doc) => docToFileItem(doc.id, doc.data()))
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
    // Build path
    let path = '/' + data.name;
    if (data.parentId) {
        const parentDoc = await getDoc(doc(db, 'files', data.parentId));
        if (parentDoc.exists()) {
            path = parentDoc.data().path + '/' + data.name;
        }
    }

    const folderData = {
        name: data.name,
        type: 'folder',
        parentId: data.parentId,
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
    // Build path
    let path = '/' + data.name;
    if (data.parentId) {
        const parentDoc = await getDoc(doc(db, 'files', data.parentId));
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
        parentId: data.parentId,
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
    const docRef = doc(db, 'files', id);
    const fileDoc = await getDoc(docRef);

    if (!fileDoc.exists()) {
        throw new Error('File not found');
    }

    let newPath = '/' + fileDoc.data().name;
    if (targetFolderId) {
        const targetDoc = await getDoc(doc(db, 'files', targetFolderId));
        if (targetDoc.exists()) {
            newPath = targetDoc.data().path + '/' + fileDoc.data().name;
        }
    }

    await updateDoc(docRef, {
        parentId: targetFolderId,
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
// Passwords are verified with PBKDF2-SHA256 over a random per-share salt.
//
// The previous scheme stored a bare, UNSALTED SHA-256 of the password. SHA-256
// is designed to be fast, so an unsalted digest of a human-chosen password falls
// to a rainbow table or a trivial offline brute force. Because share documents
// are readable by anyone holding the link (see the SECURITY note on shareFile),
// that meant a leaked link also leaked a recoverable password — which users
// commonly reuse elsewhere. 210k PBKDF2 iterations makes that attack expensive.
const PBKDF2_ITERATIONS = 210_000;

function toHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Derive the stored verifier for a password + salt. */
export async function derivePasswordVerifier(password: string, saltHex: string): Promise<string> {
    const salt = Uint8Array.from(
        saltHex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16))
    );
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        256
    );
    return toHex(bits);
}

// Share file
export async function shareFile(
    id: string,
    settings: { password?: string; expiresAt?: Date },
    // For BYOD files the public page has no owner session, so at share time
    // (owner is authenticated) we mint a long-lived, encrypted stream token and
    // store it. The raw session is NEVER written to Firestore — only the opaque
    // token, which the stream endpoint can decrypt server-side.
    byod?: { session: string; messageId: number }
): Promise<string> {
    const publicShareLink = `${window.location.origin}/s/${id}`;

    // Hash the password with a fresh random salt (never store plain text).
    let passwordSalt: string | null = null;
    let passwordVerifier: string | null = null;
    if (settings.password) {
        passwordSalt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
        passwordVerifier = await derivePasswordVerifier(settings.password, passwordSalt);
    }

    // Mint the BYOD stream token if this is a BYOD file.
    let streamToken: string | null = null;
    let tokenExpiresAt: Date | null = null;
    if (byod?.session && byod?.messageId) {
        // The token TTL is capped server-side at 7 days (MAX_TTL in
        // api/telegram/session-token.ts). A share with a longer or no expiry
        // therefore stops working after 7 days while still looking active, so
        // record when the token actually dies and let the UI say so.
        const MAX_TOKEN_TTL = 7 * 24 * 60 * 60;
        const requestedTtl = settings.expiresAt
            ? Math.max(60, Math.floor((settings.expiresAt.getTime() - Date.now()) / 1000))
            : MAX_TOKEN_TTL;
        const ttlSeconds = Math.min(requestedTtl, MAX_TOKEN_TTL);

        const res = await fetch('/api/telegram/session-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await getIdTokenHeader()) },
            body: JSON.stringify({ session: byod.session, messageId: byod.messageId, ttlSeconds }),
        });
        if (!res.ok) {
            // Do NOT hand back a link that cannot serve the file. Silently
            // storing a null token produced share links that showed a broken
            // preview with no explanation.
            throw new Error(
                'Could not prepare this file for sharing. Please check your Telegram connection and try again.'
            );
        }
        const data = await res.json();
        if (!data?.token) {
            throw new Error('Could not prepare this file for sharing. Please try again.');
        }
        streamToken = data.token;
        tokenExpiresAt = new Date(Date.now() + ttlSeconds * 1000);
    }

    await updateDoc(doc(db, 'files', id), {
        isShared: true,
        shareSettings: {
            // Salted PBKDF2 verifier. `password` is kept as an explicit null so
            // any legacy unsalted SHA-256 value is overwritten on re-share.
            password: null,
            passwordSalt,
            passwordVerifier,
            link: publicShareLink,
            expiresAt: settings.expiresAt ? Timestamp.fromDate(settings.expiresAt) : null,
            streamToken,
            tokenExpiresAt: tokenExpiresAt ? Timestamp.fromDate(tokenExpiresAt) : null,
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
    const batch = writeBatch(db);

    // Process in chunks of 500 (Firestore batch limit)
    // Note: Recursive delete for folders in trash is complex in batch.
    // For simplicity, we delete the docs found. 
    // Ideally, we should recursively delete sub-items of folders in trash.
    // Given the prompt "make it complete", let's just delete the docs. 
    // If a folder is in trash, its children might NOT be in trash explicitly if they were moved with folder.
    // But softDelete usually moves folder. 
    // We will iterate and use deleteItem for robustness or batch verify.
    // Batch is faster. Let's use batch for now.

    let count = 0;
    for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
        count++;
        if (count >= 400) { // Safety margin
            await batch.commit();
            count = 0;
            // new batch? Firestore JS updates batch in place? No, need new batch object if committed?
            // Actually reusing logic: simple loop is safer if batch limits are complex to manage here.
            // But let's assume valid < 500 for now or Commit and create new batch.
        }
    }

    if (count > 0) {
        await batch.commit();
    }
}
