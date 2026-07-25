import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type RefObject,
} from 'react';

import {
    createWorkspaceState,
    goLivePane,
    recordPaneItem,
    type WorkspacePane,
} from '../lib/overlayWorkspaceState.mjs';

const BOTTOM_THRESHOLD = 8;

interface UsePaneFollowLiveOptions {
    pane: WorkspacePane;
    scrollRef: RefObject<HTMLDivElement | null>;
    autoScroll: boolean;
    logicalRevision: number;
    contentRevision: number;
    visible: boolean;
    resetKey: number;
}

interface UsePaneFollowLiveResult {
    isFollowing: boolean;
    pausedUnread: number;
    onScroll: () => void;
    onContentResize: () => void;
    goLive: () => void;
    scrollToBottom: () => void;
}

interface FollowFrameEligibility {
    pane: WorkspacePane;
    resetKey: number;
    autoScroll: boolean;
    isFollowing: boolean;
    visible: boolean;
}

type ScheduledFollowFrame = Pick<
    FollowFrameEligibility,
    'pane' | 'resetKey'
>;

export function shouldApplyFollowFrame(
    scheduled: ScheduledFollowFrame,
    current: FollowFrameEligibility,
): boolean {
    return (
        scheduled.pane === current.pane &&
        scheduled.resetKey === current.resetKey &&
        current.autoScroll &&
        current.isFollowing &&
        current.visible
    );
}

export function shouldScheduleContentResizeFollow(
    scheduled: ScheduledFollowFrame,
    current: FollowFrameEligibility,
): boolean {
    return shouldApplyFollowFrame(scheduled, current);
}

export function usePaneFollowLive({
    pane,
    scrollRef,
    autoScroll,
    logicalRevision,
    contentRevision,
    visible,
    resetKey,
}: UsePaneFollowLiveOptions): UsePaneFollowLiveResult {
    const [isFollowing, setIsFollowing] = useState(autoScroll);
    const [workspaceState, setWorkspaceState] = useState(createWorkspaceState);
    const previousLogicalRef = useRef(logicalRevision);
    const appliedResetKeyRef = useRef(resetKey);
    const rafRef = useRef<number | null>(null);
    const latestEligibilityRef = useRef<FollowFrameEligibility>({
        pane,
        resetKey,
        autoScroll,
        isFollowing,
        visible,
    });
    useLayoutEffect(() => {
        latestEligibilityRef.current = {
            pane,
            resetKey,
            autoScroll,
            isFollowing,
            visible,
        };
    }, [autoScroll, isFollowing, pane, resetKey, visible]);

    const cancelScheduledBottom = useCallback(() => {
        if (rafRef.current === null) return;

        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
    }, []);

    const scrollToBottom = useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;

        container.scrollTop = Math.max(
            0,
            container.scrollHeight - container.clientHeight,
        );
    }, [scrollRef]);

    const scheduleBottom = useCallback(() => {
        cancelScheduledBottom();
        const scheduled = { pane, resetKey };
        rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            if (
                shouldApplyFollowFrame(
                    scheduled,
                    latestEligibilityRef.current,
                )
            ) {
                scrollToBottom();
            }
        });
    }, [cancelScheduledBottom, pane, resetKey, scrollToBottom]);

    const onContentResize = useCallback(() => {
        const scheduled = { pane, resetKey };
        if (
            !shouldScheduleContentResizeFollow(
                scheduled,
                latestEligibilityRef.current,
            )
        ) {
            cancelScheduledBottom();
            return;
        }

        scheduleBottom();
    }, [cancelScheduledBottom, pane, resetKey, scheduleBottom]);

    const onScroll = useCallback(() => {
        const container = scrollRef.current;
        if (!container) return;

        const distance =
            container.scrollHeight -
            container.scrollTop -
            container.clientHeight;
        const nearBottom = distance <= BOTTOM_THRESHOLD;

        if (!nearBottom) cancelScheduledBottom();

        setIsFollowing(autoScroll && nearBottom);
        if (nearBottom) {
            setWorkspaceState((current) => goLivePane(current, pane));
        }
    }, [autoScroll, cancelScheduledBottom, pane, scrollRef]);

    const goLive = useCallback(() => {
        scrollToBottom();
        setWorkspaceState((current) => goLivePane(current, pane));
        setIsFollowing(autoScroll);
    }, [autoScroll, pane, scrollToBottom]);

    useEffect(() => {
        const delta = logicalRevision - previousLogicalRef.current;
        previousLogicalRef.current = logicalRevision;

        if (delta <= 0) return;

        if (autoScroll && isFollowing) {
            if (visible) scheduleBottom();
            return;
        }

        setWorkspaceState((current) => {
            let next = current;

            for (let index = 0; index < delta; index += 1) {
                next = recordPaneItem(next, {
                    pane,
                    hidden: false,
                    paused: true,
                    stable: true,
                });
            }

            return next;
        });
    }, [
        autoScroll,
        isFollowing,
        logicalRevision,
        pane,
        scheduleBottom,
        visible,
    ]);

    useEffect(() => {
        if (autoScroll && isFollowing && visible) scheduleBottom();
    }, [
        autoScroll,
        contentRevision,
        isFollowing,
        scheduleBottom,
        visible,
    ]);

    useEffect(() => {
        if (!autoScroll) {
            cancelScheduledBottom();
            setIsFollowing(false);
            return;
        }

        const container = scrollRef.current;
        const nearBottom =
            !container ||
            container.scrollHeight -
                container.scrollTop -
                container.clientHeight <=
                BOTTOM_THRESHOLD;
        if (!nearBottom) cancelScheduledBottom();
        setIsFollowing(nearBottom);
    }, [autoScroll, cancelScheduledBottom, scrollRef]);

    useEffect(() => {
        if (appliedResetKeyRef.current === resetKey) return;

        appliedResetKeyRef.current = resetKey;
        cancelScheduledBottom();
        setWorkspaceState(createWorkspaceState());
        setIsFollowing(autoScroll);
        previousLogicalRef.current = logicalRevision;
    }, [
        autoScroll,
        cancelScheduledBottom,
        logicalRevision,
        resetKey,
    ]);

    useEffect(
        () => () => {
            cancelScheduledBottom();
        },
        [cancelScheduledBottom],
    );

    return {
        isFollowing,
        pausedUnread: workspaceState.pausedScrollUnread[pane],
        onScroll,
        onContentResize,
        goLive,
        scrollToBottom,
    };
}
