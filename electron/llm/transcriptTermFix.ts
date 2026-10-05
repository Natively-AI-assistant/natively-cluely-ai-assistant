/**
 * Post-processing fix for phonetically mangled English tech terms in
 * non-English (Cyrillic) transcripts.
 *
 * WHY: STT models running under a ru/uk primary language spell embedded
 * English terms phonetically — "в чём разница между стейтлес виджет и
 * стейтфул виджет". Provider-side vocabulary biasing helps but is capped
 * (ElevenLabs: 50 keyterms; Google: 500 phrases) and provider-specific.
 * This runs AFTER recognition on final segments only, so it works with
 * every provider, costs nothing, and adds zero latency worth noticing.
 *
 * HOW: Cyrillic word runs are transliterated to Latin, then both sides are
 * reduced to a consonant skeleton (phonetic merges → drop vowels → collapse
 * repeats). "стейтлес" → steitles → stls; "stateless" → sttlss → stls.
 * A run is replaced only on an EXACT skeleton match against the glossary —
 * no edit-distance fuzziness — so ordinary Russian/Ukrainian words are
 * never rewritten by accident.
 *
 * Latin text is never touched: only Cyrillic word windows are candidates.
 */
import { DEFAULT_TECH_PHRASE_HINTS } from '../config/sttPhraseHints';

const TRANSLIT: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
    щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
    // Ukrainian
    і: 'i', ї: 'i', є: 'e', ґ: 'g',
};

const CYRILLIC_RE = /[а-яёіїєґ]/i;

/**
 * Reduce a single word (Latin or Cyrillic) to a consonant skeleton in which
 * an English spelling and its Russian phonetic transcription converge.
 */
export function phoneticSkeleton(word: string): string {
    let s = word.toLowerCase();
    s = s.replace(/[а-яёіїєґ]/g, ch => TRANSLIT[ch] ?? '');
    s = s.replace(/[^a-z]/g, '');
    // Phonetic merges (applied to BOTH sides so spellings converge):
    s = s
        .replace(/tch/g, 'ch')  // "watch" / "вотч"
        .replace(/dzh|dg/g, 'j') // "widget"→vijet / "виджет"→vijet
        .replace(/ph/g, 'f')     // "graph" / "граф"
        .replace(/th/g, 't')     // "thread" / "тред"
        .replace(/ck/g, 'k')     // "docker" / "докер"
        .replace(/w/g, 'v')      // "widget" / "виджет"
        .replace(/x/g, 'ks')     // "index" / "индекс"
        .replace(/c/g, 'k')      // approximate; a miss here only skips a fix
        .replace(/qu/g, 'kv');   // "query" / "квери"
    s = s.replace(/[aeiouy]/g, '');       // vowels differ most across languages
    s = s.replace(/(.)\1+/g, '$1');       // collapse doubled consonants
    return s;
}

interface GlossaryEntry {
    words: number;          // window size in words
    canonical: string;      // replacement text, canonical casing
}

// key: space-joined per-word skeletons → canonical term.
let glossaryIndex: Map<string, GlossaryEntry> | null = null;
let maxWindowWords = 1;

function buildIndex(): Map<string, GlossaryEntry> {
    if (glossaryIndex) return glossaryIndex;
    glossaryIndex = new Map();
    for (const term of DEFAULT_TECH_PHRASE_HINTS) {
        const words = term.split(/\s+/);
        const skels = words.map(phoneticSkeleton);
        if (skels.some(s => s.length < 2)) continue;      // "Big O", "C++" — unmatchable
        const joined = skels.join('');
        // Short single-word skeletons ("stk" for stack-like words) collide
        // with ordinary speech; require enough phonetic substance.
        if (words.length === 1 && joined.length < 4) continue;
        if (joined.length < 4) continue;
        glossaryIndex.set(skels.join(' '), { words: words.length, canonical: term });
        maxWindowWords = Math.max(maxWindowWords, words.length);
    }
    return glossaryIndex;
}

/**
 * Replace phonetically mangled Cyrillic runs with their canonical English
 * tech terms. Returns the input unchanged when nothing matches — call it on
 * FINAL transcript segments only (interims churn too fast to be worth it).
 */
export function fixMangledTechTerms(text: string): string {
    if (!text || !CYRILLIC_RE.test(text)) return text;
    const index = buildIndex();

    // Tokenize preserving separators so reconstruction keeps punctuation.
    const tokens = text.split(/(\s+)/);      // words at even indices, gaps at odd
    const words: { idx: number; core: string; lead: string; trail: string }[] = [];
    for (let i = 0; i < tokens.length; i += 2) {
        const raw = tokens[i];
        if (!raw) continue;
        // Strip leading/trailing punctuation but keep it for reconstruction.
        const m = raw.match(/^([^A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9]*)(.*?)([^A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9]*)$/);
        words.push({ idx: i, core: m ? m[2] : raw, lead: m ? m[1] : '', trail: m ? m[3] : '' });
    }

    let changed = false;
    for (let w = 0; w < words.length; w++) {
        if (!CYRILLIC_RE.test(words[w].core)) continue;
        // Longest window first so "стейтфул виджет" wins over any 1-word match.
        for (let span = Math.min(maxWindowWords, words.length - w); span >= 1; span--) {
            const window = words.slice(w, w + span);
            if (!window.every(t => t.core && CYRILLIC_RE.test(t.core))) continue;
            const key = window.map(t => phoneticSkeleton(t.core)).join(' ');
            const entry = index.get(key);
            if (!entry) continue;

            // Replace: canonical term takes the window's outer punctuation.
            tokens[window[0].idx] = window[0].lead + entry.canonical + window[span - 1].trail;
            for (let k = 1; k < span; k++) {
                tokens[window[k].idx] = '';
                tokens[window[k].idx - 1] = '';   // swallow the gap before removed word
            }
            changed = true;
            w += span - 1;
            break;
        }
    }

    return changed ? tokens.join('') : text;
}
