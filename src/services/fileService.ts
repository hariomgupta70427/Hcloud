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
    orderBy,
    serverTimestamp,
    onSnapshot,
    Unsubscribe,
    Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface FileItem {
    id: string;
    name: string;
    type: 'file' | 'folder';
    mimeType?: string;
    size?: number;
    telegramFileId?: string;
    parentId: string | null;
    userId: string;
    isStarred: boolean;
    isShared: boolean;
    isDeleted?: boolean;
    deletedAt?: Date;
    shareSettings?: {
        password?: string;
        expiresAt?: Date;
        link?: string;
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
        where('userId', '==', userId),
        orderBy('type', 'desc'), // Folders first
        orderBy('name', 'asc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => docToFileItem(doc.id, doc.data()));
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
export async function getStarredFiles(userId: string): Promise<FileItem[]> {
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('isStarred', '==', true),
        orderBy('updatedAt', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => docToFileItem(doc.id, doc.data()));
}

// Get recent files
export async function getRecentFiles(userId: string, limit = 20): Promise<FileItem[]> {
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('type', '==', 'file'),
        orderBy('updatedAt', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.slice(0, limit).map((doc) => docToFileItem(doc.id, doc.data()));
}

// Get shared files
export async function getSharedFiles(userId: string): Promise<FileItem[]> {
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('isShared', '==', true),
        orderBy('updatedAt', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => docToFileItem(doc.id, doc.data()));
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
        path,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };

    // Only add thumbnail if it exists (Firestore doesn't allow undefined)
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

// Share file
export async function shareFile(
    id: string,
    settings: { password?: string; expiresAt?: Date }
): Promise<string> {
    const shareLink = `${window.location.origin}/share/${id}`;

    await updateDoc(doc(db, 'files', id), {
        isShared: true,
        shareSettings: {
            ...settings,
            link: shareLink,
            expiresAt: settings.expiresAt ? Timestamp.fromDate(settings.expiresAt) : null,
        },
        updatedAt: serverTimestamp(),
    });

    return shareLink;
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
        where('isDeleted', '==', true),
        orderBy('deletedAt', 'desc')
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => docToFileItem(doc.id, doc.data()));
}

// Real-time listener for files
export function subscribeToFiles(
    userId: string,
    folderId: string | null,
    callback: (files: FileItem[]) => void
): Unsubscribe {
    const q = query(
        filesCollection,
        where('userId', '==', userId),
        where('parentId', '==', folderId),
        where('isDeleted', '!=', true)
    );

    return onSnapshot(q, (snapshot) => {
        const files = snapshot.docs
            .map((doc) => docToFileItem(doc.id, doc.data()))
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
