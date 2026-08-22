/**
 * HCloud Relay Server
 *
 * Speaks Telegram MTProto (gramjs) on behalf of BYOD users:
 *   • chunked uploads      -> /upload/chunk + /upload/finalize
 *   • progressive streaming -> /token-stream  (HTTP Range, any content type)
 *   • whole-file download   -> /download
 *
 * WHY A DEDICATED SERVER EXISTS
 * gramjs cannot run on Vercel (bundling it crashes the function at cold start)
 * and cannot run in the browser (many ISPs block direct MTProto, and it would
 * require shipping the Telegram api_id/api_hash to the client). So MTProto lives
 * here and nowhere else.
 *
 * HOST-AGNOSTIC BY DESIGN
 * This server makes no assumptions about its hosting platform. It reads PORT and
 * HOST from the environment, shuts down cleanly on SIGTERM, and holds no
 * platform-specific code. It is deployed on an Oracle Cloud always-free VM
 * behind Caddy (see deploy/oracle/), but runs unchanged anywhere that can run
 * Node.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { TelegramClient, sessions, Api, utils } from 'telegram';
import { iterDownload } from 'telegram/client/downloads';
import bigInt from 'big-integer';
const { StringSession } = sessions;

// Environment variables
const PORT = parseInt(process.env.PORT || '3001', 10);
// Bind to loopback by default: in the supported deployment Caddy terminates TLS
// and proxies to us, so the Node process must not be reachable directly from the
// internet. Set HOST=0.0.0.0 when running in a container with its own network.
const HOST = process.env.HOST || '127.0.0.1';
const TELEGRAM_API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const TELEGRAM_API_HASH = process.env.TELEGRAM_API_HASH || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';

// Where in-progress upload chunks are staged.
//
// Configurable because the deployment target matters: on an ephemeral platform
// /tmp is wiped between deploys, but on a long-lived VM it persists — so a crash
// mid-upload would leave chunk directories behind forever. TEMP_ROOT lets the
// operator point this at a dedicated volume, and cleanStaleTempDirs() below
// clears orphans on every boot.
const TEMP_ROOT = process.env.TEMP_ROOT || path.join(os.tmpdir(), 'hcloud');

/**
 * Remove chunk directories left behind by a previous process.
 *
 * Only runs at startup, when by definition no upload is in flight: any directory
 * present now belongs to a session this process knows nothing about and can
 * never finalize.
 */
function cleanStaleTempDirs(): void {
    try {
        fs.mkdirSync(TEMP_ROOT, { recursive: true });
        const entries = fs.readdirSync(TEMP_ROOT);
        let removed = 0;
        for (const entry of entries) {
            if (!entry.startsWith('hcloud_')) continue;
            try {
                fs.rmSync(path.join(TEMP_ROOT, entry), { recursive: true, force: true });
                removed++;
            } catch { /* ignore individual failures */ }
        }
        if (removed > 0) console.log(`🧹 Removed ${removed} orphaned upload director${removed === 1 ? 'y' : 'ies'}`);
    } catch (err) {
        console.warn('⚠️  Could not prepare temp directory:', err);
    }
}

// ============================================
// STREAM TOKEN DECRYPTION
// Decrypts the opaque AES-256-GCM token minted by the Vercel
// /api/telegram/session-token endpoint. MUST use the exact same key
// derivation and layout as api/telegram/session-token.ts:
//   key = sha256(STREAM_TOKEN_SECRET || TELEGRAM_API_HASH)
//   token = base64url( iv(12) | tag(16) | ciphertext )  where ciphertext
//           is AES-256-GCM of JSON { session, messageId, exp }.
// Because the token carries everything needed, this route needs NO Firebase
// auth — possession of the (encrypted, signed) token IS the capability.
// ============================================
const STREAM_TOKEN_SECRET = process.env.STREAM_TOKEN_SECRET || TELEGRAM_API_HASH || '';
const STREAM_TOKEN_KEY = crypto.createHash('sha256').update(STREAM_TOKEN_SECRET).digest();

