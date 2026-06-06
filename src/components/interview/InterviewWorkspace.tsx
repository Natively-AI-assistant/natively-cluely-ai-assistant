import React from 'react';
import {
    ArrowRight,
    ChevronDown,
    Copy,
    HelpCircle,
    Image,
    Lightbulb,
    MessageSquare,
    Pencil,
    PointerOff,
    RefreshCw,
    SlidersHorizontal,
    X,
    Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import type { ShortcutConfig } from '../../hooks/useShortcuts';

export interface WorkspaceMessage {
    id: string;
    role: 'user' | 'system' | 'interviewer';
    text: string;
    isStreaming?: boolean;
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

export interface WorkspaceTranscriptTurn {
    id: string;
    text: string;
    final: boolean;
    timestamp: number;
}

export interface WorkspaceAttachment {
    path: string;
    preview: string;
}

interface MessageRowProps {
    msg: WorkspaceMessage;
    isLightTheme: boolean;
    appearance: any;
    onCopy: (text: string) => void;
    renderMessageText: (msg: WorkspaceMessage) => React.ReactNode;
}

const MessageRow = React.memo(function MessageRow({
    msg,
    isLightTheme,
    appearance,
    onCopy,
    renderMessageText,
}: MessageRowProps) {
    const isCodeMsg = msg.role === 'system' && (msg.isCode || msg.text.includes('```'));
    const isSystem = msg.role === 'system';
    const bubbleMaxClass = msg.role === 'user'
        ? 'max-w-[78%] px-3.5 py-2.5'
        : isSystem
            ? 'max-w-full px-0 py-0'
            : 'max-w-[92%] px-0 py-0';

    return (
        <div className="w-full" {...(isCodeMsg ? { 'data-code-msg': 'true' } : {})}>
            <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in-up`}>
                <div className={`
                    ${bubbleMaxClass} relative group whitespace-pre-wrap
                    ${msg.role === 'user'
                        ? (isLightTheme
                            ? 'bg-blue-500/10 backdrop-blur-md border border-blue-500/20 text-blue-900 rounded-[18px] rounded-tr-[4px] shadow-sm font-medium text-[13px] leading-relaxed'
                            : 'bg-blue-600/20 backdrop-blur-md border border-blue-500/30 text-blue-100 rounded-[18px] rounded-tr-[4px] shadow-sm font-medium text-[13px] leading-relaxed')
                        : ''
                    }
                    ${isSystem ? 'overlay-text-primary font-normal text-[16px] leading-[1.62]' : ''}
                    ${msg.role === 'interviewer' ? 'overlay-text-muted italic text-[13px] leading-relaxed' : ''}
                `}>
                    {msg.role === 'interviewer' && (
                        <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium uppercase tracking-wider overlay-text-muted">
                            Interviewer
                            {msg.isStreaming && <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />}
                        </div>
                    )}
                    {msg.role === 'user' && msg.hasScreenshot && (
                        <div className={`flex items-center gap-1 text-[10px] opacity-70 mb-1 border-b pb-1 ${isLightTheme ? 'border-black/10' : 'border-white/10'}`}>
                            <Image className="w-2.5 h-2.5" />
                            <span>Screenshot attached</span>
                        </div>
                    )}
                    {isSystem && !msg.isStreaming && msg.text && (
                        <button
                            onClick={() => onCopy(msg.text)}
                            className="absolute top-0 right-0 p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                            title="Copy to clipboard"
                            style={appearance.iconStyle}
                        >
                            <Copy className="w-3.5 h-3.5" />
                        </button>
                    )}
                    {renderMessageText(msg)}
                </div>
            </div>
        </div>
    );
}, (prev, next) =>
    prev.msg === next.msg &&
    prev.isLightTheme === next.isLightTheme &&
    prev.appearance === next.appearance &&
    prev.renderMessageText === next.renderMessageText &&
    prev.onCopy === next.onCopy
);

interface AnswerPanelProps {
    messages: WorkspaceMessage[];
    latestQuestion: WorkspaceTranscriptTurn | null;
    isManualRecording: boolean;
    manualTranscript: string;
    voiceInput: string;
    isProcessing: boolean;
    isLightTheme: boolean;
    appearance: any;
    scrollContainerRef: React.RefObject<HTMLDivElement>;
    messagesEndRef: React.RefObject<HTMLDivElement>;
    renderMessageText: (msg: WorkspaceMessage) => React.ReactNode;
    onCopy: (text: string) => void;
}

export const AnswerPanel = React.memo(function AnswerPanel({
    messages,
    latestQuestion,
    isManualRecording,
    manualTranscript,
    voiceInput,
    isProcessing,
    isLightTheme,
    appearance,
    scrollContainerRef,
    messagesEndRef,
    renderMessageText,
    onCopy,
}: AnswerPanelProps) {
    const hasContent = messages.length > 0 || isManualRecording || isProcessing;

    return (
        <section className="interview-answer-panel min-w-0 flex flex-col no-drag">
            <div className="px-5 pt-4 pb-3 border-b" style={{ borderColor: 'var(--overlay-border-soft)' }}>
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] overlay-text-muted">
                            Question context
                        </p>
                        <p className="mt-1 truncate text-[13px] leading-relaxed overlay-text-secondary">
                            {latestQuestion?.text || 'Listening for the interviewer...'}
                        </p>
                    </div>
                    {latestQuestion && !latestQuestion.final && (
                        <span className="shrink-0 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-400">
                            Live
                        </span>
                    )}
                </div>
            </div>

            <motion.div
                ref={scrollContainerRef}
                className="interview-answer-scroll flex-1 overflow-y-auto px-5 py-4 space-y-4"
                style={{ scrollbarWidth: 'none' }}
            >
                {!hasContent && (
                    <div className="flex min-h-[260px] items-center justify-center text-center">
                        <div className="max-w-[420px]">
                            <p className="text-[18px] font-semibold overlay-text-primary">Ready for the next question</p>
                            <p className="mt-2 text-[13px] leading-relaxed overlay-text-muted">
                                The answer will stay here, large enough to read while you talk.
                            </p>
                        </div>
                    </div>
                )}

                {messages.map((msg) => (
                    <MessageRow
                        key={msg.id}
                        msg={msg}
                        isLightTheme={isLightTheme}
                        appearance={appearance}
                        onCopy={onCopy}
                        renderMessageText={renderMessageText}
                    />
                ))}

                {isManualRecording && (
                    <div className="flex flex-col items-end gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {(manualTranscript || voiceInput) && (
                            <div className="max-w-[78%] px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-[18px] rounded-tr-[4px]">
                                <span className="text-[13px] text-emerald-300">
                                    {voiceInput}{voiceInput && manualTranscript ? ' ' : ''}{manualTranscript}
                                </span>
                            </div>
                        )}
                        <div className="px-3 py-2 flex gap-1.5 items-center">
                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            <span className="text-[10px] text-emerald-400/70 ml-1">Listening...</span>
                        </div>
                    </div>
                )}

                {isProcessing && (
                    <div className="flex justify-start">
                        <div className="px-3 py-2 flex gap-1.5">
                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </motion.div>
        </section>
    );
});

interface QuestionRailProps {
    turns: WorkspaceTranscriptTurn[];
    isInterviewerSpeaking: boolean;
    isLightTheme: boolean;
}

export const QuestionRail = React.memo(function QuestionRail({
    turns,
    isInterviewerSpeaking,
    isLightTheme,
}: QuestionRailProps) {
    return (
        <aside className="interview-question-rail min-w-0 no-drag">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 pb-3 pt-4 backdrop-blur-md" style={{ background: 'var(--overlay-panel-bg)' }}>
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] overlay-text-muted">Interviewer</span>
                {isInterviewerSpeaking && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
            </div>
            <div className="space-y-2 px-3 pb-4">
                {turns.length === 0 ? (
                    <div className={`rounded-lg border px-3 py-3 ${isLightTheme ? 'border-black/10 bg-white/35' : 'border-white/10 bg-white/[0.035]'}`}>
                        <p className="text-[12px] leading-relaxed overlay-text-muted">Interviewer transcript will appear here.</p>
                    </div>
                ) : turns.map((turn) => (
                    <div
                        key={turn.id}
                        className={`rounded-lg border px-3 py-2.5 transition-colors ${turn.final
                            ? (isLightTheme ? 'border-black/10 bg-white/40' : 'border-white/10 bg-white/[0.045]')
                            : 'border-emerald-500/20 bg-emerald-500/10'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className={`text-[9px] uppercase tracking-wider ${turn.final ? 'overlay-text-muted' : 'text-emerald-400'}`}>
                                {turn.final ? 'Final' : 'Interim'}
                            </span>
                            <time className="text-[9px] overlay-text-muted">
                                {new Date(turn.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                            </time>
                        </div>
                        <p className={`text-[12px] leading-snug ${turn.final ? 'overlay-text-primary' : 'text-emerald-300'}`}>
                            {turn.text}
                        </p>
                    </div>
                ))}
            </div>
        </aside>
    );
});

interface OverlayCommandBarProps {
    actionButtonMode: 'recap' | 'brainstorm';
    attachedContext: WorkspaceAttachment[];
    appearance: any;
    contentRef: React.RefObject<HTMLDivElement>;
    controlSurfaceClass: string;
    currentModel: string;
    handleAnswerNow: () => void;
    handleBrainstorm: () => void;
    handleClarify: () => void;
    handleFollowUpQuestions: () => void;
    handleManualSubmit: () => void;
    handleRecap: () => void;
    handleWhatToSay: () => void;
    inputClass: string;
    inputValue: string;
    isLightTheme: boolean;
    isManualRecording: boolean;
    isMousePassthrough: boolean;
    isSettingsOpen: boolean;
    quickActionClass: string;
    setAttachedContext: React.Dispatch<React.SetStateAction<WorkspaceAttachment[]>>;
    setInputValue: React.Dispatch<React.SetStateAction<string>>;
    setIsMousePassthrough: React.Dispatch<React.SetStateAction<boolean>>;
    shortcuts: ShortcutConfig;
    subtleSurfaceClass: string;
    textInputRef: React.RefObject<HTMLInputElement>;
}

const formatModelName = (model: string) => {
    if (model.startsWith('ollama-')) return model.replace('ollama-', '');
    if (model === 'gemini-3.1-flash-lite-preview') return 'Gemini 3.1 Flash';
    if (model === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
    if (model === 'llama-3.3-70b-versatile') return 'Groq Llama 3.3';
    if (model === 'gpt-5.4') return 'GPT 5.4';
    if (model === 'claude-sonnet-4-6') return 'Sonnet 4.6';
    return model;
};

export const OverlayCommandBar = React.memo(function OverlayCommandBar({
    actionButtonMode,
    attachedContext,
    appearance,
    contentRef,
    controlSurfaceClass,
    currentModel,
    handleAnswerNow,
    handleBrainstorm,
    handleClarify,
    handleFollowUpQuestions,
    handleManualSubmit,
    handleRecap,
    handleWhatToSay,
    inputClass,
    inputValue,
    isLightTheme,
    isManualRecording,
    isMousePassthrough,
    isSettingsOpen,
    quickActionClass,
    setAttachedContext,
    setInputValue,
    setIsMousePassthrough,
    shortcuts,
    subtleSurfaceClass,
    textInputRef,
}: OverlayCommandBarProps) {
    const openModelSelector = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (!contentRef.current) return;
        const contentRect = contentRef.current.getBoundingClientRect();
        const buttonRect = e.currentTarget.getBoundingClientRect();
        const gap = 8;
        window.electronAPI.toggleModelSelector({
            x: window.screenX + buttonRect.left,
            y: window.screenY + contentRect.bottom + gap,
        });
    };

    const toggleSettings = (e: React.MouseEvent<HTMLButtonElement>) => {
        if (isSettingsOpen) {
            window.electronAPI.toggleSettingsWindow();
            return;
        }
        if (!contentRef.current) return;
        const contentRect = contentRef.current.getBoundingClientRect();
        const buttonRect = e.currentTarget.getBoundingClientRect();
        const gap = 8;
        window.electronAPI.toggleSettingsWindow({
            x: window.screenX + buttonRect.left,
            y: window.screenY + contentRect.bottom + gap,
        });
    };

    return (
        <footer className="interview-command-bar no-drag">
            {attachedContext.length > 0 && (
                <div className={`mb-2 rounded-lg p-2 transition-all duration-200 border ${subtleSurfaceClass}`} style={appearance.subtleStyle}>
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[11px] font-medium overlay-text-primary">
                            {attachedContext.length} screenshot{attachedContext.length > 1 ? 's' : ''} attached
                        </span>
                        <button
                            onClick={() => setAttachedContext([])}
                            className="p-1 rounded-full transition-colors overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive"
                            title="Remove all"
                            style={appearance.iconStyle}
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                    <div className="flex gap-1.5 overflow-x-auto max-w-full pb-1">
                        {attachedContext.map((ctx, idx) => (
                            <div key={ctx.path} className="relative group/thumb flex-shrink-0">
                                <img
                                    src={ctx.preview}
                                    alt={`Screenshot ${idx + 1}`}
                                    className={`h-10 w-auto rounded border ${isLightTheme ? 'border-black/15' : 'border-white/20'}`}
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
                    <span className="text-[10px] overlay-text-muted">Ask a question or click Answer</span>
                </div>
            )}

            <div className="interview-quick-actions">
                <button onClick={handleWhatToSay} className={`interview-action-chip ${quickActionClass}`} style={appearance.chipStyle}>
                    <Pencil className="w-3 h-3 opacity-70" /> What to answer?
                </button>
                <button onClick={handleClarify} className={`interview-action-chip ${quickActionClass}`} style={appearance.chipStyle}>
                    <MessageSquare className="w-3 h-3 opacity-70" /> Clarify
                </button>
                <button onClick={actionButtonMode === 'brainstorm' ? handleBrainstorm : handleRecap} className={`interview-action-chip ${quickActionClass}`} style={appearance.chipStyle}>
                    {actionButtonMode === 'brainstorm'
                        ? <><Lightbulb className="w-3 h-3 opacity-70" /> Brainstorm</>
                        : <><RefreshCw className="w-3 h-3 opacity-70" /> Recap</>
                    }
                </button>
                <button onClick={handleFollowUpQuestions} className={`interview-action-chip ${quickActionClass}`} style={appearance.chipStyle}>
                    <HelpCircle className="w-3 h-3 opacity-70" /> Follow Up
                </button>
                <button
                    onClick={handleAnswerNow}
                    className={`interview-action-chip justify-center min-w-[74px] ${isManualRecording
                        ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                        : 'overlay-chip-surface overlay-text-interactive hover:text-emerald-500 hover:bg-emerald-500/10'
                    }`}
                    style={isManualRecording ? undefined : appearance.chipStyle}
                >
                    {isManualRecording ? (
                        <>
                            <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                            Stop
                        </>
                    ) : (
                        <><Zap className="w-3 h-3 opacity-70" /> Answer</>
                    )}
                </button>
            </div>

            <div className="interview-input-row">
                <button
                    onClick={openModelSelector}
                    className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors text-xs font-medium w-[148px] interaction-base interaction-press ${controlSurfaceClass}`}
                    style={appearance.controlStyle}
                >
                    <span className="truncate min-w-0 flex-1">{formatModelName(currentModel)}</span>
                    <ChevronDown size={14} className="shrink-0 transition-transform" />
                </button>

                <div className="relative min-w-0 flex-1 group">
                    <input
                        ref={textInputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                        className={`w-full border focus:ring-1 rounded-xl pl-3 pr-10 py-2.5 focus:outline-none transition-all duration-200 ease-sculpted text-[13px] leading-relaxed ${inputClass}`}
                        style={appearance.inputStyle}
                    />
                    {!inputValue && (
                        <div className="absolute left-3 right-10 top-1/2 -translate-y-1/2 flex min-w-0 items-center gap-1.5 pointer-events-none text-[13px] overlay-text-muted">
                            <span className="truncate">Ask anything on screen or conversation</span>
                            <div className="hidden lg:flex items-center gap-1 opacity-80 shrink-0">
                                {(shortcuts.selectiveScreenshot || ['⌘', 'Shift', 'H']).map((key, i) => (
                                    <React.Fragment key={i}>
                                        {i > 0 && <span className="text-[10px]">+</span>}
                                        <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center overlay-control-surface overlay-text-secondary" style={appearance.controlStyle}>{key}</kbd>
                                    </React.Fragment>
                                ))}
                            </div>
                        </div>
                    )}
                    {!inputValue && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none opacity-20">
                            <span className="text-[10px]">↵</span>
                        </div>
                    )}
                </div>

                <button
                    onClick={toggleSettings}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg interaction-base interaction-press ${isSettingsOpen
                        ? 'overlay-icon-surface overlay-icon-surface-hover overlay-text-primary'
                        : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'
                    }`}
                    style={appearance.iconStyle}
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
                    className={`w-8 h-8 flex items-center justify-center rounded-lg interaction-base interaction-press ${isMousePassthrough
                        ? 'overlay-icon-surface overlay-icon-surface-hover text-sky-400 opacity-100'
                        : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'
                    }`}
                    style={appearance.iconStyle}
                    title="Mouse passthrough"
                >
                    <PointerOff className="w-3.5 h-3.5" />
                </button>

                <button
                    onClick={handleManualSubmit}
                    disabled={!inputValue.trim()}
                    className={`w-8 h-8 rounded-full flex items-center justify-center interaction-base interaction-press ${inputValue.trim()
                        ? 'bg-[#007AFF] text-white shadow-lg shadow-blue-500/20 hover:bg-[#0071E3]'
                        : 'overlay-icon-surface overlay-text-muted cursor-not-allowed'
                    }`}
                    style={inputValue.trim() ? undefined : appearance.iconStyle}
                    title="Send"
                >
                    <ArrowRight className="w-3.5 h-3.5" />
                </button>
            </div>
        </footer>
    );
});

interface InterviewWorkspaceProps {
    actionButtonMode: 'recap' | 'brainstorm';
    appearance: any;
    attachedContext: WorkspaceAttachment[];
    contentRef: React.RefObject<HTMLDivElement>;
    controlSurfaceClass: string;
    currentModel: string;
    handleAnswerNow: () => void;
    handleBrainstorm: () => void;
    handleClarify: () => void;
    handleFollowUpQuestions: () => void;
    handleManualSubmit: () => void;
    handleRecap: () => void;
    handleWhatToSay: () => void;
    inputClass: string;
    inputValue: string;
    isInterviewerSpeaking: boolean;
    isLightTheme: boolean;
    isManualRecording: boolean;
    isMousePassthrough: boolean;
    isProcessing: boolean;
    isSettingsOpen: boolean;
    manualTranscript: string;
    messages: WorkspaceMessage[];
    messagesEndRef: React.RefObject<HTMLDivElement>;
    onCopy: (text: string) => void;
    quickActionClass: string;
    renderMessageText: (msg: WorkspaceMessage) => React.ReactNode;
    scrollContainerRef: React.RefObject<HTMLDivElement>;
    setAttachedContext: React.Dispatch<React.SetStateAction<WorkspaceAttachment[]>>;
    setInputValue: React.Dispatch<React.SetStateAction<string>>;
    setIsMousePassthrough: React.Dispatch<React.SetStateAction<boolean>>;
    shortcuts: ShortcutConfig;
    subtleSurfaceClass: string;
    textInputRef: React.RefObject<HTMLInputElement>;
    turns: WorkspaceTranscriptTurn[];
    voiceInput: string;
}

const InterviewWorkspace = React.memo(function InterviewWorkspace({
    actionButtonMode,
    appearance,
    attachedContext,
    contentRef,
    controlSurfaceClass,
    currentModel,
    handleAnswerNow,
    handleBrainstorm,
    handleClarify,
    handleFollowUpQuestions,
    handleManualSubmit,
    handleRecap,
    handleWhatToSay,
    inputClass,
    inputValue,
    isInterviewerSpeaking,
    isLightTheme,
    isManualRecording,
    isMousePassthrough,
    isProcessing,
    isSettingsOpen,
    manualTranscript,
    messages,
    messagesEndRef,
    onCopy,
    quickActionClass,
    renderMessageText,
    scrollContainerRef,
    setAttachedContext,
    setInputValue,
    setIsMousePassthrough,
    shortcuts,
    subtleSurfaceClass,
    textInputRef,
    turns,
    voiceInput,
}: InterviewWorkspaceProps) {
    const latestQuestion = turns.length > 0 ? turns[turns.length - 1] : null;

    return (
        <div className="interview-workspace">
            <div className="interview-workspace-grid">
                <AnswerPanel
                    messages={messages}
                    latestQuestion={latestQuestion}
                    isManualRecording={isManualRecording}
                    manualTranscript={manualTranscript}
                    voiceInput={voiceInput}
                    isProcessing={isProcessing}
                    isLightTheme={isLightTheme}
                    appearance={appearance}
                    scrollContainerRef={scrollContainerRef}
                    messagesEndRef={messagesEndRef}
                    renderMessageText={renderMessageText}
                    onCopy={onCopy}
                />
                <QuestionRail
                    turns={turns}
                    isInterviewerSpeaking={isInterviewerSpeaking}
                    isLightTheme={isLightTheme}
                />
            </div>
            <OverlayCommandBar
                actionButtonMode={actionButtonMode}
                attachedContext={attachedContext}
                appearance={appearance}
                contentRef={contentRef}
                controlSurfaceClass={controlSurfaceClass}
                currentModel={currentModel}
                handleAnswerNow={handleAnswerNow}
                handleBrainstorm={handleBrainstorm}
                handleClarify={handleClarify}
                handleFollowUpQuestions={handleFollowUpQuestions}
                handleManualSubmit={handleManualSubmit}
                handleRecap={handleRecap}
                handleWhatToSay={handleWhatToSay}
                inputClass={inputClass}
                inputValue={inputValue}
                isLightTheme={isLightTheme}
                isManualRecording={isManualRecording}
                isMousePassthrough={isMousePassthrough}
                isSettingsOpen={isSettingsOpen}
                quickActionClass={quickActionClass}
                setAttachedContext={setAttachedContext}
                setInputValue={setInputValue}
                setIsMousePassthrough={setIsMousePassthrough}
                shortcuts={shortcuts}
                subtleSurfaceClass={subtleSurfaceClass}
                textInputRef={textInputRef}
            />
        </div>
    );
});

export default InterviewWorkspace;
