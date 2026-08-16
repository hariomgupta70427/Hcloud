import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { requireAuth } from '../_lib/firebaseAuth';
import { isAllowedOrigin } from '../_lib/cors';

/**
 * Server-side proxy for Telegram Bot API managed-mode uploads.
 * The bot token never leaves the server.
 *
 * SECURITY: this endpoint spends the OPERATOR'S bot token and storage quota, so
 * it requires a verified Firebase ID token and only accepts calls from HCloud's
 * own origins. It was previously wide open, which made it an anonymous
 * file-drop: anyone could push arbitrary content into the operator's Telegram
 * chat, with no rate limit and no attribution.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

// Base64 inflates by ~33%, so this 55mb body limit corresponds to roughly 40MB
// of original file bytes. The client enforces the same 40MB ceiling
// (MAX_FILE_SIZE in src/services/telegramService.ts) — keep the two in sync.
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '55mb',
        },
    },
};

const MAX_DECODED_BYTES = 41 * 1024 * 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const origin = req.headers.origin as string | undefined;
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    if (!BOT_TOKEN || !CHAT_ID) {
        return res.status(500).json({ error: 'Bot token or chat ID not configured on server' });
    }

    // AUTHENTICATION REQUIRED — see the security note above.
    const user = await requireAuth(req, res);
    if (!user) return;

    try {
        const { fileBase64, fileName, mimeType } = req.body ?? {};

        if (typeof fileBase64 !== 'string' || !fileBase64) {
            return res.status(400).json({ error: 'fileBase64 is required' });
        }
        if (typeof fileName !== 'string' || !fileName.trim()) {
            return res.status(400).json({ error: 'fileName is required' });
        }

        const buffer = Buffer.from(fileBase64, 'base64');
        if (buffer.length === 0) {
            return res.status(400).json({ error: 'fileBase64 did not decode to any data' });
        }
        if (buffer.length > MAX_DECODED_BYTES) {
            return res.status(413).json({
                error: 'File too large for managed storage. Connect your own Telegram account for larger files.',
            });
        }

        // ALWAYS sendDocument. sendPhoto/sendVideo make Telegram re-encode the
        // file, and silently returning a recompressed copy of what the user
        // stored is data loss for a cloud drive. The caller no longer selects
        // the method, so it cannot be talked into a lossy path either.
        const apiMethod = 'sendDocument';
        const fieldName = 'document';

        // Strip anything that could break out of the multipart header. A
        // filename containing a quote, CR or LF could otherwise inject
        // additional headers or form fields into the request we send Telegram.
        const safeFileName = fileName
            .replace(/[\r\n"\\]/g, '_')
            .replace(/[\x00-\x1f\x7f]/g, '')
            .slice(0, 250) || 'file';
        const safeMime = typeof mimeType === 'string'
            ? (mimeType.replace(/[^\w.+/-]/g, '').slice(0, 100) || 'application/octet-stream')
            : 'application/octet-stream';

        // Build multipart form data manually for Node.js fetch
        const boundary = '----HCloudBoundary' + crypto.randomUUID().replace(/-/g, '');

        const parts: Buffer[] = [];

        // chat_id field
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${CHAT_ID}\r\n`
        ));

        // file field
        parts.push(Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${safeFileName}"\r\nContent-Type: ${safeMime}\r\n\r\n`
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
            mimeType: fileData.mime_type || safeMime,
            fileSize: fileData.file_size,
            thumbnail: fileData.thumbnail?.file_id,
        });
    } catch (error: any) {
        console.error('[managed-upload] Error:', error);
        // Do not leak internal error text to the client.
        return res.status(500).json({ success: false, error: 'Upload failed' });
    }
}
