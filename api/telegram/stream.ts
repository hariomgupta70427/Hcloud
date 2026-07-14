import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { getSessionFromToken } from './session-token';

/**
 * Unified streaming proxy for Telegram files.
 *
 *   1. Managed (Bot API):  GET /api/telegram/stream?fileId=<id>
 *   2. BYOD (User API):    GET /api/telegram/stream?token=<encrypted-token>
 *   3. BYOD (legacy):      GET /api/telegram/stream?messageId=<id>&session=<session>
 *
 * IMPORTANT: gramjs ('telegram') is imported LAZILY, only inside the BYOD path.
 * A top-level `import { TelegramClient } from 'telegram'` was crashing the whole
 * serverless function at cold start — which is why even managed requests (that
 * never touch gramjs) returned 500. Keeping the managed path free of gramjs
 * means it is a plain, dependency-light fetch proxy that always works.
 */

// Vercel: allow up to 60s so large media has time to stream before timeout.
export const config = { maxDuration: 60 };

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const API_HASH = process.env.TELEGRAM_API_HASH || '';

// MIME lookup — drives correct in-browser playback/preview when Telegram's
// file endpoint reports a generic application/octet-stream.
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
        // ── BYOD via encrypted token (preferred) ──
        if (token) {
            const tokenData = getSessionFromToken(token);
            if (!tokenData) {
                return res.status(401).json({ error: 'Invalid or expired stream token' });
            }
            return await handleBYOD(req, res, tokenData.messageId, tokenData.session);
        }

        // ── BYOD via raw session (legacy) ──
        if (messageId && session) {
            return await handleBYOD(req, res, parseInt(messageId), session);
        }

        // ── Managed (Bot API) — no gramjs, pure fetch ──
        if (fileId) {
            return await handleManaged(req, res, fileId);
        }

        return res.status(400).json({ error: 'Provide fileId, token, or messageId+session' });
    } catch (error: any) {
        console.error('[Stream] Error:', error);
        // Headers may already be flushed mid-stream; only send JSON if we still can.
        if (!res.headersSent) {
            return res.status(500).json({ error: error?.message || 'Streaming failed' });
        }
        return res.end();
    }
}

// ─── Managed files: proxy the Telegram Bot API download (no gramjs) ───
async function handleManaged(req: VercelRequest, res: VercelResponse, fileId: string) {
    if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot token not configured' });

    // Bot API getFile only returns a file_path for files <= 20 MB; larger files
    // fail here with "file is too big" and cannot be served through the bot.
    const infoRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const info = await infoRes.json() as any;
    if (!info.ok || !info.result?.file_path) {
        const desc: string = info.description || '';
        if (/too big/i.test(desc)) {
            return res.status(413).json({
                error: 'Managed files over 20MB cannot be streamed via Bot API. Re-upload via a connected account (BYOD) to stream large files.',
            });
        }
        return res.status(404).json({ error: desc || 'File not found' });
    }

    const filePath: string = info.result.file_path;
    const fileSize: number | undefined = info.result.file_size;
    const contentType = guessMime(filePath);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;

    return await pipeUrl(req, res, fileUrl, contentType, fileSize);
}

// ─── BYOD files: stream via gramjs + HTTP Range (gramjs loaded lazily) ───
async function handleBYOD(req: VercelRequest, res: VercelResponse, messageId: number, session: string) {
    if (!API_ID || !API_HASH) {
        return res.status(500).json({ error: 'Telegram API credentials not configured' });
    }

    // Lazy import: keeps gramjs out of the module graph for managed requests, so
    // a gramjs load failure can never take down the managed path.
    const { TelegramClient, sessions } = await import('telegram');
    const bigInt = (await import('big-integer')).default;
    const { StringSession } = sessions;

    const client = new TelegramClient(new StringSession(session), API_ID, API_HASH, {
        connectionRetries: 3,
        useWSS: true,
    });

    try {
        await client.connect();

        const messages = await client.getMessages('me', { ids: [messageId] });
        if (!messages?.length || !messages[0]?.media) {
            return res.status(404).json({ error: 'Message/media not found' });
        }

        const message = messages[0];
        const media = message.media as any;

        let fileName = 'file';
        let mimeType = 'application/octet-stream';
        let fileSize: number | undefined;

        if (media.document) {
            for (const attr of media.document.attributes || []) {
                if (attr.className === 'DocumentAttributeFilename') { fileName = attr.fileName; break; }
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
            return res.status(400).json({ error: 'Unsupported media or missing size' });
        }

        // HTTP Range: honour player/resumable Range with 206; otherwise send the
        // whole file with 200. We never truncate.
        const rangeHeader = req.headers.range as string | undefined;
        const hasRange = !!rangeHeader;
        const match = rangeHeader?.match(/bytes=(\d+)-(\d*)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const serveEnd = (match && match[2]) ? parseInt(match[2], 10) : fileSize - 1;
        const contentLength = serveEnd - start + 1;

        // MTProto reads must start on a 4 KB boundary.
        const alignedStart = start - (start % 4096);
        const skipBytes = start - alignedStart;

        res.writeHead(hasRange ? 206 : 200, {
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
            'Content-Length': (hasRange ? contentLength : fileSize).toString(),
            'Cache-Control': 'public, max-age=3600',
            'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
            ...(hasRange ? { 'Content-Range': `bytes ${start}-${serveEnd}/${fileSize}` } : {}),
        });

        let bytesSent = 0;
        let isFirstChunk = true;

        for await (const chunk of client.iterDownload({
            file: mediaToDownload,
            offset: bigInt(alignedStart),
            requestSize: 1048576, // 1 MB (multiple of 4 KB)
        })) {
            let dataChunk = Buffer.from(chunk);

            if (isFirstChunk && skipBytes > 0) dataChunk = dataChunk.subarray(skipBytes);
            isFirstChunk = false;

            const remaining = contentLength - bytesSent;
            if (dataChunk.length > remaining) dataChunk = dataChunk.subarray(0, remaining);

            if (!res.write(dataChunk)) {
                // Respect backpressure so we don't balloon memory on slow clients.
                await new Promise<void>((resolve) => res.once('drain', resolve));
            }
            bytesSent += dataChunk.length;
            if (bytesSent >= contentLength) break;
        }
    } catch (err: any) {
        console.error('[Stream] BYOD error:', err);
        if (!res.headersSent) res.status(500).json({ error: `BYOD stream failed: ${err?.message || err}` });
    } finally {
        await client.disconnect().catch(() => {});
        if (!res.writableEnded) res.end();
    }
}

// ─── Helper: pipe a Telegram file URL to the response (managed path) ───
//
// Telegram's file endpoint honours HTTP Range. We forward the client's Range,
// mirror the upstream status (200/206) and its Range/length headers, then
// stream the body with `pipeline`, which handles backpressure and cleanup and
// ends the response — no manual reader loop, no size cap, no buffering.
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

    const upstreamType = upstream.headers.get('content-type');
    const resolvedType = contentType !== 'application/octet-stream'
        ? contentType
        : (upstreamType || contentType);

    const headers: Record<string, string> = {
        'Content-Type': resolvedType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': 'inline',
    };
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) headers['Content-Range'] = contentRange;
    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers['Content-Length'] = contentLength;
    else if (fileSize && !range) headers['Content-Length'] = fileSize.toString();

    res.writeHead(upstream.status, headers);

    if (!upstream.body) return res.end();

    // Web ReadableStream -> Node Readable -> response, with backpressure handled.
    const nodeStream = Readable.fromWeb(upstream.body as any);
    await pipeline(nodeStream, res);
}
