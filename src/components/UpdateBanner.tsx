import React, { useEffect, useState } from 'react';
import UpdateModal from './UpdateModal';

const UpdateBanner: React.FC = () => {
    const [updateInfo, setUpdateInfo] = useState<any>(null);
    const [parsedNotes, setParsedNotes] = useState<any>(null);
    const [isVisible, setIsVisible] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [status, setStatus] = useState<'idle' | 'downloading' | 'ready' | 'error' | 'instructions'>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [instructionsArch, setInstructionsArch] = useState<'arm64' | 'x64' | null>(null);
    // Whether this build can install + relaunch in place (signed macOS build, or
    // any packaged Windows/Linux build). Drives whether "Install" runs the real
    // in-app download flow or falls back to the manual DMG-download instructions.
    const [canAutoUpdate, setCanAutoUpdate] = useState(false);

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
        const unsubAvailable = window.electronAPI.onUpdateAvailable((info: any) => {
            console.log('[UpdateBanner] Update available:', info);
            setUpdateInfo(info);
            setErrorMessage(null);
            setStatus('idle'); // Reset from any prior error/state before showing update info
            // If parsed notes are included in the info object (from our backend change)
            if (info.parsedNotes) {
                setParsedNotes(info.parsedNotes);
            }
            setIsVisible(true);
        });

        // Listen for download progress
        const unsubProgress = window.electronAPI.onDownloadProgress((progressObj) => {
            // Ensure modal is visible if download starts
            setIsVisible(true);
            setStatus('downloading');
            setDownloadProgress(progressObj.percent);
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
        });

        return () => {
            unsubAvailable();
            unsubProgress();
            unsubDownloaded();
            unsubError();
        };
    }, []);

    // Demo/Test mode: Press Cmd+I to trigger backend test-fetch or Cmd+J for UI mock
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!import.meta.env.DEV) return;
            
            if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'i') {
                e.preventDefault();
                console.log("[UpdateBanner] Cmd+I pressed: Triggering Test Release Fetch...");
                window.electronAPI.testReleaseFetch().catch(console.error);
            }
            
            if (e.metaKey && !e.shiftKey && e.key.toLowerCase() === 'j') {
                e.preventDefault();
                console.log("[UpdateBanner] Cmd+J pressed: Triggering Instruction UI mock...");
                setUpdateInfo({ version: '2.0.8' });
                setParsedNotes({ summary: 'Test Update', fullBody: 'Testing', sections: [{ title: 'Notes', items: ['UI Test'] }] });
                setStatus('idle');
                setIsVisible(true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleInstall = async () => {
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
                console.warn('[UpdateBanner] No version in updateInfo — triggering in-app download instead of manual DMG URL');
                setStatus('downloading');
                window.electronAPI.downloadUpdate();
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
                setStatus('downloading');
                window.electronAPI.downloadUpdate();
            }
        } else {
            setStatus('downloading');
            // Trigger download via IPC
            window.electronAPI.downloadUpdate();
        }
    };

    const handleDismiss = () => {
        setIsVisible(false);
        setStatus('idle'); // Reset error/downloading state so next event starts clean
    };

    if (!isVisible) return null;

    return (
        <UpdateModal
            isOpen={isVisible}
            updateInfo={updateInfo}
            parsedNotes={parsedNotes}
            onDismiss={handleDismiss}
            onInstall={handleInstall}
            downloadProgress={downloadProgress}
            status={status}
            errorMessage={errorMessage}
            instructionsArch={instructionsArch}
        />
    );
};

export default UpdateBanner;
