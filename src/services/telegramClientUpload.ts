/**
 * Client-Side GramJS Upload Service
 * Uploads files directly from browser to Telegram using MTProto
 * Supports files up to 2GB for regular users, 4GB for premium
 */

import { TelegramClient, sessions } from 'telegram';
const { StringSession } = sessions;

// Get API credentials from environment (exposed via vite.config.ts define)
const API_ID = parseInt(import.meta.env.TELEGRAM_API_ID || '0');
const API_HASH = import.meta.env.TELEGRAM_API_HASH || '';

// File size limits
// Telegram limits: 2GB for free, 4GB for premium
// We set a safe upper limit of 4GB to allow Premium users
export const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024;

export interface ClientUploadResult {
    success: boolean;
    messageId?: number;
    fileId?: string;
    accessHash?: string;
    error?: string;
}

export interface UploadProgressCallback {
    (progress: number): void;
}

// Singleton client instance for session reuse
let cachedClient: TelegramClient | null = null;
let cachedSession: string | null = null;

/**
 * Get or create a TelegramClient instance
 * Includes timeout handling for connection issues
 */
async function getClient(sessionString: string): Promise<TelegramClient> {
    // Reuse existing client if session matches
    if (cachedClient && cachedSession === sessionString) {
        if (cachedClient.connected) {
            console.log('[ClientUpload] Reusing cached connected client');
            return cachedClient;
        }
        // Try to reconnect
        try {
            console.log('[ClientUpload] Reconnecting cached client...');
            await cachedClient.connect();
            return cachedClient;
        } catch (e) {
            console.warn('[ClientUpload] Failed to reconnect cached client:', e);
            cachedClient = null;
        }
    }

    // Create new client
    console.log('[ClientUpload] Creating new TelegramClient...');
    console.log('[ClientUpload] API_ID:', API_ID ? 'SET' : 'MISSING');
    console.log('[ClientUpload] API_HASH:', API_HASH ? 'SET' : 'MISSING');
    console.log('[ClientUpload] Session length:', sessionString?.length || 0);

    if (!sessionString || sessionString.length < 10) {
        throw new Error('Invalid or empty session string');
    }

    const session = new StringSession(sessionString);
    const client = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 10,
        useWSS: true,
        deviceModel: 'HCloud Web',
        systemVersion: 'Browser/Linux',
        appVersion: '1.0.0',
        langCode: 'en',
        timeout: 60000, // 60 second timeout
    });

    // Connect with a manual timeout wrapper
    console.log('[ClientUpload] Connecting to Telegram...');
    const connectPromise = client.connect();
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Connection timeout (60s)')), 60000);
    });

    try {
        await Promise.race([connectPromise, timeoutPromise]);
        console.log('[ClientUpload] Connection established.');
    } catch (connectionError: any) {
        console.error('[ClientUpload] Connection failed:', connectionError.message);
        throw new Error(`Connection failed: ${connectionError.message}`);
    }

    // Verify session is valid with timeout
    console.log('[ClientUpload] Verifying session (getMe)...');
    try {
        const getMePromise = client.getMe();
        const getMeTimeout = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('getMe timeout (30s)')), 30000);
        });
        const me = await Promise.race([getMePromise, getMeTimeout]);

        if (!me) {
            throw new Error('Session invalid - getMe returned null');
        }
        console.log('[ClientUpload] Session verified for user:', (me as any).username || (me as any).firstName || 'Unknown');
    } catch (verifyError: any) {
        console.error('[ClientUpload] Session verification failed:', verifyError.message);
        await client.disconnect().catch(() => { });
        throw new Error(`Session verification failed: ${verifyError.message}`);
    }

    // Cache the client
    cachedClient = client;
    cachedSession = sessionString;

    return client;
}

/**
 * Upload a file to user's Saved Messages using client-side GramJS
 * This bypasses Vercel serverless limits and supports up to 2GB/4GB files
 */
