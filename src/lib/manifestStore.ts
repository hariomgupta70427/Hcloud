import type { FileManifest } from '@/lib/fileManifest';

/**
 * Persistent store for file manifests.
 *
 * This is what makes the 2.3a gate meaningful. The read-back digest must come from
 * bytes Telegram returned, never from the local `File` — and the way to guarantee
 * that is to reload the page between upload and verify. After a reload the File
 * handle is gone, so the only surviving reference to the content is this record.
 *
 * Separate from the small kv store because manifests are rows to be listed, not
 * single values to be read by key.
 */

const DB_NAME = 'hcloud-manifests';
const STORE = 'files';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function putManifest(m: FileManifest): Promise<void> {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(m);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function listManifests(): Promise<FileManifest[]> {
    const db = await open();
    const rows = await new Promise<FileManifest[]>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve((req.result as FileManifest[]) ?? []);
        req.onerror = () => reject(req.error);
    });
    // Newest first — the file just uploaded is the one being looked at.
    return rows.sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt));
}

export async function getManifest(id: string): Promise<FileManifest | null> {
    const db = await open();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
        req.onsuccess = () => resolve((req.result as FileManifest) ?? null);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteManifest(id: string): Promise<void> {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
