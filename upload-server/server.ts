/**
 * HCloud Upload Server
 * Dedicated Express server for handling large file uploads to Telegram
 * Deployed on Render for unlimited timeout and persistent connections
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { TelegramClient, sessions } from 'telegram';
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
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, etc.)
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
app.get('/health', (_, res) => {
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

        console.log(`📦 Chunk ${chunkIndex + 1}/${totalChunks} for ${uploadId}`);

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
            console.log(`📂 Created new upload session: ${uploadId}`);
        }

        // Update last activity
        uploadSession.lastActivity = Date.now();

        // Store chunk if not already received
        if (!uploadSession.chunks.has(chunkIndex)) {
            const chunkBuffer = Buffer.from(chunkData, 'base64');
            uploadSession.chunks.set(chunkIndex, chunkBuffer);
            uploadSession.receivedCount++;
            uploadSession.totalSize += chunkBuffer.length;
        }

        const progress = Math.round((uploadSession.receivedCount / totalChunks) * 100);
        console.log(`📊 Progress: ${uploadSession.receivedCount}/${totalChunks} (${progress}%)`);

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
            received: uploadSession.receivedCount,
            expected: uploadSession.totalChunks,
        });
    }

    // Verify no missing chunks
    for (let i = 0; i < uploadSession.totalChunks; i++) {
        if (!uploadSession.chunks.has(i)) {
            return res.status(400).json({ error: `Missing chunk at index ${i}` });
        }
    }

    console.log(`🔧 Assembling ${uploadSession.totalChunks} chunks for ${uploadId}...`);

    try {
        // Assemble file from chunks (in order)
        const orderedChunks: Buffer[] = [];
        for (let i = 0; i < uploadSession.totalChunks; i++) {
            orderedChunks.push(uploadSession.chunks.get(i)!);
        }
        const fileBuffer = Buffer.concat(orderedChunks);

        console.log(`📄 Assembled file: ${uploadSession.fileName} (${fileBuffer.length} bytes)`);

        // Clear chunks from memory to free up RAM
        uploadSession.chunks.clear();

        // Create Telegram client
        console.log('🔌 Connecting to Telegram...');
        const client = new TelegramClient(
            new StringSession(session),
            TELEGRAM_API_ID,
            TELEGRAM_API_HASH,
            {
                connectionRetries: 10,
                useWSS: true,
            }
        );

        await client.connect();

        // Verify session
        const me = await client.getMe();
        if (!me) {
            uploadSessions.delete(uploadId);
            return res.status(401).json({ error: 'Invalid Telegram session. Please re-authenticate.' });
        }

        console.log(`✅ Connected as: ${(me as any).username || (me as any).firstName}`);
        console.log('📤 Uploading to Telegram Saved Messages...');

        // Upload to Saved Messages using streaming
        const result = await client.sendFile('me', {
            file: new (await import('telegram/client/uploads.js')).CustomFile(
                uploadSession.fileName,
                fileBuffer.length,
                '',
                fileBuffer
            ),
            caption: '',
            forceDocument: true,
            progressCallback: (progress: number) => {
                const percent = Math.round(progress * 100);
                if (percent % 10 === 0) {
                    console.log(`📤 Telegram upload: ${percent}%`);
                }
            },
        });

        console.log(`✅ Upload complete! Message ID: ${result.id}`);

        // Extract file ID
        let fileId = '';
        if (result.media) {
            const media = result.media as any;
            if (media.document) {
                fileId = media.document.id.toString();
            } else if (media.photo) {
                fileId = `photo_${media.photo.id}`;
            }
        }

        // Disconnect and cleanup
        await client.disconnect();
        uploadSessions.delete(uploadId);

        return res.json({
            success: true,
            messageId: result.id,
            fileId,
            fileName: uploadSession.fileName,
            fileSize: fileBuffer.length,
        });

    } catch (error: any) {
        console.error('❌ Finalize error:', error);

        // Clean up session on error
        uploadSessions.delete(uploadId);

        if (error.message?.includes('AUTH_KEY_UNREGISTERED') ||
            error.message?.includes('SESSION_REVOKED')) {
            return res.status(401).json({ error: 'Session expired. Please re-authenticate in Settings.' });
        }

        return res.status(500).json({ error: error.message || 'Upload finalization failed' });
    }
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
        createdAt: new Date(session.createdAt).toISOString(),
        lastActivity: new Date(session.lastActivity).toISOString(),
    });
});

// ============================================
// CANCEL UPLOAD ENDPOINT
// ============================================

app.delete('/upload/:uploadId', (req: Request, res: Response) => {
    const { uploadId } = req.params;

    if (uploadSessions.has(uploadId)) {
        uploadSessions.delete(uploadId);
        console.log(`🗑️ Cancelled upload session: ${uploadId}`);
        return res.json({ success: true, message: 'Upload cancelled' });
    }

    return res.status(404).json({ error: 'Upload session not found' });
});

// ============================================
// SERVER STATS ENDPOINT
// ============================================

app.get('/stats', (_, res) => {
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
    console.log(`   Telegram API ID: ${TELEGRAM_API_ID ? '✅ Set' : '❌ Missing'}`);
    console.log(`   Telegram API Hash: ${TELEGRAM_API_HASH ? '✅ Set' : '❌ Missing'}`);
    console.log('🚀 ================================');
    console.log('');
});
