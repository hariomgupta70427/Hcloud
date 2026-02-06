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
export const MAX_REGULAR_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2GB for regular users
export const MAX_PREMIUM_FILE_SIZE = 4 * 1024 * 1024 * 1024; // 4GB for premium users

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
 */
async function getClient(sessionString: string): Promise<TelegramClient> {
    // Reuse existing client if session matches
    if (cachedClient && cachedSession === sessionString) {
        if (cachedClient.connected) {
            return cachedClient;
        }
        // Try to reconnect
        try {
            await cachedClient.connect();
            return cachedClient;
        } catch {
            cachedClient = null;
        }
    }

    // Create new client
    const session = new StringSession(sessionString);
    const client = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true,
        deviceModel: 'HCloud Web',
        systemVersion: 'Browser',
        appVersion: '1.0.0',
        langCode: 'en',
    });

    await client.connect();

    // Verify session is valid
    const me = await client.getMe();
    if (!me) {
        throw new Error('Invalid session');
    }

    // Cache the client
    cachedClient = client;
    cachedSession = sessionString;

    return client;
}

/**
 * Upload a file to user's Saved Messages using client-side GramJS
 * This bypasses Vercel serverless limits and supports up to 2GB files
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

        // Check file size (2GB limit for regular users)
        if (file.size > MAX_REGULAR_FILE_SIZE) {
            return {
                success: false,
                error: `File too large. Maximum size is 2GB.`,
            };
        }

        // Get client
        const client = await getClient(sessionString);
        console.log('[ClientUpload] Connected to Telegram');

        // Upload file to Saved Messages ("me")
        // GramJS sendFile can accept File object directly in browser
        console.log('[ClientUpload] Uploading to Saved Messages...');

        const result = await client.sendFile('me', {
            file: file,
            caption: '',
            forceDocument: true,
            workers: 1, // Use single worker for stability
            progressCallback: (progress: number) => {
                const percent = Math.round(progress * 100);
                console.log(`[ClientUpload] Progress: ${percent}%`);
                onProgress?.(percent);
            },
        });

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
                error: 'File upload failed. Please try again.',
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
