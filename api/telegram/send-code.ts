import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TelegramClient } from 'telegram';
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

    // Validate environment variables
    if (!API_ID || !API_HASH) {
        console.error('Missing TELEGRAM_API_ID or TELEGRAM_API_HASH environment variables');
        return res.status(500).json({ error: 'Server configuration error' });
    }

    let client: TelegramClient | null = null;

    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Normalize phone number - ensure it has country code
        let normalizedPhone = phone.replace(/[^\d+]/g, '');
        if (!normalizedPhone.startsWith('+')) {
            normalizedPhone = '+' + normalizedPhone;
        }

        console.log('Sending code to:', normalizedPhone);
        console.log('API_ID:', API_ID);
        console.log('API_HASH present:', !!API_HASH);

        // Create new Telegram client
        client = new TelegramClient(
            new StringSession(''),
            API_ID,
            API_HASH,
            {
                connectionRetries: 5,
                useWSS: true,
            }
        );

        await client.connect();
        console.log('Client connected');

        // Use the built-in sendCode method
        const sendCodeResult = await client.sendCode(
            {
                apiId: API_ID,
                apiHash: API_HASH,
            },
            normalizedPhone
        );

        console.log('Code sent successfully, phoneCodeHash:', sendCodeResult.phoneCodeHash);

        // Save the session string so we can resume in verify-code
        const sessionString = client.session.save() as unknown as string;

        // Disconnect the client (it will be recreated in verify-code)
        await client.disconnect();

        return res.status(200).json({
            success: true,
            message: 'Verification code sent to your Telegram app',
            phoneCodeHash: sendCodeResult.phoneCodeHash,
            sessionString: sessionString, // Pass session to maintain state
        });
    } catch (error: any) {
        console.error('Send code error:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);

        // Disconnect client if connected
        if (client) {
            try {
                await client.disconnect();
            } catch (e) {
                // Ignore disconnect errors
            }
        }

        // Handle specific Telegram errors
        if (error.message?.includes('PHONE_NUMBER_INVALID')) {
            return res.status(400).json({ error: 'Invalid phone number format. Please include country code (e.g., +91XXXXXXXXXX)' });
        }
        if (error.message?.includes('PHONE_NUMBER_BANNED')) {
            return res.status(400).json({ error: 'This phone number is banned from Telegram' });
        }
        if (error.message?.includes('PHONE_NUMBER_FLOOD')) {
            return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
        }
        if (error.message?.includes('FLOOD_WAIT')) {
            const waitTime = error.message.match(/FLOOD_WAIT_(\d+)/)?.[1] || '60';
            return res.status(429).json({ error: `Too many attempts. Please wait ${waitTime} seconds.` });
        }
        if (error.message?.includes('API_ID_INVALID')) {
            return res.status(500).json({ error: 'Server configuration error: Invalid API credentials' });
        }

        return res.status(500).json({
            error: 'Failed to send verification code. Please try again.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
}
