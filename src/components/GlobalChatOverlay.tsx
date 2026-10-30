import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStreamBuffer } from '../hooks/useStreamBuffer';
import { X, Copy, Check, Globe, ArrowUp } from 'lucide-react';
import { DiagramAwareMarkdown } from './diagram/DiagramAwareMarkdown';
import { motion, AnimatePresence } from 'framer-motion';
import { genMessageId } from '../utils/messageId';
import { NativelyWordmark } from './NativelyWordmark';
// .lg-bubble.lg-bubble-lavender (your questions) and the send button's
// .lg-button material; .mn-ask-send's own rules are in index.css.
import '../ui-components/LiquidGlassButton.css';
import { LiquidGlassButton } from '../ui-components/LiquidGlassButton';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { stripGistTrailer, splitGistLineStreaming } from '../lib/displayMarkup';
import { renderChatMarkdown } from './chatMarkdown';
import { copyText } from '../lib/copyText';

// ============================================
// Types
// ============================================

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isStreaming?: boolean;
}

interface GlobalChatOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    initialQuery?: string;
}

// ============================================
// Typing Indicator Component
// ============================================

const TypingIndicator: React.FC = () => (
    <div className="flex items-center gap-1 py-4">
        <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
                <motion.div
                    key={i}
                    className="w-2 h-2 rounded-full bg-text-tertiary"
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        delay: i * 0.15,
                        ease: "easeInOut"
                    }}
                />
            ))}
        </div>
    </div>
);

// ============================================
// Message Components
// ============================================

const UserMessage: React.FC<{ content: string }> = ({ content }) => (
    <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="flex justify-end mb-6"
    >
        {/* The Usage tab's question card, as in the meeting chat
            (MeetingChatOverlay.tsx): lavender Liquid Glass, 19px padding,
            corners 19/5.5/19/19, semibold. Owner request, 2026-10-30: this
            search gets the same changes as the meeting one. */}
        <div className="lg-bubble lg-bubble-lavender px-[19px] py-[9px] rounded-[19px] rounded-tr-[5.5px] max-w-[80%] text-[15px] font-semibold leading-relaxed select-text">
            {content}
        </div>
    </motion.div>
);

const AssistantMessage: React.FC<{ content: string; isStreaming?: boolean; isLatest?: boolean }> = ({ content, isStreaming, isLatest }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await copyText(stripGistTrailer(content));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-start mb-6"
        >
            <div className="text-text-primary text-[15px] leading-relaxed max-w-[85%]">
                {/* Rendered as the meeting chat renders its answers (renderChatMarkdown,
                    chatMarkdown.tsx): this chat showed plain text, so **bold** and
                    "* " bullets came through as raw asterisks and paragraph breaks
                    were lost. Owner, 2026-10-30: "the response structure is so bad
                    for both". A ```mermaid block is still drawn by the shared
                    diagram card. The [[GIST]] marker line is split off unshown, as
                    the meeting chat does; Copy already strips it. */}
                <div className="markdown-content">
                    <DiagramAwareMarkdown
                        text={splitGistLineStreaming(content).body}
                        streaming={Boolean(isStreaming)}
                        // Only the answer just given may be repaired by itself (one model
                        // call); an older answer in the thread keeps its "Try to fix" button.
                        allowAutoRepair={Boolean(isLatest)}
                        renderMarkdown={renderChatMarkdown}
                    />
                </div>
            </div>
            {!isStreaming && content && (
                <button
                    onClick={handleCopy}
                    className="flex items-center gap-2 mt-3 text-[13px] text-text-tertiary hover:text-text-secondary transition-colors"
                >
                    {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy message'}
                </button>
            )}
        </motion.div>
    );
};

// ============================================
// Main Component
// ============================================

type ChatState = 'idle' | 'waiting_for_llm' | 'streaming_response' | 'error';

