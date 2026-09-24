import React, { useEffect, useState, useRef } from 'react';
import UpdateModal, { UpdateCornerToast, LATEST_RELEASE_URL, type DownloadDetail } from './UpdateModal';

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

const UpdateBanner: React.FC = () => {
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [parsedNotes, setParsedNotes] = useState<ParsedReleaseNotes | null>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    // Bytes, total and speed from the same event, for the card's live figures.
    const [downloadDetail, setDownloadDetail] = useState<DownloadDetail | null>(null);
    const [status, setStatus] = useState<'idle' | 'downloading' | 'ready' | 'error' | 'instructions'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [instructionsArch, setInstructionsArch] = useState<'arm64' | 'x64' | null>(null);
    // Whether this build can install + relaunch in place (signed macOS build, or
    // any packaged Windows/Linux build). Drives whether "Install" runs the real
    // in-app download flow or falls back to the manual DMG-download instructions.
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
            setIsVisible(true);
            // A new update cycle begins — clear any prior dismiss state so the toast shows.
            userDismissedRef.current = false;
            setMinimized(false);
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
                setUpdateInfo({ version: '2.4.0' });
                setParsedNotes({ version: '2.4.0', summary: '', sections: [
                    { title: 'New', items: ['Profile Intelligence answers in your own voice', 'Company research runs in the background after a JD upload'] },
                    { title: 'Improved', items: ['Faster transcription start on Windows', 'Lower memory use during long meetings'] },
                    { title: 'Fixed', items: ['Overlay no longer loses focus after a screenshot'] },
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

    const handleInstall = async () => {
        if (import.meta.env.DEV && mockRef.current) { startMockDownload(); return; }
        // Signed macOS builds (and all packaged Windows/Linux builds) can download
        // and install in place, so always use the real in-app flow: download via
        // IPC, then "Restart & Install" once ready.
        if (canAutoUpdate) {
            setStatus('downloading');
            window.electronAPI.downloadUpdate();
            return;
        }

        // FALLBACK (unsigned macOS build): we can't swap+relaunch in place, so send
        // the user to the signed DMG on GitHub and show the manual-install steps.
        // Guard: if version is absent, fall back to triggering download (which will
        // surface an error) rather than sending user to a broken GitHub URL.
        if (window.electronAPI.platform === 'darwin') {
            if (!updateInfo?.version) {
                console.warn('[UpdateBanner] No version in updateInfo — opening latest GitHub release instead of in-app download');
                window.electronAPI.openExternal(LATEST_RELEASE_URL);
                setStatus('instructions');
                return;
            }
            try {
                const arch = await window.electronAPI.getArch();
                const isArm = arch === 'arm64';
                const dmgSuffix = isArm ? 'arm64' : 'x64';
                setInstructionsArch(dmgSuffix);
                const version = updateInfo.version.replace('v', '');
                const url = `https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/releases/download/v${version}/Natively-${version}-${dmgSuffix}.dmg`;
                window.electronAPI.openExternal(url);
                setStatus('instructions');
            } catch (err) {
                console.error("Failed to get arch", err);
                window.electronAPI.openExternal(LATEST_RELEASE_URL);
                setStatus('instructions');
            }
        } else {
            setStatus('downloading');
            // Trigger download via IPC
            window.electronAPI.downloadUpdate();
        }
    };

    const handleDismiss = () => {
        // Hiding a running download keeps it visible in the corner.
        if (status === 'downloading') {
            setMinimized(true);
            return;
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

    // Always rendered: UpdateModal's GenieModal plays the close after
    // isVisible goes false, and an early return here would cut it off.
    // Hiding and expanding are hand-overs between the card and the corner
    // toast: only the incoming one pours, the outgoing one goes at once.
    return (
        <>
        <UpdateCornerToast
            isOpen={isVisible && minimized}
            closeInstantly={isVisible && !minimized}
            updateInfo={updateInfo}
            downloadProgress={downloadProgress}
            downloadDetail={downloadDetail}
            status={status}
            onExpand={() => setMinimized(false)}
            onClose={handleClose}
        />
        <UpdateModal
            isOpen={isVisible && !minimized}
            closeInstantly={isVisible && minimized}
            updateInfo={updateInfo}
            parsedNotes={parsedNotes}
            onDismiss={handleDismiss}
            onInstall={handleInstall}
            downloadProgress={downloadProgress}
            downloadDetail={downloadDetail}
            status={status}
            errorMessage={errorMessage}
            instructionsArch={instructionsArch}
            canAutoUpdate={canAutoUpdate}
        />
        </>
    );
};

export default UpdateBanner;
