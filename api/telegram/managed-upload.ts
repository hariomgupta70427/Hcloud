import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Server-side proxy for Telegram Bot API managed-mode uploads.
 * The bot token never leaves the server.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '55mb',
        },
    },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (!BOT_TOKEN || !CHAT_ID) {
        return res.status(500).json({ error: 'Bot token or chat ID not configured on server' });
    }

    try {
        const { fileBase64, fileName, mimeType, method } = req.body;

        if (!fileBase64 || !fileName) {
            return res.status(400).json({ error: 'fileBase64 and fileName are required' });
        }

        const buffer = Buffer.from(fileBase64, 'base64');

        // Build multipart form data manually for Node.js fetch
        const boundary = '----HCloudBoundary' + Date.now();
        const apiMethod = method || 'sendDocument';
        const fieldName = method === 'sendPhoto' ? 'photo' : method === 'sendVideo' ? 'video' : 'document';

        const parts: Buffer[] = [];

        // chat_id field
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}\r\n`
        ));

        // file field
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`
        ));
        parts.push(buffer);
        parts.push(Buffer.from('\r\n'));

        // closing boundary
        parts.push(Buffer.from(`--${boundary}--\r\n`));

        const body = Buffer.concat(parts);

        const telegramRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${apiMethod}`, {
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
            },
            body: body,
        });

        const data = await telegramRes.json() as any;

        if (!data.ok) {
            return res.status(400).json({
                success: false,
                error: data.description || 'Upload failed',
            });
        }

        // Extract file info from response
        const fileData = data.result.document
            || data.result.audio
            || data.result.video
            || data.result.voice
            || data.result.video_note
            || (data.result.photo ? data.result.photo[data.result.photo.length - 1] : null);

        if (!fileData) {
            return res.status(500).json({ success: false, error: 'No file data in Telegram response' });
        }

        return res.status(200).json({
            success: true,
            fileId: fileData.file_id,
            uniqueFileId: fileData.file_unique_id,
            fileName: fileData.file_name || fileName,
            mimeType: fileData.mime_type || mimeType,
            fileSize: fileData.file_size,
            thumbnail: fileData.thumbnail?.file_id,
        });
    } catch (error: any) {
        console.error('[managed-upload] Error:', error);
        return res.status(500).json({ success: false, error: error.message || 'Upload failed' });
    }
}