function decryptStreamToken(token: string): { session: string; messageId: number } | null {
    if (!STREAM_TOKEN_SECRET || !token) return null;
    try {
        const raw = Buffer.from(token, 'base64url');
        if (raw.length < 28) return null; // 12 iv + 16 tag minimum
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const ciphertext = raw.subarray(28);

        const decipher = crypto.createDecipheriv('aes-256-gcm', STREAM_TOKEN_KEY, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

        const payload = JSON.parse(decrypted) as { session: string; messageId: number; exp: number };
        if (!payload.session || !payload.messageId) return null;
        if (payload.exp && payload.exp * 1000 < Date.now()) return null;

        return { session: payload.session, messageId: payload.messageId };
    } catch {
        return null; // bad key, tampered ciphertext, or malformed token
    }
}

// Validate required env vars
if (!TELEGRAM_API_ID || !TELEGRAM_API_HASH) {
    console.error('❌ Missing TELEGRAM_API_ID or TELEGRAM_API_HASH environment variables');
    process.exit(1);
}

// Create Express app
const app = express();

// Caddy terminates TLS and forwards X-Forwarded-For / X-Forwarded-Proto.
// Trusting exactly one hop makes req.ip the real client address (needed for
// rate limiting) without letting a client spoof it by sending its own header.
app.set('trust proxy', 1);
// Don't advertise the framework.
app.disable('x-powered-by');

// CORS configuration
const allowedOrigins = CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
    origin: (origin: string | undefined, callback: any) => {
        // No Origin header: a same-origin navigation, a media element fetch, or a
        // non-browser client. These are not CORS requests, so allow them — the
        // encrypted token, not the origin, is the capability for /token-stream.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            return callback(null, true);
        }
        console.warn(`Blocked CORS request from: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
}));

// Parse JSON with a limit sized for one base64 chunk (8MB raw -> ~10.7MB).
app.use(express.json({ limit: '12mb' }));

// ============================================
// RATE LIMITING
// ============================================
// This server is reachable from the public internet, so the expensive routes
// (each one opens a Telegram connection and moves real bytes) need a ceiling.
// Implemented in-process with no dependency: a fixed-window counter per client
// IP, plus a cap on how many streams one IP may hold open at once so a single
// client cannot exhaust the connection pool.
//
// Defaults are deliberately generous because media players issue many Range
// requests for a single video. Tune with RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS,
// or disable entirely with RATE_LIMIT_DISABLED=true.
const RATE_LIMIT_DISABLED = process.env.RATE_LIMIT_DISABLED === 'true';
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || '600', 10);
const MAX_CONCURRENT_STREAMS_PER_IP = parseInt(process.env.MAX_CONCURRENT_STREAMS_PER_IP || '8', 10);

interface RateWindow { count: number; resetAt: number }
const rateWindows = new Map<string, RateWindow>();
const activeStreamsPerIp = new Map<string, number>();

// Drop expired windows so the map cannot grow without bound.
setInterval(() => {
    const now = Date.now();
    for (const [ip, w] of rateWindows.entries()) {
        if (w.resetAt <= now) rateWindows.delete(ip);
    }
}, 60_000).unref();

function clientIp(req: Request): string {
    return req.ip || req.socket.remoteAddress || 'unknown';
}

function rateLimit(req: Request, res: Response, next: NextFunction) {
    if (RATE_LIMIT_DISABLED) return next();

    const ip = clientIp(req);
    const now = Date.now();
    const win = rateWindows.get(ip);

    if (!win || win.resetAt <= now) {
        rateWindows.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return next();
    }

    win.count++;
    if (win.count > RATE_LIMIT_MAX) {
        const retryAfter = Math.max(1, Math.ceil((win.resetAt - now) / 1000));
        res.setHeader('Retry-After', retryAfter.toString());
        return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    return next();
}

/**
 * Track concurrent streams per IP. Returns a release function, or null when the
 * caller is already at its limit.
 */
function acquireStreamSlot(req: Request): (() => void) | null {
    if (RATE_LIMIT_DISABLED) return () => { };

    const ip = clientIp(req);
    const current = activeStreamsPerIp.get(ip) || 0;
    if (current >= MAX_CONCURRENT_STREAMS_PER_IP) return null;

    activeStreamsPerIp.set(ip, current + 1);
    let released = false;
    return () => {
        if (released) return; // idempotent: 'close' can fire more than once
        released = true;
        const n = (activeStreamsPerIp.get(ip) || 1) - 1;
        if (n <= 0) activeStreamsPerIp.delete(ip);
        else activeStreamsPerIp.set(ip, n);
    };
}

// ============================================
// FIREBASE AUTH MIDDLEWARE
// Verifies Firebase ID tokens without firebase-admin SDK
// ============================================

interface DecodedToken {
    uid: string;
    email?: string;
}

// Cache for Google's public signing certificates (refreshed hourly)
let cachedKeys: Record<string, string> = {};
let keysLastFetched = 0;

async function getGooglePublicKeys(): Promise<Record<string, string>> {
    const now = Date.now();
    if (Object.keys(cachedKeys).length > 0 && now - keysLastFetched < 3600000) {
        return cachedKeys;
    }
    try {
        const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
        if (!res.ok) return cachedKeys;
        cachedKeys = await res.json() as Record<string, string>;
        keysLastFetched = now;
        return cachedKeys;
    } catch {
        return cachedKeys; // Return stale keys if fetch fails
    }
}

/**
 * Verify a Firebase ID token — INCLUDING its RS256 signature.
 *
 * The previous implementation only base64-decoded the payload and checked the
 * claims. That is not authentication: a JWT's payload is not secret and not
 * integrity-protected on its own, so anyone could hand-craft
 * `{"sub":"x","aud":"<project>","iss":"...","exp":<future>}`, base64 it, append
 * any garbage signature, and be treated as a logged-in user.
 *
 * Node's crypto can verify RS256 against Google's X.509 certs directly, so no
 * firebase-admin dependency is needed:
 *   • pick the cert named by the token's `kid` header
 *   • verify RSA-SHA256 over `header.payload`
 *   • only then trust the claims (aud / iss / exp / iat / sub)
 */
async function verifyFirebaseToken(token: string): Promise<DecodedToken | null> {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const [rawHeader, rawPayload, rawSignature] = parts;
        const header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString());
        const payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString());

        if (header.alg !== 'RS256' || !header.kid) return null;

        const keys = await getGooglePublicKeys();
        const cert = keys[header.kid];
        if (!cert) {
            console.warn('⚠️  Auth: unknown token kid (key rotation?)');
            return null;
        }

        const verifier = crypto.createVerify('RSA-SHA256');
        verifier.update(`${rawHeader}.${rawPayload}`);
        const signatureValid = verifier.verify(cert, Buffer.from(rawSignature, 'base64url'));
        if (!signatureValid) {
            console.warn('⚠️  Auth: token signature verification FAILED');
            return null;
        }

        // Signature is good — now the claims can be trusted.
        const nowSec = Math.floor(Date.now() / 1000);
        if (!payload.sub || typeof payload.sub !== 'string') return null;
        if (!payload.exp || payload.exp <= nowSec) return null;
        // Allow 60s of clock skew on iat.
        if (payload.iat && payload.iat > nowSec + 60) return null;

        if (!FIREBASE_PROJECT_ID) {
            // Refuse to run "authenticated" routes without knowing which project
            // to accept tokens from — otherwise any Firebase project's users
            // would be admitted.
            console.error('❌ FIREBASE_PROJECT_ID is not set; rejecting request');
            return null;
        }
        if (payload.aud !== FIREBASE_PROJECT_ID) return null;
        if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;

        return { uid: payload.sub, email: payload.email };
    } catch {
        return null;
    }
}

// Auth middleware — extracts and verifies Firebase ID token
async function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const idToken = authHeader.substring(7);
    const decoded = await verifyFirebaseToken(idToken);

    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Attach user info to request
    (req as any).user = decoded;
    next();
}

// Health check (public, unauthenticated, never rate-limited).
// Used by Caddy, Docker's HEALTHCHECK and any external uptime monitor.
// No keep-alive ping is needed any more: unlike a sleeping free-tier dyno, the
// Oracle Cloud VM runs continuously, so there is no cold start to hide.
app.get('/health', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        warmTelegramClients: clientCache.size,
        activeUploads: uploadSessions.size,
    });
});
app.head('/health', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end();
});

// Everything below /health is rate limited.
app.use(rateLimit);

// ============================================
// TELEGRAM CLIENT CACHE
// Reuse connections to avoid reconnecting every time
// ============================================

interface CachedClient {
    client: TelegramClient;
    lastUsed: number;
}

const clientCache = new Map<string, CachedClient>();

// Clean up idle clients (unused for 10 minutes)
setInterval(() => {
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    for (const [key, cached] of clientCache.entries()) {
        if (cached.lastUsed < tenMinAgo) {
            console.log(`🔌 Disconnecting idle client: ${key.substring(0, 20)}...`);
            cached.client.disconnect().catch(() => { });
            clientCache.delete(key);
        }
    }
}, 60 * 1000);

// Get or create a Telegram client (cached for speed)
async function getOrCreateClient(session: string): Promise<TelegramClient> {
    const cacheKey = session.substring(0, 50); // Use first 50 chars as key

    const cached = clientCache.get(cacheKey);
    if (cached) {
        cached.lastUsed = Date.now();
        // Verify still connected
        try {
            await cached.client.getMe();
            return cached.client;
        } catch {
            // Connection lost, recreate
            clientCache.delete(cacheKey);
        }
    }

    const client = new TelegramClient(
        new StringSession(session),
        TELEGRAM_API_ID,
        TELEGRAM_API_HASH,
        { connectionRetries: 5, useWSS: true }
    );
    await client.connect();

    clientCache.set(cacheKey, { client, lastUsed: Date.now() });
    return client;
}

// ============================================
// UPLOAD SESSION MANAGEMENT
// ============================================

interface UploadSession {
    chunks: Set<number>;
    tempDir: string;
    fileName: string;
    mimeType: string;
    totalChunks: number;
    session: string;
    /**
     * Firebase uid of the user who started this upload. Every subsequent
     * request for the same uploadId must come from the same user — otherwise a
     * caller who guessed an uploadId could inject chunks into, inspect, or
     * cancel someone else's upload.
     */
    ownerUid: string;
    receivedCount: number;
    totalSize: number;
    createdAt: number;
    lastActivity: number;
}

// In-memory storage for upload sessions
const uploadSessions = new Map<string, UploadSession>();

// Clean up stale sessions (older than 2 hours)
setInterval(() => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    let cleaned = 0;
    for (const [id, session] of uploadSessions.entries()) {
        if (session.lastActivity < twoHoursAgo) {
            // Clean up chunk temp directory
            try {
                if (session.tempDir && fs.existsSync(session.tempDir)) {
                    fs.rmSync(session.tempDir, { recursive: true, force: true });
                }
            } catch { /* ignore */ }
            uploadSessions.delete(id);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`🧹 Cleaned up ${cleaned} stale upload sessions`);
    }
}, 30 * 60 * 1000);

// ============================================
// MIME RESOLUTION
// Mirrors src/lib/fileTypes.ts. The browser's File.type is empty for many
// common containers (.mkv/.flac/.m4v/.m4a/.opus on Windows), which used to make
// files land in Telegram as application/octet-stream — a Content-Type browsers
// refuse to play in <video>/<audio>. Resolving from the extension here also
// FIXES FILES ALREADY UPLOADED with the generic type, since playback derives
// the type at stream time rather than trusting what was stored.
// ============================================

const EXT_TO_MIME: Record<string, string> = {
    // video
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    mkv: 'video/x-matroska', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv', mpeg: 'video/mpeg', mpg: 'video/mpeg', '3gp': 'video/3gpp',
    ogv: 'video/ogg',
    // audio
    mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
    flac: 'audio/flac', opus: 'audio/opus', oga: 'audio/ogg', ogg: 'audio/ogg',
    wma: 'audio/x-ms-wma', aiff: 'audio/aiff', mid: 'audio/midi', midi: 'audio/midi',
    // image
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff',
    tiff: 'image/tiff',
    // documents / text
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
    json: 'application/json', xml: 'application/xml', html: 'text/html',
    htm: 'text/html', css: 'text/css', js: 'text/javascript',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // archives
    zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar', gz: 'application/gzip',
};

function getExtension(fileName: string): string {
    const idx = fileName.lastIndexOf('.');
    if (idx <= 0 || idx === fileName.length - 1) return '';
    return fileName.slice(idx + 1).toLowerCase();
}

function isGenericMime(mime?: string | null): boolean {
    if (!mime) return true;
    const m = mime.toLowerCase().trim();
    return m === '' || m === 'application/octet-stream' ||
        m === 'binary/octet-stream' || m === 'application/unknown';
}

/** Best MIME type for a file: a specific stored type wins, else the extension. */
// Exported for unit testing.
export function resolveMimeType(fileName: string, providedMime?: string | null): string {
    if (!isGenericMime(providedMime)) return providedMime!.toLowerCase().trim();
    return EXT_TO_MIME[getExtension(fileName)] || 'application/octet-stream';
}

/**
 * Make a client-supplied filename safe to use.
 *
 * The name reaches the filesystem indirectly and is sent to Telegram as the
 * document filename, so path separators, traversal sequences and control
 * characters all have to go.
 */
function sanitizeFileName(name: unknown): string {
    if (typeof name !== 'string' || !name.trim()) return 'file';
    const cleaned = name
        .replace(/[/\\]/g, '_')          // no path separators
        .replace(/\.\.+/g, '.')          // no traversal
        .replace(/[\x00-\x1f\x7f]/g, '') // no control characters
        .replace(/^\.+/, '')             // no leading dots (hidden/relative)
        .trim()
        .slice(0, 250);
    return cleaned || 'file';
}

// ============================================
// HELPER: Build file attributes for Telegram
// ============================================

function buildFileAttributes(fileName: string, mimeType: string): Api.TypeDocumentAttribute[] {
    const attrs: Api.TypeDocumentAttribute[] = [
        new Api.DocumentAttributeFilename({ fileName })
    ];

    // Resolve first, so a file the browser reported as octet-stream still gets
    // its audio/video attributes and is recognised by Telegram as media.
    const mime = resolveMimeType(fileName, mimeType);

    // Audio files: add audio attribute so Telegram shows them as music/audio
    if (mime.startsWith('audio/')) {
        attrs.push(new Api.DocumentAttributeAudio({
            duration: 0, // unknown — Telegram fills this in from the container
            title: fileName.replace(/\.[^.]+$/, ''),
            performer: '',
            voice: false,
        }));
    }

    // Video files: mark as streamable so Telegram allows partial reads.
    if (mime.startsWith('video/')) {
        attrs.push(new Api.DocumentAttributeVideo({
            duration: 0,
            w: 0, // unknown — do not claim a resolution we haven't measured
            h: 0,
            supportsStreaming: true,
            roundMessage: false,
        }));
    }

    return attrs;
}

// ============================================
// CHUNKED UPLOAD ENDPOINT
// ============================================

// Hard ceilings so a malicious or buggy client cannot fill the disk.
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB — matches the client cap
const MAX_TOTAL_CHUNKS = 2048;                   // 2048 * 8MB comfortably covers 2GB

app.post('/upload/chunk', authMiddleware, async (req: Request, res: Response) => {
    try {
        const {
            uploadId,
            chunkIndex,
            totalChunks,
            chunkData, // base64 encoded
            fileName,
            mimeType,
            session,
        } = req.body;

        const uid = (req as any).user?.uid as string | undefined;
        if (!uid) return res.status(401).json({ error: 'Unauthenticated' });

        // Validate every field before it is used to touch the filesystem.
        if (typeof uploadId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uploadId)) {
            return res.status(400).json({ error: 'Invalid uploadId' });
        }
        if (typeof chunkData !== 'string' || !chunkData) {
            return res.status(400).json({ error: 'Missing chunkData' });
        }
        if (typeof session !== 'string' || !session) {
            return res.status(400).json({ error: 'Missing session' });
        }
        const idx = Number(chunkIndex);
        const total = Number(totalChunks);
        if (!Number.isInteger(total) || total < 1 || total > MAX_TOTAL_CHUNKS) {
            return res.status(400).json({ error: 'Invalid totalChunks' });
        }
        if (!Number.isInteger(idx) || idx < 0 || idx >= total) {
            return res.status(400).json({ error: 'Invalid chunkIndex' });
        }

        // Get or create upload session
        let uploadSession = uploadSessions.get(uploadId);
        if (!uploadSession) {
            const tempDir = path.join(TEMP_ROOT, `hcloud_chunks_${uploadId}`);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            uploadSession = {
                chunks: new Set(),
                tempDir,
                // Strip path separators: the name is echoed back and used as the
                // Telegram filename, and must never be able to escape a directory.
                fileName: sanitizeFileName(fileName),
                mimeType: typeof mimeType === 'string' && mimeType ? mimeType : 'application/octet-stream',
                totalChunks: total,
                session,
                ownerUid: uid,
                receivedCount: 0,
                totalSize: 0,
                createdAt: Date.now(),
                lastActivity: Date.now(),
            };
            uploadSessions.set(uploadId, uploadSession);
            console.log(`📂 New session: ${uploadId} (${uploadSession.fileName}, ${uploadSession.mimeType})`);

            // Pre-warm Telegram connection while chunks upload
            getOrCreateClient(session).catch(() => { });
        } else if (uploadSession.ownerUid !== uid) {
            // Someone else's upload — do not confirm it exists.
            return res.status(404).json({ error: 'Upload session not found' });
        } else if (uploadSession.totalChunks !== total) {
            return res.status(400).json({ error: 'totalChunks does not match this upload session' });
        }

        uploadSession.lastActivity = Date.now();

        // Write chunk to disk if not already received
        if (!uploadSession.chunks.has(idx)) {
            const chunkBuffer = Buffer.from(chunkData, 'base64');
            if (chunkBuffer.length === 0) {
                return res.status(400).json({ error: 'chunkData did not decode to any data' });
            }
            if (uploadSession.totalSize + chunkBuffer.length > MAX_UPLOAD_BYTES) {
                return res.status(413).json({ error: 'Upload exceeds the 2GB maximum' });
            }
            const chunkPath = path.join(uploadSession.tempDir, `chunk_${idx}`);
            await fs.promises.writeFile(chunkPath, chunkBuffer);
            uploadSession.chunks.add(idx);
            uploadSession.receivedCount++;
            uploadSession.totalSize += chunkBuffer.length;
        }

        const progress = Math.round((uploadSession.receivedCount / total) * 100);

        return res.json({
            success: true,
            received: uploadSession.receivedCount,
            total,
            progress,
        });

    } catch (error: any) {
        console.error('❌ Chunk upload error:', error);
        return res.status(500).json({ error: 'Chunk upload failed' });
    }
});

// ============================================
// FINALIZE UPLOAD ENDPOINT
// ============================================

app.post('/upload/finalize', authMiddleware, async (req: Request, res: Response) => {
    const { uploadId, session } = req.body;
    const uid = (req as any).user?.uid as string | undefined;

    if (!uploadId || !session) {
        return res.status(400).json({ error: 'Missing uploadId or session' });
    }

    const uploadSession = uploadSessions.get(uploadId);
    if (!uploadSession) {
        return res.status(404).json({ error: 'Upload session not found. It may have expired.' });
    }

    // Only the user who uploaded the chunks may finalize them.
    if (uploadSession.ownerUid !== uid) {
        return res.status(404).json({ error: 'Upload session not found. It may have expired.' });
    }

    // Verify all chunks received
    if (uploadSession.receivedCount < uploadSession.totalChunks) {
        return res.status(400).json({
            error: `Not all chunks received: ${uploadSession.receivedCount}/${uploadSession.totalChunks}`,
        });
    }

    // Verify no missing chunks
    for (let i = 0; i < uploadSession.totalChunks; i++) {
        if (!uploadSession.chunks.has(i)) {
            return res.status(400).json({ error: `Missing chunk at index ${i}` });
        }
    }

    const fileName = uploadSession.fileName;
    const mimeType = uploadSession.mimeType;
    console.log(`🔧 Assembling ${uploadSession.totalChunks} chunks for ${fileName}...`);

    try {
        // Assemble the file from the chunk files on disk, in order.
        //
        // The previous version did `writeStream.write(fs.readFileSync(chunk))`
        // in a loop without ever waiting for a drain, so every chunk stayed
        // queued in the stream's internal buffer: assembling a 1GB video needed
        // ~1GB of heap on a 512MB Render instance and the process was OOM-killed
        // mid-upload. Piping each chunk through and awaiting completion keeps
        // memory flat at one chunk regardless of file size.
        const tempPath = path.join(TEMP_ROOT, `hcloud_${uploadId}_${Date.now()}`);
        const writeStream = fs.createWriteStream(tempPath);

        try {
            for (let i = 0; i < uploadSession.totalChunks; i++) {
                const chunkPath = path.join(uploadSession.tempDir, `chunk_${i}`);
                await new Promise<void>((resolve, reject) => {
                    const readStream = fs.createReadStream(chunkPath);
                    readStream.on('error', reject);
                    readStream.on('end', resolve);
                    // `end: false` keeps the destination open for the next chunk.
                    readStream.pipe(writeStream, { end: false });
                });
            }
        } catch (assembleError) {
            writeStream.destroy();
            try { await fs.promises.unlink(tempPath); } catch { /* ignore */ }
            throw assembleError;
        }

        await new Promise<void>((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            writeStream.end();
        });

        const fileSize = fs.statSync(tempPath).size;
        console.log(`📄 Assembled: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

        // Sanity check: a size mismatch means chunks were lost or duplicated, and
        // uploading a corrupt file is worse than failing.
        if (fileSize !== uploadSession.totalSize) {
            try { await fs.promises.unlink(tempPath); } catch { /* ignore */ }
            try { fs.rmSync(uploadSession.tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
            uploadSessions.delete(uploadId);
            console.error(`❌ Size mismatch: assembled ${fileSize} vs received ${uploadSession.totalSize}`);
            return res.status(500).json({
                error: 'Assembled file size did not match the uploaded data. Please try again.',
            });
        }

        // Clean up chunk temp dir
        try {
            fs.rmSync(uploadSession.tempDir, { recursive: true, force: true });
        } catch { /* ignore */ }

        // Use cached Telegram client (pre-warmed during chunk upload)
        console.log('🔌 Getting Telegram client...');
        const client = await getOrCreateClient(session);

        const me = await client.getMe();
        if (!me) {
            fs.unlinkSync(tempPath);
            uploadSessions.delete(uploadId);
            return res.status(401).json({ error: 'Invalid Telegram session.' });
        }
        console.log(`✅ Connected as: ${(me as any).username || (me as any).firstName}`);

        // Upload file to Telegram
        console.log('📤 Uploading to Telegram...');
        let toUpload: any;
        try {
            const { CustomFile } = await import('telegram/client/uploads');
            const customFile = new CustomFile(fileName, fileSize, tempPath);
            toUpload = await client.uploadFile({
                file: customFile,
                workers: 8,  // More workers = faster upload
            });
        } finally {
            try { fs.unlinkSync(tempPath); } catch (e) { /* ignore */ }
        }

        // Build proper file attributes (audio, video, etc.)
        const attributes = buildFileAttributes(fileName, mimeType);

        // Send to Saved Messages with proper attributes
        const result = await client.invoke(
            new Api.messages.SendMedia({
                peer: 'me',
                media: new Api.InputMediaUploadedDocument({
                    file: toUpload,
                    mimeType: mimeType || 'application/octet-stream',
                    attributes,
                }),
                message: '',
                randomId: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)) as any,
            })
        );

        console.log('✅ Upload complete!');

        // Extract messageId and fileId
        let messageId = 0;
        let fileId = '';
        const updates = result as any;
        if (updates.updates) {
            for (const update of updates.updates) {
                if (update.message) {
                    messageId = update.message.id;
                    const media = update.message.media;
                    if (media?.document) {
                        fileId = media.document.id.toString();
                    }
                    break;
                }
            }
        }

        uploadSessions.delete(uploadId);

        // Without a messageId the file exists in Telegram but nothing can ever
        // address it — the client would store an unopenable record. Reporting
        // failure here is the honest answer, even though the bytes did upload.
        if (!messageId) {
            console.error('❌ Upload stored but no messageId in response');
            return res.status(502).json({
                error: 'Telegram accepted the file but returned no message reference. Please try again.',
            });
        }

        console.log(`✅ MessageId: ${messageId}, FileId: ${fileId}`);

        return res.json({
            success: true,
            messageId,
            // fileId is informational for BYOD (retrieval uses messageId), so an
            // empty value must not be sent as a falsy string the client drops.
            fileId: fileId || `msg_${messageId}`,
            fileName,
            fileSize,
        });

    } catch (error: any) {
        console.error('❌ Finalize error:', error);
        uploadSessions.delete(uploadId);

        if (error.message?.includes('AUTH_KEY_UNREGISTERED') ||
            error.message?.includes('SESSION_REVOKED')) {
            return res.status(401).json({ error: 'Session expired. Please re-authenticate.' });
        }

        return res.status(500).json({ error: error.message || 'Upload failed' });
    }
});

