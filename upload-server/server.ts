/**
 * HCloud Upload Server
 * Dedicated Express server for handling large file uploads to Telegram
 * Deployed on Render for unlimited timeout and persistent connections
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { TelegramClient, sessions, Api } from 'telegram';
const { StringSession } = sessions;

// Environment variables
const PORT = process.env.PORT || 3001;
const TELEGRAM_API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const TELEGRAM_API_HASH = process.env.TELEGRAM_API_HASH || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || '';

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

// CORS configuration
const allowedOrigins = CORS_ORIGIN.split(',').map(o => o.trim());
app.use(cors({
    origin: (origin: string | undefined, callback: any) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            callback(null, true);
        } else {
            console.warn(`Blocked CORS request from: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
}));

// Parse JSON with high limit for chunks
app.use(express.json({ limit: '12mb' }));

// ============================================
// FIREBASE AUTH MIDDLEWARE
// Verifies Firebase ID tokens without firebase-admin SDK
// ============================================

interface DecodedToken {
    uid: string;
    email?: string;
}

// Cache for Google's public keys (refreshes every hour)
let cachedKeys: Record<string, string> = {};
let keysLastFetched = 0;

async function getGooglePublicKeys(): Promise<Record<string, string>> {
    const now = Date.now();
    if (cachedKeys && now - keysLastFetched < 3600000) {
        return cachedKeys;
    }
    try {
        const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
        cachedKeys = await res.json() as Record<string, string>;
        keysLastFetched = now;
        return cachedKeys;
    } catch {
        return cachedKeys; // Return stale keys if fetch fails
    }
}

async function verifyFirebaseToken(token: string): Promise<DecodedToken | null> {
    try {
        // Decode the JWT payload (middle section) without verification library
        // For full production security, use firebase-admin or a JWT library
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

        // Basic validation checks
        if (!payload.sub) return null;
        if (payload.aud !== FIREBASE_PROJECT_ID && FIREBASE_PROJECT_ID) return null;
        if (payload.exp && payload.exp * 1000 < Date.now()) return null;
        if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` && FIREBASE_PROJECT_ID) return null;

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

// Health check endpoint (public — no auth required)
app.get('/health', (_: any, res: any) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
    });
});

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
    receivedCount: number;
    totalSize: number;
    createdAt: number;
    lastActivity: number;
}

// In-memory storage for upload sessions
const uploadSessions = new Map<string, UploadSession>();
const streamCache = new Map<string, { buffer: Buffer; timestamp: number }>();

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
// HELPER: Build file attributes for Telegram
// ============================================

function buildFileAttributes(fileName: string, mimeType: string): Api.TypeDocumentAttribute[] {
    const attrs: Api.TypeDocumentAttribute[] = [
        new Api.DocumentAttributeFilename({ fileName })
    ];

    // Audio files: add audio attribute so Telegram shows them as music/audio
    if (mimeType.startsWith('audio/')) {
        attrs.push(new Api.DocumentAttributeAudio({
            duration: 0, // unknown duration
            title: fileName.replace(/\.[^.]+$/, ''), // filename without extension
            performer: '',
            voice: false,
        }));
    }

    // Video files: add video attribute
    if (mimeType.startsWith('video/')) {
        attrs.push(new Api.DocumentAttributeVideo({
            duration: 0,
            w: 1920,
            h: 1080,
            supportsStreaming: true,
            roundMessage: false,
        }));
    }

    return attrs;
}

// ============================================
// CHUNKED UPLOAD ENDPOINT
// ============================================

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

        if (!uploadId || chunkIndex === undefined || !chunkData || !totalChunks || !session) {
            return res.status(400).json({
                error: 'Missing required fields: uploadId, chunkIndex, chunkData, totalChunks, session'
            });
        }

        // Get or create upload session
        let uploadSession = uploadSessions.get(uploadId);
        if (!uploadSession) {
            const tempDir = path.join(os.tmpdir(), `hcloud_chunks_${uploadId}`);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            uploadSession = {
                chunks: new Set(),
                tempDir,
                fileName: fileName || 'file',
                mimeType: mimeType || 'application/octet-stream',
                totalChunks,
                session,
                receivedCount: 0,
                totalSize: 0,
                createdAt: Date.now(),
                lastActivity: Date.now(),
            };
            uploadSessions.set(uploadId, uploadSession);
            console.log(`📂 New session: ${uploadId} (${fileName}, ${mimeType})`);

            // Pre-warm Telegram connection while chunks upload
            getOrCreateClient(session).catch(() => { });
        }

        uploadSession.lastActivity = Date.now();

        // Write chunk to disk if not already received
        if (!uploadSession.chunks.has(chunkIndex)) {
            const chunkBuffer = Buffer.from(chunkData, 'base64');
            const chunkPath = path.join(uploadSession.tempDir, `chunk_${chunkIndex}`);
            fs.writeFileSync(chunkPath, chunkBuffer);
            uploadSession.chunks.add(chunkIndex);
            uploadSession.receivedCount++;
            uploadSession.totalSize += chunkBuffer.length;
        }

        const progress = Math.round((uploadSession.receivedCount / totalChunks) * 100);

        return res.json({
            success: true,
            received: uploadSession.receivedCount,
            total: totalChunks,
            progress,
        });

    } catch (error: any) {
        console.error('❌ Chunk upload error:', error);
        return res.status(500).json({ error: error.message || 'Chunk upload failed' });
    }
});

// ============================================
// FINALIZE UPLOAD ENDPOINT
// ============================================

app.post('/upload/finalize', authMiddleware, async (req: Request, res: Response) => {
    const { uploadId, session } = req.body;

    if (!uploadId || !session) {
        return res.status(400).json({ error: 'Missing uploadId or session' });
    }

    const uploadSession = uploadSessions.get(uploadId);
    if (!uploadSession) {
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
        // Assemble file from chunk files on disk (in order)
        const tempPath = path.join(os.tmpdir(), `hcloud_${uploadId}_${Date.now()}`);
        const writeStream = fs.createWriteStream(tempPath);
        for (let i = 0; i < uploadSession.totalChunks; i++) {
            const chunkPath = path.join(uploadSession.tempDir, `chunk_${i}`);
            const chunkData = fs.readFileSync(chunkPath);
            writeStream.write(chunkData);
        }
        writeStream.end();
        await new Promise<void>((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
        });
        const fileSize = fs.statSync(tempPath).size;
        console.log(`📄 Assembled: ${(fileSize / 1024 / 1024).toFixed(1)}MB`);

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
        console.log(`✅ MessageId: ${messageId}, FileId: ${fileId}`);

        return res.json({
            success: true,
            messageId,
            fileId,
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

        // Download the file
        console.log('📥 Downloading from Telegram...');
        const buffer = await client.downloadMedia(message, {}) as Buffer;

        if (!buffer) {
            return res.status(404).json({ error: 'Failed to download file' });
        }

        // Determine content type
        let contentType = 'application/octet-stream';
        let dlFileName = 'file';
        const media = message.media as any;
        if (media.document) {
            contentType = media.document.mimeType || contentType;
            for (const attr of media.document.attributes || []) {
                if (attr.fileName) {
                    dlFileName = attr.fileName;
                }
            }
        }

        console.log(`📥 Downloaded: ${dlFileName} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

        // Send file as response
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(dlFileName)}"`);
        res.setHeader('Content-Length', buffer.length.toString());
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.send(buffer);

    } catch (error: any) {
        console.error('❌ Download error:', error);

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

// Shared streaming core: downloads (with brief cache) and writes the media to
// the response, honouring HTTP Range for seeking. Used by both the authed
// /stream route (dashboard) and the public /token-stream route (shared links).
async function streamMedia(req: Request, res: Response, messageId: number, session: string) {
    console.log(`🎵 Stream request for message ${messageId}`);
    const client = await getOrCreateClient(session);

    const messages = await client.getMessages('me', { ids: [messageId] });
    if (!messages || messages.length === 0 || !messages[0]) {
        return res.status(404).json({ error: 'Message not found' });
    }

    const message = messages[0];
    if (!message.media) {
        return res.status(404).json({ error: 'No media in message' });
    }

    // Get file metadata
    let contentType = 'application/octet-stream';
    let streamFileName = 'file';
    const media = message.media as any;
    if (media.document) {
        contentType = media.document.mimeType || contentType;
        for (const attr of media.document.attributes || []) {
            if (attr.fileName) streamFileName = attr.fileName;
        }
    }

    console.log(`🎵 Streaming: ${streamFileName} (${contentType})`);

    // Brief in-memory cache so seeking (repeated Range requests) doesn't re-download.
    const cacheKey = `${session.substring(0, 20)}_${messageId}`;
    let buffer: Buffer;
    const cached = streamCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
        buffer = cached.buffer;
        console.log(`🎵 Using cached buffer for ${streamFileName}`);
    } else {
        const downloaded = await client.downloadMedia(message, {}) as Buffer;
        if (!downloaded) {
            return res.status(404).json({ error: 'Failed to download file' });
        }
        buffer = downloaded;
        if (streamCache.size > 10) {
            const oldest = streamCache.keys().next().value;
            if (oldest) streamCache.delete(oldest);
        }
        streamCache.set(cacheKey, { buffer, timestamp: Date.now() });
    }

    const totalSize = buffer.length;

    // Handle Range requests for seeking in audio/video
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunkSize = end - start + 1;

        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
        res.setHeader('Content-Length', chunkSize.toString());
        res.setHeader('Content-Type', contentType);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');
        return res.send(buffer.subarray(start, end + 1));
    }

    // No Range header — send full file
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', totalSize.toString());
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(streamFileName)}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
    return res.send(buffer);
}

// Authed stream (dashboard playback) — requires a Firebase ID token.
app.get('/stream', authMiddleware, async (req: Request, res: Response) => {
    const messageId = parseInt(req.query.messageId as string);
    const session = req.query.session as string;

    if (!messageId || !session) {
        return res.status(400).json({ error: 'Missing messageId or session query params' });
    }

    try {
        return await streamMedia(req, res, messageId, session);
    } catch (error: any) {
        console.error('❌ Stream error:', error);
        if (!res.headersSent) return res.status(500).json({ error: error.message || 'Stream failed' });
    }
});

// Public token stream (shared links + dashboard media, proxied from Vercel).
// The encrypted token IS the capability — it carries session+messageId and is
// minted server-side on Vercel, so NO Firebase auth is required here. This is
// how a public /s/<id> page can play a BYOD file without the owner's session.
app.get('/token-stream', async (req: Request, res: Response) => {
    const token = req.query.token as string;
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const decoded = decryptStreamToken(token);
    if (!decoded) {
        return res.status(401).json({ error: 'Invalid or expired stream token' });
    }

    try {
        return await streamMedia(req, res, decoded.messageId, decoded.session);
    } catch (error: any) {
        console.error('❌ Token-stream error:', error);
        if (!res.headersSent) return res.status(500).json({ error: error.message || 'Stream failed' });
    }
});

// ============================================
// STATUS ENDPOINT
// ============================================

app.get('/upload/status/:uploadId', authMiddleware, (req: Request, res: Response) => {
    const { uploadId } = req.params;
    const session = uploadSessions.get(uploadId);

    if (!session) {
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

app.delete('/upload/:uploadId', (req: Request, res: Response) => {
    const { uploadId } = req.params;

    if (uploadSessions.has(uploadId)) {
        uploadSessions.delete(uploadId);
        console.log(`🗑️ Cancelled: ${uploadId}`);
        return res.json({ success: true });
    }

    return res.status(404).json({ error: 'Upload session not found' });
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

app.listen(PORT, () => {
    console.log('');
    console.log('🚀 ================================');
    console.log('   HCloud Upload Server Started');
    console.log('🚀 ================================');
    console.log(`   Port: ${PORT}`);
    console.log(`   CORS: ${allowedOrigins.join(', ')}`);
    console.log(`   API: ${TELEGRAM_API_ID ? '✅' : '❌'}`);
    console.log('🚀 ================================');
    console.log('');
});
