import { useEffect, useState } from 'react';

type ResolvedTheme = 'light' | 'dark';

const getResolvedTheme = (): ResolvedTheme =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

let globalUnsubscribe: (() => void) | null = null;
let listenerCount = 0;

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        if (globalUnsubscribe) {
            globalUnsubscribe();
            globalUnsubscribe = null;
        }
        listenerCount = 0;
    });
}

export const useResolvedTheme = (): ResolvedTheme => {
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => getResolvedTheme());

    useEffect(() => {
        listenerCount++;

        if (!globalUnsubscribe && window.electronAPI?.onThemeChanged) {
            globalUnsubscribe = window.electronAPI.onThemeChanged(({ resolved }) => {
                document.documentElement.setAttribute('data-theme', resolved);
                setResolvedTheme(resolved);
            });
        }

        const observer = new MutationObserver(() => {
            setResolvedTheme(getResolvedTheme());
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme'],
        });

        return () => {
            observer.disconnect();
            listenerCount--;
            if (listenerCount === 0 && globalUnsubscribe) {
                globalUnsubscribe();
                globalUnsubscribe = null;
            }
        };
    }, []);

    return resolvedTheme;
};