// ============================================
// DOWNLOAD ENDPOINT (for BYOD files - full download)
// ============================================

app.post('/download', authMiddleware, async (req: Request, res: Response) => {
    const { messageId, session } = req.body;

    if (!messageId || !session) {
        return res.status(400).json({ error: 'Missing messageId or session' });
    }

    try {
        console.log(`📥 Download request for message ${messageId}`);
        const client = await getOrCreateClient(session);

        // Get the message from Saved Messages
        const messages = await client.getMessages('me', { ids: [messageId] });

        if (!messages || messages.length === 0 || !messages[0]) {
            return res.status(404).json({ error: 'Message not found' });
        }

        const message = messages[0];
        if (!message.media) {
            return res.status(404).json({ error: 'No media in message' });
        }

        const info = getMediaInfo(message);
        if (!info || !info.size) {
            return res.status(415).json({ error: 'Unsupported or empty media' });
        }

        // Stream the bytes straight through instead of buffering the whole file
        // in RAM first — a 1GB download used to need 1GB of heap on a 512MB
        // Render instance, which killed the process.
        res.setHeader('Content-Type', info.contentType);
        res.setHeader('Content-Length', info.size.toString());
        res.setHeader(
            'Content-Disposition',
            `inline; filename*=UTF-8''${encodeURIComponent(info.fileName)}`
        );
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type');

        console.log(`📥 Streaming ${info.fileName} (${(info.size / 1024 / 1024).toFixed(1)}MB)`);
        await pipeTelegramRange(client, message, res, 0, info.size - 1);
        return;

    } catch (error: any) {
        console.error('❌ Download error:', error);

        if (res.headersSent) return res.destroy();

        if (error.message?.includes('AUTH_KEY_UNREGISTERED') ||
            error.message?.includes('SESSION_REVOKED')) {
            return res.status(401).json({ error: 'Session expired.' });
        }

        return res.status(500).json({ error: error.message || 'Download failed' });
    }
});

