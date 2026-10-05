import React from 'react';
import { AI_PROVIDER_MARKS, AI_PROVIDER_MARK_IMAGES, AI_PROVIDER_BRANDS } from './aiProviderMarks';

interface ProviderMarkProps {
    /** Provider id, e.g. 'nvidia_nim'. Case-insensitive. */
    provider: string;
    /** Rendered size in px. Vendored marks are 1em, so this is applied as font-size. */
    size?: number;
    /**
     * Rendered when the provider has no vendored mark — custom endpoints, local
     * engines, anything without a licence-clean logo. Required rather than
     * optional: returning null here is how the model picker ended up with rows
     * that had no icon at all.
     */
    fallback: React.ReactNode;
    className?: string;
}

/**
 * A bare AI-provider mark — no tile, no surface, no border.
 *
 * The tile-less twin of <AipProviderMark>, which wraps its mark in `.aip-tile`.
 * That class is defined in AIP_CSS, a token block scoped to the AI Providers
 * panel, so the tiled renderer paints as an unstyled box anywhere else. This one
 * emits only the glyph and is safe in the overlay.
 *
 * `dangerouslySetInnerHTML` is safe here and is the point of the `?raw` import:
 * these are build-time constants vendored from pinned packages and verified to
 * contain only vector paths — no <script>, no <foreignObject>, no external
 * references. Nothing user-supplied ever reaches this.
 */
export const ProviderMark: React.FC<ProviderMarkProps> = ({ provider, size = 16, fallback, className = '' }) => {
    const key = (provider || '').toLowerCase();
    const markup = AI_PROVIDER_MARKS[key];
    const imageSrc = AI_PROVIDER_MARK_IMAGES[key];

    if (!markup && imageSrc) {
        return (
            <img
                src={imageSrc}
                alt=""
                aria-hidden="true"
                width={size}
                height={size}
                className={`object-contain ${className}`}
            />
        );
    }

    if (!markup) return <>{fallback}</>;

    return (
        <span
            aria-hidden="true"
            className={`inline-flex items-center justify-center ${className}`}
            style={{
                // The marks are width/height="1em", so font-size IS the size.
                fontSize: size,
                lineHeight: 0,
                // Resolves fill="currentColor" on the monochrome marks. The
                // full-colour ones (gemini, claude, deepseek, nvidia) carry their
                // own fills and ignore this entirely.
                color: AI_PROVIDER_BRANDS[key]?.brand,
            }}
            dangerouslySetInnerHTML={{ __html: markup }}
        />
    );
};
