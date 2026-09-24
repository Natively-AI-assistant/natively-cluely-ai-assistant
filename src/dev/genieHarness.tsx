// DEV-ONLY rig for GenieModal, the genie every launcher popup opens and closes
// with. Not part of the shipped app: vite's build input is index.html only
// (vite.config.mts), so this and genieHarness.html exist for the dev server
// alone. Same precedent as launcherTransitionHarness.tsx.
//
// Why a rig: the live launcher is a transparent Electron window, and the
// moment it is covered Chromium stops animation frames, so the genie never
// advances and nothing can be measured. Here it runs in an ordinary tab.
//
// The card is a stand-in with the shape of the heavy real ones (Settings, the
// Modes / Profile manager): sized on the wrap, h-full, a sidebar and a scrolled
// content pane, and a child that forces visibility: visible (Settings' panel
// did, and it showed through the hidden card mid-genie). `?nodes=` sets how
// heavy it is.
//
// `?churn=1` swaps in a card that keeps changing while it pours, like the
// real Modes / Profile / Settings do: loading -> loaded text, a framer fade-in
// on mount, a CSS spinner, a skeleton -> list swap and a controlled input
// filled after mount, plus a status that keeps ticking through the close.
// Every changing element carries data-probe, so a probe can compare each band
// copy against the live card frame by frame.
//
// `?corner=1` swaps in a notice in the bottom-right corner, the shape of
// the quota and provider-change cards: no dim, the launcher still clickable
// around it, pouring into a slot straight below itself. No kept picture
// unless `&keep=1` (the Hindsight card keeps one).
//
// `?notices=1` mounts the REAL corner notices (NativelyQuotaBanner,
// HindsightStatusBanner's floating card, ProviderChangeNotice) over whatever
// backdrop the probe sets, fed by stand-ins for the IPC they listen to, and
// driven by window.__notices: quota(), hindsight(state, reason?),
// provider(), progress(done, total), clearProgress().
//
// `?cards=1` mounts the REAL Natively API card (premium; nothing without it)
// and Trial promo, driven by window.__cards: nap(open), setKey(hasKey) for
// which Natively API variant the next open picks, trial(open) (remounted per
// open, as the orchestrator does) and trialOutcome('fail' | 'hang').
//
//   window.__genie.open() / .close()   drive it
//   window.__genie.bands()             band copies present right now
//   window.__genie.copyScroll()        scrollTop of the pane inside a copy
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { motion } from 'framer-motion';
import '../index.css';
import { GenieModal } from '../components/ui/GenieModal';
import { NativelyQuotaBanner } from '../components/NativelyQuotaBanner';
import { HindsightStatusBanner } from '../components/HindsightStatusBanner';
import { ProviderChangeNotice, type ProviderChangeWarning, type ReindexProgress } from '../components/ProviderChangeNotice';
import { TrialPromoToaster } from '../components/trial/TrialPromoToaster';
import { NativelyApiPromoToaster } from '../premium';

// Outside Electron there is no capturePage. A probe that wants pictures
// exposes __genieCaptureShim: an UNCLIPPED Page.captureScreenshot (the same
// compositor read-back; a clipped one re-emulates the page's pixel ratio and
// flashes the view), cropped here to the card as capturePage would crop it.
if (!(window as any).electronAPI && (window as any).__genieCaptureShim) {
  (window as any).electronAPI = {
    genieSnapshotCapture: async (rect: { x: number; y: number; width: number; height: number }) => {
      const b64: string | null = await (window as any).__genieCaptureShim();
      if (!b64) return null;
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const dpr = img.naturalWidth / window.innerWidth;
      const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, Math.round(rect.x * dpr), Math.round(rect.y * dpr), w, h, 0, 0, w, h);
      const blob: Blob = await new Promise(r => canvas.toBlob(b => r(b!), 'image/png'));
      return { png: new Uint8Array(await blob.arrayBuffer()), width: w, height: h };
    },
  };
}

