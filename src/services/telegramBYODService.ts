/**
 * Telegram BYOD (Bring Your Own Device) Service
 * Handles communication with backend API for Telegram MTProto authentication
 * Allows users to use their own Telegram account for file storage
 */

const API_BASE = '/api/telegram';

export interface TelegramAuthResult {
    success: boolean;
    message?: string;
    phoneCodeHash?: string;
    sessionString?: string; // Session string for stateless serverless
    session?: string; // Final session for authenticated user
    needsPassword?: boolean;
    user?: {
        id: string;
        firstName: string;
        lastName: string;
        phone: string;
        username: string;
    };
    error?: string;
}

export interface TelegramUploadResult {
    success: boolean;
    messageId?: number;
    fileId?: string;
    error?: string;
}

/**
 * Send verification code to user's Telegram phone number
 * @param phone Phone number with country code (e.g., +91XXXXXXXXXX)
 */
export async function sendTelegramCode(phone: string): Promise<TelegramAuthResult> {
    try {
        const response = await fetch(`${API_BASE}/send-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ phone }),
        });

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: data.error || 'Failed to send verification code',
            };
        }

        return {
            success: true,
            message: data.message,
            phoneCodeHash: data.phoneCodeHash,
            sessionString: data.sessionString, // Store for verify-code
        };
    } catch (error) {
        console.error('Send code error:', error);
        return {
            success: false,
            error: 'Network error. Please check your connection.',
        };
    }
}

/**
 * Verify the code received via Telegram SMS
 * @param phone Phone number used for authentication
 * @param code Verification code received
 * @param phoneCodeHash Hash received from sendTelegramCode
 * @param sessionString Session string received from sendTelegramCode
 * @param password Optional 2FA password if enabled
 */
export async function verifyTelegramCode(
    phone: string,
    code: string,
    phoneCodeHash: string,
    sessionString?: string,
    password?: string
): Promise<TelegramAuthResult> {
    try {
        const response = await fetch(`${API_BASE}/verify-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ phone, code, phoneCodeHash, sessionString, password }),
        });

        const data = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: data.error || 'Failed to verify code',
            };
        }

        return {
            success: data.success,
            session: data.session,
            sessionString: data.sessionString, // For 2FA continuation
            needsPassword: data.needsPassword,
            message: data.message,
            user: data.user,
        };
    } catch (error) {
        console.error('Verify code error:', error);
        return {
            success: false,
            error: 'Network error. Please check your connection.',
        };
    }
}

// NOTE: uploadFileBYOD() and downloadFileBYOD() used to live here and posted to
// /api/telegram/upload and /api/telegram/download. Both were unauthenticated
// Vercel functions that accepted a raw full-account Telegram session in the
// request body (with a 2GB body limit), and neither was called by any code.
// They have been removed along with those endpoints. BYOD uploads go through
// chunkedUploadService -> the authenticated Render server; BYOD reads go through
// the encrypted stream token.
