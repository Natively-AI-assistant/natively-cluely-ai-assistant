/**
 * AI-provider brand marks — the single source for every surface that names a
 * cloud MODEL provider.
 *
 * Extracted from AIProvidersSettings.tsx, which still re-exports all three maps
 * under their original `AIP_*` names. It moved here because a second surface
 * needs them: the overlay's model picker rendered a generic <Cloud> glyph for
 * every provider except Gemini, so "Llama 3.1 8B (Nvidia Nim)" and every OpenAI,
 * Claude, DeepSeek and Groq entry shipped with no brand at all. Duplicating the
 * registry there is exactly the drift src/assets/provider-logos/README.md warns
 * about, so there is one map and two renderers over it:
 *
 *   <AipProviderMark>  tiled,      Settings > AI Providers (needs AIP_CSS)
 *   <ProviderMark>     tile-less,  anywhere else (the model picker)
 *
 * Adding a provider means adding it HERE, once. See the README for licence rules
 * and for why some brands stay monograms.
 *
 * Imported with `?raw` and inlined rather than used as <img src>: most of these
 * paint with `fill="currentColor"`, which does not resolve inside an <img> — a
 * separate document context — so the monochrome marks would render black and
 * disappear against the dark theme.
 */
import geminiMark from '../../assets/provider-logos/gemini.svg?raw';
import claudeMark from '../../assets/provider-logos/claude.svg?raw';
import deepseekMark from '../../assets/provider-logos/deepseek.svg?raw';
import groqMark from '../../assets/provider-logos/groq.svg?raw';
import openaiMark from '../../assets/provider-logos/openai.svg?raw';
import ollamaMark from '../../assets/provider-logos/ollama.svg?raw';
import nvidiaMark from '../../assets/provider-logos/nvidia.svg?raw';
// LiteLLM ships its mark only as a raster favicon (160x160 PNG), so this one is a
// URL rather than inlined markup. No currentColor to resolve in a PNG, so <img>
// loses nothing here. Vendored from BerriAI/litellm — MIT, and outside the
// `enterprise/` directory that their LICENSE carves out.
import litellmMark from '../../assets/provider-logos/litellm.png';
// Our own app icon, for the Natively API row. Raster and full-colour, so it is a
// URL rendered with <img> for the same reason as litellm.
import nativelyIcon from '../../../assets/icon-512.png';

/**
 * Monogram letters + the tile wash colour, for providers with no vendored mark
 * (and as the safety net behind every provider that has one).
 */
export const AI_PROVIDER_BRANDS: Record<string, { mono: string; brand: string }> = {
    gemini:   { mono: 'GE', brand: '#7C9CF5' },
    groq:     { mono: 'GQ', brand: '#F2755C' },
    openai:   { mono: 'OA', brand: '#10A37F' },
    claude:   { mono: 'CL', brand: '#D97757' },
    deepseek: { mono: 'DS', brand: '#4D6BFE' },
    // Mark is vendored (nvidia.svg), so `mono` is only a safety net; `brand`
    // still drives the tile wash. Hex is NVIDIA green as shipped in the mark.
    nvidia_nim: { mono: 'NV', brand: '#76B900' },
    codex:    { mono: 'CX', brand: '#10A37F' },
    litellm:  { mono: 'LL', brand: '#8B5CF6' },
    ollama:   { mono: 'OL', brand: '#9CA3AF' },
    natively: { mono: 'NA', brand: '#7C9CF5' },
};

/** Raster marks, rendered as <img>. See AI_PROVIDER_MARKS for the inlined SVGs. */
export const AI_PROVIDER_MARK_IMAGES: Record<string, string> = {
    litellm: litellmMark,
    natively: nativelyIcon,
};

/**
 * Provider id → inlined brand mark. Absent keys fall through to
 * AI_PROVIDER_MARK_IMAGES, then to a monogram (tiled renderer) or the caller's
 * fallback glyph (tile-less renderer). Custom providers are user-defined
 * endpoints with no brand, so they always land on the fallback.
 * `codex` maps to the OpenAI mark and `anthropic` to Claude's — same brands.
 */
export const AI_PROVIDER_MARKS: Record<string, string> = {
    gemini: geminiMark,
    claude: claudeMark,
    anthropic: claudeMark,
    deepseek: deepseekMark,
    groq: groqMark,
    openai: openaiMark,
    codex: openaiMark,
    ollama: ollamaMark,
    nvidia_nim: nvidiaMark,
};

/** True when this provider resolves to a real mark rather than a fallback. */
export const hasAiProviderMark = (provider: string): boolean => {
    const key = (provider || '').toLowerCase();
    return Boolean(AI_PROVIDER_MARKS[key] || AI_PROVIDER_MARK_IMAGES[key]);
};