const NOTICES = new URLSearchParams(location.search).get('notices') === '1';

// The IPC the corner notices listen to, stood in for: a quota reading past
// 90 % and a Hindsight status the driver pushes.
let pushHindsight: ((s: { state: string; reason?: string; logPath?: string }) => void) | null = null;
if (NOTICES) {
  (window as any).electronAPI = {
    ...(window as any).electronAPI,
    getNativelyUsage: async () => ({
      ok: true,
      quota: {
        ai: { used: 5_920_000, limit: 6_500_000 },
        voice: { used: 571, limit: 600 },
        knowledge: { embedding: { used: 1_890_000, limit: 2_000_000 }, reranker: { used: 900_000, limit: 5_000_000 } },
      },
    }),
    onHindsightStatus: (handler: typeof pushHindsight) => { pushHindsight = handler; return () => { pushHindsight = null; }; },
    openHindsightLog: async () => ({ ok: true }),
    openExternal: () => {},
  };
}

const CARDS = new URLSearchParams(location.search).get('cards') === '1';
let cardsHasKey = false;
let trialOutcome: 'fail' | 'hang' = 'fail';
if (CARDS) {
  (window as any).electronAPI = {
    ...(window as any).electronAPI,
    getStoredCredentials: async () => ({ hasGeminiKey: cardsHasKey }),
    openExternal: () => {},
  };
}

function CardsStage() {
  const [nap, setNap] = useState(false);
  const [trial, setTrial] = useState(false);
  const [trialKey, setTrialKey] = useState(0);
  useEffect(() => {
    (window as any).__cards = {
      nap: (open: boolean) => setNap(open),
      setKey: (has: boolean) => { cardsHasKey = has; },
      trial: (open: boolean) => { if (open) setTrialKey(k => k + 1); setTrial(open); },
      trialOutcome: (o: 'fail' | 'hang') => { trialOutcome = o; },
    };
  }, []);
  return (
    <>
      <NativelyApiPromoToaster isOpen={nap} onDismiss={() => setNap(false)} onOpenSettings={() => {}} />
      {trialKey > 0 && (
        <TrialPromoToaster
          key={trialKey}
          isOpen={trial}
          hasNativelyKey={false}
          hasTrialToken={false}
          onDismiss={() => setTrial(false)}
          onStartTrial={() => trialOutcome === 'hang'
            ? new Promise<void>(() => {})
            : Promise.reject(new Error('Could not start trial. Check your connection.'))}
          onManualSetup={() => {}}
        />
      )}
    </>
  );
}

function NoticesStage() {
  const [quotaKey, setQuotaKey] = useState(0);
  const [warning, setWarning] = useState<ProviderChangeWarning | null>(null);
  const [progress, setProgress] = useState<ReindexProgress | null>(null);
  useEffect(() => {
    (window as any).__notices = {
      // A fresh quota banner: it checks usage 3 s after it mounts, as at start-up.
      quota: () => setQuotaKey(k => k + 1),
      hindsight: (state: string, reason?: string) =>
        pushHindsight?.({ state, reason, logPath: state === 'spawning' || state === 'ready' ? undefined : '~/Library/Logs/Natively/hindsight-server.log' }),
      provider: () => setWarning({ count: 12, oldProvider: 'OpenAI', newProvider: 'Gemini' }),
      progress: (done: number, total: number) => setProgress({ done, total }),
      clearProgress: () => setProgress(null),
    };
  }, []);
  return (
    <>
      {quotaKey > 0 && <NativelyQuotaBanner key={quotaKey} />}
      <HindsightStatusBanner variant="floating-card" />
      <ProviderChangeNotice
        open={!!warning || !!progress}
        warning={warning}
        progress={progress}
        onDismiss={() => setWarning(null)}
        onReindex={() => { setProgress({ done: 0, total: warning?.count ?? 0 }); setWarning(null); }}
      />
    </>
  );
}

