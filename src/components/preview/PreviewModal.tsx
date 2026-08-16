import { AnimatePresence } from 'framer-motion';
import { ImagePreview } from './ImagePreview';
import { VideoPreview } from './VideoPreview';
import { AudioPreview } from './AudioPreview';
import { PDFPreview } from './PDFPreview';
import { CodePreview } from './CodePreview';
import { OfficePreview } from './OfficePreview';
import { getExtension, getFileCategory, resolveMimeType } from '@/lib/fileTypes';

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
    onNavigate?: (file: PreviewFile) => void; // Callback when navigating gallery
}

const OFFICE_EXTS = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp']);

/**
 * Pick which preview component renders a file.
 *
 * Delegates media/image detection to the shared resolver in @/lib/fileTypes so
 * that a file whose stored MIME is `application/octet-stream` (very common for
 * .mkv/.flac/.m4v uploaded from Windows) is still previewed as video/audio
 * instead of falling through to 'unknown'.
 */
export function getPreviewType(filename: string, mimeType?: string): PreviewType {
    const category = getFileCategory(filename, mimeType);
    if (category === 'image') return 'image';
    if (category === 'video') return 'video';
    if (category === 'audio') return 'audio';

    const mime = resolveMimeType(filename, mimeType);
    const ext = getExtension(filename);

    if (mime === 'application/pdf') return 'pdf';

    if (OFFICE_EXTS.has(ext) ||
        mime.includes('msword') ||
        mime.includes('officedocument') ||
        mime.includes('spreadsheet') ||
        mime.includes('presentation')) {
        return 'office';
    }

    if (category === 'code' || mime.startsWith('text/')) return 'code';

    // Extension-less dotfiles and build files are still readable as text.
    const textLikeNames = ['dockerfile', 'makefile', 'gitignore', 'env', 'license', 'readme'];
    if (textLikeNames.includes(filename.toLowerCase().replace(/^\./, ''))) return 'code';

    return 'unknown';
}

export function PreviewModal({
    file,
    isOpen,
    onClose,
    onDownload,
    files = [],
    onNavigate,
}: PreviewModalProps) {
    if (!file) return null;

    const currentIndex = files.findIndex((f) => f.id === file.id);
    const handleNavigate = (index: number) => {
        const targetFile = files[index];
        if (targetFile && onNavigate) {
            onNavigate(targetFile);
        }
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
