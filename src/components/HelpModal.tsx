import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Rocket, Shield, Mic, Key, Sparkles, AlertCircle } from 'lucide-react';
import { useT } from '../i18n';
import { SetupGuide, HelpSettings, type HelpSection } from './settings/HelpSettings';

type ActiveTab = 'setup' | HelpSection;

const NAV_ITEMS: Array<{ tab: HelpSection; label: string; icon: React.ReactNode }> = [
    { tab: 'permissions', label: 'Permissions', icon: <Shield size={16} /> },
    { tab: 'audio', label: 'Audio', icon: <Mic size={16} /> },
    { tab: 'ai-providers', label: 'AI Providers', icon: <Key size={16} /> },
    { tab: 'features', label: 'Features', icon: <Sparkles size={16} /> },
    { tab: 'troubleshooting', label: 'Troubleshooting', icon: <AlertCircle size={16} /> },
];

interface HelpModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialTab?: ActiveTab;
    onOpenSettings?: (tab?: string) => void;
}

const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose, initialTab = 'setup', onOpenSettings }) => {
    const t = useT();
    const [activeTab, setActiveTab] = useState<ActiveTab>(initialTab);

    useEffect(() => {
        if (isOpen) setActiveTab(initialTab);
    }, [isOpen, initialTab]);

    const navItemClass = (active: boolean) =>
        `w-full text-left px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors duration-150 ease-out ${
            active
                ? 'text-text-primary bg-bg-item-active'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-item-active/50'
        }`;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="help-modal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/60 backdrop-blur-sm"
                    onClick={(e) => {
                        if (e.target !== e.currentTarget) return;
                        onClose();
                    }}
                >
                    <motion.div
                        data-settings-theme="periwinkle"
                        initial={{ scale: 0.94, opacity: 0, y: 20 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        exit={{ scale: 0.94, opacity: 0, y: 20 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 32, mass: 1 }}
                        className="bg-bg-elevated w-full max-w-4xl h-[80vh] rounded-2xl border border-border-subtle shadow-2xl overflow-hidden relative"
                    >
                        <div className="flex w-full h-full">
                            {/* Sidebar */}
                            <div className="w-64 bg-bg-sidebar flex flex-col border-r border-border-subtle">
                                <button
                                    onClick={onClose}
                                    className="self-start ml-2 mt-2 mb-1 p-1.5 rounded-md text-text-tertiary hover:text-text-primary transition-colors"
                                    title={t('Close')}
                                    aria-label={t('Close')}
                                >
                                    <X size={15} />
                                </button>
                                <div className="px-5 pt-2 pb-3 overflow-y-auto flex-1 min-h-0">
                                    <h2 className="mb-0 text-[13px] font-bold uppercase tracking-[0.01em] text-text-primary">{t('Help & Setup')}</h2>
                                    <nav className="mt-2 space-y-1">
                                        <button onClick={() => setActiveTab('setup')} className={navItemClass(activeTab === 'setup')}>
                                            <Rocket size={16} /> {t('Setup')}
                                        </button>
                                        {NAV_ITEMS.map(item => (
                                            <button key={item.tab} onClick={() => setActiveTab(item.tab)} className={navItemClass(activeTab === item.tab)}>
                                                {item.icon} {t(item.label)}
                                            </button>
                                        ))}
                                    </nav>
                                </div>
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-h-0 overflow-y-auto p-8">
                                {activeTab === 'setup' && <SetupGuide onNavigate={onOpenSettings} />}
                                {activeTab !== 'setup' && <HelpSettings section={activeTab} />}
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default HelpModal;
