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

/**
 * Upload a file to user's Saved Messages via BYOD
 * @param file File to upload
 * @param session Telegram session string
 * @param onProgress Progress callback (0-100)
 */
export async function uploadFileBYOD(
    file: File,
    session: string,
    onProgress?: (progress: number) => void
): Promise<TelegramUploadResult> {
    try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('session', session);
        formData.append('fileName', file.name);

        // Use XMLHttpRequest for progress tracking
        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable && onProgress) {
                    const progress = Math.round((e.loaded / e.total) * 100);
                    onProgress(progress);
                }
            });

            xhr.addEventListener('load', () => {
                try {
                    const data = JSON.parse(xhr.responseText);
                    if (xhr.status === 200 && data.success) {
                        resolve({
                            success: true,
                            messageId: data.messageId,
                            fileId: data.fileId,
                        });
                    } else {
                        resolve({
                            success: false,
                            error: data.error || 'Upload failed',
                        });
                    }
                } catch {
                    resolve({
                        success: false,
                        error: 'Invalid response from server',
                    });
                }
            });

            xhr.addEventListener('error', () => {
                resolve({
                    success: false,
                    error: 'Network error during upload',
                });
            });

            xhr.open('POST', `${API_BASE}/upload`);
            xhr.send(formData);
        });
    } catch (error) {
        console.error('Upload error:', error);
        return {
            success: false,
            error: 'Failed to upload file',
        };
    }
}

/**
 * Download a file from user's Saved Messages via BYOD
 * @param messageId Message ID of the file
 * @param session Telegram session string
 */
export async function downloadFileBYOD(
    messageId: number,
    session: string
): Promise<Blob | null> {
    try {
        const response = await fetch(`${API_BASE}/download`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ messageId, session }),
        });

        if (!response.ok) {
            return null;
        }

        return await response.blob();
    } catch (error) {
        console.error('Download error:', error);
        return null;
    }
}