// ============================================
// STREAMING ENDPOINT (GET - for audio/video src)
// Browser can use this directly as <audio src> or <video src>
// ============================================

/**
 * Resolve a Telegram message's media into the metadata a browser needs before
 * it can stream: exact byte size, MIME type and original file name.
 *
 * Size MUST come from Telegram's own metadata — never from a downloaded buffer —
 * because progressive streaming means we answer the request before we have read
 * a single byte.
 *
 * It also has to come from `utils.getFileInfo()`, the SAME function iterDownload
 * calls internally to pick which file location to fetch. Computing the size any
 * other way risks disagreeing with what actually gets downloaded (for photos,
 * gramjs always fetches the last entry in `sizes`), and a Content-Length that
 * doesn't match the body makes the browser abort playback.
 */
function getMediaInfo(message: Api.Message): {
    size: number;
    contentType: string;
    fileName: string;
} | null {
    const media = message.media as any;
    if (!media) return null;

    let size = 0;
    try {
        const info = utils.getFileInfo(media);
        size = Number(info.size?.toString() ?? 0);
    } catch {
        return null; // media type gramjs cannot download
    }
    if (!size) return null;

    // Documents (video, audio, pdf, zip — everything uploaded by HCloud)
    if (media.document) {
        const doc = media.document;
        let fileName = 'file';
        for (const attr of doc.attributes || []) {
            if (attr.fileName) fileName = attr.fileName;
        }

        // Resolve from the filename when Telegram stored a generic type. This is
        // what lets already-uploaded .mkv/.flac/.m4v files stream correctly
        // without re-uploading them.
        const contentType = resolveMimeType(fileName, doc.mimeType);
        return { size, contentType, fileName };
    }

    // Photos — gramjs downloads the largest size, and getFileInfo reported its
    // byte count above, so these two always agree.
    if (media.photo) {
        return { size, contentType: 'image/jpeg', fileName: 'photo.jpg' };
    }

    return null;
}

