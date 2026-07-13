import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TelegramClient, Api, sessions } from 'telegram';
import bigInt from 'big-integer';
import { getSessionFromToken } from './session-token';
const { StringSession } = sessions;

/**
 * Unified streaming proxy for all Telegram files.
 *
 * Supports three modes:
 *   1. Managed (Bot API):   GET /api/telegram/stream?fileId=<id>
 *   2. BYOD (User API):     GET /api/telegram/stream?token=<short-lived-token>
 *   3. BYOD (legacy):       GET /api/telegram/stream?messageId=<id>&session=<session>
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
    const token = req.query.token as string | undefined;
    const messageId = req.query.messageId as string | undefined;
    const session = req.query.session as string | undefined;

    try {
        // ── BYOD mode via secure token (preferred) ──
        if (token) {
            const tokenData = getSessionFromToken(token);
            if (!tokenData) {
                return res.status(401).json({ error: 'Invalid or expired stream token' });
            }
            return await handleBYOD(req, res, tokenData.messageId, tokenData.session);
        }

        // ── BYOD mode via raw session (legacy, less secure) ──
        if (messageId && session) {
            return await handleBYOD(req, res, parseInt(messageId), session);
        }

        // ── Managed mode (Bot API) ──
        if (fileId) {
            return await handleManaged(req, res, fileId);
        }

        return res.status(400).json({ error: 'Provide fileId, token, or messageId+session' });
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
    // If the client sends a Range header (video/audio players, resumable
    // downloads) we honour it and reply 206. If it doesn't (browser <img>,
    // PDF viewer, plain download) we send the WHOLE file with 200. We never
    // truncate: previously a 1 MB cap corrupted every file over 1 MB.
    const rangeHeader = req.headers.range as string | undefined;
    const hasRange = !!rangeHeader;
    const match = rangeHeader?.match(/bytes=(\d+)-(\d*)/);
    const start = match ? parseInt(match[1], 10) : 0;
    const serveEnd = (match && match[2]) ? parseInt(match[2], 10) : fileSize - 1;
    const contentLength = serveEnd - start + 1;

    // MTProto offset must be aligned to 4KB (4096 bytes)
    const alignedStart = start - (start % 4096);
    const skipBytes = start - alignedStart;

    if (hasRange) {
        res.writeHead(206, {
            'Content-Type': contentType,
            'Content-Range': `bytes ${start}-${serveEnd}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': contentLength.toString(),
            'Cache-Control': 'public, max-age=3600',
            'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
        });
    } else {
        res.writeHead(200, {
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
            'Content-Length': fileSize.toString(),
            'Cache-Control': 'public, max-age=3600',
            'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
        });
    }

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

// ─── Helper: pipe a Telegram file URL to the response ───
//
// Telegram's file endpoint serves files like a static asset and honours HTTP
// Range requests. We simply forward the client's Range (if any) to Telegram,
// mirror the upstream status (200 full / 206 partial) and headers, then stream
// the body chunk-by-chunk. Streaming (not buffering) keeps memory flat and
// avoids Vercel's response-body size cap, so files of any size download intact.
//
// The previous implementation hard-capped every response at 1 MB, which
// silently truncated any file larger than 1 MB — the root cause of images,
// PDFs and documents failing to open.
async function pipeUrl(
    req: VercelRequest,
    res: VercelResponse,
    url: string,
    contentType: string,
    fileSize?: number,
) {
    const range = req.headers.range as string | undefined;

    const upstream = await fetch(url, range ? { headers: { Range: range } } : undefined);
    if (!upstream.ok && upstream.status !== 206) {
        return res.status(502).json({ error: `Upstream ${upstream.status}` });
    }

    const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
    };
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) headers['Content-Range'] = contentRange;
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers['Content-Length'] = contentLength;
    else if (fileSize && !range) headers['Content-Length'] = fileSize.toString();

    res.writeHead(upstream.status, headers);

    const body = upstream.body as any;
    if (!body) return res.end();

    const reader = body.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
        }
    } finally {
        res.end();
    }
}
