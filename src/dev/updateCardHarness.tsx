// DEV-ONLY rig for the update card and its corner toast (UpdateModal.tsx). Not
// part of the shipped app: vite's build input is index.html only, so this and
// updateCardHarness.html exist for the dev server alone. Same precedent as
// genieHarness.tsx.
//
// Why a rig: the live launcher is an Electron window, and the moment another
// window covers it Chromium stops animation frames, so the state handovers
// never run and nothing can be recorded. Here the real components run in an
// ordinary tab, fed a scripted updater instead of IPC.
//
// `?play=1` runs the whole sequence once: available -> downloading -> ready ->
// error -> available in the card, then downloading -> ready in the corner toast.
// Without it the buttons along the top step through the states by hand.
// `?theme=dark` renders the dark card.
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import UpdateModal, { UpdateCornerToast, type DownloadDetail } from '../components/UpdateModal';

// Every call is `window.electronAPI?.foo?.()`: a no-op answers the calls, and
// listeners (`on…`) hand back an unsubscribe.
const noop = async () => ([] as any);
(window as any).electronAPI = new Proxy({}, {
    get: (_, name) => (String(name).startsWith('on') ? () => () => {} : noop),
});
// The card takes its theme from <html data-theme>, which the app sets from its
// own setting. `?theme=dark` for the dark card; light otherwise.
document.documentElement.setAttribute('data-theme', new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light');

const TOTAL = 84 * 1_048_576;
const SPEED = 5.1 * 1_048_576;
// The published V2.8.8 release as ReleaseNotesManager hands it over: its own
// summary, and sections the size of the real ones (only the counts show).
const fill = (n: number, what: string) => Array.from({ length: n }, (_, i) => `${what} ${i + 1}`);
const NOTES = {
    version: 'V2.8.8',
    summary: 'Three months of work since v2.7.0 — a smarter answer engine, Auto Answer for meetings, rebuilt meeting notes, a Chrome companion extension, NVIDIA speech, and Windows stealth typing.',
    sections: [
        { title: "What's New", items: fill(12, 'Feature') },
        { title: 'Improvements', items: fill(6, 'Improvement') },
        { title: 'Fixes', items: fill(11, 'Fix') },
    ],
    url: 'https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/releases/tag/V2.8.8',
};

type Status = 'idle' | 'downloading' | 'ready' | 'error';

const Harness: React.FC = () => {
    const [status, setStatus] = useState<Status>('idle');
    const [progress, setProgress] = useState(0);
    const [detail, setDetail] = useState<DownloadDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [minimized, setMinimized] = useState(false);
    const [open, setOpen] = useState(false);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopTicking = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
    const download = (from: number) => {
        stopTicking();
        let p = from;
        setProgress(p); setStatus('downloading'); setError(null);
        timer.current = setInterval(() => {
            p = Math.min(99, p + 4);
            setProgress(p);
            setDetail({ transferred: (p / 100) * TOTAL, total: TOTAL, bytesPerSecond: SPEED });
        }, 120);
    };
    const ready = () => { stopTicking(); setProgress(100); setStatus('ready'); };
    const fail = () => { stopTicking(); setError('net::ERR_INTERNET_DISCONNECTED'); setStatus('error'); };
    const available = () => { stopTicking(); setError(null); setStatus('idle'); setProgress(0); };

    useEffect(() => {
        const at = (ms: number, f: () => void) => setTimeout(f, ms);
        setOpen(true);
        if (new URLSearchParams(location.search).get('play') !== '1') return;
        const ids = [
            at(1800, () => download(0)),
            at(5000, ready),
            at(7400, fail),
            at(9600, available),
            at(11600, () => { download(40); setMinimized(true); }),
            at(15000, ready),
        ];
        return () => { ids.forEach(clearTimeout); stopTicking(); };
    }, []);

    const button = (label: string, onClick: () => void) => (
        <button type="button" onClick={onClick} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.15)', background: '#fff', font: '500 12px system-ui', cursor: 'pointer' }}>{label}</button>
    );

    return (
        <div style={{ position: 'fixed', inset: 0, background: '#F2F2F7' }}>
            <div style={{ position: 'fixed', top: 12, left: 12, display: 'flex', gap: 6, zIndex: 1 }}>
                {button('Available', available)}
                {button('Downloading', () => download(20))}
                {button('Ready', ready)}
                {button('Error', fail)}
                {button(minimized ? 'Card' : 'Corner toast', () => setMinimized(m => !m))}
            </div>
            <UpdateCornerToast
                isOpen={open && minimized}
                closeInstantly={open && !minimized}
                updateInfo={{ version: '2.8.8' }}
                downloadProgress={progress}
                downloadDetail={detail}
                status={status}
                onExpand={() => setMinimized(false)}
                onClose={() => setOpen(false)}
            />
            <UpdateModal
                isOpen={open && !minimized}
                closeInstantly={open && minimized}
                updateInfo={{ version: '2.8.8' }}
                parsedNotes={NOTES}
                onDismiss={() => (status === 'downloading' ? setMinimized(true) : setOpen(false))}
                onInstall={() => download(0)}
                downloadProgress={progress}
                downloadDetail={detail}
                status={status}
                errorMessage={error}
                canAutoUpdate
            />
        </div>
    );
};

createRoot(document.getElementById('harness-root')!).render(<Harness />);
