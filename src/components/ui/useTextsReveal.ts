import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Drives the Transitions.dev "Texts reveal" (textsReveal.css) for an element
 * that mounts. Without `reveal` it is `.is-shown` from the first paint and
 * nothing animates. With it, the element mounts without `.is-shown`, one
 * reflow commits that start state, and then `.is-shown` is added in the same
 * task, which plays the staggered entrance.
 */
export function useTextsReveal<T extends HTMLElement>(reveal: boolean) {
    const ref = useRef<T>(null);
    const [shown, setShown] = useState(!reveal);
    useLayoutEffect(() => {
        if (shown) return;
        void ref.current?.offsetHeight;
        setShown(true);
    }, [shown]);
    return { ref, shown };
}
