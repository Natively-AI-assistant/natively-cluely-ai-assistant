import { animate, AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion';
import {
  ArrowRight,
  ChevronDown,
  Code,
  Copy,
  Check,
  HelpCircle,
  Image,
  Lightbulb,
  MessageSquare,
  Mic,
  Pencil,
  PointerOff,
  RefreshCw,
  SlidersHorizontal,
  X,
  Zap,
} from 'lucide-react';
import {
  mergeRollingTranscriptFinal,
  mergeRollingTranscriptPartial,
} from '../../electron/utils/rollingTranscriptState';

/** Intents that show LLM answer content — pin chat panel on first stream token. */
const ANSWER_PANEL_INTENTS = new Set([
  'what_to_answer',
  'chat',
  'recap',
  'clarify',
  'follow_up_questions',
  'shorten',
]);

const CardCopyButton = ({
  text,
  onCopy,
  isLightTheme,
  isModernTheme: _isModernTheme,
  isGlassTheme: _isGlassTheme,
}: {
  text: string;
  onCopy: (text: string) => void;
  isLightTheme?: boolean;
  isModernTheme?: boolean;
  isGlassTheme?: boolean;
}) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    onCopy(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buttonColorClass = isLightTheme
    ? 'text-slate-400 hover:text-slate-700'
    : 'text-slate-500 hover:text-slate-200';

  return (
    <button
      onClick={handleCopy}
      className={`p-1 transition-colors duration-200 flex items-center justify-center ${buttonColorClass}`}
      title="Copy answer"
    >
      {copied ? (
        <Check className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
    </button>
  );
};

import React, {
  startTransition as reactStartTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  collapseConsecutiveDuplicateSystemMessages,
  shouldDedupeOverlayAction,
} from '../lib/overlayActionDedup.mjs';
import { shouldDedupeManualSubmit } from '../lib/overlaySubmitDedup.mjs';
import {
  applyWhatToAnswerNullFeedbackMessages,
  finalizeStreamingByIntentMessages,
  prepareIntelligenceStreamPlaceholderMessages,
  discardStreamingByIntentMessages,
} from '../lib/overlayMessagePersistence.mjs';
import {
  resolveCgEventTapAvailable,
  shouldBlockFocus as shouldBlockStealthFocus,
  shouldFireStealthTapStart,
} from '../lib/overlayStealthFocusGuards.mjs';
import {
  shouldEagerExpandForCodeToken,
  shouldHoldEagerCodeExpansion,
} from '../lib/overlayCodeExpansion.mjs';
import {
  OVERLAY_RESIZE_DURATION_MS,
  OVERLAY_RESIZE_EASE,
} from '../../electron/utils/overlayResizeEasing.mjs';
import { shouldAcceptIntelligenceIpc } from '../lib/overlayIntelligenceGeneration.mjs';
import { shouldUseStreamingCodeUi } from '../lib/overlayStreamingCodeUi.mjs';
import { widthDerivedScrollMax, verticalScrollCap } from '../lib/overlayScrollBudget.mjs';
import { isPointerOverContent } from '../lib/overlayHoverHitTest.mjs';
import {
  applyFirstStreamingToken,
  commitStreamingFlush,
  finalizeImperativeStreamMessages,
  shouldFlushPreviousStream,
} from '../lib/streamingTokenQueue.mjs';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import { oneLight, vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';

SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('py', python);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('js', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('ts', typescript);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('sh', bash);
SyntaxHighlighter.registerLanguage('shell', bash);
SyntaxHighlighter.registerLanguage('yaml', yaml);
SyntaxHighlighter.registerLanguage('yml', yaml);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('go', go);
SyntaxHighlighter.registerLanguage('rust', rust);
SyntaxHighlighter.registerLanguage('rs', rust);
SyntaxHighlighter.registerLanguage('cpp', cpp);
SyntaxHighlighter.registerLanguage('c++', cpp);
SyntaxHighlighter.registerLanguage('csharp', csharp);
SyntaxHighlighter.registerLanguage('cs', csharp);
SyntaxHighlighter.registerLanguage('css', css);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('markdown', markdown);
SyntaxHighlighter.registerLanguage('md', markdown);
SyntaxHighlighter.registerLanguage('markup', markup);
SyntaxHighlighter.registerLanguage('html', markup);
// import { ModelSelector } from './ui/ModelSelector'; // REMOVED
import 'katex/dist/katex.min.css';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { useResolvedTheme } from '../hooks/useResolvedTheme';
import { genMessageId } from '../utils/messageId';
import { useShortcuts } from '../hooks/useShortcuts';
import { analytics, detectProviderType } from '../lib/analytics/analytics.service';
import type { MeetingInterfaceTheme } from '../lib/meetingInterfaceTheme';
import {
  getGlassOverlayAppearance,
  getOverlayAppearance,
  OVERLAY_OPACITY_DEFAULT,
} from '../lib/overlayAppearance';
import { NegotiationCoachingCard } from '../premium';
import type { DynamicActionPayload } from '../types/electron';
import { getCodexCliModelDisplayName } from '../utils/modelUtils';
import { getModifierSymbol, isMac } from '../utils/platformUtils';
import { DynamicActionBar } from './dynamic-actions/DynamicActionBar';
import GlassEffectLayer from './ui/GlassEffectLayer';
import ResizeToggle from './ui/ResizeToggle';
import RollingTranscript from './ui/RollingTranscript';
import TopPill from './ui/TopPill';

// PERF: hoisted plugin arrays. ReactMarkdown receives `remarkPlugins` and
// `rehypePlugins` as new array literals if defined inline at the call site —
// that defeats its internal render-bailout because plugin-array identity
// changes every render. Module-scope arrays are stable forever and shared
// across every ReactMarkdown render in this component.
const REMARK_PLUGINS = [remarkGfm, remarkMath];
// Lenient KaTeX: never throw on malformed math (e.g. a stray/empty `$$` or an
// unbalanced `$`); render the offending span in error colour instead of letting
// it cascade into garbled per-character output across the whole answer.
const REHYPE_PLUGINS: any[] = [[rehypeKatex, { throwOnError: false, strict: false, errorColor: '#cc0000' }]];

import { DOM_CONTEXT_MAX_CHARS } from '../constants/domCapture';

interface Message {
  id: string;
  role: 'user' | 'system' | 'interviewer';
  text: string;
  isStreaming?: boolean;
  hasScreenshot?: boolean;
  screenshotPreview?: string;
  isCode?: boolean;
  intent?: string;
  // Verified code execution: set when the code in this message passed N executed
  // test cases (renderer shows a small "✓ verified" badge). undefined = not (yet)
  // verified — we NEVER show the badge speculatively.
  codeVerified?: { passed: number; total: number; language: string };
  // Marks a message that was posted as a CORRECTION of an earlier wrong answer.
  isCorrection?: boolean;
  correctionNote?: string;
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
  interfaceTheme?: MeetingInterfaceTheme;
}

// PERF: HighlightedCode renders a single fenced code block. Hoisted to module
// scope and wrapped in React.memo so a parent re-render does not re-tokenize
// existing code blocks. SyntaxHighlighter (Prism) has no internal render
// bailout — without this, every streaming token re-runs Prism over every code
// block in history. The customStyle / lineNumberStyle objects are also at
// module scope so their referential identity stays stable too.
const HC_CUSTOM_STYLE = {
  margin: 0,
  borderRadius: 0,
  fontSize: '13px',
  lineHeight: '1.6',
  background: 'transparent',
  padding: '16px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
} as const;

interface HighlightedCodeProps {
  code: string;
  lang: string;
  isLightTheme: boolean;
  codeTheme: any;
  codeBlockClass: string;
  codeHeaderClass: string;
  codeHeaderTextClass: string;
  codeLineNumberColor: string;
  appearance: any;
  isModernTheme?: boolean;
  isGlassTheme?: boolean;
}

const mapLanguageForPrism = (lang: string, code: string): string => {
  if (!lang) {
    if (code.includes('def ') || code.includes('import ') || code.includes('elif ') || code.includes('print(') || code.includes(':\n')) {
      return 'python';
    }
    return 'javascript';
  }
  const lower = lang.toLowerCase().trim();
  const mapper: Record<string, string> = {
    'js': 'javascript',
    'javascript': 'javascript',
    'ts': 'typescript',
    'typescript': 'typescript',
    'py': 'python',
    'python': 'python',
    'rb': 'ruby',
    'ruby': 'ruby',
    'sh': 'bash',
    'bash': 'bash',
    'shell': 'bash',
    'zsh': 'bash',
    'go': 'go',
    'golang': 'go',
    'rs': 'rust',
    'rust': 'rust',
    'cs': 'csharp',
    'csharp': 'csharp',
    'cpp': 'cpp',
    'c++': 'cpp',
    'h': 'cpp',
    'c': 'c',
    'java': 'java',
    'kt': 'kotlin',
    'kotlin': 'kotlin',
    'swift': 'swift',
    'yml': 'yaml',
    'yaml': 'yaml',
    'xml': 'markup',
    'html': 'markup',
    'svg': 'markup',
    'json': 'json',
    'css': 'css',
    'md': 'markdown',
    'markdown': 'markdown',
    'sql': 'sql',
  };
  return mapper[lower] || lower;
};

const HighlightedCode = React.memo(
  function HighlightedCode({
    code,
    lang,
    codeTheme,
    codeBlockClass,
    codeHeaderClass,
    codeHeaderTextClass,
    codeLineNumberColor,
    appearance,
    isModernTheme,
    isGlassTheme,
  }: HighlightedCodeProps) {
    const isSpecialTheme = isModernTheme || isGlassTheme;
    return (
      <div
        className={`my-3 rounded-xl overflow-hidden border shadow-lg ${codeBlockClass}`}
        style={isSpecialTheme ? undefined : appearance.codeBlockStyle}
      >
        {/* Minimalist Apple Header */}
        <div
          className={`px-3 py-1.5 border-b ${codeHeaderClass}`}
          style={isSpecialTheme ? undefined : appearance.codeHeaderStyle}
        >
          <span
            className={`text-[10px] uppercase tracking-widest font-semibold font-mono ${codeHeaderTextClass}`}
          >
            {lang || 'CODE'}
          </span>
        </div>
        {/* No-wrap horizontal scroll: code line layout stays stable as the
                canvas grows/shrinks. Without this, wrapped lines re-flow at every
                spring tick, the block height jitters, and content below shifts. */}
        <div className="bg-transparent overflow-x-auto">
          <SyntaxHighlighter
            language={mapLanguageForPrism(lang, code)}
            style={codeTheme}
            customStyle={HC_CUSTOM_STYLE}
            wrapLongLines={false}
            showLineNumbers={true}
            lineNumberStyle={{
              minWidth: '2.5em',
              paddingRight: '1.2em',
              color: codeLineNumberColor,
              textAlign: 'right',
              fontSize: '11px',
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  },
  (prev, next) =>
    // codeTheme / codeBlockClass / appearance are all theme-derived; checking
    // appearance (a useMemo'd ref) covers them transitively.
    prev.code === next.code &&
    prev.lang === next.lang &&
    prev.appearance === next.appearance &&
    prev.isModernTheme === next.isModernTheme &&
    prev.isGlassTheme === next.isGlassTheme,
);

// PERF: MessageRow renders one chat-message bubble. Module-scope + React.memo
// so a parent re-render does NOT re-render every prior message — only the
// streaming row whose `msg` reference actually changed gets reconciled.
//
// The combination of (this memo) + (HighlightedCode memo) + (rAF token
// coalescing) + (hoisted ReactMarkdown components) eliminates the streaming
// re-render storm: prior messages stay structurally identical between renders
// and bail out at this boundary, preserving their entire Markdown / code-block
// subtrees including expensive Prism tokenization.
//
// Stable-identity contract for the comparator to actually fire:
//   - msg: setMessages always returns a new array, but the per-message OBJECT
//     identity is preserved for non-changing rows (the streaming-row pattern
//     does `[...prev]` then mutates only `prev.length - 1`). So === on msg
//     correctly detects "this row is unchanged."
//   - appearance: useMemo'd in parent on [overlayOpacity, isLightTheme].
//   - onCopy / renderMessageText: useCallback'd in parent.
interface MessageRowProps {
  msg: Message;
  isLightTheme: boolean;
  appearance: any;
  onCopy: (text: string) => void;
  renderMessageText: (msg: Message) => React.ReactNode;
}
const formatProviderLabel = (provider?: string | null): string => {
  if (!provider) return 'not set';
  return provider
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const getSttSummary = (
  userStatus: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio',
  interviewerStatus: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio',
  userProvider: string,
  interviewerProvider: string,
  notConfigured: boolean,
  userError?: string | null,
  interviewerError?: string | null,
): { label: string; tone: 'ok' | 'warn' | 'error'; detail: string } => {
  if (notConfigured) {
    return {
      label: 'STT not configured',
      tone: 'error',
      detail: 'Open Audio settings to select a provider',
    };
  }
  if (userStatus === 'failed' || interviewerStatus === 'failed') {
    const parts: string[] = [];
    if (userStatus === 'failed' && userError) parts.push(`Mic: ${userError}`);
    if (interviewerStatus === 'failed' && interviewerError) parts.push(`System: ${interviewerError}`);
    return {
      label: 'STT needs attention',
      tone: 'error',
      detail: parts.length > 0 ? parts.join(' · ') : `${formatProviderLabel(userProvider)} mic · ${formatProviderLabel(interviewerProvider)} system`,
    };
  }
  if (userStatus === 'reconnecting' || interviewerStatus === 'reconnecting') {
    return {
      label: 'STT reconnecting',
      tone: 'warn',
      detail: `${formatProviderLabel(userProvider)} mic · ${formatProviderLabel(interviewerProvider)} system`,
    };
  }
  if (userStatus === 'awaiting-audio' || interviewerStatus === 'awaiting-audio') {
    return {
      label: 'Listening for audio…',
      tone: 'warn',
      detail: `${formatProviderLabel(userProvider)} mic · ${formatProviderLabel(interviewerProvider)} system`,
    };
  }
  return {
    label: 'STT healthy',
    tone: 'ok',
    detail: `${formatProviderLabel(userProvider)} mic · ${formatProviderLabel(interviewerProvider)} system`,
  };
};

const getStatusToneClass = (tone: 'ok' | 'warn' | 'error'): string => {
  if (tone === 'error') return 'text-rose-600 dark:text-rose-300 border-rose-500/20 bg-rose-500/10';
  if (tone === 'warn')
    return 'text-amber-600 dark:text-amber-300 border-amber-500/20 bg-amber-500/10';
  return 'text-emerald-600 dark:text-emerald-300 border-emerald-500/20 bg-emerald-500/10';
};

const subtleSurfaceClass = 'overlay-subtle-surface';

const MessageRow = React.memo(
  function MessageRow({
    msg,
    isLightTheme,
    appearance: _appearance,
    onCopy: _onCopy,
    renderMessageText,
  }: MessageRowProps) {
    const isCodeMsg = msg.role === 'system' && (msg.isCode || msg.text.includes('```'));
    // bubbleMaxClass: user bubbles are tighter; system + code use the same width.
    const bubbleMaxClass =
      msg.role === 'user'
        ? 'max-w-[72%] px-[13.6px] py-[10.2px]'
        : msg.role === 'system'
        ? 'max-w-[85%] p-0'
        : 'max-w-[85%] px-4 py-3';
    return (
      <div className="w-full" {...(isCodeMsg ? { 'data-code-msg': 'true' } : {})}>
        <div
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`
              ${bubbleMaxClass} text-[15px] leading-relaxed relative group whitespace-pre-wrap
              ${
                msg.role === 'user'
                  ? isLightTheme
                    ? 'bg-blue-500/10 backdrop-blur-md border border-blue-500/20 text-blue-900 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium'
                    : 'bg-blue-600/20 backdrop-blur-md border border-blue-500/30 text-blue-100 rounded-[20px] rounded-tr-[4px] shadow-sm font-medium'
                  : ''
              }
              ${
                msg.role === 'system'
                  ? 'overlay-text-primary font-normal'
                  : ''
              }
              ${msg.role === 'interviewer' ? 'overlay-text-muted italic pl-0 text-[14px]' : ''}
            `}
            style={undefined}
          >
            {msg.role === 'interviewer' && (
              <div className="flex items-center gap-1.5 mb-1 text-[10px] font-medium uppercase tracking-wider overlay-text-muted">
                Interviewer
                {msg.isStreaming && (
                  <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse" />
                )}
              </div>
            )}
            {msg.role === 'user' && msg.hasScreenshot && (
              <div
                className={`flex items-center gap-1 text-[10px] opacity-70 mb-1 border-b pb-1 ${isLightTheme ? 'border-black/10' : 'border-white/10'}`}
              >
                <Image className="w-2.5 h-2.5" />
                <span>Screenshot attached</span>
              </div>
            )}
            {/* Correction header: this message fixes an earlier wrong answer. */}
            {msg.role === 'system' && msg.isCorrection && (
              <div className="flex items-center gap-1.5 mb-1.5 text-[11px] font-medium text-amber-500">
                <span aria-hidden>↻</span>
                <span>Corrected answer{msg.correctionNote ? ` — ${msg.correctionNote}` : ''}</span>
              </div>
            )}
            {renderMessageText(msg)}
            {/* Verified badge: the code in this message passed executed tests. */}
            {msg.role === 'system' && msg.codeVerified && (
              <div className="flex items-center gap-1 mt-1.5 text-[10px] font-medium text-green-500" title={`Ran ${msg.codeVerified.total} test case(s) successfully`}>
                <span aria-hidden>✓</span>
                <span>
                  {msg.codeVerified.language === 'verified'
                    ? 'verified by running the code'
                    : `verified · ${msg.codeVerified.passed}/${msg.codeVerified.total} test case${msg.codeVerified.total === 1 ? '' : 's'} passed`}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
  (prev, next) =>
    prev.msg === next.msg &&
    prev.isLightTheme === next.isLightTheme &&
    prev.appearance === next.appearance &&
    prev.renderMessageText === next.renderMessageText &&
    prev.onCopy === next.onCopy,
);

const NativelyInterface: React.FC<NativelyInterfaceProps> = ({
  onEndMeeting,
  overlayOpacity = OVERLAY_OPACITY_DEFAULT,
  interfaceTheme = 'default',
}) => {
  const isLightTheme = useResolvedTheme() === 'light';
  const isGlassTheme = interfaceTheme === 'liquid-glass';
  const isModernTheme = interfaceTheme === 'modern';
  const shellRef = React.useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const { shortcuts, isShortcutPressed } = useShortcuts();
  const [messages, setMessages] = useState<Message[]>([]);
  // Keep chat history visible once an answer lands until explicit clear / session reset.
  const [answerPanelPinned, setAnswerPanelPinned] = useState(false);
  const answerPanelPinnedRef = useRef(false);
  const [isConnected, setIsConnected] = useState(false);
  // 'awaiting-audio' is the correct initial state: STT has not yet produced a
  // transcript, so we cannot claim "connected" (green) just because the app
  // launched. Showing green before verifying live audio masks the TCC zero-fill
  // failure mode where permissions look granted but no audio actually flows.
  const [sttUserStatus, setSttUserStatus] = useState<
    'connected' | 'reconnecting' | 'failed' | 'awaiting-audio'
  >('awaiting-audio');
  const [sttUserError, setSttUserError] = useState<string>('');
  const [sttUserProvider, setSttUserProvider] = useState<string>('');
  const [sttInterviewerStatus, setSttInterviewerStatus] = useState<
    'connected' | 'reconnecting' | 'failed' | 'awaiting-audio'
  >('awaiting-audio');
  const [sttInterviewerError, setSttInterviewerError] = useState<string>('');
  const [sttInterviewerProvider, setSttInterviewerProvider] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [conversationContext, setConversationContext] = useState<string>('');
  const [isManualRecording, setIsManualRecording] = useState(false);
  const isRecordingRef = useRef(false); // Ref to track recording state (avoids stale closure)
  const [manualTranscript, setManualTranscript] = useState('');
  const manualTranscriptRef = useRef<string>('');
  const [showTranscript, setShowTranscript] = useState(() => {
    const stored = localStorage.getItem('natively_interviewer_transcript');
    return stored !== 'false';
  });
  const [autoScroll, setAutoScroll] = useState(() => {
    const stored = localStorage.getItem('natively_auto_scroll');
    return stored === 'true';
  });

  // Analytics State
  const requestStartTimeRef = useRef<number | null>(null);

  /**
   * BROWSER DOM CONTEXT INTEGRATION
   * ═════════════════════════════════════════════════════════════════
   * 
   * This property acts as a secure bridge between the companion browser
   * extension and the Natively LLM pipeline. The extension captures the
   * active browser tab's DOM structure and writes it to this property,
   * which is then passed through the secure sanitization pipeline before
   * being included in the LLM prompt.
   * 
   * FORMAT & CONSTRAINTS:
   *   - Type:     String only (non-strings rejected with warning)
   *   - Max Size: DOM_CONTEXT_MAX_CHARS = 25,000 characters
   *   - Content:  HTML structure or plain text representation of visible DOM
   *   - Encoding: UTF-8 (HTML entities escaped by PromptAssembler)
   * 
   * SECURITY PROPERTIES:
   *   - Configurable: false (locked against external tampering)
   *   - Trust Level:  UNTRUSTED_SCREEN (treated as user-controllable evidence)
   *   - Sanitized:   HTML escape + prompt injection detection + optional redaction
   * 
   * LIFECYCLE:
   *   1. Companion browser extension POSTs DOM to PhoneMirrorService (HTTP /dom)
   *   2. PhoneMirrorService receives, validates pairing token, caps size, and broadcasts to renderer via IPC
   *   3. Renderer receives IPC 'dom-context-received' event and sets window.lastCapturedDOM securely
   *   4. handleWhatToSay() reads the value
   *   5. Value is immediately cleared to prevent stale DOM leaking
   *   6. DOM passes through escapeUserContent() + escapePromptInjection()
   *   7. If injection detected, DOM block is optionally fully redacted
   *   8. Sanitized DOM included in PromptAssembler context packet
   * 
   * RATE LIMITS / SIZE BUDGETS:
   *   - Per-request max:    25,000 chars (auto-truncated)
   *   - LLM token budget:   6,000 tokens (enforced in buildDomContextBlock)
   *   - Escape overhead:    ~1.2x (HTML entities expand size)
   * 
   * EXAMPLE EXTENSION CODE:
   * 
   *   // In your companion browser extension background/content script:
   *   const capturedDOM = document.documentElement.innerHTML;
   *   fetch('http://localhost:<port>/dom?t=<token>', {
   *     method: 'POST',
   *     headers: { 'Content-Type': 'application/json' },
   *     body: JSON.stringify({ dom: capturedDOM })
   *   });
   */
  useEffect(() => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'lastCapturedDOM');
    // If already defined on window securely (configurable: false from a prior mount), skip redefinition
    // to avoid TypeError under configurable: false, but preserve cleanup reset behavior.
    if (descriptor && descriptor.configurable === false) {
      return () => {
        try {
          (window as any).lastCapturedDOM = '';
        } catch (_) {}
      };
    }

    // Cleanly delete any pre-planted configurable property to prevent conflicts
    if (descriptor) {
      try {
        delete (window as any).lastCapturedDOM;
      } catch (_) {}
    }

    let lastCapturedDOM = '';
    try {
      Object.defineProperty(window, 'lastCapturedDOM', {
        get() {
          return lastCapturedDOM;
        },
        set(value) {
          if (typeof value === 'string') {
            lastCapturedDOM = value.substring(0, DOM_CONTEXT_MAX_CHARS);
          } else {
            console.warn('[Security] Rejected non-string assignment to window.lastCapturedDOM');
          }
        },
        enumerable: true,
        configurable: false, // Locked securely to prevent tampering by external scripts
      });
    } catch (error: any) {
      console.warn('[Security] window.lastCapturedDOM definition skipped:', error?.message || error);
    }

    return () => {
      try {
        (window as any).lastCapturedDOM = '';
      } catch (_) {}
    };
  }, []);

  // Listen to secure cross-process companion browser extension bridge events
  useEffect(() => {
    let unsubDom: (() => void) | undefined;
    try {
      unsubDom = window.electronAPI?.onDomContextReceived?.((dom) => {
        (window as any).lastCapturedDOM = dom;
      });
    } catch (e) {
      console.warn('[Security] Failed to register onDomContextReceived listener:', e);
    }

    return () => {
      if (unsubDom) {
        try {
          unsubDom();
        } catch (_) {}
      }
    };
  }, []);

  // Sync transcript setting
  useEffect(() => {
    const handleStorage = () => {
      const stored = localStorage.getItem('natively_interviewer_transcript');
      setShowTranscript(stored !== 'false');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Sync auto-scroll setting
  useEffect(() => {
    const handleStorage = () => {
      const stored = localStorage.getItem('natively_auto_scroll');
      setAutoScroll(stored === 'true');
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Auto-scroll to bottom on every messages update when toggle is enabled.
  // 'auto' (instant) instead of 'smooth' is intentional: streaming tokens fire
  // this effect tens of times per second; smooth would restart the animation
  // each time and never reach bottom, producing visible chase/jitter.
  useEffect(() => {
    if (!autoScroll) return;
    if (messages.length === 0) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages, autoScroll]);

  const hasActiveSystemAnswer = useMemo(
    () =>
      messages.some(
        (m) =>
          m.role === 'system' &&
          (m.isStreaming || (typeof m.text === 'string' && m.text.trim().length > 0)),
      ),
    [messages],
  );

  // Auto-pin once any system answer row exists (streaming or complete) so a
  // missed pinAnswerPanel() call cannot collapse the chat panel mid-answer.
  useEffect(() => {
    if (hasActiveSystemAnswer) {
      answerPanelPinnedRef.current = true;
      setAnswerPanelPinned(true);
    }
  }, [hasActiveSystemAnswer]);

  useEffect(() => {
    answerPanelPinnedRef.current = answerPanelPinned;
  }, [answerPanelPinned]);

  const [rollingTranscript, setRollingTranscript] = useState(''); // For interviewer rolling text bar
  const [isInterviewerSpeaking, setIsInterviewerSpeaking] = useState(false); // Track if actively speaking
  // Debounce partial STT ticks so answer/solution rows are not drowned in re-renders.
  const rollingPartialDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRollingPartialRef = useRef<string | null>(null);
  const interviewerSpeakingRef = useRef(false);
  const pinAnswerPanelRef = useRef<() => void>(() => {});
  const [voiceInput, setVoiceInput] = useState(''); // Accumulated user voice input
  const voiceInputRef = useRef<string>(''); // Ref for capturing in async handlers
  const textInputRef = useRef<HTMLInputElement>(null); // Ref for input focus
  const isStealthRef = useRef<boolean>(false); // Tracks if the next expansion should be stealthy
  // Startup-flicker guards (restored from 2de1b62, reverted by 18b139b):
  //  - isExpandedEffectInitializedRef: skip the FIRST run of the visibility-sync
  //    effect so the mount-time isExpanded=true does not fire showWindow() and
  //    re-enter switchToOverlay() (double setBounds + focus flash) on top of the
  //    swap main.startMeeting() already performed.
  //  - hasRenderedExpandedRef: suppress the shell's scale/translate entry
  //    animation on the first content render (it is the only moment the OS
  //    window is simultaneously settling its bounds, so the transform tween
  //    would otherwise read as a shake). Re-expansions after mount still animate.
  const isExpandedEffectInitializedRef = useRef(false);
  const hasRenderedExpandedRef = useRef(false);
  // CGEventTap stealth-typing state. Driven by IPC from main; ref shadows
  // the state so the captured-key handler can early-out without depending
  // on React's render cycle for stop signals.
  const [stealthTapActive, setStealthTapActive] = useState<boolean>(false);
  const stealthTapActiveRef = useRef<boolean>(false);
  // True when the click-to-engage stealth path is safe. False when an IME
  // (Pinyin / Hangul / Kanji / …) is enabled in macOS HIToolbox: the tap
  // captures below the IME so composition would never reach the chat box.
  // Resolved once on mount via IPC (default true so non-macOS / probe
  // failure falls back to existing behaviour).
  const stealthAutoEngageOkRef = useRef<boolean>(true);
  // True when CGEventTap is available on this platform. Defaults false so input remains clickable until availability is confirmed.
  const isCgEventTapAvailableRef = useRef<boolean>(false);
  // Latest-handler ref so the captured-key listener (mounted with [] deps)
  // calls the CURRENT handleManualSubmit closure — not the one captured at
  // first render, which reads inputValue="" and silently no-ops on submit.
  // Updated on every render below.
  const handleManualSubmitRef = useRef<() => void>(() => {});
  /** Blocks concurrent typed submits (double-click / key repeat) before React state updates. */
  const manualSubmitInFlightRef = useRef(false);
  const lastManualSubmitRef = useRef<{ text: string; atMs: number } | null>(null);
  /** Blocks duplicate quick-action LLM calls (Clarify, Follow-up, Brainstorm, Answer). */
  const overlayActionInFlightRef = useRef(new Set<string>());
  const lastOverlayActionRef = useRef<{ key: string; atMs: number } | null>(null);
  // Set when the user tried to engage the tap but Accessibility isn't
  // granted yet. Renders the inline permission banner so we never silently
  // fail — Cluely's onboarding is its UX moat; we mirror it.
  const [stealthPermissionMissing, setStealthPermissionMissing] = useState<boolean>(false);
  // Set when KeybindManager reports the stealth-typing global shortcut
  // failed to register (OS already owns it — common with Cmd+Shift+Space
  // if another app claimed it, or with the macOS input source switcher
  // in some configs). Stores the attempted accelerator so the banner can
  // tell the user exactly what conflicted.
  const [stealthHotkeyConflict, setStealthHotkeyConflict] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const resizeToggleRef = useRef<HTMLButtonElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rafDimUpdateRef = useRef<number | null>(null);
  const codeExpandedRef = useRef(false);
  // Set when token streaming has proven the current row is code before React has
  // mounted a [data-code-msg] row. While true, the visibility scanner must not
  // immediately contradict eager expansion and schedule a collapse.
  const eagerCodeExpansionHoldRef = useRef(false);
  const animationControlsRef = useRef<ReturnType<typeof animate> | null>(null);
  // Wall-clock deadline until which the CSS width tween is running. The OS
  // window is a FIXED WIDTH (OVERLAY_WINDOW_WIDTH = 780) and never width-resizes;
  // only the CSS panel animates 600↔780 centered inside it. But that CSS width
  // change reflows content HEIGHT every frame, firing the ResizeObserver ~60×,
  // and each height-only setBounds re-rasterizes the transparent backdrop-blur
  // window → flicker. So while now < this deadline we SUPPRESS per-frame height
  // reporting and defer to a single authoritative height settle at the tween's
  // onComplete. (Width is never reported as anything but the fixed 780, so there
  // is no width setBounds to suppress — that is the whole point of the fix.)
  //
  // A self-expiring DEADLINE (not a boolean cleared by framer's onComplete) is
  // deliberate: framer's stop() does NOT fire onComplete, so a boolean could
  // stick true forever on an interrupted/retargeted animation and permanently
  // freeze height reporting. A deadline lapses on its own. Set to 0 to release
  // immediately (session reset).
  const heightReportSuppressedUntilRef = useRef(0);
  // Stability gate for code-visibility transitions. Scroll fires at ~60Hz;
  // without this, fast scrolls cancel and restart the width tween repeatedly,
  // producing stutter (and sometimes a snap when start≈target). The pending
  // visibility must hold its new state for STABILITY_MS before we commit to
  // a transition.
  const stableVisibilityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVisibilityRef = useRef<boolean | null>(null);
  // Sticky-bottom across expand/contract. Captured at the start of each
  // transition: if the chat was scrolled to (or within 8 px of) the bottom,
  // the rAF loop pins scrollTop to bottom on every spring frame so the
  // bottom of the conversation stays visually pinned as scrollMaxH grows.
  // iMessage does the same when its window resizes.
  const wasAtBottomRef = useRef<boolean>(true);
  // Captures data from onCaptureAndProcess before the React state flush so
  // handleWhatToSay() can access it even in React 18 concurrent mode (where
  // a plain setTimeout(0) may fire before setAttachedContext flushes).
  const pendingCaptureRef = useRef<{ path: string; preview: string } | null>(null);

  // Latent Context State (Screenshots attached but not sent)
  const [attachedContext, setAttachedContext] = useState<Array<{ path: string; preview: string }>>(
    [],
  );

  // Settings State with Persistence
  const [isUndetectable, setIsUndetectable] = useState(false);
  const [hideChatHidesWidget, setHideChatHidesWidget] = useState(() => {
    const stored = localStorage.getItem('natively_hideChatHidesWidget');
    return stored ? stored === 'true' : true;
  });

  // Active mode name (shown as a badge near the Modes button)
  const [activeModeLabel, setActiveModeLabel] = useState<string | null>(null);
  const [llmProviderLabel, setLlmProviderLabel] = useState<string>('unknown');
  const [llmPrivacyLabel, setLlmPrivacyLabel] = useState<string | null>(null);
  const [screenContextStatus, setScreenContextStatus] = useState<
    'not_available' | 'available' | 'failed'
  >('not_available');
  const [latestUsedImageInput, setLatestUsedImageInput] = useState(false);
  // Vision-first provenance — populated from the generateWhatToSay response.
  const [latestVisionProviderUsed, setLatestVisionProviderUsed] = useState<string | undefined>(
    undefined,
  );
  const [latestVisionModelUsed, setLatestVisionModelUsed] = useState<string | undefined>(undefined);
  const [latestVisionFailureReason, setLatestVisionFailureReason] = useState<string | undefined>(
    undefined,
  );

  useEffect(() => {
    // Load initial active mode name
    window.electronAPI
      ?.modesGetActive?.()
      .then((mode: { name: string } | null) => setActiveModeLabel(mode?.name ?? null))
      .catch(() => {});
    // Live-update whenever mode is activated/deactivated
    const unsub = window.electronAPI?.onModeChanged?.(
      (data: { id: string | null; name: string | null }) => {
        setActiveModeLabel(data.name);
      },
    );
    return () => unsub?.();
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadLlmRoute = async () => {
      const config = await window.electronAPI?.getCurrentLlmConfig?.().catch(() => null);
      if (!mounted || !config) return;
      setLlmProviderLabel(formatProviderLabel(config.provider));
      setLlmPrivacyLabel(
        config.provider === 'ollama' || config.provider === 'codex-cli'
          ? 'Local/private route'
          : config.provider === 'custom'
            ? 'Custom endpoint route'
            : null,
      );
    };
    loadLlmRoute();
    const unsub = window.electronAPI?.onModelChanged?.(() => {
      loadLlmRoute();
    });
    return () => {
      mounted = false;
      unsub?.();
    };
  }, []);

  // Model Selection State
  const [currentModel, setCurrentModel] = useState<string>('gemini-3-flash-preview');

  // Dynamic Action Button Mode (Recap vs Brainstorm)
  const [actionButtonMode, setActionButtonMode] = useState<'recap' | 'brainstorm'>('recap');

  useEffect(() => {
    // Load persisted mode
    window.electronAPI
      ?.getActionButtonMode?.()
      ?.then((mode: 'recap' | 'brainstorm') => {
        if (mode) setActionButtonMode(mode);
      })
      .catch(() => {});

    // Listen for live changes from SettingsPopup / IPC
    const unsubscribe = window.electronAPI?.onActionButtonModeChanged?.(
      (mode: 'recap' | 'brainstorm') => {
        setActionButtonMode(mode);
      },
    );
    return () => {
      unsubscribe?.();
    };
  }, []);

  const useDarkCodeTheme = !isLightTheme || isGlassTheme || isModernTheme;
  const codeTheme = useDarkCodeTheme ? vscDarkPlus : oneLight;
  const codeLineNumberColor = useDarkCodeTheme ? 'rgba(255,255,255,0.2)' : 'rgba(15,23,42,0.35)';
  const appearance = useMemo(
    () =>
      isGlassTheme
        ? getGlassOverlayAppearance()
        : getOverlayAppearance(overlayOpacity, isLightTheme ? 'light' : 'dark'),
    [overlayOpacity, isLightTheme, isGlassTheme],
  );
  const overlayPanelClass = 'overlay-text-primary';
  const codeBlockClass = 'overlay-code-block-surface';
  const codeHeaderClass = 'overlay-code-header-surface';
  const codeHeaderTextClass = 'overlay-text-muted';
  const quickActionClass = 'overlay-chip-surface overlay-text-interactive';
  const inputClass = `${isLightTheme ? 'focus:ring-black/10' : 'focus:ring-white/10'} overlay-input-surface overlay-input-text`;
  const controlSurfaceClass = 'overlay-control-surface overlay-text-interactive';

  // PERF: hoist ReactMarkdown `components` maps for every streaming intent
  // into a single useMemo so their identity is stable across renders. Each
  // inline <ReactMarkdown components={{...}}> would create a fresh object
  // literal per render — defeating ReactMarkdown's internal render-bailout.
  //
  // ALL 6 message-intent branches stream tokens (per IntelligenceEngine emits):
  //   - standard:              plain system text bubbles (fallback render)
  //   - codeText:              text parts inside a code-bubble
  //   - whatToAnswerText:      `what_to_answer` card body (suggested_answer_token;
  //                            emerald theme)
  //   - recapText:             `recap` body (recap_token; indigo theme)
  //   - followUpQuestionsText: `follow_up_questions` body
  //                            (follow_up_questions_token; amber theme)
  //   - shortenText:           `shorten` body — IMPORTANT: shorten streams
  //                            via refined_answer_token with intent='shorten'
  //                            (IntelligenceEngine.ts:406, triggered by
  //                            handleFollowUp('shorten') at line 2657);
  //                            cyan theme.
  //
  // No intent is rendered with an inline `components={{...}}` literal.
  const mdComponents = useMemo(
    () => ({
      standard: {
        p: ({ node, ...props }: any) => (
          <p className="mb-[2.5px] last:mb-0 leading-[1.45] text-[14px] whitespace-pre-wrap" {...props} />
        ),
        strong: ({ node, ...props }: any) => (
          <strong className="font-bold opacity-100 overlay-text-strong" {...props} />
        ),
        em: ({ node, ...props }: any) => (
          <em className="italic opacity-90 overlay-text-secondary" {...props} />
        ),
        ul: ({ node, ...props }: any) => (
          <ul className="list-disc ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        ol: ({ node, ...props }: any) => (
          <ol className="list-decimal ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        code: ({ node, inline, className, children, ...props }: any) => {
          const match = /language-(\w+)/.exec(className || '');
          const isInline = inline ?? !match;
          if (!isInline) {
            const lang = match ? match[1] : '';
            const code = String(children).replace(/\n$/, '');
            return (
              <HighlightedCode
                code={code}
                lang={lang}
                isLightTheme={isLightTheme}
                codeTheme={codeTheme}
                codeBlockClass={codeBlockClass}
                codeHeaderClass={codeHeaderClass}
                codeHeaderTextClass={codeHeaderTextClass}
                codeLineNumberColor={codeLineNumberColor}
                appearance={appearance}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            );
          }
          return (
            <code
              className={`overlay-inline-code-surface rounded px-1 py-0.5 text-[13px] font-mono ${isLightTheme ? 'text-slate-800' : ''}`}
              {...props}
            >
              {children}
            </code>
          );
        },
        a: ({ node, ...props }: any) => (
          <a
            className="underline hover:opacity-80"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          />
        ),
      },
      codeText: {
        p: ({ node, ...props }: any) => (
          <p className="mb-[2.5px] last:mb-0 leading-[1.45] whitespace-pre-wrap text-[14px]" {...props} />
        ),
        strong: ({ node, ...props }: any) => (
          <strong className="font-bold opacity-100 overlay-text-strong" {...props} />
        ),
        em: ({ node, ...props }: any) => (
          <em className="italic overlay-text-secondary" {...props} />
        ),
        ul: ({ node, ...props }: any) => (
          <ul className="list-disc ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        ol: ({ node, ...props }: any) => (
          <ol className="list-decimal ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        h1: ({ node, ...props }: any) => (
          <h1 className="text-[15px] font-bold mb-[2.5px] mt-1.5 leading-[1.45] overlay-text-strong uppercase tracking-wide" {...props} />
        ),
        h2: ({ node, ...props }: any) => (
          <h2 className="text-[13px] font-bold mb-[2.5px] mt-1 leading-[1.45] overlay-text-strong uppercase tracking-wide" {...props} />
        ),
        h3: ({ node, ...props }: any) => (
          <h3 className="text-[13px] font-semibold mb-[2.5px] mt-1 leading-[1.45] overlay-text-primary" {...props} />
        ),
        code: ({ node, ...props }: any) => (
          <code
            className="overlay-inline-code-surface rounded px-1 py-0.5 text-[13px] font-mono whitespace-pre-wrap"
            {...props}
          />
        ),
        blockquote: ({ node, ...props }: any) => (
          <blockquote
            className={`border-l-2 pl-3 italic my-1 ${isLightTheme ? 'border-slate-300 text-slate-600' : 'border-slate-700 text-slate-400'}`}
            {...props}
          />
        ),
        a: ({ node, ...props }: any) => (
          <a
            className="hover:underline text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            target="_blank"
            rel="noopener noreferrer"
            {...props}
          />
        ),
      },
      whatToAnswerText: {
        p: ({ node, ...props }: any) => <p className="mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        strong: ({ node, ...props }: any) => (
          <strong
            className="font-bold opacity-100 overlay-text-strong"
            {...props}
          />
        ),
        em: ({ node, ...props }: any) => (
          <em
            className="italic opacity-90 overlay-text-secondary"
            {...props}
          />
        ),
        ul: ({ node, ...props }: any) => (
          <ul className="list-disc ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        ol: ({ node, ...props }: any) => (
          <ol className="list-decimal ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />
        ),
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
      },
      recapText: {
        p: ({ node, ...props }: any) => <p className="mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        strong: ({ node, ...props }: any) => (
          <strong
            className="font-bold opacity-100 overlay-text-strong"
            {...props}
          />
        ),
        ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />,
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
      },
      followUpQuestionsText: {
        p: ({ node, ...props }: any) => <p className="mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        strong: ({ node, ...props }: any) => (
          <strong
            className="font-bold opacity-100 overlay-text-strong"
            {...props}
          />
        ),
        ul: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />,
        ol: ({ node, ...props }: any) => <ol className="list-decimal ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />,
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
      },
      shortenText: {
        p: ({ node, ...props }: any) => <p className="mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
        strong: ({ node, ...props }: any) => (
          <strong
            className="font-bold opacity-100 overlay-text-strong"
            {...props}
          />
        ),
        ul: ({ node, ...props }: any) => <ul className="list-disc ml-4 mt-[2.5px] mb-[2.5px] space-y-0 leading-[1.45] text-[14px]" {...props} />,
        li: ({ node, ...props }: any) => <li className="pl-1 mb-[2.5px] last:mb-0 leading-[1.45] text-[14px]" {...props} />,
      },
    }),
    [isLightTheme],
  );

  // ── Code-expansion spring ────────────────────────────────────────────────
  // Architecture: OS window resizes in lockstep with the renderer spring.
  //
  // The shell width animates 600 ↔ 780 via a Framer tween and the OS window
  // width follows on the same clock: a motion-value subscriber pushes width
  // to the main process per frame (rAF-coalesced, ≤1px deduped). The IPC
  // (setOverlayDimensionsCentered) does an atomic center-preserving
  // setBounds so the TopPill stays anchored as the frame shrinks/grows.
  //
  // Height is still driven by the ResizeObserver; width is the motion value.
  // The two channels never disagree because reportShellSize also reads
  // shellWidth.get() instead of trusting an expansion flag.
  const SHELL_WIDTH_COLLAPSED = 600;
  const SHELL_WIDTH_EXPANDED = 780;
  // The OS overlay window is a FIXED WIDTH for its entire visible lifetime, equal
  // to the EXPANDED shell width. The window is created/shown at this width and
  // never width-resized; the CSS panel animates 600↔780 centered inside it
  // (mx-auto). This MUST match WindowHelper.OVERLAY_DEFAULT_WIDTH. Keeping the
  // window width fixed means its X origin never moves, so the TopPill is
  // pixel-stable and there is zero per-frame transparent-window re-raster.
  const OVERLAY_WINDOW_WIDTH = SHELL_WIDTH_EXPANDED;
  const shellWidth = useMotionValue(SHELL_WIDTH_COLLAPSED);
  // Vertical budget cap for the chat scroll area. Default Infinity = "not yet
  // measured / unbounded", so the width-derived aesthetic max applies until we
  // know the display height. measureVerticalCap (below) sets the real value:
  // floor(workArea.height*0.9) - chrome, mirroring the main-process clamp in
  // WindowHelper.setOverlayDimensionsCentered. This keeps total content height
  // ≤ the budget the OS window will be granted, so the footer (model selector /
  // settings / send) can never be cropped below the clamped window edge.
  const verticalCap = useMotionValue(Infinity);
  const scrollMaxH = useTransform([shellWidth, verticalCap], ([w, cap]: number[]) =>
    Math.min(widthDerivedScrollMax(w), cap),
  );
  // Tracks the panel's top-right corner as the CSS width tween runs. The OS
  // window is a fixed OVERLAY_WINDOW_WIDTH; the panel is centered inside it, so
  // the panel's right edge sits (OVERLAY_WINDOW_WIDTH - shellWidth) / 2 px from
  // the window right. The button floats 8 px outside that edge so it's always
  // visually adjacent to the corner regardless of collapsed/expanded state.
  const buttonRight = useTransform(shellWidth, (w) => (OVERLAY_WINDOW_WIDTH - w) / 2 + 8);

  // isExpanded mirror for closures inside refs/observers that must not
  // re-bind on every toggle.
  const isExpandedRef = useRef(true);

  // ── Manual width override ─────────────────────────────────────────────────
  // The shell width is normally owned by the auto-resize machinery
  // (checkCodeVisibility scroll-scan + queueToken eager-expand). When the user
  // clicks the manual resize toggle we pin the width and SUSPEND auto-resize so
  // the two don't fight (e.g. user collapses while code is on-screen → scanner
  // would instantly re-expand). The override is a ref because the streaming hot
  // path (200–400 tok/s) reads it inside queueToken/checkCodeVisibility and
  // must not trigger re-renders. The button's icon is driven separately by
  // `isShellWide` (derived from the live width), not from this override.
  //
  // Cleared on: (a) session reset, (b) the first token of the NEXT answer
  // stream — so a manual pin applies to THIS answer, and the next question gets
  // fresh auto-behaviour. NOT cleared on scroll (that would spring it back open
  // the moment the user nudges the wheel — the exact fight we're killing).
  const manualWidthOverrideRef = useRef<number | null>(null);
  // `isShellWide` drives the resize button's icon (Maximize2 ↔ Minimize2). It is
  // derived from the live shellWidth motion value crossing the midpoint, so it
  // self-reconciles for BOTH manual toggles and automatic code-expansion — the
  // icon always reflects the real width no matter who drove it. The subscription
  // flips this at most once per transition (low frequency), so it's render-safe
  // even though the underlying motion value updates every frame.
  const [isShellWide, setIsShellWide] = useState(false);

  useEffect(() => {
    // Load the persisted default model (not the runtime model)
    // Each new meeting starts with the default from settings
    if (window.electronAPI?.getDefaultModel) {
      window.electronAPI
        .getDefaultModel()
        .then((result: any) => {
          if (result && result.model) {
            setCurrentModel(result.model);
            // Also set the runtime model to the default
            window.electronAPI.setModel(result.model).catch(() => {});
          }
        })
        .catch((err: any) => console.error('Failed to fetch default model:', err));
    }
  }, []);

  const handleModelSelect = (modelId: string) => {
    setCurrentModel(modelId);
    // Session-only: update runtime but don't persist as default
    window.electronAPI
      .setModel(modelId)
      .catch((err: any) => console.error('Failed to set model:', err));
  };

  // Listen for default model changes from Settings
  useEffect(() => {
    if (!window.electronAPI?.onModelChanged) return;
    const unsubscribe = window.electronAPI.onModelChanged((modelId: string) => {
      setCurrentModel((prev) => (prev === modelId ? prev : modelId));
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
    window.electronAPI
      ?.getOverlayMousePassthrough?.()
      .then(setIsMousePassthrough)
      .catch(() => {});
    const unsub = window.electronAPI?.onOverlayMousePassthroughChanged?.((v) =>
      setIsMousePassthrough(v),
    );
    return () => unsub?.();
  }, []);

  // Audio capture / screen-recording warning banner. Two distinct IPC
  // events feed the same banner surface but require different title and
  // action: the macOS screen-recording-permission denial points at the
  // OS Privacy pane, while generic audio-capture failures (no-chunks
  // watchdog, TCC zero-fill, terminal STT init failure, SCK errors) are
  // cross-platform and should open Natively's own Settings. Bundling
  // both under a hardcoded "Screen Recording Permission Denied" title
  // with an x-apple.systempreferences action was issue #252: on Windows
  // the audio-capture-failed path fired, the user saw a macOS-only title
  // and the Open Settings button handed Windows shell a URI scheme it
  // couldn't resolve (Microsoft Store popup).
  // UX3: `channel` lets the banner button deep-link to the right macOS
  // System Settings pane (Microphone vs Screen Recording) instead of just
  // opening Natively's internal Settings, which is one extra click and
  // doesn't actually take the user to the system pane they need.
  type SystemAudioWarning = {
    kind: 'screen-recording-permission' | 'audio-capture-failure';
    message: string;
    channel?: 'system' | 'mic';
  };
  const [systemAudioWarning, setSystemAudioWarning] = useState<SystemAudioWarning | null>(null);
  // Transient, informational notice when the mic is auto-switched (e.g. a
  // Bluetooth mic that would drop to low-quality HFP "call mode" — capture is
  // moved to the built-in mic while the BT device stays in high-quality A2DP
  // for playback). Distinct from systemAudioWarning (failures); this is a
  // success/info message that auto-dismisses.
  const [audioNotice, setAudioNotice] = useState<string | null>(null);
  // UX2: in-flight guard for the "Repair Permissions" button so a double-click
  // can't fire two concurrent tccutil sequences (whose second-arriving response
  // would clobber the first's banner mid-render).
  const [tccRepairing, setTccRepairing] = useState(false);
  useEffect(() => {
    const unsub = window.electronAPI?.onSystemAudioPermissionDenied?.((message: string) => {
      // screen-recording-permission is implicitly system-channel (it's the
      // Screen Recording TCC pane). Set channel for consistency so the
      // button-resolution logic has a single source of truth.
      setSystemAudioWarning({ kind: 'screen-recording-permission', message, channel: 'system' });
      setIsExpanded(true); // Force overlay open so user sees the warning
    });
    return () => unsub?.();
  }, []);

  // Audio-input auto-switch notice (mic rerouted to avoid Bluetooth HFP, or to
  // resolve a same-device input/output conflict). The switch happens during
  // audio (re)configuration, which can run before isMeetingActive flips, so
  // this subscription is always on. Auto-dismisses after a few seconds.
  useEffect(() => {
    const unsub = window.electronAPI?.onAudioInputAutoSwitched?.((payload) => {
      const msg = payload.message
        ?? (payload.reason === 'bluetooth-hfp-avoided'
          ? `Using ${payload.to} for better quality while ${payload.from} plays audio.`
          : payload.reason === 'same-device-conflict'
            ? `Switched microphone to ${payload.to} so system audio can be captured.`
            : payload.to
              ? `Microphone switched to ${payload.to}.`
              : 'Microphone quality is degraded.');
      console.log('[NativelyInterface] Audio input auto-switched:', payload);
      setAudioNotice(msg);
    });
    return () => unsub?.();
  }, []);

  useEffect(() => {
    if (!audioNotice) return;
    const t = setTimeout(() => setAudioNotice(null), 6000);
    return () => clearTimeout(t);
  }, [audioNotice]);

  useEffect(() => {
    const unsub = window.electronAPI?.onAudioCaptureFailed?.((payload) => {
      // Surface both 'system' and 'mic' failures. Earlier code dropped the
      // 'mic' channel under the assumption that STT status would surface
      // mic problems, but stt-status only reports WebSocket state — when
      // TCC has silently zero-filled the mic, the WS stays "connected"
      // while audio is dead silence, so the user saw a green status with
      // no transcript and no banner. The main-process zero-fill detector
      // emits the right payload (channel:'mic', stuck:true, mic-zero-fill
      // message); we just need to display it.
      //
      // Only surface terminal failures or the stuck signal — transient
      // recovery attempts shouldn't spam the banner since recovery
      // typically succeeds within ~1.5s.
      if (payload.terminal || payload.stuck) {
        setSystemAudioWarning({
          kind: 'audio-capture-failure',
          message: payload.message,
          channel: payload.channel,
        });
        setIsExpanded(true);
      }
    });
    return () => unsub?.();
  }, []);

  // PR #173: STT not configured warning — shown when provider is 'none' during a meeting
  const [sttNotConfigured, setSttNotConfigured] = useState(false);
  useEffect(() => {
    let mounted = true;
    // Check current STT config on mount
    window.electronAPI
      ?.getSttProvider?.()
      .then((provider: string) => {
        if (mounted) setSttNotConfigured(provider === 'none');
      })
      .catch(() => {});

    // Listen for live config changes (e.g. user saves a key in Settings while meeting is active)
    const unsub = window.electronAPI?.onSttConfigChanged?.(
      (data: { configured: boolean; provider: string }) => {
        if (mounted) setSttNotConfigured(!data.configured);
      },
    );
    return () => {
      mounted = false;
      unsub?.();
    };
  }, []);

  // Keep the closure-free isExpanded mirror in sync.
  useEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

  // Single canonical size-reporter. Width is the live motion value
  // (so OS frame matches the spring mid-tween); height is from the
  // ResizeObserver-measured content rect. Centered IPC keeps the
  // TopPill's horizontal center invariant across resizes.
  const reportShellSize = useCallback(() => {
    if (!contentRef.current) return;
    // offsetHeight is the LAYOUT (untransformed) border-box height. We must NOT
    // use getBoundingClientRect().height here: that returns the POST-transform
    // box, so the shell's scale 0.95→1 / y 20→0 entry animation would feed a
    // continuously-changing height into this OS-resize channel, and the native
    // setBounds() would chase the CSS transform frame-by-frame on a separate
    // clock — the startup shake. Layout height is immune to descendant
    // transforms, so genuine content growth still flows through while the
    // entry flourish stays purely compositor-side.
    // The OS window is a FIXED WIDTH (OVERLAY_WINDOW_WIDTH = 780) and never
    // width-resizes — ALWAYS report that fixed width, never the live in-between
    // CSS shell width. This makes setOverlayDimensionsCentered see widthDelta 0
    // on every call, so the window's X origin never moves (no sideways jump) and
    // the centered setBounds becomes a pure height-only, top-anchored resize.
    // Height is content-driven and keeps flowing through this same call.
    const width = OVERLAY_WINDOW_WIDTH;
    const height = contentRef.current.offsetHeight;
    if (process.env.NODE_ENV === 'development') {
      const scrollEl = scrollContainerRef.current;
      console.log('[overlay-resize] reportShellSize', {
        width,
        height,
        attachedContextCount: attachedContext.length,
        scrollClientHeight: scrollEl?.clientHeight,
        scrollScrollHeight: scrollEl?.scrollHeight,
        screenAvailHeight: window.screen?.availHeight,
      });
    }
    const api = window.electronAPI as any;
    if (api?.updateContentDimensionsCentered) {
      api.updateContentDimensionsCentered({ width, height });
    } else {
      window.electronAPI?.updateContentDimensions({ width, height });
    }
  }, [attachedContext.length, OVERLAY_WINDOW_WIDTH]);

  // Compute the vertical budget cap for the chat scroll area and push it into
  // the `verticalCap` motion value (which scrollMaxH mins against the
  // width-derived max). Without this, the chat scroll max was width-only
  // (320→560), so on a short display expanded view + an attached screenshot
  // made total content exceed the main-process clamp (workArea.height*0.9);
  // the OS window was clamped but the overflow-hidden shell laid out taller,
  // cropping the footer (model selector / settings / send) below the edge.
  //
  // chrome = total content height − the scroll viewport's OWN client height.
  // This is every non-scroll pixel (TopPill+gap, status pills, quick actions,
  // input area, attached-screenshot strip, footer, paddings). It is invariant
  // under scroll-height changes, so feeding it back to bound the scroll height
  // is not circular. availHeight uses the display the window sits on.
  const measureVerticalCap = useCallback(() => {
    const scrollEl = scrollContainerRef.current;
    const contentEl = contentRef.current;
    // No chat panel mounted → nothing to cap; let the width bound apply.
    if (!scrollEl || !contentEl) {
      verticalCap.set(Infinity);
      return;
    }
    const availHeight = typeof window !== 'undefined' ? window.screen?.availHeight ?? 0 : 0;
    const chromeHeight = contentEl.offsetHeight - scrollEl.clientHeight;
    const nextCap = verticalScrollCap({ availHeight, chromeHeight });
    if (process.env.NODE_ENV === 'development') {
      console.log('[overlay-resize] measureVerticalCap', {
        availHeight,
        chromeHeight,
        contentOffsetHeight: contentEl.offsetHeight,
        scrollClientHeight: scrollEl.clientHeight,
        nextCap,
        attachedContextCount: attachedContext.length,
      });
    }
    verticalCap.set(nextCap);
  }, [attachedContext.length, verticalCap]);

  // NOTE: the old per-frame "chase" subscriber that pushed the live shell width
  // to setBounds every frame is GONE. The OS window is a fixed width (780) for
  // its whole lifetime, so there is nothing to chase — the CSS panel animates
  // 600↔780 entirely on the compositor with no native width resize at all. Only
  // HEIGHT flows to the OS, via reportShellSize / the ResizeObserver below.

  // ResizeObserver: rAF-debounced so the spring can update height without
  useLayoutEffect(() => {
    if (!contentRef.current) return;

    const observer = new ResizeObserver(() => {
      if (rafDimUpdateRef.current) cancelAnimationFrame(rafDimUpdateRef.current);
      rafDimUpdateRef.current = requestAnimationFrame(() => {
        rafDimUpdateRef.current = null;
        // Order matters: re-derive the vertical cap from current chrome FIRST,
        // so the scroll area absorbs any overflow, then report the (already
        // bounded) content height to the OS. If the cap shrinks the scroll,
        // the observer fires again and this self-converges in ≤2 frames; chrome
        // height is scroll-invariant, so there is no feedback loop.
        measureVerticalCap();
        // FLICKER GUARD: during the CSS width tween the panel width changes every
        // frame, which reflows content height every frame and fires this observer
        // ~60×; each reportShellSize() would do a native height setBounds, and
        // every setBounds re-rasterizes the transparent backdrop-blur window →
        // the flicker. measureVerticalCap above keeps the scroll area bounded
        // meanwhile; the single authoritative height settle is deferred to the
        // transition's onComplete (one setBounds, not one per frame).
        if (Date.now() < heightReportSuppressedUntilRef.current) {
          return;
        }
        reportShellSize();
      });
    });

    observer.observe(contentRef.current);
    return () => {
      observer.disconnect();
      if (rafDimUpdateRef.current) {
        cancelAnimationFrame(rafDimUpdateRef.current);
        rafDimUpdateRef.current = null;
      }
    };
  }, [reportShellSize, measureVerticalCap]);

  // ── Hover-gated click-through for the fixed-width window's transparent margins
  // The OS window is a fixed 780px wide but the painted panel is only 600px when
  // collapsed, leaving ~90px transparent margins each side. Those margins must
  // pass clicks THROUGH to the app behind, not swallow them. We hit-test the
  // pointer against the painted content rect and tell the main process whether
  // the window should capture clicks (pointer over panel) or be click-through
  // (pointer over a margin). The main process gates this on the master stealth
  // passthrough — when stealth is on the window stays fully click-through
  // regardless of hover (see WindowHelper.syncOverlayInteractionPolicy). We only
  // IPC on STATE CHANGE (debounced), and report mouseleave as "off panel".
  useEffect(() => {
    const api = window.electronAPI as any;
    if (typeof api?.setOverlayInteractiveRegion !== 'function') return;

    // null = unknown (force first report). Tracks the last value we sent so we
    // only round-trip to the main process when the over/off-panel state flips.
    let lastSent: boolean | null = null;

    const send = (overContent: boolean) => {
      if (lastSent === overContent) return;
      lastSent = overContent;
      api.setOverlayInteractiveRegion(overContent);
    };

    const evaluate = (x: number, y: number) => {
      const rect = contentRef.current?.getBoundingClientRect();
      // Also keep the window interactive when the pointer is over the floating
      // resize toggle (which lives outside contentRef as a fixed pill).
      const btnRect = resizeToggleRef.current?.getBoundingClientRect();
      send(
        isPointerOverContent(rect ?? null, x, y) ||
        isPointerOverContent(btnRect ?? null, x, y),
      );
    };

    const onMove = (e: MouseEvent) => evaluate(e.clientX, e.clientY);
    // Pointer left the window entirely → definitely over a margin / outside.
    const onLeave = () => send(false);

    window.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseleave', onLeave);

    // Initial report: until the pointer actually enters the painted panel, the
    // window should be click-through so the transparent area is never a dead
    // click. The first real mousemove inside the panel flips it to interactive.
    send(false);

    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
      // Restore the interactive default on unmount so a future mount (or the
      // main-process default) is not left stuck in click-through.
      api.setOverlayInteractiveRegion(true);
    };
  }, []);

  // attachedContext (screenshots add/remove) and initial-sizing safety:
  // both re-derive the vertical cap (a screenshot strip grows chrome) and
  // re-run the canonical reporter — no more "what width should I use right
  // now?" branching against animation flags.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      measureVerticalCap();
      reportShellSize();
    });
    return () => cancelAnimationFrame(id);
  }, [attachedContext, reportShellSize, measureVerticalCap]);

  useEffect(() => {
    const timer = setTimeout(() => {
      measureVerticalCap();
      reportShellSize();
    }, 600);
    return () => clearTimeout(timer);
  }, [reportShellSize, measureVerticalCap]);

  // ── Code-expansion (CSS-ONLY, fixed-width window) ────────────────────────
  // THE FIX (third attempt, root cause confirmed): the OS window is a FIXED
  // WIDTH (OVERLAY_WINDOW_WIDTH = 780) for its entire visible lifetime. The
  // expand/contract is animated PURELY in CSS — only the `shellWidth` motion
  // value tweens 600↔780, and the panel is centered (mx-auto) inside the fixed
  // window. There is NO width setBounds during the interaction at all.
  //
  // Why: the previous two attempts shifted the window's X origin during the
  // animation (to keep the panel centered as the window width changed). But
  // Chromium does NOT synchronize a programmatic setBounds with the renderer's
  // paint on macOS, so for one frame the old framebuffer (painted at the old
  // origin) was shown at the new shifted origin → the TopPill snapped sideways,
  // and repeating that per frame WAS the flicker. With a fixed window width the
  // X origin never moves, so:
  //   • TopPill (centered in the fixed window) is pixel-stable — zero jump.
  //   • No per-frame width setBounds → no transparent-blur re-raster — zero flicker.
  //
  // Only HEIGHT still flows to the OS (content/streaming growth), via a single
  // height-only, top-anchored setBounds — which does not move X. During the CSS
  // width tween the height reflows every frame, so per-frame height reports are
  // SUPPRESSED (heightReportSuppressedUntilRef) and a single authoritative
  // height settle fires at onComplete.
  const resizeOverlayWindowCentered = useCallback(
    (height: number) => {
      if (height <= 0) return;
      // Width is ALWAYS the fixed window width → widthDelta 0 in the main
      // process → X never moves; this collapses to a pure height-only resize.
      const api = window.electronAPI as any;
      if (api?.updateContentDimensionsCentered) {
        api.updateContentDimensionsCentered({ width: OVERLAY_WINDOW_WIDTH, height });
      } else {
        window.electronAPI?.updateContentDimensions({ width: OVERLAY_WINDOW_WIDTH, height });
      }
    },
    [OVERLAY_WINDOW_WIDTH],
  );

  const startTransition = useCallback(
    (targetWidth: number) => {
      codeExpandedRef.current = targetWidth === SHELL_WIDTH_EXPANDED;
      if (animationControlsRef.current) animationControlsRef.current.stop();

      const fromWidth = Math.round(shellWidth.get());

      // iMessage-style sticky bottom. Capture the user's scroll intent now,
      // before scrollMaxH starts changing. If they were at (or near) the
      // bottom, we keep them pinned there throughout the tween so growing
      // viewport height doesn't reveal stale history below the visible chat.
      const container = scrollContainerRef.current;
      if (container) {
        const distanceFromBottom =
          container.scrollHeight - (container.scrollTop + container.clientHeight);
        wasAtBottomRef.current = distanceFromBottom <= 8;
      }

      // No meaningful width change: nothing to animate, no native resize.
      if (Math.abs(targetWidth - fromWidth) <= 1) {
        shellWidth.set(targetWidth);
        return;
      }

      // Suppress per-frame HEIGHT reporting for the whole tween: the CSS width
      // change reflows content height ~60×/s, and one height setBounds per frame
      // re-rasters the transparent-blur window → flicker. Settle once at
      // onComplete instead. (There is NO width setBounds to suppress — the window
      // width is fixed.) Margin covers onComplete jitter. Self-expiring deadline
      // so an interrupted/retargeted tween can never wedge reporting off.
      heightReportSuppressedUntilRef.current = Date.now() + OVERLAY_RESIZE_DURATION_MS + 120;

      // Throttled height reporter for the tween duration. The CSS width change
      // reflows content height every frame as the panel grows/shrinks, but we
      // cannot setBounds at 60fps (backdrop-blur re-raster causes flicker). We
      // sample height at ~15fps (every 67ms) — smooth enough that the OS window
      // bottom visibly tracks the content growth instead of snapping at the end,
      // but coarse enough to avoid per-frame native raster.
      let lastHeightReport = 0;
      const HEIGHT_THROTTLE_MS = 67;

      // CSS-only width tween on the compositor clock. Monotonic ease-out (no
      // overshoot). The panel grows/shrinks symmetrically off the fixed center.
      animationControlsRef.current = animate(shellWidth, targetWidth, {
        duration: OVERLAY_RESIZE_DURATION_MS / 1000,
        ease: OVERLAY_RESIZE_EASE,
        onUpdate: () => {
          if (wasAtBottomRef.current) {
            const c = scrollContainerRef.current;
            if (c) {
              // scrollMaxH is derived from shellWidth, so on every tick the
              // viewport height has just changed. Re-pin to bottom in the
              // SAME frame — single layout read, single write, no flush.
              c.scrollTop = c.scrollHeight - c.clientHeight;
            }
          }
          // Throttled height sample: lets the OS window bottom track content
          // growth during the tween instead of snapping at onComplete. Far
          // below 60fps so backdrop-blur re-raster stays below perception.
          const now = Date.now();
          if (now - lastHeightReport >= HEIGHT_THROTTLE_MS) {
            lastHeightReport = now;
            const h = contentRef.current?.offsetHeight ?? 0;
            if (h > 0) resizeOverlayWindowCentered(h);
          }
        },
        onComplete: () => {
          animationControlsRef.current = null;
          // Hand reporting back to normal FIRST so the settle below actually
          // fires (the ResizeObserver early-returns while suppression is live).
          heightReportSuppressedUntilRef.current = 0;
          // Authoritative HEIGHT settle: ensures the final frame is exact even
          // if the last throttled sample landed slightly before the tween end.
          const settledHeight = contentRef.current?.offsetHeight ?? 0;
          resizeOverlayWindowCentered(settledHeight);
        },
      });
    },
    [shellWidth, SHELL_WIDTH_EXPANDED, resizeOverlayWindowCentered],
  );

  // Manual resize toggle. Reads the LIVE shell width (not codeExpandedRef) so it
  // toggles correctly even mid-tween, pins the chosen width as a manual override
  // (suspending auto-resize), and animates through the SAME startTransition path
  // the auto-machinery uses — so manual and automatic expansion are visually
  // identical (both CSS-only now).
  const handleManualResizeToggle = useCallback(() => {
    const current = Math.round(shellWidth.get());
    const target =
      current >= SHELL_WIDTH_EXPANDED ? SHELL_WIDTH_COLLAPSED : SHELL_WIDTH_EXPANDED;
    manualWidthOverrideRef.current = target;
    startTransition(target);
  }, [shellWidth, startTransition, SHELL_WIDTH_COLLAPSED, SHELL_WIDTH_EXPANDED]);

  // Derive the resize-button icon state from the live shell width. Subscribing
  // to the motion value (rather than tracking each startTransition caller)
  // means the icon is correct for manual toggles AND automatic code-expansion
  // with one source of truth. setState only fires when the boolean actually
  // flips, so this is ≤1 render per transition despite per-frame width updates.
  useEffect(() => {
    const midpoint = (SHELL_WIDTH_COLLAPSED + SHELL_WIDTH_EXPANDED) / 2;
    const sync = (w: number) => setIsShellWide((prev) => (prev === w >= midpoint ? prev : w >= midpoint));
    sync(shellWidth.get());
    const unsubscribe = shellWidth.on('change', sync);
    return () => unsubscribe();
  }, [shellWidth, SHELL_WIDTH_COLLAPSED, SHELL_WIDTH_EXPANDED]);

  // Scan [data-code-msg] elements and check if any intersect the scroll container
  // viewport. Called on every scroll event and after every messages update.
  // Uses a stability gate: the visibility must hold its new state for
  // STABILITY_MS before a transition fires. This filters out the rapid
  // visible↔invisible flicker that occurs when a code block crosses the
  // viewport edge during a fast scroll, which would otherwise interrupt
  // the 0.7s tween mid-flight and cause stutter.
  const STABILITY_MS = 120;
  const checkCodeVisibility = useCallback(() => {
    // While the user has manually pinned a width, auto-resize is fully
    // suspended — the scanner must not contradict the manual choice. Cleared on
    // session reset and on the first token of the next stream (see queueToken).
    if (manualWidthOverrideRef.current !== null) return;

    const container = scrollContainerRef.current;

    // Scroll container unmounted (session reset / messages cleared) — force
    // contraction so the shell returns to its collapsed width. Skip while the
    // answer panel is pinned: transient unmounts during STT/layout churn must
    // not collapse the shell and flash the answer block.
    if (!container) {
      if (answerPanelPinnedRef.current) return;
      if (stableVisibilityTimerRef.current) {
        clearTimeout(stableVisibilityTimerRef.current);
        stableVisibilityTimerRef.current = null;
      }
      pendingVisibilityRef.current = null;
      if (codeExpandedRef.current) startTransition(SHELL_WIDTH_COLLAPSED);
      return;
    }

    const codeEls = container.querySelectorAll('[data-code-msg]');
    let visible = false;
    if (codeEls.length > 0) {
      // The real code row now exists, so visibility scanning can take ownership
      // again. This restores scroll-away contraction after the pre-DOM eager
      // expansion gap has passed.
      eagerCodeExpansionHoldRef.current = false;
      const cRect = container.getBoundingClientRect();
      for (const el of codeEls) {
        const r = el.getBoundingClientRect();
        if (r.bottom > cRect.top && r.top < cRect.bottom) {
          visible = true;
          break;
        }
      }
    }

    if (
      shouldHoldEagerCodeExpansion({
        hasCodeElements: codeEls.length > 0,
        hasVisibleCodeElement: visible,
        eagerExpansionHold: eagerCodeExpansionHoldRef.current,
      })
    ) {
      visible = true;
    }

    // Already in the correct state — clear any pending change so a
    // mid-flight tween isn't interrupted by a stale timer firing.
    if (visible === codeExpandedRef.current) {
      pendingVisibilityRef.current = null;
      if (stableVisibilityTimerRef.current) {
        clearTimeout(stableVisibilityTimerRef.current);
        stableVisibilityTimerRef.current = null;
      }
      return;
    }

    // State change detected. If we're already waiting on the SAME pending
    // change, let the timer continue ticking — don't reset it on every
    // scroll frame, or fast scroll would never let the timer fire.
    if (pendingVisibilityRef.current === visible) return;

    pendingVisibilityRef.current = visible;
    if (stableVisibilityTimerRef.current) clearTimeout(stableVisibilityTimerRef.current);
    stableVisibilityTimerRef.current = setTimeout(() => {
      stableVisibilityTimerRef.current = null;
      const target = pendingVisibilityRef.current;
      pendingVisibilityRef.current = null;
      if (target !== null && target !== codeExpandedRef.current) {
        startTransition(target ? SHELL_WIDTH_EXPANDED : SHELL_WIDTH_COLLAPSED);
      }
    }, STABILITY_MS);
  }, [startTransition, SHELL_WIDTH_COLLAPSED, SHELL_WIDTH_EXPANDED]);

  // Re-check after every messages update (catches mid-stream code fences).
  useEffect(() => {
    const raf = requestAnimationFrame(() => checkCodeVisibility());
    return () => cancelAnimationFrame(raf);
  }, [messages, checkCodeVisibility]);

  // Re-attach scroll listener whenever messages change — the scroll container
  // is conditionally rendered so scrollContainerRef.current is null at mount.
  //
  // The visibility check does layout reads (querySelectorAll +
  // getBoundingClientRect on every code element). Running it synchronously
  // on every scroll event forces a layout flush mid-scroll-frame, which
  // shows up as text jitter during fast scrolls. rAF-coalescing it ensures
  // at most one check per frame and lets the read happen at the natural
  // post-scroll layout point in the frame lifecycle.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        checkCodeVisibility();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [messages, checkCodeVisibility]);

  // Cancel all in-flight async work on unmount.
  useEffect(() => {
    return () => {
      animationControlsRef.current?.stop();
      animationControlsRef.current = null;
      heightReportSuppressedUntilRef.current = 0;
      if (rafDimUpdateRef.current) {
        cancelAnimationFrame(rafDimUpdateRef.current);
        rafDimUpdateRef.current = null;
      }
      if (stableVisibilityTimerRef.current) {
        clearTimeout(stableVisibilityTimerRef.current);
        stableVisibilityTimerRef.current = null;
      }
      pendingVisibilityRef.current = null;
      eagerCodeExpansionHoldRef.current = false;
      // PERF: cancel any pending token-flush RAF so we don't try to
      // setState on an unmounted component.
      if (tokenBufRef.current.raf !== null) {
        cancelAnimationFrame(tokenBufRef.current.raf);
        tokenBufRef.current.raf = null;
        tokenBufRef.current.text = '';
      }
      // Also reset imperative streaming refs on unmount so stale DOM
      // node refs don't fire after the component is gone.
      streamingNodeRef.current = null;
      streamingTextRef.current = '';
      streamingMsgIdRef.current = null;
      streamingIntentRef.current = null;
      streamingRenderModeRef.current = 'imperative';
      if (streamingCodeRafRef.current !== null) {
        cancelAnimationFrame(streamingCodeRafRef.current);
        streamingCodeRafRef.current = null;
      }
      if (rollingPartialDebounceRef.current !== null) {
        clearTimeout(rollingPartialDebounceRef.current);
        rollingPartialDebounceRef.current = null;
      }
      pendingRollingPartialRef.current = null;
    };
  }, []);
  // ────────────────────────────────────────────────────────────────────────

  // Build conversation context from messages
  useEffect(() => {
    const context = messages
      .filter((m) => m.role !== 'user' || !m.hasScreenshot)
      .map(
        (m) =>
          `${m.role === 'interviewer' ? 'Interviewer' : m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`,
      )
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
    // First run is the mount-time isExpanded=true. main.startMeeting() has
    // already shown the overlay via switchToOverlay(); calling showWindow()
    // here would re-enter switchToOverlay() (a second setBounds + focus()),
    // producing the startup focus flash. Skip it exactly once. The
    // `ensure-expanded` IPC handler still sets isStealthRef before any later
    // expansion, so stealth is preserved.
    if (!isExpandedEffectInitializedRef.current) {
      isExpandedEffectInitializedRef.current = true;
      isStealthRef.current = false;
      return;
    }

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
      setIsExpanded((prev) => !prev);
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
      eagerCodeExpansionHoldRef.current = false;
      answerPanelPinnedRef.current = false;
      setAnswerPanelPinned(false);

      // ─── COLLAPSE THE CODE-WIDTH EXPANSION SYNCHRONOUSLY ───────────────────
      // The overlay window/renderer is reused across meetings (never
      // destroyed), so the PREVIOUS meeting's expanded coding/answer view —
      // its wide shell width and the deferred visibility machinery — survives
      // into the next meeting. Clearing `messages` above is not enough: the
      // shell only contracts later via checkCodeVisibility (rAF → 120ms
      // stability gate → 0.7s spring), so on restart the user briefly sees the
      // old meeting at its expanded width before it "refreshes" a second or
      // two later. Snap everything back to the collapsed baseline NOW so the
      // first paint of the new meeting is already clean.
      //
      // We touch the code-width state (shellWidth / codeExpandedRef), NOT
      // isExpanded — isExpanded is the vertical content-shown flag whose
      // mounted default (true) is already correct for a fresh meeting, and
      // setIsExpanded(false) would trigger hideWindow() (see the [isExpanded]
      // effect), wrongly hiding a just-started meeting.
      if (animationControlsRef.current) {
        animationControlsRef.current.stop();
        animationControlsRef.current = null;
      }
      codeExpandedRef.current = false;
      // Clear any manual width pin so the new meeting's auto-resize takes over.
      // Forgetting this would silently disable code-expansion for the entire
      // next meeting if the user had manually collapsed in the previous one.
      manualWidthOverrideRef.current = null;
      if (stableVisibilityTimerRef.current) {
        clearTimeout(stableVisibilityTimerRef.current);
        stableVisibilityTimerRef.current = null;
      }
      pendingVisibilityRef.current = null;
      // Release any height-report suppression from an in-flight tween.
      heightReportSuppressedUntilRef.current = 0;
      // Imperative .set() (not animate) — no transient frame. Width is CSS-only
      // and the OS window stays fixed at OVERLAY_WINDOW_WIDTH, so snapping the
      // shell back to collapsed is a pure compositor change with no native
      // resize and no sideways motion.
      shellWidth.set(SHELL_WIDTH_COLLAPSED);
      setInputValue('');
      setAttachedContext([]);
      setManualTranscript('');
      setVoiceInput('');
      setIsProcessing(false);
      if (rollingPartialDebounceRef.current !== null) {
        clearTimeout(rollingPartialDebounceRef.current);
        rollingPartialDebounceRef.current = null;
      }
      pendingRollingPartialRef.current = null;
      setRollingTranscript('');
      setIsInterviewerSpeaking(false);
      interviewerSpeakingRef.current = false;
      // Reset STT status to 'awaiting-audio' on session reset. The previous
      // session's 'connected' state must not carry over into a new meeting
      // before we've verified live audio is flowing on the new pipeline.
      setSttUserStatus('awaiting-audio');
      setSttInterviewerStatus('awaiting-audio');
      setSttUserError('');
      setSttInterviewerError('');
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
    setAttachedContext((prev) => {
      // Prevent duplicates and cap at 5
      if (prev.some((s) => s.path === data.path)) return prev;
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

  // ── PERF: streaming-token rAF coalescing ─────────────────────────────────
  // Token streams (LLM answers) used to call setMessages PER TOKEN. Groq
  // emits ~200–400 tok/s, so a 400-token answer triggered 400 React renders
  // — each one cloning the messages array and re-rendering every prior row.
  //
  // ── Imperative Streaming (Option 2: RAF-throttled markdown) ──────────────
  //
  // Architecture overview:
  //   • queueToken() writes each token directly to DOM via ref.textContent
  //     — zero React renders per token. A pending RAF schedules a markdown
  //     render (via marked + DOMPurify) at up to 60fps so the user sees
  //     formatted output throughout the stream.
  //   • Only the FIRST token of a new stream calls setMessages() to mount
  //     the bubble. The bubble's ref-callback wires streamingNodeRef.
  //   • flushToken() resets the imperative refs so the final-answer
  //     setMessages() takes ownership of the rendered row via React.
  //   • tokenBufRef is kept for the legacy sentinel/negotiation-coaching path
  //     and for the cleanup effect above.
  //
  // Tradeoff: marked parses the FULL accumulated text each RAF tick (not
  // incremental). In practice this is <1ms for typical LLM responses and
  // invisible at 60fps. If a response grows beyond ~20 KB we can throttle
  // the RAF to every other frame.
  // ─────────────────────────────────────────────────────────────────────────

  // Legacy buffer kept for sentinel/negotiation-coaching reset path.
  const tokenBufRef = useRef<{ intent: string; text: string; raf: number | null }>({
    intent: '',
    text: '',
    raf: null,
  });

  // Imperative streaming refs
  const streamingNodeRef   = useRef<HTMLDivElement | null>(null);
  const streamingTextRef   = useRef<string>('');
  const streamingMsgIdRef  = useRef<string | null>(null);
  const streamingIntentRef = useRef<string | null>(null);
  const streamingRafRef    = useRef<number | null>(null);
  const streamingRenderModeRef = useRef<'imperative' | 'react-code'>('imperative');
  const streamingCodeRafRef = useRef<number | null>(null);

  // Helper: render accumulated markdown to the streaming DOM node via RAF.
  // Called after every token write. Schedules at most one RAF per frame.
  const scheduleMarkdownRender = useCallback(() => {
    if (streamingRafRef.current !== null) return; // already pending
    streamingRafRef.current = requestAnimationFrame(() => {
      streamingRafRef.current = null;
      const node = streamingNodeRef.current;
      if (!node || !streamingTextRef.current) return;
      // marked.parse is sync and fast (<1ms for typical LLM chunks).
      // DOMPurify strips any script/event-handler injection.
      const rawHtml = marked.parse(streamingTextRef.current, { async: false }) as string;
      node.innerHTML = DOMPurify.sanitize(rawHtml);
    });
  }, []);

  const scheduleStreamingCodeRender = useCallback(() => {
    if (streamingCodeRafRef.current !== null) return;
    streamingCodeRafRef.current = requestAnimationFrame(() => {
      streamingCodeRafRef.current = null;
      const msgId = streamingMsgIdRef.current;
      const text = streamingTextRef.current;
      const intent = streamingIntentRef.current;
      if (!msgId || !text) return;
      setMessages((prev) => {
        const idx = prev.findLastIndex((m) => m.id === msgId);
        if (idx === -1) return prev;
        const row = prev[idx];
        if (row.text === text && row.isStreaming && row.intent === intent) return prev;
        const updated = [...prev];
        updated[idx] = { ...row, text, intent: intent ?? row.intent, isStreaming: true };
        return updated;
      });
    });
  }, []);

  // queueToken: imperative DOM write per token + RAF markdown render.
  // Only the FIRST token of a stream calls setMessages (to mount the bubble).
  // Subsequent tokens bypass React entirely — zero re-renders mid-stream.
  const queueToken = useCallback((intent: string, token: string) => {
    // If a new stream intent arrives while one is active, flush the current
    // stream into React state so the rows don't bleed into each other.
    if (
      shouldFlushPreviousStream(
        streamingIntentRef.current,
        intent,
        streamingMsgIdRef.current,
      )
    ) {
      const prevText = streamingTextRef.current;
      const prevId   = streamingMsgIdRef.current;
      // Wipe imperative innerHTML before nulling the node ref so the previous
      // stream's marked.parse output doesn't stack under the new intent's
      // finalized React render (same root cause as the flushToken cleanup).
      if (streamingNodeRef.current) streamingNodeRef.current.innerHTML = '';
      streamingNodeRef.current  = null;
      streamingTextRef.current  = '';
      streamingMsgIdRef.current = null;
      streamingIntentRef.current = null;
      streamingRenderModeRef.current = 'imperative';
      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current);
        streamingRafRef.current = null;
      }
      if (streamingCodeRafRef.current !== null) {
        cancelAnimationFrame(streamingCodeRafRef.current);
        streamingCodeRafRef.current = null;
      }
      reactStartTransition(() => {
        setMessages((prev) => {
          const idx = prev.findLastIndex((m) => m.id === prevId);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], text: prevText, isStreaming: false };
            return updated;
          }
          return prev;
        });
      });
    }

    // First token of a NEW stream (id not yet reserved) → relinquish any manual
    // width pin so this answer gets fresh auto-resize behaviour. Done before the
    // eager-expand check below so a new coding answer can still grow the shell.
    if (streamingMsgIdRef.current === null && manualWidthOverrideRef.current !== null) {
      manualWidthOverrideRef.current = null;
    }

    const shouldUseReactCodeUi = shouldUseStreamingCodeUi(intent, token, streamingTextRef.current);
    if (shouldEagerExpandForCodeToken(intent, token, streamingTextRef.current)) {
      eagerCodeExpansionHoldRef.current = true;
      // Respect a manual width pin: don't auto-grow if the user chose a width.
      if (manualWidthOverrideRef.current === null && !codeExpandedRef.current) {
        startTransition(SHELL_WIDTH_EXPANDED);
      }
    }
    if (shouldUseReactCodeUi) {
      streamingRenderModeRef.current = 'react-code';
      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current);
        streamingRafRef.current = null;
      }
      if (streamingNodeRef.current) {
        streamingNodeRef.current.innerHTML = '';
      }
    }

    streamingTextRef.current += token;
    streamingIntentRef.current = intent;

    if (streamingMsgIdRef.current !== null) {
      if (streamingRenderModeRef.current === 'react-code') {
        scheduleStreamingCodeRender();
        return;
      }
      // Mid-stream: write directly to DOM, schedule markdown render.
      if (streamingNodeRef.current) {
        // Fast path: update textContent immediately so the user sees the
        // new character without waiting for the RAF, then let the RAF
        // upgrade it to rendered HTML. This gives sub-frame latency for
        // plain text and up-to-60fps latency for markdown.
        streamingNodeRef.current.textContent = streamingTextRef.current;
      }
      scheduleMarkdownRender();
      return;
    }

    // First token: synchronously reserve the streaming id BEFORE the transition
    // and set the ref immediately. Rationale: setMessages here is wrapped in
    // reactStartTransition (deferred), but a `suggested_answer` finalize that
    // arrives on the next IPC tick runs a non-transition setState that React
    // prioritises over the pending transition. Without a synchronously-set
    // ref, finalize would not see the streaming row's id, fall through to its
    // findLastIndex fallback, and either clobber a prior answer or append a
    // duplicate row (the duplicate-answer bug). With the ref pre-reserved,
    // finalize either updates the row in place (already mounted) or — via the
    // idempotent append-by-id path in finalizeStreamingByIntentMessages —
    // creates the row with this id so the late mount finds and merges instead
    // of duplicating.
    const reservedId = genMessageId();
    streamingMsgIdRef.current = reservedId;
    streamingIntentRef.current = intent;
    if (ANSWER_PANEL_INTENTS.has(intent)) {
      pinAnswerPanelRef.current();
    }
    reactStartTransition(() => {
      setMessages((prev) => {
        // ALWAYS use the synchronously-reserved id. Do NOT search for an
        // existing open same-intent row to "reuse" — that creates a race
        // with finalize: if finalize fires between the synchronous ref
        // assignment and this reducer running, it captures `reservedId`;
        // if this reducer then realigned the ref to an orphan row's id,
        // finalize's idempotent append-with-`reservedId` would create a
        // separate empty row while the orphan absorbed the token text →
        // two visible rows. Anchoring this commit to `reservedId`
        // eliminates that race entirely.
        //
        // To prevent stale isStreaming=true same-intent rows from a prior
        // stream leaking into the UI (rendered forever as a typing-dots
        // bubble), seal them here. `prepareIntelligenceStreamPlaceholder`
        // already seals on its path; this is for queueToken-only flows
        // that don't pre-create a placeholder.
        const sealed = prev.some(
          (m) =>
            m.role === 'system' &&
            m.isStreaming &&
            m.intent === intent &&
            m.id !== reservedId,
        )
          ? prev.map((m) =>
              m.role === 'system' &&
              m.isStreaming &&
              m.intent === intent &&
              m.id !== reservedId
                ? { ...m, isStreaming: false }
                : m,
            )
          : prev;
        return applyFirstStreamingToken(sealed, {
          id: reservedId,
          token,
          intent,
        });
      });
    });
    scheduleMarkdownRender();
  }, [scheduleMarkdownRender, startTransition, SHELL_WIDTH_EXPANDED]);

  // registerStreamingNode: ref-callback wired to the streaming bubble's div.
  // Called by React when the node mounts/unmounts.
  const registerStreamingNode = useCallback((msgId: string, el: HTMLDivElement | null) => {
    if (msgId !== streamingMsgIdRef.current) return;
    streamingNodeRef.current = el;
    if (el && streamingTextRef.current) {
      // Push any text that arrived before the DOM node was ready.
      el.textContent = streamingTextRef.current;
      scheduleMarkdownRender();
    }
  }, [scheduleMarkdownRender]);

  const flushToken = useCallback(() => {
    // Cancel any pending markdown RAF — the final-answer setMessages is
    // about to take ownership of the row with fully rendered content.
    if (streamingRafRef.current !== null) {
      cancelAnimationFrame(streamingRafRef.current);
      streamingRafRef.current = null;
    }
    const text = streamingTextRef.current;
    const msgId = streamingMsgIdRef.current;
    const node = streamingNodeRef.current;
    if (!msgId) {
      // Clear any imperative content so a transitional re-render doesn't
      // leave stale markdown stacked beneath the next render. The key="streaming"
      // on the streaming div should already cause an unmount, but this is an
      // explicit belt-and-suspenders cleanup for paths that bypass the swap.
      if (node) node.innerHTML = '';
      streamingNodeRef.current = null;
      streamingTextRef.current = '';
      streamingIntentRef.current = null;
      streamingRenderModeRef.current = 'imperative';
      eagerCodeExpansionHoldRef.current = false;
      if (streamingCodeRafRef.current !== null) {
        cancelAnimationFrame(streamingCodeRafRef.current);
        streamingCodeRafRef.current = null;
      }
      return;
    }
    // Placeholder with no tokens yet — keep refs wired so queueToken does not spawn rows.
    if (!text) {
      return;
    }
    // Reset imperative refs BEFORE setMessages so the streaming short-circuit
    // in renderMessageText is no longer active when React re-renders the row.
    // Do NOT blank node.innerHTML here: the user is already looking at this
    // streamed DOM. React will unmount key="streaming" during the same commit;
    // clearing it before that commit creates the visible finalization flicker.
    streamingNodeRef.current = null;
    streamingTextRef.current = '';
    streamingMsgIdRef.current = null;
    streamingIntentRef.current = null;
    streamingRenderModeRef.current = 'imperative';
    if (streamingCodeRafRef.current !== null) {
      cancelAnimationFrame(streamingCodeRafRef.current);
      streamingCodeRafRef.current = null;
    }
    // Keep eagerCodeExpansionHoldRef until the finalized React row mounts; the
    // visibility scanner clears it as soon as it sees a real [data-code-msg].
    // NOT wrapped in startTransition — ordering must hold.
    setMessages((prev) => commitStreamingFlush(prev, msgId, text));
  }, []);

  const tryBeginOverlayAction = useCallback((actionKey: string): boolean => {
    if (overlayActionInFlightRef.current.has(actionKey)) return false;
    const nowMs = Date.now();
    const last = lastOverlayActionRef.current;
    if (
      shouldDedupeOverlayAction({
        actionKey,
        lastActionKey: last?.key ?? null,
        lastAtMs: last?.atMs ?? null,
        nowMs,
      })
    ) {
      return false;
    }
    overlayActionInFlightRef.current.add(actionKey);
    lastOverlayActionRef.current = { key: actionKey, atMs: nowMs };
    return true;
  }, []);

  const endOverlayAction = useCallback((actionKey: string) => {
    overlayActionInFlightRef.current.delete(actionKey);
    // Clear the dedupe stamp once the action has fully completed. The stamp only
    // exists to collapse a near-simultaneous double-fire of the SAME trigger; the
    // in-flight Set already blocks true concurrency. Leaving it set meant a
    // COMPLETED action kept dedupe-blocking the user's next intentional press for
    // up to 5s — making the hotkey feel dead (part of the "What to answer does
    // nothing" P0). A press after completion is fresh intent and must go through.
    if (lastOverlayActionRef.current?.key === actionKey) {
      lastOverlayActionRef.current = null;
    }
  }, []);

  const finalizeStreamingByIntent = useCallback(
    (intent: string, text: string) => {
      // Cross-flow guard. The global `streamingMsgIdRef` can have been
      // reassigned by a DIFFERENT stream between when this finalize's
      // event was emitted (engine side) and when it arrives here (renderer
      // side). Without a check, a late `what_to_answer` finalize would
      // capture whatever id currently lives in the ref — and if a manual
      // chat submit had just installed its own placeholder, the byId
      // path in `finalizeStreamingByIntentMessages` would silently
      // overwrite the chat placeholder with the stale WTA payload (user
      // perceives "my chat message got eaten").
      //
      // Two layers:
      //   1. `shouldAcceptIntelligenceIpc` rejects the specific WTA-over-chat
      //      pattern entirely — late WTA must not clobber an active chat.
      //   2. For any other intent mismatch (e.g. follow-up landing over a
      //      clarify placeholder), pass `null` for streamingMsgId so the
      //      finalize falls through to the by-intent search in
      //      `finalizeStreamingByIntentMessages`, which only updates
      //      isStreaming=true rows of the SAME intent. Cross-intent rows
      //      are left untouched.
      const activeStreamIntent = streamingIntentRef.current;
      const hasActiveOpenStream = streamingMsgIdRef.current != null;
      if (
        !shouldAcceptIntelligenceIpc({
          eventIntent: intent,
          activeStreamIntent,
          hasActiveOpenStream,
        })
      ) {
        return;
      }
      const streamingMsgId =
        activeStreamIntent === intent ? streamingMsgIdRef.current : null;
      const bufferedText = streamingMsgId ? streamingTextRef.current : '';

      if (streamingMsgId && bufferedText) {
        if (streamingRafRef.current !== null) {
          cancelAnimationFrame(streamingRafRef.current);
          streamingRafRef.current = null;
        }
        streamingNodeRef.current = null;
        streamingTextRef.current = '';
        streamingMsgIdRef.current = null;
        streamingIntentRef.current = null;
        streamingRenderModeRef.current = 'imperative';
        if (streamingCodeRafRef.current !== null) {
          cancelAnimationFrame(streamingCodeRafRef.current);
          streamingCodeRafRef.current = null;
        }
        setMessages((prev) =>
          finalizeImperativeStreamMessages(prev, {
            msgId: streamingMsgId,
            intent,
            bufferedText,
            finalText: text,
          }),
        );
        return;
      }

      flushToken();
      setMessages((prev) =>
        finalizeStreamingByIntentMessages(
          prev,
          intent,
          text,
          () => genMessageId(),
          streamingMsgId,
        ),
      );
    },
    [flushToken],
  );

  const pinAnswerPanel = useCallback(() => {
    answerPanelPinnedRef.current = true;
    setAnswerPanelPinned(true);
  }, []);
  pinAnswerPanelRef.current = pinAnswerPanel;

  const prepareIntelligenceStreamPlaceholder = useCallback(
    (intent: string) => {
      flushToken();
      tokenBufRef.current.intent = '';
      tokenBufRef.current.text = '';
      if (tokenBufRef.current.raf !== null) {
        cancelAnimationFrame(tokenBufRef.current.raf);
        tokenBufRef.current.raf = null;
      }
      const placeholderId = genMessageId();
      streamingMsgIdRef.current = placeholderId;
      streamingIntentRef.current = intent;
      streamingTextRef.current = '';
      streamingNodeRef.current = null;
      streamingRenderModeRef.current = 'imperative';
      if (streamingRafRef.current !== null) {
        cancelAnimationFrame(streamingRafRef.current);
        streamingRafRef.current = null;
      }
      if (streamingCodeRafRef.current !== null) {
        cancelAnimationFrame(streamingCodeRafRef.current);
        streamingCodeRafRef.current = null;
      }
      pinAnswerPanel();
      setMessages((prev) =>
        prepareIntelligenceStreamPlaceholderMessages(prev, intent, placeholderId),
      );
    },
    [flushToken, pinAnswerPanel],
  );

  const displayMessages = useMemo(
    () => collapseConsecutiveDuplicateSystemMessages(messages),
    [messages],
  );
  // ──────────────────────────────────────────────────────────────────────────

  const applyRollingPartialPreview = useCallback((partialText: string) => {
    pendingRollingPartialRef.current = partialText;
    if (rollingPartialDebounceRef.current !== null) {
      clearTimeout(rollingPartialDebounceRef.current);
    }
    rollingPartialDebounceRef.current = setTimeout(() => {
      rollingPartialDebounceRef.current = null;
      const text = pendingRollingPartialRef.current;
      pendingRollingPartialRef.current = null;
      if (text == null) return;
      setRollingTranscript((prev) => mergeRollingTranscriptPartial(prev, text));
    }, 80);
  }, []);

  const flushRollingPartialPreview = useCallback(() => {
    if (rollingPartialDebounceRef.current !== null) {
      clearTimeout(rollingPartialDebounceRef.current);
      rollingPartialDebounceRef.current = null;
    }
    const text = pendingRollingPartialRef.current;
    pendingRollingPartialRef.current = null;
    if (text != null) {
      setRollingTranscript((prev) => mergeRollingTranscriptPartial(prev, text));
    }
  }, []);

  // Connect to Native Audio Backend — deps must NOT include isExpanded (see clarify effect).
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // Connection Status
    window.electronAPI
      .getNativeAudioStatus()
      .then((status) => {
        setIsConnected(status.connected);
      })
      .catch(() => setIsConnected(false));

    cleanups.push(
      window.electronAPI.onNativeAudioConnected(() => {
        setIsConnected(true);
      }),
    );
    cleanups.push(
      window.electronAPI.onNativeAudioDisconnected(() => {
        setIsConnected(false);
      }),
    );

    // Real-time Transcripts
    cleanups.push(
      window.electronAPI.onNativeAudioTranscript((transcript) => {
        // When Answer button is active, capture USER transcripts for voice input
        // Use ref to avoid stale closure issue
        if (isRecordingRef.current && transcript.speaker === 'user') {
          if (transcript.final) {
            // Accumulate final transcripts
            setVoiceInput((prev) => {
              const updated = prev + (prev ? ' ' : '') + transcript.text;
              voiceInputRef.current = updated;
              return updated;
            });
            setManualTranscript(''); // Clear partial preview
            manualTranscriptRef.current = '';
          } else {
            // Show live partial transcript
            setManualTranscript(transcript.text);
            manualTranscriptRef.current = transcript.text;
          }
          return; // Don't add to messages while recording
        }

        // Ignore user mic transcripts when not recording
        // Only interviewer (system audio) transcripts should appear in chat
        if (transcript.speaker === 'user') {
          return; // Skip user mic input - only relevant when Answer button is active
        }

        // Only show interviewer (system audio) transcripts in rolling bar
        if (transcript.speaker !== 'interviewer') {
          return; // Safety check for any other speaker types
        }

        // Route to rolling transcript bar — partials debounced; finals commit immediately.
        if (!transcript.final) {
          if (!interviewerSpeakingRef.current) {
            interviewerSpeakingRef.current = true;
            setIsInterviewerSpeaking(true);
          }
          applyRollingPartialPreview(transcript.text);
          return;
        }

        flushRollingPartialPreview();
        interviewerSpeakingRef.current = false;
        setIsInterviewerSpeaking(false);
        setRollingTranscript((prev) => mergeRollingTranscriptFinal(prev, transcript.text));

        setTimeout(() => {
          setIsInterviewerSpeaking(false);
        }, 3000);
      }),
    );

    // AI Suggestions from native audio (legacy)
    cleanups.push(
      window.electronAPI.onSuggestionProcessingStart(() => {
        setIsProcessing(true);
        setIsExpanded(true);
      }),
    );

    cleanups.push(
      window.electronAPI.onSuggestionGenerated((data) => {
        setIsProcessing(false);
        pinAnswerPanel();
        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: data.suggestion,
          },
        ]);
      }),
    );

    cleanups.push(
      window.electronAPI.onSuggestionError((err) => {
        setIsProcessing(false);
        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: `Error: ${err.error}`,
          },
        ]);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceSuggestedAnswerToken((data) => {
        pinAnswerPanel();
        // Coaching now arrives via onIntelligenceNegotiationCoaching only —
        // sentinel detection on this stream has been removed.
        queueToken('what_to_answer', data.token);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceSuggestedAnswer((data) => {
        setIsProcessing(false);
        pinAnswerPanel();
        finalizeStreamingByIntent('what_to_answer', data.answer);
      }),
    );

    // Orphaned-scaffold fix: a WTA stream that showed a coding scaffold ended
    // with no final answer (superseded / declined / errored). Drop the open
    // scaffold row so the user never sees a permanent "Working on…" card.
    // Clear streaming refs FIRST (same ordering rationale as the null-feedback
    // path) so a late token batch can't append onto a row we're removing.
    cleanups.push(
      window.electronAPI.onIntelligenceSuggestedAnswerDiscard?.(() => {
        setIsProcessing(false);
        if (streamingNodeRef.current) streamingNodeRef.current.innerHTML = '';
        streamingNodeRef.current = null;
        streamingTextRef.current = '';
        streamingMsgIdRef.current = null;
        streamingIntentRef.current = null;
        streamingRenderModeRef.current = 'imperative';
        eagerCodeExpansionHoldRef.current = false;
        if (streamingRafRef.current !== null) {
          cancelAnimationFrame(streamingRafRef.current);
          streamingRafRef.current = null;
        }
        if (streamingCodeRafRef.current !== null) {
          cancelAnimationFrame(streamingCodeRafRef.current);
          streamingCodeRafRef.current = null;
        }
        setMessages((prev) => discardStreamingByIntentMessages(prev, 'what_to_answer'));
      }) ?? (() => {}),
    );

    // Verified code execution: the shown code passed its executed test cases.
    // Attach a ✓ badge to the most recent assistant (system) message — but ONLY
    // if it is still the LAST message. If a newer user turn arrived since (the
    // last row is a user/interviewer message), this badge belongs to a now-
    // superseded answer, so we drop it rather than badge the wrong row. (The
    // engine also guards by generationId; this is the renderer-side backstop.)
    cleanups.push(
      window.electronAPI.onIntelligenceCodeVerified?.((data) => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'system') return prev; // superseded by a newer turn
          const next = [...prev];
          next[next.length - 1] = { ...last, codeVerified: { passed: data.passed, total: data.total, language: data.language } };
          return next;
        });
      }) ?? (() => {}),
    );

    // Verified code execution: the shown code FAILED and a (re-verified) fix was
    // produced. REPLACE the wrong answer IN PLACE (same markdown coding card, same
    // format) so the compact overlay doesn't grow — the user always ends on the
    // CORRECT code, marked with a small "corrected" header + ✓ verified badge.
    // Only replace when the wrong card is still the LAST message (same
    // supersession guard as the badge); if a newer turn arrived, append instead
    // so a genuine correction is never silently dropped.
    cleanups.push(
      window.electronAPI.onIntelligenceCodeCorrection?.((data) => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          const corrected = {
            text: data.answer,
            isCode: true,
            isCorrection: true,
            correctionNote: data.note,
            codeVerified: data.reVerified ? { passed: 1, total: 1, language: 'verified' } : undefined,
          };
          if (last && last.role === 'system' && !last.isStreaming) {
            // In-place swap: keep the same message id so React reuses the row.
            const next = [...prev];
            next[next.length - 1] = { ...last, ...corrected };
            return next;
          }
          // Superseded / not a finalized system row → append (never lose the fix).
          return [...prev, { id: `correction-${Date.now()}`, role: 'system', ...corrected }];
        });
      }) ?? (() => {}),
    );

    // Sprint 9: time-batched token channel — single subscription that
    // unrolls a kind-tagged items array onto the existing queueToken path.
    // The 5 per-token channels (intelligence-suggested-answer-token,
    // intelligence-refined-answer-token, etc.) are no longer being sent
    // by main.ts for these streams — their handlers above are now inert
    // safety nets and only fire if some other code path emits them.
    cleanups.push(
      window.electronAPI.onIntelligenceTokenBatch((data) => {
        const { kind, items } = data;
        if (!items || items.length === 0) return;
        if (kind === 'suggested_answer') {
          pinAnswerPanel();
          for (const it of items) queueToken('what_to_answer', (it as any).token);
        } else if (kind === 'refined_answer') {
          for (const it of items) queueToken((it as any).intent, (it as any).token);
        } else if (kind === 'recap') {
          for (const it of items) queueToken('recap', (it as any).token);
        } else if (kind === 'clarify') {
          for (const it of items) queueToken('clarify', (it as any).token);
        } else if (kind === 'follow_up_questions') {
          for (const it of items) queueToken('follow_up_questions', (it as any).token);
        }
      }),
    );

    // Sprint 7: dedicated negotiation-coaching channel.
    // The engine now intercepts the coaching sentinel server-side and
    // emits this event INSTEAD of suggested_answer / suggested_answer_token.
    // Renderer no longer needs JSON.parse-per-token detection (the
    // existing prefix-gated detection paths above are kept as defense-
    // in-depth — they are inert because the engine never sends sentinel
    // tokens through suggested_answer anymore).
    cleanups.push(
      window.electronAPI.onIntelligenceNegotiationCoaching((data) => {
        // Flush any pending streamed tokens before swapping the streaming
        // row to a coaching card; otherwise rAF-buffered text would be
        // appended onto the card row's empty text after this setMessages.
        flushToken();
        setIsProcessing(false);
        const coaching = data.payload;
        setMessages((prev) => {
          const lastMsg = prev[prev.length - 1];
          // If a what_to_answer streaming row is in flight, replace it
          // with the coaching card so the user doesn't see two bubbles.
          if (lastMsg && lastMsg.isStreaming && lastMsg.intent === 'what_to_answer') {
            const updated = [...prev];
            updated[prev.length - 1] = {
              ...lastMsg,
              text: '',
              isStreaming: false,
              isNegotiationCoaching: true,
              negotiationCoachingData: coaching,
            };
            return updated;
          }
          return [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: '',
              intent: 'what_to_answer',
              isNegotiationCoaching: true,
              negotiationCoachingData: coaching,
            },
          ];
        });
      }),
    );

    // STREAMING: Refinement
    cleanups.push(
      window.electronAPI.onIntelligenceRefinedAnswerToken((data) => {
        // PERF: rAF-coalesce per-token state updates.
        queueToken(data.intent, data.token);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceRefinedAnswer((data) => {
        setIsProcessing(false);
        finalizeStreamingByIntent(data.intent, data.answer);
      }),
    );

    // STREAMING: Recap
    cleanups.push(
      window.electronAPI.onIntelligenceRecapToken((data) => {
        queueToken('recap', data.token);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceRecap((data) => {
        setIsProcessing(false);
        finalizeStreamingByIntent('recap', data.summary);
      }),
    );

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

    cleanups.push(
      window.electronAPI.onIntelligenceFollowUpQuestionsToken((data) => {
        queueToken('follow_up_questions', data.token);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceFollowUpQuestionsUpdate((data) => {
        setIsProcessing(false);
        finalizeStreamingByIntent('follow_up_questions', data.questions);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceClarify((data) => {
        setIsProcessing(false);
        finalizeStreamingByIntent('clarify', data.clarification);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceManualResult((data) => {
        setIsProcessing(false);
        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: `🎯 **Answer:**\n\n${data.answer}`,
          },
        ]);
      }),
    );

    cleanups.push(
      window.electronAPI.onIntelligenceError((data) => {
        setIsProcessing(false);
        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: `❌ Error (${data.mode}): ${data.error}`,
          },
        ]);
      }),
    );
    return () => {
      if (rollingPartialDebounceRef.current !== null) {
        clearTimeout(rollingPartialDebounceRef.current);
        rollingPartialDebounceRef.current = null;
      }
      cleanups.forEach((fn) => fn());
    };
  }, [queueToken, flushToken, applyRollingPartialPreview, flushRollingPartialPreview, pinAnswerPanel, finalizeStreamingByIntent]);

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

  // Quick Actions - Updated to use new Intelligence APIs

  // PERF: useCallback so the reference is stable between renders. MessageRow
  // (memoized below) receives this as a prop; without a stable identity its
  // memo comparator would never match and the bailout would not fire.
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    analytics.trackCopyAnswer();
    // Optional: Trigger a small toast or state change for visual feedback
  }, []);

  const handleWhatToSay = async (promptInstruction?: string | React.MouseEvent) => {
    if (!tryBeginOverlayAction('what_to_say')) {
      // The press was blocked because a prior 'what_to_say' is still streaming.
      // Surface a brief hint instead of silently doing nothing, so a blocked
      // press is never indistinguishable from a crash / dead hotkey.
      setMessages((prev) => [
        ...prev,
        { id: genMessageId(), role: 'system', text: 'Still finishing the previous answer — one moment…' },
      ]);
      return;
    }
    const dynamicPromptInstruction =
      typeof promptInstruction === 'string' ? promptInstruction : undefined;
    setIsExpanded(true);
    setIsProcessing(true);
    // Capture and clear attached image context.
    // Also merge in any screenshot from the capture-and-process shortcut that
    // arrived via pendingCaptureRef before the React state flush (React 18 fix).
    const pending = pendingCaptureRef.current;
    let currentAttachments = attachedContext;
    if (pending && !currentAttachments.some((s) => s.path === pending.path)) {
      currentAttachments = [...currentAttachments, pending].slice(-5);
    }

    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      // Show the attached image in chat FIRST — question card must appear before AI response
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'user',
          text: 'What should I say about this?',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
      // Scroll to bottom when user sends message
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }

    // Create AI response placeholder AFTER user message so thinking dots + response
    // appear BELOW the screenshot question card (not above it)
    prepareIntelligenceStreamPlaceholder('what_to_answer');
    analytics.trackCommandExecuted('what_to_say');

    try {
      const rawDomContext = (window as any).lastCapturedDOM;
      const domContext =
        typeof rawDomContext === 'string' && rawDomContext.trim().length > 0
          ? rawDomContext.substring(0, DOM_CONTEXT_MAX_CHARS)
          : undefined;

      // Clear the captured DOM immediately after reading it to ensure stale DOM context
      // from prior pages is never re-sent on subsequent requests.
      if (typeof (window as any).lastCapturedDOM === 'string') {
        (window as any).lastCapturedDOM = '';
      }

      if (domContext) {
        console.debug(`[DOM Context] Forwarding captured active-tab DOM structure (${domContext.length} chars)`);
      }

      const options =
        dynamicPromptInstruction || domContext
          ? {
              ...(dynamicPromptInstruction ? { promptInstruction: dynamicPromptInstruction } : {}),
              ...(domContext ? { domContext } : {}),
            }
          : undefined;

      // Pass imagePath if attached
      const result = await window.electronAPI.generateWhatToSay(
        undefined,
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
        options,
      );
      setScreenContextStatus(result.screenContextStatus || 'not_available');
      setLatestUsedImageInput(Boolean(result.usedImageInput));
      setLatestVisionProviderUsed(result.visionProviderUsed);
      setLatestVisionModelUsed(result.visionModelUsed);
      setLatestVisionFailureReason(result.visionFailureReason);
      if (result.answer == null) {
        const feedback =
          result.error ??
          'Could not generate an answer yet. Wait a few seconds after speech and try again.';
        // CRITICAL ORDERING: clear streaming refs and wipe imperative DOM
        // BEFORE the `setMessages` that commits the null-feedback. The old
        // order called `flushToken()` first — which exits early when
        // `streamingTextRef.current === ''` (the placeholder hasn't received
        // tokens), leaving refs WIRED. If a stray late `suggested_answer_token`
        // batch arrives between the early-return and the ref clears below,
        // `queueToken`'s mid-stream path runs and appends fragment text to
        // the row that just got the feedback — producing
        // "Could not generate an answer yet... <stray fragment>".
        //
        // By clearing refs first, any concurrent token batch sees a null ref
        // and takes the first-token branch instead (which mounts its own
        // row); the null-feedback `setMessages` is then unambiguous.
        if (streamingNodeRef.current) streamingNodeRef.current.innerHTML = '';
        streamingNodeRef.current = null;
        streamingTextRef.current = '';
        streamingMsgIdRef.current = null;
        streamingIntentRef.current = null;
        streamingRenderModeRef.current = 'imperative';
        eagerCodeExpansionHoldRef.current = false;
        if (streamingRafRef.current !== null) {
          cancelAnimationFrame(streamingRafRef.current);
          streamingRafRef.current = null;
        }
        if (streamingCodeRafRef.current !== null) {
          cancelAnimationFrame(streamingCodeRafRef.current);
          streamingCodeRafRef.current = null;
        }
        setMessages((prev) => applyWhatToAnswerNullFeedbackMessages(prev, feedback));
        pinAnswerPanel();
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
      pinAnswerPanel();
    } finally {
      endOverlayAction('what_to_say');
      setIsProcessing(false);
    }
  };

  const handleFollowUp = async (intent: string = 'rephrase') => {
    const actionKey = `follow_up:${intent}`;
    if (!tryBeginOverlayAction(actionKey)) return;
    setIsExpanded(true);
    setIsProcessing(true);
    prepareIntelligenceStreamPlaceholder(intent);
    analytics.trackCommandExecuted('follow_up_' + intent);

    try {
      await window.electronAPI.generateFollowUp(intent);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction(actionKey);
      setIsProcessing(false);
    }
  };

  const handleRecap = async () => {
    if (!tryBeginOverlayAction('recap')) return;
    setIsExpanded(true);
    setIsProcessing(true);
    prepareIntelligenceStreamPlaceholder('recap');
    analytics.trackCommandExecuted('recap');

    try {
      await window.electronAPI.generateRecap();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction('recap');
      setIsProcessing(false);
    }
  };

  const handleFollowUpQuestions = async () => {
    if (!tryBeginOverlayAction('follow_up_questions')) return;
    setIsExpanded(true);
    setIsProcessing(true);
    prepareIntelligenceStreamPlaceholder('follow_up_questions');
    analytics.trackCommandExecuted('suggest_questions');

    try {
      await window.electronAPI.generateFollowUpQuestions();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction('follow_up_questions');
      setIsProcessing(false);
    }
  };

  const handleClarify = async () => {
    if (!tryBeginOverlayAction('clarify')) return;
    setIsExpanded(true);
    setIsProcessing(true);
    prepareIntelligenceStreamPlaceholder('clarify');
    analytics.trackCommandExecuted('clarify');

    try {
      await window.electronAPI.generateClarify();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction('clarify');
      setIsProcessing(false);
    }
  };

  const handleCodeHint = async () => {
    // In-flight guard (every other overlay action has one). Without it a rapid
    // double-press of the code-hint hotkey spawned two concurrent IPC/LLM streams;
    // engine generation-id supersession aborted the older one, but both fired.
    if (!tryBeginOverlayAction('code_hint')) {
      setMessages((prev) => [
        ...prev,
        { id: genMessageId(), role: 'system', text: 'Still generating the code hint — one moment…' },
      ]);
      return;
    }
    setIsExpanded(true);
    setIsProcessing(true);
    pinAnswerPanel();

    const currentAttachments = attachedContext;
    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      // Show the attached image in chat
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'user',
          text: 'Give me a code hint for this',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
      // Scroll to bottom when user sends message
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }

    try {
      await window.electronAPI.generateCodeHint(
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
      );
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction('code_hint');
      setIsProcessing(false);
    }
  };

  const handleBrainstorm = async () => {
    if (!tryBeginOverlayAction('brainstorm')) return;
    setIsExpanded(true);
    setIsProcessing(true);
    prepareIntelligenceStreamPlaceholder('what_to_answer');
    analytics.trackCommandExecuted('brainstorm');

    const currentAttachments = attachedContext;
    if (currentAttachments.length > 0) {
      setAttachedContext([]);
      // Show the attached image in chat
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'user',
          text: 'Brainstorm with this context',
          hasScreenshot: true,
          screenshotPreview: currentAttachments[0].preview,
        },
      ]);
      // Scroll to bottom when user sends message
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    }

    try {
      await window.electronAPI.generateBrainstorm(
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
      );
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: genMessageId(),
          role: 'system',
          text: `Error: ${err}`,
        },
      ]);
    } finally {
      endOverlayAction('brainstorm');
      setIsProcessing(false);
    }
  };
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // Stream Token — rAF-coalesced via queueToken (same path as intelligence streams)
    cleanups.push(
      window.electronAPI.onGeminiStreamToken((token) => {
        queueToken('chat', token);
      }),
    );

    // Stream Done
    cleanups.push(
      window.electronAPI.onGeminiStreamDone((data) => {
        const pendingText = streamingTextRef.current;
        const pendingMsgId = streamingMsgIdRef.current;
        // finalText is set ONLY when the backend's coding validate→repair changed
        // the streamed answer — it authoritatively REPLACES the streamed row text
        // (in-place, by id) so the user sees the corrected six-section markdown.
        // Absent in the common case, where the streamed tokens already stand.
        const finalText = data?.finalText;
        if (streamingRafRef.current !== null) {
          cancelAnimationFrame(streamingRafRef.current);
          streamingRafRef.current = null;
        }
        if (streamingCodeRafRef.current !== null) {
          cancelAnimationFrame(streamingCodeRafRef.current);
          streamingCodeRafRef.current = null;
        }
        streamingNodeRef.current = null;
        streamingTextRef.current = '';
        streamingMsgIdRef.current = null;
        streamingIntentRef.current = null;
        streamingRenderModeRef.current = 'imperative';
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
          latency_ms: latency,
        });

        setMessages((prev) => {
          const idx =
            pendingMsgId != null ? prev.findLastIndex((m) => m.id === pendingMsgId) : -1;
          const target = idx !== -1 ? prev[idx] : prev[prev.length - 1];
          if (target && target.role === 'system') {
            const text = finalText || target.text || pendingText;
            if (!text) return prev;
            const isCode =
              text.includes('```') || text.includes('def ') || text.includes('function ');
            if (idx !== -1) {
              const updated = [...prev];
              updated[idx] = { ...target, text, isStreaming: false, isCode };
              return updated;
            }
            return [...prev.slice(0, -1), { ...target, text, isStreaming: false, isCode }];
          }
          return prev;
        });
      }),
    );

    // Stream Error
    cleanups.push(
      window.electronAPI.onGeminiStreamError((error) => {
        flushToken();
        setIsProcessing(false);
        requestStartTimeRef.current = null; // Clear timer on error
        setMessages((prev) => {
          // Append error to the current message or add new one?
          // Let's add a new error block if the previous one confusing,
          // or just update status.
          // Ideally we want to show the partial response AND the error.
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.isStreaming) {
            const updated = [...prev];
            updated[prev.length - 1] = {
              ...lastMsg,
              isStreaming: false,
              text: lastMsg.text + `\n\n[Error: ${error}]`,
            };
            return updated;
          }
          return [
            ...prev,
            {
              id: genMessageId(),
              role: 'system',
              text: `❌ Error: ${error}`,
            },
          ];
        });
      }),
    );

    // Phone-initiated chat: main process streams tokens via gemini-stream-*; this
    // event adds the user turn + streaming placeholder before tokens arrive.
    cleanups.push(
      window.electronAPI.onPhoneMirrorIncomingChat(({ message }) => {
        flushToken();
        requestStartTimeRef.current = Date.now();
        const userId = genMessageId();
        const placeholderId = `${userId}-reply`;
        streamingMsgIdRef.current = placeholderId;
        streamingIntentRef.current = 'chat';
        streamingTextRef.current = '';
        streamingNodeRef.current = null;
        setMessages((prev) => [
          ...prev,
          { id: userId, role: 'user', text: message },
          {
            id: placeholderId,
            role: 'system',
            text: '',
            intent: 'chat',
            isStreaming: true,
          },
        ]);
        setIsExpanded(true);
        setIsProcessing(true);
        pinAnswerPanel();
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);
      }),
    );

    // JIT RAG Stream listeners (for live meeting RAG responses)
    if (window.electronAPI.onRAGStreamChunk) {
      cleanups.push(
        window.electronAPI.onRAGStreamChunk((data: { chunk: string }) => {
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
              const updated = [...prev];
              updated[prev.length - 1] = {
                ...lastMsg,
                text: lastMsg.text + data.chunk,
                isCode: (lastMsg.text + data.chunk).includes('```'),
              };
              return updated;
            }
            return prev;
          });
        }),
      );
    }

    if (window.electronAPI.onRAGStreamComplete) {
      cleanups.push(
        window.electronAPI.onRAGStreamComplete(() => {
          setIsProcessing(false);
          requestStartTimeRef.current = null;
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.isStreaming && lastMsg.role === 'system') {
              return [...prev.slice(0, -1), { ...lastMsg, isStreaming: false }];
            }
            if (lastMsg && lastMsg.isStreaming) {
              const updated = [...prev];
              updated[prev.length - 1] = { ...lastMsg, isStreaming: false };
              return updated;
            }
            return prev;
          });
        }),
      );
    }

    if (window.electronAPI.onRAGStreamError) {
      cleanups.push(
        window.electronAPI.onRAGStreamError((data: { error: string }) => {
          setIsProcessing(false);
          requestStartTimeRef.current = null;
          setMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.isStreaming) {
              const updated = [...prev];
              updated[prev.length - 1] = {
                ...lastMsg,
                isStreaming: false,
                text: lastMsg.text + `\n\n[RAG Error: ${data.error}]`,
              };
              return updated;
            }
            return prev;
          });
        }),
      );
    }

    return () => cleanups.forEach((fn) => fn());
  }, [currentModel, queueToken, flushToken]); // Ensure tracking captures correct model

  const handleAnswerNow = async () => {
    if (isManualRecording) {
      if (!tryBeginOverlayAction('answer_now')) return;
      try {
        // Stop recording - send accumulated voice input to Gemini
        isRecordingRef.current = false;
        setIsManualRecording(false);
        setManualTranscript('');

        window.electronAPI
          .finalizeMicSTT()
          .catch((err) => console.error('[NativelyInterface] Failed to send finalizeMicSTT:', err));

        const currentAttachments = attachedContext;
        setAttachedContext([]);

        const question = (
          voiceInputRef.current +
          (manualTranscriptRef.current ? ' ' + manualTranscriptRef.current : '')
        ).trim();
        setVoiceInput('');
        voiceInputRef.current = '';
        setManualTranscript('');
        manualTranscriptRef.current = '';

        if (!question && currentAttachments.length === 0) {
          if (sttUserStatus === 'failed' && sttUserError) {
            setMessages((prev) => [
              ...prev,
              {
                id: genMessageId(),
                role: 'system',
                text: `❌ STT Error: ${sttUserError}`,
              },
            ]);
          } else if (sttUserStatus === 'reconnecting') {
            setMessages((prev) => [
              ...prev,
              {
                id: genMessageId(),
                role: 'system',
                text: '⏳ STT is reconnecting, try again in a moment.',
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: genMessageId(),
                role: 'system',
                text: '⚠️ No speech detected. Try speaking closer to your microphone.',
              },
            ]);
          }
          return;
        }

        setMessages((prev) => [
          ...prev,
          {
            id: genMessageId(),
            role: 'user',
            text: question,
            hasScreenshot: currentAttachments.length > 0,
            screenshotPreview: currentAttachments[0]?.preview,
          },
        ]);

        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 50);

        const placeholderId = genMessageId();
        streamingMsgIdRef.current = placeholderId;
        streamingIntentRef.current = 'chat';
        streamingTextRef.current = '';
        streamingNodeRef.current = null;
        if (streamingRafRef.current !== null) {
          cancelAnimationFrame(streamingRafRef.current);
          streamingRafRef.current = null;
        }
        pinAnswerPanel();
        setMessages((prev) => [
          ...prev,
          {
            id: placeholderId,
            role: 'system',
            text: '',
            intent: 'chat',
            isStreaming: true,
          },
        ]);

        setIsProcessing(true);

        try {
          let prompt = '';

          if (currentAttachments.length > 0) {
            prompt = `You are a helper. The user has provided a screenshot and a spoken question/command.
User said: "${question}"

Instructions:
1. Analyze the screenshot in the context of what the user said.
2. Provide a direct, helpful answer.
3. Be concise.`;
          } else {
            const ragResult = await window.electronAPI.ragQueryLive?.(question);
            if (ragResult?.success) {
              return;
            }

            prompt = `You are a real-time interview assistant. The user just repeated or paraphrased a question from their interviewer.
Instructions:
1. Extract the core question being asked
2. Provide a clear, concise, and professional answer that the user can say out loud
3. Keep the answer conversational but informative (2-4 sentences ideal)
4. Do NOT include phrases like "The question is..." - just give the answer directly
5. Format for speaking out loud, not for reading

Provide only the answer, nothing else.`;
          }

          requestStartTimeRef.current = Date.now();
          await window.electronAPI.streamGeminiChat(
            question,
            currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
            prompt,
            { skipSystemPrompt: true },
          );
        } catch (err) {
          setIsProcessing(false);
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.isStreaming && last.text === '') {
              return prev.slice(0, -1).concat({
                id: genMessageId(),
                role: 'system',
                text: `❌ Error starting stream: ${err}`,
              });
            }
            return [
              ...prev,
              {
                id: genMessageId(),
                role: 'system',
                text: `❌ Error: ${err}`,
              },
            ];
          });
        }
      } finally {
        endOverlayAction('answer_now');
      }
    } else {
      // Start recording - reset voice input state
      setVoiceInput('');
      voiceInputRef.current = '';
      setManualTranscript('');
      isRecordingRef.current = true; // Update ref immediately
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

    const userText = inputValue.trim();
    const nowMs = Date.now();
    if (manualSubmitInFlightRef.current) return;
    const last = lastManualSubmitRef.current;
    if (
      shouldDedupeManualSubmit({
        text: userText,
        lastText: last?.text ?? null,
        lastAtMs: last?.atMs ?? null,
        nowMs,
      })
    ) {
      return;
    }
    manualSubmitInFlightRef.current = true;
    lastManualSubmitRef.current = { text: userText, atMs: nowMs };

    const currentAttachments = attachedContext;

    // Clear inputs immediately
    setInputValue('');
    setAttachedContext([]);

    // Seal any in-flight streaming rows from a previous turn before we
    // append the new user message + placeholder. Without this, the rAF
    // token coalescer (queueToken) can append tokens of the next stream
    // onto the prior row whenever the streaming intent matches —
    // surfacing as the next answer starting mid-sentence with leftover
    // text from the previous turn. Also flush any tokens still pending
    // in the rAF buffer so they land on the prior row, not the new one.
    flushToken();
    tokenBufRef.current.intent = '';
    tokenBufRef.current.text = '';
    if (tokenBufRef.current.raf !== null) {
      cancelAnimationFrame(tokenBufRef.current.raf);
      tokenBufRef.current.raf = null;
    }
    setMessages((prev) =>
      prev.some((m) => m.isStreaming)
        ? prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
        : prev,
    );

    setMessages((prev) => [
      ...prev,
      {
        id: genMessageId(),
        role: 'user',
        text: userText || (currentAttachments.length > 0 ? 'Analyze this screenshot' : ''),
        hasScreenshot: currentAttachments.length > 0,
        screenshotPreview: currentAttachments[0]?.preview,
      },
    ]);

    // Scroll to bottom when user sends message
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);

    // Add placeholder for streaming response — wire queueToken to this row so
    // the first gemini-stream-token does not spawn a second streaming bubble.
    const placeholderId = genMessageId();
    streamingMsgIdRef.current = placeholderId;
    streamingIntentRef.current = 'chat';
    streamingTextRef.current = '';
    streamingNodeRef.current = null;
    streamingRenderModeRef.current = 'imperative';
    if (streamingRafRef.current !== null) {
      cancelAnimationFrame(streamingRafRef.current);
      streamingRafRef.current = null;
    }
    if (streamingCodeRafRef.current !== null) {
      cancelAnimationFrame(streamingCodeRafRef.current);
      streamingCodeRafRef.current = null;
    }
    setMessages((prev) => [
      ...prev,
      {
        id: placeholderId,
        role: 'system',
        text: '',
        intent: 'chat',
        isStreaming: true,
      },
    ]);

    setIsExpanded(true);
    setIsProcessing(true);
    pinAnswerPanel();

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
        currentAttachments.length > 0 ? currentAttachments.map((s) => s.path) : undefined,
        conversationContext, // Pass context so "answer this" works
      );
    } catch (err) {
      setIsProcessing(false);
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.isStreaming && last.text === '') {
          // remove the empty placeholder
          return prev.slice(0, -1).concat({
            id: genMessageId(),
            role: 'system',
            text: `❌ Error starting stream: ${err}`,
          });
        }
        return [
          ...prev,
          {
            id: genMessageId(),
            role: 'system',
            text: `❌ Error: ${err}`,
          },
        ];
      });
    } finally {
      manualSubmitInFlightRef.current = false;
    }
  };

  // Refresh the latest-handler ref on every render so the captured-key
  // listener (mounted with [] deps) calls the CURRENT closure, not a
  // stale snapshot from first render.
  handleManualSubmitRef.current = handleManualSubmit;

  const clearChat = () => {
    setMessages([]);
    answerPanelPinnedRef.current = false;
    setAnswerPanelPinned(false);
    lastManualSubmitRef.current = null;
    manualSubmitInFlightRef.current = false;
  };

  // PERF: useCallback so MessageRow's memo comparator can rely on a stable
  // function identity. Deps are the things the closure actually reads that
  // can change: theme + memoized markdown components + memoized appearance.
  // setMessages is a stable React setter and isLightTheme drives both the
  // other deps so its inclusion is mostly defensive.
  const renderMessageText = useCallback(
    (msg: Message) => {
      const cardBgBorderClass = isLightTheme
        ? 'bg-slate-100/70 backdrop-blur-md border border-slate-200/50 text-slate-900 shadow-sm'
        : 'bg-zinc-800/60 backdrop-blur-md border border-zinc-700/40 text-zinc-100 shadow-md';

      const labelColorClass = isLightTheme ? 'text-slate-500' : 'text-slate-400';
      const headerBorderClass = isLightTheme ? 'border-b pb-1.5 border-black/5' : 'border-b pb-1.5 border-white/5';

      // ── Imperative streaming short-circuit ──────────────────────────────
      // While the message is mid-stream, render a plain div with a ref so
      // queueToken can write rendered markdown HTML directly to the DOM node
      // without going through React reconciliation.
      // On stream completion, flushToken() resets streamingMsgIdRef and the
      // next render falls through to the normal intent-specific path below.
      const isActiveReactCodeStream =
        msg.id === streamingMsgIdRef.current && streamingRenderModeRef.current === 'react-code';
      if (msg.isStreaming && msg.role === 'system' && !msg.isNegotiationCoaching && !isActiveReactCodeStream) {
        if (msg.id === streamingMsgIdRef.current) {
          // CRITICAL: key="streaming" forces React to UNMOUNT this div (taking
          // the imperative innerHTML with it) when the row transitions to the
          // finalized "Code Solution" / "Say this" / etc. branches below. Those
          // branches return a div with no key — React sees different keys and
          // mounts a fresh DOM node instead of reusing this one.
          //
          // Without the key, React reuses the same <div> across the streaming
          // and finalized JSX (same type, same position). The fiber's child list
          // says []  (the streaming JSX has no children), so on reconciliation
          // React APPENDS the new finalized children to whatever innerHTML the
          // imperative path wrote — the user sees the streaming markdown
          // STACKED on top of the React-rendered "Code Solution" tree, which is
          // exactly the duplicate-answer bug.
          const isThinking = !msg.text;
          return (
            <div
              key="streaming"
              ref={(el) => registerStreamingNode(msg.id, el)}
              className={`${
                isThinking
                  ? 'w-fit px-[16.5px] py-[12.5px]'
                  : 'w-full p-[14px_18px]'
              } rounded-[20px] rounded-tl-[4px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 markdown-content whitespace-pre-wrap text-[14.5px] leading-relaxed`}
            >
              {/*
               * Typing-dots indicator INSIDE the streaming bubble. Renders
               * while no tokens have arrived yet (text === ''). When the first
               * token lands, queueToken's mid-stream path does
               *   streamingNodeRef.current.textContent = streamingTextRef.current
               * which REPLACES these React-rendered children with a text node,
               * and the subsequent RAF replaces that with marked.parse HTML.
               *
               * React's fiber still thinks the children are these dots — but
               * because we never re-trigger the streaming branch with
               * different JSX while text is flowing, no reconciliation kicks
               * in and the imperative DOM persists. Once the row finalizes,
               * key="streaming" causes a full unmount, so the dots-vs-text
               * discrepancy never causes a reconciliation conflict.
               *
               * Placing the dots INSIDE the bubble (instead of as a separate
               * pill below the message list) gives the classic messaging
               * "typing indicator" UX — the dots appear where the answer
               * will, then smoothly hand off to the answer text.
               */}
              {!msg.text && (
                <div className="flex gap-1.5 items-center py-0.5">
                  <div
                    className={`w-2 h-2 ${isLightTheme ? 'bg-slate-400' : 'bg-white'} rounded-full animate-bounce`}
                    style={{ animationDelay: '0ms' }}
                  />
                  <div
                    className={`w-2 h-2 ${isLightTheme ? 'bg-slate-400' : 'bg-white'} rounded-full animate-bounce`}
                    style={{ animationDelay: '150ms' }}
                  />
                  <div
                    className={`w-2 h-2 ${isLightTheme ? 'bg-slate-400' : 'bg-white'} rounded-full animate-bounce`}
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
              )}
            </div>
          );
        }
        // Handoff gap after flushToken(): imperative ref cleared but React has
        // not yet reconciled — keep showing accumulated text instead of blank.
        if (msg.text) {
          return (
            <div key="streaming" className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 markdown-content whitespace-pre-wrap text-[14.5px] leading-relaxed`}>{msg.text}</div>
          );
        }
      }
      // ────────────────────────────────────────────────────────────────────

      // Negotiation coaching card takes priority
      if (msg.isNegotiationCoaching && msg.negotiationCoachingData) {
        return (
          <NegotiationCoachingCard
            {...msg.negotiationCoachingData}
            phase={msg.negotiationCoachingData.phase as any}
            interfaceTheme={interfaceTheme}
            isLightTheme={isLightTheme}
            onSilenceTimerEnd={() => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === msg.id
                    ? {
                        ...m,
                        negotiationCoachingData: m.negotiationCoachingData
                          ? { ...m.negotiationCoachingData, showSilenceTimer: false }
                          : undefined,
                      }
                    : m,
                ),
              );
            }}
          />
        );
      }

      // Code-containing messages get special styling
      // We split by code blocks to keep the "Code Solution" UI intact for the code parts
      // But use ReactMarkdown for the text parts around it
      if (msg.isCode || (msg.role === 'system' && msg.text.includes('```'))) {
        const parts = msg.text.split(/(```[\s\S]*?(?:```|$))/g);
        return (
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="space-y-2 text-[14.5px] leading-relaxed">
              {parts.map((part, i) => {
                if (part.startsWith('```')) {
                  const match = part.match(/```(\w*)\s+([\s\S]*?)(?:```|$)/);
                  if (match || part.startsWith('```')) {
                    const lang = match && match[1] ? match[1] : 'python';
                    const code = (match && match[2]
                      ? match[2]
                      : part.replace(/^```\w*\s*/, '').replace(/```$/, '')).trim();
                    return (
                      <HighlightedCode
                        key={i}
                        code={code}
                        lang={lang}
                        isLightTheme={isLightTheme}
                        codeTheme={codeTheme}
                        codeBlockClass={codeBlockClass}
                        codeHeaderClass={codeHeaderClass}
                        codeHeaderTextClass={codeHeaderTextClass}
                        codeLineNumberColor={codeLineNumberColor}
                        appearance={appearance}
                        isModernTheme={isModernTheme}
                        isGlassTheme={isGlassTheme}
                      />
                    );
                  }
                }
                // Regular text - Render with Markdown
                return (
                  <div key={i} className="markdown-content">
                    <ReactMarkdown
                      remarkPlugins={REMARK_PLUGINS}
                      rehypePlugins={REHYPE_PLUGINS}
                      components={mdComponents.codeText}
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
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="text-[14.5px] leading-relaxed markdown-content">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={mdComponents.shortenText}
              >
                {msg.text}
              </ReactMarkdown>
            </div>
          </div>
        );
      }

      if (msg.intent === 'recap') {
        return (
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="text-[14.5px] leading-relaxed markdown-content">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={mdComponents.recapText}
              >
                {msg.text}
              </ReactMarkdown>
            </div>
          </div>
        );
      }

      if (msg.intent === 'follow_up_questions') {
        return (
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="text-[14.5px] leading-relaxed markdown-content">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={mdComponents.followUpQuestionsText}
              >
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
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="text-[14.5px] leading-relaxed">
              {parts.map((part, i) => {
                if (part.startsWith('```')) {
                  // Robust matching: handles unclosed blocks for streaming (```...$)
                  const match = part.match(/```(\w*)\s+([\s\S]*?)(?:```|$)/);

                  // Fallback logic: if it starts with ticks, treat as code (even if unclosed)
                  if (match || part.startsWith('```')) {
                    const lang = match && match[1] ? match[1] : 'python';
                    let code = '';

                    if (match && match[2]) {
                      code = match[2].trim();
                    } else {
                      // Manual strip if regex failed
                      code = part
                        .replace(/^```\w*\s*/, '')
                        .replace(/```$/, '')
                        .trim();
                    }

                    return (
                      <HighlightedCode
                        key={i}
                        code={code}
                        lang={lang}
                        isLightTheme={isLightTheme}
                        codeTheme={codeTheme}
                        codeBlockClass={codeBlockClass}
                        codeHeaderClass={codeHeaderClass}
                        codeHeaderTextClass={codeHeaderTextClass}
                        codeLineNumberColor={codeLineNumberColor}
                        appearance={appearance}
                        isModernTheme={isModernTheme}
                        isGlassTheme={isGlassTheme}
                      />
                    );
                  }
                }
                // Regular text - Render Markdown
                return (
                  <div key={i} className="markdown-content">
                    <ReactMarkdown
                      remarkPlugins={REMARK_PLUGINS}
                      rehypePlugins={REHYPE_PLUGINS}
                      components={mdComponents.whatToAnswerText}
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

      // Fallback for general system/chat messages to ensure they maintain card structure after streaming ends
      if (msg.role === 'system' && !msg.isNegotiationCoaching) {
        return (
          <div className={`w-full rounded-[20px] rounded-tl-[4px] p-[14px_18px] ai-response-card ${cardBgBorderClass} my-2.5 transition-all duration-300 relative group`}>
            <div className="absolute top-[-16px] right-[-16px] z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none group-hover:pointer-events-auto">
              <CardCopyButton
                text={msg.text}
                onCopy={handleCopy}
                isLightTheme={isLightTheme}
                isModernTheme={isModernTheme}
                isGlassTheme={isGlassTheme}
              />
            </div>
            <div className="text-[14.5px] leading-relaxed markdown-content">
              <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                components={mdComponents.standard}
              >
                {msg.text}
              </ReactMarkdown>
            </div>
          </div>
        );
      }

      // Standard Text Messages (e.g. from User or Interviewer)
      // We still want basic markdown support here too
      return (
        <div className="markdown-content">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            rehypePlugins={REHYPE_PLUGINS}
            components={mdComponents.standard}
          >
            {msg.text}
          </ReactMarkdown>
        </div>
      );
    },
    [isLightTheme, mdComponents, appearance],
  );

  // We use a ref to hold the latest handlers to avoid re-binding the event listener on every render
  const handlersRef = useRef({
    handleWhatToSay,
    handleFollowUp,
    handleFollowUpQuestions,
    handleRecap,
    handleAnswerNow,
    handleClarify,
    handleCodeHint,
    handleBrainstorm,
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
    handleBrainstorm,
  };

  useEffect(() => {
    // ── Continuous, frame-rate-independent scroll with momentum ──
    // Velocity is integrated against real elapsed time so 60Hz, 120Hz, and
    // dropped-frame paths all produce the same physical speed. While a key
    // is held we ease velocity up to TERMINAL; on release we decay it
    // exponentially, which is what makes the stop feel weighted instead of
    // snapped. Sub-pixel motion is preserved via a fractional accumulator,
    // and we write `scrollTop` directly to bypass any browser scroll-behavior
    // smoothing that would fight the loop.
    const TERMINAL_VELOCITY = 1400; // px/s at full hold
    const ACCEL_SECONDS = 0.18; // time to reach terminal from rest
    const DECAY_HALF_LIFE = 0.09; // seconds for velocity to halve after release
    const DECAY_K = Math.LN2 / DECAY_HALF_LIFE;
    const MIN_VELOCITY = 6; // px/s — snap to 0 below this
    const MAX_FRAME_DT = 0.05; // clamp to absorb tab-throttle hiccups

    let direction: -1 | 0 | 1 = 0; // -1 up, 0 idle, 1 down (or both up+down → 0)
    let upHeld = false;
    let downHeld = false;
    let velocity = 0; // signed px/s
    let positionFraction = 0; // sub-pixel accumulator
    let lastTs = 0;
    let rafId: number | null = null;

    const recomputeDirection = () => {
      direction = upHeld === downHeld ? 0 : upHeld ? -1 : 1;
    };

    const tick = (ts: number) => {
      const container = scrollContainerRef.current;
      if (!container) {
        rafId = null;
        lastTs = 0;
        return;
      }
      if (lastTs === 0) lastTs = ts;
      const dt = Math.min((ts - lastTs) / 1000, MAX_FRAME_DT);
      lastTs = ts;

      if (direction !== 0) {
        const target = direction * TERMINAL_VELOCITY;
        const step = (TERMINAL_VELOCITY / ACCEL_SECONDS) * dt;
        if (Math.abs(target - velocity) <= step) velocity = target;
        else velocity += Math.sign(target - velocity) * step;
      } else {
        velocity *= Math.exp(-DECAY_K * dt);
        if (Math.abs(velocity) < MIN_VELOCITY) velocity = 0;
      }

      // Cache layout reads once per frame, then a single scrollTop write.
      const maxScroll = container.scrollHeight - container.clientHeight;
      const current = container.scrollTop;
      const move = velocity * dt + positionFraction;
      const intMove = Math.trunc(move);
      positionFraction = move - intMove;

      if (intMove !== 0) {
        let next = current + intMove;
        if (next <= 0) {
          next = 0;
          if (velocity < 0) {
            velocity = 0;
            positionFraction = 0;
          }
        } else if (next >= maxScroll) {
          next = maxScroll;
          if (velocity > 0) {
            velocity = 0;
            positionFraction = 0;
          }
        }
        if (next !== current) container.scrollTop = next;
      }

      if (direction !== 0 || velocity !== 0) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = null;
        lastTs = 0;
        positionFraction = 0;
      }
    };

    const startScrollLoop = () => {
      if (rafId === null) rafId = requestAnimationFrame(tick);
    };
    const releaseScroll = () => {
      upHeld = false;
      downHeld = false;
      recomputeDirection();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const {
        handleWhatToSay,
        handleFollowUp,
        handleFollowUpQuestions,
        handleRecap,
        handleAnswerNow,
        handleClarify,
        handleCodeHint,
        handleBrainstorm,
      } = handlersRef.current;

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
      } else if (isShortcutPressed(e, 'codeHint')) {
        e.preventDefault();
        handleCodeHint();
      } else if (isShortcutPressed(e, 'brainstorm')) {
        e.preventDefault();
        handleBrainstorm();
      } else if (isShortcutPressed(e, 'scrollUp')) {
        e.preventDefault();
        upHeld = true;
        recomputeDirection();
        startScrollLoop();
      } else if (isShortcutPressed(e, 'scrollDown')) {
        e.preventDefault();
        downHeld = true;
        recomputeDirection();
        startScrollLoop();
      } else if (isShortcutPressed(e, 'moveWindowUp') || isShortcutPressed(e, 'moveWindowDown')) {
        // Prevent default scrolling when moving window
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Users typically lift the modifier (Cmd/Ctrl) first, so releasing
      // either it or the arrow ends the hold and lets momentum decay.
      if (e.key === 'ArrowUp') {
        upHeld = false;
        recomputeDirection();
      } else if (e.key === 'ArrowDown') {
        downHeld = false;
        recomputeDirection();
      } else if (e.key === 'Meta' || e.key === 'Control') {
        releaseScroll();
      }
    };

    // Window blur swallows keyup; reset to avoid stuck scrolling.
    const handleBlur = () => releaseScroll();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
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
        answerPanelPinnedRef.current = false;
        setAnswerPanelPinned(false);
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
        console.error('Error triggering screenshot:', err);
      }
    },
    selectiveScreenshot: async () => {
      try {
        const data = await window.electronAPI.takeSelectiveScreenshot();
        if (data && !data.cancelled && data.path) {
          handleScreenshotAttach(data as { path: string; preview: string });
        }
      } catch (err) {
        console.error('Error triggering selective screenshot:', err);
      }
    },
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
        answerPanelPinnedRef.current = false;
        setAnswerPanelPinned(false);
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
        console.error('Error triggering screenshot:', err);
      }
    },
    selectiveScreenshot: async () => {
      try {
        const data = await window.electronAPI.takeSelectiveScreenshot();
        if (data && !data.cancelled && data.path) {
          handleScreenshotAttach(data as { path: string; preview: string });
        }
      } catch (err) {
        console.error('Error triggering selective screenshot:', err);
      }
    },
  };

  useEffect(() => {
    const handleGeneralKeyDown = (e: KeyboardEvent) => {
      const handlers = generalHandlersRef.current;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

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

      setAttachedContext((prev) => {
        if (prev.some((s) => s.path === data.path)) return prev;
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

  // Inertial-scroll engine. Each globalShortcut fire kicks velocity on one
  // axis; a single RAF loop integrates position with friction. A lone tap
  // glides ~250ms then decays; rapid taps sustain motion. Needed because
  // Carbon HotKey on macOS does not auto-repeat with Cmd held, so naive
  // per-fire scrollBy(100px) produces stuttery, taps-only motion.
  const inertialScrollRef = useRef<{
    kick: (axis: 'vert' | 'horiz', direction: -1 | 1) => void;
  } | null>(null);

  useEffect(() => {
    const KICK_VELOCITY = 900; // px/s added per press
    const TERMINAL_VELOCITY = 3200; // px/s clamp
    const FRICTION_HALF_LIFE = 0.16; // seconds for velocity to halve
    const MIN_VELOCITY = 8; // px/s — snap to zero below
    const MAX_FRAME_DT = 0.05; // clamp for tab-throttle hiccups

    const state = {
      raf: null as number | null,
      lastTs: 0,
      vert: { vel: 0, target: null as HTMLElement | null, frac: 0 },
      horiz: { vel: 0, target: null as HTMLElement | null, frac: 0 },
    };

    const resolveHorizontalTarget = (container: HTMLElement): HTMLElement | null => {
      const containerRect = container.getBoundingClientRect();
      const containerCenter = (containerRect.top + containerRect.bottom) / 2;

      const preElements = container.querySelectorAll('pre');
      let best: HTMLElement | null = null;
      let bestDistance = Infinity;

      preElements.forEach((pre) => {
        // Walk up from <pre> until we find the actual horizontal scroller.
        // Markdown renderers often wrap <pre> in a div that holds overflow-x.
        let scroller: HTMLElement | null = pre as HTMLElement;
        while (scroller && scroller !== container) {
          if (scroller.scrollWidth > scroller.clientWidth + 1) break;
          scroller = scroller.parentElement;
        }
        if (!scroller || scroller === container) return;
        if (scroller.scrollWidth <= scroller.clientWidth + 1) return;

        const rect = scroller.getBoundingClientRect();
        if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) return;

        const distance = Math.abs((rect.top + rect.bottom) / 2 - containerCenter);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = scroller;
        }
      });

      return best;
    };

    const tick = (ts: number) => {
      if (state.lastTs === 0) state.lastTs = ts;
      const dt = Math.min((ts - state.lastTs) / 1000, MAX_FRAME_DT);
      state.lastTs = ts;
      const decay = Math.pow(0.5, dt / FRICTION_HALF_LIFE);

      const stepAxis = (axis: 'vert' | 'horiz') => {
        const a = state[axis];
        if (Math.abs(a.vel) < MIN_VELOCITY || !a.target) {
          a.vel = 0;
          a.frac = 0;
          a.target = null;
          return false;
        }
        const move = a.vel * dt + a.frac;
        const intMove = Math.trunc(move);
        a.frac = move - intMove;
        if (intMove !== 0) {
          if (axis === 'vert') a.target.scrollTop += intMove;
          else a.target.scrollLeft += intMove;
        }
        a.vel *= decay;
        return true;
      };

      const vertActive = stepAxis('vert');
      const horizActive = stepAxis('horiz');

      if (vertActive || horizActive) {
        state.raf = requestAnimationFrame(tick);
      } else {
        state.raf = null;
        state.lastTs = 0;
      }
    };

    const kick = (axis: 'vert' | 'horiz', direction: -1 | 1) => {
      const container = scrollContainerRef.current;
      if (!container) return;

      let target: HTMLElement | null;
      if (axis === 'vert') {
        target = container;
      } else {
        target = resolveHorizontalTarget(container);
        // No visible scrollable code block → no-op rather than scrolling
        // an off-screen one or shaking the chat container sideways.
        if (!target) return;
      }

      const a = state[axis];
      // Reverse direction: reset rather than fight existing momentum.
      if (a.target !== target || Math.sign(a.vel) === -direction) {
        a.vel = 0;
        a.frac = 0;
      }
      a.target = target;
      const next = a.vel + direction * KICK_VELOCITY;
      a.vel = Math.max(-TERMINAL_VELOCITY, Math.min(TERMINAL_VELOCITY, next));

      if (state.raf === null) state.raf = requestAnimationFrame(tick);
    };

    inertialScrollRef.current = { kick };

    return () => {
      if (state.raf !== null) cancelAnimationFrame(state.raf);
      inertialScrollRef.current = null;
    };
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
      } else if (action === 'answer') handlers.handleAnswerNow();
      else if (action === 'clarify') handlers.handleClarify();
      else if (action === 'codeHint') handlers.handleCodeHint();
      else if (action === 'brainstorm') handlers.handleBrainstorm();
      else if (action === 'scrollUp') inertialScrollRef.current?.kick('vert', -1);
      else if (action === 'scrollDown') inertialScrollRef.current?.kick('vert', 1);
      else if (action === 'scrollLeft') inertialScrollRef.current?.kick('horiz', -1);
      else if (action === 'scrollRight') inertialScrollRef.current?.kick('horiz', 1);
      else if (action === 'focusInput') {
        // Stealth-focus the chat input: the panel-type overlay (macOS) is
        // already key without activating the app. We just need the input
        // element to be the active DOM target so keystrokes land in it.
        // Defer to next frame so an expand-from-collapsed has time to
        // mount the input before .focus() runs.
        setIsExpanded(true);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => textInputRef.current?.focus());
        });
      } else if (action === 'processScreenshots') generalHandlers.processScreenshots();
      else if (action === 'resetCancel') generalHandlers.resetCancel();
      else if (action === 'takeScreenshot') generalHandlers.takeScreenshot();
      else if (action === 'selectiveScreenshot') generalHandlers.selectiveScreenshot();

      // Safety reset if it didn't trigger an expansion
      setTimeout(() => {
        isStealthRef.current = false;
      }, 500);
    });
    return unsubscribe;
  }, []);

  // ── Stealth keyboard tap (CGEventTap) — true Cluely-grade input path ──
  //
  // When the OS-level tap is engaged (toggled by Cmd/Ctrl+Shift+Space),
  // every keystroke is captured BEFORE the foreground app sees it and
  // forwarded here. We append `chars` directly to inputValue without ever
  // touching DOM focus — the chat input never has to be the active element,
  // so the panel never has to be the key window. Zoom/browser stays as the
  // OS frontmost+key application throughout the entire typing session.
  //
  // HID virtual keycodes referenced below (stable across layouts):
  //   36 = Return,  48 = Tab,  51 = Delete (Backspace),  53 = Esc,
  //   76 = Numpad Enter,  123 = Left,  124 = Right,  125 = Down,  126 = Up.
  useEffect(() => {
    if (!window.electronAPI?.onStealthTapState || !window.electronAPI?.onStealthKeyCaptured) return;

    // Effect-scoped flag set when Esc is observed in the captured-key
    // stream. Suppresses non-Esc events that may have been queued by the
    // worker thread before the user pressed Esc. Cleared on each new
    // active=true state event (a new tap session). Hoisted here so both
    // listeners see the same binding.
    let escSuppressUntilNextActive = false;

    const unsubState = window.electronAPI.onStealthTapState(({ active, reason }) => {
      stealthTapActiveRef.current = active;
      setStealthTapActive(active);
      if (active) {
        isCgEventTapAvailableRef.current = true;
        // Auto-expand the overlay so the user can see what they're
        // typing. We do NOT call .focus() — the whole point of the
        // tap is to avoid window-level focus.
        isStealthRef.current = true;
        setIsExpanded(true);
        setStealthPermissionMissing(false);
        escSuppressUntilNextActive = false;
      }
      if (!active && reason === 'permission') {
        isCgEventTapAvailableRef.current = false;
        setStealthPermissionMissing(true);
      }
    });

    const unsubKey = window.electronAPI.onStealthKeyCaptured((ev) => {
      // CONTRACT WITH RUST: keyboard_tap.rs pass-through filter (R3)
      // returns the event unmodified for ANY system-modifier key
      // (Cmd / Ctrl / Option / Fn) and for ALL F-keys, so the OS
      // routes those normally to the foreground app. Consequence:
      // (ev.flags & CMD) is NEVER true here, neither is OPT or CTRL.
      // The previous round had Cmd+Enter / Cmd+Backspace / Cmd+A /
      // Option+Backspace branches — all dead code under R3. Removed
      // to prevent a false sense of feature support; if Rust ever
      // changes the filter to deliver Cmd events, those branches
      // need to be REINTRODUCED with explicit testing, not
      // resurrected from a TODO.

      // Esc handled regardless of active state (main process broadcasts
      // it BEFORE stopping the tap, so we get here while still active;
      // see StealthKeyboardManager.handleCapturedKey ordering).
      if (ev.isKeyDown && ev.keyCode === 53) {
        setInputValue('');
        escSuppressUntilNextActive = true;
        return;
      }

      // Belt-and-braces clear of the Esc-suppress flag on the first
      // key event of a new session. State and captured-key arrive on
      // separate IPC channels and ordering across channels is NOT
      // guaranteed — if the first keystroke of a new session arrives
      // before the state-active broadcast, the suppress flag (set by
      // a prior Esc) would still be true and the keystroke would be
      // dropped. We re-check the ref (which the state listener flips
      // synchronously on receipt): if the ref is now true, this is a
      // legitimate new-session keystroke → clear suppress and proceed.
      if (escSuppressUntilNextActive && stealthTapActiveRef.current) {
        console.warn(
          '[stealth] cross-channel race resolved by ref check — captured-key arrived before state event',
        );
        escSuppressUntilNextActive = false;
      }
      if (escSuppressUntilNextActive) return; // drop late-arriving keys after Esc
      if (!stealthTapActiveRef.current) return; // ignore other events after stop
      if (!ev.isKeyDown) return; // we only act on keyDown

      switch (ev.keyCode) {
        case 36: // Return
        case 76: // Numpad Enter
          handleManualSubmitRef.current();
          window.electronAPI.stealthTapStop().catch(() => {});
          return;
        case 51: // Backspace — delete one char
          setInputValue((prev) => prev.slice(0, -1));
          return;
        // ROUND 4 FIX (#6): Tab (48) and arrows (123-126) used to
        // be no-op'd here. They're now passed through at the Rust
        // layer (keyboard_tap.rs F-key whitelist) so they reach the
        // user's foreground app normally. Removing the dead cases
        // keeps the contract honest: this switch only sees text-
        // worthy keys + Backspace + Enter. If anyone ever changes
        // the Rust filter to deliver Tab again, decide explicitly
        // what it should do here rather than copy-pasting a no-op.
      }

      // Append printable chars. CGEventKeyboardGetUnicodeString already
      // honors the active layout, dead keys, and IME — we don't need to
      // re-derive characters from keyCode + modifiers ourselves. Filter
      // shift-only modifier (it's already encoded in the chars).
      if (
        ev.chars &&
        ev.chars.length > 0 &&
        ev.chars !== '\r' &&
        ev.chars !== '\n' &&
        ev.chars !== '\t'
      ) {
        setInputValue((prev) => prev + ev.chars);
      }
    });

    return () => {
      unsubState();
      unsubKey();
    };
  }, []);

  // ── Stealth hotkey registration-failure listener ──
  //
  // KeybindManager fires this when globalShortcut.register() returns false
  // (the OS or another app owns the accelerator). Without surfacing it,
  // the user presses the hotkey, nothing happens, and they assume the
  // stealth feature is broken. We filter to the stealth-typing keybind
  // and render an inline banner pointing to Settings → Shortcuts.
  useEffect(() => {
    if (!window.electronAPI?.onKeybindRegistrationFailed) return;
    const unsubscribe = window.electronAPI.onKeybindRegistrationFailed(({ id, accelerator }) => {
      if (id !== 'chat:focusInput') return;
      setStealthHotkeyConflict(accelerator);
    });
    return unsubscribe;
  }, []);

  // ── Click-to-activate: engage CGEventTap on chat-input click only
  //    (opt-IN model) ──
  //
  // ROUND 3 FIX (#1): previously this listener engaged the tap on ANY
  // mousedown anywhere in the overlay (opt-OUT via data-stealth-ignore).
  // That model broke hard: clicking the Settings button engaged the tap,
  // then Settings opened and the user couldn't type their API key (tap
  // intercepted at OS level → keystrokes went to Natively's read-only
  // chat input). Worse, every NEW button added to the overlay was a
  // regression risk — forgetting `data-stealth-ignore` re-introduced the
  // bug silently.
  //
  // Inverted to opt-IN: tap ONLY engages when the user clicks an element
  // marked with `data-stealth-engage="true"` (the chat input wrapper).
  // Buttons run their normal onClick handlers without engaging the tap.
  // Two paths still let the user start typing stealth-style:
  //   • Click the chat input → tap engages → DOM focus blocked → type
  //   • Press the activation hotkey (Cmd/Ctrl+Shift+Space) → tap engages
  //
  // mousedown (not click) so we engage BEFORE the input would otherwise
  // take DOM focus — preventing the panel from becoming key window, which
  // is the precise event coding-interview platforms detect via blur.
  useEffect(() => {
    const stealthTapShouldAutoEngage = window.electronAPI?.stealthTapShouldAutoEngage;
    const stealthTapAvailable = window.electronAPI?.stealthTapStart;
    if (!stealthTapAvailable) return;

    // Resolve the IME-safety policy once at mount. While the promise is in
    // flight we keep the default (true) so users on plain ASCII layouts
    // see no behaviour change. The probe runs on the main process via
    // `defaults read com.apple.HIToolbox`; see electron/services/
    // ImeDetector.ts for the reason this gate exists at all.
    // Probe for IME state (Pinyin, Hangul, Kanji). Result refines
    // stealthAutoEngageOkRef from its safe-true default; we do NOT
    // need to re-check CGEventTap availability here — the synchronous
    // window.electronAPI.platform guard above already covers that.
    if (stealthTapShouldAutoEngage) {
      stealthTapShouldAutoEngage()
        .then((ok) => {
          stealthAutoEngageOkRef.current = !!ok;
        })
        .catch(() => {
          /* fail open — keep default */
        });
    }

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const isStealthEngageTarget = Boolean(target?.closest?.('[data-stealth-engage="true"]'));
      if (
        !shouldFireStealthTapStart({
          stealthTapActive: stealthTapActiveRef.current,
          stealthAutoEngageOk: stealthAutoEngageOkRef.current,
          isStealthEngageTarget,
        })
      ) {
        return;
      }
      if (!isCgEventTapAvailableRef.current) return;
      window.electronAPI.stealthTapStart().catch((err) => {
        console.warn('[stealth] tap start IPC failed', err);
      });
    };

    const onFocusRefresh = () => {
      window.electronAPI?.stealthTapRefreshIme?.();
    };

    document.addEventListener('mousedown', onMouseDown, true); // capture phase
    window.addEventListener('focus', onFocusRefresh);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('focus', onFocusRefresh);
    };
  }, []);

  // ── ModelSelector click-outside close ──
  //
  // ROUND 3 FIX (#4): replaces the dead `on('blur')` handler in the
  // ModelSelectorWindowHelper. With NSPanel-nonactivating the model-
  // selector window may never become key on click, so its blur listener
  // never fires and the dropdown stays open forever. We close it here
  // by firing an IPC on every overlay mousedown EXCEPT clicks on the
  // toggle button itself (which would race with toggleWindow's open/close
  // logic). Main process no-ops the IPC if model selector is already
  // closed.
  useEffect(() => {
    if (!window.electronAPI?.modelSelectorCloseIfOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[data-model-selector-toggle="true"]')) return;
      window.electronAPI.modelSelectorCloseIfOpen().catch(() => {});
    };
    document.addEventListener('mousedown', onMouseDown, true); // capture phase
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, []);

  // ── Input-click DOM-focus block ──
  //
  // When the user clicks the chat input, the browser tries to focus the
  // <input> element. That focus promotes the NSPanel to key window —
  // which fires window.onblur on whatever app was previously focused
  // (Zoom, browser, IDE). preventDefault() on mousedown blocks the focus
  // attempt entirely. The above mousedown listener has already fired
  // stealthTapStart() in capture phase, so by the time we get here, the
  // tap is engaging and DOM focus is no longer the typing path.
  const blockInputFocus = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    if (
      !shouldBlockStealthFocus({
        stealthAutoEngageOk: stealthAutoEngageOkRef.current,
        isCgEventTapAvailable: isCgEventTapAvailableRef.current,
      })
    ) {
      return;
    }
    e.preventDefault();
    // Don't blur an already-focused element — that itself fires events.
    if (document.activeElement === textInputRef.current) {
      textInputRef.current?.blur();
    }
  }, []);

  // ── Derived STT status for the rolling transcript indicator (interviewer channel) ──
  const interviewerSttIndicatorStatus = sttInterviewerStatus;
  // Strip consecutive error count from display — show only in expanded diagnostics
  const interviewerSttIndicatorError = sttInterviewerError?.replace(
    /\s*\(\d+ consecutive errors\):?/gi,
    '',
  );
  const sttSummary = getSttSummary(
    sttUserStatus,
    sttInterviewerStatus,
    sttUserProvider,
    sttInterviewerProvider,
    sttNotConfigured,
    sttUserError,
    sttInterviewerError,
  );
  const showAnswerPanel =
    messages.length > 0 || isManualRecording || isProcessing || answerPanelPinned;
  // Only surface the STT pill for genuine problems (config error, failed, or a
  // dropped-then-reconnecting channel). The neutral 'awaiting-audio' state
  // ("Listening for audio…") is intentionally suppressed — it added a pill on
  // every launch and made the top section look padded vs. the prior build.
  // When an audio-capture-failure banner is showing, it already conveys the
  // hard failure with actionable UI (repair button + system-settings deep
  // link). Surfacing the STT "needs attention" error pill at the same time is
  // the same status on two surfaces — let the richer banner own the error and
  // suppress the redundant error-tone pill. Reconnecting indication still shows
  // (the banner only fires on terminal/stuck, not transient reconnects).
  const audioFailureBannerActive = systemAudioWarning?.kind === 'audio-capture-failure';
  const shouldShowSttSummaryPill =
    (sttSummary.tone === 'error' && !audioFailureBannerActive) ||
    sttUserStatus === 'reconnecting' ||
    sttInterviewerStatus === 'reconnecting';
  // Whether the vision chip will render (mirrors the IIFE's early-return guard).
  const visionPillFailed = screenContextStatus === 'failed' || !!latestVisionFailureReason;
  const visionPillSucceeded =
    (latestUsedImageInput || screenContextStatus === 'available') && !visionPillFailed;
  // Suppressed: vision pill ("Vision: provider") is not required in the UI.
  const showVisionPill = false;
  // Gate the whole status-pill row on having at least one pill. Otherwise the
  // empty row still reserved pt-3+pb-1, leaving a visible gap above the rolling
  // transcript on launch (no mode yet, STT pill suppressed, no vision/llm).
  // Suppressed: mode label pill is not required in the UI.
  // Suppressed: LLM privacy label pill is not required in the UI.
  // Suppressed: vision pill ("Vision: provider") is not required in the UI.
  const hasStatusPill = shouldShowSttSummaryPill;
  const statusPillBaseClass = `flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium shadow-sm backdrop-blur-xl ${isLightTheme ? 'bg-white/55 border-black/10' : 'bg-black/20 border-white/10'}`;

  // Suppress the shell's scale/translate entry animation until it has rendered
  // expanded at least once (set via onAnimationComplete). On the first content
  // render the OS window is still settling its bounds, so animating
  // scale 0.95→1 / y 20→0 would feed the size-reporter a moving box and read as
  // a shake. `false` tells Framer Motion to mount at the `animate` state with no
  // enter transition. Re-expansions after mount get the full animation.
  const expandedMotionInitial = hasRenderedExpandedRef.current
    ? { opacity: 0, y: 8, scale: 0.97 }
    : false;
  const markExpandedRendered = useCallback(() => {
    hasRenderedExpandedRef.current = true;
  }, []);

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
      interviewerCat
        ? `System Audio Category: ${interviewerCat.title} [${interviewerCat.category}]`
        : '',
      `System Audio Error: ${sttInterviewerError || 'N/A'}`,
      `Timestamp: ${new Date().toISOString()}`,
    ]
      .filter(Boolean)
      .join('\n');
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
    <>
    {/* Standalone resize toggle — fixed to the top-right corner of the Electron
        window, completely outside the main panel body. Inherits screen-capture
        protection from the BrowserWindow's setContentProtection. The hover
        hit-test in the useEffect above includes this button's rect so hovering
        it keeps the window interactive; stealth passthrough still wins when
        undetectable mode is on (syncOverlayInteractionPolicy in WindowHelper
        ORs the master passthrough flag). Only rendered once there's content. */}
    {messages.length > 0 && (
      <ResizeToggle
        ref={resizeToggleRef}
        expanded={isShellWide}
        onToggle={handleManualResizeToggle}
        appearance={appearance}
        interfaceTheme={isGlassTheme ? 'liquid-glass' : isModernTheme ? 'modern' : undefined}
        rightOffset={buttonRight}
      />
    )}
    <div
      ref={contentRef}
      data-interface-theme={isGlassTheme ? 'liquid-glass' : isModernTheme ? 'modern' : 'default'}
      className="flex flex-col items-center w-fit mx-auto h-fit min-h-0 bg-transparent p-0 rounded-[24px] font-sans gap-2 overlay-text-primary"
    >
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={expandedMotionInitial}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              // Enter: slightly longer, pure ease-out so the moment you're
              // watching (the arrival) decelerates smoothly. easeInOut delayed
              // the front half and read as sluggish.
              transition: { duration: 0.34, ease: [0.23, 1, 0.32, 1] },
            }}
            exit={{
              opacity: 0,
              y: 6,
              scale: 0.98,
              // Exit faster than enter (asymmetric timing = responsive feel) with
              // an ease-in so it accelerates away instead of lingering.
              transition: { duration: 0.22, ease: [0.32, 0, 0.67, 0] },
            }}
            onAnimationComplete={markExpandedRendered}
            className="flex flex-col items-center gap-2 w-full"
          >
            <TopPill
              expanded={isExpanded}
              onToggle={() => setIsExpanded(!isExpanded)}
              onQuit={() => (onEndMeeting ? onEndMeeting() : window.electronAPI.quitApp())}
              appearance={appearance}
              onLogoClick={() => window.electronAPI?.setWindowMode?.('launcher')}
            />
            <motion.div
              ref={shellRef}
              className={`relative max-w-full backdrop-blur-2xl border rounded-[24px] overflow-hidden flex flex-col draggable-area overlay-shell-surface ${overlayPanelClass}`}
              style={{
                ...appearance.shellStyle,
                width: shellWidth,
                // Removed will-change: 'width' — Framer Motion animates shellWidth
                // using transform (translateX), not CSS width, so this hint created
                // a ghost compositor layer with stale dimensions from the first
                // meeting's layout, blocking correct compositing on remount.
                //
                // contain: layout/style scopes the per-frame reflow that the
                // width animation triggers to this subtree, so growing the shell
                // doesn't dirty layout/style up the ancestor chain each frame.
                // NOT `size` (that would stop the box sizing to its content and
                // break offsetHeight reporting); NOT `paint` (would clip the
                // backdrop-blur).
                contain: 'layout style',
              }}
            >
              {isGlassTheme && <GlassEffectLayer parentRef={shellRef} cornerRadius={24} />}

              {hasStatusPill && (
              <div className="relative no-drag flex flex-wrap items-center justify-center gap-1.5 px-4 pt-3 pb-1">
                {shouldShowSttSummaryPill && (
                  <div
                    className={`${statusPillBaseClass} ${getStatusToneClass(sttSummary.tone)}`}
                    title={sttSummary.detail}
                  >
                    <Mic className="h-3 w-3 opacity-70" />
                    <span>{sttSummary.label}</span>
                  </div>
                )}
              </div>
              )}

              {/* System Audio / Screen Recording Warning Banner */}
              {systemAudioWarning && (
                <div className="flex items-center justify-between mx-4 mt-3 mb-1 px-3.5 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-[12px] shadow-sm relative no-drag group/warning">
                  <div className="flex flex-col gap-1 pr-3">
                    <div className="flex items-center gap-2 text-[12.5px] text-yellow-600 dark:text-yellow-400/90 font-medium leading-tight">
                      <div className="shrink-0 p-1 bg-yellow-500/20 rounded-full">
                        <svg
                          className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                          />
                        </svg>
                      </div>
                      <span>
                        {systemAudioWarning.kind === 'screen-recording-permission'
                          ? 'Screen Recording Permission Denied'
                          : 'Audio Capture Issue'}
                      </span>
                    </div>
                    <p className="text-[11px] text-yellow-600/70 dark:text-yellow-400/60 leading-snug pl-[26px]">
                      {systemAudioWarning.message}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/*
                      UX3: deep-link to the correct macOS System Settings pane
                      based on the failure channel. Pre-fix the mic-zero-fill /
                      mic-denied path opened Natively's internal Settings,
                      which then required the user to read the message, alt-tab
                      to System Settings, navigate to Privacy & Security, find
                      Microphone, and toggle Natively. Now one click takes them
                      directly to the right pane. Falls back to internal
                      Settings on Windows or when channel is unknown.
                    */}
                    {(() => {
                      const wantsScreenCapturePane =
                        systemAudioWarning.kind === 'screen-recording-permission' ||
                        systemAudioWarning.channel === 'system';
                      const wantsMicrophonePane =
                        systemAudioWarning.kind === 'audio-capture-failure' &&
                        systemAudioWarning.channel === 'mic';
                      const deepLinkUrl = !isMac
                        ? null
                        : wantsScreenCapturePane
                        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
                        : wantsMicrophonePane
                        ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
                        : null;
                      return (
                        <>
                          <button
                            onClick={() => {
                              if (deepLinkUrl) {
                                window.electronAPI.openExternal(deepLinkUrl);
                              } else {
                                // Windows / unknown channel: fall back to internal Settings.
                                window.electronAPI?.toggleSettingsWindow?.();
                              }
                            }}
                            className="px-3 py-1.5 rounded-lg bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-700 dark:text-yellow-500 text-[11px] font-semibold transition-all active:scale-95 border border-yellow-500/20 shadow-sm"
                            title={
                              deepLinkUrl
                                ? wantsMicrophonePane
                                  ? 'Open macOS Microphone privacy settings'
                                  : 'Open macOS Screen Recording privacy settings'
                                : 'Open Natively Settings'
                            }
                          >
                            {deepLinkUrl
                              ? wantsMicrophonePane
                                ? 'Open Mic Settings'
                                : 'Open Screen Settings'
                              : 'Open Settings'}
                          </button>
                          {/*
                            UX2: in-app TCC repair button. macOS only.
                            Shows when the banner is from a TCC-related failure
                            (any audio-capture-failure path or screen-recording
                            permission denial). The dominant root cause of
                            "permissions granted but no transcription" is TCC
                            cdhash drift across rebuilds; this button gives the
                            user a one-click recovery without having to know
                            about tccutil or terminal commands. After reset
                            the user must fully quit (Cmd+Q) and reopen.
                          */}
                          {isMac && (
                            <button
                              onClick={async () => {
                                if (tccRepairing) return; // in-flight guard
                                setTccRepairing(true);
                                try {
                                  const result = await window.electronAPI?.repairTccPermissions?.();
                                  if (result) {
                                    // Show the returned message via the existing
                                    // banner; user can dismiss when ready.
                                    setSystemAudioWarning({
                                      kind: 'audio-capture-failure',
                                      message: result.message,
                                      channel: systemAudioWarning.channel,
                                    });
                                  }
                                } catch (err) {
                                  console.warn('[UI] repair-tcc-permissions failed:', err);
                                } finally {
                                  setTccRepairing(false);
                                }
                              }}
                              disabled={tccRepairing}
                              className="px-3 py-1.5 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-700 dark:text-yellow-500 text-[11px] font-medium transition-all active:scale-95 border border-yellow-500/15 disabled:opacity-60 disabled:cursor-not-allowed"
                              title="Reset macOS permission entries for Natively (you will need to grant them again after relaunch)"
                            >
                              {tccRepairing ? 'Resetting…' : 'Repair Permissions'}
                            </button>
                          )}
                        </>
                      );
                    })()}
                    <button
                      onClick={() => setSystemAudioWarning(null)}
                      className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-yellow-600/50 hover:text-yellow-700 dark:text-yellow-500/50 dark:hover:text-yellow-400 transition-colors absolute top-1 right-1 opacity-0 group-hover/warning:opacity-100"
                      title="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}

              {/* PR #173: STT Not Configured Warning Banner */}
              {sttNotConfigured && (
                <div className="flex items-center justify-between mx-4 mt-3 mb-1 px-3.5 py-2.5 bg-orange-500/10 border border-orange-500/20 rounded-[12px] shadow-sm relative no-drag group/stt-warning">
                  <div className="flex flex-col gap-1 pr-3">
                    <div className="flex items-center gap-2 text-[12.5px] text-orange-600 dark:text-orange-400/90 font-medium leading-tight">
                      <div className="shrink-0 p-1 bg-orange-500/20 rounded-full">
                        <svg
                          className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                          />
                        </svg>
                      </div>
                      <span>Transcription Not Configured</span>
                    </div>
                    <p className="text-[11px] text-orange-600/70 dark:text-orange-400/60 leading-snug pl-[26px]">
                      No STT provider selected. Open Settings → Audio to pick one.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => {
                        window.electronAPI?.toggleSettingsWindow?.();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-700 dark:text-orange-500 text-[11px] font-semibold transition-all active:scale-95 border border-orange-500/20 shadow-sm"
                    >
                      Open Settings
                    </button>
                    <button
                      onClick={() => setSttNotConfigured(false)}
                      className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-orange-600/50 hover:text-orange-700 dark:text-orange-500/50 dark:hover:text-orange-400 transition-colors absolute top-1 right-1 opacity-0 group-hover/stt-warning:opacity-100"
                      title="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}

              {/* Phase 3 — Dynamic action card row (Cluely-style live triggers).
                                Appears between status pills and rolling transcript so users see
                                actionable suggestions in their primary scan path. Bar self-hides
                                when no actions are present. */}
              <DynamicActionBar
                onAcceptAction={(action: DynamicActionPayload) => {
                  void handleWhatToSay(action.promptInstruction);
                }}
              />

              {/* Rolling Transcript Bar — live transcript + on-demand diagnostics
                  for hard failures. Reconnecting/awaiting-audio status is owned by
                  the top status pill, so the bar no longer mounts for those (which
                  also avoids an empty bar / duplicated status text). */}
              {showTranscript && rollingTranscript ? (
                <RollingTranscript
                  text={rollingTranscript}
                  isActive={isInterviewerSpeaking}
                  surfaceStyle={appearance.transcriptStyle}
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
                />
              ) : null}

              {/* Chat History - Only show if there are messages OR active states */}
              {showAnswerPanel && (
                <motion.div
                  ref={scrollContainerRef}
                  className="relative z-10 flex-1 overflow-y-auto p-4 space-y-3 no-drag isolate"
                  layout={false}
                  style={{ scrollbarWidth: 'none', maxHeight: scrollMaxH }}
                >
                  {/* Every row spans the full inner width of the scroll
                                        container, which itself rides the shell's animated
                                        width. Bubble max-widths are percentages so the text
                                        and code grow with the canvas — same as iMessage /
                                        Mail when their windows resize. Reflow during the
                                        700 ms tween is gentle (≈0.3 px / frame width delta)
                                        and reads as the canvas "breathing", not jitter.
                                        The other polish (sticky bottom, stable code line
                                        layout via wrapLongLines:false, stability gate that
                                        suppresses transitions during scroll) keeps the
                                        motion calm.

                                        Each row is rendered through React.memo'd MessageRow
                                        so a setMessages on the streaming row does NOT
                                        re-render every prior message — bailout fires on
                                        identity equality (msg, theme, callbacks). */}
                  {displayMessages.map((msg: Message) => (
                    <MessageRow
                      key={msg.id}
                      msg={msg}
                      isLightTheme={isLightTheme}
                      appearance={appearance}
                      onCopy={handleCopy}
                      renderMessageText={renderMessageText}
                    />
                  ))}

                  {/* Active Recording State with Live Transcription */}
                  {isManualRecording && (
                    <div className="flex flex-col items-end gap-1 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {/* Live transcription preview */}
                      {(manualTranscript || voiceInput) && (
                        <div className="max-w-[85%] px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-[18px] rounded-tr-[4px]">
                          <span className="text-[13px] text-emerald-300">
                            {voiceInput}
                            {voiceInput && manualTranscript ? ' ' : ''}
                            {manualTranscript}
                          </span>
                        </div>
                      )}
                      <div className="px-3 py-2 flex gap-1.5 items-center bg-emerald-500/10 border border-emerald-500/20 rounded-full">
                        <div
                          className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"
                          style={{ animationDelay: '0ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"
                          style={{ animationDelay: '150ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"
                          style={{ animationDelay: '300ms' }}
                        />
                        <span className="text-[10px] text-emerald-400/70 ml-1">Listening...</span>
                      </div>
                    </div>
                  )}

                  {/*
                   * Bouncing-dots "AI is thinking" indicator. Gated on
                   * `!hasStreamingPlaceholder` so it never co-exists with a
                   * streaming system row — which MessageRow already renders as
                   * a visible empty bubble (subtleSurfaceClass + border +
                   * rounded-[18px] + px-4 py-3). Without the gate, the user
                   * sees TWO thinking bubbles during the wait: the empty
                   * placeholder above, the dots pill below.
                   *
                   * Once the first token arrives the placeholder fills with
                   * text; once finalize fires `setIsProcessing(false)` clears
                   * this indicator. The gate keeps a single visible "thinking"
                   * affordance throughout the entire pre-answer phase.
                   */}
                  {isProcessing &&
                    !displayMessages.some(
                      (m) => m.role === 'system' && m.isStreaming,
                    ) && (
                    <div className="flex justify-start">
                      <div
                        className="px-3 py-2 flex gap-1.5 overlay-subtle-surface rounded-full border"
                        style={appearance.subtleStyle}
                      >
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: '0ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: '150ms' }}
                        />
                        <div
                          className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                          style={{ animationDelay: '300ms' }}
                        />
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </motion.div>
              )}

              {/* Quick Actions - Minimal & Clean */}
              <div
                className={`flex flex-nowrap justify-center items-center gap-1.5 px-4 pb-3 overflow-x-hidden ${rollingTranscript && showTranscript ? 'pt-1' : 'pt-3'}`}
              >
                <button
                  onClick={handleWhatToSay}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`}
                  style={appearance.chipStyle}
                >
                  <Pencil className="w-3 h-3 opacity-70" /> What to answer?
                </button>
                <button
                  onClick={handleClarify}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`}
                  style={appearance.chipStyle}
                >
                  <MessageSquare className="w-3 h-3 opacity-70" /> Clarify
                </button>
                <button
                  onClick={actionButtonMode === 'brainstorm' ? handleBrainstorm : handleRecap}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`}
                  style={appearance.chipStyle}
                >
                  {actionButtonMode === 'brainstorm' ? (
                    <>
                      <Lightbulb className="w-3 h-3 opacity-70" /> Brainstorm
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3 h-3 opacity-70" /> Recap
                    </>
                  )}
                </button>
                <button
                  onClick={handleFollowUpQuestions}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all active:scale-95 duration-200 interaction-base interaction-press whitespace-nowrap shrink-0 ${quickActionClass}`}
                  style={appearance.chipStyle}
                >
                  <HelpCircle className="w-3 h-3 opacity-70" /> Follow Up Question
                </button>
                <button
                  onClick={handleAnswerNow}
                  className={`flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all active:scale-95 duration-200 interaction-base interaction-press min-w-[74px] whitespace-nowrap shrink-0 ${
                    isManualRecording
                      ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20'
                      : 'overlay-chip-surface overlay-text-interactive'
                  }`}
                  style={isManualRecording ? undefined : appearance.chipStyle}
                >
                  {isManualRecording ? (
                    <>
                      <div className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                      Stop
                    </>
                  ) : (
                    <>
                      <Zap className="w-3 h-3 opacity-70" /> Answer
                    </>
                  )}
                </button>
              </div>

              {/* Input Area */}
              <div className="p-3 pt-0">
                {/* Latent Context Preview (Attached Screenshot) */}
                {attachedContext.length > 0 && (
                  <div
                    className={`mb-2 rounded-lg p-2 transition-all duration-200 border ${subtleSurfaceClass}`}
                    style={appearance.subtleStyle}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium overlay-text-primary">
                        {attachedContext.length} screenshot{attachedContext.length > 1 ? 's' : ''}{' '}
                        attached
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
                            onClick={() =>
                              setAttachedContext((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                            title="Remove"
                          >
                            <X className="w-2.5 h-2.5 text-white" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <span className="text-[10px] overlay-text-muted">
                      Ask a question or click Answer
                    </span>
                  </div>
                )}

                {/* Stealth hotkey conflict banner — shown if globalShortcut.register()
                                    failed for chat:focusInput (typically because the configured
                                    activation hotkey is already claimed by another app or by the
                                    OS). Click-to-activate still works (mousedown listener is
                                    independent of the hotkey), but the user can rebind in Settings. */}
                {stealthHotkeyConflict && (
                  <div
                    className="mb-2 px-3 py-2 rounded-xl border border-rose-400/40 bg-rose-500/10 text-[11px] flex items-center gap-2"
                    data-stealth-ignore="true"
                  >
                    <span className="overlay-text-primary flex-1">
                      Stealth typing hotkey{' '}
                      <kbd className="px-1 py-0.5 rounded bg-white/10 font-mono text-[10px]">
                        {stealthHotkeyConflict}
                      </kbd>{' '}
                      is already in use. Click the input to activate, or rebind in Settings.
                    </span>
                    <button
                      onClick={() => window.electronAPI.openSettingsTab('keybinds')}
                      className="px-2 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/30 transition-colors text-[11px] font-medium overlay-text-primary whitespace-nowrap"
                      data-stealth-ignore="true"
                    >
                      Rebind
                    </button>
                    <button
                      onClick={() => setStealthHotkeyConflict(null)}
                      className="px-1.5 py-1 rounded-md hover:bg-white/10 transition-colors text-[11px] overlay-text-muted"
                      aria-label="Dismiss"
                      data-stealth-ignore="true"
                    >
                      ×
                    </button>
                  </div>
                )}

                {/* Stealth tap permission banner — shown only when the user
                                    pressed the activation hotkey but Accessibility wasn't
                                    granted. macOS-only: Accessibility is a TCC concept that
                                    doesn't exist on Windows, and the underlying CGEventTap
                                    Rust module ships only in the Darwin binary. Gating here
                                    is belt-and-suspenders on top of the native-side gate. */}
                {isMac && stealthPermissionMissing && (
                  <div
                    className="mb-2 px-3 py-2 rounded-xl border border-amber-400/40 bg-amber-500/10 text-[11px] flex items-center gap-2"
                    data-stealth-ignore="true"
                  >
                    <span className="overlay-text-primary flex-1">
                      Stealth typing needs Accessibility access. Grant it in System Settings, then
                      restart Natively.
                    </span>
                    <button
                      onClick={() => window.electronAPI.stealthTapOpenSettings()}
                      className="px-2 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 transition-colors text-[11px] font-medium overlay-text-primary whitespace-nowrap"
                      data-stealth-ignore="true"
                    >
                      Open Settings
                    </button>
                    <button
                      onClick={() => setStealthPermissionMissing(false)}
                      className="px-1.5 py-1 rounded-md hover:bg-white/10 transition-colors text-[11px] overlay-text-muted"
                      aria-label="Dismiss"
                      data-stealth-ignore="true"
                    >
                      ×
                    </button>
                  </div>
                )}

                {/* data-stealth-engage marks this subtree as
                                    the ONLY clickable region that engages the
                                    CGEventTap. See the click-to-activate
                                    useEffect (~line 2840) for the opt-IN
                                    rationale — buttons elsewhere in the
                                    overlay no longer accidentally engage the
                                    tap and break inputs in Settings/Model
                                    Selector windows. */}
                <div className="relative group" data-stealth-engage="true">
                  <input
                    ref={textInputRef}
                    data-testid="overlay-chat-input"
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' || e.repeat) return;
                      e.preventDefault();
                      handleManualSubmit();
                    }}
                    // Block native DOM focus on click — the panel becoming
                    // key window is exactly the signal coding-interview
                    // platforms watch for via window.onblur on the parent.
                    // mousedown listener (capture phase) already engaged
                    // the CGEventTap, so typing routes through that path.
                    onMouseDown={blockInputFocus}
                    readOnly={stealthTapActive}
                    className={`w-full border focus:ring-1 rounded-xl pl-3 pr-10 py-2.5 focus:outline-none transition-all duration-200 ease-sculpted text-[13px] leading-relaxed ${inputClass} ${stealthTapActive ? 'ring-2 ring-emerald-400/30 border-emerald-400/40 shadow-[0_0_12px_rgba(52,211,153,0.15)]' : ''}`}
                    style={appearance.inputStyle}
                  />

                  {/* Custom Rich Placeholder */}
                  {!inputValue && (
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none text-[13px] overlay-text-muted">
                      <span>Ask anything on screen or conversation, or</span>
                      <div className="flex items-center gap-1 opacity-80">
                        {(
                          shortcuts.selectiveScreenshot || [getModifierSymbol('cmd'), 'Shift', 'H']
                        ).map((key, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && <span className="text-[10px]">+</span>}
                            <kbd
                              className="px-1.5 py-0.5 rounded border text-[10px] font-sans min-w-[20px] text-center overlay-control-surface overlay-text-secondary"
                              style={appearance.controlStyle}
                            >
                              {key}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                      <span>for selective screenshot</span>
                    </div>
                  )}

                  {!inputValue && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none opacity-20">
                      <span className="text-[10px]">↵</span>
                    </div>
                  )}
                </div>

                {/* Bottom Row */}
                <div className="flex items-center justify-between mt-3 px-0.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      data-model-selector-toggle="true"
                      onClick={(e) => {
                        // Calculate position for detached window
                        if (!contentRef.current) return;
                        const contentRect = contentRef.current.getBoundingClientRect();
                        const buttonRect = e.currentTarget.getBoundingClientRect();
                        const GAP = 8;

                        const x = window.screenX + buttonRect.left;
                        const y = window.screenY + contentRect.bottom + GAP;

                        window.electronAPI.toggleModelSelector({ x, y, activate: false });
                      }}
                      className={`
                                                flex items-center gap-2 px-3 py-1.5
                                                border rounded-lg transition-colors
                                                text-xs font-medium w-[140px]
                                                interaction-base interaction-press
                                                ${controlSurfaceClass}
                                            `}
                      style={appearance.controlStyle}
                    >
                      <span className="truncate min-w-0 flex-1">
                        {(() => {
                          const m = currentModel;
                          const codexCliName = getCodexCliModelDisplayName(m);
                          if (codexCliName) return codexCliName;
                          if (m.startsWith('ollama-')) return m.replace('ollama-', '');
                          if (m === 'gemini-3.5-flash') return 'Gemini 3.5 Flash';
                          if (m === 'gemini-3.1-flash-lite') return 'Gemini 3.1 Flash Lite';
                          if (m === 'gemini-3.1-pro-preview') return 'Gemini 3.1 Pro';
                          if (m === 'llama-3.3-70b-versatile') return 'Groq Llama 3.3';
                          if (m === 'gpt-5.4') return 'GPT 5.4';
                          if (m === 'claude-sonnet-4-6') return 'Sonnet 4.6';
                          return m;
                        })()}
                      </span>
                      <ChevronDown size={14} className="shrink-0 transition-transform" />
                    </button>

                    <div className="w-px h-3 mx-1" style={appearance.dividerStyle} />

                    <div className="relative">
                      <button
                        onClick={(e) => {
                          if (isSettingsOpen) {
                            // If open, just close it (toggle will handle logic but we can be explicit or just toggle)
                            // Actually toggle-settings-window handles hiding if visible, so logic is same.
                            window.electronAPI.toggleSettingsWindow();
                            return;
                          }

                          if (!contentRef.current) return;

                          const contentRect = contentRef.current.getBoundingClientRect();
                          const buttonRect = e.currentTarget.getBoundingClientRect();
                          const POPUP_WIDTH = 270; // Matches SettingsWindowHelper actual width
                          const GAP = 8; // Same gap as between TopPill and main body (gap-2 = 8px)

                          // X: Left-aligned relative to the Settings Button
                          const x = window.screenX + buttonRect.left;

                          // Y: Below the main content + gap
                          const y = window.screenY + contentRect.bottom + GAP;

                          window.electronAPI.toggleSettingsWindow({ x, y });
                        }}
                        className={`
                                            w-7 h-7 flex items-center justify-center rounded-lg
                                            interaction-base interaction-press
                                            ${
                                              isSettingsOpen
                                                ? 'overlay-icon-surface overlay-icon-surface-hover overlay-text-primary'
                                                : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'
                                            }
                                        `}
                        style={appearance.iconStyle}
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Mouse Passthrough Toggle */}
                    <div className="relative">
                      <button
                        onClick={() => {
                          const newState = !isMousePassthrough;
                          setIsMousePassthrough(newState);
                          window.electronAPI?.setOverlayMousePassthrough?.(newState);
                        }}
                        className={`
                                                    w-7 h-7 flex items-center justify-center rounded-lg
                                                    interaction-base interaction-press
                                                    ${
                                                      isMousePassthrough
                                                        ? 'overlay-icon-surface overlay-icon-surface-hover text-sky-400 opacity-100'
                                                        : 'overlay-icon-surface overlay-icon-surface-hover overlay-text-interactive'
                                                    }
                                                `}
                        style={appearance.iconStyle}
                      >
                        <PointerOff className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={handleManualSubmit}
                    disabled={!inputValue.trim()}
                    className={`
                                    w-7 h-7 rounded-full flex items-center justify-center
                                    interaction-base interaction-press
                                    ${
                                      inputValue.trim()
                                        ? 'bg-[#007AFF] text-white shadow-lg shadow-blue-500/20 hover:bg-[#0071E3]'
                                        : 'overlay-icon-surface overlay-text-muted cursor-not-allowed'
                                    }
                                `}
                    style={inputValue.trim() ? undefined : appearance.iconStyle}
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </>
  );
};

export default NativelyInterface;
