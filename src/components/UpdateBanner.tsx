import React, { useEffect, useState, useRef } from 'react';
import UpdateModal, { UpdateCornerToast, LATEST_RELEASE_URL, type DownloadDetail } from './UpdateModal';
import { isUpdateDismissed, readUpdateDismissal, writeUpdateDismissal } from '../lib/updatePromptPolicy.mjs';
import { useCornerSlot } from '../hooks/useCornerSlot';

/** This window's localStorage, or null where it refuses. */
function localStore(): Storage | null {
    try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

type UpdateInfo = {
    version?: string;
    parsedNotes?: ParsedReleaseNotes;
};

type ParsedReleaseNotes = {
    version: string;
    summary: string;
    sections: Array<{ title: string; items: string[] }>;
    fullBody?: string;
    url?: string;
};

interface UpdateBannerProps {
    /**
     * Nothing else holds the screen: no first-run Welcome or tour, no Settings,
     * no onboarding card, no Trial ended card (App.tsx). The card waits until
     * then; it does not open over them. Default: true.
     */
    canOpen?: boolean;
    /**
     * Take the one full-window card slot from the launcher's card scheduler
     * (OnboardingOrchestrator.claimExternalCard); false while a card holds it.
     * While held, no onboarding card opens.
     */
    claimSlot?: () => boolean;
    /** Give the slot back once the card is closed or shrunk to its corner toast. */
    releaseSlot?: () => void;
}

const UpdateBanner: React.FC<UpdateBannerProps> = ({ canOpen = true, claimSlot, releaseSlot }) => {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [parsedNotes, setParsedNotes] = useState<ParsedReleaseNotes | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    // Bytes, total and speed from the same event, for the card's live figures.
    const [downloadDetail, setDownloadDetail] = useState<DownloadDetail | null>(null);
    const [status, setStatus] = useState<'idle' | 'downloading' | 'ready' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    // Whether this build can install + relaunch in place (signed macOS build, or
    // any packaged Windows/Linux build). Drives whether "Install" runs the real
    // in-app download flow or just opens the release page.
    const [canAutoUpdate, setCanAutoUpdate] = useState(false);
    // Tracks whether the user explicitly dismissed the toast — progress events
    // should not override a deliberate dismiss.
    const userDismissedRef = useRef(false);
    // Hiding a running download shrinks the card to a corner toast instead of
    // closing it; the toast brings the card back or closes it for good.
    const [minimized, setMinimized] = useState(false);

    useEffect(() => {
        let cancelled = false;
        window.electronAPI.getCanAutoUpdate?.()
            .then(({ canAutoUpdate }) => { if (!cancelled) setCanAutoUpdate(canAutoUpdate); })
            .catch((err) => {
                if (cancelled) return;
                // Silent failure falls through to default false (manual fallback) — log for observability.
                console.warn('[UpdateBanner] getCanAutoUpdate failed, using manual fallback:', err);
            });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        // Listen for update available
        const unsubAvailable = window.electronAPI.onUpdateAvailable((info: UpdateInfo) => {
            console.log('[UpdateBanner] Update available:', info);
            setUpdateInfo(info);
            setErrorMessage(null);
            setStatus('idle'); // Reset from any prior error/state before showing update info
            // If parsed notes are included in the info object (from our backend change)
            if (info.parsedNotes) {
                setParsedNotes(info.parsedNotes);
            }
            // A new update cycle begins — clear any prior dismiss state so the toast shows.
            userDismissedRef.current = false;
            setMinimized(false);
            // This version was closed in the last 7 days (updatePromptPolicy.mjs):
            // it does not open the card by itself. A download started from
            // Settings still shows its progress.
            if (isUpdateDismissed(readUpdateDismissal(localStore()), info?.version, Date.now())) {
                console.log('[UpdateBanner] version closed recently; not opening the card:', info?.version);
                return;
            }
            setIsVisible(true);
        });

        // Listen for download progress
        const unsubProgress = window.electronAPI.onDownloadProgress((progressObj) => {
            // Re-show toast only if user hasn't explicitly dismissed it
            if (!userDismissedRef.current) {
                setIsVisible(true);
            }
            setStatus('downloading');
            setDownloadProgress(progressObj.percent);
            setDownloadDetail({
                transferred: progressObj.transferred,
                total: progressObj.total,
                bytesPerSecond: progressObj.bytesPerSecond,
            });
        });

        // Listen for update-downloaded event
        const unsubDownloaded = window.electronAPI.onUpdateDownloaded((info) => {
            console.log('[UpdateBanner] Update downloaded:', info);
            setUpdateInfo(info); // Update info again just in case
            if (info.parsedNotes) setParsedNotes(info.parsedNotes);
            // Guard: only transition to ready if we have a version. If version is
            // absent (shouldn't happen), fall through to error handling rather
            // than silently showing "ready" with no version to install.
            if (info?.version) {
                setStatus('ready');
                setIsVisible(true);
            } else {
                console.warn('[UpdateBanner] update-downloaded received with no version');
                setStatus('error');
                setErrorMessage('Update downloaded but version is unknown. Please download from GitHub releases.');
            }
        });

        // Listen for update errors
        const unsubError = window.electronAPI.onUpdateError((err: string) => {
            console.error('[UpdateBanner] Update error:', err);
            setStatus('error');
            setErrorMessage(err);
            // The corner toast has no error view; bring the full card back.
            setMinimized(false);
        });

        return () => {
            unsubAvailable();
            unsubProgress();
            unsubDownloaded();
            unsubError();
        };
    }, []);

    // Dev-only mock: Ctrl/Cmd+Shift+U opens a fake update, and "Update now" then
    // simulates the download (progress, size, speed) instead of calling the
    // updater, so the whole card can be checked without a published release.
    const mockRef = useRef(false);
    const mockTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    useEffect(() => () => { if (mockTimerRef.current) clearInterval(mockTimerRef.current); }, []);

    const startMockDownload = () => {
        const total = 84 * 1_048_576;
        const bytesPerSecond = 4.2 * 1_048_576;
        let transferred = 0;
        setStatus('downloading');
        if (mockTimerRef.current) clearInterval(mockTimerRef.current);
        mockTimerRef.current = setInterval(() => {
            // 4x real time, so the mock finishes in about 5 seconds.
            transferred = Math.min(total, transferred + bytesPerSecond * 0.25 * 4);
            setDownloadProgress((transferred / total) * 100);
            setDownloadDetail({ transferred, total, bytesPerSecond });
            if (transferred >= total) {
                clearInterval(mockTimerRef.current!);
                mockTimerRef.current = null;
                setStatus('ready');
                setIsVisible(true);
            }
        }, 250);
    };

    // Demo/Test mode: Cmd+I triggers the backend test-fetch; Ctrl/Cmd+Shift+U the UI mock.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!import.meta.env.DEV) return;
            
            if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'i') {
                e.preventDefault();
                console.log("[UpdateBanner] Cmd+I pressed: Triggering Test Release Fetch...");
                window.electronAPI.testReleaseFetch().catch(console.error);
            }
            
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'u') {
                e.preventDefault();
                console.log("[UpdateBanner] Ctrl/Cmd+Shift+U pressed: opening mock update...");
                mockRef.current = true;
                if (mockTimerRef.current) { clearInterval(mockTimerRef.current); mockTimerRef.current = null; }
                userDismissedRef.current = false;
                // Shaped like ReleaseNotesManager's output for a real release:
                // its section names, markdown left in the bullets.
                setUpdateInfo({ version: '9.9.9' });
                setParsedNotes({ version: 'V9.9.9', summary: 'A sample release — a faster answer engine, **Profile Intelligence** in your own voice, and quieter meetings on Windows.', url: LATEST_RELEASE_URL, sections: [
                    { title: "What's New", items: ['**Profile Intelligence** answers in your own voice.', '**Company research.** Runs in the background after a JD upload.'] },
                    { title: 'Improvements', items: ['Faster transcription start on Windows — no more stall when a meeting starts.', 'Lower memory use during long meetings.'] },
                    { title: 'Fixes', items: ['**Overlay.** No longer loses focus after a screenshot.'] },
                ] });
                setDownloadProgress(0);
                setDownloadDetail(null);
                setErrorMessage(null);
                setStatus('idle');
                setMinimized(false);
                setIsVisible(true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleInstall = () => {
        if (import.meta.env.DEV && mockRef.current) { startMockDownload(); return; }
        // Signed macOS builds (and all packaged Windows/Linux builds) can download
        // and install in place, so always use the real in-app flow: download via
        // IPC, then "Restart & Install" once ready.
        if (canAutoUpdate) {
            setStatus('downloading');
            window.electronAPI.downloadUpdate();
            return;
        }

        // A macOS build that can't install in place (unsigned: a dev build, or
        // one built from source) can't be updated from here; release builds are
        // signed and never get this far. Send it to the release page instead.
        if (window.electronAPI.platform === 'darwin') {
            window.electronAPI.openExternal(parsedNotes?.url || LATEST_RELEASE_URL);
            handleClose();
            return;
        }

        setStatus('downloading');
        window.electronAPI.downloadUpdate();
    };

    const handleDismiss = () => {
        // Hiding a running download keeps it visible in the corner.
        if (status === 'downloading') {
            setMinimized(true);
            return;
        }
        handleUserClose();
    };

    /** The user closed the card or its toast: this version stays closed for 7 days. */
    const handleUserClose = () => {
        if (!(import.meta.env.DEV && mockRef.current)) {
            writeUpdateDismissal(localStore(), updateInfo?.version, Date.now());
        }
        handleClose();
    };

    const handleClose = () => {
        if (mockTimerRef.current) { clearInterval(mockTimerRef.current); mockTimerRef.current = null; }
        mockRef.current = false;
        userDismissedRef.current = true;
        setIsVisible(false);
        setMinimized(false);
        setStatus('idle'); // Reset error/downloading state so next event starts clean
    };

    // One full-window card at a time (2026-11-09): the card opens only when
    // nothing else holds the screen, and holds the scheduler's slot while
    // open, so no onboarding card opens over it. It waits, it is not lost.
    // A user expanding the corner toast is let through: they asked for it.
    const wantsCard = isVisible && !minimized;
    const [holdsSlot, setHoldsSlot] = useState(false);
    const expandRequestedRef = useRef(false);
    useEffect(() => {
        if (wantsCard && !holdsSlot) {
            const asked = expandRequestedRef.current;
            if (!asked && !canOpen) return;
            if ((claimSlot?.() ?? true) || asked) {
                expandRequestedRef.current = false;
                setHoldsSlot(true);
            }
            return;
        }
        if (!wantsCard && holdsSlot) {
            releaseSlot?.();
            setHoldsSlot(false);
        }
    }, [wantsCard, holdsSlot, canOpen, claimSlot, releaseSlot]);
    // Unmounting gives the slot back.
    const releaseRef = useRef(releaseSlot);
    releaseRef.current = releaseSlot;
    const holdsSlotRef = useRef(holdsSlot);
    holdsSlotRef.current = holdsSlot;
    useEffect(() => () => { if (holdsSlotRef.current) releaseRef.current?.(); }, []);
    const cardOpen = wantsCard && holdsSlot;

    // The corner toast shares the bottom-right corner with the other notices.
    const corner = useCornerSlot('update', isVisible && minimized);

    // Always rendered: UpdateModal's GenieModal plays the close after
    // isVisible goes false, and an early return here would cut it off.
    // Hiding and expanding are hand-overs between the card and the corner
    // toast: only the incoming one pours, the outgoing one goes at once.
    return (
        <>
        <UpdateCornerToast
            isOpen={corner.show}
            closeInstantly={(isVisible && !minimized) || corner.displaced}
            updateInfo={updateInfo}
            downloadProgress={downloadProgress}
            downloadDetail={downloadDetail}
            status={status}
            onExpand={() => { expandRequestedRef.current = true; setMinimized(false); }}
            onClose={handleUserClose}
        />
        <UpdateModal
            isOpen={cardOpen}
            closeInstantly={isVisible && minimized}
            updateInfo={updateInfo}
            parsedNotes={parsedNotes}
            onDismiss={handleDismiss}
            onInstall={handleInstall}
            downloadProgress={downloadProgress}
            downloadDetail={downloadDetail}
            status={status}
            errorMessage={errorMessage}
            canAutoUpdate={canAutoUpdate}
        />
        </>
    );
};

export default UpdateBanner;
