import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TelegramClient, Api, sessions, client as clientUtils } from 'telegram';
const { StringSession } = sessions;
const { CustomFile } = clientUtils.uploads;

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const API_HASH = process.env.TELEGRAM_API_HASH || '';

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '2gb',
        },
    },
};

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
        const { session, fileName, fileBuffer, mimeType, fileSize } = req.body;

        if (!session) {
            return res.status(400).json({ error: 'Session is required' });
        }

        if (!fileBuffer) {
            return res.status(400).json({ error: 'File is required' });
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

        // Convert base64 to buffer if needed
        const buffer = Buffer.isBuffer(fileBuffer)
            ? fileBuffer
            : Buffer.from(fileBuffer, 'base64');

        // Create custom file for upload
        const file = new CustomFile(
            fileName || 'file',
            buffer.length,
            '',
            buffer
        );

        // Upload to Saved Messages (chat with self = "me")
        const result = await client.sendFile('me', {
            file: file,
            caption: '',
            forceDocument: true,
            progressCallback: (progress) => {
                console.log(`Upload progress: ${Math.round(progress * 100)}%`);
            },
        });

        // Get the file ID from the result
        const messageId = result.id;
        let fileId = '';

        // Extract file_id based on media type
        if (result.media) {
            const media = result.media as any;
            if (media.document) {
                fileId = media.document.id.toString();
            } else if (media.photo) {
                // For photos, use the largest size
                const sizes = media.photo.sizes;
                if (sizes && sizes.length > 0) {
                    const largest = sizes[sizes.length - 1];
                    fileId = `photo_${media.photo.id}_${largest.type}`;
                }
            }
        }

        await client.disconnect();

        return res.status(200).json({
            success: true,
            messageId,
            fileId,
        });
    } catch (error: any) {
        console.error('Upload error:', error);

        if (error.message?.includes('AUTH_KEY_UNREGISTERED')) {
            return res.status(401).json({ error: 'Session expired. Please re-authenticate.' });
        }

        return res.status(500).json({ error: 'Failed to upload file' });
    }
}
