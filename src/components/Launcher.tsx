import React, { useState, useEffect } from 'react';
import { ToggleLeft, ToggleRight, Search, Zap, Calendar, ArrowRight, ArrowLeft, MoreHorizontal, Globe, Clock, ChevronRight, Settings, LayoutGrid, RefreshCw, Eye, EyeOff, Ghost, Plus, Mail, Link as LinkIcon, ChevronDown, Trash2, Bell, Check, Download, DownloadCloud, CheckCircle, AlertCircle } from 'lucide-react';
import { generateMeetingPDF } from '../utils/pdfGenerator';
import icon from "./icon.png";
import mainui from "../UI_comp/mainui.png";
import calender from "../UI_comp/calender.png";
import ConnectCalendarButton from './ui/ConnectCalendarButton';
import MeetingDetails from './MeetingDetails';
import TopSearchPill from './TopSearchPill';
import GlobalChatOverlay from './GlobalChatOverlay';
import { motion, AnimatePresence } from 'framer-motion';
import { FeatureSpotlight } from './FeatureSpotlight';
import { analytics } from '../lib/analytics/analytics.service'; // Added analytics import
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { isMac } from '../utils/platformUtils';
import WindowControls from './WindowControls';

interface Meeting {
    id: string;
    title: string;
    date: string;
    duration: string;
    summary: string;
    detailedSummary?: {
        actionItems: string[];
        keyPoints: string[];
    };
    transcript?: Array<{
        speaker: string;
        text: string;
        timestamp: number;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
    active?: boolean; // UI state
    time?: string; // Optional for compatibility
}

interface LauncherProps {
    onStartMeeting: () => void;
    onOpenSettings: (tab?: string) => void;
    onOpenModes?: () => void;
    onPageChange?: (isMain: boolean) => void;
    ollamaPullStatus?: 'idle' | 'downloading' | 'complete' | 'failed';
    ollamaPullPercent?: number;
    ollamaPullMessage?: string;
}

// Helper to format date groups
const getGroupLabel = (dateStr: string) => {
    if (dateStr === "Today") return "Today"; // Backward compatibility

    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    if (checkDate.getTime() === today.getTime()) return "Today";
    if (checkDate.getTime() === yesterday.getTime()) return "Yesterday";

    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

// Helper to format time (e.g. 3:14pm)
const formatTime = (dateStr: string) => {
    if (dateStr === "Today") return "Just now"; // Legacy
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
};

const Launcher: React.FC<LauncherProps> = ({ onStartMeeting, onOpenSettings, onOpenModes, onPageChange, ollamaPullStatus = 'idle', ollamaPullPercent = 0, ollamaPullMessage = '' }) => {
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [isDetectable, setIsDetectable] = useState(false);
    const [isMeetingActive, setIsMeetingActive] = useState(false);
    const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
    const [upcomingEvents, setUpcomingEvents] = useState<any[]>([]);
    const [isPrepared, setIsPrepared] = useState(false);
    const [preparedEvent, setPreparedEvent] = useState<any>(null);
    const [isCalendarConnected, setIsCalendarConnected] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showNotification, setShowNotification] = useState(false);

    // Global search state (for AI chat overlay)
    const [isGlobalChatOpen, setIsGlobalChatOpen] = useState(false);
    const [submittedGlobalQuery, setSubmittedGlobalQuery] = useState('');

    const [showModesOnboarding, setShowModesOnboarding] = useState(false);

    const fetchMeetings = () => {
        if (window.electronAPI && window.electronAPI.getRecentMeetings) {
            window.electronAPI.getRecentMeetings().then(setMeetings).catch(err => console.error("Failed to fetch meetings:", err));
        }
    };

    const fetchEvents = () => {
        if (window.electronAPI && window.electronAPI.getUpcomingEvents) {
            window.electronAPI.getUpcomingEvents().then(setUpcomingEvents).catch(err => console.error("Failed to fetch events:", err));
        }
    }

    const handleRefresh = async () => {
        setIsRefreshing(true);
        analytics.trackCommandExecuted('refresh_calendar');
        try {
            if (window.electronAPI && window.electronAPI.calendarRefresh) {
                setShowNotification(true);
                await window.electronAPI.calendarRefresh();
                fetchEvents();
                fetchMeetings();
                setTimeout(() => {
                    setShowNotification(false);
                }, 3000);
            } else {
                console.warn("electronAPI.calendarRefresh not found");
            }
        } catch (e) {
            console.error("Refresh failed in handleRefresh:", e);
        } finally {
            // Ensure distinct feedback provided (min 500ms spin)
            setTimeout(() => setIsRefreshing(false), 500);
        }
    };

    // Keybinds
    const { isShortcutPressed } = useShortcuts();
    const isLight = useResolvedTheme() === 'light';
    useEffect(() => {
        let mounted = true;
        console.log("Launcher mounted");
        // Seed demo data if needed (safe to call always — runs ONCE on mount)
        if (window.electronAPI && window.electronAPI.seedDemo) {
            window.electronAPI.seedDemo().catch(err => console.error("Failed to seed demo:", err));
        }

        // Onboarding Check
        const hasSeenModesOnboarding = localStorage.getItem('natively_seen_modes_onboarding_v5');
        if (!hasSeenModesOnboarding) {
            setTimeout(() => {
                if (mounted) setShowModesOnboarding(true);
            }, 8000); // Increased delay so it doesn't overlap with other startup notifications
        }

        // Sync initial undetectable state
        if (window.electronAPI?.getUndetectable) {
            window.electronAPI.getUndetectable().then((undetectable) => {
                if (mounted) setIsDetectable(!undetectable);
            });
        }

        // Listen for undetectable changes
        let removeUndetectableListener: (() => void) | undefined;
        if (window.electronAPI?.onUndetectableChanged) {
            removeUndetectableListener = window.electronAPI.onUndetectableChanged((undetectable) => {
                setIsDetectable(!undetectable);
            });
        }

        fetchMeetings();
        fetchEvents();

        // Sync initial meeting active state — guarded so unmounted component isn't written to
        if (window.electronAPI?.getMeetingActive) {
            window.electronAPI.getMeetingActive()
                .then((active) => { if (mounted) setIsMeetingActive(active); })
                .catch(() => {});
        }

        // Listen for meeting state changes (e.g. meeting started/ended from overlay)
        let removeMeetingStateListener: (() => void) | undefined;
        if (window.electronAPI?.onMeetingStateChanged) {
            removeMeetingStateListener = window.electronAPI.onMeetingStateChanged(({ isActive }) => {
                setIsMeetingActive(isActive);
            });
        }

        // Listen for background updates (e.g. after meeting processing finishes)
        const removeMeetingsListener = window.electronAPI.onMeetingsUpdated(() => {
            console.log("Received meetings-updated event");
            fetchMeetings();
        });

        // Simple polling for events every minute
        const interval = setInterval(fetchEvents, 60000);

        return () => {
            mounted = false;
            if (removeMeetingsListener) removeMeetingsListener();
            if (removeUndetectableListener) removeUndetectableListener();
            if (removeMeetingStateListener) removeMeetingStateListener();
            clearInterval(interval);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Mount-only: stable setup that must run exactly once

    // Separate effect for keyboard listener — re-registers when isShortcutPressed changes
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isShortcutPressed(e, 'toggleVisibility')) {
                e.preventDefault();
                window.electronAPI.toggleWindow();
            } else if (isShortcutPressed(e, 'moveWindowUp')) {
                e.preventDefault();
                window.electronAPI.moveWindowUp?.();
            } else if (isShortcutPressed(e, 'moveWindowDown')) {
                e.preventDefault();
                window.electronAPI.moveWindowDown?.();
            } else if (isShortcutPressed(e, 'moveWindowLeft')) {
                e.preventDefault();
                window.electronAPI.moveWindowLeft?.();
            } else if (isShortcutPressed(e, 'moveWindowRight')) {
                e.preventDefault();
                window.electronAPI.moveWindowRight?.();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isShortcutPressed]);

    // Filter next meeting (within 60 mins)
    const nextMeeting = upcomingEvents.find(e => {
        const diff = new Date(e.startTime).getTime() - Date.now();
        return diff > -5 * 60000 && diff < 60 * 60000; // -5 min to +60 min
    });

    const handlePrepare = (event: any) => {
        setPreparedEvent(event);
        setIsPrepared(true);
    };

    const handleStartPreparedMeeting = async () => {
        if (!preparedEvent) return;
        analytics.trackCommandExecuted('start_prepared_meeting');
        try {
            const inputDeviceId = localStorage.getItem('preferredInputDeviceId');
            const outputDeviceId = localStorage.getItem('preferredOutputDeviceId');

            await window.electronAPI.startMeeting({
                title: preparedEvent.title,
                calendarEventId: preparedEvent.id,
                source: 'calendar',
                audio: { inputDeviceId, outputDeviceId }
            });
            setIsPrepared(false);
        } catch (e) {
            console.error("Failed to start prepared meeting", e);
        }
    };

    if (!window.electronAPI) {
        return <div className="text-white p-10">Error: Electron API not initialized. Check preload script.</div>;
    }

    const toggleDetectable = () => {
        const newState = !isDetectable;
        setIsDetectable(newState);
        window.electronAPI?.setUndetectable(!newState); // Note: setUndetectable takes the *undetectable* state, which is inverse of *detectable*
        analytics.trackModeSelected(newState ? 'launcher' : 'undetectable'); // If visible (detectable), mode is normal/launcher. If not detectable, mode is undetectable.
    };

    // Group meetings
    const groupedMeetings = meetings.reduce((acc, meeting) => {
        const label = getGroupLabel(meeting.date);
        if (!acc[label]) acc[label] = [];
        acc[label].push(meeting);
        return acc;
    }, {} as Record<string, Meeting[]>);

    // Group order (Today, Yesterday, then others sorted new to old is implicit via API return order ideally, 
    // but JS object key order isn't guaranteed. We can use a Map or just known keys.)
    // Simple sort for keys:
    const sortedGroups = Object.keys(groupedMeetings).sort((a, b) => {
        if (a === 'Today') return -1;
        if (b === 'Today') return 1;
        if (a === 'Yesterday') return -1;
        if (b === 'Yesterday') return 1;
        // Approximation for others: parse date
        return new Date(b).getTime() - new Date(a).getTime();
    });


    const [forwardMeeting, setForwardMeeting] = useState<Meeting | null>(null);
    const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
    const [menuEntered, setMenuEntered] = useState(false);

    useEffect(() => {
        setMenuEntered(false);
    }, [activeMenuId]);

    // Global click listener to close menu
    useEffect(() => {
        const handleClickOutside = () => setActiveMenuId(null);
        window.addEventListener('click', handleClickOutside);
        return () => window.removeEventListener('click', handleClickOutside);
    }, []);

    // Notify parent if we are on the main launcher list view
    useEffect(() => {
        if (onPageChange) {
            onPageChange(!selectedMeeting && !isGlobalChatOpen);
        }
    }, [selectedMeeting, isGlobalChatOpen, onPageChange]);

    const handleOpenMeeting = async (meeting: Meeting) => {
        setForwardMeeting(null); // Clear forward history on new navigation
        console.log("[Launcher] Opening meeting:", meeting.id);
        analytics.trackCommandExecuted('open_meeting_details');

        // Fetch full meeting details including transcript and usage
        if (window.electronAPI && window.electronAPI.getMeetingDetails) {
            try {
                console.log("[Launcher] Fetching full meeting details...");
                const fullMeeting = await window.electronAPI.getMeetingDetails(meeting.id);
                console.log("[Launcher] Got meeting details:", fullMeeting);
                console.log("[Launcher] Transcript count:", fullMeeting?.transcript?.length);
                console.log("[Launcher] Usage count:", fullMeeting?.usage?.length);
                if (fullMeeting) {
                    setSelectedMeeting(fullMeeting);
                    return;
                }
            } catch (err) {
                console.error("[Launcher] Failed to fetch meeting details:", err);
            }
        } else {
            console.warn("[Launcher] getMeetingDetails not available on electronAPI");
        }
        // Fallback to list-view data if fetch fails
        setSelectedMeeting(meeting);
    };

    const handleBack = () => {
        setForwardMeeting(selectedMeeting);
        setSelectedMeeting(null);
    };

    const handleForward = () => {
        if (forwardMeeting) {
            setSelectedMeeting(forwardMeeting);
            setForwardMeeting(null);
        }
    };

    // Helper to format duration to mm:ss or mmm:ss
    // Helper to format duration to mm:ss or mmm:ss
    const formatDurationPill = (durationStr: string) => {
        if (!durationStr) return "00:00";

        // Check if it's already in colon format (e.g. "5:30", "105:20")
        if (durationStr.includes(':')) {
            const parts = durationStr.split(':');
            const mins = parts[0];
            const secs = parts[1] || "00";

            // Allow 3 digits for mins if >= 100, otherwise pad to 2
            const formattedMins = mins.length >= 3 ? mins : mins.padStart(2, '0');
            return `${formattedMins}:${secs}`;
        }

        // Fallback for "X min" format (legacy)
        const minutes = parseInt(durationStr.replace('min', '').trim()) || 0;
        const mm = minutes.toString().padStart(2, '0');
        return `${mm}:00`;
    };

    return (
        <div data-testid="launcher-container" className="h-full w-full flex flex-col bg-bg-primary text-text-primary font-sans overflow-hidden selection:bg-accent-secondary/30">
            {/* 1. Header (Static) */}
            <header className="relative w-full h-[40px] shrink-0 flex items-center justify-between pl-0 drag-region select-none bg-bg-secondary border-b border-border-subtle z-[200]">
                {/* Left: Spacing for Traffic Lights + Navigation Arrows */}
                <div className="flex items-center gap-1 no-drag">
                    {isMac && <div className="w-[70px]" />} {/* Traffic Light Spacer (macOS only) */}

                    {/* Back Button */}
                    <button
                        onClick={selectedMeeting ? handleBack : undefined}
                        disabled={!selectedMeeting}
                        className={`
                            transition-all duration-300 p-1 flex items-center justify-center mt-1 ml-2
                            ${selectedMeeting
                                ? `text-text-secondary hover:text-text-primary ${isLight ? 'hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.25)]' : 'hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'}`
                                : 'text-text-tertiary opacity-50 cursor-default'}
                        `}
                    >
                        <ArrowLeft size={16} />
                    </button>

                    {/* Forward Button */}
                    <button
                        onClick={handleForward}
                        disabled={!forwardMeeting}
                        className={`
                            transition-all duration-300 p-1 flex items-center justify-center mt-1
                            ${forwardMeeting
                                ? `text-text-secondary hover:text-text-primary ${isLight ? 'hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.25)]' : 'hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'}`
                                : 'text-text-tertiary opacity-0 cursor-default'}
                        `}
                    >
                        <ArrowRight size={16} />
                    </button>
                </div>


                {/* Center: Spotlight-style Search Pill */}
                <TopSearchPill
                    meetings={meetings}
                    onAIQuery={(query) => {
                        analytics.trackCommandExecuted('ai_query_search');
                        setSubmittedGlobalQuery(query);
                        setIsGlobalChatOpen(true);
                    }}
                    onLiteralSearch={(query) => {
                        // For now, also use AI query for literal search
                        // Could be enhanced to do fuzzy filtering in the UI
                        analytics.trackCommandExecuted('literal_search');
                        setSubmittedGlobalQuery(query);
                        setIsGlobalChatOpen(true);
                    }}
                    onOpenMeeting={(meetingId) => {
                        const meeting = meetings.find(m => m.id === meetingId);
                        if (meeting) {
                            handleOpenMeeting(meeting);
                            analytics.trackCommandExecuted('open_meeting_from_search');
                        }
                    }}
                />

                {/* Right: Actions */}
                <div className={`flex items-center gap-1 no-drag shrink-0 ${isMac ? 'mr-1' : ''}`}>
                    <div className="relative group/modes-btn select-none">
                        <button
                            onClick={() => {
                                setShowModesOnboarding(false);
                                localStorage.setItem('natively_seen_modes_onboarding_v5', 'true');
                                onOpenModes?.();
                            }}
                            title="Modes"
                            className={`p-2 text-text-secondary hover:text-text-primary transition-all duration-300 ${isLight ? 'hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.25)]' : 'hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'}`}
                        >
                            <svg width={18} height={18} viewBox="0 0 14 14" fill="none">
                                <rect x="1" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                <rect x="7.5" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                <rect x="1" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.35"/>
                            </svg>
                        </button>
                        
                        <AnimatePresence>
                            {showModesOnboarding && (
                                <motion.div
                                    initial={{ opacity: 0, y: 6, scale: 0.96, filter: "blur(4px)" }}
                                    animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                                    exit={{ opacity: 0, y: -2, scale: 0.98, filter: "blur(2px)", transition: { duration: 0.15, ease: "easeOut" } }}
                                    transition={{ type: "spring", stiffness: 350, damping: 25, mass: 1 }}
                                    className={`absolute top-[38px] right-2 w-[270px] rounded-[20px] p-4 z-[300] origin-top-right backdrop-blur-[40px] saturate-[180%] transform-gpu ${
                                        isLight 
                                        ? 'bg-white/70 shadow-[0_8px_30px_rgb(0,0,0,0.12),0_0_0_1px_rgba(0,0,0,0.04)]' 
                                        : 'bg-[#18181A]/70 shadow-[0_8px_30px_rgb(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.08)]'
                                    }`}
                                >
                                    {/* Triangle Pointer */}
                                    <div className={`absolute -top-[5px] right-[14px] w-2.5 h-2.5 rotate-45 rounded-tl-[3px] ${
                                        isLight 
                                        ? 'bg-white/70 border-t border-l border-black/5 backdrop-blur-[40px]' 
                                        : 'bg-[#18181A]/70 border-t border-l border-white/5 backdrop-blur-[40px]'
                                    }`} />
                                    
                                    <div className="relative flex gap-3">
                                        <div className={`w-9 h-9 flex items-center justify-center shrink-0 rounded-full ${
                                            isLight
                                            ? 'bg-orange-500 bg-opacity-10 text-orange-500'
                                            : 'bg-orange-500 bg-opacity-15 text-orange-400'
                                        }`}>
                                            <svg width="18" height="18" viewBox="0 0 14 14" fill="none">
                                                <rect x="1" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                                <rect x="7.5" y="1" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                                <rect x="1" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.9"/>
                                                <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity="0.4"/>
                                            </svg>
                                        </div>
                                        <div className="flex-1 pt-[2px]">
                                            <h3 className="text-[14px] font-semibold tracking-[-0.015em] mb-1 flex items-center gap-2">
                                                <span className={isLight ? 'text-slate-900' : 'text-slate-100'}>Modes</span>
                                                <span className={`text-[10px] font-medium px-1.5 py-[1px] rounded-[5px] ${
                                                    isLight
                                                    ? 'bg-orange-50 text-orange-600 border border-orange-100/50'
                                                    : 'bg-orange-500/10 text-orange-400'
                                                }`}>
                                                    Beta
                                                </span>
                                            </h3>
                                            <p className={`text-[12px] leading-[1.35] mb-3.5 tracking-[-0.01em] ${
                                                isLight ? 'text-slate-500' : 'text-slate-400'
                                            }`}>
                                                Custom instructions and formulas designed for different meeting contexts.
                                            </p>
                                            <div className="flex justify-end gap-1.5 isolate">
                                                <button 
                                                    onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        setShowModesOnboarding(false); 
                                                        localStorage.setItem('natively_seen_modes_onboarding_v5', 'true'); 
                                                    }}
                                                    className={`text-[12px] font-medium px-3.5 py-[6px] rounded-full transition-all active:scale-95 ${
                                                        isLight
                                                        ? 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/60'
                                                        : 'text-slate-400 hover:text-slate-100 hover:bg-white/10'
                                                    }`}
                                                >
                                                    Dismiss
                                                </button>
                                                <button 
                                                    onClick={(e) => { 
                                                        e.stopPropagation(); 
                                                        onOpenModes?.(); 
                                                        setShowModesOnboarding(false); 
                                                        localStorage.setItem('natively_seen_modes_onboarding_v5', 'true'); 
                                                    }}
                                                    className={`text-[12px] font-medium px-4 py-[6px] rounded-full transition-all active:scale-95 shadow-sm ${
                                                        isLight
                                                        ? 'bg-slate-900 text-white hover:bg-slate-800'
                                                        : 'bg-slate-100 text-slate-900 hover:bg-white'
                                                    }`}
                                                >
                                                    Try it out
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                    <button
                        data-testid="settings-button"
                        onClick={() => {
                            onOpenSettings();
                        }}
                        title="Settings"
                        className={`p-2 text-text-secondary hover:text-text-primary transition-all duration-300 ${isLight ? 'hover:drop-shadow-[0_0_6px_rgba(0,0,0,0.25)]' : 'hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]'}`}
                    >
                        <Settings size={18} />
                    </button>
                    {!isMac && <WindowControls />}
                </div>
            </header>

            <div className="relative flex-1 flex flex-col overflow-hidden">
                {!isDetectable && (
                    <div className={`absolute inset-1 border-2 border-dashed rounded-2xl pointer-events-none z-[100] ${isLight ? 'border-black/15' : 'border-white/20'}`} />
                )}
                <AnimatePresence mode="wait">
                    {selectedMeeting ? (
                        <motion.div
                            key="details"
                            className="flex-1 overflow-hidden"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >
                            <MeetingDetails
                                meeting={selectedMeeting}
                                onBack={handleBack}
                                onOpenSettings={onOpenSettings}
                            />
                        </motion.div>
                    ) : (
                        <motion.div
                            key="launcher"
                            className="flex-1 flex flex-col overflow-hidden"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                        >

                            {/* Main Area - Fixed Top, Scrollable Bottom */}
                            {/* Top Section is now effectively static due to parent flex col */}

                            {/* TOP SECTION: Grey Background (Scrolls with content) */}
                            <section className={`${isLight ? 'bg-bg-primary' : 'bg-bg-elevated'} px-8 pt-6 pb-8 border-b border-border-subtle shrink-0`}>
                                <div className="max-w-4xl mx-auto space-y-6">
                                    {/* 1.5. Hero Header (Title + Controls + CTA) */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-4">
                                            <h1 className="text-3xl font-celeb-light font-medium text-text-primary tracking-wide drop-shadow-sm">My Natively</h1>

                                            {/* Refresh Button */}
                                            <button
                                                onClick={handleRefresh}
                                                disabled={isRefreshing}
                                                className={`p-2 text-text-secondary hover:text-text-primary rounded-full transition-colors ${isRefreshing ? 'animate-spin text-blue-400' : ''} ${isLight ? 'hover:bg-black/8' : 'hover:bg-white/10'}`}
                                                title="Refresh State"
                                            >
                                                <RefreshCw size={18} />
                                            </button>

                                            {/* Detectable Toggle Pill */}
                                            <div className={`flex items-center gap-3 border rounded-full px-3 py-1.5 min-w-[140px] transition-colors ${isLight ? 'bg-bg-elevated border-border-muted shadow-sm' : 'bg-[#101011] border-border-muted'}`}>
                                                {isDetectable ? (
                                                    <Ghost
                                                        size={14}
                                                        strokeWidth={2}
                                                        className="text-text-secondary transition-colors"
                                                    />
                                                ) : (
                                                    <svg
                                                        width="14"
                                                        height="14"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        className="transition-colors"
                                                    >
                                                        <path
                                                            d="M12 2C7.58172 2 4 5.58172 4 10V22L7 19L9.5 21.5L12 19L14.5 21.5L17 19L20 22V10C20 5.58172 16.4183 2 12 2Z"
                                                            fill={isLight ? '#48484A' : 'white'}
                                                        />
                                                        <circle cx="9" cy="10" r="1.5" fill={isLight ? 'white' : 'black'} />
                                                        <circle cx="15" cy="10" r="1.5" fill={isLight ? 'white' : 'black'} />
                                                    </svg>
                                                )}
                                                <span className="text-xs font-medium flex-1 transition-colors text-text-secondary">
                                                    {isDetectable ? "Detectable" : "Undetectable"}
                                                </span>
                                                <div
                                                    className={`w-8 h-4 rounded-full relative transition-colors cursor-pointer ${!isDetectable ? 'bg-accent-primary' : 'bg-bg-toggle-switch'}`}
                                                    onClick={toggleDetectable}
                                                >
                                                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-all ${!isDetectable ? 'left-[18px]' : 'left-0.5'}`} />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Center: Ollama Pull Status Pill (flex-1 to center evenly) */}
                                        <div className="flex-1 flex justify-center mx-4">
                                            <AnimatePresence>
                                                {ollamaPullStatus !== 'idle' && (
                                                    <motion.div
                                                        initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                                        exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                                        transition={{ type: "spring", stiffness: 400, damping: 25 }}
                                                        className={`flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-xl ${isLight ? 'bg-bg-elevated border border-border-muted shadow-[0_4px_16px_rgba(0,0,0,0.1)]' : 'bg-bg-elevated/80 border border-white/10 shadow-[0_4px_16px_rgba(0,0,0,0.3)]'}`}
                                                    >
                                                        {ollamaPullStatus === 'downloading' ? (
                                                            <DownloadCloud size={14} className="text-blue-400 animate-pulse shrink-0" />
                                                        ) : ollamaPullStatus === 'complete' ? (
                                                            <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                                                        ) : (
                                                            <AlertCircle size={14} className="text-red-400 shrink-0" />
                                                        )}
                                                        <div className="flex flex-col">
                                                            <span className="text-[11px] font-medium text-text-secondary whitespace-nowrap">
                                                                {ollamaPullStatus === 'downloading' ? `Setting up AI memory... ${ollamaPullPercent}%` : ollamaPullMessage}
                                                            </span>
                                                            {ollamaPullStatus === 'downloading' && (
                                                                <div className="w-full h-[3px] bg-white/10 rounded-full mt-1 overflow-hidden">
                                                                    <div
                                                                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                                                                        style={{ width: `${ollamaPullPercent}%` }}
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>

                                        {/* Unified CTA pill — same jelly shape, morphs between idle and active-meeting state */}
                                        <motion.button
                                            onClick={() => {
                                                if (isMeetingActive) {
                                                    // inactive=true: overlay appears on top but doesn't activate
                                                    // the Natively app or steal OS focus — preserves stealth.
                                                    // setWindowMode (not showWindow) is required because
                                                    // logo-click set currentWindowMode='launcher', so showWindow()
                                                    // would re-show the launcher rather than switch to overlay.
                                                    window.electronAPI?.setWindowMode?.('overlay', true);
                                                    analytics.trackCommandExecuted('resume_meeting_from_launcher');
                                                } else {
                                                    onStartMeeting();
                                                    analytics.trackCommandExecuted('start_natively_cta');
                                                }
                                            }}
                                            whileHover={{ scale: 1.01, filter: 'brightness(1.1)' }}
                                            whileTap={{ scale: 0.99 }}
                                            transition={{ duration: 0.18, ease: 'easeOut' }}
                                            className="group relative overflow-hidden text-white px-6 py-3 rounded-full font-celeb font-medium tracking-normal flex items-center justify-center gap-3 backdrop-blur-xl shrink-0"
                                            style={{
                                                boxShadow: isMeetingActive
                                                    ? 'inset 0 1px 1px rgba(255,255,255,0.7), inset 0 -1px 2px rgba(0,0,0,0.1), 0 2px 10px rgba(16,185,129,0.45), 0 0 0 1px rgba(255,255,255,0.15)'
                                                    : 'inset 0 1px 1px rgba(255,255,255,0.7), inset 0 -1px 2px rgba(0,0,0,0.1), 0 2px 10px rgba(14,165,233,0.4), 0 0 0 1px rgba(255,255,255,0.15)',
                                                transition: 'box-shadow 0.5s ease-out',
                                            }}
                                        >
                                            {/* Blue gradient layer (idle) */}
                                            <div
                                                className="absolute inset-0 bg-gradient-to-b from-sky-400 via-sky-500 to-blue-600 transition-opacity duration-500 ease-out"
                                                style={{ opacity: isMeetingActive ? 0 : 1 }}
                                            />
                                            {/* Green gradient layer (meeting active) */}
                                            <div
                                                className="absolute inset-0 bg-gradient-to-b from-emerald-400 via-emerald-500 to-green-600 transition-opacity duration-500 ease-out"
                                                style={{ opacity: isMeetingActive ? 1 : 0 }}
                                            />

                                            {/* Top highlight band — shared between both states */}
                                            <div className="absolute inset-x-3 top-0 h-[40%] bg-gradient-to-b from-white/40 to-transparent blur-[2px] rounded-b-lg opacity-80 pointer-events-none z-10" />
                                            {/* Internal suspended-light hover glow */}
                                            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none z-10" />

                                            {/* Button content — crossfade between idle and meeting states */}
                                            <div className="relative z-20 flex items-center gap-3">
                                                <AnimatePresence mode="wait" initial={false}>
                                                    {isMeetingActive ? (
                                                        <motion.div
                                                            key="meeting"
                                                            initial={{ opacity: 0, y: 6 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: -6 }}
                                                            transition={{ duration: 0.22, ease: 'easeOut' }}
                                                            className="flex items-center gap-3"
                                                        >
                                                            {/* Ping live-indicator dot */}
                                                            <span className="relative flex h-[9px] w-[9px] shrink-0">
                                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
                                                                <span className="relative inline-flex rounded-full h-[9px] w-[9px] bg-white" />
                                                            </span>
                                                            <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.1)] text-[20px] leading-none">Meeting ongoing</span>
                                                        </motion.div>
                                                    ) : (
                                                        <motion.div
                                                            key="start"
                                                            initial={{ opacity: 0, y: 6 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: -6 }}
                                                            transition={{ duration: 0.22, ease: 'easeOut' }}
                                                            className="flex items-center gap-3"
                                                        >
                                                            <img src={icon} alt="Logo" className="w-[18px] h-[18px] object-contain brightness-0 invert drop-shadow-[0_1px_2px_rgba(0,0,0,0.1)] opacity-90" />
                                                            <span className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.1)] text-[20px] leading-none">Start Natively</span>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        </motion.button>
                                    </div>

                                    {/* 2. Hero Section Cards */}
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 h-[198px]">
                                        {/* PREPARED STATE CARD */}
                                        {isPrepared && preparedEvent ? (
                                            <div className={`md:col-span-3 relative group rounded-xl overflow-hidden border border-emerald-500/30 ${isLight ? 'bg-bg-elevated' : 'bg-bg-secondary'} flex flex-col items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/40 ${isLight ? 'via-bg-elevated to-bg-elevated' : 'via-bg-secondary to-bg-secondary'}`}>

                                                <div className="absolute top-4 right-4 text-emerald-400">
                                                    <Zap size={16} className="text-yellow-400" />
                                                </div>

                                                <div className="text-center max-w-lg z-10">
                                                    <span className="inline-block px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-[10px] font-bold tracking-wider mb-4 border border-emerald-500/20">
                                                        READY TO JOIN
                                                    </span>
                                                    <h2 className="text-2xl font-bold text-text-primary mb-2">{preparedEvent.title}</h2>
                                                    <p className="text-xs text-text-secondary mb-6 flex items-center justify-center gap-2">
                                                        <Calendar size={12} />
                                                        {new Date(preparedEvent.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {new Date(preparedEvent.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                                        {preparedEvent.link && " • Link Ready"}
                                                    </p>

                                                    <div className="flex items-center gap-3 justify-center">
                                                        <button
                                                            onClick={handleStartPreparedMeeting}
                                                            className="bg-emerald-500 hover:bg-emerald-400 text-white px-8 py-3 rounded-xl text-sm font-semibold transition-all shadow-lg hover:shadow-emerald-500/25 active:scale-95 flex items-center gap-2"
                                                        >
                                                            Start Meeting
                                                            <ArrowRight size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() => setIsPrepared(false)}
                                                            className="px-4 py-3 rounded-xl text-xs font-medium text-text-tertiary hover:text-white transition-colors"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                </div>

                                                {/* Glows */}
                                                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[300px] h-[300px] bg-emerald-500/10 blur-[100px] pointer-events-none" />
                                            </div>
                                        ) : (
                                            /* Dynamic Next Meeting OR Default Intro */
                                            nextMeeting ? (
                                                <div className={`md:col-span-2 relative group rounded-xl overflow-hidden ${isLight ? 'bg-bg-elevated' : 'bg-bg-secondary'} flex flex-col shadow-[0_1px_3px_rgba(0,0,0,0.07),0_1px_2px_rgba(0,0,0,0.04)]`}>
                                                    {/* Header */}
                                                    <div className="p-5 flex-1 relative z-10">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                            <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Up Next</span>
                                                            <span className="text-[11px] text-text-tertiary">• Starts in {Math.max(0, Math.ceil((new Date(nextMeeting.startTime).getTime() - Date.now()) / 60000))} min</span>
                                                        </div>

                                                        <h2 className="text-xl font-bold text-text-primary leading-tight mb-1 line-clamp-2">
                                                            {nextMeeting.title}
                                                        </h2>

                                                        <div className="flex items-center gap-2 text-text-secondary text-xs mt-2">
                                                            <Calendar size={12} />
                                                            <span>{new Date(nextMeeting.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - {new Date(nextMeeting.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                                                            {nextMeeting.link && (
                                                                <>
                                                                    <span className="opacity-20">|</span>
                                                                    <LinkIcon size={12} />
                                                                    <span className="truncate max-w-[150px]">Meeting Link Found</span>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Actions */}
                                                    <div className="p-4 bg-bg-elevated/50 border-t border-border-subtle flex items-center gap-3">
                                                        <button
                                                            onClick={() => handlePrepare(nextMeeting)}
                                                            className={`flex-1 border px-4 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-2 ${isLight ? 'bg-bg-item-surface hover:bg-bg-item-active border-border-muted text-text-primary' : 'bg-white/10 hover:bg-white/20 border-white/10 text-white'}`}
                                                        >
                                                            <Zap size={13} className="text-yellow-400" />
                                                            Prepare
                                                        </button>
                                                        <button
                                                            onClick={onStartMeeting}
                                                            className={`px-4 py-2 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary transition-all ${isLight ? 'hover:bg-bg-item-surface' : 'hover:bg-white/5'}`}
                                                        >
                                                            Start now
                                                        </button>
                                                    </div>

                                                    {/* Background Decoration */}
                                                    <div className="absolute top-0 right-0 w-[150px] h-[150px] bg-emerald-500/10 blur-[60px] pointer-events-none" />
                                                </div>
                                            ) : (
                                                <div className="md:col-span-2 h-full">
                                                    <FeatureSpotlight />
                                                </div>
                                            )
                                        )}



                                        {/* Right Secondary Card */}
                                        <div className="md:col-span-1 rounded-xl overflow-hidden bg-bg-elevated relative group flex flex-col items-center pt-6 text-center">
                                            {/* Backdrop Image */}
                                            <div className="absolute inset-0">
                                                <img src={calender} alt="" className="w-full h-full object-cover opacity-100 transition-opacity duration-500 translate-x--1 translate-y-[1px] scale-105" />
                                            </div>

                                            {/* Content Layer */}
                                            <div className="relative z-10 w-full flex flex-col items-center h-full">
                                                <h3 className="text-[19px] leading-tight mb-4">
                                                    {isCalendarConnected ? (
                                                        <>
                                                            <span className="block font-semibold text-white">Calendar linked</span>
                                                            <span className="block font-medium text-white/60 text-[0.95em]">Events synced</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="block font-semibold text-white">Link your calendar to</span>
                                                            <span className="block font-medium text-white/60 text-[0.95em]">see upcoming events</span>
                                                        </>
                                                    )}
                                                </h3>

                                                <ConnectCalendarButton
                                                    className="-translate-x-0.5"
                                                    onConnect={() => setIsCalendarConnected(true)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </section>

                            {/* BOTTOM SECTION: Black Background (Scrollable content) */}
                            <main className="flex-1 overflow-y-auto custom-scrollbar bg-bg-primary">
                                <section className="px-8 py-8 min-h-full">
                                    <div className="max-w-4xl mx-auto space-y-8">

                                        {/* Iterating Date Groups */}
                                        {sortedGroups.map((label) => (
                                            <section key={label}>
                                                <h3 className="text-[13px] font-medium text-text-secondary mb-3 pl-1">{label}</h3>
                                                <div className="space-y-1">
                                                    {groupedMeetings[label].map((m) => (
                                                        <motion.div
                                                            key={m.id}
                                                            layoutId={`meeting-${m.id}`}
                                                            className="group relative flex items-center justify-between px-3 py-2 rounded-lg bg-transparent hover:bg-bg-elevated transition-colors"
                                                            onClick={() => handleOpenMeeting(m)}
                                                        >
                                                            <div className={`font-medium text-[14px] max-w-[60%] truncate ${m.title === 'Processing...' ? 'text-blue-400 italic animate-pulse' : 'text-text-primary'}`}>
                                                                {m.title}
                                                            </div>

                                                            {/* Time & Duration Section */}
                                                            <div className="flex items-center gap-4">
                                                                {m.title === 'Processing...' ? (
                                                                    <div className="flex items-center gap-2 transition-all duration-200 ease-out group-hover:opacity-0 group-hover:translate-x-2 delayed-hover-exit">
                                                                        <RefreshCw size={12} className="animate-spin text-blue-500" />
                                                                        <span className="text-xs text-blue-500 font-medium">Finalizing...</span>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        <span className="relative z-10 bg-bg-elevated text-text-secondary text-[9px] px-1.5 py-0.5 rounded-full font-medium min-w-[35px] text-center tracking-wide">
                                                                            {formatDurationPill(m.duration)}
                                                                        </span>

                                                                        {/* Time Text (Should fade out on hover) */}
                                                                        <span className="text-[13px] text-text-secondary font-medium min-w-[60px] text-right transition-all duration-200 ease-out group-hover:opacity-0 group-hover:translate-x-2 delayed-hover-exit">
                                                                            {formatTime(m.date)}
                                                                        </span>
                                                                    </>
                                                                )}
                                                            </div>

                                                            {/* Context Menu Trigger (Slides in on hover) */}
                                                            <div className="absolute right-3 top-1/2 -translate-y-1/2 opacity-0 translate-x-4 transition-all duration-300 ease-out group-hover:opacity-100 group-hover:translate-x-0">
                                                                <button
                                                                    className="p-1.5 text-text-secondary hover:text-text-primary transition-colors"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setActiveMenuId(activeMenuId === m.id ? null : m.id);
                                                                    }}
                                                                >
                                                                    <MoreHorizontal size={16} />
                                                                </button>
                                                            </div>

                                                            {/* Dropdown Menu */}
                                                            <AnimatePresence>
                                                                {activeMenuId === m.id && (
                                                                    <motion.div
                                                                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                                                        exit={{ opacity: 0, scale: 0.95, y: 5 }}
                                                                        transition={{ duration: 0.1 }}
                                                                        className={`absolute right-0 top-full mt-1 w-[90px] backdrop-blur-xl rounded-lg shadow-2xl z-50 overflow-hidden border ${isLight ? 'bg-bg-elevated border-border-muted shadow-[0_8px_24px_rgba(0,0,0,0.12)]' : 'bg-[#1E1E1E]/80 border-white/10'}`}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        onMouseEnter={() => setMenuEntered(true)}
                                                                        onMouseLeave={() => {
                                                                            if (menuEntered) setActiveMenuId(null);
                                                                        }}
                                                                    >
                                                                        <div className="p-1 flex flex-col gap-0.5">
                                                                            <button
                                                                                className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-text-primary rounded-lg transition-colors text-left ${isLight ? 'hover:bg-bg-item-surface' : 'hover:bg-white/10'}`}
                                                                                onClick={async () => {
                                                                                    setActiveMenuId(null);
                                                                                    analytics.trackPdfExported();
                                                                                    // Fetch full details if needed
                                                                                    if (window.electronAPI && window.electronAPI.getMeetingDetails) {
                                                                                        try {
                                                                                            const fullMeeting = await window.electronAPI.getMeetingDetails(m.id);
                                                                                            if (fullMeeting) {
                                                                                                generateMeetingPDF(fullMeeting);
                                                                                            } else {
                                                                                                generateMeetingPDF(m);
                                                                                            }
                                                                                        } catch (e) {
                                                                                            console.error("Failed to fetch details for PDF", e);
                                                                                            generateMeetingPDF(m);
                                                                                        }
                                                                                    } else {
                                                                                        generateMeetingPDF(m);
                                                                                    }
                                                                                }}
                                                                            >
                                                                                <Download size={13} />
                                                                                Export
                                                                            </button>
                                                                            <button
                                                                                className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-400 hover:bg-red-500/10 hover:text-red-300 rounded-lg transition-colors text-left"
                                                                                onClick={async () => {
                                                                                    if (window.electronAPI && window.electronAPI.deleteMeeting) {
                                                                                        const success = await window.electronAPI.deleteMeeting(m.id);
                                                                                        if (success) {
                                                                                            // Optimistic update or refetch
                                                                                            setMeetings(prev => prev.filter(meeting => meeting.id !== m.id));
                                                                                        }
                                                                                    }
                                                                                    setActiveMenuId(null);
                                                                                }}
                                                                            >
                                                                                <Trash2 size={13} />
                                                                                Delete
                                                                            </button>
                                                                        </div>
                                                                    </motion.div>
                                                                )}
                                                            </AnimatePresence>
                                                        </motion.div>
                                                    ))}
                                                </div>
                                            </section>
                                        ))}

                                        {meetings.length === 0 && (
                                            <div className="p-4 text-text-tertiary text-sm">No recent meetings.</div>
                                        )}

                                    </div>
                                </section>
                            </main>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>



            {/* Notification Toast - Liquid Glass (macOS 26 Tahoe Concept) */}
            <AnimatePresence>
                {showNotification && (
                    <motion.div
                        initial={{ x: 300, opacity: 0, scale: 0.9 }}
                        animate={{ x: 0, opacity: 1, scale: 1 }}
                        exit={{ x: 300, opacity: 0, scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 350, damping: 30, mass: 1 }}
                        className={`fixed bottom-10 right-10 z-[2000] flex items-center gap-4 pl-4 pr-6 py-3.5 rounded-[18px] backdrop-blur-xl saturate-[180%] ring-1 ring-black/10 ${isLight ? 'bg-bg-elevated/90 border border-border-muted shadow-[0_8px_32px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.9)]' : 'bg-[#2A2A2E]/40 border border-white/10 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.3),inset_0_-1px_0_rgba(255,255,255,0.05)]'}`}
                    >
                        {/* Liquid Icon Orb */}
                        <div className="relative flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-b from-blue-400/20 to-blue-600/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] border border-white/5">
                            <div className="absolute inset-0 rounded-full bg-blue-500/20 blur-md" />
                            <RefreshCw size={15} className="text-blue-300 animate-[spin_2s_linear_infinite] drop-shadow-[0_0_5px_rgba(59,130,246,0.6)]" />
                        </div>

                        {/* Text Content */}
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[14px] font-semibold text-text-primary leading-none tracking-tight">Refreshed</span>
                            <span className="text-[11px] text-text-tertiary font-medium leading-none tracking-wide">Synced with calendar</span>
                        </div>

                        {/* Specular Highlight Overlay */}
                        <div className="absolute inset-0 rounded-[18px] bg-gradient-to-tr from-white/5 via-transparent to-transparent pointer-events-none" />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Global Chat Overlay */}
            <GlobalChatOverlay
                isOpen={isGlobalChatOpen}
                onClose={() => {
                    setIsGlobalChatOpen(false);
                    setSubmittedGlobalQuery('');
                }}
                initialQuery={submittedGlobalQuery}
            />
        </div >
    );
};

export default Launcher;