export async function uploadFileClientSide(
    file: File,
    sessionString: string,
    onProgress?: UploadProgressCallback
): Promise<ClientUploadResult> {
    if (!API_ID || !API_HASH) {
        console.error('[ClientUpload] Missing TELEGRAM_API_ID or TELEGRAM_API_HASH');
        return {
            success: false,
            error: 'Telegram API credentials not configured',
        };
    }

    try {
        console.log('[ClientUpload] Starting upload for:', file.name, 'Size:', file.size);

        if (file.size > MAX_FILE_SIZE) {
            return {
                success: false,
                error: `File too large. Maximum size is 4GB.`,
            };
        }

        // Get client
        const client = await getClient(sessionString);
        console.log('[ClientUpload] Connected to Telegram');

        // Upload file to Saved Messages ("me")
        // GramJS sendFile can accept File object directly in browser and uses slicing
        console.log('[ClientUpload] Starting sendFile to Saved Messages...');
        console.log('[ClientUpload] File details:', { name: file.name, size: file.size, type: file.type });

        let lastProgressTime = Date.now();
        const uploadTimeout = 10 * 60 * 1000; // 10 minute timeout for upload

        const sendFilePromise = client.sendFile('me', {
            file: file,
            caption: '',
            forceDocument: true,
            workers: 1, // Single worker is more stable for large files in browser
            progressCallback: (progress: number) => {
                lastProgressTime = Date.now();
                const percent = Math.round(progress * 100);
                console.log(`[ClientUpload] Progress: ${percent}%`);
                onProgress?.(percent);
            },
        });

        // Monitor progress and timeout if stuck
        const uploadTimeoutPromise = new Promise<never>((_, reject) => {
            const checkInterval = setInterval(() => {
                const elapsed = Date.now() - lastProgressTime;
                if (elapsed > uploadTimeout) {
                    clearInterval(checkInterval);
                    reject(new Error('Upload timeout - no progress for 10 minutes'));
                }
            }, 30000);

            // Clear interval when upload completes
            sendFilePromise.finally(() => clearInterval(checkInterval));
        });

        const result = await Promise.race([sendFilePromise, uploadTimeoutPromise]);

        console.log('[ClientUpload] Upload complete, messageId:', result.id);

        // Extract file information
        let fileId = '';
        let accessHash = '';

        if (result.media) {
            const media = result.media as any;
            if (media.document) {
                fileId = media.document.id.toString();
                accessHash = media.document.accessHash?.toString() || '';
            } else if (media.photo) {
                fileId = `photo_${media.photo.id}`;
                accessHash = media.photo.accessHash?.toString() || '';
            }
        }

        return {
            success: true,
            messageId: result.id,
            fileId,
            accessHash,
        };
    } catch (error: any) {
        console.error('[ClientUpload] Error:', error);

        // Handle specific errors
        if (error.message?.includes('AUTH_KEY_UNREGISTERED') ||
            error.message?.includes('SESSION_REVOKED')) {
            // Clear cached client on auth errors
            cachedClient = null;
            cachedSession = null;
            return {
                success: false,
                error: 'Session expired. Please re-authenticate.',
            };
        }

        if (error.message?.includes('FILE_PARTS_INVALID')) {
            return {
                success: false,
                error: 'File upload failed (parts invalid). Please try again.',
            };
        }

        return {
            success: false,
            error: error.message || 'Upload failed',
        };
    }
}

/**
 * Disconnect the cached client (call on logout)
 */
export async function disconnectClient(): Promise<void> {
    if (cachedClient) {
        try {
            await cachedClient.disconnect();
        } catch (e) {
            console.warn('[ClientUpload] Error disconnecting:', e);
        }
        cachedClient = null;
        cachedSession = null;
    }
}

/**
 * Check if client-side upload is available
 */
export function isClientUploadAvailable(): boolean {
    return !!(API_ID && API_HASH);
}
