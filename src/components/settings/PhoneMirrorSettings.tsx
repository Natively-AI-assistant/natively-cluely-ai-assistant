import React, { useCallback, useEffect, useState } from 'react';
import { Smartphone, Wifi, Lock, RefreshCw, Copy, Check, ShieldAlert } from 'lucide-react';
import type { PhoneMirrorInfo } from '../../types/electron';

const EMPTY_INFO: PhoneMirrorInfo = {
    running: false,
    enabled: false,
    exposeOnLan: false,
    port: 0,
    loopbackUrl: null,
    primaryUrl: null,
    lanUrls: [],
    token: null,
    qrDataUrl: null,
    clients: 0,
};

export const PhoneMirrorSettings: React.FC = () => {
    const [info, setInfo] = useState<PhoneMirrorInfo>(EMPTY_INFO);
    const [busy, setBusy] = useState<null | 'enable' | 'disable' | 'lan' | 'rotate'>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const next = await window.electronAPI.phoneMirrorGetInfo();
            if (next && typeof next === 'object') setInfo(next as PhoneMirrorInfo);
        } catch (e: any) {
            setError(e?.message || 'Failed to load phone mirror status');
        }
    }, []);

    useEffect(() => {
        refresh();
        const off = window.electronAPI.onPhoneMirrorStatus((next) => {
            if (next && typeof next === 'object') setInfo(next as PhoneMirrorInfo);
        });
        return () => { off?.(); };
    }, [refresh]);

    const apply = useCallback(async (key: 'enable' | 'disable' | 'lan' | 'rotate', fn: () => Promise<any>) => {
        setBusy(key);
        setError(null);
        try {
            const result = await fn();
            if (result && typeof result === 'object' && 'error' in result && result.error) {
                setError(String(result.error));
            } else if (result && typeof result === 'object' && 'running' in result) {
                setInfo(result as PhoneMirrorInfo);
            } else {
                await refresh();
            }
        } catch (e: any) {
            setError(e?.message || 'Action failed');
        } finally {
            setBusy(null);
        }
    }, [refresh]);

    const onToggleEnable = useCallback(async () => {
        if (info.running) {
            await apply('disable', () => window.electronAPI.phoneMirrorDisable());
        } else {
            await apply('enable', () => window.electronAPI.phoneMirrorEnable(info.exposeOnLan));
        }
    }, [apply, info.running, info.exposeOnLan]);

    const onToggleLan = useCallback(async () => {
        await apply('lan', () => window.electronAPI.phoneMirrorSetLan(!info.exposeOnLan));
    }, [apply, info.exposeOnLan]);

    const onRotate = useCallback(async () => {
        await apply('rotate', () => window.electronAPI.phoneMirrorRotateToken());
    }, [apply]);

    const onCopy = useCallback(async () => {
        if (!info.primaryUrl) return;
        try {
            await navigator.clipboard.writeText(info.primaryUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
        } catch (_) { /* noop */ }
    }, [info.primaryUrl]);

    const lanWarning = info.running && info.exposeOnLan;
    const showQr = info.running && info.qrDataUrl;
    const lanRequestedButMissing = info.running && info.exposeOnLan && info.lanUrls.length === 0;

    return (
        <div className="space-y-6 animated fadeIn">
            <header className="flex items-start gap-3">
                <div className="rounded-xl bg-bg-item-surface p-2.5 border border-border-subtle">
                    <Smartphone size={20} className="text-text-primary" />
                </div>
                <div className="flex-1">
                    <h3 className="text-text-primary text-lg font-semibold tracking-tight">Phone Mirror</h3>
                    <p className="text-text-secondary text-sm mt-1 leading-relaxed">
                        Stream live AI responses from your desktop to a phone browser on the same network.
                        Useful when you're sharing your screen and want the AI output kept off the shared display.
                    </p>
                </div>
            </header>

            {/* Master toggle */}
            <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <div className="text-text-primary font-medium text-sm">Enable Phone Mirror</div>
                    <div className="text-text-secondary text-xs mt-1">
                        {info.running
                            ? `Running on port ${info.port} · ${info.clients} ${info.clients === 1 ? 'phone' : 'phones'} connected`
                            : 'Off — no listener, no exposure.'}
                    </div>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-checked={info.running}
                    disabled={busy !== null}
                    onClick={onToggleEnable}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${info.running ? 'bg-blue-500' : 'bg-bg-item-active'} ${busy !== null ? 'opacity-60 cursor-wait' : ''}`}
                >
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${info.running ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
            </div>

            {/* LAN switch */}
            <div className={`bg-bg-item-surface rounded-xl border ${lanWarning ? 'border-amber-500/30' : 'border-border-subtle'} p-5 transition-colors`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="text-text-primary font-medium text-sm flex items-center gap-2">
                            <Wifi size={14} className="text-text-secondary" /> Allow LAN access
                        </div>
                        <div className="text-text-secondary text-xs mt-1">
                            {info.exposeOnLan
                                ? 'Phones on the same WiFi can connect with the pairing token.'
                                : 'Loopback only — only this computer can connect (use SSH tunnel for remote access).'}
                        </div>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={info.exposeOnLan}
                        disabled={busy !== null}
                        onClick={onToggleLan}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${info.exposeOnLan ? 'bg-amber-500' : 'bg-bg-item-active'} ${busy !== null ? 'opacity-60 cursor-wait' : ''}`}
                    >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${info.exposeOnLan ? 'translate-x-5' : 'translate-x-1'}`} />
                    </button>
                </div>
                {lanWarning && (
                    <div className="mt-3 flex items-start gap-2 text-amber-400/90 text-xs leading-relaxed">
                        <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
                        <span>
                            Anyone on this network with the pairing URL can read your AI responses. Use only on trusted networks.
                            Rotate the token below if you suspect the URL was shared.
                        </span>
                    </div>
                )}
            </div>

            {/* No-LAN-IP warning */}
            {lanRequestedButMissing && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300 text-xs leading-relaxed flex items-start gap-2">
                    <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
                    <span>
                        LAN access is on, but no Wi-Fi or Ethernet IP was detected. Connect this Mac to the same Wi-Fi as your phone (VPN tunnels and virtual interfaces don't count). If you've connected, also confirm <strong>System Settings → Network → Firewall</strong> is allowing incoming connections for this app.
                    </span>
                </div>
            )}

            {/* Pairing card */}
            {info.running ? (
                <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-4">
                    <div className="flex items-start gap-5">
                        {showQr ? (
                            <div className="flex-shrink-0 rounded-lg bg-white p-2 shadow-sm">
                                <img
                                    src={info.qrDataUrl!}
                                    alt="Pairing QR code"
                                    className="block w-36 h-36"
                                    draggable={false}
                                />
                            </div>
                        ) : (
                            <div className="flex-shrink-0 w-36 h-36 rounded-lg border border-dashed border-border-subtle grid place-items-center text-text-secondary text-xs">
                                generating QR…
                            </div>
                        )}
                        <div className="flex-1 min-w-0 space-y-3">
                            <div>
                                <div className="text-text-secondary text-xs uppercase tracking-wider mb-1.5">Scan with your phone</div>
                                <div className="text-text-primary text-sm font-medium">
                                    {info.exposeOnLan
                                        ? 'Open the camera app and point at the code.'
                                        : 'LAN access is off. Turn it on, or open the URL on this computer.'}
                                </div>
                            </div>
                            <div>
                                <div className="text-text-secondary text-xs uppercase tracking-wider mb-1.5">Pairing URL</div>
                                <div className="flex items-center gap-2">
                                    <code className="flex-1 min-w-0 truncate font-mono text-xs px-2.5 py-2 rounded-md bg-bg-main border border-border-subtle text-text-primary">
                                        {info.primaryUrl || '—'}
                                    </code>
                                    <button
                                        type="button"
                                        onClick={onCopy}
                                        disabled={!info.primaryUrl}
                                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-bg-item-active text-text-primary hover:bg-bg-item-active/70 disabled:opacity-50 transition-colors"
                                    >
                                        {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
                                    </button>
                                </div>
                            </div>
                            {info.exposeOnLan && info.lanUrls.length > 1 && (
                                <details className="text-xs">
                                    <summary className="text-text-secondary cursor-pointer hover:text-text-primary">
                                        Other LAN addresses ({info.lanUrls.length - 1})
                                    </summary>
                                    <ul className="mt-2 space-y-1 font-mono text-text-secondary">
                                        {info.lanUrls.slice(1).map((u) => (
                                            <li key={u} className="truncate">{u}</li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
                        <div className="flex items-center gap-2 text-text-secondary text-xs">
                            <Lock size={12} /> Pairing token gates every connection.
                        </div>
                        <button
                            type="button"
                            onClick={onRotate}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-item-active/60 transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={12} className={busy === 'rotate' ? 'animate-spin' : ''} />
                            Rotate token
                        </button>
                    </div>
                </div>
            ) : (
                <div className="bg-bg-item-surface/50 rounded-xl border border-dashed border-border-subtle p-6 text-center text-text-secondary text-sm">
                    Turn on Phone Mirror to generate a pairing URL and QR code.
                </div>
            )}

            {error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                    {error}
                </div>
            )}

            <div className="text-text-secondary text-xs leading-relaxed">
                Phone Mirror runs entirely on your local network. No traffic leaves your machine — the bridge serves
                an HTML page and a WebSocket directly to your phone, gated by a per-session pairing token.
            </div>
        </div>
    );
};
