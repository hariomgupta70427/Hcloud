/**
 * Small local key-value store for non-secret account-mode state.
 *
 * Holds things like the storage channel id — an identifier, not a credential — so
 * a known device skips discovery. Kept in IndexedDB rather than localStorage so it
 * sits alongside the mtcute session and is cleared by the same reset path.
 *
 * NOTE: this is NOT where the Telegram session lives. The session is owned by
 * mtcute's own IdbStorage ('hcloud-mtproto'). PIN-derived encryption of that
 * session is Stage 2.2; this store deliberately holds nothing that would matter if
 * read.
 */

const DB_NAME = 'hcloud-account-state';
const STORE = 'kv';
const VERSION = 1;

function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function kvGet<T>(key: string): Promise<T | null> {
    try {
        const db = await open();
        return await new Promise<T | null>((resolve, reject) => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
            req.onsuccess = () => resolve((req.result as T) ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        // A blocked or unavailable IndexedDB must degrade to "no cached value",
        // never break the flow — discovery still works without it.
        return null;
    }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
    try {
        const db = await open();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        /* best effort */
    }
}

/** Wipe everything. Part of the session-reset and revocation paths. */
export function kvDestroy(): Promise<void> {
    return new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
    });
}
