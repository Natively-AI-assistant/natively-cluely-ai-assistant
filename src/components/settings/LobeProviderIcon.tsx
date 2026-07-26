/**
 * LobeProviderIcon — High-performance AI provider icon renderer.
 * Features:
 * - Theme-adaptive circular container (soft light-gray in light mode, dark gray in dark mode)
 * - Custom brand icons for LiteLLM, Custom Endpoints, ChatGPT Codex, and Groq
 * - LobeHub CDN SVG icons (mono / color / brand variants)
 * - Automatic HTTP caching & lazy loading
 * - React memoization to prevent unnecessary re-renders
 * - Fallback chain: Custom Asset -> Color SVG -> Mono SVG -> Letter Avatar
 */

import React, { useState, memo } from 'react';

import litellmSvg from '../../assets/provider-logos/litellm.svg';
import customEndpointsSvg from '../../assets/provider-logos/custom-endpoints.svg';
import codexPng from '../../assets/provider-logos/codex.png';
import groqWebp from '../../assets/provider-logos/groq.webp';

const LOCAL_ASSET_MAP: Record<string, string> = {
    litellm: litellmSvg,
    custom: customEndpointsSvg,
    'custom-endpoints': customEndpointsSvg,
    codex: codexPng,
    groq: groqWebp,
};

const LOBE_ICON_IDS: Record<string, string> = {
    gemini: 'gemini',
    groq: 'groq',
    openai: 'openai',
    claude: 'claude',
    anthropic: 'claude',
    deepseek: 'deepseek',
    openrouter: 'openrouter',
    ollama: 'ollama',
    natively: 'google',
    mistral: 'mistral',
    perplexity: 'perplexity',
    cohere: 'cohere',
    google: 'google',
    meta: 'meta',
    azure: 'azure',
};

const CDN_BASE = 'https://unpkg.com/@lobehub/icons-static-svg@latest/icons';

function getIconUrl(providerId: string, color = true): string {
    const key = (providerId || '').toLowerCase();
    if (LOCAL_ASSET_MAP[key]) return LOCAL_ASSET_MAP[key];

    const id = LOBE_ICON_IDS[key] || key;
    const suffix = color ? '-color' : '';
    return `${CDN_BASE}/${id}${suffix}.svg`;
}

interface LobeProviderIconProps {
    /** Provider key e.g. 'gemini', 'openrouter', 'openai', 'claude', 'litellm', 'custom' */
    provider: string;
    /** Display name for alt text & avatar fallback */
    name?: string;
    /** Icon image size inside the circle (default 16) */
    size?: number;
    /** Explicit color variant toggle */
    color?: boolean;
    /** Extra container classes */
    className?: string;
    /** Whether to render inside circular container (default true) */
    circular?: boolean;
}

export const LobeProviderIcon: React.FC<LobeProviderIconProps> = memo(({
    provider,
    name,
    size = 16,
    color = true,
    className = '',
    circular = true,
}) => {
    const [failed, setFailed] = useState(false);
    const [triedMono, setTriedMono] = useState(false);

    const displayName = name || provider || 'AI';
    const letter = displayName.charAt(0).toUpperCase();

    const handleError = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const key = (provider || '').toLowerCase();
        if (LOCAL_ASSET_MAP[key]) {
            setFailed(true);
            return;
        }
        if (!triedMono && color) {
            setTriedMono(true);
            (e.target as HTMLImageElement).src = getIconUrl(provider, false);
        } else {
            setFailed(true);
        }
    };

    // Size computations for circular container
    const circleSize = Math.max(size + 8, 24);

    const innerContent = failed ? (
        <div
            className="flex items-center justify-center font-bold text-xs select-none uppercase"
            style={{ fontSize: Math.max(size * 0.5, 10) }}
        >
            {letter}
        </div>
    ) : (
        <img
            src={getIconUrl(provider, color && !triedMono)}
            alt={displayName}
            width={size}
            height={size}
            className="object-contain shrink-0 transition-transform duration-200"
            onError={handleError}
            loading="lazy"
        />
    );

    if (!circular) {
        return <div className={`inline-flex items-center justify-center shrink-0 ${className}`}>{innerContent}</div>;
    }

    return (
        <div
            className={`inline-flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800/90 text-zinc-900 dark:text-zinc-100 border border-zinc-200/90 dark:border-zinc-700/60 shadow-sm shrink-0 transition-colors ${className}`}
            style={{ width: circleSize, height: circleSize }}
            title={displayName}
        >
            {innerContent}
        </div>
    );
});

LobeProviderIcon.displayName = 'LobeProviderIcon';

export default LobeProviderIcon;
