import { BookOpen, Bot, Braces, Briefcase, Check, Copy, HelpCircle, Lock, Paperclip, RefreshCw, ShieldAlert, ShieldCheck, Sparkles, Wifi, Zap } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserContextSettings, PhoneMirrorInfo } from '../../types/electron';
import { isMac } from '../../utils/platformUtils';
import { BrowserExtensionIcon } from '../onboarding/BrowserExtensionIcon';

const MiniPairingCountdownRing: React.FC<{ seconds: number; total: number }> = ({
  seconds,
  total,
}) => {
  const size = 24;
  const stroke = 2.25;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const safeTotal = total > 0 ? total : 60;
  const remaining = Math.max(0, Math.min(safeTotal, seconds));
  const dashOffset = circumference * (1 - remaining / safeTotal);

  return (
    <div className="relative h-6 w-6 flex-shrink-0" aria-hidden="true">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(59, 130, 246, 0.18)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(96, 165, 250)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 950ms cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-[8px] font-semibold tabular-nums text-blue-300">
        {remaining}
      </span>
    </div>
  );
};

const EMPTY_BROWSER_CTX: BrowserContextSettings = {
  autoDetectCoding: true,
  autoAttachCoding: true,
  askBeforeUnknown: true,
  aiClassifierEnabled: false,
  autoDetectJobDescriptions: false,
  autoDetectDeveloperDocs: false,
  experimentalFullPageCapture: false,
};

const EMPTY_INFO: PhoneMirrorInfo = {
  running: false,
  enabled: false,
  exposeOnLan: false,
  port: 0,
  loopbackUrl: null,
  primaryUrl: null,
  lanUrls: [],
  token: null,
  extToken: null,
  qrDataUrl: null,
  clients: 0,
  extensionConnected: false,
};