const params = new URLSearchParams(location.search);
const NODES = Number(params.get('nodes') ?? 272);
const CHURN = params.get('churn') === '1';
// Stress switches for the churn card: `grow=N` loads N rows instead of 6, and
// `height=1` animates a panel's height as it opens: content still arriving
// when the genie lands, which the landing picture must wait out.
const GROW = Number(params.get('grow') ?? 6);
const HEIGHT_ANIM = params.get('height') === '1';
// `load=N` blocks the main thread for N ms every 100 ms through each pour, the
// way a heavy card's mount and its data landing do in the real app.
const LOAD = Number(params.get('load') ?? 0);
// `scroll=N` scrolls the card's pane on mount (default 300; 0 = opens at its top).
const SCROLL = Number(params.get('scroll') ?? 300);
const CORNER = params.get('corner') === '1';
const KEEP = params.get('keep') === '1';

function Card() {
  const paneRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (paneRef.current) paneRef.current.scrollTop = SCROLL; }, []);
  // Each row is three elements; the sidebar and frame add about twenty.
  const rows = Math.max(1, Math.round((NODES - 20) / 3));
  return (
    <div className="flex w-full h-full" style={{ visibility: 'visible' }}>
      <div className="w-56 bg-bg-sidebar border-r border-border-subtle p-4 text-[13px] text-text-secondary space-y-2">
        {['General', 'AI Providers', 'Retrieval', 'Audio', 'Keybinds', 'About'].map(t => <div key={t}>{t}</div>)}
      </div>
      <div ref={paneRef} data-pane className="flex-1 overflow-y-auto p-6 space-y-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="rounded-lg border border-border-subtle px-3 py-2 flex justify-between">
            <span className="text-[13px] text-text-primary">Row {i + 1}</span>
            <span className="text-[12px] text-text-tertiary">value {i}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// GenieModal freezes its children while closing, so a change mid-close has to
// come from the card's own state, as it does in the real ones (a fetch
// landing, a timer): here, a status that ticks every 100 ms.
function ChurnCard() {
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState<number[] | null>(null);
  const [name, setName] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const a = setTimeout(() => setName('Ada Lovelace'), 100);
    const b = setTimeout(() => setLoaded(true), 150);
    const c = setTimeout(() => setRows(Array.from({ length: GROW }, (_, i) => i + 1)), 220);
    return () => { clearTimeout(a); clearTimeout(b); clearTimeout(c); };
  }, []);
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 100);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex w-full h-full">
      <div className="w-56 bg-bg-sidebar border-r border-border-subtle p-4 space-y-3">
        {/* A CSS entrance that finished long before any close: a fresh copy
            must not play it again (the real rows of Settings and Modes have
            these). */}
        <div data-probe="entrance" className="genie-harness-entrance text-[12px] text-text-secondary">Welcome back</div>
        <div data-probe="marker" className="text-[13px] text-text-primary">{loaded ? 'Loaded 42 modes' : 'Loading…'}</div>
        <div data-probe="status" className="text-[12px] text-text-secondary">Synced {tick} ticks ago</div>
        <div data-probe="spinner" className="w-5 h-5 rounded-full border-2 border-white/20 border-t-white animate-spin" />
        <input data-probe="input" value={name} onChange={e => setName(e.target.value)}
          className="w-full rounded-md bg-bg-input px-2 py-1 text-[12px] text-text-primary" />
      </div>
      <div className="flex-1 p-6 space-y-2">
        <motion.div data-probe="fade" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
          className="text-xl font-semibold text-text-primary">Profile Intelligence</motion.div>
        {HEIGHT_ANIM && (
          <motion.div initial={{ height: 0 }} animate={{ height: 120 }} transition={{ duration: 0.5 }}
            className="overflow-hidden rounded-lg bg-white/5 text-[12px] text-text-secondary px-3">Details expanding</motion.div>
        )}
        <div data-probe="list" className="space-y-2 overflow-hidden">
          {rows
            ? rows.map(i => <div key={i} className="rounded-lg border border-border-subtle px-3 py-2 text-[13px] text-text-primary">Mode {i}</div>)
            : [0, 1, 2].map(i => <div key={i} className="genie-harness-shimmer h-9 rounded-lg" />)}
        </div>
      </div>
    </div>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const busy = () => {
      if (!LOAD) return;
      const t = setInterval(() => { const end = performance.now() + LOAD; while (performance.now() < end) { /* busy */ } }, 100);
      setTimeout(() => clearInterval(t), 800);
    };
    (window as any).__genie = {
      open: () => { setOpen(true); busy(); },
      close: () => { setOpen(false); busy(); },
      bands: () => document.querySelectorAll('.genie-band').length,
      // 'image' when the genie is warping a picture, 'live' for live copies.
      source: () => {
        const first = document.querySelector('.genie-band > *') as HTMLElement | null;
        if (!first) return 'none';
        return first.tagName === 'CANVAS' ? 'image' : 'live';
      },
      copyScroll: () => (document.querySelector('.genie-band [data-pane]') as HTMLElement | null)?.scrollTop ?? null,
      nodes: () => document.querySelector('[data-harness-card]')?.getElementsByTagName('*').length ?? 0,
    };
  }, []);
  return (
    <div className="h-screen w-screen p-10 text-text-primary" style={{ background: '#111' }}>
      <h1 className="text-2xl font-semibold">Launcher stand-in</h1>
      <p className="text-text-secondary mt-2">Card weight: about {NODES} nodes.</p>
      {CORNER ? (
        <GenieModal
          open={open}
          label="GenieHarnessCorner"
          modal={false}
          placement="bottom-right"
          keepPictures={KEEP}
          zIndex={9999}
          padding={24}
          wrapClassName="w-[320px]"
          cardClassName="bg-[#1A1A1A] border border-amber-500/25 shadow-2xl rounded-2xl p-4 flex flex-col gap-3"
          cardProps={{ 'data-harness-card': '' }}
          shadow="0 25px 50px -12px rgba(0,0,0,0.25)"
          radius={16}
        >
          <div className="text-[13px] font-semibold text-[#E0E0E0]">Natively quota almost full</div>
          {['AI Usage', 'Embeddings', 'Voice Usage'].map((label, i) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-white/50">{label}</span>
              <span className="text-[12px] font-medium tabular-nums text-amber-400">{(5.9 + i * 0.2).toFixed(1)}M / 6.5M ({91 + i * 3}%)</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[11px] text-white/30">Resets on your next billing date</span>
            <span className="text-[11px] font-semibold text-amber-400">Upgrade</span>
          </div>
        </GenieModal>
      ) : (
      <GenieModal
        open={open}
        label="GenieHarness"
        onBackdropClick={() => setOpen(false)}
        backdropClassName="bg-black/60"
        wrapClassName="w-[820px] h-[600px] max-w-[95vw] max-h-[90vh]"
        cardClassName="rounded-2xl border border-border-muted bg-bg-elevated shadow-2xl"
        cardProps={{ 'data-harness-card': '' }}
        shadow="0 25px 50px -12px rgba(0,0,0,0.25)"
        radius={16}
      >
        {CHURN ? <ChurnCard /> : <Card />}
      </GenieModal>
      )}
    </div>
  );
}

// A skeleton shimmer, the common infinite animation in a loading card.
const style = document.createElement('style');
style.textContent = `@keyframes genie-harness-entrance { from { opacity: 0; transform: translateY(6px); } }
.genie-harness-entrance { animation: genie-harness-entrance 250ms ease-out; }
@keyframes genie-harness-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.genie-harness-shimmer { background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.12), rgba(255,255,255,.04));
  background-size: 200% 100%; animation: genie-harness-shimmer 1.2s linear infinite; }`;
document.head.appendChild(style);

createRoot(document.getElementById('harness-root')!).render(CARDS ? <CardsStage /> : NOTICES ? <NoticesStage /> : <Harness />);
