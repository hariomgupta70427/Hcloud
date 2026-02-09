import type { VercelRequest, VercelResponse } from '@vercel/node';
import { TelegramClient, sessions, client as clientUtils } from 'telegram';
const { StringSession } = sessions;
const { CustomFile } = clientUtils.uploads;

const API_ID = parseInt(process.env.TELEGRAM_API_ID || '0');
const API_HASH = process.env.TELEGRAM_API_HASH || '';

// In-memory storage for chunks (will be replaced with proper temp storage in production)
// Key: uploadId, Value: { chunks: Buffer[], fileName: string, totalChunks: number, session: string }
const uploadSessions: Map<string, {
    chunks: (Buffer | null)[];
    fileName: string;
    mimeType: string;
    totalChunks: number;
    session: string;
    receivedCount: number;
    createdAt: number;
}> = new Map();

// Clean up old sessions (older than 1 hour)
function cleanupOldSessions() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [id, session] of uploadSessions.entries()) {
        if (session.createdAt < oneHourAgo) {
            uploadSessions.delete(id);
            console.log(`[ChunkedUpload] Cleaned up stale session: ${id}`);
        }
    }
}

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '5mb', // Slightly more than chunk size for overhead
        },
    },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Clean up old sessions periodically
    cleanupOldSessions();

    try {
        const {
            uploadId,
            chunkIndex,
            totalChunks,
            chunkData, // base64 encoded chunk
            fileName,
            mimeType,
            session,
            action // 'chunk' or 'finalize'
        } = req.body;

        console.log(`[ChunkedUpload] Received: action=${action}, uploadId=${uploadId}, chunk=${chunkIndex}/${totalChunks}`);

        if (!uploadId || !session) {
            return res.status(400).json({ error: 'uploadId and session are required' });
        }

        // Handle chunk upload
        if (action === 'chunk') {
            if (chunkIndex === undefined || !chunkData || !totalChunks) {
                return res.status(400).json({ error: 'chunkIndex, chunkData, and totalChunks are required' });
            }

            // Initialize or get upload session
            let uploadSession = uploadSessions.get(uploadId);
            if (!uploadSession) {
                uploadSession = {
                    chunks: new Array(totalChunks).fill(null),
                    fileName: fileName || 'file',
                    mimeType: mimeType || 'application/octet-stream',
                    totalChunks,
                    session,
                    receivedCount: 0,
                    createdAt: Date.now(),
                };
                uploadSessions.set(uploadId, uploadSession);
                console.log(`[ChunkedUpload] Created new session: ${uploadId}`);
            }

            // Store the chunk
            const chunkBuffer = Buffer.from(chunkData, 'base64');
            if (!uploadSession.chunks[chunkIndex]) {
                uploadSession.chunks[chunkIndex] = chunkBuffer;
                uploadSession.receivedCount++;
            }

            console.log(`[ChunkedUpload] Stored chunk ${chunkIndex}, received ${uploadSession.receivedCount}/${totalChunks}`);

            return res.status(200).json({
                success: true,
                received: uploadSession.receivedCount,
                total: totalChunks,
            });
        }

        // Handle finalize (assemble and upload to Telegram)
        if (action === 'finalize') {
            const uploadSession = uploadSessions.get(uploadId);
            if (!uploadSession) {
                return res.status(400).json({ error: 'Upload session not found' });
            }

            // Check if all chunks received
            if (uploadSession.receivedCount < uploadSession.totalChunks) {
                return res.status(400).json({
                    error: `Not all chunks received: ${uploadSession.receivedCount}/${uploadSession.totalChunks}`
                });
            }

            // Verify no null chunks
            const missingChunks = uploadSession.chunks.findIndex(c => c === null);
            if (missingChunks !== -1) {
                return res.status(400).json({ error: `Missing chunk at index ${missingChunks}` });
            }

            console.log(`[ChunkedUpload] Assembling ${uploadSession.totalChunks} chunks...`);

            // Assemble file from chunks
            const fileBuffer = Buffer.concat(uploadSession.chunks as Buffer[]);
            console.log(`[ChunkedUpload] Assembled file: ${uploadSession.fileName}, size: ${fileBuffer.length}`);

            // Create Telegram client
            const client = new TelegramClient(
                new StringSession(uploadSession.session),
                API_ID,
                API_HASH,
                {
                    connectionRetries: 10,
                    useWSS: true,
                }
            );

            console.log('[ChunkedUpload] Connecting to Telegram...');
            await client.connect();

            // Verify session
            const me = await client.getMe();
            if (!me) {
                uploadSessions.delete(uploadId);
                return res.status(401).json({ error: 'Invalid Telegram session' });
            }
            console.log(`[ChunkedUpload] Connected as: ${(me as any).username || (me as any).firstName}`);

            // Create file for upload
            const file = new CustomFile(
                uploadSession.fileName,
                fileBuffer.length,
                '',
                fileBuffer
            );

            console.log('[ChunkedUpload] Uploading to Saved Messages...');

            // Upload to Saved Messages
            const result = await client.sendFile('me', {
                file: file,
                caption: '',
                forceDocument: true,
                progressCallback: (progress) => {
                    console.log(`[ChunkedUpload] Upload progress: ${Math.round(progress * 100)}%`);
                },
            });

            console.log(`[ChunkedUpload] Upload complete, messageId: ${result.id}`);

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

            await client.disconnect();

            // Clean up session
            uploadSessions.delete(uploadId);

            return res.status(200).json({
                success: true,
                messageId: result.id,
                fileId,
            });
        }

        return res.status(400).json({ error: 'Invalid action. Use "chunk" or "finalize"' });

    } catch (error: any) {
        console.error('[ChunkedUpload] Error:', error);

        if (error.message?.includes('AUTH_KEY_UNREGISTERED') ||
            error.message?.includes('SESSION_REVOKED')) {
            return res.status(401).json({ error: 'Session expired. Please re-authenticate.' });
        }

        return res.status(500).json({ error: error.message || 'Upload failed' });
    }
}
