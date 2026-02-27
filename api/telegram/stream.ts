import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TelegramClient, Api, sessions } from 'telegram';
const { StringSession } = sessions;

/**
 * Unified streaming proxy for all Telegram files.
 *
 * Supports two modes:
 *   1. Managed (Bot API):   GET /api/telegram/stream?fileId=<id>
 *   2. BYOD (User API):     GET /api/telegram/stream?messageId=<id>&session=<session>
 *
 * Pipes binary data directly to the client with proper Content-Type and
 * Cache-Control headers so <audio>/<video> elements play instantly.
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const API_HASH = process.env.TELEGRAM_API_HASH || '';

// MIME lookup
const MIME: Record<string, string> = {
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
    wav: 'audio/wav', flac: 'audio/flac', opus: 'audio/opus',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
};

function guessMime(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || '';
    return MIME[ext] || 'application/octet-stream';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const fileId = req.query.fileId as string | undefined;
    const messageId = req.query.messageId as string | undefined;
    const session = req.query.session as string | undefined;

    try {
        // ── BYOD mode (User API via gramjs) ──
        if (messageId && session) {
            return await handleBYOD(req, res, parseInt(messageId), session);
        }

        // ── Managed mode (Bot API) ──
        if (fileId) {
            return await handleManaged(req, res, fileId);
        }

        return res.status(400).json({ error: 'Provide either fileId or messageId+session' });
    } catch (error: any) {
        console.error('[Stream] Error:', error);
        return res.status(500).json({ error: 'Streaming failed' });
    }
}

// ─── Managed files: proxy Telegram Bot API download ───
async function handleManaged(req: VercelRequest, res: VercelResponse, fileId: string) {
    if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot token not configured' });

    // 1. Resolve file_path
    const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const info = await infoRes.json() as any;
    if (!info.ok || !info.result?.file_path) {
        return res.status(404).json({ error: info.description || 'File not found' });
    }

    const filePath: string = info.result.file_path;
    const fileSize: number | undefined = info.result.file_size;
    const contentType = guessMime(filePath);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    // 2. Pipe response
    return await pipeUrl(req, res, fileUrl, contentType, fileSize);
}

// ─── BYOD files: download via gramjs and pipe ───
async function handleBYOD(req: VercelRequest, res: VercelResponse, messageId: number, session: string) {
    const client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
        connectionRetries: 3,
        useWSS: true,
    });

    await client.connect();

    const me = await client.getMe();
    if (!me) {
        await client.disconnect();
        return res.status(401).json({ error: 'Invalid session' });
    }

    // Get the message from Saved Messages
    const messages = await client.getMessages('me', { ids: [messageId] });
    if (!messages?.length || !messages[0]?.media) {
        await client.disconnect();
        return res.status(404).json({ error: 'Message/media not found' });
    }

    const message = messages[0];
    const media = message.media as any;

    // Detect file info
    let fileName = 'file';
    let mimeType = 'application/octet-stream';
    let fileSize: number | undefined;

    if (media.document) {
        const attrs = media.document.attributes || [];
        for (const attr of attrs) {
            if (attr.className === 'DocumentAttributeFilename') {
                fileName = attr.fileName;
                break;
            }
        }
        mimeType = media.document.mimeType || mimeType;
        fileSize = media.document.size ? Number(media.document.size) : undefined;
    } else if (media.photo) {
        mimeType = 'image/jpeg';
        fileName = 'photo.jpg';
    }

    // Determine content type from filename or document mime
    const contentType = guessMime(fileName) !== 'application/octet-stream'
        ? guessMime(fileName)
        : mimeType;

    // Download the full file from Telegram via gramjs
    // Note: gramjs downloadMedia doesn't support Range requests natively,
    // so we download the complete buffer and serve it.
    const mediaToDownload = message.media;
    if (!mediaToDownload) {
        return res.status(400).json({ error: 'No media in message' });
    }
    const buffer = await client.downloadMedia(mediaToDownload, {});
    await client.disconnect();

    if (!buffer) {
        return res.status(500).json({ error: 'Failed to download from Telegram' });
    }

    const data = Buffer.from(buffer);

    // Serve with proper headers so browser can play immediately
    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': data.length.toString(),
        'Accept-Ranges': 'none',
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
    });
    res.end(data);
}

// ─── Helper: pipe a fetch URL to the response with Range support ───
async function pipeUrl(
    req: VercelRequest,
    res: VercelResponse,
    url: string,
    contentType: string,
    fileSize?: number,
) {
    const rangeHeader = req.headers.range;

    if (rangeHeader && fileSize) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            const upstream = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });

            res.writeHead(206, {
                'Content-Type': contentType,
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize.toString(),
                'Cache-Control': 'public, max-age=3600',
            });

            const reader = upstream.body?.getReader();
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(Buffer.from(value));
                }
            }
            return res.end();
        }
    }

    // Full file
    const upstream = await fetch(url);
    if (!upstream.ok) return res.status(502).json({ error: `Upstream ${upstream.status}` });

    res.writeHead(200, {
        'Content-Type': contentType,
        'Accept-Ranges': fileSize ? 'bytes' : 'none',
        ...(fileSize ? { 'Content-Length': fileSize.toString() } : {}),
        'Cache-Control': 'public, max-age=3600',
    });

    const reader = upstream.body?.getReader();
    if (reader) {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
        }
    }
    return res.end();
}
