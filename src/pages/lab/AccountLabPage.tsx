import { useState, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { getMtprotoClient, isSharedWorkerSupported } from '@/lib/mtprotoPort';

/**
 * /lab/account — the Task 2.0 hard gate, as a page you can actually use.
 *
 * Proves, on the deployed domain and under the production CSP, that:
 *   1. a browser can open a WebSocket to a Telegram DC,
 *   2. the full MTProto auth-key exchange completes,
 *   3. an authenticated API call succeeds,
 *   4. QR login works end to end (you scan, your name appears),
 *   5. the private "HCloud Storage" channel can be created,
 *   6. all of it through ONE client in a SharedWorker.
 *
 * Step 3 is the real gate. Steps 1–2 were already proven at the transport level
 * from Node (R1), but a browser adds the CSP `connect-src` allowlist and WASM
 * crypto, so the handshake had to be re-proven here.
 */

type Step = { label: string; state: 'idle' | 'running' | 'ok' | 'fail'; detail?: string };

const INITIAL: Step[] = [
    { label: 'SharedWorker available', state: 'idle' },
    { label: 'Connect to DC + MTProto auth-key exchange', state: 'idle' },
    { label: 'Authenticated API call (help.getConfig)', state: 'idle' },
    { label: 'QR login', state: 'idle' },
    { label: 'Create "HCloud Storage" channel', state: 'idle' },
];

export default function AccountLabPage() {
    const [steps, setSteps] = useState<Step[]>(INITIAL);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [me, setMe] = useState<string | null>(null);
    const [channel, setChannel] = useState<string | null>(null);
    const [log, setLog] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    const set = useCallback((i: number, patch: Partial<Step>) => {
        setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    }, []);

    const say = useCallback((line: string) => {
        // Timestamped so the transcript is usable as a gate artifact.
        setLog((prev) => [...prev, `${new Date().toISOString().slice(11, 23)}  ${line}`]);
    }, []);

    const run = async () => {
        setBusy(true);
        setSteps(INITIAL);
        setQrDataUrl(null);
        setMe(null);
        setChannel(null);
        setLog([]);

        try {
            // ── 1. SharedWorker ────────────────────────────────────────────────
            set(0, { state: 'running' });
            if (!isSharedWorkerSupported()) {
                set(0, { state: 'fail', detail: 'SharedWorker is not available in this browser' });
                say('FAIL: no SharedWorker. Safari and some mobile browsers lack it.');
                return;
            }
            const { port, tg } = getMtprotoClient();
            set(0, { state: 'ok', detail: 'one client, shared across tabs' });
            say('SharedWorker connected (hcloud-mtproto)');

            // ── 2 + 3. Handshake, proven by a call that requires an auth key ────
            // help.getConfig is an ENCRYPTED call: it cannot succeed unless the
            // auth-key exchange completed. So a result here proves both steps.
            set(1, { state: 'running' });
            set(2, { state: 'running' });
            say('calling help.getConfig — this forces connect + auth-key exchange');
            const t0 = performance.now();
            const config = await port.call({ _: 'help.getConfig' });
            const ms = Math.round(performance.now() - t0);

            const dcs = (config as { dcOptions?: unknown[] }).dcOptions?.length ?? 0;
            set(1, { state: 'ok', detail: `handshake completed in ${ms} ms` });
            set(2, { state: 'ok', detail: `help.getConfig returned ${dcs} dcOptions` });
            say(`OK: auth key established, help.getConfig -> ${dcs} dcOptions (${ms} ms)`);
            say(`primary DC: ${await port.getPrimaryDcId()}`);

            // ── 4. QR login ────────────────────────────────────────────────────
            set(3, { state: 'running', detail: 'waiting for you to scan' });
            const abort = new AbortController();
            abortRef.current = abort;

            const user = await tg.signInQr({
                onUrlUpdated: (url, expires) => {
                    // The URL is a login token. It is rendered locally and never
                    // sent anywhere — that is why QR generation is a bundled
                    // dependency rather than an image service.
                    QRCode.toDataURL(url, { width: 288, margin: 2 })
                        .then(setQrDataUrl)
                        .catch(() => setQrDataUrl(null));
                    say(`QR updated, expires ${expires.toISOString().slice(11, 19)}`);
                },
                onQrScanned: () => {
                    say('scanned — finalising authorisation');
                    set(3, { state: 'running', detail: 'scanned, finalising…' });
                },
                abortSignal: abort.signal,
            });

            const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || String(user.id);
            setMe(name);
            setQrDataUrl(null);
            set(3, { state: 'ok', detail: `signed in as ${name}` });
            say(`OK: signed in as ${name}${user.username ? ` (@${user.username})` : ''}`);

            // ── 5. Storage channel ─────────────────────────────────────────────
            set(4, { state: 'running' });
            const TITLE = 'HCloud Storage';

            // Reuse an existing channel rather than creating a duplicate on every
            // run — this page is meant to be re-runnable.
            let found: string | null = null;
            for await (const dialog of tg.iterDialogs({ archived: 'exclude' })) {
                // Dialog.peer is User | Chat; only a Chat has chatType/title.
                const peer = dialog.peer;
                if ('chatType' in peer && peer.chatType === 'channel' && peer.title === TITLE) {
                    found = peer.title;
                    say(`existing channel found: "${peer.title}" (id ${peer.id})`);
                    break;
                }
            }

            if (found) {
                setChannel(found);
                set(4, { state: 'ok', detail: 'existing channel reused' });
            } else {
                say(`creating private channel "${TITLE}"`);
                const created = await tg.createChannel({
                    title: TITLE,
                    description: 'HCloud file storage. Managed automatically — do not delete.',
                });
                setChannel(created.title);
                set(4, { state: 'ok', detail: `created, id ${created.id}` });
                say(`OK: created "${created.title}" (id ${created.id})`);
            }
        } catch (err) {
            const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            say(`ERROR: ${msg}`);
            setSteps((prev) => {
                const i = prev.findIndex((s) => s.state === 'running');
                if (i === -1) return prev;
                return prev.map((s, idx) => (idx === i ? { ...s, state: 'fail', detail: msg } : s));
            });
        } finally {
            abortRef.current = null;
            setBusy(false);
        }
    };

    const cancel = () => {
        abortRef.current?.abort();
        say('cancelled');
    };

    return (
        <div className="min-h-screen bg-background text-foreground p-6 max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold">Account mode — Task 2.0 gate</h1>
            <p className="text-sm text-muted-foreground mt-1">
                Browser MTProto via mtcute, one client in a SharedWorker. Nothing here touches
                our servers: the connection is browser → Telegram.
            </p>

            <div className="flex gap-2 mt-5">
                <button
                    onClick={run}
                    disabled={busy}
                    className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-medium disabled:opacity-50"
                >
                    {busy ? 'Running…' : 'Run the gate'}
                </button>
                {busy && (
                    <button onClick={cancel} className="px-4 py-2 rounded-xl border border-border">
                        Cancel
                    </button>
                )}
            </div>

            <ol className="mt-6 space-y-2">
                {steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                        <span className="w-5 shrink-0 text-center" aria-hidden>
                            {s.state === 'ok' ? '✓' : s.state === 'fail' ? '✗' : s.state === 'running' ? '·' : '○'}
                        </span>
                        <span>
                            <span className={s.state === 'fail' ? 'text-destructive' : ''}>{s.label}</span>
                            {s.detail && <span className="text-muted-foreground"> — {s.detail}</span>}
                        </span>
                    </li>
                ))}
            </ol>

            {qrDataUrl && (
                <div className="mt-6 p-4 rounded-2xl border border-border inline-block bg-white">
                    <img src={qrDataUrl} alt="Telegram login QR code" width={288} height={288} />
                    <p className="text-xs text-center mt-2 text-black/70 max-w-[288px]">
                        Telegram → Settings → Devices → Link Desktop Device
                    </p>
                </div>
            )}

            {me && (
                <div className="mt-6 p-4 rounded-xl bg-primary/10 border border-primary/30">
                    <p className="text-sm">Signed in as <strong>{me}</strong></p>
                    {channel && <p className="text-sm mt-1">Storage channel: <strong>{channel}</strong></p>}
                </div>
            )}

            {log.length > 0 && (
                <pre className="mt-6 p-4 rounded-xl bg-muted/50 text-xs overflow-x-auto whitespace-pre-wrap">
                    {log.join('\n')}
                </pre>
            )}
        </div>
    );
}