/** Parse a single-range `Range: bytes=start-end` header against a known size. */
// Exported so the range math can be unit-tested; nothing else imports it.
export function parseRange(
    rangeHeader: string | undefined,
    totalSize: number
): { start: number; end: number } | 'invalid' | null {
    if (!rangeHeader) return null;

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (!match) return 'invalid';

    const [, rawStart, rawEnd] = match;
    if (rawStart === '' && rawEnd === '') return 'invalid';

    let start: number;
    let end: number;

    if (rawStart === '') {
        // Suffix range: `bytes=-500` means the LAST 500 bytes.
        const suffixLength = parseInt(rawEnd, 10);
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'invalid';
        start = Math.max(0, totalSize - suffixLength);
        end = totalSize - 1;
    } else {
        start = parseInt(rawStart, 10);
        end = rawEnd === '' ? totalSize - 1 : parseInt(rawEnd, 10);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
        // A start past EOF must produce 416, not an empty 206.
        if (start >= totalSize) return 'invalid';
        if (end >= totalSize) end = totalSize - 1;
        if (end < start) return 'invalid';
    }

    return { start, end };
}

// Telegram requires download offsets aligned to 4KB and serves at most 512KB
// per request. 512KB parts give the best throughput/latency balance.
const TG_ALIGN = 4096;
const TG_PART_SIZE = 512 * 1024;

