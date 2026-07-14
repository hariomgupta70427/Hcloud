import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

/**
 * Unified streaming proxy for Telegram files — Vercel side.
 *
 *   1. Managed (Bot API):  GET /api/telegram/stream?fileId=<id>
 *   2. BYOD (User API):    GET /api/telegram/stream?token=<encrypted-token>
 *
 * ── WHY THERE IS NO gramjs HERE ──────────────────────────────────────────────
 * gramjs ('telegram') is a heavy MTProto client with native crypto and a huge
 * dependency graph. Bundling it into a Vercel serverless function crashes the
 * function at COLD START (FUNCTION_INVOCATION_FAILED) — even a bare request that
 * touches none of its code 500s, because the crash happens at module load.
 * `await import('telegram')` does NOT help: Vercel's bundler still traces and
 * includes it. This is exactly why the app runs a dedicated, always-on Render
 * server for all gramjs I/O.
 *
 * So this function is deliberately gramjs-free:
 *   • Managed files  -> streamed here via plain fetch (dependency-light, robust).
 *   • BYOD files     -> 302-redirected to the Render server's token-stream
 *                       endpoint, which owns gramjs. The browser follows the
 *                       redirect transparently for <img>/<video>/<audio>/fetch,
 *                       and the opaque token is the capability (no session leak).
 */

export const config = { maxDuration: 60 };

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// Render server that owns gramjs (uploads + BYOD streaming/downloads).
const RENDER_URL = (process.env.UPLOAD_SERVER_URL || 'https://hcloud.onrender.com').replace(/\/$/, '');

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
        // ── BYOD -> hand off to the Render server (it owns gramjs) ──
        if (token) {
            // Opaque encrypted token carries session+messageId. Safe to put in a
            // redirect URL; Render decrypts it. Preserves the Range header.
            res.setHeader('Cache-Control', 'no-store');
            return res.redirect(302, `${RENDER_URL}/token-stream?token=${encodeURIComponent(token)}`);
        }
        if (messageId && session) {
            // Legacy raw-session path (kept for backwards compatibility).
            res.setHeader('Cache-Control', 'no-store');
            return res.redirect(
                302,
                `${RENDER_URL}/stream?messageId=${encodeURIComponent(messageId)}&session=${encodeURIComponent(session)}`,
            );
        }

        // ── Managed (Bot API) — pure fetch, no gramjs ──
        if (fileId) {
            return await handleManaged(req, res, fileId);
        }

        return res.status(400).json({ error: 'Provide fileId or token' });
    } catch (error: any) {
        console.error('[Stream] Error:', error);
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

// ─── Helper: pipe a Telegram file URL to the response (managed path) ───
//
// Telegram's file endpoint honours HTTP Range. We forward the client's Range,
// mirror the upstream status (200 full / 206 partial) and its length/range
// headers, then stream the body chunk-by-chunk. Streaming (not buffering) keeps
// memory flat and avoids Vercel's response-body size cap.
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
