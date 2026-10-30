import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStreamBuffer } from '../hooks/useStreamBuffer';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { genMessageId } from '../utils/messageId';
import { NativelyWordmark } from './NativelyWordmark';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { splitGistLineStreaming } from '../lib/displayMarkup';
// .lg-bubble.lg-bubble-lavender (your questions), imported here so the chat
// does not depend on MeetingDetails having loaded the stylesheet first.
import '../ui-components/LiquidGlassButton.css';

import { DiagramAwareMarkdown } from './diagram/DiagramAwareMarkdown';
import { renderChatMarkdown } from './chatMarkdown';


// ============================================
// Types 
// ============================================

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    isStreaming?: boolean;
}

interface MeetingContext {
    id?: string;  // Required for RAG queries
    title: string;
    summary?: string;
    keyPoints?: string[];
    actionItems?: string[];
    transcript?: Array<{ speaker: string; text: string; timestamp: number }>;
}

interface MeetingChatOverlayProps {
    isOpen: boolean;
    onClose: () => void;
    meetingContext: MeetingContext;
    initialQuery?: string;
    onNewQuery: (query: string) => void;
}

type ChatState = 'idle' | 'opening' | 'waiting_for_llm' | 'streaming_response' | 'error' | 'closing';

// ============================================
// Typing Indicator Component
// ============================================

const TypingIndicator: React.FC = () => {
    return (
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
};

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
        {/* The Usage tab's question card, exactly (MeetingDetails.tsx): the
            website's lavender Liquid Glass (.lg-bubble.lg-bubble-lavender,
            ui-components) and its shape, 19px padding, corners 19/5.5/19/19,
            semibold label. Owner request: the same colour and shape as the
            Usage tab's question card. */}
        <div className="lg-bubble lg-bubble-lavender px-[19px] py-[9px] rounded-[19px] rounded-tr-[5.5px] max-w-[80%] text-[15px] font-semibold leading-relaxed select-text">
            {content}
        </div>
    </motion.div>
);

const AssistantMessage: React.FC<{ content: string; isStreaming?: boolean; isLatest?: boolean }> = ({ content, isStreaming, isLatest }) => {
    // Teleprompter gist: answers can end with a [[GIST]] line. The marker line
    // is still split off so it never shows as text, but this chat does not
    // render it — no gist chip here, and no copy button, by owner request.
    const { body: gistBody } = splitGistLineStreaming(content);

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="flex flex-col items-start mb-6"
        >
            <div className="text-text-primary text-[15px] leading-relaxed max-w-[85%]">
                {/* Markdown Content with tight line height and spacing */}
                <div className="markdown-content">
                    {/* A ```mermaid block is drawn by the shared diagram card; everything
                        else goes through renderChatMarkdown (chatMarkdown.tsx), shared with
                        the search-all-meetings chat. */}
                    <DiagramAwareMarkdown
                      text={gistBody}
                      streaming={Boolean(isStreaming)}
                      // Only the answer just given may be repaired by itself (one model
                      // call); an older answer in the thread keeps its "Try to fix" button.
                      allowAutoRepair={Boolean(isLatest)}
                      renderMarkdown={renderChatMarkdown}
                    />
                </div>
            </div>
        </motion.div>
    );
};

// ============================================
// Main Component
// ============================================

