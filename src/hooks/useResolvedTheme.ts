import { useEffect, useState } from 'react';

type ResolvedTheme = 'light' | 'dark';

const getResolvedTheme = (): ResolvedTheme =>
    document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';

export const useResolvedTheme = (): ResolvedTheme => {
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => getResolvedTheme());

    useEffect(() => {
        setResolvedTheme(getResolvedTheme());

        if (!window.electronAPI?.onThemeChanged) return;

        return window.electronAPI.onThemeChanged(({ resolved }) => {
            setResolvedTheme(resolved);
        });
    }, []);

    return resolvedTheme;
};
