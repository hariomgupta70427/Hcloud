import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';

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

    try {
        const { phone, code, phoneCodeHash, password } = req.body;

        if (!phone || !code || !phoneCodeHash) {
            return res.status(400).json({ error: 'Phone, code, and phoneCodeHash are required' });
        }

        const normalizedPhone = phone.replace(/[^\d+]/g, '');

        // Create a new client for verification
        const client = new TelegramClient(
            new StringSession(''),
            API_ID,
            API_HASH,
            {
                connectionRetries: 5,
                useWSS: true,
            }
        );

        await client.connect();

        try {
            // Try to sign in with the code
            const signInResult = await client.invoke(
                new Api.auth.SignIn({
                    phoneNumber: normalizedPhone,
                    phoneCodeHash: phoneCodeHash,
                    phoneCode: code,
                })
            );

            // Get user info
            const me = await client.getMe();

            // Save the session string for future use
            const sessionString = client.session.save() as unknown as string;

            return res.status(200).json({
                success: true,
                session: sessionString,
                user: {
                    id: me?.id?.toString(),
                    firstName: (me as any)?.firstName || '',
                    lastName: (me as any)?.lastName || '',
                    phone: (me as any)?.phone || normalizedPhone,
                    username: (me as any)?.username || '',
                },
            });
        } catch (signInError: any) {
            // Handle 2FA requirement
            if (signInError.message?.includes('SESSION_PASSWORD_NEEDED')) {
                if (!password) {
                    return res.status(200).json({
                        success: false,
                        needsPassword: true,
                        message: 'Two-factor authentication is enabled. Please provide your password.',
                    });
                }

                // Try signing in with password
                const passwordResult = await client.invoke(
                    new Api.account.GetPassword()
                );

                // Note: Full 2FA implementation requires SRP (Secure Remote Password)
                // For now, return an error requesting the user to disable 2FA temporarily
                return res.status(400).json({
                    error: 'Two-factor authentication is enabled. Please temporarily disable it in Telegram settings to complete setup.',
                });
            }

            throw signInError;
        }
    } catch (error: any) {
        console.error('Verify code error:', error);

        if (error.message?.includes('PHONE_CODE_INVALID')) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }
        if (error.message?.includes('PHONE_CODE_EXPIRED')) {
            return res.status(400).json({ error: 'Verification code expired. Please request a new one.' });
        }
        if (error.message?.includes('PHONE_NUMBER_UNOCCUPIED')) {
            return res.status(400).json({ error: 'This phone number is not registered on Telegram' });
        }

        return res.status(500).json({ error: 'Failed to verify code' });
    }
}
