/**
 * Single source of truth for file-type resolution.
 *
 * WHY THIS EXISTS
 * ---------------
 * The browser's `File.type` is unreliable: it is populated from the OS registry,
 * and Windows leaves it EMPTY for very common media containers (.mkv, .flac,
 * .m4v, .m4a, .opus, .ts, and often .webm). Before this module, an empty
 * `file.type` meant the file was stored as `application/octet-stream`, which
 * cascaded into three visible bugs:
 *
 *   1. Telegram received no audio/video document attributes, so the file was
 *      not treated as streamable media.
 *   2. The stream endpoint replied `Content-Type: application/octet-stream`,
 *      which browsers refuse to play in <video>/<audio>.
 *   3. The Videos/Audio filters and dashboard counts matched on MIME only, so
 *      the file disappeared from the media library entirely.
 *
 * Every part of the app must therefore resolve MIME and category through the
 * helpers here — never by reading `file.type` or `mimeType` directly.
 */

/** Extension -> canonical MIME type. Covers what browsers can actually play. */
const EXT_TO_MIME: Record<string, string> = {
    // ---- video ----
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    avi: 'video/x-msvideo',
    wmv: 'video/x-ms-wmv',
    flv: 'video/x-flv',
    mpeg: 'video/mpeg',
    mpg: 'video/mpeg',
    '3gp': 'video/3gpp',
    ogv: 'video/ogg',
    ts: 'video/mp2t',

    // ---- audio ----
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    wav: 'audio/wav',
    flac: 'audio/flac',
    opus: 'audio/opus',
    oga: 'audio/ogg',
    ogg: 'audio/ogg',
    wma: 'audio/x-ms-wma',
    aiff: 'audio/aiff',
    mid: 'audio/midi',
    midi: 'audio/midi',

    // ---- image ----
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    avif: 'image/avif',
    heic: 'image/heic',
    heif: 'image/heif',
    tif: 'image/tiff',
    tiff: 'image/tiff',

    // ---- documents ----
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet',
    rtf: 'application/rtf',
    epub: 'application/epub+zip',

    // ---- text / code ----
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    mjs: 'text/javascript',
    tsx: 'text/typescript',
    jsx: 'text/javascript',
    py: 'text/x-python',
    java: 'text/x-java',
    c: 'text/x-c',
    h: 'text/x-c',
    cpp: 'text/x-c++',
    cs: 'text/x-csharp',
    go: 'text/x-go',
    rs: 'text/x-rust',
    rb: 'text/x-ruby',
    php: 'text/x-php',
    sh: 'text/x-shellscript',
    sql: 'text/x-sql',
    yml: 'text/yaml',
    yaml: 'text/yaml',
    toml: 'text/plain',
    ini: 'text/plain',
    log: 'text/plain',

    // ---- archives ----
    zip: 'application/zip',
    rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',
};

/** Lowercase extension without the dot, or '' when the name has none. */
export function getExtension(fileName: string): string {
    const clean = fileName.split(/[?#]/)[0];
    const idx = clean.lastIndexOf('.');
    if (idx <= 0 || idx === clean.length - 1) return '';
    return clean.slice(idx + 1).toLowerCase();
}

/** True for MIME values that carry no useful information. */
function isGenericMime(mime?: string | null): boolean {
    if (!mime) return true;
    const m = mime.toLowerCase().trim();
    return (
        m === '' ||
        m === 'application/octet-stream' ||
        m === 'binary/octet-stream' ||
        m === 'application/unknown' ||
        m === 'unknown/unknown'
    );
}

/**
 * Resolve the best MIME type for a file.
 *
 * The filename extension WINS over a generic browser-supplied type, because
 * `application/octet-stream` is exactly the value that breaks playback. A
 * specific browser-supplied type is trusted as-is.
 */
export function resolveMimeType(fileName: string, providedMime?: string | null): string {
    if (!isGenericMime(providedMime)) return providedMime!.toLowerCase().trim();

    const ext = getExtension(fileName);
    // '.ts' is ambiguous (TypeScript source vs MPEG transport stream). Treat it
    // as video only when the browser hinted video; otherwise it is source code.
    if (ext === 'ts') {
        return providedMime?.startsWith('video/') ? 'video/mp2t' : 'text/typescript';
    }
    return EXT_TO_MIME[ext] || 'application/octet-stream';
}

/** Broad buckets used by filters, dashboard counts, icons and colors. */
export type FileCategory =
    | 'video'
    | 'audio'
    | 'image'
    | 'document'
    | 'archive'
    | 'code'
    | 'other';

const CODE_EXTS = new Set([
    'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'h', 'cpp', 'hpp',
    'cc', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'kts', 'scala', 'sh',
    'bash', 'zsh', 'ps1', 'sql', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini',
    'html', 'htm', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'dart', 'lua',
    'r', 'pl', 'ex', 'exs', 'erl', 'hs', 'clj', 'graphql', 'proto', 'dockerfile',
]);

const ARCHIVE_EXTS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst']);

const DOC_EXTS = new Set([
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
    'rtf', 'txt', 'md', 'csv', 'epub', 'pages', 'numbers', 'key',
]);

/**
 * Classify a file into a single category using BOTH the MIME type and the
 * extension, so a file stored as `application/octet-stream` is still correctly
 * recognised as video/audio.
 */
export function getFileCategory(fileName: string, mimeType?: string | null): FileCategory {
    const mime = resolveMimeType(fileName, mimeType);
    const ext = getExtension(fileName);

    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('image/')) return 'image';

    if (ARCHIVE_EXTS.has(ext)) return 'archive';
    if (DOC_EXTS.has(ext)) return 'document';
    if (CODE_EXTS.has(ext)) return 'code';

    if (mime === 'application/pdf' || mime.includes('word') || mime.includes('excel') ||
        mime.includes('powerpoint') || mime.includes('opendocument') ||
        mime.startsWith('text/')) {
        return 'document';
    }
    if (mime === 'application/zip' || mime === 'application/gzip' ||
        mime === 'application/x-tar' || mime === 'application/vnd.rar' ||
        mime === 'application/x-7z-compressed') {
        return 'archive';
    }

    return 'other';
}

export function isVideoFile(fileName: string, mimeType?: string | null): boolean {
    return getFileCategory(fileName, mimeType) === 'video';
}

export function isAudioFile(fileName: string, mimeType?: string | null): boolean {
    return getFileCategory(fileName, mimeType) === 'audio';
}

export function isImageFile(fileName: string, mimeType?: string | null): boolean {
    return getFileCategory(fileName, mimeType) === 'image';
}

/**
 * True when the file should be handed to the browser as a live URL (so it can
 * request byte ranges and start playing immediately) rather than downloaded to
 * a blob first. Media, images and PDFs all stream.
 */
export function isStreamableFile(fileName: string, mimeType?: string | null): boolean {
    const category = getFileCategory(fileName, mimeType);
    if (category === 'video' || category === 'audio' || category === 'image') return true;
    return resolveMimeType(fileName, mimeType) === 'application/pdf';
}

/** Human-readable label for the category, for UI copy. */
export function getCategoryLabel(category: FileCategory): string {
    switch (category) {
        case 'video': return 'Video';
        case 'audio': return 'Audio';
        case 'image': return 'Image';
        case 'document': return 'Document';
        case 'archive': return 'Archive';
        case 'code': return 'Code';
        default: return 'File';
    }
}
