import { motion, type MotionValue } from 'framer-motion';
import {
    useEffect,
    useMemo,
    useState,
    type CSSProperties,
    type RefObject,
} from 'react';

import { usePaneFollowLive } from '../../hooks/usePaneFollowLive';
import {
    TRANSCRIPT_SPEAKER_LABELS,
    TRANSCRIPT_STATUS_LABELS,
    createTranscriptAnnouncementState,
    reduceTranscriptAnnouncement,
    type TranscriptAnnouncementInput,
} from '../../lib/transcriptAnnouncementPolicy.mjs';
import type {
    TranscriptSegment,
    TranscriptSpeaker,
    TranscriptState,
} from '../../lib/transcriptSegments.mjs';
import TranscriptSegmentRow from './TranscriptSegmentRow';

export interface TranscriptChannelStatus {
    status: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio';
    error?: string;
    provider?: string;
}

export interface TranscriptTimelineProps {
    state: TranscriptState;
    channels: Record<TranscriptSpeaker, TranscriptChannelStatus>;
    scrollRef: RefObject<HTMLDivElement | null>;
    maxHeight: MotionValue<number>;
    visible: boolean;
    resetKey: number;
    rowSurfaceStyle?: CSSProperties;
}

const SPEAKERS: readonly TranscriptSpeaker[] = ['interviewer', 'user'];

interface ChannelProblem {
    key: TranscriptSpeaker;
    label: string;
    detail: string;
}

function describeChannelProblem(
    speaker: TranscriptSpeaker,
    channel: TranscriptChannelStatus,
): ChannelProblem | null {
    if (channel.status === 'connected') return null;

    const context = [channel.provider, channel.error].filter(Boolean).join(' · ');
    const detail = context
        ? `${TRANSCRIPT_STATUS_LABELS[channel.status]} · ${context}`
        : TRANSCRIPT_STATUS_LABELS[channel.status];

    return {
        key: speaker,
        label: TRANSCRIPT_SPEAKER_LABELS[speaker],
        detail,
    };
}

function sortByTimeline(left: TranscriptSegment, right: TranscriptSegment) {
    return (
        left.timestamp - right.timestamp ||
        left.arrivalSequence - right.arrivalSequence
    );
}

export default function TranscriptTimeline({
    state,
    channels,
    scrollRef,
    maxHeight,
    visible,
    resetKey,
    rowSurfaceStyle,
}: TranscriptTimelineProps) {
    const partials = useMemo(
        () =>
            SPEAKERS.map((speaker) => state.partials[speaker])
                .filter(
                    (segment): segment is TranscriptSegment => segment !== null,
                )
                .sort(sortByTimeline),
        [state.partials],
    );
    const interviewerPartialActive = state.partials.interviewer !== null;
    const userPartialActive = state.partials.user !== null;
    const activePartialSpeakers = useMemo<TranscriptSpeaker[]>(() => {
        const speakers: TranscriptSpeaker[] = [];
        if (interviewerPartialActive) speakers.push('interviewer');
        if (userPartialActive) speakers.push('user');
        return speakers;
    }, [interviewerPartialActive, userPartialActive]);
    const channelProblems = SPEAKERS.map((speaker) =>
        describeChannelProblem(speaker, channels[speaker]),
    ).filter((problem): problem is ChannelProblem => problem !== null);
    const announcementInput = useMemo<TranscriptAnnouncementInput>(
        () => ({
            resetKey,
            finals: state.finals.map(({ id, speaker, text }) => ({
                id,
                speaker,
                text,
            })),
            channels: {
                interviewer: channels.interviewer,
                user: channels.user,
            },
            activePartialSpeakers,
        }),
        [
            activePartialSpeakers,
            channels.interviewer,
            channels.user,
            resetKey,
            state.finals,
        ],
    );
    const [announcement, setAnnouncement] = useState(() =>
        createTranscriptAnnouncementState(resetKey),
    );
    const { pausedUnread, onScroll, goLive } = usePaneFollowLive({
        pane: 'transcript',
        scrollRef,
        autoScroll: true,
        logicalRevision: state.commitRevision,
        contentRevision: state.contentRevision,
        visible,
        resetKey,
    });

    useEffect(() => {
        setAnnouncement((current) =>
            reduceTranscriptAnnouncement(current, announcementInput),
        );
    }, [announcementInput]);

    const isEmpty = state.finals.length === 0 && partials.length === 0;
    const unreadLabel = `${pausedUnread} ${
        pausedUnread === 1 ? 'nova fala' : 'novas falas'
    }`;

    return (
        <section
            data-testid="transcript-column"
            aria-labelledby="transcript-column-heading"
            className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-2xl border !border-[var(--overlay-border-soft)] overlay-subtle-surface"
        >
            <div className="flex min-h-9 items-center px-3">
                <h2
                    id="transcript-column-heading"
                    className="text-[11px] font-semibold uppercase tracking-[0.12em] overlay-text-secondary"
                >
                    Ao vivo
                </h2>
            </div>

            {channelProblems.length > 0 ? (
                <ul
                    aria-label="Problemas nos canais de transcrição"
                    className="space-y-1 px-3 pb-2 text-[11px] leading-[1.4] overlay-text-muted [overflow-wrap:anywhere]"
                >
                    {channelProblems.map(({ key, label, detail }) => (
                        <li key={key}>
                            <span className="font-medium overlay-text-secondary">
                                {label}:
                            </span>{' '}
                            {detail}
                        </li>
                    ))}
                </ul>
            ) : null}

            <motion.div
                ref={scrollRef}
                data-testid="transcript-scroll"
                dir="ltr"
                className="meeting-pane-scroll min-h-[120px] flex-1 overflow-y-auto overflow-x-hidden p-3 no-drag isolate"
                style={{ maxHeight }}
                onScroll={onScroll}
            >
                {isEmpty ? (
                    <p className="py-5 text-center text-[12px] overlay-text-muted">
                        Aguardando fala…
                    </p>
                ) : (
                    <ol className="space-y-2">
                        {state.finals.map((segment) => (
                            <TranscriptSegmentRow
                                key={segment.id}
                                segment={segment}
                                rowSurfaceStyle={rowSurfaceStyle}
                            />
                        ))}
                        {partials.map((segment) => (
                            <TranscriptSegmentRow
                                key={segment.id}
                                segment={segment}
                                rowSurfaceStyle={rowSurfaceStyle}
                            />
                        ))}
                    </ol>
                )}
            </motion.div>

            {pausedUnread > 0 ? (
                <button
                    type="button"
                    onClick={goLive}
                    aria-label={`Ir ao vivo, ${unreadLabel}`}
                    className="no-drag absolute bottom-3 right-3 z-20 rounded-full border px-3 py-1.5 text-[11px] font-medium overlay-control-surface overlay-text-interactive"
                >
                    Ir ao vivo ↓
                </button>
            ) : null}

            <div
                className="sr-only"
                aria-live="polite"
                aria-atomic="true"
            >
                {announcement.text ? (
                    <span key={announcement.revision}>{announcement.text}</span>
                ) : null}
            </div>
        </section>
    );
}
