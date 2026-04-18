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

            setStatus('ready');
            setIsVisible(true);
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
        if (window.electronAPI.platform === 'darwin') {
            try {
                const arch = await window.electronAPI.getArch();
                const isArm = arch === 'arm64';
                const dmgSuffix = isArm ? 'arm64' : 'x64';
                setInstructionsArch(dmgSuffix);
                const version = updateInfo?.version ? updateInfo.version.replace('v', '') : '2.0.8';
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
