import React, { useState, useEffect } from 'react';
import { Info, Monitor, Globe } from 'lucide-react';

interface GeneralSettingsProps { }

export const GeneralSettings: React.FC<GeneralSettingsProps> = () => {
    // Recognition Language
    const [recognitionLanguage, setRecognitionLanguage] = useState('english-us');
    const [availableLanguages, setAvailableLanguages] = useState<Record<string, any>>({});
    
    // AI Response Language
    const [aiResponseLanguage, setAiResponseLanguage] = useState('English');
    const [availableAiLanguages, setAvailableAiLanguages] = useState<any[]>([]);

    // Google Service Account
    const [serviceAccountPath, setServiceAccountPath] = useState('');

    useEffect(() => {
        const loadInitialData = async () => {
            // Load Credentials
            try {
                // @ts-ignore  
                const creds = await window.electronAPI?.getStoredCredentials?.();
                if (creds && creds.googleServiceAccountPath) {
                    setServiceAccountPath(creds.googleServiceAccountPath);
                }
            } catch (e) {
                console.error("Failed to load stored credentials:", e);
            }

            // Load STT Languages
            if (window.electronAPI?.getRecognitionLanguages) {
                const langs = await window.electronAPI.getRecognitionLanguages();
                setAvailableLanguages(langs);

                const storedStt = await window.electronAPI.getSttLanguage();
                setRecognitionLanguage(storedStt || 'english-us');
            }

            // Load AI Response Languages
            if (window.electronAPI?.getAiResponseLanguages) {
                const aiLangs = await window.electronAPI.getAiResponseLanguages();
                setAvailableAiLanguages(aiLangs);

                const storedAi = await window.electronAPI.getAiResponseLanguage();
                setAiResponseLanguage(storedAi || 'English');
            }
        };
        loadInitialData();
    }, []);

    const handleLanguageChange = async (key: string) => {
        setRecognitionLanguage(key);
        if (window.electronAPI?.setRecognitionLanguage) {
            await window.electronAPI.setRecognitionLanguage(key);
        }
    };

    const handleAiLanguageChange = async (key: string) => {
        setAiResponseLanguage(key);
        if (window.electronAPI?.setAiResponseLanguage) {
            await window.electronAPI.setAiResponseLanguage(key);
        }
    };

    const handleSelectServiceAccount = async () => {
        try {
            const result = await window.electronAPI.selectServiceAccount();
            if (result.success && result.path) {
                setServiceAccountPath(result.path);
            }
        } catch (error) {
            console.error("Failed to select service account:", error);
        }
    };

    return (
        <div className="space-y-8 animated fadeIn">
            <div>
                <h3 className="text-lg font-bold text-text-primary mb-2">General Configuration</h3>
                <p className="text-xs text-text-secondary mb-4">Core settings for Natively.</p>

                <div className="space-y-4">
                    {/* Google Cloud Service Account */}
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                        <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">Google Speech-to-Text Key (JSON)</label>
                        <div className="flex gap-3">
                            <div className="flex-1 bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-secondary truncate flex items-center">
                                {serviceAccountPath || "No file selected"}
                            </div>
                            <button
                                onClick={handleSelectServiceAccount}
                                className="bg-bg-input hover:bg-bg-secondary border border-border-subtle text-text-primary px-5 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap"
                            >
                                Select File
                            </button>
                        </div>
                        <p className="text-xs text-text-tertiary mt-2">Required for accurate speech recognition.</p>
                    </div>

                    {/* Recognition Language */}
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                        <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">Recognition Language (STT)</label>
                        <div className="relative">
                            <select
                                value={recognitionLanguage}
                                onChange={(e) => handleLanguageChange(e.target.value)}
                                className="w-full appearance-none bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors cursor-pointer"
                            >
                                {Object.entries(availableLanguages).map(([key, lang]) => (
                                    <option key={key} value={key}>
                                        {lang.label}
                                    </option>
                                ))}
                            </select>
                            <Globe size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
                        </div>
                        <p className="text-xs text-text-tertiary mt-2">The language you and the interviewer are speaking.</p>
                    </div>

                    {/* AI Response Language */}
                    <div className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle">
                        <label className="block text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">AI Response Language</label>
                        <div className="relative">
                            <select
                                value={aiResponseLanguage}
                                onChange={(e) => handleAiLanguageChange(e.target.value)}
                                className="w-full appearance-none bg-bg-input border border-border-subtle rounded-lg px-4 py-2.5 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors cursor-pointer"
                            >
                                {availableAiLanguages.map((lang) => (
                                    <option key={lang.code} value={lang.code}>
                                        {lang.label}
                                    </option>
                                ))}
                            </select>
                            <Info size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
                        </div>
                        <p className="text-xs text-text-tertiary mt-2">The language in which the AI will provide its suggestions.</p>
                    </div>
                </div>
            </div>
        </div>
    );
};
