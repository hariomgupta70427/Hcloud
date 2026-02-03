import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions';

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const API_HASH = process.env.TELEGRAM_API_HASH || '';

// Store pending authentication sessions (in-memory for serverless)
// In production, use Redis or similar for persistence across function invocations
const pendingAuths = new Map<string, { client: TelegramClient; phoneCodeHash: string }>();

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
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Normalize phone number
        const normalizedPhone = phone.replace(/[^\d+]/g, '');

        // Create new Telegram client
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

        // Send authentication code
        const result = await client.invoke(
            new Api.auth.SendCode({
                phoneNumber: normalizedPhone,
                apiId: API_ID,
                apiHash: API_HASH,
                settings: new Api.CodeSettings({
                    allowFlashcall: false,
                    currentNumber: true,
                    allowAppHash: true,
                }),
            })
        );

        // Store the client and phone code hash for verification
        pendingAuths.set(normalizedPhone, {
            client,
            phoneCodeHash: result.phoneCodeHash,
        });

        return res.status(200).json({
            success: true,
            message: 'Verification code sent',
            phoneCodeHash: result.phoneCodeHash, // We'll send this back for the verify step
        });
    } catch (error: any) {
        console.error('Send code error:', error);

        // Handle specific Telegram errors
        if (error.message?.includes('PHONE_NUMBER_INVALID')) {
            return res.status(400).json({ error: 'Invalid phone number format' });
        }
        if (error.message?.includes('PHONE_NUMBER_BANNED')) {
            return res.status(400).json({ error: 'This phone number is banned' });
        }
        if (error.message?.includes('FLOOD_WAIT')) {
            const waitTime = error.message.match(/FLOOD_WAIT_(\d+)/)?.[1] || '60';
            return res.status(429).json({ error: `Too many attempts. Please wait ${waitTime} seconds.` });
        }

        return res.status(500).json({ error: 'Failed to send verification code' });
    }
}