const MeetingChatOverlay: React.FC<MeetingChatOverlayProps> = ({
    isOpen,
    onClose,
    meetingContext,
    initialQuery = '',
    // onNewQuery
}) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [chatState, setChatState] = useState<ChatState>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const streamBuffer = useStreamBuffer();
    // Match the modes manager's `--mm-bg` exactly so the expanded chat
    // card looks like the same dark grey surface.
    const isLightTheme = useResolvedTheme() === 'light';
    const chatWindowBg = isLightTheme ? '#f9f9f9' : '#111111';

    // Submit initial query when overlay opens
    useEffect(() => {
        if (isOpen && initialQuery && messages.length === 0) {
            setChatState('opening');
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

    // Reset state when overlay closes
    useEffect(() => {
        if (!isOpen) {
            setChatState('idle');
            setMessages([]);
            setErrorMessage(null);
        }
    }, [isOpen]);

    // ESC key handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                handleClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen]);

    // Click outside handler
    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

    // A click outside the card closes the chat, as a click on the dim behind
    // Settings and the Modes Manager does. The dim is a child that covers this
    // whole layer, so an outside click lands on IT: checking only for the layer
    // itself (as this used to) never fired, and the chat could not be dismissed
    // by clicking away. The card and the ask bar sit above the dim, so clicks
    // on them never reach it.
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget || (e.target as HTMLElement).dataset?.chatScrim !== undefined) {
            handleClose();
        }
    }, [handleClose]);

    // Build context string for LLM
    const buildContextString = useCallback((): string => {
        const parts: string[] = [];

        parts.push(`MEETING: ${meetingContext.title}`);

        if (meetingContext.summary) {
            parts.push(`\nSUMMARY:\n${meetingContext.summary}`);
        }

        if (meetingContext.keyPoints?.length) {
            parts.push(`\nKEY POINTS:\n${meetingContext.keyPoints.map(p => `- ${p}`).join('\n')}`);
        }

        if (meetingContext.actionItems?.length) {
            parts.push(`\nACTION ITEMS:\n${meetingContext.actionItems.map(a => `- ${a}`).join('\n')}`);
        }

        if (meetingContext.transcript?.length) {
            const recentTranscript = meetingContext.transcript.slice(-20);
            const transcriptText = recentTranscript
                .map(t => `[${t.speaker === 'user' ? 'Me' : 'Them'}]: ${t.text}`)
                .join('\n');
            parts.push(`\nRECENT TRANSCRIPT:\n${transcriptText}`);
        }

        return parts.join('\n');
    }, [meetingContext]);

    // Submit question using RAG streaming
    const submitQuestion = useCallback(async (question: string) => {
        if (!question.trim() || chatState === 'waiting_for_llm' || chatState === 'streaming_response') return;

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

            // Set up RAG streaming listeners (RAF-batched to avoid per-token re-renders)
            streamBuffer.reset();
            // F-122: see GlobalChatOverlay — the rag:stream-* channels are shared
            // by three scopes and main tags every payload, but no consumer read
            // the tag. Accept only this meeting's stream.
            const isThisMeeting = (d: any) =>
                d?.global !== true && d?.live !== true
                && (d?.meetingId == null || d.meetingId === meetingContext?.id);
            const tokenCleanup = window.electronAPI?.onRAGStreamChunk((data: { chunk: string }) => {
                if (!isThisMeeting(data)) return;
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
                if (data && !isThisMeeting(data)) return;   // F-122
                // Final commit — flush any remaining buffered content
                const finalContent = streamBuffer.getBufferedContent();
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
                if (!isThisMeeting(data)) return;   // F-122
                console.error('[MeetingChat] RAG stream error:', data.error);
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

            // Get meeting ID from context for RAG queries
            const meetingId = meetingContext.id;

            if (meetingId) {
                // Use RAG-powered meeting query
                const result = await window.electronAPI?.ragQueryMeeting(meetingId, question);

                // If RAG not available (or failed), fall back to context-window chat
                if (result?.fallback) {
                    console.log("[MeetingChat] RAG unavailable, using context window fallback");
                    // Cleanup RAG listeners since we won't use them
                    tokenCleanup?.();
                    doneCleanup?.();
                    errorCleanup?.();
                    activeCleanups = [];

                    // FALLBACK LOGIC
                    const contextString = buildContextString();
                    const systemPrompt = `You are recalling a specific meeting. Answer questions ONLY about this meeting. Be concise (2-4 sentences). Sound natural, like a human recalling. If information is not present, say so briefly. Never guess.

${contextString}`;

                    streamBuffer.reset();
                    // Stream-id guard (2026-07-31) — see GlobalChatOverlay: drop
                    // tokens/done/error belonging to an older abandoned stream.
                    let adoptedStreamId: number | null = null;
                    const acceptsMeta = (meta?: { streamId?: number }) => {
                        const id = meta?.streamId;
                        if (typeof id !== 'number') return true;
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
                        const finalContent = streamBuffer.getBufferedContent();
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
                        console.error('[MeetingChat] Gemini stream error (fallback):', error);
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

                    await window.electronAPI?.streamGeminiChat(
                        question,
                        undefined,
                        systemPrompt,
                        { skipSystemPrompt: true }
                    );
                }
            } else {
                // No meeting ID, standard fallback
                const contextString = buildContextString();
                const systemPrompt = `You are recalling a specific meeting. Answer questions ONLY about this meeting. Be concise (2-4 sentences). Sound natural, like a human recalling. If information is not present, say so briefly. Never guess.

${contextString}`;

                // Switch to Gemini streaming (RAF-batched)
                streamBuffer.reset();
                let adoptedStreamId: number | null = null;
                const acceptsMeta = (meta?: { streamId?: number }) => {
                    const id = meta?.streamId;
                    if (typeof id !== 'number') return true;
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
                    const finalContent = streamBuffer.getBufferedContent();
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
                    console.error('[MeetingChat] Gemini stream error:', error);
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

                await window.electronAPI?.streamGeminiChat(
                    question,
                    undefined,
                    systemPrompt,
                    { skipSystemPrompt: true }
                );
            }

        } catch (error) {
            console.error('[MeetingChat] Error:', error);
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
            // Preserve an explicit 'error' state if one was set; otherwise
            // fall back to 'idle' so the next submit can proceed.
            setChatState(prev => (prev === 'error' ? prev : 'idle'));
            streamBuffer.reset();
        }
    }, [chatState, buildContextString, meetingContext]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    key="meeting-chat-modal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    className="fixed inset-0 z-[300] flex flex-col justify-end"
                    onClick={handleBackdropClick}
                >
                    {/* Backdrop — dims only; the parent's opacity fade brings it in. The
                        same dim as Settings and the Modes Manager (GenieModal's
                        backdropClassName in SettingsOverlay / App): 6% in light, 60%
                        in dark, no blur. */}
                    <div data-chat-scrim="" className={`absolute inset-0 ${isLightTheme ? 'bg-black/[0.06]' : 'bg-black/60'}`} />

                    {/* Chat Window - extends to bottom, leaves room for input */}
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
                        {/* Header with close button. No divider under it, by owner request:
                            the messages run straight up to the title. Owner: the wordmark's
                            position "not good" at 16px in, short of the answers' 24px column
                            and tucked into the 24px corner. Now it starts on the messages'
                            column (pl-6 = their px-6), as far from the top as from the
                            side, and the X's glyph ends on the column's right edge (pr-3
                            plus the button's p-2 and the icon's own 4px inset = 24px). */}
                        <div className="flex items-center justify-between pl-6 pr-3 pt-4 pb-1 shrink-0">
                            {/* The natively wordmark, as the Usage tab heads its answers
                                (MeetingDetails.tsx), in place of the round app icon: owner
                                request, "use the new natively branding". currentColor, so
                                it takes text-secondary in both themes. The wordmark stands
                                alone: the "Search this meeting" label after it was removed,
                                owner request. Alone it is the sheet's title, so it is sized
                                as one: 20px, whose x-height (11.1px) reads like 20px text,
                                a step under the launcher's 27px page title and well over the
                                14px label heading the Usage tab's answers. */}
                            <div className="flex items-center text-text-secondary">
                                <NativelyWordmark height={20} className="block shrink-0" />
                            </div>
                            <button
                                onClick={handleClose}
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
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default MeetingChatOverlay;
