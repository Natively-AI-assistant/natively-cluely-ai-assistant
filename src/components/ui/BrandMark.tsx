import React from 'react';

// Official brand marks for the speech providers in Settings → Audio, vendored
// from pinned packages. See src/assets/provider-logos/README.md for provenance
// and licences.
//
// Each mark is rendered in ITS OWN BRAND COLOUR, which is why the speech
// selector gives marked rows a neutral tile rather than the per-provider tint it
// uses elsewhere — a multicolour Google mark on a blue wash reads as an accident.
//
// Two kinds of mark live here and the difference is deliberate:
//
//   FULL-COLOUR (googlecloud, azure) — hardcoded fills, vendored from the
//   upstream `-color` variants. They look identical in both themes.
//
//   MONOCHROME (openai, groq, elevenlabs, ibm, deepgram) — `fill="currentColor"`,
//   because those marks genuinely ARE monochrome as brands. currentColor is not a
//   compromise for them, it is the correct reproduction: it takes the brand hex
//   from BRAND_COLORS where one is published, and otherwise inherits the tile's
//   text colour so a black-and-white brand stays legible in both themes.
//
// Imported with `?raw` and inlined rather than used as <img src>: currentColor
// does not resolve inside an <img>, which is a separate document context, so the
// monochrome marks would render black and disappear against the dark theme.
import googlecloudMark from '../../assets/provider-logos/googlecloud.svg?raw';
import groqMark from '../../assets/provider-logos/groq.svg?raw';
import openaiMark from '../../assets/provider-logos/openai.svg?raw';
import deepgramMark from '../../assets/provider-logos/deepgram.svg?raw';
import elevenlabsMark from '../../assets/provider-logos/elevenlabs.svg?raw';
import azureMark from '../../assets/provider-logos/azure.svg?raw';
import ibmMark from '../../assets/provider-logos/ibm.svg?raw';
// Platform marks, for the Local Models row — the models run on THIS machine, so
// the host OS is the identity. Which one renders is decided at the call site, so
// this registry stays a plain id→asset map with no platform logic in it.
import appleMark from '../../assets/provider-logos/apple.svg?raw';
import microsoftMark from '../../assets/provider-logos/microsoft.svg?raw';
// Our own app icon, for the Natively API row. Raster and full-colour, so it is a
// URL rendered with <img> rather than inlined markup — there is no currentColor
// in a PNG, so an <img> loses nothing.
import nativelyIcon from '../../../assets/icon-512.png';

/**
 * Provider id → inlined brand mark, keyed by the ids used in the speech provider
 * selector. Absent keys are expected to fall back to a monogram or a glyph at
 * the call site.
 */
export const BRAND_MARKS: Record<string, string> = {
    google: googlecloudMark,
    groq: groqMark,
    openai: openaiMark,
    deepgram: deepgramMark,
    elevenlabs: elevenlabsMark,
    azure: azureMark,
    ibmwatson: ibmMark,
    apple: appleMark,
    microsoft: microsoftMark,
};

/**
 * Raster marks, rendered as <img>. Split from BRAND_MARKS for the same reason
 * AIProvidersSettings splits AIP_PROVIDER_LOGO_IMAGES from AIP_PROVIDER_LOGOS:
 * a PNG has no currentColor to resolve, so it needs no inlining.
 */
export const BRAND_MARK_IMAGES: Record<string, string> = {
    natively: nativelyIcon,
};

/**
 * Published brand hex for the monochrome marks, applied as `color` so the
 * mark's `fill="currentColor"` resolves to it.
 *
 * Only providers with an AUTHORITATIVE published hex appear here. Everything
 * else deliberately inherits the tile's text colour:
 *
 *   openai, groq, elevenlabs — black-and-white brands (simple-icons records
 *     ElevenLabs as #000000). Pinning them to black would make them vanish in
 *     the dark theme; inheriting reproduces the brand correctly in both.
 *   ibmwatson — IBM publishes no mark in either source package and simple-icons
 *     carries no IBM entry, so there is no hex to cite. Guessing one would be
 *     inventing a brand colour; it inherits instead.
 */
