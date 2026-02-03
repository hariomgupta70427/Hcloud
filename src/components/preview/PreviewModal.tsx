import { AnimatePresence } from 'framer-motion';
import { ImagePreview } from './ImagePreview';
import { VideoPreview } from './VideoPreview';
import { AudioPreview } from './AudioPreview';
import { PDFPreview } from './PDFPreview';
import { CodePreview } from './CodePreview';
import { OfficePreview } from './OfficePreview';

export type PreviewType = 'image' | 'video' | 'audio' | 'pdf' | 'office' | 'code' | 'unknown';

export interface PreviewFile {
    id: string;
    name: string;
    url: string;
    type: PreviewType;
    mimeType?: string;
    content?: string; // For code/text files
    thumbnailUrl?: string;
}

interface PreviewModalProps {
    file: PreviewFile | null;
    isOpen: boolean;
    onClose: () => void;
    onDownload?: (file: PreviewFile) => void;
    files?: PreviewFile[]; // For gallery navigation
}

// Detect file type from extension or mime type
export function getPreviewType(filename: string, mimeType?: string): PreviewType {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    // Image types
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    if (imageExts.includes(ext) || mimeType?.startsWith('image/')) {
        return 'image';
    }

    // Video types
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    if (videoExts.includes(ext) || mimeType?.startsWith('video/')) {
        return 'video';
    }

    // Audio types
    const audioExts = ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'];
    if (audioExts.includes(ext) || mimeType?.startsWith('audio/')) {
        return 'audio';
    }

    // PDF
    if (ext === 'pdf' || mimeType === 'application/pdf') {
        return 'pdf';
    }

    // Office Documents
    const officeExts = ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
    if (officeExts.includes(ext) ||
        mimeType?.includes('msword') ||
        mimeType?.includes('office') ||
        mimeType?.includes('spreadsheet') ||
        mimeType?.includes('presentation')) {
        return 'office';
    }

    // Code/text types
    const codeExts = [
        'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'java', 'cpp', 'c', 'cs', 'go', 'rs',
        'php', 'html', 'css', 'scss', 'json', 'xml', 'md', 'yaml', 'yml', 'sql',
        'sh', 'bash', 'txt', 'log', 'env', 'gitignore', 'dockerfile'
    ];
    if (codeExts.includes(ext) || mimeType?.startsWith('text/')) {
        return 'code';
    }

    return 'unknown';
}

export function PreviewModal({
    file,
    isOpen,
    onClose,
    onDownload,
    files = [],
}: PreviewModalProps) {
    if (!file) return null;

    const currentIndex = files.findIndex((f) => f.id === file.id);
    const handleNavigate = (index: number) => {
        // This would be handled by parent component
        console.log('Navigate to index:', index);
    };

    const handleDownload = () => {
        if (onDownload && file) {
            onDownload(file);
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {file.type === 'image' && (
                        <ImagePreview
                            src={file.url}
                            alt={file.name}
                            onClose={onClose}
                            onDownload={handleDownload}
                            images={files.filter((f) => f.type === 'image').map((f) => ({ src: f.url, alt: f.name }))}
                            currentIndex={currentIndex}
                            onNavigate={handleNavigate}
                        />
                    )}

                    {file.type === 'video' && (
                        <VideoPreview
                            src={file.url}
                            title={file.name}
                            poster={file.thumbnailUrl}
                            onClose={onClose}
                            onDownload={handleDownload}
                        />
                    )}

                    {file.type === 'audio' && (
                        <AudioPreview
                            src={file.url}
                            title={file.name}
                            cover={file.thumbnailUrl}
                            onClose={onClose}
                            onDownload={handleDownload}
                        />
                    )}

                    {file.type === 'pdf' && (
                        <PDFPreview
                            src={file.url}
                            title={file.name}
                            onClose={onClose}
                            onDownload={handleDownload}
                        />
                    )}

                    {file.type === 'office' && (
                        <OfficePreview
                            src={file.url}
                            title={file.name}
                            onClose={onClose}
                            onDownload={handleDownload}
                        />
                    )}

                    {file.type === 'code' && file.content && (
                        <CodePreview
                            content={file.content}
                            filename={file.name}
                            onClose={onClose}
                            onDownload={handleDownload}
                        />
                    )}

                    {file.type === 'unknown' && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
                            <div className="bg-card p-8 rounded-2xl border border-border text-center max-w-md mx-4">
                                <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-muted flex items-center justify-center">
                                    <span className="text-2xl">📄</span>
                                </div>
                                <h3 className="text-lg font-semibold text-foreground mb-2">
                                    Preview not available
                                </h3>
                                <p className="text-muted-foreground mb-6">
                                    This file type cannot be previewed. Download the file to view it.
                                </p>
                                <div className="flex gap-3 justify-center">
                                    <button
                                        onClick={onClose}
                                        className="px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
                                    >
                                        Close
                                    </button>
                                    {onDownload && (
                                        <button
                                            onClick={handleDownload}
                                            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                        >
                                            Download
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}
        </AnimatePresence>
    );
}
