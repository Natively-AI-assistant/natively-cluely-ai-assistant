import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStreamBuffer } from '../hooks/useStreamBuffer';
import { X, Copy, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { genMessageId } from '../utils/messageId';
import { mapLanguageForPrism, isBlockCode } from '../utils/prismLanguage';
import { registerPrismLanguages } from '../utils/registerPrismLanguages';
import nativelyIcon from './icon.png';
import { useResolvedTheme } from '../hooks/useResolvedTheme';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

registerPrismLanguages();

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
    const isLightTheme = useResolvedTheme() === 'light';
    const isModernTheme = !!document.querySelector('[data-interface-theme="modern"]');
    const isGlassTheme = !!document.querySelector('[data-interface-theme="liquid-glass"]');
    const isWhiteDots = isModernTheme || isGlassTheme;
    const cardBgBorderClass = isLightTheme
        ? 'bg-emerald-500/10 backdrop-blur-md border border-emerald-500/20 text-emerald-900'
        : 'bg-emerald-600/20 backdrop-blur-md border border-emerald-500/30 text-emerald-100';

    return (
        <div className={`w-fit rounded-[20px] rounded-tl-[4px] px-[16.5px] py-[12.5px] ${cardBgBorderClass} my-2.5 flex items-center justify-center`}>
            <div className="flex items-center gap-1.5 py-0.5">
                {[0, 1, 2].map((i) => (
                    <motion.div
                        key={i}
                        className={`w-2 h-2 rounded-full ${isWhiteDots ? 'bg-white' : 'bg-emerald-400'}`}
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
        <div className="bg-accent-primary text-white px-5 py-3 rounded-2xl rounded-tr-md max-w-[70%] text-[15px] leading-relaxed">
            {content}
        </div>
    </motion.div>
);

const AssistantMessage: React.FC<{ content: string; isStreaming?: boolean }> = ({ content, isStreaming }) => {
    const [copied, setCopied] = useState(false);
    const isLightTheme = useResolvedTheme() === 'light';
    const cardBgBorderClass = isLightTheme
        ? 'bg-emerald-500/10 backdrop-blur-md border border-emerald-500/20 text-emerald-900'
        : 'bg-emerald-600/20 backdrop-blur-md border border-emerald-500/30 text-emerald-100';

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
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
            className="flex flex-col items-start mb-6 w-full"
        >
            <div className={`w-full max-w-[85%] rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5`}>
                {/* Minimal Copy Button (no AI response header) */}
                {!isStreaming && content && (
                    <div className="flex justify-end mb-2 select-none w-full">
                        <button
                            onClick={handleCopy}
                            className="flex items-center gap-1.5 text-[11px] text-text-tertiary hover:text-[#4ade80] transition-colors"
                        >
                            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                            {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                )}

                {/* Markdown Content with tight line height and spacing */}
                <div className="markdown-content">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false, errorColor: '#cc0000' }]]}
                        components={{
                            p: ({ node, ...props }: any) => <p className="mb-[6px] last:mb-0 leading-relaxed whitespace-pre-wrap text-[13.5px]" {...props} />,
                            a: ({ node, ...props }: any) => <a className="text-[#4ade80] hover:underline" {...props} />,
                            h1: ({ node, ...props }: any) => <h1 className="text-sm font-bold mt-2 mb-[4.5px] leading-relaxed uppercase tracking-wide" {...props} />,
                            h2: ({ node, ...props }: any) => <h2 className="text-xs font-bold mt-1.5 mb-[4.5px] leading-relaxed uppercase tracking-wide" {...props} />,
                            h3: ({ node, ...props }: any) => <h3 className="text-xs font-semibold mt-1.5 mb-[4.5px] leading-relaxed" {...props} />,
                            ul: ({ node, ...props }: any) => <ul className="list-disc pl-4 mt-[4.5px] mb-[4.5px] space-y-0 leading-relaxed text-[13.5px]" {...props} />,
                            ol: ({ node, ...props }: any) => <ol className="list-decimal pl-4 mt-[4.5px] mb-[4.5px] space-y-0 leading-relaxed text-[13.5px]" {...props} />,
                            li: ({ node, ...props }: any) => <li className="pl-1 mb-[4.5px] last:mb-0 leading-relaxed text-[13.5px]" {...props} />,
                            pre: ({ children }: any) => <div className="not-prose mb-3 mt-1.5">{children}</div>,
                            code: ({ node, className, children, ...props }: any) => {
                                const match = /language-([\w+#-]+)/.exec(className || '');
                                const isBlock = isBlockCode(className, String(children));
                                const lang = match ? match[1] : '';
                                const resolved = mapLanguageForPrism(lang, String(children));

                                return isBlock ? (
                                    <div className="my-2 rounded-xl overflow-hidden border border-white/[0.08] shadow-lg bg-zinc-800/60 backdrop-blur-md">
                                        <div className="bg-white/[0.04] px-3 py-1 border-b border-white/[0.08]">
                                            <span className="text-[9px] uppercase tracking-widest font-semibold text-white/40 font-mono">
                                                {resolved || 'CODE'}
                                            </span>
                                        </div>
                                        <div className="bg-transparent">
                                            <SyntaxHighlighter
                                                language={resolved}
                                                style={vscDarkPlus}
                                                customStyle={{
                                                    margin: 0,
                                                    borderRadius: 0,
                                                    fontSize: '12px',
                                                    lineHeight: '1.45',
                                                    background: 'transparent',
                                                    padding: '12px',
                                                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
                                                }}
                                                wrapLongLines={true}
                                                showLineNumbers={true}
                                                lineNumberStyle={{ minWidth: '2.5em', paddingRight: '1.2em', color: 'rgba(255,255,255,0.2)', textAlign: 'right', fontSize: '10px' }}
                                                {...props}
                                            >
                                                {String(children).replace(/\n$/, '')}
                                            </SyntaxHighlighter>
                                        </div>
                                    </div>
                                ) : (
                                    <code className="bg-bg-tertiary px-1.5 py-0.5 rounded text-[12px] font-mono text-text-primary border border-border-subtle whitespace-pre-wrap" {...props}>
                                        {children}
                                    </code>
                                );
                            },
                        }}
                    >
                        {content}
                    </ReactMarkdown>
                    {isStreaming && (
                        <motion.span
                            className="inline-block w-0.5 h-3.5 bg-[#fbbf24] ml-1 align-middle"
                            animate={{ opacity: [1, 0] }}
                            transition={{ duration: 0.5, repeat: Infinity }}
                        />
                    )}
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
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            handleClose();
        }
    }, []);

    const handleClose = useCallback(() => {
        onClose();
    }, [onClose]);

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
            const tokenCleanup = window.electronAPI?.onRAGStreamChunk((data: { chunk: string }) => {
                setChatState('streaming_response');
                streamBuffer.appendToken(data.chunk, (content) => {
                    setMessages(prev => prev.map(msg =>
                        msg.id === assistantMessageId
                            ? { ...msg, content }
                            : msg
                    ));
                });
            });

            const doneCleanup = window.electronAPI?.onRAGStreamComplete(() => {
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
                console.error('[MeetingChat] RAG stream error:', data.error);
                setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
                setErrorMessage("Couldn't get a response. Please try again.");
                setChatState('error');
                streamBuffer.reset();
                tokenCleanup?.();
                doneCleanup?.();
                errorCleanup?.();
            });

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

                    // FALLBACK LOGIC
                    const contextString = buildContextString();
                    const systemPrompt = `You are recalling a specific meeting. Answer questions ONLY about this meeting. Be concise (2-4 sentences). Sound natural, like a human recalling. If information is not present, say so briefly. Never guess.

${contextString}`;

                    streamBuffer.reset();
                    const oldTokenCleanup = window.electronAPI?.onGeminiStreamToken((token: string) => {
                        setChatState('streaming_response');
                        streamBuffer.appendToken(token, (content) => {
                            setMessages(prev => prev.map(msg =>
                                msg.id === assistantMessageId
                                    ? { ...msg, content }
                                    : msg
                            ));
                        });
                    });

                    const oldDoneCleanup = window.electronAPI?.onGeminiStreamDone(() => {
                        const finalContent = streamBuffer.getBufferedContent();
                        setMessages(prev => prev.map(msg =>
                            msg.id === assistantMessageId
                                ? { ...msg, content: finalContent, isStreaming: false }
                                : msg
                        ));
                        streamBuffer.reset();
                        oldTokenCleanup?.();
                        oldDoneCleanup?.();
                        oldErrorCleanup?.();
                    });

                    const oldErrorCleanup = window.electronAPI?.onGeminiStreamError((error: string) => {
                        console.error('[MeetingChat] Gemini stream error (fallback):', error);
                        setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
                        setErrorMessage("Couldn't get a response. Please check your settings.");
                        setChatState('error');
                        streamBuffer.reset();
                        oldTokenCleanup?.();
                        oldDoneCleanup?.();
                        oldErrorCleanup?.();
                    });

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
                const oldTokenCleanup = window.electronAPI?.onGeminiStreamToken((token: string) => {
                    setChatState('streaming_response');
                    streamBuffer.appendToken(token, (content) => {
                        setMessages(prev => prev.map(msg =>
                            msg.id === assistantMessageId
                                ? { ...msg, content }
                                : msg
                        ));
                    });
                });

                const oldDoneCleanup = window.electronAPI?.onGeminiStreamDone(() => {
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

                const oldErrorCleanup = window.electronAPI?.onGeminiStreamError((error: string) => {
                    console.error('[MeetingChat] Gemini stream error:', error);
                    setMessages(prev => prev.filter(msg => msg.id !== assistantMessageId));
                    setErrorMessage("Couldn't get a response. Please check your settings.");
                    setChatState('error');
                    streamBuffer.reset();
                    oldTokenCleanup?.();
                    oldDoneCleanup?.();
                    oldErrorCleanup?.();
                });

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
                    className="absolute inset-0 z-40 flex flex-col justify-end"
                    onClick={handleBackdropClick}
                >
                    {/* Backdrop with blur */}
                    <motion.div
                        initial={{ backdropFilter: 'blur(0px)' }}
                        animate={{ backdropFilter: 'blur(8px)' }}
                        exit={{ backdropFilter: 'blur(0px)' }}
                        transition={{ duration: 0.16 }}
                        className="absolute inset-0 bg-black/40"
                    />

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
                        className="relative mx-auto w-full max-w-[680px] mb-0 bg-bg-secondary rounded-t-[24px] border-t border-x border-border-subtle shadow-2xl overflow-hidden flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header with close button */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle shrink-0">
                            <div className="flex items-center gap-2 text-text-tertiary">
                                <img src={nativelyIcon} className="w-3.5 h-3.5 force-black-icon opacity-50" alt="logo" />
                                <span className="text-[13px] font-medium">Search this meeting</span>
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
                                    : <AssistantMessage key={msg.id} content={msg.content} isStreaming={msg.isStreaming} />
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