/**
 * Pipe exactly bytes [start, end] of a Telegram file to `res`, fetching from
 * Telegram progressively and writing each part as soon as it arrives.
 *
 * This is the core of Task A: previously the whole file was buffered in RAM
 * before a single byte reached the browser, so a 700MB video took minutes to
 * start and every seek re-read the entire file. Now first-byte latency is one
 * 512KB Telegram round-trip regardless of file size, and a seek fetches only
 * the bytes after the seek point.
 *
 * Backpressure is respected via res.write()'s return value + 'drain', so a slow
 * client can never balloon the Node heap.
 */
async function pipeTelegramRange(
    client: TelegramClient,
    message: Api.Message,
    res: Response,
    start: number,
    end: number
): Promise<void> {
    // Align the download offset DOWN to a 4KB boundary, then discard the extra
    // leading bytes so the client receives exactly what it asked for.
    const alignedStart = start - (start % TG_ALIGN);
    let skip = start - alignedStart;
    let remaining = end - start + 1;

    const iterator = iterDownload(client, {
        file: message.media as Api.TypeMessageMedia,
        offset: bigInt(alignedStart),
        requestSize: TG_PART_SIZE,
    });

    // If the client disconnects (user seeks, closes tab, hits next track) stop
    // pulling from Telegram immediately instead of downloading the whole range.
    let aborted = false;
    const onAbort = () => { aborted = true; };
    res.on('close', onAbort);

    try {
        for await (const rawChunk of iterator) {
            if (aborted || remaining <= 0) break;
            if (!rawChunk || rawChunk.length === 0) continue;

            let chunk: Buffer = rawChunk;

            // Drop the alignment padding at the head of the first part.
            if (skip > 0) {
                if (skip >= chunk.length) {
                    skip -= chunk.length;
                    continue;
                }
                chunk = chunk.subarray(skip);
                skip = 0;
            }

            // Never overshoot the requested range.
            if (chunk.length > remaining) {
                chunk = chunk.subarray(0, remaining);
            }
            remaining -= chunk.length;

            if (!res.write(chunk)) {
                // Kernel/socket buffer is full — wait for it to drain so memory
                // usage stays flat even for a slow client on a huge file.
                await new Promise<void>((resolve) => {
                    const cleanup = () => {
                        res.off('drain', onDrain);
                        res.off('close', onClose);
                        resolve();
                    };
                    const onDrain = () => cleanup();
                    const onClose = () => { aborted = true; cleanup(); };
                    res.once('drain', onDrain);
                    res.once('close', onClose);
                });
            }
        }
    } finally {
        res.off('close', onAbort);
        // Release the borrowed DC sender / pending requests.
        try { await (iterator as any).close?.(); } catch { /* ignore */ }
    }

    if (!res.writableEnded) res.end();
}

