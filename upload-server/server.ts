/**
 * HCloud Upload Server
 * Dedicated Express server for handling large file uploads to Telegram
 * Deployed on Render for unlimited timeout and persistent connections
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { TelegramClient, sessions, Api } from 'telegram';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CustomFile } = require('telegram/client/uploads');
const { StringSession } = sessions;

// Environment variables
const PORT = process.env.PORT || 3001;
const TELEGRAM_API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const TELEGRAM_API_HASH = process.env.TELEGRAM_API_HASH || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

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
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (_: any, res: any) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

// ============================================
// UPLOAD SESSION MANAGEMENT
// ============================================

interface UploadSession {
    chunks: Map<number, Buffer>;
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

// Clean up stale sessions (older than 2 hours)
function cleanupStaleSessions() {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    let cleaned = 0;
    for (const [id, session] of uploadSessions.entries()) {
        if (session.lastActivity < twoHoursAgo) {
            uploadSessions.delete(id);
            cleaned++;
        }
    }
    if (cleaned > 0) {
        console.log(`🧹 Cleaned up ${cleaned} stale upload sessions`);
    }
}

// Run cleanup every 30 minutes
setInterval(cleanupStaleSessions, 30 * 60 * 1000);

// Helper: Create and connect a Telegram client
async function createTelegramClient(session: string): Promise<TelegramClient> {
    const client = new TelegramClient(
        new StringSession(session),
        TELEGRAM_API_ID,
        TELEGRAM_API_HASH,
        {
            connectionRetries: 5,
            useWSS: true,
        }
    );
    await client.connect();
    return client;
}

// ============================================
// CHUNKED UPLOAD ENDPOINT
// ============================================

app.post('/upload/chunk', async (req: Request, res: Response) => {
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
            uploadSession = {
                chunks: new Map(),
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
            console.log(`📂 New session: ${uploadId} (${fileName})`);
        }

        uploadSession.lastActivity = Date.now();

        // Store chunk if not already received
        if (!uploadSession.chunks.has(chunkIndex)) {
            const chunkBuffer = Buffer.from(chunkData, 'base64');
            uploadSession.chunks.set(chunkIndex, chunkBuffer);
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

app.post('/upload/finalize', async (req: Request, res: Response) => {
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

    console.log(`🔧 Assembling ${uploadSession.totalChunks} chunks...`);

    try {
        // Assemble file from chunks (in order)
        const orderedChunks: Buffer[] = [];
        for (let i = 0; i < uploadSession.totalChunks; i++) {
            orderedChunks.push(uploadSession.chunks.get(i)!);
        }
        const fileBuffer = Buffer.concat(orderedChunks);
        console.log(`📄 File: ${uploadSession.fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(1)}MB)`);

        // Free chunk memory immediately
        uploadSession.chunks.clear();

        // Connect to Telegram
        console.log('🔌 Connecting to Telegram...');
        const client = await createTelegramClient(session);

        const me = await client.getMe();
        if (!me) {
            uploadSessions.delete(uploadId);
            return res.status(401).json({ error: 'Invalid Telegram session.' });
        }
        console.log(`✅ Connected as: ${(me as any).username || (me as any).firstName}`);

        // Upload buffer directly to Telegram using CustomFile
        console.log('📤 Uploading to Telegram...');
        const customFile = new CustomFile(
            uploadSession.fileName,
            fileBuffer.length,
            '',  // no file path, using buffer
            fileBuffer
        );
        const toUpload = await client.uploadFile({
            file: customFile,
            workers: 4,
        });

        // Send to Saved Messages
        const result = await client.invoke(
            new Api.messages.SendMedia({
                peer: 'me',
                media: new Api.InputMediaUploadedDocument({
                    file: toUpload,
                    mimeType: uploadSession.mimeType || 'application/octet-stream',
                    attributes: [
                        new Api.DocumentAttributeFilename({
                            fileName: uploadSession.fileName,
                        }),
                    ],
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

        await client.disconnect();
        uploadSessions.delete(uploadId);

        console.log(`✅ MessageId: ${messageId}, FileId: ${fileId}`);

        return res.json({
            success: true,
            messageId,
            fileId,
            fileName: uploadSession.fileName,
            fileSize: fileBuffer.length,
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
// DOWNLOAD ENDPOINT (for BYOD files)
// ============================================

app.post('/download', async (req: Request, res: Response) => {
    const { messageId, session } = req.body;

    if (!messageId || !session) {
        return res.status(400).json({ error: 'Missing messageId or session' });
    }

    let client: TelegramClient | null = null;

    try {
        console.log(`📥 Download request for message ${messageId}`);
        client = await createTelegramClient(session);

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
        let fileName = 'file';
        const media = message.media as any;
        if (media.document) {
            contentType = media.document.mimeType || contentType;
            for (const attr of media.document.attributes || []) {
                if (attr.fileName) {
                    fileName = attr.fileName;
                }
            }
        }

        console.log(`📥 Downloaded: ${fileName} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);

        await client.disconnect();

        // Send file as response
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Length', buffer.length.toString());
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.send(buffer);

    } catch (error: any) {
        console.error('❌ Download error:', error);
        if (client) {
            try { await client.disconnect(); } catch (e) { /* ignore */ }
        }

        if (error.message?.includes('AUTH_KEY_UNREGISTERED') ||
            error.message?.includes('SESSION_REVOKED')) {
            return res.status(401).json({ error: 'Session expired.' });
        }

        return res.status(500).json({ error: error.message || 'Download failed' });
    }
});

// ============================================
// STREAM URL ENDPOINT (returns a temporary download URL)
// ============================================

app.post('/download/url', async (req: Request, res: Response) => {
    // This endpoint returns info needed to build a download request
    // The frontend will use this to create blob URLs for preview
    return res.json({
        method: 'POST',
        endpoint: '/download',
        description: 'Send messageId and session to download file',
    });
});

// ============================================
// STATUS ENDPOINT
// ============================================

app.get('/upload/status/:uploadId', (req: Request, res: Response) => {
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

app.get('/stats', (_: any, res: any) => {
    const sessions = Array.from(uploadSessions.values());
    const totalMemoryUsed = sessions.reduce((sum, s) => sum + s.totalSize, 0);

    res.json({
        activeSessions: uploadSessions.size,
        totalMemoryUsedMB: Math.round(totalMemoryUsed / 1024 / 1024 * 100) / 100,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
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