// Hard client-side ceiling on the ragQueryGlobal IPC round-trip. The main
// process has its own internal timeouts (worker deadman switch, stream
// stall guard), but every one of those protects a DIFFERENT stage of the
// pipeline — if the hang happens somewhere NONE of them cover (e.g. the
// main thread itself blocked inside a synchronous native call before any
// of those timers can even be scheduled), the `await` on this invoke() has
// no ceiling of its own and can wait forever with the UI showing nothing.
// This is the backstop: no matter what breaks on the other side of the IPC
// boundary, the user gets an answer (even if it's "something went wrong")
// within a bounded time instead of a silently frozen chat bubble.
const RAG_QUERY_CLIENT_TIMEOUT_MS = 20000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${ms}ms — the main process never responded`));
        }, ms);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); },
        );
    });
}

const GlobalChatOverlay: React.FC<GlobalChatOverlayProps> = ({
    isOpen,
    onClose,
    initialQuery = '',
}) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [chatState, setChatState] = useState<ChatState>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const streamBuffer = useStreamBuffer();
    // Match the meeting chat overlay / modes manager --mm-bg exactly so
    // the expanded card looks like the same dark grey surface.
    const isLightTheme = useResolvedTheme() === 'light';
    const chatWindowBg = isLightTheme ? '#f9f9f9' : '#111111';

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<HTMLDivElement>(null);
    // Synchronous busy guard for submitQuestion. `chatState` alone isn't
    // enough: it's React state, so two calls fired in quick succession (e.g.
    // repeated Enter presses on the footer input) can both read it before a
    // re-render lands, both pass the guard, and both register their own
    // onRAGStreamChunk/onRAGStreamComplete listeners against the ONE shared
    // streamBuffer — each call's `streamBuffer.reset()` then clobbers
    // whatever the other call had already buffered, so the eventual
    // completion can render empty. A ref updates immediately, no batching.
    const submitInFlightRef = useRef(false);

    // Submit initial query when overlay opens
    useEffect(() => {
        if (isOpen && initialQuery && messages.length === 0) {
            setTimeout(() => {
                submitQuestion(initialQuery);
            }, 100);
        }
    }, [isOpen, initialQuery]);

    // Listen for new queries from parent
    useEffect(() => {
        if (isOpen && initialQuery && messages.length > 0) {
            // This is a follow-up query
            submitQuestion(initialQuery);
        }
    }, [initialQuery]);

    // ESC key handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // Click outside handler
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    }, [onClose]);

    const handleInputKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && query.trim()) {
            e.preventDefault();
            submitQuestion(query);
            setQuery('');
        }
    };

    // Submit question using global RAG
    const submitQuestion = useCallback(async (question: string) => {
        if (!question.trim() || submitInFlightRef.current) return;
        submitInFlightRef.current = true;

        const userMessage: Message = {
            id: genMessageId(),
            role: 'user',
            content: question
        };
        setMessages(prev => [...prev, userMessage]);
        setChatState('waiting_for_llm');
        setErrorMessage(null);

        // Scroll to bottom when user sends message
        setTimeout(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        const assistantMessageId = genMessageId();

        // Track active listener cleanups so the finally block can always
        // remove them — even if the IPC done/error events never arrive.
        // Without this, a hung stream leaves `chatState` stuck at
        // 'waiting_for_llm' / 'streaming_response' and the guard at the
        // top of submitQuestion silently drops every subsequent message
        // (no user-message push, no response).
        let activeCleanups: Array<() => void> = [];

        try {
            // Add typing indicator delay (200ms) - makes the AI feel "thoughtful"
            await new Promise(resolve => setTimeout(resolve, 200));

            // Create assistant message placeholder
            setMessages(prev => [...prev, {
                id: assistantMessageId,
                role: 'assistant',
                content: '',
                isStreaming: true
            }]);

            // Set up RAG streaming listeners (RAF-batched)
            streamBuffer.reset();
            // F-122: the rag:stream-* channels are SHARED by three scopes and
            // main tags every payload ({meetingId} | {live:true} | {global:true}),
            // but no consumer read the tag — so a meeting-scoped or live-scoped
            // stream could paint into this overlay's bubble. GlobalChatOverlay and
            // MeetingDetails are siblings in the same Launcher renderer, and
            // abortPriorRAGQueriesOfClass only supersedes WITHIN a class, so two
            // different-class queries can genuinely be in flight together.
            const isGlobal = (d: any) => d?.global === true;
            const tokenCleanup = window.electronAPI?.onRAGStreamChunk((data: { chunk: string }) => {
                if (!isGlobal(data)) return;
                setChatState('streaming_response');
                streamBuffer.appendToken(data.chunk, (content) => {
                    setMessages(prev => prev.map(msg =>
                        msg.id === assistantMessageId
                            ? { ...msg, content }
                            : msg
                    ));
                });
            });

            const doneCleanup = window.electronAPI?.onRAGStreamComplete((data?: any) => {
                if (data && !isGlobal(data)) return;   // F-122
                // The stream can legitimately complete with zero chunks (e.g. a
                // short non-question like "hi" fed through the strict RAG-grounding
                // prompt can make the model return an empty/degenerate completion).
                // Without this fallback, the bubble renders as nothing — no text,
                // no error — which reads as "the app didn't respond at all".
                const finalContent = streamBuffer.getBufferedContent().trim()
                    || "I'm not sure how to answer that from your meetings — try asking a more specific question.";
                setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                        ? { ...msg, content: finalContent, isStreaming: false }
                        : msg
                ));
                setChatState('idle');
                streamBuffer.reset();
                tokenCleanup?.();
                doneCleanup?.();
                errorCleanup?.();
            });

            const errorCleanup = window.electronAPI?.onRAGStreamError((data: { error: string }) => {
                if (!isGlobal(data)) return;   // F-122
                console.error('[GlobalChat] RAG stream error:', data.error);
                setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
                setErrorMessage("Couldn't get a response. Please try again.");
                setChatState('error');
                streamBuffer.reset();
                tokenCleanup?.();
                doneCleanup?.();
                errorCleanup?.();
            });

            if (tokenCleanup) activeCleanups.push(tokenCleanup);
            if (doneCleanup) activeCleanups.push(doneCleanup);
            if (errorCleanup) activeCleanups.push(errorCleanup);

            // Use global RAG query. Wrapped in a hard client-side ceiling — see
            // RAG_QUERY_CLIENT_TIMEOUT_MS above for why this exists: nothing
            // upstream of this call can guarantee the invoke() ever resolves.
            let result: { fallback?: boolean; success?: boolean; error?: string } | undefined;
            try {
                const call = window.electronAPI?.ragQueryGlobal(question);
                result = call
                    ? await withTimeout(call, RAG_QUERY_CLIENT_TIMEOUT_MS, 'ragQueryGlobal')
                    : undefined;
            } catch (timeoutErr) {
                console.error('[GlobalChat] ragQueryGlobal client-side timeout:', timeoutErr);
                // Tear down the RAG listeners we just registered — the main
                // process may still respond well after this point (its own
                // internal timeouts run on a longer clock), and a late
                // rag:stream-chunk/-complete/-error must not land on a message
                // this function has already abandoned.
                tokenCleanup?.();
                doneCleanup?.();
                errorCleanup?.();
                activeCleanups = [];
                setMessages(prev => prev.map(msg =>
                    msg.id === assistantMessageId
                        ? { ...msg, content: "This is taking longer than expected. Please try again.", isStreaming: false }
                        : msg
                ));
                setChatState('error');
                setErrorMessage("The search took too long to respond. Please try again.");
                return;
            }

            // If electronAPI is unavailable or IPC failed, result will be undefined.
            // Treat this as a fallback case to ensure the user gets SOME response.
            if (!result || result.fallback) {
                console.log("[GlobalChat] RAG unavailable, falling back to standard chat");
                // Cleanup RAG listeners
                tokenCleanup?.();
                doneCleanup?.();
                errorCleanup?.();
                activeCleanups = [];

                // Setup fallback listeners (Standard Gemini)
                streamBuffer.reset();
                // Stream-id guard (2026-07-31): these fallback listeners used to
                // ignore the streamId meta entirely, so tokens from an ABANDONED
                // earlier stream (client timeout below leaves main streaming)
                // landed in the next request's bubble. Adopt the first tagged id
                // seen after registration; drop anything older.
                let adoptedStreamId: number | null = null;
                const acceptsMeta = (meta?: { streamId?: number }) => {
                    const id = meta?.streamId;
                    if (typeof id !== 'number') return true;      // legacy untagged
                    if (adoptedStreamId === null || id > adoptedStreamId) { adoptedStreamId = id; return true; }
                    return id === adoptedStreamId;
                };
                const oldTokenCleanup = window.electronAPI?.onGeminiStreamToken((token: string, meta?: { streamId?: number }) => {
                    if (!acceptsMeta(meta)) return;
                    setChatState('streaming_response');
                    streamBuffer.appendToken(token, (content) => {
                        setMessages(prev => prev.map(msg =>
                            msg.id === assistantMessageId
                                ? { ...msg, content }
                                : msg
                        ));
                    });
                });

                const oldDoneCleanup = window.electronAPI?.onGeminiStreamDone((payload?: { streamId?: number }) => {
                    if (!acceptsMeta(payload)) return;
                    // Same empty-completion guard as the RAG path above.
                    const finalContent = streamBuffer.getBufferedContent().trim()
                        || "I'm not sure how to answer that — try rephrasing your question.";
                    setMessages(prev => prev.map(msg =>
                        msg.id === assistantMessageId
                            ? { ...msg, content: finalContent, isStreaming: false }
                            : msg
                    ));
                    setChatState('idle');
                    streamBuffer.reset();
                    oldTokenCleanup?.();
                    oldDoneCleanup?.();
                    oldErrorCleanup?.();
                });

                const oldErrorCleanup = window.electronAPI?.onGeminiStreamError((error: string, meta?: { streamId?: number | null; source?: string }) => {
                    if (meta?.source === 'phone-mirror') return;
                    if (typeof meta?.streamId === 'number' && adoptedStreamId !== null && meta.streamId !== adoptedStreamId) return;
                    console.error('[GlobalChat] Gemini stream error:', error);
                    setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
                    setErrorMessage("Couldn't get a response. Please check your settings.");
                    setChatState('error');
                    streamBuffer.reset();
                    oldTokenCleanup?.();
                    oldDoneCleanup?.();
                    oldErrorCleanup?.();
                });

                if (oldTokenCleanup) activeCleanups.push(oldTokenCleanup);
                if (oldDoneCleanup) activeCleanups.push(oldDoneCleanup);
                if (oldErrorCleanup) activeCleanups.push(oldErrorCleanup);

                // Call standard chat — same client-side ceiling as ragQueryGlobal above.
                const fallbackCall = window.electronAPI?.streamGeminiChat(question, undefined, undefined, { skipSystemPrompt: false });
                if (fallbackCall) {
                    try {
                        await withTimeout(fallbackCall, RAG_QUERY_CLIENT_TIMEOUT_MS, 'streamGeminiChat');
                    } catch (timeoutErr) {
                        console.error('[GlobalChat] streamGeminiChat client-side timeout:', timeoutErr);
                        // Abandoning without cancelling left main streaming into
                        // listeners the NEXT submit registers.
                        try { (window.electronAPI as any)?.cancelChatStream?.(); } catch { /* best-effort */ }
                        oldTokenCleanup?.();
                        oldDoneCleanup?.();
                        oldErrorCleanup?.();
                        activeCleanups = [];
                        setMessages(prev => prev.map(msg =>
                            msg.id === assistantMessageId
                                ? { ...msg, content: "This is taking longer than expected. Please try again.", isStreaming: false }
                                : msg
                        ));
                        setChatState('error');
                        setErrorMessage("The request took too long to respond. Please try again.");
                    }
                }
            }

        } catch (error) {
            console.error('[GlobalChat] Error:', error);
            setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
            setErrorMessage("Something went wrong. Please try again.");
            setChatState('error');
        } finally {
            // Always remove listeners and reset chatState — even if the
            // IPC done/error callbacks never fired. Without this, a single
            // hung stream leaves chatState stuck and silently drops every
            // subsequent submitQuestion (no user-message push, no response).
            activeCleanups.forEach(fn => fn());
            activeCleanups = [];
            setChatState(prev => (prev === 'error' ? prev : 'idle'));
            streamBuffer.reset();
            submitInFlightRef.current = false;
        }
    }, []);

    return (
        <AnimatePresence
            onExitComplete={() => {
                setChatState('idle');
                setMessages([]);
                setErrorMessage(null);
            }}
        >
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    className="fixed inset-0 z-[300] flex flex-col justify-end"
                    onClick={handleBackdropClick}
                >
                    {/* Backdrop — dims only; the parent's opacity fade brings it in */}
                    <div className={`absolute inset-0 ${isLightTheme ? 'bg-black/[0.06]' : 'bg-black/40'}`} />

                    {/* Chat Window */}
                    <motion.div
                        ref={chatWindowRef}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "85vh", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                            height: { type: "spring", stiffness: 300, damping: 30, mass: 0.8 },
                            opacity: { duration: 0.2 }
                        }}
                        className={`relative mx-auto w-full max-w-[680px] mb-0 rounded-t-[24px] border-t border-x border-border-subtle ${isLightTheme ? 'shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_-20px_48px_-12px_rgba(0,0,0,0.16)]' : 'shadow-2xl'} overflow-hidden flex flex-col`}
                        style={{ backgroundColor: chatWindowBg }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* The meeting chat's header (MeetingChatOverlay.tsx): the natively
                            wordmark alone at 20px in place of the app icon and "Search all
                            meetings", starting on the messages' 24px column, the X's glyph
                            ending on it, no divider. */}
                        <div className="flex items-center justify-between pl-6 pr-3 pt-4 pb-1 shrink-0">
                            <div className="flex items-center text-text-secondary">
                                <NativelyWordmark height={20} className="block shrink-0" />
                            </div>
                            <button
                                onClick={onClose}
                                className="p-2 transition-colors group"
                            >
                                <X size={16} className="text-text-tertiary group-hover:text-red-500 group-hover:drop-shadow-[0_0_8px_rgba(239,68,68,0.5)] transition-all duration-300" />
                            </button>
                        </div>

                        {/* Messages area - scrollable */}
                        <div className="flex-1 overflow-y-auto px-6 py-4 pb-32 custom-scrollbar">
                            {messages.map((msg) => (
                                msg.role === 'user'
                                    ? <UserMessage key={msg.id} content={msg.content} />
                                    : <AssistantMessage key={msg.id} content={msg.content} isStreaming={msg.isStreaming} isLatest={msg.id === messages[messages.length - 1]?.id} />
                            ))}

                            {chatState === 'waiting_for_llm' && <TypingIndicator />}

                            {errorMessage && (
                                <motion.div
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="text-[#FF6B6B] text-[13px] py-2"
                                >
                                    {errorMessage}
                                </motion.div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        {/* Floating Footer (Ask Bar) */}
                        <div className="absolute bottom-0 left-0 right-0 p-6 flex justify-center z-50 pointer-events-none">
                            <div className="w-full max-w-[440px] relative group pointer-events-auto">
                                {/* Dark Glass Effect Input. outline-none at rest, not only on
                                    focus, and no transition-all: with both, clicking in animated
                                    the outline from the text colour (white in dark) to transparent,
                                    a white ring flashing round the pill. Owner: remove it. */}
                                <input
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    onKeyDown={handleInputKeyDown}
                                    placeholder="Ask me anything..."
                                    className="w-full h-12 pl-5 pr-14 bg-bg-elevated shadow-[0_8px_30px_rgb(0,0,0,0.12)] border border-border-muted rounded-full text-sm text-text-primary placeholder-text-tertiary/70 outline-none"
                                />
                                {/* The meeting notes' send (MeetingDetails.tsx): 36px in the
                                    48px bar at a 6px inset, grey and disabled while the box is
                                    empty, the website's lavender glass once something is typed.
                                    Material, states and motion are .mn-ask-send (index.css). The
                                    span holds the position, since .lg-button sets its own. */}
                                <span className="absolute top-[6px] right-[6px] flex">
                                    <LiquidGlassButton
                                        variant="lavender"
                                        onClick={() => {
                                            if (query.trim()) {
                                                submitQuestion(query);
                                                setQuery('');
                                            }
                                        }}
                                        disabled={!query.trim()}
                                        aria-label="Send"
                                        className="lg-sm lg-lav-tinted mn-ask-send"
                                        style={{ '--lg-pill-h': '36px' } as React.CSSProperties}
                                    >
                                        <ArrowUp size={18} strokeWidth={2.5} className="rotate-45" />
                                    </LiquidGlassButton>
                                </span>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default GlobalChatOverlay;
