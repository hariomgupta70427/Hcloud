import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TelegramClient, Api, sessions } from 'telegram';
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

    try {
        const { session, messageId } = req.body;

        if (!session) {
            return res.status(400).json({ error: 'Session is required' });
        }

        if (!messageId) {
            return res.status(400).json({ error: 'Message ID is required' });
        }

        // Create client with user's session
        const client = new TelegramClient(
            new StringSession(session),
            API_ID,
            API_HASH,
            {
                connectionRetries: 5,
                useWSS: true,
            }
        );

        await client.connect();

        // Check if session is valid
        const me = await client.getMe();
        if (!me) {
            return res.status(401).json({ error: 'Invalid session' });
        }

        // Get the message from Saved Messages
        const messages = await client.getMessages('me', {
            ids: [parseInt(messageId)],
        });

        if (!messages || messages.length === 0 || !messages[0]) {
            await client.disconnect();
            return res.status(404).json({ error: 'Message not found' });
        }

        const message = messages[0];

        // Download the file
        if (!message.media) {
            await client.disconnect();
            return res.status(400).json({ error: 'Message does not contain media' });
        }

        const buffer = await client.downloadMedia(message.media, {
            progressCallback: (progress) => {
                console.log(`Download progress: ${Math.round(Number(progress) * 100)}%`);
            },
        });

        await client.disconnect();

        if (!buffer) {
            return res.status(500).json({ error: 'Failed to download file' });
        }

        // Return the file as base64
        const base64 = Buffer.from(buffer).toString('base64');

        // Try to get file name and mime type
        let fileName = 'file';
        let mimeType = 'application/octet-stream';

        const media = message.media as any;
        if (media.document) {
            const attributes = media.document.attributes || [];
            for (const attr of attributes) {
                if (attr.className === 'DocumentAttributeFilename') {
                    fileName = attr.fileName;
                    break;
                }
            }
            mimeType = media.document.mimeType || mimeType;
        }

        return res.status(200).json({
            success: true,
            data: base64,
            fileName,
            mimeType,
        });
    } catch (error: any) {
        console.error('Download error:', error);

        if (error.message?.includes('AUTH_KEY_UNREGISTERED')) {
            return res.status(401).json({ error: 'Session expired. Please re-authenticate.' });
        }

        return res.status(500).json({ error: 'Failed to download file' });
    }
}
