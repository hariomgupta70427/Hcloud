import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TelegramClient, sessions, Api } from 'telegram';
const { StringSession } = sessions;

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const API_HASH = process.env.TELEGRAM_API_HASH || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Validate environment variables
    if (!API_ID || !API_HASH) {
        console.error('Missing TELEGRAM_API_ID or TELEGRAM_API_HASH environment variables');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    let client: TelegramClient | null = null;

    try {
        const { phone, code, phoneCodeHash, sessionString, password } = req.body;

        if (!phone || !code || !phoneCodeHash) {
            return res.status(400).json({ error: 'Phone, code, and phoneCodeHash are required' });
        }

        // Normalize phone number
        let normalizedPhone = phone.replace(/[^\d+]/g, '');
        if (!normalizedPhone.startsWith('+')) {
            normalizedPhone = '+' + normalizedPhone;
        }

        console.log('Verifying code for:', normalizedPhone);

        // Create client with the session from send-code (if provided)
        const session = new StringSession(sessionString || '');
        client = new TelegramClient(
            session,
            API_ID,
            API_HASH,
            {
                connectionRetries: 5,
                useWSS: true,
            }
        );

        await client.connect();
        console.log('Client connected');

        try {
            // Sign in with the code or password
            // client.signIn handles 2FA (SRP) automatically if password is provided
            await (client as any).signIn({
                phoneNumber: normalizedPhone,
                phoneCodeHash: phoneCodeHash,
                phoneCode: code,
                password: password || undefined,
            });
        } catch (signInError: any) {
            // Handle 2FA requirement
            if (signInError.message?.includes('SESSION_PASSWORD_NEEDED')) {
                if (!password) {
                    await client.disconnect();
                    return res.status(200).json({
                        success: false,
                        needsPassword: true,
                        message: 'Two-factor authentication is enabled. Please provide your password.',
                    });
                }

                // For now, return an error for 2FA (full implementation requires SRP)
                await client.disconnect();
                return res.status(400).json({
                    error: 'Two-factor authentication is enabled. Please temporarily disable it in Telegram settings, then try again.',
                });
            }

            throw signInError;
        }

        // Get user info
        const me = await client.getMe();
        console.log('User authenticated:', me?.id);

        // Save the final session string for future use
        const finalSessionString = client.session.save() as unknown as string;

        await client.disconnect();

        return res.status(200).json({
            success: true,
            session: finalSessionString,
            user: {
                id: me?.id?.toString() || '',
                firstName: (me as any)?.firstName || '',
                lastName: (me as any)?.lastName || '',
                phone: (me as any)?.phone || normalizedPhone,
                username: (me as any)?.username || '',
            },
        });
    } catch (error: any) {
        console.error('Verify code error:', error);

        // Disconnect client if connected
        if (client) {
            try {
                await client.disconnect();
            } catch (e) { /* ignore */ }
        }

        const errorMessage = error.message || 'Unknown error';

        if (errorMessage.includes('PHONE_CODE_INVALID')) {
            return res.status(400).json({ error: 'Invalid verification code.' });
        }
        if (errorMessage.includes('PHONE_CODE_EXPIRED')) {
            return res.status(400).json({ error: 'Verification code expired.' });
        }
        if (errorMessage.includes('SESSION_PASSWORD_NEEDED')) {
            return res.status(200).json({
                success: false,
                needsPassword: true,
                message: 'Two-step verification enabled.'
            });
        }

        // Return full error details for debugging
        return res.status(500).json({
            error: `Verification failed: ${errorMessage}`,
            stack: error.stack,
            type: error.name
        });
    }
}
