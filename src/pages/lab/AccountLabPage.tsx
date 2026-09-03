import { useState, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import {
    getMtprotoClient,
    isSharedWorkerSupported,
    hasPersistedAuthKey,
    isSessionRevoked,
    resetLocalSession,
} from '@/lib/mtprotoPort';
import { resolveStorageChannel, CHANNEL_SCHEMA_VERSION } from '@/lib/storageChannel';

/**
 * /lab/account — the Task 2.0 hard gate, as a page you can actually use.
 *
 * Step labels here are deliberately pedantic, because two earlier versions of this
 * page reported passes it had not earned:
 *
 *   • "handshake completed in 88 ms" on a run that performed NO handshake — it
 *     reused an auth key persisted by an earlier login. Now the presence of a
 *     stored key is checked first and the two cases are labelled differently.
 *   • "Authenticated API call" for help.getConfig, which requires only a valid
 *     auth key and says NOTHING about being signed in. Proven by a real log:
 *     help.getConfig succeeded at 16:43:48 while sign-in happened at 16:46:07.
 *     Authorisation now has its own step, after login.
 */

type Step = { label: string; state: 'idle' | 'running' | 'ok' | 'fail'; detail?: string };

const INITIAL: Step[] = [
    { label: 'SharedWorker available', state: 'idle' },
    { label: 'Auth key + transport', state: 'idle' },
    { label: 'Encrypted MTProto call (help.getConfig) — proves a valid auth key, NOT authorisation', state: 'idle' },
    { label: 'QR login (+ 2FA if enabled)', state: 'idle' },
    { label: 'Authorisation proven (users.getFullUser self)', state: 'idle' },
    { label: 'Storage channel (resolved by pinned marker, never by title)', state: 'idle' },
];

type RpcLike = { text: string; code: number; seconds?: number };
function asRpc(e: unknown): RpcLike | null {
    return e && typeof e === 'object' && 'text' in e && 'code' in e ? (e as RpcLike) : null;
}

function explain(e: unknown): string {
    const rpc = asRpc(e);
    if (!rpc) return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    switch (rpc.text) {
        case 'FLOOD_WAIT_%d':
            return `Telegram is rate-limiting this account. Wait ${rpc.seconds ?? '?'}s and try again.`;
        case 'PASSWORD_HASH_INVALID':
            return 'Incorrect cloud password.';
        case 'SESSION_PASSWORD_NEEDED':
            return 'This account has 2FA enabled but no password was supplied.';
        case 'AUTH_TOKEN_EXPIRED':
            return 'The login code expired before it was confirmed. Run the gate again.';
        case 'AUTH_TOKEN_ALREADY_ACCEPTED':
            return 'That login code was already used. Run the gate again for a fresh one.';
        default:
            return `Telegram error ${rpc.code}: ${rpc.text}`;
    }
}

/**
 * First line of every log.
 *
 * A stale browser tab once produced a transcript from pre-fix code that looked
 * valid; establishing that took a string-by-string diff of dist/. Stamping the
 * build makes a transcript self-identifying. External signals (dcOptions counts,
 * timings) are corroboration at best — Telegram can change them at will — so they
 * are never used to infer which build ran.
 */
function buildFingerprint(): string {
    return `build ${__BUILD_SHA__} · built ${__BUILD_TIME__} · marker schemaVersion ${CHANNEL_SCHEMA_VERSION}`;
}

export default function AccountLabPage() {
    const [steps, setSteps] = useState<Step[]>(INITIAL);
    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [scanState, setScanState] = useState<string | null>(null);
    const [me, setMe] = useState<string | null>(null);
    const [channel, setChannel] = useState<string | null>(null);
    const [log, setLog] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [revoked, setRevoked] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    // QR token bookkeeping, so the log shows the refresh cycle rather than leaving a
    // gap that reads like a token accepted after it expired.
    const qrTokenSeq = useRef(0);
    const qrScanned = useRef(false);
    const qrExpiryTimer = useRef<number | null>(null);

    // ── 2FA state ──────────────────────────────────────────────────────────────
    // The plaintext password lives ONLY in `pwValue` while the user is typing, and
    // is cleared the instant it is handed to mtcute. Never logged, never persisted,
    // never sent anywhere: mtcute computes the SRP proof on-device
    // (account.getPassword -> computeSrpParams -> auth.checkPassword), so Telegram
    // receives a proof, not the password.
    const [pwOpen, setPwOpen] = useState(false);
    const [pwHint, setPwHint] = useState<string | null>(null);
    const [pwError, setPwError] = useState<string | null>(null);
    const [pwVerifying, setPwVerifying] = useState(false);
    const [pwValue, setPwValue] = useState('');
    const pwResolve = useRef<((value: string) => void) | null>(null);

    const set = useCallback((i: number, patch: Partial<Step>) => {
        setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    }, []);

    const say = useCallback((line: string) => {
        // Timestamped so the transcript is usable as a gate artifact.
        // NOTHING password-derived is ever passed to this.
        setLog((prev) => [...prev, `${new Date().toISOString().slice(11, 23)}  ${line}`]);
    }, []);

    const submitPassword = () => {
        const resolve = pwResolve.current;
        if (!resolve) return;
        const secret = pwValue;
        pwResolve.current = null;
        setPwValue(''); // clear before resolving
        setPwError(null);
        setPwVerifying(true);
        resolve(secret);
    };

    /**
     * Export the log as text. Selecting the <pre> by hand lost three of four runs
     * last time, so the transcript needs a deterministic way out of the page.
     */
    const logText = () =>
        [
            '# HCloud Task 2.0 gate transcript',
            `# ${buildFingerprint()}`,
            `# captured ${new Date().toISOString()}`,
            '',
            ...steps.map((st) => `${st.state === 'ok' ? '[PASS]' : st.state === 'fail' ? '[FAIL]' : '[    ]'} ${st.label}${st.detail ? ` — ${st.detail}` : ''}`),
            '',
            ...log,
        ].join('\n');

    const copyLog = async () => {
        try {
            await navigator.clipboard.writeText(logText());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard can be blocked by permissions or a non-secure context;
            // the download button is the fallback, so say so rather than failing mute.
            say('clipboard blocked — use "Download .txt" instead');
        }
    };

    const downloadLog = () => {
        const blob = new Blob([logText()], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hcloud-gate-${__BUILD_SHA__}-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const resetSession = async () => {
        say('resetting local session: destroying worker client + deleting IndexedDB');
        await resetLocalSession(); // reloads the page
    };

    const run = async () => {
        setBusy(true);
        setSteps(INITIAL);
        setQrDataUrl(null);
        setScanState(null);
        setMe(null);
        setChannel(null);
        setLog([`${new Date().toISOString().slice(11, 23)}  ${buildFingerprint()}`]);
        setRevoked(null);
        setPwOpen(false);
        setPwHint(null);
        setPwError(null);
        setPwVerifying(false);
        setPwValue('');
        pwResolve.current = null;
        qrTokenSeq.current = 0;
        qrScanned.current = false;
        if (qrExpiryTimer.current !== null) {
            clearTimeout(qrExpiryTimer.current);
            qrExpiryTimer.current = null;
        }

        try {
            // ── 1. SharedWorker ────────────────────────────────────────────────
            set(0, { state: 'running' });
            if (!isSharedWorkerSupported()) {
                set(0, { state: 'fail', detail: 'SharedWorker is not available in this browser' });
                say('FAIL: no SharedWorker. Safari and some mobile browsers lack it.');
                return;
            }

            // Checked BEFORE connecting: once the client runs, a reused key and a
            // fresh exchange are indistinguishable by timing.
            const hadKey = await hasPersistedAuthKey();
            say(hadKey
                ? 'persisted auth key found in IndexedDB — this run will REUSE it, not perform a handshake'
                : 'no persisted auth key — this run must perform a FRESH auth-key exchange');

            const { port, tg } = getMtprotoClient();
            set(0, { state: 'ok', detail: 'one client, shared across tabs' });
            say('SharedWorker connected (hcloud-mtproto)');

            // ── 2 + 3. Auth key and transport ──────────────────────────────────
            set(1, { state: 'running' });
            set(2, { state: 'running' });
            say('calling help.getConfig');
            const t0 = performance.now();
            const config = await port.call({ _: 'help.getConfig' });
            const ms = Math.round(performance.now() - t0);

            const dcs = (config as { dcOptions?: unknown[] }).dcOptions?.length ?? 0;
            set(1, {
                state: 'ok',
                detail: hadKey
                    ? `reused persisted auth key (${ms} ms — no handshake performed)`
                    : `fresh auth-key exchange (${ms} ms)`,
            });
            // dcOptions count is a server-side detail Telegram may change at will.
            // Reported as corroboration only — never used to infer build or auth state.
            set(2, { state: 'ok', detail: `help.getConfig returned ${dcs} dcOptions (informational)` });
            say(hadKey
                ? `OK: reused persisted auth key, help.getConfig -> ${dcs} dcOptions (${ms} ms)`
                : `OK: FRESH auth-key exchange completed, help.getConfig -> ${dcs} dcOptions (${ms} ms)`);
            say(`primary DC before login: ${await port.getPrimaryDcId()}`);

            // ── 4. QR login, with 2FA ──────────────────────────────────────────
            set(3, { state: 'running', detail: 'waiting for you to scan' });
            const abort = new AbortController();
            abortRef.current = abort;

            /**
             * Passed as a FUNCTION, which matters: mtcute treats a function
             * password as "dynamic", so PASSWORD_HASH_INVALID re-prompts inside the
             * same authorisation. A plain string throws instead, discarding the
             * accepted login token and forcing a fresh scan for every typo.
             */
            const requestPassword = async (): Promise<string> => {
                // Render the field IMMEDIATELY. Awaiting account.getPassword here
                // left 3-4 seconds of blank screen after the scan, which looked
                // like the scan had failed.
                setScanState(null);
                setPwOpen(true);
                setPwVerifying(false);
                set(3, { state: 'running', detail: '2FA required — enter your cloud password' });
                say('SESSION_PASSWORD_NEEDED — login token accepted, 2FA required');

                // Hint arrives whenever it arrives; it is cosmetic and must never
                // gate typing.
                void port.call({ _: 'account.getPassword' })
                    .then((info) => {
                        const hint = (info as { hint?: string }).hint;
                        if (hint) {
                            setPwHint(hint);
                            say('password hint received');
                        }
                    })
                    .catch(() => { /* ignore */ });

                return new Promise<string>((resolve) => {
                    pwResolve.current = resolve;
                });
            };

            const user = await tg.signInQr({
                onUrlUpdated: (url, expires) => {
                    // The URL is a login token, rendered locally and never sent
                    // anywhere — hence a bundled QR encoder, not an image API.
                    QRCode.toDataURL(url, { width: 288, margin: 2 })
                        .then(setQrDataUrl)
                        .catch(() => setQrDataUrl(null));

                    // Number each token and announce when one lapses unscanned.
                    // Without this the log read "expires 13:46:15" then an acceptance
                    // at 13:46:17, which looks like a token accepted after expiry —
                    // when in fact a fresh token had been issued in between.
                    const n = ++qrTokenSeq.current;
                    const expiresAt = expires.getTime();
                    say(`QR token #${n} issued, expires ${expires.toISOString().slice(11, 19)}`);

                    if (qrExpiryTimer.current !== null) clearTimeout(qrExpiryTimer.current);
                    qrExpiryTimer.current = window.setTimeout(() => {
                        // Only report a lapse if this token is still the newest and
                        // nothing has been accepted.
                        if (qrTokenSeq.current === n && !qrScanned.current) {
                            say(`QR token #${n} expired unscanned — requesting a new one`);
                        }
                    }, Math.max(0, expiresAt - Date.now()) + 250);
                },
                onQrScanned: () => {
                    // Drop the QR and say something immediately: there can be
                    // several seconds between scan and the next screen.
                    qrScanned.current = true;
                    if (qrExpiryTimer.current !== null) {
                        clearTimeout(qrExpiryTimer.current);
                        qrExpiryTimer.current = null;
                    }
                    say(`QR token #${qrTokenSeq.current} accepted by Telegram`);
                    setQrDataUrl(null);
                    setScanState('Scan accepted — completing sign-in…');
                    say('scan accepted — login token confirmed, completing sign-in');
                    set(3, { state: 'running', detail: 'scan accepted, completing sign-in…' });
                },
                password: requestPassword,
                invalidPasswordCallback: async () => {
                    say('PASSWORD_HASH_INVALID — wrong password; prompting again (login token kept)');
                    setPwVerifying(false);
                    setPwError('Incorrect password. Try again.');
                },
                abortSignal: abort.signal,
            });

            setPwOpen(false);
            setPwHint(null);
            setPwError(null);
            setPwVerifying(false);
            setScanState(null);
            setQrDataUrl(null);

            const name =
                [user.firstName, user.lastName].filter(Boolean).join(' ') ||
                user.username ||
                String(user.id);
            setMe(`${name} (id ${user.id})`);
            set(3, { state: 'ok', detail: `signed in as ${name}` });
            say(`OK: signed in as ${name}${user.username ? ` (@${user.username})` : ''}`);

            // ── 5. Authorisation, actually proven ──────────────────────────────
            // users.getFullUser(self) REQUIRES authorisation. help.getConfig does
            // not, which is why it cannot stand in for this.
            set(4, { state: 'running' });
            // FullUser extends User, so the id is on the object itself.
            const full = await tg.getFullUser(user.id);
            const fullId = full.id;
            set(4, { state: 'ok', detail: `users.getFullUser(self) -> id ${fullId}` });
            say(`OK: authorisation proven — users.getFullUser(self) returned id ${fullId}`);
            say(`primary DC after login: ${await port.getPrimaryDcId()}`);

            // ── 6. Storage channel ─────────────────────────────────────────────
            set(5, { state: 'running' });
            const resolved = await resolveStorageChannel(tg, { log: say });
            setChannel(`${resolved.title} (id ${resolved.id}, ${resolved.origin})`);
            set(5, { state: 'ok', detail: `${resolved.origin}, id ${resolved.id}` });
        } catch (err) {
            // A revoked session is terminal: wipe and go back to QR rather than
            // leaving a signed-in-looking UI or retrying forever.
            if (isSessionRevoked(err)) {
                const rpc = asRpc(err);
                const msg = `Session no longer valid (${rpc?.text ?? 'revoked'}). Signed out on this device.`;
                say(`REVOKED: ${rpc?.text} — clearing local session and returning to QR`);
                setRevoked(msg);
                setMe(null);
                setChannel(null);
                setQrDataUrl(null);
                setPwOpen(false);
                // Do NOT blank the steps. Resetting them to INITIAL made the exported
                // transcript header show every step empty while its body showed the
                // passes that actually happened. Mark the step that was running as
                // failed and leave earlier passes intact, so the header is honest by
                // construction rather than by snapshotting.
                setSteps((prev) => {
                    const i = prev.findIndex((st) => st.state === 'running');
                    if (i === -1) return prev;
                    return prev.map((st, idx) =>
                        idx === i ? { ...st, state: 'fail', detail: msg } : st
                    );
                });
                // Do NOT reload: the message must stay on screen.
                await resetLocalSession({ reload: false });
                return;
            }

            const msg = explain(err);
            say(`ERROR: ${msg}`);
            setPwVerifying(false);
            setSteps((prev) => {
                const i = prev.findIndex((s) => s.state === 'running');
                if (i === -1) return prev;
                return prev.map((s, idx) => (idx === i ? { ...s, state: 'fail', detail: msg } : s));
            });
        } finally {
            abortRef.current = null;
            pwResolve.current = null;
            setPwValue('');
            if (qrExpiryTimer.current !== null) {
                clearTimeout(qrExpiryTimer.current);
                qrExpiryTimer.current = null;
            }
            setBusy(false);
        }
    };

    const cancel = () => {
        abortRef.current?.abort();
        pwResolve.current = null;
        setPwValue('');
        setPwOpen(false);
        setScanState(null);
        say('cancelled');
    };

    return (
        <div className="min-h-screen bg-background text-foreground p-6 max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold">Account mode — Task 2.0 gate</h1>
            <p className="text-sm text-muted-foreground mt-1">
                Browser MTProto via mtcute, one client in a SharedWorker. Nothing here touches
                our servers: the connection is browser → Telegram.
            </p>

            <div className="flex flex-wrap gap-2 mt-5">
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
                <button
                    onClick={copyLog}
                    disabled={log.length === 0}
                    className="px-4 py-2 rounded-xl border border-border text-sm disabled:opacity-50"
                >
                    {copied ? 'Copied' : 'Copy log'}
                </button>
                <button
                    onClick={downloadLog}
                    disabled={log.length === 0}
                    className="px-4 py-2 rounded-xl border border-border text-sm disabled:opacity-50"
                >
                    Download .txt
                </button>
                <button
                    onClick={resetSession}
                    disabled={busy}
                    className="px-4 py-2 rounded-xl border border-destructive/40 text-destructive text-sm disabled:opacity-50"
                    title="Destroys the worker client, deletes the local session, and reloads — forces a fresh auth-key exchange"
                >
                    Reset local session
                </button>
            </div>

            {revoked && (
                <div role="alert" className="mt-5 p-4 rounded-xl bg-destructive/10 border border-destructive/30">
                    <p className="text-sm text-destructive font-medium">{revoked}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Run the gate again to sign in with a new QR code.
                    </p>
                </div>
            )}

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

            {scanState && (
                <div className="mt-6 p-4 rounded-xl bg-primary/10 border border-primary/30 inline-block">
                    <p className="text-sm font-medium">{scanState}</p>
                </div>
            )}

            {qrDataUrl && (
                <div className="mt-6 p-4 rounded-2xl border border-border inline-block bg-white">
                    <img src={qrDataUrl} alt="Telegram login QR code" width={288} height={288} />
                    <p className="text-xs text-center mt-2 text-black/70 max-w-[288px]">
                        Telegram → Settings → Devices → Link Desktop Device
                    </p>
                </div>
            )}

            {pwOpen && (
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        submitPassword();
                    }}
                    className="mt-6 p-4 rounded-2xl border border-border max-w-sm"
                >
                    <label htmlFor="cloud-password" className="text-sm font-medium">
                        Two-step verification
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                        Your login was accepted. This account has a cloud password.
                    </p>
                    {pwHint && (
                        <p className="text-xs text-muted-foreground mt-1">
                            Hint: <span className="font-medium">{pwHint}</span>
                        </p>
                    )}
                    <input
                        id="cloud-password"
                        type="password"
                        autoComplete="current-password"
                        autoFocus
                        value={pwValue}
                        onChange={(e) => setPwValue(e.target.value)}
                        disabled={pwVerifying}
                        className="mt-3 w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/50 text-sm focus:outline-none focus:border-primary/50 disabled:opacity-60"
                        placeholder="Cloud password"
                    />
                    {pwError && (
                        <p role="alert" className="text-xs text-destructive mt-2">
                            {pwError}
                        </p>
                    )}
                    <button
                        type="submit"
                        disabled={pwVerifying || pwValue.length === 0}
                        className="mt-3 w-full h-10 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                    >
                        {pwVerifying ? 'Verifying…' : 'Unlock'}
                    </button>
                    <p className="text-[11px] text-muted-foreground mt-2">
                        Computed into an SRP proof on this device. The password itself is never
                        sent to Telegram or to us, and is never stored.
                    </p>
                </form>
            )}

            {me && (
                <div className="mt-6 p-4 rounded-xl bg-primary/10 border border-primary/30">
                    <p className="text-sm">
                        Signed in as <strong>{me}</strong>
                    </p>
                    {channel && (
                        <p className="text-sm mt-1">
                            Storage channel: <strong>{channel}</strong>
                        </p>
                    )}
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
