import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TelegramClient, Api, sessions } from 'telegram';
import bigInt from 'big-integer';
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

// ─── BYOD files: stream via gramjs and HTTP Range ───
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

    const messages = await client.getMessages('me', { ids: [messageId] });
    if (!messages?.length || !messages[0]?.media) {
        await client.disconnect();
        return res.status(404).json({ error: 'Message/media not found' });
    }

    const message = messages[0];
    const media = message.media as any;

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

    const contentType = guessMime(fileName) !== 'application/octet-stream' ? guessMime(fileName) : mimeType;
    const mediaToDownload = message.media;
    if (!mediaToDownload || !fileSize) {
        await client.disconnect();
        return res.status(400).json({ error: 'Unsupported media or missing size' });
    }

    // --- HTTP Range Streaming Logic ---
    const rangeHeader = req.headers.range || 'bytes=0-';
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    const start = match ? parseInt(match[1], 10) : 0;
    const requestedEnd = (match && match[2]) ? parseInt(match[2], 10) : fileSize - 1;

    // Vercel limit: max 1MB per request to avoid 10s timeout / 4.5MB payload cap
    const MAX_CHUNK = 1048576; // 1MB
    const serveEnd = Math.min(requestedEnd, start + MAX_CHUNK - 1, fileSize - 1);
    const contentLength = serveEnd - start + 1;

    // MTProto offset must be aligned to 4KB (4096 bytes)
    const alignedStart = start - (start % 4096);
    const skipBytes = start - alignedStart;

    res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${serveEnd}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': contentLength.toString(),
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
    });

    try {
        let bytesSent = 0;
        let isFirstChunk = true;

        for await (const chunk of client.iterDownload({
            file: mediaToDownload,
            offset: bigInt(alignedStart),
            requestSize: 1048576, // 1MB chunks
        })) {
            let dataChunk = Buffer.from(chunk);

            if (isFirstChunk && skipBytes > 0) {
                dataChunk = dataChunk.slice(skipBytes);
                isFirstChunk = false;
            }

            const remaining = contentLength - bytesSent;
            if (dataChunk.length > remaining) {
                dataChunk = dataChunk.slice(0, remaining);
            }

            res.write(dataChunk);
            bytesSent += dataChunk.length;

            if (bytesSent >= contentLength) {
                break;
            }
        }
    } catch (err) {
        console.error('[Stream] Chunk error:', err);
    } finally {
        await client.disconnect();
        res.end();
    }
}

// ─── Helper: pipe a fetch URL to the response with Range support ───
async function pipeUrl(
    req: VercelRequest,
    res: VercelResponse,
    url: string,
    contentType: string,
    fileSize?: number,
) {
    if (!fileSize) {
        // Fallback for unknown size
        const upstream = await fetch(url);
        if (!upstream.ok) return res.status(502).json({ error: `Upstream ${upstream.status}` });
        res.writeHead(200, { 'Content-Type': contentType });
        const arrayBuf = await upstream.arrayBuffer();
        res.end(Buffer.from(arrayBuf));
        return;
    }

    const rangeHeader = req.headers.range || 'bytes=0-';
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    const start = match ? parseInt(match[1], 10) : 0;
    const requestedEnd = (match && match[2]) ? parseInt(match[2], 10) : fileSize - 1;

    // Vercel limit: max 1MB per request to avoid timeout
    const MAX_CHUNK = 1048576; // 1 MB
    const serveEnd = Math.min(requestedEnd, start + MAX_CHUNK - 1, fileSize - 1);
    const contentLength = serveEnd - start + 1;

    const upstream = await fetch(url, { headers: { Range: `bytes=${start}-${serveEnd}` } });
    if (!upstream.ok) return res.status(502).json({ error: `Upstream ${upstream.status}` });

    res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${serveEnd}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': contentLength.toString(),
        'Cache-Control': 'public, max-age=3600',
    });

    // Upstream has sent exactly the requested bytes
    const arrayBuffer = await upstream.arrayBuffer();
    return res.end(Buffer.from(arrayBuffer));
}
