
import { Buffer } from 'buffer';
import process from 'process';

if (typeof window !== 'undefined') {
    if (!window.Buffer) {
        window.Buffer = Buffer;
    }
    if (!window.process) {
        window.process = process;
    }
}
