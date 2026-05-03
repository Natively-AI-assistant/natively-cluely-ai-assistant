import React, { useState, useEffect } from 'react';
import {
    Lock, Key, CheckCircle, AlertCircle, Check, Copy, X, Sparkles, PlayCircle,
    Layers, UserCheck, Database, TrendingUp, Maximize2, Target, FileText, Building2
} from 'lucide-react';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { NativelyLogoMark } from '../NativelyLogoMark';

// ─── Card wrapper ────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`bg-bg-item-surface rounded-2xl border border-border-subtle overflow-hidden ${className}`}>
            {children}
        </div>
    );
}

export const NativelyProSettings: React.FC = () => {
    const isLight = useResolvedTheme() === 'light';
    const [licenseKey, setLicenseKey] = useState('');
    const [hardwareId, setHardwareId] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');
    const [copiedHwid, setCopiedHwid] = useState(false);
    
    // We fetch isPremium ourselves so SettingsOverlay doesn't need to pass it
    const [isPremium, setIsPremium] = useState<boolean | null>(null);

    const refreshLicense = async () => {
        try {
            const details = await window.electronAPI?.licenseGetDetails?.();
            setIsPremium(details?.isPremium ?? false);
        } catch {
            // fallback
            const check = window.electronAPI?.licenseCheckPremiumAsync ?? window.electronAPI?.licenseCheckPremium;
            if (check) {
                const active = await check();
                setIsPremium(active);
            } else {
                setIsPremium(false);
            }
        }
    };

    useEffect(() => {
        window.electronAPI?.licenseGetHardwareId?.().then(setHardwareId).catch(() => setHardwareId('unavailable'));
        refreshLicense();

        // Optional: listen to license status changes if the main process sends them
        const onStatusChanged = () => refreshLicense();
        // @ts-ignore
        if (window.electronAPI?.onLicenseStatusChanged) {
            // @ts-ignore
            window.electronAPI.onLicenseStatusChanged(onStatusChanged);
        }
    }, []);

    const handleActivate = async () => {
        if (!licenseKey.trim()) return;
        setStatus('loading');
        setErrorMessage('');

        try {
            const result = await window.electronAPI?.licenseActivate?.(licenseKey.trim());
            if (result?.success) {
                setStatus('success');
                setLicenseKey('');
                setTimeout(() => {
                    refreshLicense();
                    setStatus('idle');
                }, 1200);
            } else {
                setStatus('error');
                setErrorMessage(result?.error || 'Activation failed. Please try again.');
            }
        } catch (e: any) {
            setStatus('error');
            setErrorMessage(e.message || 'Activation failed.');
        }
    };

    const handleDeactivate = async () => {
        try {
            await window.electronAPI?.licenseDeactivate?.();
            refreshLicense();
        } catch (e: any) {
            setErrorMessage(e.message || 'Deactivation failed.');
        }
    };

    const copyHardwareId = () => {
        navigator.clipboard.writeText(hardwareId);
        setCopiedHwid(true);
        setTimeout(() => setCopiedHwid(false), 2000);
    };

    if (isPremium === null) {
        return <div className="p-8 flex justify-center"><div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
    }

    return (
        <div className="space-y-4 animated fadeIn">
            {/* Page title */}
            <div>
                <h3 className="text-[15px] font-semibold text-text-primary tracking-[-0.01em]">Natively Pro</h3>
                <p className="text-[12px] text-text-tertiary mt-0.5 leading-snug">
                    Profile Engine &amp; Job Description Intelligence
                </p>
            </div>

            {isPremium ? (
                <Card>
                    <div className="flex flex-col items-center text-center py-8 px-6">
                        <div className="w-16 h-16 rounded-[16px] bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center justify-center mb-6 shadow-inner relative group transition-transform duration-500 hover:scale-105">
                            <CheckCircle size={28} className="text-emerald-400" strokeWidth={2} />
                        </div>
                        <h2 className="text-[18px] font-semibold tracking-tight text-text-primary">Pro License Active</h2>
                        <p className="text-[13px] mt-2 max-w-[280px] mx-auto leading-relaxed mb-8 text-text-secondary">
                            Your device is fully authorized for Natively's premium features including the Profile Engine, Job Description Intelligence, and Company Research.
                        </p>

                        <button
                            onClick={handleDeactivate}
                            className="w-full max-w-[280px] py-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 text-[13px] font-medium hover:bg-red-500/20 active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-2 shadow-inner cursor-pointer"
                        >
                            <X size={15} /> Deactivate License
                        </button>
                        <p className="text-[11px] text-center px-4 mt-4 leading-relaxed text-text-tertiary max-w-[300px]">
                            Deactivating will remove the license from this device, allowing you to use it on another computer.
                        </p>
                    </div>
                </Card>
            ) : (
                <>
                    <Card>
                        <div className="px-5 pt-6 pb-5">
                            {/* Header */}
                            <div className="flex flex-col items-center text-center mb-6">
                                <div className="w-12 h-12 rounded-[14px] bg-yellow-500/10 border border-yellow-500/20 shadow-[inset_0_1px_rgba(255,255,255,0.06),0_2px_10px_rgba(0,0,0,0.05)] flex items-center justify-center mb-4 relative">
                                    <NativelyLogoMark size={24} className="text-white drop-shadow-sm" />
                                </div>
                                <h2 className="text-[17px] font-bold tracking-tight text-text-primary">Unlock Natively Pro</h2>
                                <p className="text-[12.5px] mt-1.5 leading-relaxed text-text-secondary max-w-[260px]">Supercharge your workflow with advanced intelligence and candidate insights.</p>
                            </div>

                            {/* Feature list */}
                            <div className="mb-7 bg-bg-input/40 rounded-xl p-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
                                    {[
                                        { title: 'Modes Manager', desc: '7 expert personas (Technical, Sales, etc.)', icon: Layers, status: 'ready' },
                                        { title: 'Resume Intelligence', desc: 'AI grounded in your lived experience', icon: UserCheck, status: 'ready' },
                                        { title: 'Context Intelligence', desc: 'Ground AI in your custom files & docs', icon: Database, status: 'ready' },
                                        { title: 'Negotiation Assistance', desc: 'Live coaching with market-band strategy', icon: TrendingUp, status: 'ready' },
                                        { title: 'JD Intelligence', desc: 'Gap-analysis against any job description', icon: FileText, status: 'ready' },
                                        { title: 'Company Research', desc: 'Real-time intel on culture & positioning', icon: Building2, status: 'ready' },
                                        { title: 'System Design', desc: 'Architecture questions & OCR extraction', icon: Maximize2, status: 'soon' },
                                        { title: 'Mock Interviews', desc: 'Hiring-manager persona with coaching', icon: Target, status: 'soon' }
                                    ].map((f, i) => (
                                        <div key={i} className="flex items-start gap-2.5">
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${f.status === 'ready' || f.status === 'soon' ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-bg-input border-border-subtle opacity-30'}`}>
                                                <f.icon size={14} className={f.status === 'ready' || f.status === 'soon' ? 'text-[#FACC15]' : 'text-text-tertiary'} />
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`text-[12px] font-bold tracking-tight leading-tight ${f.status === 'ready' || f.status === 'soon' ? 'text-text-primary' : 'text-text-tertiary opacity-40'}`}>
                                                        {f.title}
                                                    </span>
                                                    {f.status === 'soon' && (
                                                        <span className="text-[7px] font-black uppercase tracking-widest px-1 py-0.5 rounded bg-bg-input border border-border-subtle text-text-tertiary">Soon</span>
                                                    )}
                                                </div>
                                                <p className={`text-[10px] leading-snug truncate ${f.status === 'ready' || f.status === 'soon' ? 'text-text-secondary' : 'text-text-tertiary opacity-25'}`}>
                                                    {f.desc}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Buy Options */}
                            <div className="grid grid-cols-2 gap-3 w-full">
                                <button
                                    onClick={() => window.electronAPI?.openExternal?.('https://checkout.dodopayments.com/buy/pdt_0NbHo6EnXlNPqNcZ14OTi')}
                                    className="w-full h-11 rounded-xl bg-[#FACC15] text-black text-[13px] font-bold hover:bg-[#FDE047] active:scale-[0.98] transition-all duration-150 flex items-center justify-center shadow-sm border border-transparent cursor-pointer box-border"
                                >
                                    Purchase Lifetime
                                </button>
                                <button
                                    onClick={() => window.electronAPI?.openExternal?.('https://checkout.dodopayments.com/buy/pdt_0NcM4QBwy0CDcPV9CXaNP')}
                                    className="w-full h-11 rounded-xl bg-bg-input border border-border-subtle text-text-primary text-[13px] font-bold hover:bg-bg-input-hover active:scale-[0.98] transition-all duration-150 flex items-center justify-center shadow-sm cursor-pointer box-border"
                                >
                                    Purchase Yearly
                                </button>
                            </div>
                            
                            <div className="text-center mt-4">
                                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-yellow-500/10 border border-yellow-500/20">
                                    <span className="text-[11px] font-medium tracking-wide text-yellow-500/90">
                                        Use code <strong className="font-bold">INSIDER25</strong> for 25% off
                                    </span>
                                </div>
                            </div>

                            {/* Demo link */}
                            <div className="mt-4 flex justify-center pt-3 border-t border-border-subtle">
                                <button 
                                    onClick={() => window.electronAPI?.openExternal?.('https://natively.software/pro')}
                                    className="text-[12px] font-medium flex items-center gap-1.5 transition-all duration-200 text-blue-400 hover:text-blue-300 cursor-pointer"
                                >
                                    <PlayCircle size={14} /> 
                                    <span className="underline underline-offset-4 decoration-current/30 hover:decoration-current/60">Watch it in action</span>
                                </button>
                            </div>
                        </div>
                    </Card>

                    <Card>
                        <div className="px-5 pt-5 pb-5">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-8 h-8 rounded-[10px] bg-bg-input border border-border-subtle shadow-[inset_0_1px_rgba(255,255,255,0.06),0_2px_4px_rgba(0,0,0,0.02)] flex items-center justify-center shrink-0">
                                    <Key size={14} className="text-text-primary" strokeWidth={2} />
                                </div>
                                <div>
                                    <h3 className="text-[13.5px] font-semibold tracking-tight text-text-primary leading-none">Already purchased?</h3>
                                    <p className="text-[11.5px] text-text-tertiary mt-1">Enter your license key to activate this device.</p>
                                </div>
                            </div>
                            
                            <div className="space-y-3 mt-1">
                                <div className="relative">
                                    <Key size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
                                    <input
                                        type="text"
                                        value={licenseKey}
                                        onChange={(e) => setLicenseKey(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
                                        placeholder="Enter your license key"
                                        disabled={status === 'loading' || status === 'success'}
                                        className={`w-full rounded-[10px] pl-9 pr-3 py-2.5 text-[13px] font-mono focus:outline-none transition-all disabled:opacity-50 bg-bg-input border border-border-subtle text-text-primary placeholder-text-tertiary focus:border-text-primary focus:ring-1 focus:ring-text-primary/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.1)]`}
                                    />
                                </div>

                                <button
                                    onClick={handleActivate}
                                    disabled={!licenseKey.trim() || status === 'loading' || status === 'success'}
                                    className={`w-full py-2.5 rounded-[10px] text-[13px] font-semibold transition-all duration-150 flex items-center justify-center gap-2 shadow-sm ${status === 'success'
                                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-none'
                                        : status === 'loading'
                                            ? 'bg-button-primary-disabled-bg border border-button-primary-disabled-border text-button-primary-disabled-text cursor-wait shadow-none'
                                            : !licenseKey.trim()
                                                ? 'bg-button-primary-disabled-bg border border-button-primary-disabled-border text-button-primary-disabled-text cursor-default shadow-none'
                                                : 'bg-text-primary text-bg-primary hover:opacity-90 active:scale-[0.98] cursor-pointer'
                                        }`}
                                >
                                    {status === 'success' ? (
                                        <><CheckCircle size={14} /> Activated!</>
                                    ) : status === 'loading' ? (
                                        <><div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" /> Verifying...</>
                                    ) : (
                                        <><Lock size={14} /> Activate License</>
                                    )}
                                </button>

                                {/* Error message */}
                                {status === 'error' && errorMessage && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] text-red-500 font-medium animated fadeIn">
                                        <AlertCircle size={14} className="shrink-0" /> {errorMessage}
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>
                </>
            )}

            {/* Hardware ID */}
            {hardwareId && (
                <div className="px-2 pt-2">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-text-tertiary">Device ID</span>
                        <button
                            onClick={copyHardwareId}
                            className="text-[11px] font-medium transition-colors flex items-center gap-1 text-text-secondary hover:text-text-primary cursor-pointer"
                        >
                            {copiedHwid ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                            {copiedHwid ? 'Copied' : 'Copy ID'}
                        </button>
                    </div>
                    <p className="text-[11px] font-mono mt-1.5 truncate select-all text-text-tertiary">
                        {hardwareId}
                    </p>
                </div>
            )}
        </div>
    );
};
