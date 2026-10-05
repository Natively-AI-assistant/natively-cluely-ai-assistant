/**
 * Words the speech-to-text should expect in this meeting (2026-09-27): today,
 * the user's own name. Interviewers and teammates say it ("Evin, can you…"),
 * STT spells an uncommon one a new way each time ("Evan", "Kevin", "Alec"),
 * and Auto Answer's judge needs it spelled right to tell an ask to the USER
 * from one to someone else.
 *
 * Set by main at meeting start, read by each streaming provider when it builds
 * its connect frame, so a reconnect mid-meeting carries the same terms:
 *   Soniox (BYOK)    config.context.terms
 *   Deepgram (BYOK)  keyterm (Nova-3) / keywords (Nova-2)
 *   Natively         context_terms in the auth frame; natively-api hands them
 *                    to Soniox as context.terms
 * Providers with no hint input (OpenAI, ElevenLabs, NIM, local models) ignore it.
 *
 * Only identifier-like text leaves: a name is personal data, but it is the
 * user's own and goes only to the transcription provider they already send
 * their meeting audio to.
 */

const MAX_TERMS = 10;
const MAX_TERM_CHARS = 40;
/** Letters (any script), digits, spaces and the punctuation names use. */
const TERM_RE = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'’-]*$/u;

/**
 * On globalThis, not a module variable: the build bundles every entry with its
 * own inlined copy of this module, so a provider loaded from its own bundle
 * would read an empty copy of a module-level list. One process, one list.
 */
const SLOT = Symbol.for('natively.sttContextTerms');
const store = globalThis as unknown as Record<symbol, string[] | undefined>;

export function sanitizeSttTerms(input: readonly unknown[] | null | undefined): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of input ?? []) {
        if (typeof raw !== 'string') continue;
        const t = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
        if (!t || t.length > MAX_TERM_CHARS || !TERM_RE.test(t)) continue;
        const key = t.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
        if (out.length >= MAX_TERMS) break;
    }
    return out;
}

/** The user's name as terms: the full name, and the first name on its own. */
export function nameTerms(name: string | null | undefined): string[] {
    const full = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
    if (!full) return [];
    const first = full.split(' ')[0];
    return sanitizeSttTerms(first && first !== full ? [full, first] : [full]);
}

export function setSttContextTerms(terms: readonly unknown[] | null | undefined): void {
    store[SLOT] = sanitizeSttTerms(terms);
}

export function getSttContextTerms(): string[] {
    return [...(store[SLOT] ?? [])];
}
