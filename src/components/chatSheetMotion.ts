import type { MotionProps, Transition } from 'framer-motion';

// Motion for the two bottom chat sheets: the launcher's "Ask me anything"
// (GlobalChatOverlay) and the meeting notes' "Ask about this meeting"
// (MeetingChatOverlay). Closing plays the opening backwards.
//
// Open:  the scrim fades in while the sheet slides up from below the window
//        edge on a no-bounce spring, the way an iOS/macOS sheet presents.
// Close: the sheet slides back down on the same curve, a little quicker
//        (close gets out of the way), while the scrim fades out with it.
//
// The sheet moves by transform, at its full 85vh. It used to grow its height
// from 0, which re-laid-out the whole chat every frame and stuttered.
//
// The wrapper in both overlays has no animation of its own. When the fade sat
// on it, the sheet went with it: everything was invisible after 160 ms, so the
// slide-down ran unseen and closing read as a blink. AnimatePresence keeps the
// wrapper mounted until the sheet's and scrim's exits finish.

// Open: the sheet rides a no-bounce spring (critically damped: no overshoot, a
// soft settle, ~95% up by 0.4 s). A spring from rest starts gently, so the
// scrim uses the plain CSS 'ease' curve to rise with it. Front-loaded curves
// (--ease-smooth-out, the iOS 0.32/0.72/0/1) were measured in the app with the
// scrim 65% in while the sheet was 4% up: the dim popped, the sheet lagged.
//
// Close: the open backwards, sheet and scrim on one ease-in-out so they leave
// together. It starts gently, sweeps, and lands without the spring's tail
// (which crept the last 40 px for ~300 ms). A touch quicker than the open.
const EASE_SCRIM_IN = [0.25, 0.1, 0.25, 1] as const;
const EASE_CLOSE = [0.4, 0, 0.2, 1] as const;
const OPEN_S = 0.55;
const CLOSE_S = 0.45;

const SHEET_OPEN: Transition = { type: 'spring', visualDuration: OPEN_S, bounce: 0 };
const SHEET_CLOSE: Transition = { duration: CLOSE_S, ease: EASE_CLOSE };

// framer-motion hands a lone opacity animation to the browser's compositor.
// In the app that copy ran ahead of its own timing: the scrim's 450 ms close
// was done at ~345 ms, gone while the sheet (moved by framer's JS loop) was
// still a quarter up. An onUpdate handler keeps the scrim on framer's loop, so
// it and the sheet are computed in the same frame and stay together.
const STAY_ON_JS_LOOP = () => {};

export function chatScrimMotion(reduceMotion: boolean): MotionProps {
    return {
        onUpdate: STAY_ON_JS_LOOP,
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: reduceMotion ? 0.2 : 0.5, ease: EASE_SCRIM_IN } },
        exit: { opacity: 0, transition: { duration: reduceMotion ? 0.15 : CLOSE_S, ease: EASE_CLOSE } },
    };
}

export function chatSheetMotion(reduceMotion: boolean): MotionProps {
    if (reduceMotion) {
        // No travel: a plain cross-fade in place.
        return {
            initial: { opacity: 0 },
            animate: { opacity: 1, transition: { duration: 0.2, ease: 'easeOut' } },
            exit: { opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } },
        };
    }
    return {
        initial: { y: '100%' },
        animate: { y: 0, transition: SHEET_OPEN },
        exit: { y: '100%', transition: SHEET_CLOSE },
    };
}
