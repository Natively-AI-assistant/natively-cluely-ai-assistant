import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * An Ask answer in the notepad (2026-11-01). It was drawn as plain text
 * (plainAnswerText in one pre-wrapped paragraph), so "What did I miss" came out
 * as a wall of "- " lines with the hyphens showing and no room between points.
 * Owner: "better answer structure in notepad ai chatbox, during the meeting".
 *
 * Now the Markdown is drawn, in the notepad's own ink (--np-*), so it follows
 * the notepad's light and dark: real points with a hanging indent and a gap
 * between them, bold, short headings, and the "> " line to say (Sound smart)
 * on a soft wash. No accent edge on the quote. No math plugin: "$175,000 ...
 * $160,000" stays money, not KaTeX. Copy still copies plain text.
 */

const ink = (v: string): React.CSSProperties => ({ color: `var(${v})` });

const components = {
    p: ({ node, ...props }: any) => <p className="np-md-block text-[14px] leading-[1.58] whitespace-pre-wrap" {...props} />,
    strong: ({ node, ...props }: any) => <strong className="font-semibold" style={ink('--np-ink-strong')} {...props} />,
    em: ({ node, ...props }: any) => <em className="italic" {...props} />,
    a: ({ node, ...props }: any) => <a className="underline underline-offset-2" style={ink('--np-ink-strong')} target="_blank" rel="noreferrer" {...props} />,
    h1: ({ node, ...props }: any) => <h3 className="np-md-block np-md-head text-[14px] font-semibold leading-[1.4]" style={ink('--np-ink-strong')} {...props} />,
    h2: ({ node, ...props }: any) => <h3 className="np-md-block np-md-head text-[14px] font-semibold leading-[1.4]" style={ink('--np-ink-strong')} {...props} />,
    h3: ({ node, ...props }: any) => <h4 className="np-md-block np-md-head text-[13px] font-semibold leading-[1.4]" style={ink('--np-ink-strong')} {...props} />,
    h4: ({ node, ...props }: any) => <h4 className="np-md-block np-md-head text-[13px] font-semibold leading-[1.4]" style={ink('--np-ink-strong')} {...props} />,
    ul: ({ node, ...props }: any) => <ul className="np-md-block np-md-ul flex flex-col gap-2" {...props} />,
    ol: ({ node, ...props }: any) => <ol className="np-md-block np-md-ol flex flex-col gap-2" {...props} />,
    li: ({ node, ...props }: any) => <li className="np-md-li text-[14px] leading-[1.58]" {...props} />,
    blockquote: ({ node, ...props }: any) => <blockquote className="np-md-block np-md-quote rounded-lg px-3 py-2" style={{ background: 'var(--np-wash)' }} {...props} />,
    hr: () => <hr className="np-md-block border-0 h-px" style={{ background: 'var(--np-hairline)' }} />,
    pre: ({ node, ...props }: any) => <pre className="np-md-block np-md-pre overflow-x-auto rounded-lg px-3 py-2 text-[12.5px] leading-[1.5]" style={{ background: 'var(--np-wash)' }} {...props} />,
    code: ({ node, className, ...props }: any) => <code className={`np-md-code font-mono text-[12.5px] ${className ?? ''}`} {...props} />,
    table: ({ node, ...props }: any) => <div className="np-md-block overflow-x-auto"><table className="np-md-table text-[13px] leading-[1.45]" {...props} /></div>,
};

export function NotepadAnswer({ text }: { text: string }) {
    return (
        <div className="np-md mt-3" style={ink('--np-ink')}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
        </div>
    );
}
