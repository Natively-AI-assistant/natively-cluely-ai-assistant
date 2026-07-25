import { memo, type CSSProperties } from 'react';

import type { TranscriptSegment } from '../../lib/transcriptSegments.mjs';

export interface TranscriptSegmentRowProps {
    segment: TranscriptSegment;
    rowSurfaceStyle?: CSSProperties;
}

const TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});

const SPEAKER_LABELS = {
    interviewer: 'Reunião',
    user: 'Você',
} as const;

const TranscriptSegmentRow = memo(function TranscriptSegmentRow({
    segment,
    rowSurfaceStyle,
}: TranscriptSegmentRowProps) {
    const isPartial = segment.status === 'partial';
    const timestamp = new Date(segment.timestamp);

    return (
        <li
            data-testid={isPartial ? 'transcript-partial' : 'transcript-segment'}
            data-scroll-item-id={segment.id}
            aria-live="off"
            dir="ltr"
            className={`relative rounded-xl border px-3 py-2 text-left [overflow-wrap:anywhere] overlay-subtle-surface ${
                isPartial
                    ? 'opacity-75 !border-emerald-400/40'
                    : '!border-[var(--overlay-border-soft)]'
            }`}
            style={rowSurfaceStyle}
        >
            <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-[10px] font-medium uppercase tracking-[0.08em] overlay-text-muted">
                <span>{SPEAKER_LABELS[segment.speaker]}</span>
                <span className="flex shrink-0 items-center gap-2">
                    {isPartial ? (
                        <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                            <span
                                aria-hidden="true"
                                className="h-1.5 w-1.5 rounded-full bg-emerald-400 motion-safe:animate-pulse"
                            />
                            <span>Ouvindo…</span>
                        </span>
                    ) : null}
                    <time
                        className="tabular-nums normal-case tracking-normal"
                        dateTime={timestamp.toISOString()}
                    >
                        {TIME_FORMATTER.format(timestamp)}
                    </time>
                </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-[14px] leading-[1.5] overlay-text-primary">
                {segment.text}
            </p>
        </li>
    );
});

export default TranscriptSegmentRow;
