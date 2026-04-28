import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import {
    Sparkles,
    Pencil,
    MessageSquare,
    RefreshCw,
    Settings,
    ArrowUp,
    ArrowRight,
    HelpCircle,
    ChevronUp,
    ChevronDown,
    Lightbulb,
    CornerDownLeft,
    Mic,
    MicOff,
    Image,
    Camera,
    X,
    LogOut,
    Zap,
    Edit3,
    SlidersHorizontal,
    LayoutGrid,
    Ghost,
    Link,
    Code,
    Copy,
    Check,
    PointerOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
// import { ModelSelector } from './ui/ModelSelector'; // REMOVED
import TopPill from './ui/TopPill';
import RollingTranscript from './ui/RollingTranscript';
import LiveConversationPanel, { ConversationTurn } from './ui/LiveConversationPanel';
import { NegotiationCoachingCard } from '../premium';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { analytics, detectProviderType } from '../lib/analytics/analytics.service';
import { useShortcuts } from '../hooks/useShortcuts';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { getOverlayAppearance, OVERLAY_OPACITY_DEFAULT } from '../lib/overlayAppearance';
import { pickFiller, type FillerIntent } from '../lib/buyTimeFillers';

interface Message {
    id: string;
    role: 'user' | 'system' | 'interviewer';
    text: string;
    isStreaming?: boolean;
    /**
     * True while this bubble holds a buy-time stall line — a natural-sounding
     * placeholder shown the instant the user clicks an action, so they can
     * read it aloud while the real LLM call composes. Cleared (and the text
     * fully replaced) when the first real token arrives.
     */
    isFiller?: boolean;
    hasScreenshot?: boolean;
    screenshotPreview?: string;
    isCode?: boolean;
    intent?: string;
    isNegotiationCoaching?: boolean;
    negotiationCoachingData?: {
        tacticalNote: string;
        exactScript: string;
        showSilenceTimer: boolean;
        phase: string;
        theirOffer: number | null;
        yourTarget: number | null;
        currency: string;
    };
}

interface NativelyInterfaceProps {
    onEndMeeting?: () => void;
    overlayOpacity?: number;
}

const NativelyInterface: React.FC<NativelyInterfaceProps> = ({ onEndMeeting, overlayOpacity = OVERLAY_OPACITY_DEFAULT }) => {
    const isLightTheme = useResolvedTheme() === 'light';
    const [isExpanded, setIsExpanded] = useState(true);
    const [inputValue, setInputValue] = useState('');
    const { shortcuts, isShortcutPressed } = useShortcuts();
    const [messages, setMessages] = useState<Message[]>([]);
    const [isConnected, setIsConnected] = useState(false);
    const [sttUserStatus, setSttUserStatus] = useState<'connected' | 'reconnecting' | 'failed'>('connected');
    const [sttUserError, setSttUserError] = useState<string>('');
    const [sttUserProvider, setSttUserProvider] = useState<string>('');
    const [sttInterviewerStatus, setSttInterviewerStatus] = useState<'connected' | 'reconnecting' | 'failed'>('connected');
    const [sttInterviewerError, setSttInterviewerError] = useState<string>('');
    const [sttInterviewerProvider, setSttInterviewerProvider] = useState<string>('');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [conversationContext, setConversationContext] = useState<string>('');
    const [isManualRecording, setIsManualRecording] = useState(false);
    const isRecordingRef = useRef(false);  // Ref to track recording state (avoids stale closure)
    const [manualTranscript, setManualTranscript] = useState('');
    const manualTranscriptRef = useRef<string>('');
    const [showTranscript, setShowTranscript] = useState(() => {
        const stored = localStorage.getItem('natively_interviewer_transcript');
        return stored !== 'false';
    });

    // Analytics State
    const requestStartTimeRef = useRef<number | null>(null);

    // Sync transcript setting
    useEffect(() => {
        const handleStorage = () => {
            const stored = localStorage.getItem('natively_interviewer_transcript');
            setShowTranscript(stored !== 'false');
        };
        window.addEventListener('storage', handleStorage);
        return () => window.removeEventListener('storage', handleStorage);
    }, []);

    const [rollingTranscript, setRollingTranscript] = useState('');  // For interviewer rolling text bar
    const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false);  // Track if actively speaking
    const [conversationTurns, setConversationTurns] = useState<ConversationTurn[]>([]);
    const [livePartial, setLivePartial] = useState<{ speaker: 'interviewer' | 'user'; text: string } | null>(null);
    const [voiceInput, setVoiceInput] = useState('');  // Accumulated user voice input
    const voiceInputRef = useRef<string>('');  // Ref for capturing in async handlers
    const textInputRef = useRef<HTMLInputElement>(null); // Ref for input focus
    const isStealthRef = useRef<boolean>(false); // Tracks if the next expansion should be stealthy
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    // Captures data from onCaptureAndProcess before the React state flush so
    // handleWhatToSay() can access it even in React 18 concurrent mode (where
    // a plain setTimeout(0) may fire before setAttachedContext flushes).
    const pendingCaptureRef = useRef<{ path: string; preview: string } | null>(null);

    // Latent Context State (Screenshots attached but not sent)
    const [attachedContext, setAttachedContext] = useState<Array<{ path: string, preview: string }>>([]);

    // Settings State with Persistence
    const [isUndetectable, setIsUndetectable] = useState(false);
    const [hideChatHidesWidget, setHideChatHidesWidget] = useState(() => {
        const stored = localStorage.getItem('natively_hideChatHidesWidget');
        return stored ? stored === 'true' : true;
    });

    // Active mode name (shown as a badge near the Modes button)
    const [activeModeLabel, setActiveModeLabel] = useState<string | null>(null);

    useEffect(() => {
        // Load initial active mode name
        window.electronAPI?.modesGetActive?.()
            .then((mode: { name: string } | null) => setActiveModeLabel(mode?.name ?? null))
            .catch(() => {});
        // Live-update whenever mode is activated/deactivated
        const unsub = window.electronAPI?.onModeChanged?.((data: { id: string | null; name: string | null }) => {
            setActiveModeLabel(data.name);
        });
        return () => unsub?.();
    }, []);

    // Model Selection State
    const [currentModel, setCurrentModel] = useState<string>('gemini-3-flash-preview');

    // Dynamic Action Button Mode (Recap vs Brainstorm)
    const [actionButtonMode, setActionButtonMode] = useState<'recap' | 'brainstorm'>('recap');

    useEffect(() => {
        // Load persisted mode
        window.electronAPI?.getActionButtonMode?.()?.then((mode: 'recap' | 'brainstorm') => {
            if (mode) setActionButtonMode(mode);
        }).catch(() => {});

        // Listen for live changes from SettingsPopup / IPC
        const unsubscribe = window.electronAPI?.onActionButtonModeChanged?.((mode: 'recap' | 'brainstorm') => {
            setActionButtonMode(mode);
        });
        return () => { unsubscribe?.(); };
    }, []);

    const codeTheme = isLightTheme ? oneLight : vscDarkPlus;
    const codeLineNumberColor = isLightTheme ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.2)';
    const appearance = useMemo(
        () => getOverlayAppearance(overlayOpacity, isLightTheme ? 'light' : 'dark'),
        [overlayOpacity, isLightTheme]
    );
    const overlayPanelClass = 'overlay-text-primary';
    const subtleSurfaceClass = 'overlay-subtle-surface';
    const codeBlockClass = 'overlay-code-block-surface';
    const codeHeaderClass = 'overlay-code-header-surface';
    const codeHeaderTextClass = 'overlay-text-muted';
    const quickActionClass = 'overlay-chip-surface overlay-text-interactive';
    const inputClass = `${isLightTheme ? 'focus:ring-black/10' : 'focus:ring-white/10'} overlay-input-surface overlay-input-text`;
    const controlSurfaceClass = 'overlay-control-surface overlay-text-interactive';

    useEffect(() => {
        // Load the persisted default model (not the runtime model)
        // Each new meeting starts with the default from settings
        if (window.electronAPI?.getDefaultModel) {
            window.electronAPI.getDefaultModel()
                .then((result: any) => {
                    if (result && result.model) {
                        setCurrentModel(result.model);
                        // Also set the runtime model to the default
                        window.electronAPI.setModel(result.model).catch(() => { });
                    }
                })
                .catch((err: any) => console.error("Failed to fetch default model:", err));
        }
    }, []);

    const handleModelSelect = (modelId: string) => {
        setCurrentModel(modelId);
        // Session-only: update runtime but don't persist as default
        window.electronAPI.setModel(modelId)
            .catch((err: any) => console.error("Failed to set model:", err));
    };

    // Listen for default model changes from Settings
    useEffect(() => {
        if (!window.electronAPI?.onModelChanged) return;
        const unsubscribe = window.electronAPI.onModelChanged((modelId: string) => {
            setCurrentModel(prev => prev === modelId ? prev : modelId);
        });
        return () => unsubscribe();
    }, []);

    // Global State Sync
    useEffect(() => {
        // Fetch initial state
        if (window.electronAPI?.getUndetectable) {
            window.electronAPI.getUndetectable().then(setIsUndetectable);
        }

        if (window.electronAPI?.onUndetectableChanged) {
            const unsubscribe = window.electronAPI.onUndetectableChanged((state) => {
                setIsUndetectable(state);
            });
            return () => unsubscribe();
        }
    }, []);

    // Persist Settings
    useEffect(() => {
        localStorage.setItem('natively_undetectable', String(isUndetectable));
        localStorage.setItem('natively_hideChatHidesWidget', String(hideChatHidesWidget));
    }, [isUndetectable, hideChatHidesWidget]);

    // Mouse Passthrough State
    const [isMousePassthrough, setIsMousePassthrough] = useState(false);
    useEffect(() => {
        window.electronAPI?.getOverlayMousePassthrough?.().then(setIsMousePassthrough).catch(() => {});
        const unsub = window.electronAPI?.onOverlayMousePassthroughChanged?.((v) => setIsMousePassthrough(v));
        return () => unsub?.();
    }, []);

    // Screen Recording Permission Warning Banner
    const [systemAudioWarning, setSystemAudioWarning] = useState<string | null>(null);
    useEffect(() => {
        const unsub = window.electronAPI?.onSystemAudioPermissionDenied?.((message: string) => {
            setSystemAudioWarning(message);
            setIsExpanded(true); // Force overlay open so user sees the warning
        });
        return () => unsub?.();
    }, []);

    // PR #173: STT not configured warning — shown when provider is 'none' during a meeting
    const [sttNotConfigured, setSttNotConfigured] = useState(false);
    useEffect(() => {
        let mounted = true;
        // Check current STT config on mount
        window.electronAPI?.getSttProvider?.().then((provider: string) => {
            if (mounted) setSttNotConfigured(provider === 'none');
        }).catch(() => {});

        // Listen for live config changes (e.g. user saves a key in Settings while meeting is active)
        const unsub = window.electronAPI?.onSttConfigChanged?.((data: { configured: boolean; provider: string }) => {
            if (mounted) setSttNotConfigured(!data.configured);
        });
        return () => {
            mounted = false;
            unsub?.();
        };
    }, []);

    // Auto-resize Window
    useLayoutEffect(() => {
        if (!contentRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                // Use getBoundingClientRect to get the exact rendered size including padding
                const rect = entry.target.getBoundingClientRect();

                // Send exact dimensions to Electron
                // Removed buffer to ensure tight fit
                console.log('[NativelyInterface] ResizeObserver:', Math.ceil(rect.width), Math.ceil(rect.height));
                window.electronAPI?.updateContentDimensions({
                    width: Math.ceil(rect.width),
                    height: Math.ceil(rect.height)
                });
            }
        });

        observer.observe(contentRef.current);
        return () => observer.disconnect();
    }, []);

    // Force resize when attachedContext changes (screenshots added/removed)
    useEffect(() => {
        if (!contentRef.current) return;
        // Let the DOM settle, then measure and push new dimensions
        requestAnimationFrame(() => {
            if (!contentRef.current) return;
            const rect = contentRef.current.getBoundingClientRect();
            window.electronAPI?.updateContentDimensions({
                width: Math.ceil(rect.width),
                height: Math.ceil(rect.height)
            });
        });
    }, [attachedContext]);

    // Force initial sizing safety check
    useEffect(() => {
        const timer = setTimeout(() => {
            if (contentRef.current) {
                const rect = contentRef.current.getBoundingClientRect();
                window.electronAPI?.updateContentDimensions({
                    width: Math.ceil(rect.width),
                    height: Math.ceil(rect.height)
                });
            }
        }, 600);
        return () => clearTimeout(timer);
    }, []);

    // Build conversation context from messages
    useEffect(() => {
        const context = messages
            .filter(m => m.role !== 'user' || !m.hasScreenshot)
            .map(m => `${m.role === 'interviewer' ? 'Interviewer' : m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
            .slice(-20)
            .join('\n');
        setConversationContext(context);
    }, [messages]);

    // Listen for settings window visibility changes
    useEffect(() => {
        if (!window.electronAPI?.onSettingsVisibilityChange) return;
        const unsubscribe = window.electronAPI.onSettingsVisibilityChange((isVisible) => {
            setIsSettingsOpen(isVisible);
        });
        return () => unsubscribe();
    }, []);

    // Sync Window Visibility with Expanded State
    useEffect(() => {
        if (isExpanded) {
            window.electronAPI.showWindow(isStealthRef.current);
            isStealthRef.current = false; // Reset back to default
        } else {
            // Slight delay to allow animation to clean up if needed, though immediate is safer for click-through
            // Using setTimeout to ensure the render cycle completes first
            // Increased to 400ms to allow "contract to bottom" exit animation to finish
            setTimeout(() => window.electronAPI.hideWindow(), 400);
        }
    }, [isExpanded]);

    // Keyboard shortcut to toggle expanded state (via Main Process)
    useEffect(() => {
        if (!window.electronAPI?.onToggleExpand) return;
        const unsubscribe = window.electronAPI.onToggleExpand(() => {
            setIsExpanded(prev => !prev);
        });
        return () => unsubscribe();
    }, []);

    // Ensure overlay is expanded when requested by main process (e.g. after switching to overlay mode).
    // IMPORTANT: set isStealthRef before setIsExpanded so that if isExpanded was false, the
    // isExpanded effect fires showWindow(true) instead of showWindow(false). Without this,
    // ensure-expanded on a collapsed overlay would trigger show()+focus(), breaking stealth.
    useEffect(() => {
        if (!window.electronAPI?.onEnsureExpanded) return;
        const unsubscribe = window.electronAPI.onEnsureExpanded(() => {
            isStealthRef.current = true;
            setIsExpanded(true);
        });
        return () => unsubscribe();
    }, []);

    // Session Reset Listener - Clears UI when a NEW meeting starts
    useEffect(() => {
        if (!window.electronAPI?.onSessionReset) return;
        const unsubscribe = window.electronAPI.onSessionReset(() => {
            console.log('[NativelyInterface] Resetting session state...');
            setMessages([]);
            setInputValue('');
            setAttachedContext([]);
            setManualTranscript('');
            setVoiceInput('');
            setIsProcessing(false);
            // Optionally reset connection status if needed, but connection persists

            // Track new conversation/session if applicable?
            // Actually 'app_opened' is global, 'assistant_started' is overlay.
            // Maybe 'conversation_started' event?
            analytics.trackConversationStarted();
        });
        return () => unsubscribe();
    }, []);


    const handleScreenshotAttach = (data: { path: string; preview: string }) => {
        setIsExpanded(true);
        setAttachedContext(prev => {
            // Prevent duplicates and cap at 5
            if (prev.some(s => s.path === data.path)) return prev;
            const updated = [...prev, data];
            return updated.slice(-5); // Keep last 5
        });
    };

    // STT Status listener — must survive isExpanded changes.
    // If registered inside the [isExpanded] effect, events are dropped during cleanup.
    useEffect(() => {
        return window.electronAPI.onSttStatusChanged((data) => {
            if (data.channel === 'user') {
                setSttUserStatus(data.state);
                setSttUserProvider(data.provider);
                if (data.error) setSttUserError(data.error);
                if (data.state === 'connected') setSttUserError('');
            } else if (data.channel === 'interviewer') {
                setSttInterviewerStatus(data.state);
                setSttInterviewerProvider(data.provider);
                if (data.error) setSttInterviewerError(data.error);
                if (data.state === 'connected') setSttInterviewerError('');
            }
        });
    }, []);

    // Connect to Native Audio Backend
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        // Connection Status
        window.electronAPI.getNativeAudioStatus().then((status) => {
            setIsConnected(status.connected);
        }).catch(() => setIsConnected(false));

        cleanups.push(window.electronAPI.onNativeAudioConnected(() => {
            setIsConnected(true);
        }));
        cleanups.push(window.electronAPI.onNativeAudioDisconnected(() => {
            setIsConnected(false);
        }));

        // Real-time Transcripts
        cleanups.push(window.electronAPI.onNativeAudioTranscript((transcript) => {
            // When Answer button is active, capture USER transcripts for voice input
            // Use ref to avoid stale closure issue
            if (isRecordingRef.current && transcript.speaker === 'user') {
                if (transcript.final) {
                    // Accumulate final transcripts
                    setVoiceInput(prev => {
                        const updated = prev + (prev ? ' ' : '') + transcript.text;
                        voiceInputRef.current = updated;
                        return updated;
                    });
                    setManualTranscript('');  // Clear partial preview
                    manualTranscriptRef.current = '';
                } else {
                    // Show live partial transcript
                    setManualTranscript(transcript.text);
                    manualTranscriptRef.current = transcript.text;
                }
                return;  // Don't add to messages while recording
            }

            // Accept both speakers into the live conversation log so the user can
            // follow along with what they said vs. what the other party said.
            if (transcript.speaker !== 'interviewer' && transcript.speaker !== 'user') {
                return;  // Safety check for any other speaker types
            }

            const speaker = transcript.speaker as 'interviewer' | 'user';
            const trimmed = transcript.text.trim();

            if (transcript.final) {
                if (trimmed) {
                    setConversationTurns(prev => [
                        ...prev.slice(-49),
                        {
                            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                            speaker,
                            text: transcript.text,
                            timestamp: Date.now(),
                            final: true,
                        },
                    ]);
                }
                setLivePartial(prev => (prev && prev.speaker === speaker ? null : prev));
            } else if (trimmed) {
                setLivePartial({ speaker, text: transcript.text });
            }

            // Maintain the existing single-line interviewer rolling bar for
            // back-compat with other UI hooks that read it.
            if (speaker !== 'interviewer') {
                return;
            }

            setIsInterviewerSpeaking(!transcript.final);

            if (transcript.final) {
                setRollingTranscript(prev => {
                    const separator = prev ? '  ·  ' : '';
                    return prev + separator + transcript.text;
                });

                setTimeout(() => {
                    setIsInterviewerSpeaking(false);
                }, 3000);
            } else {
                setRollingTranscript(prev => {
                    const lastSeparator = prev.lastIndexOf('  ·  ');
                    const accumulated = lastSeparator >= 0 ? prev.substring(0, lastSeparator + 5) : '';
                    return accumulated + transcript.text;
                });
            }
        }));

        // AI Suggestions from native audio (legacy)
        cleanups.push(window.electronAPI.onSuggestionProcessingStart(() => {
            setIsProcessing(true);
            setIsExpanded(true);
        }));

        cleanups.push(window.electronAPI.onSuggestionGenerated((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: data.suggestion
            }]);
        }));

        cleanups.push(window.electronAPI.onSuggestionError((err) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                // If the buy-time filler is still on screen with no real content yet,
                // replace it with the error so the chat doesn't end up showing a
                // stale "Yeah, give me a sec..." next to a failure message.
                if (lastMsg && lastMsg.isFiller) {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: `Error: ${err.error}`,
                        isFiller: false,
                        isStreaming: false,
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system' as const,
                    text: `Error: ${err.error}`,
                }];
            });
        }));



        cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswerToken((data) => {
            // Progressive update for 'what_to_answer' mode
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];

                // If we already have a streaming message for this intent, replace
                // (if it's still the buy-time filler) or append (real text).
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'what_to_answer') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.isFiller ? data.token : lastMsg.text + data.token,
                        isFiller: false,
                    };
                    return updated;
                }

                // Otherwise, start a new one (First token)
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.token,
                    intent: 'what_to_answer',
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceSuggestedAnswer((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];

                // If we were streaming, finalize it
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'what_to_answer') {
                    // Start new array to avoid mutation
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.answer, // Ensure final consistency
                        isStreaming: false
                    };
                    return updated;
                }

                // If we missed the stream (or not streaming), append fresh
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.answer,  // Plain text, no markdown - ready to speak
                    intent: 'what_to_answer'
                }];
            });
        }));

        // STREAMING: Refinement
        cleanups.push(window.electronAPI.onIntelligenceRefinedAnswerToken((data) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === data.intent) {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.isFiller ? data.token : lastMsg.text + data.token,
                        isFiller: false,
                    };
                    return updated;
                }
                // New stream start (e.g. user clicked Shorten)
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.token,
                    intent: data.intent,
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceRefinedAnswer((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === data.intent) {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.answer,
                        isStreaming: false
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.answer,
                    intent: data.intent
                }];
            });
        }));

        // STREAMING: Recap
        cleanups.push(window.electronAPI.onIntelligenceRecapToken((data) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'recap') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.isFiller ? data.token : lastMsg.text + data.token,
                        isFiller: false,
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.token,
                    intent: 'recap',
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceRecap((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'recap') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.summary,
                        isStreaming: false
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.summary,
                    intent: 'recap'
                }];
            });
        }));

        // STREAMING: Follow-Up Questions (Rendered as message? Or specific UI?)
        // Currently interface typically renders follow-up Qs as a message or button update.
        // Let's assume message for now based on existing 'follow_up_questions_update' handling
        // But wait, existing handle just sets state?
        // Let's check how 'follow_up_questions_update' was handled.
        // It was handled separate locally in this component maybe?
        // Ah, I need to see the existing listener for 'onIntelligenceFollowUpQuestionsUpdate'

        // Let's implemented token streaming for it anyway, likely it updates a message bubble 
        // OR it might update a specialized "Suggested Questions" area.
        // Assuming it's a message for consistency with "Copilot" approach.

        cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsToken((data) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'follow_up_questions') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.isFiller ? data.token : lastMsg.text + data.token,
                        isFiller: false,
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.token,
                    intent: 'follow_up_questions',
                    isStreaming: true
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceFollowUpQuestionsUpdate((data) => {
            // This event name is slightly different ('update' vs 'answer')
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'follow_up_questions') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: data.questions,
                        isStreaming: false
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: data.questions,
                    intent: 'follow_up_questions'
                }];
            });
        }));

        cleanups.push(window.electronAPI.onIntelligenceManualResult((data) => {
            setIsProcessing(false);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `🎯 **Answer:**\n\n${data.answer}`
            }]);
        }));

        cleanups.push(window.electronAPI.onIntelligenceError((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isFiller) {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: `❌ Error (${data.mode}): ${data.error}`,
                        isFiller: false,
                        isStreaming: false,
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system' as const,
                    text: `❌ Error (${data.mode}): ${data.error}`,
                }];
            });
        }));
        return () => cleanups.forEach(fn => fn());
    }, [isExpanded]);

    // Stable mount-only effect for screenshot listeners.
    // These MUST NOT be inside the [isExpanded] effect — when a screenshot is
    // taken, `switchToOverlay` fires `ensure-expanded` which can flip isExpanded
    // from false→true, triggering the [isExpanded] effect cleanup. If `screenshot-taken`
    // arrives during that teardown gap the event is silently dropped (same issue
    // as clarify streaming listeners below). handleScreenshotAttach only uses stable
    // useState setters so a mount-only closure is safe here.
    useEffect(() => {
        const cleanupTaken = window.electronAPI.onScreenshotTaken(handleScreenshotAttach);
        const cleanupAttached = window.electronAPI.onScreenshotAttached?.(handleScreenshotAttach);
        return () => {
            cleanupTaken?.();
            cleanupAttached?.();
        };
    }, []);

    // Stable mount-only effect for clarify streaming listeners.
    // These MUST NOT be inside the [isExpanded] effect — if the user
    // expands/collapses the panel while a clarify stream is in-flight,
    // the [isExpanded] effect would tear down and re-register listeners,
    // orphaning the final 'clarify' event and leaving isProcessing=true forever.
    useEffect(() => {
        const cleanupToken = window.electronAPI.onIntelligenceClarifyToken((data) => {
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'clarify') {
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: lastMsg.isFiller ? data.token : lastMsg.text + data.token,
                        isFiller: false,
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system' as const,
                    text: data.token,
                    intent: 'clarify',
                    isStreaming: true
                }];
            });
        });

        const cleanupFinal = window.electronAPI.onIntelligenceClarify((data) => {
            setIsProcessing(false);
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'clarify') {
                    const updated = [...prev];
                    updated[prev.length - 1] = { ...lastMsg, text: data.clarification, isStreaming: false };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system' as const,
                    text: data.clarification,
                    intent: 'clarify'
                }];
            });
        });

        return () => {
            cleanupToken();
            cleanupFinal();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // intentionally empty — these listeners must survive isExpanded changes

    /**
     * Buy-time filler — push an instant stall line into the message stream so
     * the user can start reading it aloud the moment they hit the action key.
     * The filler bubble is marked isFiller=true and isStreaming=true; the next
     * real streamed token replaces it (see token handlers above).
     */
    const spawnFiller = React.useCallback((intent: FillerIntent, messageIntent: string) => {
        const fillerText = pickFiller(intent);
        setMessages(prev => [...prev, {
            id: `filler-${Date.now()}`,
            role: 'system' as const,
            text: fillerText,
            intent: messageIntent,
            isStreaming: true,
            isFiller: true,
        }]);
        // Scroll the filler into view immediately.
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 0);
    }, []);

    // Quick Actions - Updated to use new Intelligence APIs

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
        analytics.trackCopyAnswer();
        // Optional: Trigger a small toast or state change for visual feedback
    };

    const handleWhatToSay = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        spawnFiller('what_to_answer', 'what_to_answer');
        analytics.trackCommandExecuted('what_to_say');

        // Capture and clear attached image context.
        // Also merge in any screenshot from the capture-and-process shortcut that
        // arrived via pendingCaptureRef before the React state flush (React 18 fix).
        const pending = pendingCaptureRef.current;
        let currentAttachments = attachedContext;
        if (pending && !currentAttachments.some(s => s.path === pending.path)) {
            currentAttachments = [...currentAttachments, pending].slice(-5);
        }

        if (currentAttachments.length > 0) {
            setAttachedContext([]);
            // Show the attached image in chat
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: 'What should I say about this?',
                hasScreenshot: true,
                screenshotPreview: currentAttachments[0].preview
            }]);
            // Scroll to bottom when user sends message
            setTimeout(() => {
            	messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);
        }

        try {
            // Pass imagePath if attached
            await window.electronAPI.generateWhatToSay(undefined, currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFollowUp = async (intent: string = 'rephrase') => {
        setIsExpanded(true);
        setIsProcessing(true);
        analytics.trackCommandExecuted('follow_up_' + intent);

        try {
            await window.electronAPI.generateFollowUp(intent);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRecap = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        spawnFiller('recap', 'recap');
        analytics.trackCommandExecuted('recap');

        try {
            await window.electronAPI.generateRecap();
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFollowUpQuestions = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        spawnFiller('follow_up_questions', 'follow_up_questions');
        analytics.trackCommandExecuted('suggest_questions');

        try {
            await window.electronAPI.generateFollowUpQuestions();
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleClarify = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        spawnFiller('clarify', 'clarify');
        analytics.trackCommandExecuted('clarify');

        try {
            await window.electronAPI.generateClarify();
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleCodeHint = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        spawnFiller('code_hint', 'code_hint');
        analytics.trackCommandExecuted('code_hint');

        const currentAttachments = attachedContext;
        if (currentAttachments.length > 0) {
            setAttachedContext([]);
            // Show the attached image in chat
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: 'Give me a code hint for this',
                hasScreenshot: true,
                screenshotPreview: currentAttachments[0].preview
            }]);
        	// Scroll to bottom when user sends message
        	setTimeout(() => {
        		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        	}, 50);
        }

        try {
            await window.electronAPI.generateCodeHint(currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleBrainstorm = async () => {
        setIsExpanded(true);
        setIsProcessing(true);
        spawnFiller('brainstorm', 'brainstorm');
        analytics.trackCommandExecuted('brainstorm');

        const currentAttachments = attachedContext;
        if (currentAttachments.length > 0) {
            setAttachedContext([]);
            // Show the attached image in chat
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: 'Brainstorm with this context',
                hasScreenshot: true,
                screenshotPreview: currentAttachments[0].preview
            }]);
        	// Scroll to bottom when user sends message
        	setTimeout(() => {
        		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        	}, 50);
        }

        try {
            await window.electronAPI.generateBrainstorm(currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined);
        } catch (err) {
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'system',
                text: `Error: ${err}`
            }]);
        } finally {
            setIsProcessing(false);
        }
    };


    // Setup Streaming Listeners
    useEffect(() => {
        const cleanups: (() => void)[] = [];

        // Stream Token
        cleanups.push(window.electronAPI.onGeminiStreamToken((token) => {
            // Guard: if this token is the negotiation coaching JSON sentinel, accumulate it
            // silently. The JSON is always emitted as a single complete `yield JSON.stringify(...)`
            // call, so one parse attempt is sufficient. The onGeminiStreamDone handler will
            // detect the accumulated JSON and render the proper card UI — we just prevent the
            // raw JSON characters from ever appearing in the chat bubble.
            try {
                const parsed = JSON.parse(token);
                if (parsed?.__negotiationCoaching) {
                    // Store the raw JSON text (Done handler needs it) but don't show it.
                    setMessages(prev => {
                        const lastMsg = prev[prev.length - 1];
                        if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                            const updated = [...prev];
                            updated[prev.length - 1] = { ...lastMsg, text: token };
                            return updated;
                        }
                        return prev;
                    });
                    return; // Skip the normal append below
                }
            } catch {
                // Not JSON — normal text token, fall through to the standard append.
            }

            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                    // If this bubble is still showing a buy-time filler, replace
                    // its text with the first real token instead of appending.
                    const newText = lastMsg.isFiller ? token : lastMsg.text + token;
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        text: newText,
                        isFiller: false,
                        // re-check code status on every token? Expensive but needed for progressive highlighting
                        isCode: newText.includes('```') || newText.includes('def ') || newText.includes('function ')
                    };
                    return updated;
                }
                return prev;
            });
        }));

        // Stream Done
        cleanups.push(window.electronAPI.onGeminiStreamDone(() => {
            setIsProcessing(false);

            // Calculate latency if we have a start time
            let latency = 0;
            if (requestStartTimeRef.current) {
                latency = Date.now() - requestStartTimeRef.current;
                requestStartTimeRef.current = null;
            }

            // Track Usage
            analytics.trackModelUsed({
                model_name: currentModel,
                provider_type: detectProviderType(currentModel),
                latency_ms: latency
            });

            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                    // Detect negotiation coaching response
                    try {
                        const parsed = JSON.parse(lastMsg.text);
                        if (parsed?.__negotiationCoaching) {
                            const coaching = parsed.__negotiationCoaching;
                            return [...prev.slice(0, -1), {
                                ...lastMsg,
                                isStreaming: false,
                                isNegotiationCoaching: true,
                                negotiationCoachingData: coaching,
                                text: '',
                            }];
                        }
                    } catch {}
                    // Normal completion
                    return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }];
                }
                return prev;
            });
        }));

        // Stream Error
        cleanups.push(window.electronAPI.onGeminiStreamError((error) => {
            setIsProcessing(false);
            requestStartTimeRef.current = null; // Clear timer on error
            setMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg && lastMsg.isStreaming) {
                    // If the buy-time filler is still in place, swap it for the
                    // error fully — we don't want to append an error to "Yeah,
                    // give me a sec...". Otherwise preserve any partial response
                    // and append the error inline as before.
                    const newText = lastMsg.isFiller
                        ? `❌ Error: ${error}`
                        : lastMsg.text + `\n\n[Error: ${error}]`;
                    const updated = [...prev];
                    updated[prev.length - 1] = {
                        ...lastMsg,
                        isStreaming: false,
                        isFiller: false,
                        text: newText,
                    };
                    return updated;
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: `❌ Error: ${error}`
                }];
            });
        }));

        // JIT RAG Stream listeners (for live meeting RAG responses)
        if (window.electronAPI.onRAGStreamChunk) {
            cleanups.push(window.electronAPI.onRAGStreamChunk((data: { chunk: string }) => {
                // Same guard as onGeminiStreamToken: suppress raw JSON if this chunk is
                // the negotiation coaching sentinel. The onRAGStreamComplete handler will
                // convert it to the proper card UI.
                try {
                    const parsed = JSON.parse(data.chunk);
                    if (parsed?.__negotiationCoaching) {
                        setMessages(prev => {
                            const lastMsg = prev[prev.length - 1];
                            if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                                const updated = [...prev];
                                updated[prev.length - 1] = { ...lastMsg, text: data.chunk };
                                return updated;
                            }
                            return prev;
                        });
                        return; // Skip normal append
                    }
                } catch {
                    // Normal text chunk — fall through.
                }

                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                        // Replace the buy-time filler on first real chunk; append once
                        // we're already streaming real content.
                        const newText = lastMsg.isFiller ? data.chunk : lastMsg.text + data.chunk;
                        const updated = [...prev];
                        updated[prev.length - 1] = {
                            ...lastMsg,
                            text: newText,
                            isFiller: false,
                            isCode: newText.includes('```')
                        };
                        return updated;
                    }
                    return prev;
                });
            }));
        }

        if (window.electronAPI.onRAGStreamComplete) {
            cleanups.push(window.electronAPI.onRAGStreamComplete(() => {
                setIsProcessing(false);
                requestStartTimeRef.current = null;
                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
                        // Detect negotiation coaching response
                        try {
                            const parsed = JSON.parse(lastMsg.text);
                            if (parsed?.__negotiationCoaching) {
                                const coaching = parsed.__negotiationCoaching;
                                return [...prev.slice(0, -1), {
                                    ...lastMsg,
                                    isStreaming: false,
                                    isNegotiationCoaching: true,
                                    negotiationCoachingData: coaching,
                                    text: '',
                                }];
                            }
                        } catch {}
                        // Normal completion
                        return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }];
                    }
                    if (lastMsg && lastMsg.isStreaming) {
                        const updated = [...prev];
                        updated[prev.length - 1] = { ...lastMsg, isStreaming: false };
                        return updated;
                    }
                    return prev;
                });
            }));
        }

        if (window.electronAPI.onRAGStreamError) {
            cleanups.push(window.electronAPI.onRAGStreamError((data: { error: string }) => {
                setIsProcessing(false);
                requestStartTimeRef.current = null;
                setMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    if (lastMsg && lastMsg.isStreaming) {
                        const newText = lastMsg.isFiller
                            ? `❌ RAG Error: ${data.error}`
                            : lastMsg.text + `\n\n[RAG Error: ${data.error}]`;
                        const updated = [...prev];
                        updated[prev.length - 1] = {
                            ...lastMsg,
                            isStreaming: false,
                            isFiller: false,
                            text: newText,
                        };
                        return updated;
                    }
                    return prev;
                });
            }));
        }

        return () => cleanups.forEach(fn => fn());
    }, [currentModel]); // Ensure tracking captures correct model


    const handleAnswerNow = async () => {
        if (isManualRecording) {
            // Stop recording - send accumulated voice input to Gemini
            isRecordingRef.current = false;  // Update ref immediately
            setIsManualRecording(false);
            setManualTranscript('');  // Clear live preview

            // Send manual finalization signal to STT Providers
            window.electronAPI.finalizeMicSTT().catch(err => console.error('[NativelyInterface] Failed to send finalizeMicSTT:', err));

            const currentAttachments = attachedContext;
            setAttachedContext([]); // Clear context immediately on send

            const question = (voiceInputRef.current + (manualTranscriptRef.current ? ' ' + manualTranscriptRef.current : '')).trim();
            setVoiceInput('');
            voiceInputRef.current = '';
            setManualTranscript('');
            manualTranscriptRef.current = '';

            if (!question && currentAttachments.length === 0) {
                // No voice input and no image — show real STT error if available
                if (sttUserStatus === 'failed' && sttUserError) {
                    setMessages(prev => [...prev, {
                        id: Date.now().toString(),
                        role: 'system',
                        text: `❌ STT Error: ${sttUserError}`
                    }]);
                } else if (sttUserStatus === 'reconnecting') {
                    setMessages(prev => [...prev, {
                        id: Date.now().toString(),
                        role: 'system',
                        text: '⏳ STT is reconnecting, try again in a moment.'
                    }]);
                } else {
                    setMessages(prev => [...prev, {
                        id: Date.now().toString(),
                        role: 'system',
                        text: '⚠️ No speech detected. Try speaking closer to your microphone.'
                    }]);
                }
                return;
            }

            // Show user's spoken question
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'user',
                text: question,
                hasScreenshot: currentAttachments.length > 0,
                screenshotPreview: currentAttachments[0]?.preview
            }]);
            
            // Scroll to bottom when user sends message
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 50);

            // Buy-time filler placeholder — instantly fills the streaming bubble
            // with a natural stall line the user can read aloud while the LLM
            // composes. Replaced by the first real token via onGeminiStreamToken.
            setIsProcessing(true);
            spawnFiller('answer_now', 'answer_now');

            try {
                let prompt = '';

                if (currentAttachments.length > 0) {
                    // Image + Voice Context
                    prompt = `You are a helper. The user has provided a screenshot and a spoken question/command.
User said: "${question}"

Instructions:
1. Analyze the screenshot in the context of what the user said.
2. Provide a direct, helpful answer.
3. Be concise.`;
                } else {
                    // JIT RAG pre-flight: try to use indexed meeting context first
                    const ragResult = await window.electronAPI.ragQueryLive?.(question);
                    if (ragResult?.success) {
                        // JIT RAG handled it — response streamed via rag:stream-chunk events
                        return;
                    }

                    // Voice Only (Smart Extract) — fallback
                    prompt = `You are a real-time interview assistant. The user just repeated or paraphrased a question from their interviewer.
Instructions:
1. Extract the core question being asked
2. Provide a clear, concise, and professional answer that the user can say out loud
3. Keep the answer conversational but informative (2-4 sentences ideal)
4. Do NOT include phrases like "The question is..." - just give the answer directly
5. Format for speaking out loud, not for reading

Provide only the answer, nothing else.`;
                }

                // Call Streaming API: message = question, context = instructions
                requestStartTimeRef.current = Date.now();
                await window.electronAPI.streamGeminiChat(question, currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined, prompt, { skipSystemPrompt: true });

            } catch (err) {
                // Initial invocation failing (e.g. IPC error before stream starts)
                setIsProcessing(false);
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    // If we just added the empty streaming placeholder, remove it or fill it with error
                    if (last && last.isStreaming && last.text === '') {
                        return prev.slice(0, -1).concat({
                            id: Date.now().toString(),
                            role: 'system',
                            text: `❌ Error starting stream: ${err}`
                        });
                    }
                    return [...prev, {
                        id: Date.now().toString(),
                        role: 'system',
                        text: `❌ Error: ${err}`
                    }];
                });
            }
        } else {
            // Start recording - reset voice input state
            setVoiceInput('');
            voiceInputRef.current = '';
            setManualTranscript('');
            isRecordingRef.current = true;  // Update ref immediately
            setIsManualRecording(true);


            // Ensure native audio is connected
            try {
                // Native audio is now managed by main process
                // await window.electronAPI.invoke('native-audio-connect');
            } catch (err) {
                // Already connected, that's fine
            }
        }
    };

    const handleManualSubmit = async () => {
        if (!inputValue.trim() && attachedContext.length === 0) return;

        const userText = inputValue;
        const currentAttachments = attachedContext;

        // Clear inputs immediately
        setInputValue('');
        setAttachedContext([]);

        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'user',
            text: userText || (currentAttachments.length > 0 ? 'Analyze this screenshot' : ''),
            hasScreenshot: currentAttachments.length > 0,
            screenshotPreview: currentAttachments[0]?.preview
        }]);

        // Scroll to bottom when user sends message
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        // Add placeholder for streaming response
        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'system',
            text: '',
            isStreaming: true
        }]);

        setIsExpanded(true);
        setIsProcessing(true);

        try {
            // JIT RAG pre-flight: try to use indexed meeting context first
            if (currentAttachments.length === 0) {
                const ragResult = await window.electronAPI.ragQueryLive?.(userText || '');
                if (ragResult?.success) {
                    // JIT RAG handled it — response streamed via rag:stream-chunk events
                    return;
                }
            }

            // Pass imagePath if attached, AND conversation context
            requestStartTimeRef.current = Date.now();
            await window.electronAPI.streamGeminiChat(
                userText || 'Analyze this screenshot',
                currentAttachments.length > 0 ? currentAttachments.map(s => s.path) : undefined,
                conversationContext // Pass context so "answer this" works
            );
        } catch (err) {
            setIsProcessing(false);
            setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last && last.isStreaming && last.text === '') {
                    // remove the empty placeholder
                    return prev.slice(0, -1).concat({
                        id: Date.now().toString(),
                        role: 'system',
                        text: `❌ Error starting stream: ${err}`
                    });
                }
                return [...prev, {
                    id: Date.now().toString(),
                    role: 'system',
                    text: `❌ Error: ${err}`
                }];
            });
        }
    };

    const clearChat = () => {
        setMessages([]);
    };




    const renderMessageText = (msg: Message) => {
        // Negotiation coaching card takes priority
        if (msg.isNegotiationCoaching && msg.negotiationCoachingData) {
            return (
                <NegotiationCoachingCard
                    {...msg.negotiationCoachingData}
                    phase={msg.negotiationCoachingData.phase as any}
                    onSilenceTimerEnd={() => {
                        setMessages(prev => prev.map(m =>
                            m.id === msg.id
                                ? { ...m, negotiationCoachingData: m.negotiationCoachingData ? { ...m.negotiationCoachingData, showSilenceTimer: false } : undefined }
                                : m
                        ));
                    }}
                />
            );
        }

        // Code-containing messages get special styling
        // We split by code blocks to keep the "Code Solution" UI intact for the code parts
        // But use ReactMarkdown for the text parts around it
        if (msg.isCode || (msg.role === 'system' && msg.text.includes('```'))) {
            const parts = msg.text.split(/(```[\s\S]*?```)/g);
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-violet-600' : 'text-purple-300'}`}>
                        <Code className="w-3.5 h-3.5" />
                        <span>Code Solution</span>
                    </div>
                    <div className={`space-y-2 text-[13px] leading-relaxed ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        {parts.map((part, i) => {
                            if (part.startsWith('```')) {
                                const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
                                if (match) {
                                    const lang = match[1] || 'python';
                                    const code = match[2].trim();
                                    return (
                                        <div key={i} className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`} style={appearance.codeBlockStyle}>
                                            {/* Minimalist Apple Header */}
                                            <div className={`px-3 py-1.5 border-b ${codeHeaderClass}`} style={appearance.codeHeaderStyle}>
                                                <span className={`text-[10px] uppercase tracking-widest font-semibold font-mono ${codeHeaderTextClass}`}>
                                                    {lang || 'CODE'}
                                                </span>
                                            </div>
                                            <div className="bg-transparent">
                                                <SyntaxHighlighter
                                                    language={lang}
                                                    style={codeTheme}
                                                    customStyle={{
                                                        margin: 0,
                                                        borderRadius: 0,
                                                        fontSize: '13px',
                                                        lineHeight: '1.6',
                                                        background: 'transparent',
                                                        padding: '16px',
                                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                    }}
                                                    wrapLongLines={true}
                                                    showLineNumbers={true}
                                                    lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: codeLineNumberColor, textAlign: 'right', fontSize: '11px' }}
                                                >
                                                    {code}
                                                </SyntaxHighlighter>
                                            </div>
                                        </div>
                                    );
                                }
                            }
                            // Regular text - Render with Markdown
                            return (
                                <div key={i} className="markdown-content">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={{
                                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />,
                                            strong: ({ node, ...props }: any) => <strong className="font-bold overlay-text-strong" {...props} />,
                                            em: ({ node, ...props }: any) => <em className="italic overlay-text-secondary" {...props} />,
                                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                            ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                                            h1: ({ node, ...props }: any) => <h1 className="text-lg font-bold mb-2 mt-3 overlay-text-strong" {...props} />,
                                            h2: ({ node, ...props }: any) => <h2 className="text-base font-bold mb-2 mt-3 overlay-text-strong" {...props} />,
                                            h3: ({ node, ...props }: any) => <h3 className="text-sm font-bold mb-1 mt-2 overlay-text-primary" {...props} />,
                                            code: ({ node, ...props }: any) => <code className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono whitespace-pre-wrap ${isLightTheme ? 'text-violet-700' : 'text-purple-200'}`} {...props} />,
                                            blockquote: ({ node, ...props }: any) => <blockquote className={`border-l-2 pl-3 italic my-2 ${isLightTheme ? 'border-violet-500/30 text-slate-600' : 'border-purple-500/50 text-slate-400'}`} {...props} />,
                                            a: ({ node, ...props }: any) => <a className={`hover:underline ${isLightTheme ? 'text-blue-600 hover:text-blue-700' : 'text-blue-400 hover:text-blue-300'}`} target="_blank" rel="noopener noreferrer" {...props} />,
                                        }}
                                    >
                                        {part}
                                    </ReactMarkdown>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        // Custom Styled Labels (Shorten, Recap, Follow-up) - also use Markdown for content
        if (msg.intent === 'shorten') {
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-cyan-700' : 'text-cyan-300'}`}>
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Shortened</span>
                    </div>
                    <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-cyan-800' : 'text-cyan-100'}`} {...props} />,
                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        }}>
                            {msg.text}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        }

        if (msg.intent === 'recap') {
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-indigo-700' : 'text-indigo-300'}`}>
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Recap</span>
                    </div>
                    <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-indigo-800' : 'text-indigo-100'}`} {...props} />,
                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        }}>
                            {msg.text}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        }

        if (msg.intent === 'follow_up_questions') {
            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className={`flex items-center gap-2 mb-2 font-semibold text-xs uppercase tracking-wide ${isLightTheme ? 'text-amber-700' : 'text-[#FFD60A]'}`}>
                        <HelpCircle className="w-3.5 h-3.5" />
                        <span>Follow-Up Questions</span>
                    </div>
                    <div className={`text-[13px] leading-relaxed markdown-content ${isLightTheme ? 'text-slate-800' : 'text-slate-200'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{
                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-amber-800' : 'text-[#FFF9C4]'}`} {...props} />,
                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2" {...props} />,
                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        }}>
                            {msg.text}
                        </ReactMarkdown>
                    </div>
                </div>
            );
        }

        if (msg.intent === 'what_to_answer') {
            // Split text by code blocks (Handle unclosed blocks at EOF)
            const parts = msg.text.split(/(```[\s\S]*?(?:```|$))/g);

            return (
                <div className={`rounded-lg p-3 my-1 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className="flex items-center gap-2 mb-2 text-emerald-400 font-semibold text-xs uppercase tracking-wide">
                        <span>Say this</span>
                    </div>
                    <div className="text-[14px] leading-relaxed overlay-text-primary">
                        {parts.map((part, i) => {
                            if (part.startsWith('```')) {
                                // Robust matching: handles unclosed blocks for streaming (```...$)
                                const match = part.match(/```(\w*)\s+([\s\S]*?)(?:```|$)/);

                                // Fallback logic: if it starts with ticks, treat as code (even if unclosed)
                                if (match || part.startsWith('```')) {
                                    const lang = (match && match[1]) ? match[1] : 'python';
                                    let code = '';

                                    if (match && match[2]) {
                                        code = match[2].trim();
                                    } else {
                                        // Manual strip if regex failed
                                        code = part.replace(/^```\w*\s*/, '').replace(/```$/, '').trim();
                                    }

                                    return (
                                        <div key={i} className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`} style={appearance.codeBlockStyle}>
                                            {/* Minimalist Apple Header */}
                                            <div className={`px-3 py-1.5 border-b ${codeHeaderClass}`} style={appearance.codeHeaderStyle}>
                                                <span className={`text-[10px] uppercase tracking-widest font-semibold font-mono ${codeHeaderTextClass}`}>
                                                    {lang || 'CODE'}
                                                </span>
                                            </div>

                                            <div className="bg-transparent">
                                                <SyntaxHighlighter
                                                    language={lang}
                                                    style={codeTheme}
                                                    customStyle={{
                                                        margin: 0,
                                                        borderRadius: 0,
                                                        fontSize: '13px',
                                                        lineHeight: '1.6',
                                                        background: 'transparent',
                                                        padding: '16px',
                                                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                    }}
                                                    wrapLongLines={true}
                                                    showLineNumbers={true}
                                                    lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: codeLineNumberColor, textAlign: 'right', fontSize: '11px' }}
                                                >
                                                    {code}
                                                </SyntaxHighlighter>
                                            </div>
                                        </div>
                                    );
                                }
                            }
                            // Regular text - Render Markdown
                            return (
                                <div key={i} className="markdown-content">
                                    <ReactMarkdown
                                        remarkPlugins={[remarkGfm, remarkMath]}
                                        rehypePlugins={[rehypeKatex]}
                                        components={{
                                            p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0" {...props} />,
                                            strong: ({ node, ...props }: any) => <strong className={`font-bold ${isLightTheme ? 'text-emerald-700' : 'text-emerald-100'}`} {...props} />,
                                            em: ({ node, ...props }: any) => <em className={`italic ${isLightTheme ? 'text-emerald-700/80' : 'text-emerald-200/80'}`} {...props} />,
                                            ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                                            ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                                            li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                                        }}
                                    >
                                        {part}
                                    </ReactMarkdown>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        // Standard Text Messages (e.g. from User or Interviewer)
        // We still want basic markdown support here too
        return (
            <div className="markdown-content">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                        p: ({ node, ...props }: any) => <p className="mb-2 last:mb-0 whitespace-pre-wrap" {...props} />,
                        strong: ({ node, ...props }: any) => <strong className="font-bold opacity-100 overlay-text-strong" {...props} />,
                        em: ({ node, ...props }: any) => <em className="italic opacity-90 overlay-text-secondary" {...props} />,
                        ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mb-2 space-y-1" {...props} />,
                        ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mb-2 space-y-1" {...props} />,
                        li: ({ node, ...props }: any) => <li className="pl-1" {...props} />,
                        code: ({ node, ...props }: any) => <code className={`overlay-inline-code-surface rounded px-1 py-0.5 text-xs font-mono ${isLightTheme ? 'text-slate-800' : ''}`} {...props} />,
                        a: ({ node, ...props }: any) => <a className="underline hover:opacity-80" target="_blank" rel="noopener noreferrer" {...props} />,
                    }}
                >
                    {msg.text}
                </ReactMarkdown>
            </div>
        );
    };


    // We use a ref to hold the latest handlers to avoid re-binding the event listener on every render
    const handlersRef = useRef({
        handleWhatToSay,
        handleFollowUp,
        handleFollowUpQuestions,
        handleRecap,
        handleAnswerNow,
        handleClarify,
        handleCodeHint,
        handleBrainstorm
    });

    // Update ref on every render so the event listener always access latest state/props
    handlersRef.current = {
        handleWhatToSay,
        handleFollowUp,
        handleFollowUpQuestions,
        handleRecap,
        handleAnswerNow,
        handleClarify,
        handleCodeHint,
        handleBrainstorm
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const { handleWhatToSay, handleFollowUp, handleFollowUpQuestions, handleRecap, handleAnswerNow, handleClarify, handleCodeHint, handleBrainstorm } = handlersRef.current;

            // Chat Shortcuts (Scope: Local to Chat/Overlay usually, but we allow them here if focused)
            if (isShortcutPressed(e, 'whatToAnswer')) {
                e.preventDefault();
                handleWhatToSay();
            } else if (isShortcutPressed(e, 'clarify')) {
                e.preventDefault();
                handleClarify();
            } else if (isShortcutPressed(e, 'followUp')) {
                e.preventDefault();
                handleFollowUpQuestions();
            } else if (isShortcutPressed(e, 'dynamicAction4')) {
                e.preventDefault();
                if (actionButtonMode === 'brainstorm') {
                    handleBrainstorm();
                } else {
                    handleRecap();
                }
            } else if (isShortcutPressed(e, 'answer')) {
                e.preventDefault();
                handleAnswerNow();
            } else if (isShortcutPressed(e, 'clarify')) {
                e.preventDefault();
                handleClarify();
            } else if (isShortcutPressed(e, 'codeHint')) {
                e.preventDefault();
                handleCodeHint();
            } else if (isShortcutPressed(e, 'brainstorm')) {
                e.preventDefault();
                handleBrainstorm();
            } else if (isShortcutPressed(e, 'scrollUp')) {
                e.preventDefault();
                scrollContainerRef.current?.scrollBy({ top: -100, behavior: 'smooth' });
            } else if (isShortcutPressed(e, 'scrollDown')) {
                e.preventDefault();
                scrollContainerRef.current?.scrollBy({ top: 100, behavior: 'smooth' });
            } else if (isShortcutPressed(e, 'moveWindowUp') || isShortcutPressed(e, 'moveWindowDown')) {
                // Prevent default scrolling when moving window
                e.preventDefault();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isShortcutPressed]);

    // General Global Shortcuts (Rebindable)
    // We listen here to handle them when the window is focused (renderer side)
    // Global shortcuts (when window blurred) are handled by Main process -> GlobalShortcuts
    // But Main process events might not reach here if we don't listen, or we want unified handling.
    // Actually, KeybindManager registers global shortcuts. If they are registered as global, 
    // Electron might consume them before they reach here?
    // 'toggle-app' is Global.
    // 'toggle-visibility' is NOT Global in default config (isGlobal: false), so it depends on focus.
    // So we MUST listen for them here.

    const generalHandlersRef = useRef({
        toggleVisibility: () => window.electronAPI.toggleWindow(),
        processScreenshots: handleWhatToSay,
        resetCancel: async () => {
            if (isProcessing) {
                setIsProcessing(false);
            } else {
                await window.electronAPI.resetIntelligence();
                setMessages([]);
                setAttachedContext([]);
                setInputValue('');
            }
        },
        toggleMousePassthrough: () => {
            const newState = !isMousePassthrough;
            setIsMousePassthrough(newState);
            window.electronAPI?.setOverlayMousePassthrough?.(newState);
        },
        takeScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeScreenshot();
                if (data && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error("Error triggering screenshot:", err);
            }
        },
        selectiveScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeSelectiveScreenshot();
                if (data && !data.cancelled && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error("Error triggering selective screenshot:", err);
            }
        }
    });

    // Update ref
    generalHandlersRef.current = {
        toggleVisibility: () => window.electronAPI.toggleWindow(),
        processScreenshots: handleWhatToSay,
        resetCancel: async () => {
            if (isProcessing) {
                setIsProcessing(false);
            } else {
                await window.electronAPI.resetIntelligence();
                setMessages([]);
                setAttachedContext([]);
                setInputValue('');
            }
        },
        toggleMousePassthrough: () => {
            const newState = !isMousePassthrough;
            setIsMousePassthrough(newState);
            window.electronAPI?.setOverlayMousePassthrough?.(newState);
        },
        takeScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeScreenshot();
                if (data && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error("Error triggering screenshot:", err);
            }
        },
        selectiveScreenshot: async () => {
            try {
                const data = await window.electronAPI.takeSelectiveScreenshot();
                if (data && !data.cancelled && data.path) {
                    handleScreenshotAttach(data as { path: string; preview: string });
                }
            } catch (err) {
                console.error("Error triggering selective screenshot:", err);
            }
        }
    };

    useEffect(() => {
        const handleGeneralKeyDown = (e: KeyboardEvent) => {
            const handlers = generalHandlersRef.current;
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if (isShortcutPressed(e, 'toggleVisibility')) {
                // Always allow toggling visibility
                e.preventDefault();
                handlers.toggleVisibility();
            } else if (isShortcutPressed(e, 'processScreenshots')) {
                if (!isInput) {
                    e.preventDefault();
                    handlers.processScreenshots();
                }
                // If input focused, let default behavior (Enter) happen or handle it via onKeyDown in Input
            } else if (isShortcutPressed(e, 'resetCancel')) {
                e.preventDefault();
                handlers.resetCancel();
            } else if (isShortcutPressed(e, 'takeScreenshot')) {
                e.preventDefault();
                handlers.takeScreenshot();
            } else if (isShortcutPressed(e, 'selectiveScreenshot')) {
                e.preventDefault();
                handlers.selectiveScreenshot();
            } else if (isShortcutPressed(e, 'toggleMousePassthrough')) {
                e.preventDefault();
                handlers.toggleMousePassthrough();
            }
        };

        window.addEventListener('keydown', handleGeneralKeyDown);
        return () => window.removeEventListener('keydown', handleGeneralKeyDown);
    }, [isShortcutPressed]);

    // Global "Capture & Process" shortcut handler (issue #90)
    // Registered separately so it always has the latest handlersRef via stable ref access.
    // Main process takes the screenshot and sends "capture-and-process" with path+preview;
    // we attach the screenshot to context and immediately trigger AI analysis.
    useEffect(() => {
        if (!window.electronAPI.onCaptureAndProcess) return;
        const unsubscribe = window.electronAPI.onCaptureAndProcess((data) => {
            setIsExpanded(true);

            // Store screenshot in a stable ref BEFORE updating React state.
            // This fixes the React 18 concurrent mode timing race where setTimeout(0)
            // could fire before setAttachedContext had flushed, leaving handleWhatToSay
            // with an empty attachedContext and causing silent failures.
            pendingCaptureRef.current = data;

            setAttachedContext(prev => {
                if (prev.some(s => s.path === data.path)) return prev;
                return [...prev, data].slice(-5);
            });

            // Use requestAnimationFrame so we wait for at least one paint cycle —
            // more reliable than setTimeout(0) under React 18 concurrent scheduling.
            // The ref guarantees handleWhatToSay has the screenshot regardless of
            // whether the state update has flushed yet.
            requestAnimationFrame(() => {
                try {
                    handlersRef.current.handleWhatToSay();
                } finally {
                    pendingCaptureRef.current = null;
                }
            });
        });
        return unsubscribe;
    }, []);

    // Stealth Global Shortcuts Handler
    // Listens for shortcuts triggered when the app is in the background
    useEffect(() => {
        if (!window.electronAPI.onGlobalShortcut) return;
        const unsubscribe = window.electronAPI.onGlobalShortcut(({ action }) => {
            const handlers = handlersRef.current;
            const generalHandlers = generalHandlersRef.current;

            isStealthRef.current = true;

            if (action === 'whatToAnswer') handlers.handleWhatToSay();
            else if (action === 'shorten') handlers.handleFollowUp('shorten');
            else if (action === 'followUp') handlers.handleFollowUpQuestions();
            else if (action === 'recap') handlers.handleRecap();
            else if (action === 'dynamicAction4') {
                if (actionButtonMode === 'brainstorm') handlers.handleBrainstorm();
                else handlers.handleRecap();
            }
            else if (action === 'answer') handlers.handleAnswerNow();
            else if (action === 'clarify') handlers.handleClarify();
            else if (action === 'codeHint') handlers.handleCodeHint();
            else if (action === 'brainstorm') handlers.handleBrainstorm();
            else if (action === 'scrollUp') scrollContainerRef.current?.scrollBy({ top: -100, behavior: 'smooth' });
            else if (action === 'scrollDown') scrollContainerRef.current?.scrollBy({ top: 100, behavior: 'smooth' });
            else if (action === 'processScreenshots') generalHandlers.processScreenshots();
            else if (action === 'resetCancel') generalHandlers.resetCancel();
            else if (action === 'takeScreenshot') generalHandlers.takeScreenshot();
            else if (action === 'selectiveScreenshot') generalHandlers.selectiveScreenshot();
            
            // Safety reset if it didn't trigger an expansion
            setTimeout(() => { isStealthRef.current = false; }, 500);
        });
        return unsubscribe;
    }, []);

    // ── Derived STT status for the rolling transcript indicator (interviewer channel) ──
    const interviewerSttIndicatorStatus = sttInterviewerStatus;
    // Strip consecutive error count from display — show only in expanded diagnostics
    const interviewerSttIndicatorError = sttInterviewerError?.replace(/\s*\(\d+ consecutive errors\):?/gi, '');

    const copyDiagnostics = async () => {
        const version = import.meta.env.VITE_APP_VERSION || 'unknown';
        const [arch, osVersion] = await Promise.all([
            window.electronAPI?.getArch?.().catch(() => 'unknown'),
            window.electronAPI?.getOsVersion?.().catch(() => 'unknown'),
        ]);
        const { categorizeSttError } = await import('../lib/sttErrorMapper');
        const userCat = sttUserError ? categorizeSttError(sttUserError) : null;
        const interviewerCat = sttInterviewerError ? categorizeSttError(sttInterviewerError) : null;
        const report = [
            '## STT Diagnostic Report',
            `App Version: ${version}`,
            `Platform: ${osVersion} (${arch})`,
            `---`,
            `Microphone Provider: ${sttUserProvider}`,
            `Microphone Status: ${sttUserStatus}`,
            userCat ? `Microphone Category: ${userCat.title} [${userCat.category}]` : '',
            `Microphone Error: ${sttUserError || 'N/A'}`,
            `---`,
            `System Audio Provider: ${sttInterviewerProvider}`,
            `System Audio Status: ${sttInterviewerStatus}`,
            interviewerCat ? `System Audio Category: ${interviewerCat.title} [${interviewerCat.category}]` : '',
            `System Audio Error: ${sttInterviewerError || 'N/A'}`,
            `Timestamp: ${new Date().toISOString()}`,
        ].filter(Boolean).join('\n');
        try {
            await navigator.clipboard.writeText(report);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = report;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
    };

    return (
        <div ref={contentRef} className="flex flex-col items-center w-fit mx-auto h-fit min-h-0 bg-transparent p-0 rounded-[24px] font-sans gap-2 overlay-text-primary">

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.95 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="flex flex-col items-center gap-2 w-full"
                    >
                        <TopPill
                            expanded={isExpanded}
                            onToggle={() => setIsExpanded(!isExpanded)}
                            onQuit={() => onEndMeeting ? onEndMeeting() : window.electronAPI.quitApp()}
                            appearance={appearance}
                            onLogoClick={() => window.electronAPI?.setWindowMode?.('launcher')}
                            sysActive={isInterviewerSpeaking}
                            micActive={Boolean(livePartial && livePartial.speaker === 'user' && livePartial.text.trim()) || isManualRecording}
                            sttHealth={
                                sttUserStatus === 'failed' || sttInterviewerStatus === 'failed'
                                    ? 'failed'
                                    : sttUserStatus === 'reconnecting' || sttInterviewerStatus === 'reconnecting'
                                        ? 'reconnecting'
                                        : 'connected'
                            }
                        />
                        <div
                            className={`relative w-[600px] max-w-full backdrop-blur-2xl border rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface console-enter console-enter-d1 ${overlayPanelClass}`}
                            style={appearance.shellStyle}
                        >
                            {/* Audio tape — vertical channel indicator on the left edge.
                                A bead glows phosphor where you're talking, ivory where the
                                source is talking, fading out when both are quiet. Pure
                                visual chrome — pointer-events: none. */}
                            <div className="console-tape" aria-hidden>
                                <span
                                    className={`console-tape-bead is-them ${isInterviewerSpeaking ? 'is-active' : ''}`}
                                    style={{ top: '38%' }}
                                />
                                <span
                                    className={`console-tape-bead is-you ${
                                        (livePartial && livePartial.speaker === 'user' && livePartial.text.trim()) || isManualRecording
                                            ? 'is-active'
                                            : ''
                                    }`}
                                    style={{ top: '62%' }}
                                />
                            </div>

                            {/* System Audio Permission Warning Banner */}
                            {systemAudioWarning && (
                                <div className="console-banner console-banner-warn mx-4 mt-3 mb-1 no-drag relative group/warning">
                                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                                        <span className="console-label" style={{ color: '#E8B546' }}>
                                            Screen Recording · Permission Denied
                                        </span>
                                        <p className="text-[11.5px] console-ink-soft leading-snug">
                                            {systemAudioWarning}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                            onClick={() => { window.electronAPI.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'); }}
                                            className="console-key"
                                        >
                                            Open Settings
                                            <span className="console-key-glyph">↗</span>
                                        </button>
                                        <button
                                            onClick={() => setSystemAudioWarning(null)}
                                            className="p-1 rounded-full opacity-50 hover:opacity-100 console-ink-soft transition-opacity"
                                            title="Dismiss"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* PR #173: STT Not Configured Warning Banner */}
                            {sttNotConfigured && (
                                <div className="console-banner console-banner-error mx-4 mt-3 mb-1 no-drag relative group/stt-warning">
                                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                                        <span className="console-label" style={{ color: '#FF6B6B' }}>
                                            Transcription · Not Configured
                                        </span>
                                        <p className="text-[11.5px] console-ink-soft leading-snug">
                                            No STT provider selected. Open Settings → Audio to pick one.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                            onClick={() => { window.electronAPI?.toggleSettingsWindow?.(); }}
                                            className="console-key"
                                        >
                                            Open Settings
                                            <span className="console-key-glyph">↗</span>
                                        </button>
                                        <button
                                            onClick={() => setSttNotConfigured(false)}
                                            className="p-1 rounded-full opacity-50 hover:opacity-100 console-ink-soft transition-opacity"
                                            title="Dismiss"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Live two-speaker conversation log — shows both your speech and theirs */}
                            {showTranscript && (
                                <LiveConversationPanel
                                    turns={conversationTurns}
                                    livePartial={livePartial}
                                    isLightTheme={isLightTheme}
                                />
                            )}

                            {/* Rolling Transcript Bar — includes STT status indicator inline */}
                            {(showTranscript && rollingTranscript) || interviewerSttIndicatorStatus !== 'connected' || sttUserStatus !== 'connected' ? (
                                <RollingTranscript
                                    text={showTranscript ? rollingTranscript : ''}
                                    isActive={isInterviewerSpeaking}
                                    surfaceStyle={showTranscript ? appearance.transcriptStyle : undefined}
                                    interviewerChannel={{
                                        status: interviewerSttIndicatorStatus,
                                        error: interviewerSttIndicatorError,
                                        provider: sttInterviewerProvider,
                                    }}
                                    microphoneChannel={{
                                        status: sttUserStatus,
                                        error: sttUserError,
                                        provider: sttUserProvider,
                                    }}
                                    onCopyDiagnostics={copyDiagnostics}
                                />
                            ) : null}

                            {/* Chat History — editorial column */}
                            {(messages.length > 0 || isManualRecording || isProcessing) && (
                                <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 max-h-[clamp(300px,35vh,450px)] no-drag console-log">
                                    {messages.map((msg) => (
                                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
                                            <div className={`
                                                relative group whitespace-pre-wrap text-[14px] leading-[1.55]
                                                ${msg.role === 'user'
                                                    ? 'max-w-[78%] console-you-rule pr-3 console-ink text-right'
                                                    : msg.role === 'system'
                                                        ? 'max-w-[92%] console-ink'
                                                        : 'max-w-[88%] console-them-rule pl-3 console-them-color console-serif italic text-[14px]'
                                                }
                                            `}>
                                                {msg.role === 'user' && (
                                                    <div className="console-label console-you-soft mb-1 text-right">
                                                        You {msg.hasScreenshot && <span className="ml-2 inline-flex items-center gap-1"><Image className="w-2.5 h-2.5 inline" /> screenshot</span>}
                                                    </div>
                                                )}
                                                {msg.role === 'system' && (
                                                    <div className="flex items-center gap-2 mb-1.5">
                                                        <span className="console-label console-ink-soft">Natively</span>
                                                        {msg.isStreaming && (
                                                            <span className="console-pulse-dot is-pulsing" style={{ width: 4, height: 4 }} />
                                                        )}
                                                    </div>
                                                )}
                                                {msg.role === 'interviewer' && (
                                                    <div className="console-label console-them-soft mb-1">
                                                        Them
                                                        {msg.isStreaming && (
                                                            <span className="console-caret console-caret-them ml-2" />
                                                        )}
                                                    </div>
                                                )}
                                                {msg.role === 'system' && !msg.isStreaming && (
                                                    <button
                                                        onClick={() => handleCopy(msg.text)}
                                                        className="absolute top-0 right-0 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity console-ink-soft hover:console-ink hover:bg-[var(--console-key-bg-hover)]"
                                                        title="Copy to clipboard"
                                                    >
                                                        <Copy className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                                {renderMessageText(msg)}
                                            </div>
                                        </div>
                                    ))}

                                    {/* Active Recording — phosphor live transcription */}
                                    {isManualRecording && (
                                        <div className="flex flex-col items-end gap-1.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                            {(manualTranscript || voiceInput) && (
                                                <div className="max-w-[82%] console-you-rule pr-3 console-ink text-[13.5px] leading-[1.55] text-right">
                                                    <div className="console-label console-you-soft mb-1">You · Live</div>
                                                    {voiceInput}{voiceInput && manualTranscript ? ' ' : ''}{manualTranscript}
                                                    <span className="console-caret" aria-hidden />
                                                </div>
                                            )}
                                            {!manualTranscript && !voiceInput && (
                                                <div className="flex gap-1 items-center">
                                                    <span className="console-label console-you-soft">Listening</span>
                                                    <span className="console-pulse-dot is-pulsing" style={{ width: 4, height: 4 }} />
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Hide the "Composing" dots whenever a streaming system bubble
                                        already exists — the bubble's own pulse-dot in the header is
                                        the live signal, and stacking dots below adds noise. This
                                        covers both the buy-time filler and the streaming answer that
                                        replaces it. */}
                                    {isProcessing && !messages.some(m => m.isStreaming) && (
                                        <div className="flex justify-start items-center gap-2">
                                            <span className="console-label console-ink-dim">Composing</span>
                                            <div className="px-1 py-1 flex gap-1">
                                                <div className="w-1 h-1 bg-[var(--console-ink-soft)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                                                <div className="w-1 h-1 bg-[var(--console-ink-soft)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                                                <div className="w-1 h-1 bg-[var(--console-ink-soft)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                                            </div>
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>
                            )}

                            {/* Action ledger — typographic shortcut keys */}
                            <div className={`px-5 ${rollingTranscript && showTranscript ? 'pt-2' : 'pt-3'} pb-3`}>
                                <div className="console-rule mb-2.5" />
                                <div className="flex flex-wrap justify-center items-center gap-1.5">
                                    <button onClick={handleWhatToSay} className="console-key no-drag">
                                        What to answer
                                        <span className="console-key-glyph">⌘1</span>
                                    </button>
                                    <button onClick={handleClarify} className="console-key no-drag">
                                        Clarify
                                        <span className="console-key-glyph">⌘2</span>
                                    </button>
                                    <button
                                        onClick={actionButtonMode === 'brainstorm' ? handleBrainstorm : handleRecap}
                                        className="console-key no-drag"
                                    >
                                        {actionButtonMode === 'brainstorm' ? 'Brainstorm' : 'Recap'}
                                        <span className="console-key-glyph">⌘3</span>
                                    </button>
                                    <button onClick={handleFollowUpQuestions} className="console-key no-drag">
                                        Follow up
                                        <span className="console-key-glyph">⌘4</span>
                                    </button>
                                    <button
                                        onClick={handleAnswerNow}
                                        className={`console-key no-drag ${isManualRecording ? 'is-recording' : ''}`}
                                        style={
                                            isManualRecording
                                                ? {
                                                    color: '#FF6B6B',
                                                    borderColor: 'rgba(255,107,107,0.35)',
                                                    background: 'rgba(255,107,107,0.06)',
                                                }
                                                : undefined
                                        }
                                    >
                                        {isManualRecording ? (
                                            <>
                                                <span
                                                    className="inline-block w-1.5 h-1.5 rounded-full"
                                                    style={{
                                                        background: '#FF6B6B',
                                                        boxShadow: '0 0 6px rgba(255,107,107,0.6)',
                                                    }}
                                                />
                                                Stop
                                            </>
                                        ) : (
                                            <>Answer</>
                                        )}
                                        <span className="console-key-glyph">⌘5</span>
                                    </button>
                                </div>
                            </div>

                            {/* Input Area */}
                            <div className="px-5 pt-0 pb-4">
                                {/* Latent Context Preview (Attached Screenshot) */}
                                {attachedContext.length > 0 && (
                                    <div className="mb-3 no-drag flex items-center gap-3">
                                        <span className="console-label console-ink-soft">
                                            {attachedContext.length} screenshot{attachedContext.length > 1 ? 's' : ''} attached
                                        </span>
                                        <div className="flex gap-1 overflow-x-auto max-w-full">
                                            {attachedContext.map((ctx, idx) => (
                                                <div key={ctx.path} className="relative group/thumb flex-shrink-0">
                                                    <img
                                                        src={ctx.preview}
                                                        alt={`Screenshot ${idx + 1}`}
                                                        className="h-9 w-auto border border-[var(--console-rule-strong)]"
                                                    />
                                                    <button
                                                        onClick={() => setAttachedContext(prev => prev.filter((_, i) => i !== idx))}
                                                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                                                        title="Remove"
                                                    >
                                                        <X className="w-2.5 h-2.5 text-white" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => setAttachedContext([])}
                                            className="ml-auto p-1 console-ink-dim hover:console-ink transition-colors"
                                            title="Remove all"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                )}

                                {/* Editorial input — bottom-rule field */}
                                <div className="relative no-drag">
                                    <input
                                        ref={textInputRef}
                                        type="text"
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                                        className="console-input"
                                    />

                                    {/* Editorial placeholder — italic with mono shortcut chips */}
                                    {!inputValue && (
                                        <div className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-2 pointer-events-none">
                                            <span className="console-serif italic text-[13px] console-ink-dim">
                                                Ask anything…
                                            </span>
                                            <span className="console-label console-ink-dim">or</span>
                                            <span className="flex items-center gap-1">
                                                {(shortcuts.selectiveScreenshot || ['⌘', 'Shift', 'H']).map((key, i) => (
                                                    <React.Fragment key={i}>
                                                        {i > 0 && <span className="console-mono text-[9px] console-ink-dim">+</span>}
                                                        <kbd className="console-mono text-[9.5px] console-ink-soft px-1 py-px border border-[var(--console-rule)] rounded-sm">
                                                            {key}
                                                        </kbd>
                                                    </React.Fragment>
                                                ))}
                                            </span>
                                            <span className="console-label console-ink-dim">selective shot</span>
                                        </div>
                                    )}

                                    {/* Send arrow — phosphor halo when ready */}
                                    <button
                                        onClick={handleManualSubmit}
                                        disabled={!inputValue.trim()}
                                        className={`absolute right-0 top-1/2 -translate-y-1/2 console-send no-drag interaction-base interaction-press ${inputValue.trim() ? 'is-ready' : ''}`}
                                        title="Send"
                                    >
                                        <ArrowRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>

                                {/* Bottom Row — model · settings · passthrough */}
                                <div className="flex items-center justify-between mt-4">
                                    <div className="flex items-center gap-2 no-drag">
                                        <button
                                            onClick={(e) => {
                                                if (!contentRef.current) return;
                                                const contentRect = contentRef.current.getBoundingClientRect();
                                                const buttonRect = e.currentTarget.getBoundingClientRect();
                                                const GAP = 8;
                                                const x = window.screenX + buttonRect.left;
                                                const y = window.screenY + contentRect.bottom + GAP;
                                                window.electronAPI.toggleModelSelector({ x, y });
                                            }}
                                            className="console-chip"
                                            title="Switch model"
                                        >
                                            <span className="truncate max-w-[150px]">
                                                {(() => {
                                                    const m = currentModel;
                                                    if (m.startsWith('ollama-')) return m.replace('ollama-', '');
                                                    if (m === 'gemini-3.1-flash-lite-preview') return 'Gemini 3.1 Flash';
                                                    if (m === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
                                                    if (m === 'llama-3.3-70b-versatile') return 'Groq Llama 3.3';
                                                    if (m === 'gpt-5.4') return 'GPT 5.4';
                                                    if (m === 'claude-sonnet-4-6') return 'Sonnet 4.6';
                                                    return m;
                                                })()}
                                            </span>
                                            <ChevronDown size={11} className="shrink-0 opacity-60" />
                                        </button>

                                        <span className="w-px h-3 bg-[var(--console-rule)]" aria-hidden />

                                        <button
                                            onClick={(e) => {
                                                if (isSettingsOpen) {
                                                    window.electronAPI.toggleSettingsWindow();
                                                    return;
                                                }
                                                if (!contentRef.current) return;
                                                const contentRect = contentRef.current.getBoundingClientRect();
                                                const buttonRect = e.currentTarget.getBoundingClientRect();
                                                const GAP = 8;
                                                const x = window.screenX + buttonRect.left;
                                                const y = window.screenY + contentRect.bottom + GAP;
                                                window.electronAPI.toggleSettingsWindow({ x, y });
                                            }}
                                            className={`w-6 h-6 flex items-center justify-center rounded-md interaction-base interaction-press ${
                                                isSettingsOpen ? 'console-ink' : 'console-ink-soft hover:console-ink'
                                            } hover:bg-[var(--console-key-bg-hover)]`}
                                            title="Settings"
                                        >
                                            <SlidersHorizontal className="w-3.5 h-3.5" />
                                        </button>

                                        <button
                                            onClick={() => {
                                                const newState = !isMousePassthrough;
                                                setIsMousePassthrough(newState);
                                                window.electronAPI?.setOverlayMousePassthrough?.(newState);
                                            }}
                                            className={`w-6 h-6 flex items-center justify-center rounded-md interaction-base interaction-press ${
                                                isMousePassthrough
                                                    ? 'text-sky-400'
                                                    : 'console-ink-soft hover:console-ink'
                                            } hover:bg-[var(--console-key-bg-hover)]`}
                                            title="Click-through"
                                        >
                                            <PointerOff className="w-3.5 h-3.5" />
                                        </button>
                                    </div>

                                    {/* Right side: meta line — small mono caption */}
                                    <span className="console-label console-ink-dim no-drag select-none">
                                        ⌘1 – ⌘5 · Shortcuts
                                    </span>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default NativelyInterface;
