import { Buffer } from 'buffer';
import process from 'process';

// Ensure global exists
if (typeof window !== 'undefined') {
    (window as any).global = window;

    if (!window.Buffer) {
        (window as any).Buffer = Buffer;
    }
    if (!window.process) {
        (window as any).process = process;
    }
}
