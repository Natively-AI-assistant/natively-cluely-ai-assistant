import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { mapLanguageForPrism, isBlockCode } from '../utils/prismLanguage';
import { registerPrismLanguages } from '../utils/registerPrismLanguages';

registerPrismLanguages();

/**
 * How the two meeting search chats draw an answer's Markdown: the meeting
 * chat (MeetingChatOverlay, "ask about this meeting") and the top bar's
 * search-all-meetings chat (GlobalChatOverlay). Moved here unchanged from
 * MeetingChatOverlay on 2026-10-30, when the global chat, which showed answers
 * as plain text (so **bold** and "* " bullets came through as raw asterisks),
 * was given the same rendering. Owner: "the response structure is so bad for
 * both". Pass as DiagramAwareMarkdown's renderMarkdown; a ```mermaid block is
 * still drawn by the shared diagram card.
 */
export const renderChatMarkdown = (chunk: string, key: React.Key) => (
    <ReactMarkdown
        key={key}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false, errorColor: '#cc0000' }]]}
        components={{
            p: ({ node, ...props }: any) => <p className="mb-[6px] last:mb-0 leading-relaxed whitespace-pre-wrap text-[13.5px]" {...props} />,
            a: ({ node, ...props }: any) => <a className="text-accent-primary hover:underline" {...props} />,
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
        {chunk}
    </ReactMarkdown>
);
