import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { X, Download, Copy, Check, Code } from 'lucide-react';

interface CodePreviewProps {
    content: string;
    filename: string;
    language?: string;
    onClose: () => void;
    onDownload?: () => void;
}

// Simple language detection based on file extension
function detectLanguage(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        py: 'python',
        rb: 'ruby',
        java: 'java',
        cpp: 'cpp',
        c: 'c',
        cs: 'csharp',
        go: 'go',
        rs: 'rust',
        php: 'php',
        html: 'html',
        css: 'css',
        scss: 'scss',
        json: 'json',
        xml: 'xml',
        md: 'markdown',
        yaml: 'yaml',
        yml: 'yaml',
        sql: 'sql',
        sh: 'bash',
        bash: 'bash',
        txt: 'plaintext',
    };
    return langMap[ext] || 'plaintext';
}

export function CodePreview({
    content,
    filename,
    language: propLanguage,
    onClose,
    onDownload,
}: CodePreviewProps) {
    const [copied, setCopied] = useState(false);
    const [lineNumbers, setLineNumbers] = useState(true);
    const language = propLanguage || detectLanguage(filename);
    const lines = content.split('\n');

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col bg-[#1e1e1e]"
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#252526] border-b border-[#3c3c3c]">
                <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/20">
                        <Code size={20} className="text-blue-400" />
                    </div>
                    <div>
                        <span className="text-white font-medium">{filename}</span>
                        <span className="text-white/40 text-sm ml-2">({language})</span>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {/* Line numbers toggle */}
                    <button
                        onClick={() => setLineNumbers(!lineNumbers)}
                        className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${lineNumbers
                                ? 'bg-white/10 text-white'
                                : 'text-white/60 hover:text-white hover:bg-white/5'
                            }`}
                    >
                        Line #
                    </button>

                    {/* Copy */}
                    <button
                        onClick={handleCopy}
                        className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors flex items-center gap-2"
                        title="Copy code"
                    >
                        {copied ? <Check size={20} className="text-green-400" /> : <Copy size={20} />}
                    </button>

                    {onDownload && (
                        <button
                            onClick={onDownload}
                            className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                            title="Download"
                        >
                            <Download size={20} />
                        </button>
                    )}

                    <button
                        onClick={onClose}
                        className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* Code content */}
            <div className="flex-1 overflow-auto">
                <pre className="min-h-full">
                    <code className="block p-4 text-sm font-mono leading-relaxed">
                        {lines.map((line, index) => (
                            <div key={index} className="flex hover:bg-white/5">
                                {lineNumbers && (
                                    <span className="select-none text-white/30 w-12 text-right pr-4 flex-shrink-0">
                                        {index + 1}
                                    </span>
                                )}
                                <span className="text-[#d4d4d4] flex-1 whitespace-pre-wrap break-all">
                                    {line || ' '}
                                </span>
                            </div>
                        ))}
                    </code>
                </pre>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#007acc] text-white text-sm">
                <span>{lines.length} lines</span>
                <span>{content.length} characters</span>
            </div>
        </motion.div>
    );
}
