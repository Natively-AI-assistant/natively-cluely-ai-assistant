import { motion, type MotionValue } from 'framer-motion';
import {
    useEffect,
    useRef,
    type ReactNode,
    type RefObject,
} from 'react';

import { usePaneFollowLive } from '../../hooks/usePaneFollowLive';

export interface CopilotPaneProps {
    children: ReactNode;
    scrollRef: RefObject<HTMLDivElement | null>;
    maxHeight: MotionValue<number>;
    visible: boolean;
    autoScroll: boolean;
    logicalRevision: number;
    contentRevision: number;
    resetKey: number;
    empty: boolean;
}

export default function CopilotPane({
    children,
    scrollRef,
    maxHeight,
    visible,
    autoScroll,
    logicalRevision,
    contentRevision,
    resetKey,
    empty,
}: CopilotPaneProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const { pausedUnread, onScroll, onContentResize, goLive } = usePaneFollowLive({
        pane: 'copilot',
        scrollRef,
        autoScroll,
        logicalRevision,
        contentRevision,
        visible,
        resetKey,
    });

    useEffect(() => {
        const content = contentRef.current;
        if (!content || typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(() => {
            onContentResize();
        });
        observer.observe(content);

        return () => observer.disconnect();
    }, [onContentResize]);
    const unreadLabel = `${pausedUnread} ${
        pausedUnread === 1 ? 'nova resposta' : 'novas respostas'
    }`;

    return (
        <section
            data-testid="assistant-column"
            aria-labelledby="assistant-column-heading"
            className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-2xl border !border-[var(--overlay-border-soft)] overlay-subtle-surface"
        >
            <div className="flex min-h-9 items-center px-3">
                <h2
                    id="assistant-column-heading"
                    className="text-[11px] font-semibold uppercase tracking-[0.12em] overlay-text-secondary"
                >
                    Copiloto
                </h2>
            </div>

            <motion.div
                ref={scrollRef}
                data-testid="assistant-scroll"
                dir="ltr"
                className="meeting-pane-scroll relative z-10 min-h-[120px] flex-1 overflow-y-auto overflow-x-hidden p-3 no-drag isolate"
                style={{ maxHeight }}
                onScroll={onScroll}
            >
                <div ref={contentRef} className="copilot-pane-content min-w-0 max-w-full space-y-3">
                    {empty ? (
                        <p className="py-5 text-center text-[12px] leading-[1.5] overlay-text-muted">
                            As sugestões aparecerão aqui quando uma pergunta for detectada ou você usar uma ação.
                        </p>
                    ) : (
                        children
                    )}
                </div>
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
        </section>
    );
}
