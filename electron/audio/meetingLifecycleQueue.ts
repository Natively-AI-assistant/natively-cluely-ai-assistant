/**
 * Serializes meeting start/stop transitions.
 *
 * WHY THIS EXISTS
 * ---------------
 * `AppState.startMeeting()` / `endMeeting()` are reachable concurrently from
 * renderer IPC, calendar auto-start, global shortcuts and the tray. They were
 * plain async methods with no mutual exclusion, so two starts, a stop landing
 * mid-start, or a start landing mid-stop could interleave and tear down state
 * the other half was still using.
 *
 * The existing protections each guard ONE hazard *inside* a transition —
 * `_meetingGeneration` bounds ownership of async audio init, the
 * `_audioInitPromise` abort-and-await stops a stale pipeline from attaching,
 * `_pendingTeardown` keeps a background STT drain from clobbering a new
 * session. None of them stop two transitions from running at the same time.
 * This queue supplies exactly that missing property and nothing else, so the
 * carefully-ordered bodies it wraps stay untouched.
 *
 * COALESCING RULES
 * ----------------
 * Same-direction duplicates join the in-flight request. Opposite-direction
 * requests QUEUE, and the last requested direction is the one the lifecycle
 * settles into. That distinction matters: coalescing on "is any request
 * pending" rather than on DIRECTION silently swallowed the restart in
 * stop-then-immediately-start, leaving the user looking at a stopped meeting
 * after pressing Start.
 *
 * Deliberately platform-neutral and dependency-free — no Electron, no
 * `process.platform`. The macOS and Windows lifecycles share this contract.
 */

export type MeetingLifecycleState = 'idle' | 'starting' | 'active' | 'stopping' | 'failed';

type TransitionDirection = 'starting' | 'stopping';

export class MeetingLifecycleQueue {
    private state: MeetingLifecycleState = 'idle';
    /** Tail of the serial chain. Every transition links onto this. */
    private transition: Promise<void> = Promise.resolve();
    private startRequest: Promise<void> | null = null;
    private stopRequest: Promise<void> | null = null;
    /** Direction of the most recently ACCEPTED request — decides coalescing. */
    private lastRequestDirection: TransitionDirection | null = null;
    /**
     * The runner a QUEUED-but-not-yet-started transition will execute.
     *
     * Coalescing must not discard the newest caller's intent. `startMeeting`
     * closes over its `metadata`, which carries the calendar title/event id and
     * the user's chosen audio devices (`metadata.audio.inputDeviceId` drives
     * reconfigureAudio). Returning the first request's promise while throwing
     * away the second's closure meant a manual Start racing a calendar
     * auto-start could silently ignore the user's selected microphone, and the
     * caller was still told it succeeded.
     *
     * So while a transition is still QUEUED, a later same-direction request
     * replaces its runner — last intent wins. Once the body has begun executing
     * the slot is cleared and further requests genuinely coalesce, which is
     * correct: the meeting is already starting and there is nothing to re-apply.
     */
    private queuedRunner: { direction: TransitionDirection; run: () => Promise<void> } | null = null;

    constructor(private readonly onStateChange?: (state: MeetingLifecycleState) => void) {}

    getState(): MeetingLifecycleState {
        return this.state;
    }

    /** Request a meeting start. Returns the transition the caller should await. */
    start(run: () => Promise<void>): Promise<void> {
        // Join an in-flight start only when nothing has since asked to stop —
        // otherwise this is a genuine restart and must queue behind that stop.
        if (this.startRequest && this.lastRequestDirection === 'starting') {
            // Still queued? Adopt the newer intent rather than dropping it.
            if (this.queuedRunner?.direction === 'starting') this.queuedRunner.run = run;
            return this.startRequest;
        }
        // Already running and no teardown pending: nothing to do.
        if (!this.stopRequest && this.state === 'active') return Promise.resolve();
        return this.enqueue('starting', run);
    }

    /** Request a meeting stop. Returns the transition the caller should await. */
    stop(run: () => Promise<void>): Promise<void> {
        if (this.stopRequest && this.lastRequestDirection === 'stopping') {
            if (this.queuedRunner?.direction === 'stopping') this.queuedRunner.run = run;
            return this.stopRequest;
        }
        // Already idle and no start pending: nothing to tear down.
        if (!this.startRequest && this.state === 'idle') return Promise.resolve();
        return this.enqueue('stopping', run);
    }

    private enqueue(direction: TransitionDirection, runTransition: () => Promise<void>): Promise<void> {
        // Held in a mutable slot so a later same-direction request can replace
        // the runner right up until this body starts executing.
        const slot = { direction, run: runTransition };
        this.queuedRunner = slot;

        const body = async (): Promise<void> => {
            const run = slot.run;
            // Past this point the transition owns the meeting; later requests
            // coalesce onto it instead of swapping the runner underneath it.
            if (this.queuedRunner === slot) this.queuedRunner = null;
            this.setState(direction);
            try {
                await run();
                this.setState(direction === 'starting' ? 'active' : 'idle');
            } catch (error) {
                // Surface the failure to the caller, but leave the chain usable —
                // a failed start must not block the stop that recovers from it.
                this.setState('failed');
                throw error;
            }
        };

        // Link onto the tail with the SAME callback for both settle paths so a
        // rejected predecessor still lets this transition run.
        const request = this.transition.then(body, body);
        this.transition = request.catch(() => { /* the chain must never stay rejected */ });

        this.lastRequestDirection = direction;
        if (direction === 'starting') {
            this.startRequest = request;
            void request.then(
                () => { if (this.startRequest === request) this.startRequest = null; },
                () => { if (this.startRequest === request) this.startRequest = null; },
            );
        } else {
            this.stopRequest = request;
            void request.then(
                () => { if (this.stopRequest === request) this.stopRequest = null; },
                () => { if (this.stopRequest === request) this.stopRequest = null; },
            );
        }
        return request;
    }

    private setState(state: MeetingLifecycleState): void {
        this.state = state;
        try {
            this.onStateChange?.(state);
        } catch {
            // Lifecycle observation is diagnostics only — it must never be able
            // to break a start or stop.
        }
    }
}
