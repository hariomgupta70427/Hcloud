import { useState, useEffect, useCallback } from 'react';
import { getMtprotoClient, isSharedWorkerSupported, isSessionRevoked, resetLocalSession } from '@/lib/mtprotoPort';
import { resolveStorageChannel } from '@/lib/storageChannel';
import { compareHashes, type ContentHash } from '@/lib/contentHash';
import { assertComparable, type FileManifest } from '@/lib/fileManifest';
import { putManifest, listManifests, getManifest, deleteManifest } from '@/lib/manifestStore';
import { uploadFileToChannel, readBackFromChannel, type UploadProgress } from '@/services/accountStorage';

/**
 * /lab/storage — Stage 2.3a, operable.
 *
 * Pick a file, watch real byte-level progress, see it listed with its digest, then
 * RELOAD and verify. The reload is the point: after it the `File` handle is gone, so
 * a matching read-back digest can only have come from Telegram.
 */

function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

function fmtRate(bps: number): string {
    return bps <= 0 ? '—' : `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
}

function fmtMs(ms: number): string {
    if (ms < 1000) return `${ms} ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)} s`;
    return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

type Verdict =
    | { state: 'idle' }
    | { state: 'running'; read: number; total: number; bps: number }
    | {
          state: 'done';
          match: boolean;
          sourceRoot: string;
          readRoot: string;
          sourceBytes: number;
          readBytes: number;
          elapsedMs: number;
          provenance: string;
          reason: string;
          firstDifferingOffset: number;
      }
    | { state: 'error'; message: string };

export default function StorageLabPage() {
    const [ready, setReady] = useState(false);
    const [channel, setChannel] = useState<{ id: number; title: string; origin: string } | null>(null);
    const [files, setFiles] = useState<FileManifest[]>([]);
    const [progress, setProgress] = useState<UploadProgress | null>(null);
    const [verdict, setVerdict] = useState<Verdict>({ state: 'idle' });
    const [verifyingId, setVerifyingId] = useState<string | null>(null);
    const [log, setLog] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const say = useCallback((line: string) => {
        setLog((prev) => [...prev, `${new Date().toISOString().slice(11, 23)}  ${line}`]);
    }, []);

    const refreshList = useCallback(async () => {
        setFiles(await listManifests());
    }, []);

    useEffect(() => {
        void refreshList();
    }, [refreshList]);

    /** Handle a terminal session error the same way everywhere. */
    const handleError = useCallback(
        async (err: unknown) => {
            if (isSessionRevoked(err)) {
                const text = (err as { text?: string }).text ?? 'revoked';
                say(`REVOKED: ${text} — clearing local session`);
                setError(`Session no longer valid (${text}). Sign in again at /lab/account.`);
                await resetLocalSession({ reload: false });
                setReady(false);
                setChannel(null);
                return;
            }
            const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            say(`ERROR: ${msg}`);
            setError(msg);
        },
        [say]
    );

    const connect = async () => {
        setBusy(true);
        setError(null);
        try {
            if (!isSharedWorkerSupported()) {
                throw new Error('This browser has no SharedWorker, which account mode requires.');
            }
            const { tg } = getMtprotoClient();
            say('resolving storage channel');
            const resolved = await resolveStorageChannel(tg, { log: say });
            setChannel({ id: resolved.id, title: resolved.title, origin: resolved.origin });
            setReady(true);
            say(`ready — channel ${resolved.id} (${resolved.origin})`);
        } catch (err) {
            await handleError(err);
        } finally {
            setBusy(false);
        }
    };

    const onPick = async (ev: React.ChangeEvent<HTMLInputElement>) => {
        const file = ev.target.files?.[0];
        // Reset the input so the SAME file can be picked again after a failure.
        ev.target.value = '';
        if (!file || !channel) return;

        setBusy(true);
        setError(null);
        setVerdict({ state: 'idle' });
        try {
            const { tg } = getMtprotoClient();
            say(`selected ${file.name} — ${fmtBytes(file.size)} (${file.size} bytes)`);
            const { manifest } = await uploadFileToChannel(tg, channel.id, file, setProgress, say);
            await putManifest(manifest);
            await refreshList();
            say(`manifest stored (id ${manifest.id}) — RELOAD the page, then Verify read-back`);
        } catch (err) {
            await handleError(err);
        } finally {
            setBusy(false);
        }
    };

    const verify = async (id: string) => {
        setBusy(true);
        setError(null);
        setVerifyingId(id);
        setVerdict({ state: 'running', read: 0, total: 0, bps: 0 });
        try {
            const manifest = await getManifest(id);
            if (!manifest) throw new Error('manifest not found');

            // Refuse to compare digests that were produced under a different format.
            assertComparable(manifest);

            const { tg } = getMtprotoClient();
            const source: ContentHash = {
                root: manifest.contentRoot,
                blocks: manifest.contentBlocks,
                byteLength: manifest.size,
            };

            const { hash, provenance, elapsedMs } = await readBackFromChannel(
                tg,
                manifest,
                (read, total, bps) => setVerdict({ state: 'running', read, total, bps }),
                say
            );

            const cmp = compareHashes(source, hash);
            setVerdict({
                state: 'done',
                match: cmp.match,
                sourceRoot: source.root,
                readRoot: hash.root,
                sourceBytes: source.byteLength,
                readBytes: hash.byteLength,
                elapsedMs,
                provenance,
                reason: cmp.reason,
                firstDifferingOffset: cmp.firstDifferingOffset,
            });
            say(cmp.match ? `VERDICT: MATCH — ${cmp.reason}` : `VERDICT: MISMATCH — ${cmp.reason}`);
        } catch (err) {
            await handleError(err);
            setVerdict({ state: 'error', message: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusy(false);
        }
    };

    const forget = async (id: string) => {
        await deleteManifest(id);
        await refreshList();
        say(`forgot local manifest ${id} (the Telegram message is untouched)`);
    };

    const pct = progress ? progress.percent : 0;

    return (
        <div className="min-h-screen bg-background text-foreground p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold">Storage — Stage 2.3a</h1>
            <p className="text-sm text-muted-foreground mt-1">
                Upload straight from this browser into your Telegram storage channel over MTProto,
                then verify the bytes came back identical. Nothing passes through our servers.
            </p>

            {!ready ? (
                <button
                    onClick={connect}
                    disabled={busy}
                    className="mt-5 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-medium disabled:opacity-50"
                >
                    {busy ? 'Connecting…' : 'Connect'}
                </button>
            ) : (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                    <input
                        type="file"
                        onChange={onPick}
                        disabled={busy}
                        className="text-sm"
                    />
                    {channel && (
                        <span className="text-xs text-muted-foreground">
                            channel <strong>{channel.id}</strong> · {channel.origin}
                        </span>
                    )}
                </div>
            )}

            {error && (
                <div role="alert" className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/30">
                    <p className="text-sm text-destructive">{error}</p>
                </div>
            )}

            {progress && progress.phase !== 'done' && (
                <div className="mt-5 p-4 rounded-2xl border border-border">
                    <div className="flex justify-between text-sm">
                        <span className="font-medium capitalize">{progress.phase}</span>
                        <span className="tabular-nums">
                            {fmtBytes(progress.bytesSent)} / {fmtBytes(progress.total)} · {fmtRate(progress.bytesPerSecond)}
                        </span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                            className="h-full bg-primary transition-[width] duration-200"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        {pct}% · {progress.bytesSent} of {progress.total} bytes
                    </p>
                </div>
            )}

            {files.length > 0 && (
                <div className="mt-6">
                    <h2 className="text-sm font-semibold">Uploaded files</h2>
                    <p className="text-xs text-muted-foreground mt-1">
                        Reload the page before verifying — after a reload the local File handle is
                        gone, so a matching digest can only have come from Telegram.
                    </p>
                    <ul className="mt-3 space-y-3">
                        {files.map((f) => (
                            <li key={f.id} className="p-3 rounded-xl border border-border">
                                <div className="flex flex-wrap items-baseline justify-between gap-2">
                                    <span className="font-medium text-sm">{f.name}</span>
                                    <span className="text-xs text-muted-foreground tabular-nums">
                                        {fmtBytes(f.size)} · {f.size} bytes · uploaded in {fmtMs(f.uploadMs)}
                                    </span>
                                </div>
                                <p className="mt-1 text-[11px] font-mono break-all text-muted-foreground">
                                    root {f.contentRoot}
                                </p>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    {f.contentBlocks.length} × {fmtBytes(f.hashBlockSize)} blocks ·
                                    {' '}{f.hashDomain} · schema v{f.schemaVersion} ·
                                    {' '}msg {f.parts[0]?.messageId} in {f.parts[0]?.chatId}
                                </p>
                                <div className="mt-2 flex gap-2">
                                    <button
                                        onClick={() => verify(f.id)}
                                        disabled={busy || !ready}
                                        className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50"
                                    >
                                        {verifyingId === f.id && verdict.state === 'running' ? 'Verifying…' : 'Verify read-back'}
                                    </button>
                                    <button
                                        onClick={() => forget(f.id)}
                                        disabled={busy}
                                        className="px-3 py-1.5 rounded-lg border border-border text-xs disabled:opacity-50"
                                    >
                                        Forget locally
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {verdict.state === 'running' && (
                <div className="mt-5 p-4 rounded-2xl border border-border">
                    <p className="text-sm font-medium">Reading back from Telegram…</p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        {fmtBytes(verdict.read)} / {fmtBytes(verdict.total)} · {fmtRate(verdict.bps)}
                    </p>
                </div>
            )}

            {verdict.state === 'done' && (
                <div
                    className={`mt-5 p-4 rounded-2xl border ${
                        verdict.match ? 'border-primary/40 bg-primary/10' : 'border-destructive/40 bg-destructive/10'
                    }`}
                >
                    <p className={`text-sm font-bold ${verdict.match ? '' : 'text-destructive'}`}>
                        {verdict.match ? 'MATCH — bytes round-tripped identically' : 'MISMATCH'}
                    </p>
                    <dl className="mt-2 text-[11px] space-y-1">
                        <div>
                            <dt className="text-muted-foreground">source root</dt>
                            <dd className="font-mono break-all">{verdict.sourceRoot}</dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">read-back root</dt>
                            <dd className="font-mono break-all">{verdict.readRoot}</dd>
                        </div>
                        <div className="tabular-nums">
                            <dt className="text-muted-foreground">bytes</dt>
                            <dd>
                                source {verdict.sourceBytes} · read-back {verdict.readBytes} ·
                                {' '}elapsed {fmtMs(verdict.elapsedMs)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-muted-foreground">bytes came from</dt>
                            <dd className="font-mono break-all">{verdict.provenance}</dd>
                        </div>
                        {!verdict.match && (
                            <div>
                                <dt className="text-muted-foreground">diagnosis</dt>
                                <dd className="text-destructive">{verdict.reason}</dd>
                            </div>
                        )}
                    </dl>
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