export const PhoneMirrorSettings: React.FC = () => {
  const [info, setInfo] = useState<PhoneMirrorInfo>(EMPTY_INFO);
  const [busy, setBusy] = useState<null | 'enable' | 'disable' | 'lan' | 'rotate'>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Companion browser-extension pairing: countdown (seconds left) while the 60s
  // one-click /pair window is open after "Connect browser extension".
  const [armCountdown, setArmCountdown] = useState(0);
  const [armTotal, setArmTotal] = useState(60);
  const [armError, setArmError] = useState<string | null>(null);
  const [pairCopied, setPairCopied] = useState(false);
  const [showManualPair, setShowManualPair] = useState(false);
  // Pairing disclosure under the Enable Phone Mirror row.
  const [showPairing, setShowPairing] = useState(false);
  const armTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Smart Browser Context v2 — auto-capture settings.
  const [ctx, setCtx] = useState<BrowserContextSettings>(EMPTY_BROWSER_CTX);

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
      if (!next || typeof next !== 'object') return;
      setInfo((prev) => {
        const n = next as PhoneMirrorInfo;
        if (
          prev &&
          prev.qrDataUrl === n.qrDataUrl &&
          prev.primaryUrl === n.primaryUrl &&
          prev.token === n.token &&
          prev.extToken === n.extToken &&
          prev.running === n.running &&
          prev.clients === n.clients &&
          prev.extensionConnected === n.extensionConnected
        ) {
          return prev;
        }
        return n;
      });
    });
    return () => {
      off?.();
    };
  }, [refresh]);

  // Load Smart Browser Context settings once.
  useEffect(() => {
    (async () => {
      try {
        const res = await window.electronAPI.browserContextGetSettings?.();
        if (res && typeof res === 'object' && !('error' in res)) {
          setCtx(res as BrowserContextSettings);
        }
      } catch {
        /* keep documented defaults */
      }
    })();
  }, []);

  // Toggle one auto-capture setting and persist it. Keys map 1:1 to the resolved
  // BrowserContextSettings fields → the IPC's browser* setting keys.
  const onToggleCtx = useCallback(
    async (
      field: keyof BrowserContextSettings,
      ipcKey:
        | 'browserAutoDetectCoding'
        | 'browserAutoAttachCoding'
        | 'browserAskBeforeUnknown'
        | 'browserAiClassifierEnabled'
        | 'browserAutoDetectJobDescriptions'
        | 'browserAutoDetectDeveloperDocs'
        | 'browserExperimentalFullPageCapture',
    ) => {
      const next = !ctx[field];
      // Optimistic update; reconcile with the persisted resolved settings.
      setCtx((prev) => ({ ...prev, [field]: next }));
      try {
        const res = await window.electronAPI.browserContextSetSettings?.({ [ipcKey]: next });
        if (res && typeof res === 'object' && !('error' in res)) {
          setCtx(res as BrowserContextSettings);
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to save browser context setting');
        setCtx((prev) => ({ ...prev, [field]: !next })); // revert
      }
    },
    [ctx],
  );

  const apply = useCallback(
    async (key: 'enable' | 'disable' | 'lan' | 'rotate', fn: () => Promise<any>) => {
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
    },
    [refresh],
  );

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
    } catch (_) {
      /* noop */
    }
  }, [info.primaryUrl]);

  // Clear the countdown interval on unmount.
  useEffect(() => {
    return () => {
      if (armTimerRef.current) clearInterval(armTimerRef.current);
    };
  }, []);

  // "Connect browser extension" — arm the 60s one-click pairing window on the
  // desktop, then run a local countdown so the user knows how long they have to
  // click "Connect to Natively" in the extension popup.
  const onArmExtension = useCallback(async () => {
    setArmError(null);
    try {
      const result = await window.electronAPI.phoneMirrorArmExtension();
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        setArmError(String(result.error));
        return;
      }
      const seconds =
        result && typeof result === 'object' && 'armedMs' in result
          ? Math.round((result.armedMs as number) / 1000)
          : 60;
      if (armTimerRef.current) clearInterval(armTimerRef.current);
      setArmTotal(seconds);
      setArmCountdown(seconds);
      armTimerRef.current = setInterval(() => {
        setArmCountdown((prev) => {
          if (prev <= 1) {
            if (armTimerRef.current) clearInterval(armTimerRef.current);
            armTimerRef.current = null;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (e: any) {
      setArmError(e?.message || 'Failed to arm pairing');
    }
  }, []);

  // Manual fallback: copy the raw `port:token` pairing string for the extension's
  // "Pair manually instead" field. Only shown after the user expands it. Uses the
  // EXTENSION token (loopback-scoped), not the phone token — this string pairs the
  // browser extension.
  const onCopyPairString = useCallback(async () => {
    if (!info.port || !info.extToken) return;
    try {
      await navigator.clipboard.writeText(`${info.port}:${info.extToken}`);
      setPairCopied(true);
      setTimeout(() => setPairCopied(false), 1200);
    } catch (_) {
      /* noop */
    }
  }, [info.port, info.extToken]);

  const lanWarning = info.running && info.exposeOnLan;
  const showQr = info.running && info.qrDataUrl;
  const lanRequestedButMissing = info.running && info.exposeOnLan && info.lanUrls.length === 0;

  // Count of Optional classifiers that are hidden under the disclosure.
  const hiddenOptionalCount = 4;

  return (
    <div className="space-y-6 animated fadeIn">
      <header>
        <h3 className="text-lg font-bold text-text-primary mb-1">Sync</h3>
        <p className="text-xs text-text-secondary mb-5">
          Mirror answers to your phone. Capture browser tabs to your answers.
        </p>
      </header>

      {/* =====================================================================
          Group A — Always-visible controls (the spine)
          Single card with three stacked rows: Enable Phone Mirror, Allow LAN,
          Browser Extension. Pairing lives as a nested disclosure under row 1,
          manual pair under row 3, arm countdown under row 3.
          ===================================================================== */}
      <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-4">
        {/* Row 1 — Enable Phone Mirror */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-text-primary font-medium text-sm">Enable Phone Mirror</div>
            <div className="text-text-secondary text-xs mt-1">
              {info.running
                ? `On — port ${info.port} · ${info.clients} ${info.clients === 1 ? 'phone' : 'phones'} connected`
                : 'Off'}
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
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${info.running ? 'translate-x-5' : 'translate-x-1'}`}
            />
          </button>
        </div>

        {/* Pairing disclosure — nested under Enable Phone Mirror */}
        <details
          className="text-xs rounded-lg border border-border-subtle bg-bg-main"
          open={showPairing}
          onToggle={(e) => setShowPairing((e.target as HTMLDetailsElement).open)}
        >
          <summary className="px-3 py-2 text-text-secondary cursor-pointer hover:text-text-primary select-none">
            Pairing code and URL
          </summary>
          <div className="px-3 pb-3 pt-1">
            {info.running ? (
              <div className="space-y-3">
                <div className="flex items-start gap-4">
                  {showQr ? (
                    <div className="flex-shrink-0 rounded-md bg-white p-1.5 shadow-sm">
                      <img
                        src={info.qrDataUrl!}
                        alt="Pairing QR code"
                        className="block w-28 h-28"
                        draggable={false}
                      />
                    </div>
                  ) : (
                    <div className="flex-shrink-0 w-28 h-28 rounded-md border border-dashed border-border-subtle grid place-items-center text-text-secondary text-[11px]">
                      generating QR…
                    </div>
                  )}
                  <div className="flex-1 min-w-0 space-y-2.5">
                    <div>
                      <div className="text-text-secondary text-[10px] uppercase tracking-wider mb-1">
                        Scan with your phone
                      </div>
                      <div className="text-text-primary text-xs leading-snug">
                        {info.exposeOnLan
                          ? 'Open the camera app and point at the code.'
                          : 'LAN access is off. Turn it on, or open the URL on this computer.'}
                      </div>
                    </div>
                    <div>
                      <div className="text-text-secondary text-[10px] uppercase tracking-wider mb-1">
                        Pairing URL
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 min-w-0 truncate font-mono text-[11px] px-2 py-1.5 rounded-md bg-bg-item-surface border border-border-subtle text-text-primary">
                          {info.primaryUrl || '—'}
                        </code>
                        <button
                          type="button"
                          onClick={onCopy}
                          disabled={!info.primaryUrl}
                          className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-bg-item-active text-text-primary hover:bg-bg-item-active/70 disabled:opacity-50 transition-colors"
                        >
                          {copied ? (
                            <>
                              <Check size={12} /> Copied
                            </>
                          ) : (
                            <>
                              <Copy size={12} /> Copy
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    {info.exposeOnLan && info.lanUrls.length > 1 && (
                      <details className="text-[11px]">
                        <summary className="text-text-secondary cursor-pointer hover:text-text-primary">
                          Other LAN addresses ({info.lanUrls.length - 1})
                        </summary>
                        <ul className="mt-1.5 space-y-0.5 font-mono text-text-secondary">
                          {info.lanUrls.slice(1).map((u) => (
                            <li key={u} className="truncate">
                              {u}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border-subtle">
                  <div className="flex items-center gap-1.5 text-text-secondary text-[11px]">
                    <Lock size={11} /> Pairing token gates every connection.
                  </div>
                  <button
                    type="button"
                    onClick={onRotate}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-item-active/60 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={11} className={busy === 'rotate' ? 'animate-spin' : ''} />
                    Rotate token
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-text-secondary text-xs py-1">
                Turn on Phone Mirror to show the pairing code.
              </div>
            )}
          </div>
        </details>

        <div className="h-px bg-border-subtle" />

        {/* Row 2 — Allow LAN access */}
        <div>
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-text-primary font-medium text-sm flex items-center gap-2">
                <Wifi size={14} className="text-text-secondary" /> Allow LAN access
              </div>
              <div className="text-text-secondary text-xs mt-1">
                {info.exposeOnLan
                  ? 'Open the mirror on any device on this network.'
                  : 'Keep the mirror on this computer only.'}
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
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${info.exposeOnLan ? 'translate-x-5' : 'translate-x-1'}`}
              />
            </button>
          </div>
          {lanWarning && (
            <div className="mt-2.5 flex items-start gap-2 text-amber-400/90 text-xs leading-relaxed">
              <ShieldAlert size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                Anyone with the pairing link can view the phone mirror on this Wi-Fi. Rotate the
                token if the link was shared.
              </span>
            </div>
          )}
          {lanRequestedButMissing && (
            <div className="mt-2.5 flex items-start gap-2 text-amber-300/90 text-xs leading-relaxed">
              <ShieldAlert size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                LAN access is on, but no Wi-Fi or Ethernet IP was detected. Connect this{' '}
                {isMac ? 'Mac' : 'PC'} to the same Wi-Fi as your phone (VPN tunnels and virtual
                interfaces don't count). If you've connected, also confirm{' '}
                {isMac ? (
                  <strong>System Settings → Network → Firewall</strong>
                ) : (
                  <strong>Windows Defender Firewall → Allowed apps</strong>
                )}{' '}
                is allowing incoming connections for this app.
              </span>
            </div>
          )}
        </div>

        <div className="h-px bg-border-subtle" />

        {/* Row 3 — Browser Extension (inline status + action, not a big card) */}
        <div>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-bg-main p-2 border border-border-subtle flex-shrink-0 mt-0.5">
              <BrowserExtensionIcon color="rgb(129, 140, 248)" size={16} className="text-indigo-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-text-primary font-medium text-sm">Browser Extension</div>
              <div className="text-text-secondary text-xs mt-1 leading-relaxed">
                Pair the companion extension to send the active tab to the desktop.{' '}
                <kbd className="px-1 py-0.5 rounded bg-bg-main border border-border-subtle font-mono text-[10px]">
                  {isMac ? '⌘' : 'Ctrl'}+Shift+Y
                </kbd>{' '}
                to capture manually.
              </div>
            </div>
          </div>

          {info.running ? (
            <div className="mt-3 space-y-2.5">
              {/* Primary action area — three states:
                  1) Counting down (arm in flight) → compact waiting status.
                  2) Already connected & not arming → quiet emerald status row +
                     small ghost "Re-pair" link on the right.
                  3) Idle, not connected → big blue primary CTA. */}
              {armCountdown > 0 ? (
                <div
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  aria-label={`Waiting for extension. Pairing window: ${armCountdown} seconds remaining.`}
                  className="flex items-center gap-2.5 rounded-lg border border-blue-500/20 bg-blue-500/[0.05] px-3 py-2"
                >
                  <MiniPairingCountdownRing seconds={armCountdown} total={armTotal} />
                  <div className="min-w-0 flex-1">
                    <div className="text-text-primary text-xs font-medium leading-tight">
                      Waiting for extension
                    </div>
                    <div className="text-text-secondary text-[11px] mt-0.5 leading-snug">
                      Click <span className="text-blue-300">Connect to Natively</span> in the browser popup.
                    </div>
                  </div>
                </div>
              ) : info.extensionConnected ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20">
                      <Check size={12} className="text-emerald-400" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-emerald-300 text-xs font-medium leading-tight">
                        Connected
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onArmExtension}
                    aria-label="Re-pair browser extension"
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-item-active/60 transition-colors"
                  >
                    <RefreshCw size={11} />
                    Re-pair
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={onArmExtension}
                  aria-label="Connect browser extension"
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors bg-blue-500 text-white hover:bg-blue-400"
                >
                  <Zap size={13} />
                  Connect browser extension
                </button>
              )}

              <details
                className="text-[11px]"
                open={showManualPair}
                onToggle={(e) => setShowManualPair((e.target as HTMLDetailsElement).open)}
              >
                <summary className="text-text-secondary cursor-pointer hover:text-text-primary select-none">
                  Pair manually instead
                </summary>
                <div className="mt-2 space-y-2">
                  <div className="text-text-secondary leading-relaxed">
                    In the extension popup, expand <strong>Pair manually instead</strong> and paste
                    this pairing string:
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 min-w-0 truncate font-mono text-[11px] px-2 py-1.5 rounded-md bg-bg-item-surface border border-border-subtle text-text-primary">
                      {info.port && info.extToken ? `${info.port}:${info.extToken}` : '—'}
                    </code>
                    <button
                      type="button"
                      onClick={onCopyPairString}
                      disabled={!info.port || !info.extToken}
                      className="flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-bg-item-active text-text-primary hover:bg-bg-item-active/70 disabled:opacity-50 transition-colors"
                    >
                      {pairCopied ? (
                        <>
                          <Check size={12} /> Copied
                        </>
                      ) : (
                        <>
                          <Copy size={12} /> Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </details>

              {armError && <div className="text-[11px] text-red-300">{armError}</div>}
            </div>
          ) : (
            <div className="mt-2.5 text-text-secondary text-[11px] flex items-center gap-1.5">
              <Lock size={11} /> Enable Phone Mirror first to pair the browser extension.
            </div>
          )}
        </div>
      </div>

      {/* =====================================================================
          Group B — Smart Browser Context (single card)
          Primary 3 toggles always visible; Optional classifiers nested under a
          <details>. Experimental toggle lives inside that disclosure with
          amber treatment, NOT as a peer card.
          ===================================================================== */}
      <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-bg-main p-2 border border-border-subtle flex-shrink-0">
            <ShieldCheck size={16} className="text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div
              role="heading"
              aria-level={3}
              className="text-text-primary font-medium text-sm"
            >
              Smart Browser Context
            </div>
            <div className="text-text-secondary text-xs mt-1 leading-relaxed">
              Detect coding/interview pages and attach the problem when you ask. Manual capture
              always works.
            </div>
          </div>
        </div>

        <div role="group" aria-label="Automatic coding capture" className="space-y-2.5">
          <CtxToggle
            icon={<Braces size={13} className="text-text-secondary" aria-hidden="true" />}
            label="Auto-detect coding problems"
            desc="Recognize high-confidence coding/interview pages locally."
            checked={ctx.autoDetectCoding}
            onChange={() => onToggleCtx('autoDetectCoding', 'browserAutoDetectCoding')}
          />
          <CtxToggle
            icon={<Paperclip size={13} className="text-text-secondary" aria-hidden="true" />}
            label="Auto-attach coding context"
            desc="Capture and attach it just-in-time when you ask for an answer."
            checked={ctx.autoAttachCoding}
            onChange={() => onToggleCtx('autoAttachCoding', 'browserAutoAttachCoding')}
          />
          <CtxToggle
            icon={<HelpCircle size={13} className="text-text-secondary" aria-hidden="true" />}
            label="Ask before attaching unknown pages"
            desc="When we can't classify a page confidently, ask first instead of attaching automatically."
            checked={ctx.askBeforeUnknown}
            onChange={() => onToggleCtx('askBeforeUnknown', 'browserAskBeforeUnknown')}
          />
        </div>

        {/* Optional classifiers — collapsed by default. Experimental toggle
            lives inside, with amber treatment, no standalone peer card. */}
        <details className="text-xs rounded-lg border border-border-subtle bg-bg-main">
          <summary className="px-3 py-2 text-text-secondary cursor-pointer hover:text-text-primary select-none flex items-center gap-2">
            <span>Optional classifiers</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-bg-item-active text-text-secondary border border-border-subtle">
              {hiddenOptionalCount} hidden
            </span>
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2.5">
            <CtxToggle
              icon={<Sparkles size={13} className="text-text-secondary" aria-hidden="true" />}
              label="AI page classifier"
              desc="Classify unknown pages with sanitized metadata."
              checked={ctx.aiClassifierEnabled}
              onChange={() => onToggleCtx('aiClassifierEnabled', 'browserAiClassifierEnabled')}
            />
            <CtxToggle
              icon={<Briefcase size={13} className="text-text-secondary" aria-hidden="true" />}
              label="Auto-detect job descriptions"
              desc="Recognize job posts."
              checked={ctx.autoDetectJobDescriptions}
              onChange={() => onToggleCtx('autoDetectJobDescriptions', 'browserAutoDetectJobDescriptions')}
            />
            <CtxToggle
              icon={<BookOpen size={13} className="text-text-secondary" aria-hidden="true" />}
              label="Auto-detect developer docs"
              desc="Recognize dev docs."
              checked={ctx.autoDetectDeveloperDocs}
              onChange={() => onToggleCtx('autoDetectDeveloperDocs', 'browserAutoDetectDeveloperDocs')}
            />

            <CtxToggle
              icon={<Paperclip size={13} className="text-text-secondary" aria-hidden="true" />}
              label="Full page context"
              desc="Use the complete page when excerpts miss details. More tokens; sensitive pages stay blocked."
              checked={ctx.experimentalFullPageCapture}
              onChange={() => onToggleCtx('experimentalFullPageCapture', 'browserExperimentalFullPageCapture')}
              experimental
            />
          </div>
        </details>
      </div>

      {/* =====================================================================
          Group C — Quiet reassurance footer (NOT a big emerald card)
          Privacy floor line + local-network line. Muted, no gradients.
          ===================================================================== */}
      <footer className="space-y-1.5 text-text-secondary text-xs leading-relaxed">
        <div className="flex items-start gap-2">
          <Lock size={12} className="mt-0.5 flex-shrink-0 text-text-secondary" />
          <span>
            Email, chat, banking, and auth pages are never captured — even if they look like a
            coding page.
          </span>
        </div>
        <div className="flex items-start gap-2">
          <Wifi size={12} className="mt-0.5 flex-shrink-0 text-text-secondary" />
          <span>Phone Mirror runs on your local network. No traffic leaves this machine.</span>
        </div>
      </footer>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
    </div>
  );
};

/** A single labelled on/off row for the Smart Browser Context settings group. */
const CtxToggle: React.FC<{
  label: string;
  desc: string;
  checked: boolean;
  onChange: () => void;
  /** Optional leading icon, rendered in a small rounded surface on the left. */
  icon?: React.ReactNode;
  /** Show a subtle amber "Experimental" chip next to the label. */
  experimental?: boolean;
  /**
   * Mark the control as scaffolding for a not-yet-wired feature: shows a "Coming
   * soon" chip, dims the row, and disables the switch so it can't promise
   * behavior that doesn't exist yet. (The AI metadata classifier + JD/dev-docs
   * auto-detect are built + tested but not yet wired into the live auto-context
   * path — tracked as a follow-up.)
   */
  comingSoon?: boolean;
}> = ({ label, desc, checked, onChange, icon, experimental, comingSoon }) => (
  <div className={`flex items-start justify-between gap-3 ${comingSoon ? 'opacity-55' : ''}`}>
    <div className="flex items-start gap-2.5 min-w-0">
      {icon && (
        <div
          className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-md bg-bg-main border border-border-subtle grid place-items-center"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <div className="min-w-0">
        <div className="text-text-primary text-sm flex items-center gap-2">
          {label}
          {experimental && (
            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-1 py-px text-[8px] font-semibold uppercase tracking-[0.05em] text-amber-400/90">
              Experimental
            </span>
          )}
          {comingSoon && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.08em] bg-text-secondary/15 text-text-secondary border border-border-subtle">
              Coming soon
            </span>
          )}
        </div>
        <div className="text-text-secondary text-xs mt-0.5 leading-snug">{desc}</div>
      </div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={comingSoon ? false : checked}
      aria-label={label}
      disabled={comingSoon}
      onClick={comingSoon ? undefined : onChange}
      className={`flex-shrink-0 mt-0.5 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
        comingSoon ? 'cursor-not-allowed bg-bg-item-active' : checked ? 'bg-blue-500' : 'bg-bg-item-active'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
          !comingSoon && checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  </div>
);