/**
 * Shared streaming core used by BOTH the authed /stream route (dashboard) and
 * the public /token-stream route (share links).
 *
 * Streams progressively with full HTTP Range support, so ANY content type —
 * video, audio, image, pdf, arbitrary binary — plays/seeks natively in the
 * browser without downloading the file first.
 */
async function streamMedia(req: Request, res: Response, messageId: number, session: string) {
    const client = await getOrCreateClient(session);

    const messages = await client.getMessages('me', { ids: [messageId] });
    if (!messages || messages.length === 0 || !messages[0]) {
        return res.status(404).json({ error: 'Message not found' });
    }

    const message = messages[0];
    if (!message.media) {
        return res.status(404).json({ error: 'No media in message' });
    }

    const info = getMediaInfo(message);
    if (!info || !info.size) {
        return res.status(415).json({ error: 'Unsupported or empty media' });
    }

    const { size: totalSize, contentType, fileName } = info;

    // Common headers. `Accept-Ranges` is what tells the browser it may seek —
    // without it, <video>/<audio> refuse to show a scrubbable timeline.
    res.setHeader('Content-Type', contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, Accept-Ranges');

    // `?download=1` forces a save-to-disk instead of inline playback.
    //
    // This exists because the HTML `download` attribute on an <a> is IGNORED for
    // cross-origin URLs — and this server is a different origin from the app. So
    // a "Download" click used to just open the video in a new tab and play it.
    // Only the server can decide "attachment", hence this flag.
    const asAttachment = req.query.download === '1' || req.query.download === 'true';
    res.setHeader(
        'Content-Disposition',
        `${asAttachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(fileName)}`
    );

    const range = parseRange(req.headers.range, totalSize);

    // Unsatisfiable range → 416 with the real size so the client can retry.
    if (range === 'invalid') {
        res.status(416);
        res.setHeader('Content-Range', `bytes */${totalSize}`);
        return res.end();
    }

    const start = range ? range.start : 0;
    const end = range ? range.end : totalSize - 1;
    const length = end - start + 1;

    if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    } else {
        res.status(200);
    }
    res.setHeader('Content-Length', length.toString());

    // A HEAD request must carry all headers but no body — players use it to
    // probe size/range support before requesting any bytes.
    if (req.method === 'HEAD') {
        return res.end();
    }

    console.log(`🎬 Stream ${fileName} [${contentType}] bytes ${start}-${end}/${totalSize}`);
    await pipeTelegramRange(client, message, res, start, end);
}

// Public token stream (dashboard media + shared links, entered via Vercel).
// The encrypted token IS the capability — it carries session+messageId and is
// minted server-side on Vercel, so NO Firebase auth is required here. This is
// how a public /s/<id> page can play a BYOD file without the owner's session.
//
// There is deliberately no route that accepts a raw `session` query parameter:
// that would write the user's long-lived Telegram session into access logs,
// proxy caches and browser history.
const tokenStreamHandler = async (req: Request, res: Response) => {
    const token = req.query.token as string;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const decoded = decryptStreamToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired stream token' });
    }

    // Each stream holds a Telegram connection for its whole duration, so cap how
    // many one client can hold at once. Without this a single page could open
    // dozens of <video> elements and starve every other user of the pool.
    const release = acquireStreamSlot(req);
    if (!release) {
        res.setHeader('Retry-After', '5');
        return res.status(429).json({ error: 'Too many simultaneous streams from this client.' });
    }
    // 'close' fires whether the response finished or the client disconnected.
    res.on('close', release);

    try {
        return await streamMedia(req, res, decoded.messageId, decoded.session);
    } catch (error: any) {
        console.error('❌ Token-stream error:', error);
        if (!res.headersSent) return res.status(500).json({ error: 'Stream failed' });
        // Headers already flushed mid-stream — the only honest signal left is to
        // kill the connection so the player reports an error instead of treating
        // a truncated body as a complete file.
        return res.destroy();
    } finally {
        release();
    }
};