export const BRAND_COLORS: Record<string, string> = {
    // simple-icons v16.28.0, `Deepgram` → hex 13EF93.
    deepgram: '#13EF93',
};

/**
 * Provider ids that deliberately have no vendored mark, and why. Kept as data so
 * the coverage test can tell "intentionally a monogram" apart from "someone added
 * a provider and forgot the icon" — the latter is exactly how every option in this
 * selector ended up sharing one generic microphone glyph.
 */
export const BRAND_MARK_EXEMPT: Record<string, string> = {
    // Soniox publishes no mark under a licence compatible with AGPL-3.0 — it is in
    // neither @lobehub/icons-static-svg (MIT) nor simple-icons (CC0). Per the rule
    // in src/assets/provider-logos/README.md, that stays a monogram.
    soniox: 'no licence-compatible mark published',
};

/** True when the selector should give this row a neutral tile instead of a tint. */
export const hasBrandMark = (provider: string): boolean => {
    const key = (provider || '').toLowerCase();
    return Boolean(BRAND_MARKS[key] || BRAND_MARK_IMAGES[key]);
};

interface BrandMarkProps {
    /** Provider id. Must be a key of BRAND_MARKS. */
    provider: string;
    /** Rendered size in px. Every vendored mark is width/height="1em", so this is
     *  applied as font-size and the SVG scales itself — no CSS rule required. */
    size?: number;
    className?: string;
}

/**
 * A bare brand mark — no tile, no surface, no border.
 *
 * Tile-less by design. The speech selector already wraps its icon in a sized
 * tile (w-9 h-9 in the trigger, w-8 h-8 in the list), so this emits only the
 * glyph. Reusing AIProvidersSettings' <AipProviderMark> here would nest a second
 * `.aip-tile` surface and border inside that existing tile.
 *
 * `dangerouslySetInnerHTML` is safe here and is the point of the `?raw` import:
 * these are build-time constants vendored from pinned packages and verified to
 * contain only vector paths — no <script>, no <foreignObject>, no external
 * references. Nothing user-supplied ever reaches this.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({ provider, size = 16, className = '' }) => {
    const key = (provider || '').toLowerCase();
    const markup = BRAND_MARKS[key];
    const imageSrc = BRAND_MARK_IMAGES[key];

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

    if (!markup) return null;

    return (
        <span
            aria-hidden="true"
            className={`inline-flex items-center justify-center ${className}`}
            style={{
                // The marks are width/height="1em", so font-size IS the size. This
                // is why deepgram.svg was normalised to 1em at vendor time —
                // simple-icons ships it dimensionless, which would ignore this.
                fontSize: size,
                lineHeight: 0,
                // Resolves fill="currentColor" on the monochrome marks. Undefined
                // for the full-colour ones, which carry their own fills and ignore
                // this entirely.
                color: BRAND_COLORS[key],
            }}
            dangerouslySetInnerHTML={{ __html: markup }}
        />
    );
};

interface BrandMonogramProps {
    /** Seeds the monogram. Reduced to two letters — see monogramOf. */
    name: string;
    className?: string;
}

/**
 * Two letters for a name.
 *
 * A multi-word name takes one letter from each of its first two words, because
 * the first two CHARACTERS of a multi-word name are meaningless — "Local Models"
 * would read "LO". A single word keeps its first two letters, so "Soniox" stays
 * "SO".
 */
export function monogramOf(name: string): string {
    const words = (name || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '??';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Two-letter fallback for a row with no licence-clean mark, mirroring
 * <AipMonogram> in the AI Providers panel. Colour is inherited: the selector
 * supplies the tile treatment, so this only sets the letterform.
 */
export const BrandMonogram: React.FC<BrandMonogramProps> = ({ name, className = '' }) => (
    <span
        aria-hidden="true"
        className={`text-[10px] font-bold tracking-tight leading-none ${className}`}
    >
        {monogramOf(name)}
    </span>
);