app.get('/token-stream', tokenStreamHandler);
// Safari and several media players issue a HEAD probe before playing.
app.head('/token-stream', tokenStreamHandler);

// ============================================
// STATUS ENDPOINT
// ============================================

app.get('/upload/status/:uploadId', authMiddleware, (req: Request, res: Response) => {
    const { uploadId } = req.params;
    const session = uploadSessions.get(uploadId);

    // Owner-only: progress reveals filenames and sizes.
    if (!session || session.ownerUid !== (req as any).user?.uid) {
        return res.status(404).json({ error: 'Upload session not found' });
    }

    return res.json({
        uploadId,
        fileName: session.fileName,
        receivedChunks: session.receivedCount,
        totalChunks: session.totalChunks,
        totalSize: session.totalSize,
        progress: Math.round((session.receivedCount / session.totalChunks) * 100),
    });
});

// ============================================
// CANCEL UPLOAD ENDPOINT
// ============================================

// Requires auth (this used to be wide open, so anyone could destroy another
// user's in-flight upload by guessing its uploadId) and also removes the
// half-written chunk files instead of leaking them into the temp directory
// until the 2-hour sweeper ran.
app.delete('/upload/:uploadId', authMiddleware, (req: Request, res: Response) => {
    const { uploadId } = req.params;
    const uploadSession = uploadSessions.get(uploadId);

    if (!uploadSession) {
        return res.status(404).json({ error: 'Upload session not found' });
    }

    if ((req as any).user?.uid !== uploadSession.ownerUid) {
        // Don't confirm the id exists to a caller who doesn't own it.
        return res.status(404).json({ error: 'Upload session not found' });
    }

    try {
        if (uploadSession.tempDir && fs.existsSync(uploadSession.tempDir)) {
            fs.rmSync(uploadSession.tempDir, { recursive: true, force: true });
        }
    } catch { /* ignore */ }

    uploadSessions.delete(uploadId);
    console.log(`🗑️ Cancelled: ${uploadId}`);
    return res.json({ success: true });
});

// ============================================
// SERVER STATS ENDPOINT
// ============================================

app.get('/stats', (req: Request, res: Response) => {
    // Require admin secret to prevent information disclosure
    const secret = req.headers['x-admin-secret'] as string;
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    const sessions = Array.from(uploadSessions.values());
    const totalMemoryUsed = sessions.reduce((sum, s) => sum + s.totalSize, 0);

    res.json({
        activeSessions: uploadSessions.size,
        cachedClients: clientCache.size,
        totalMemoryUsedMB: Math.round(totalMemoryUsed / 1024 / 1024 * 100) / 100,
        uptime: process.uptime(),
    });
});

// ============================================
// ERROR HANDLING
// ============================================

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// START SERVER
// ============================================

// Fail fast and loudly on misconfiguration rather than 401-ing every request
// with no explanation of why.
if (!STREAM_TOKEN_SECRET) {
    console.error('❌ Neither STREAM_TOKEN_SECRET nor TELEGRAM_API_HASH is set — BYOD streaming cannot work.');
    process.exit(1);
}
if (!FIREBASE_PROJECT_ID) {
    console.error('❌ FIREBASE_PROJECT_ID is not set — every authenticated request would be rejected.');
    console.error('   Set it to your Firebase project id (the `aud` claim of the ID tokens you issue).');
    process.exit(1);
}

cleanStaleTempDirs();

const server = app.listen(PORT, HOST, () => {
    console.log('');
    console.log('🚀 ================================');
    console.log('   HCloud Relay Server');
    console.log('🚀 ================================');
    console.log(`   Listening:      http://${HOST}:${PORT}`);
    console.log(`   CORS origins:   ${allowedOrigins.join(', ') || '(none)'}`);
    console.log(`   Telegram API:   ${TELEGRAM_API_ID ? 'configured' : 'MISSING'}`);
    console.log(`   Stream tokens:  configured`);
    console.log(`   Firebase proj:  ${FIREBASE_PROJECT_ID}`);
    console.log(`   Rate limit:     ${RATE_LIMIT_DISABLED ? 'disabled' : `${RATE_LIMIT_MAX}/${RATE_LIMIT_WINDOW_MS}ms per IP`}`);
    console.log(`   Temp dir:       ${TEMP_ROOT}`);
    console.log('🚀 ================================');
    console.log('');
});

// Streaming a large file can legitimately take a long time. Node's 2-minute
// default would cut a slow client off mid-video.
server.requestTimeout = 0;      // no cap on a single request
server.headersTimeout = 60_000; // but headers must arrive promptly
server.keepAliveTimeout = 65_000;

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
// systemd/Docker send SIGTERM on stop and restart. Draining properly means an
// in-flight upload finishes instead of being cut off, and Telegram connections
// are closed cleanly rather than left for the server to time out.
let shuttingDown = false;

async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down gracefully...`);

    // Stop accepting new connections; existing ones drain.
    server.close(() => console.log('   HTTP server closed'));

    // Give in-flight work a bounded window, then exit regardless.
    const forceExit = setTimeout(() => {
        console.warn('   Drain timed out — exiting now.');
        process.exit(0);
    }, 25_000);
    forceExit.unref();

    // Disconnect pooled Telegram clients.
    await Promise.allSettled(
        Array.from(clientCache.values()).map(c => c.client.disconnect())
    );
    clientCache.clear();
    console.log('   Telegram clients disconnected');

    clearTimeout(forceExit);
    process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// A single unhandled rejection (e.g. a Telegram socket dying mid-download) must
// not take the whole server down for every other user.
process.on('unhandledRejection', (reason) => {
    console.error('⚠️  Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️  Uncaught exception:', err);
});
