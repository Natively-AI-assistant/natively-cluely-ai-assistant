
export type LanguageOption = {
    label: string;
    code: string; // Internal key (e.g. 'russian')
    bcp47: string; // For Google, Azure (e.g. 'ru-RU')
    iso639: string; // For OpenAI, Groq (e.g. 'ru')
    group: string; // For UI grouping
    alternates?: string[];
};

export type EnglishVariant = LanguageOption & {
    primary: string;
    alternates: string[];
};

export const ENGLISH_VARIANTS: Record<string, EnglishVariant> = {
    'english-us': {
        label: 'United States',
        code: 'english-us',
        bcp47: 'en-US',
        iso639: 'en',
        group: 'English',
        primary: 'en-US',
        alternates: ['en-GB', 'en-IN', 'en-AU', 'en-CA'],
    },
    'english-uk': {
        label: 'United Kingdom',
        code: 'english-uk',
        bcp47: 'en-GB',
        iso639: 'en',
        group: 'English',
        primary: 'en-GB',
        alternates: ['en-US', 'en-IN', 'en-AU', 'en-CA'],
    },
    'english-in': {
        label: 'India',
        code: 'english-in',
        bcp47: 'en-IN',
        iso639: 'en',
        group: 'English',
        primary: 'en-IN',
        alternates: ['en-US', 'en-GB', 'en-AU', 'en-CA'],
    },
    'english-au': {
        label: 'Australia',
        code: 'english-au',
        bcp47: 'en-AU',
        iso639: 'en',
        group: 'English',
        primary: 'en-AU',
        alternates: ['en-US', 'en-GB', 'en-IN', 'en-CA'],
    },
    'english-ca': {
        label: 'Canada',
        code: 'english-ca',
        bcp47: 'en-CA',
        iso639: 'en',
        group: 'English',
        primary: 'en-CA',
        alternates: ['en-US', 'en-GB', 'en-IN', 'en-AU'],
    },
};

export const AUTO_DETECT_ALTERNATES = [
    'en-US',
    'en-GB',
    'en-IN',
    'en-AU',
    'en-CA',
    'id-ID',
    'ru-RU',
    'es-ES',
    'fr-FR',
    'de-DE',
    'it-IT',
    'pt-PT',
    'ja-JP',
    'ko-KR',
    'zh-CN',
    'tr-TR',
    'uk-UA',
    'ro-RO',
    'pl-PL',
    'nl-NL',
    'ar-SA',
    'hi-IN',
    'sv-SE',
    'nb-NO',
    'da-DK',
    'cs-CZ',
    'hu-HU',
    'vi-VN',
    'th-TH',
    'el-GR',
    'bg-BG',
    'he-IL',
    'ms-MY',
    'fi-FI',
    'hr-HR',
    'et-EE',
    'lv-LV',
    'lt-LT',
    'mt-MT',
    'sk-SK',
    'sl-SI',
];

export const RECOGNITION_LANGUAGES: Record<string, LanguageOption> = {
    'auto': { label: 'Auto Detect', code: 'auto', bcp47: 'auto', iso639: 'auto', group: 'Auto', alternates: AUTO_DETECT_ALTERNATES },
    ...ENGLISH_VARIANTS,
    'indonesian': { label: 'Indonesian', code: 'indonesian', bcp47: 'id-ID', iso639: 'id', group: 'Indonesian' },
    'russian': { label: 'Russian', code: 'russian', bcp47: 'ru-RU', iso639: 'ru', group: 'Russian' },
    'spanish': { label: 'Spanish', code: 'spanish', bcp47: 'es-ES', iso639: 'es', group: 'Spanish' },
    'french': { label: 'French', code: 'french', bcp47: 'fr-FR', iso639: 'fr', group: 'French' },
    'german': { label: 'German', code: 'german', bcp47: 'de-DE', iso639: 'de', group: 'German' },
    'italian': { label: 'Italian', code: 'italian', bcp47: 'it-IT', iso639: 'it', group: 'Italian' },
    'portuguese': { label: 'Portuguese', code: 'portuguese', bcp47: 'pt-PT', iso639: 'pt', group: 'Portuguese' },
    'japanese': { label: 'Japanese', code: 'japanese', bcp47: 'ja-JP', iso639: 'ja', group: 'Japanese' },
    'korean': { label: 'Korean', code: 'korean', bcp47: 'ko-KR', iso639: 'ko', group: 'Korean' },
    'chinese': { label: 'Chinese (Simplified)', code: 'chinese', bcp47: 'zh-CN', iso639: 'zh', group: 'Chinese' },
    'turkish': { label: 'Turkish', code: 'turkish', bcp47: 'tr-TR', iso639: 'tr', group: 'Turkish' },
    'ukrainian': { label: 'Ukrainian', code: 'ukrainian', bcp47: 'uk-UA', iso639: 'uk', group: 'Ukrainian' },
    'romanian': { label: 'Romanian', code: 'romanian', bcp47: 'ro-RO', iso639: 'ro', group: 'Romanian' },
    'polish': { label: 'Polish', code: 'polish', bcp47: 'pl-PL', iso639: 'pl', group: 'Polish' },
    'dutch': { label: 'Dutch', code: 'dutch', bcp47: 'nl-NL', iso639: 'nl', group: 'Dutch' },
    'arabic': { label: 'Arabic', code: 'arabic', bcp47: 'ar-SA', iso639: 'ar', group: 'Arabic' },
    'hindi': { label: 'Hindi', code: 'hindi', bcp47: 'hi-IN', iso639: 'hi', group: 'Hindi' },
    'swedish': { label: 'Swedish', code: 'swedish', bcp47: 'sv-SE', iso639: 'sv', group: 'Swedish' },
    'norwegian': { label: 'Norwegian', code: 'norwegian', bcp47: 'nb-NO', iso639: 'no', group: 'Norwegian' },
    'danish': { label: 'Danish', code: 'danish', bcp47: 'da-DK', iso639: 'da', group: 'Danish' },
    'czech': { label: 'Czech', code: 'czech', bcp47: 'cs-CZ', iso639: 'cs', group: 'Czech' },
    'hungarian': { label: 'Hungarian', code: 'hungarian', bcp47: 'hu-HU', iso639: 'hu', group: 'Hungarian' },
    'vietnamese': { label: 'Vietnamese', code: 'vietnamese', bcp47: 'vi-VN', iso639: 'vi', group: 'Vietnamese' },
    'thai': { label: 'Thai', code: 'thai', bcp47: 'th-TH', iso639: 'th', group: 'Thai' },
    'greek': { label: 'Greek', code: 'greek', bcp47: 'el-GR', iso639: 'el', group: 'Greek' },
    'bulgarian': { label: 'Bulgarian', code: 'bulgarian', bcp47: 'bg-BG', iso639: 'bg', group: 'Bulgarian' },
    'hebrew': { label: 'Hebrew', code: 'hebrew', bcp47: 'he-IL', iso639: 'he', group: 'Hebrew' },
    'malay': { label: 'Malay', code: 'malay', bcp47: 'ms-MY', iso639: 'ms', group: 'Malay' },
    'finnish': { label: 'Finnish', code: 'finnish', bcp47: 'fi-FI', iso639: 'fi', group: 'Finnish' },
    'croatian': { label: 'Croatian', code: 'croatian', bcp47: 'hr-HR', iso639: 'hr', group: 'Croatian' },
    'estonian': { label: 'Estonian', code: 'estonian', bcp47: 'et-EE', iso639: 'et', group: 'Estonian' },
    'latvian': { label: 'Latvian', code: 'latvian', bcp47: 'lv-LV', iso639: 'lv', group: 'Latvian' },
    'lithuanian': { label: 'Lithuanian', code: 'lithuanian', bcp47: 'lt-LT', iso639: 'lt', group: 'Lithuanian' },
    'maltese': { label: 'Maltese', code: 'maltese', bcp47: 'mt-MT', iso639: 'mt', group: 'Maltese' },
    'slovak': { label: 'Slovak', code: 'slovak', bcp47: 'sk-SK', iso639: 'sk', group: 'Slovak' },
    'slovenian': { label: 'Slovenian', code: 'slovenian', bcp47: 'sl-SI', iso639: 'sl', group: 'Slovenian' },
};

export const AI_RESPONSE_LANGUAGES = [
    { label: 'Auto (Detect)', code: 'auto' },
    { label: 'English', code: 'English' },
    { label: 'Indonesian', code: 'Indonesian' },
    { label: 'Russian', code: 'Russian' },
    { label: 'Spanish', code: 'Spanish' },
    { label: 'French', code: 'French' },
    { label: 'German', code: 'German' },
    { label: 'Italian', code: 'Italian' },
    { label: 'Portuguese', code: 'Portuguese' },
    { label: 'Japanese', code: 'Japanese' },
    { label: 'Korean', code: 'Korean' },
    { label: 'Chinese', code: 'Chinese' },
    { label: 'Turkish', code: 'Turkish' },
    { label: 'Ukrainian', code: 'Ukrainian' },
    { label: 'Romanian', code: 'Romanian' },
    { label: 'Polish', code: 'Polish' },
    { label: 'Dutch', code: 'Dutch' },
    { label: 'Arabic', code: 'Arabic' },
    { label: 'Hindi', code: 'Hindi' },
    { label: 'Swedish', code: 'Swedish' },
    { label: 'Norwegian', code: 'Norwegian' },
    { label: 'Danish', code: 'Danish' },
    { label: 'Czech', code: 'Czech' },
    { label: 'Hungarian', code: 'Hungarian' },
    { label: 'Vietnamese', code: 'Vietnamese' },
    { label: 'Thai', code: 'Thai' },
    { label: 'Greek', code: 'Greek' },
    { label: 'Bulgarian', code: 'Bulgarian' },
    { label: 'Hebrew', code: 'Hebrew' },
    { label: 'Malay', code: 'Malay' },
    { label: 'Finnish', code: 'Finnish' },
    { label: 'Croatian', code: 'Croatian' },
    { label: 'Estonian', code: 'Estonian' },
    { label: 'Latvian', code: 'Latvian' },
    { label: 'Lithuanian', code: 'Lithuanian' },
    { label: 'Maltese', code: 'Maltese' },
    { label: 'Slovak', code: 'Slovak' },
    { label: 'Slovenian', code: 'Slovenian' },
];

/**
 * Map a persisted STT language to a key RECOGNITION_LANGUAGES actually has.
 *
 * Every language has a plain key — 'spanish', 'french' — except English, which
 * exists only as english-us/uk/in/au/ca. Installs predating that split still
 * have a bare 'english' persisted, which resolves to nothing, and BOTH readers
 * of this value are downstream of here: main.ts feeds it to the provider and
 * ipcHandlers hands it to Settings. Normalising once, at the single source,
 * keeps the two from disagreeing — Settings was telling users
 * `"english" isn't available in Apple Speech` while the provider was happily
 * transcribing en-US.
 *
 * It also un-breaks the other providers, which were silently no-oping on
 * 'english': GoogleSTT warns and returns on an unknown key, Deepgram's
 * `if (config && …)` skips it. They looked correct only because their own
 * default is English.
 *
 * An unrecognised key is returned unchanged rather than forced to 'auto', so
 * this can only ever resolve a value, never silently switch someone's language.
 */
export function normalizeSttLanguageKey(stored: string | undefined | null): string {
    const key = (stored ?? '').trim();
    if (!key) return 'auto';
    if (RECOGNITION_LANGUAGES[key]) return key;
    // Group name ('english' -> the English family). Prefer the entry whose
    // bcp47 matches its own declared `primary`, which is the family's default.
    const lower = key.toLowerCase();
    const family = Object.entries(RECOGNITION_LANGUAGES)
        .filter(([, l]) => String((l as any)?.group ?? '').toLowerCase() === lower);
    if (family.length) {
        const primary = family.find(([, l]) => (l as any)?.primary === (l as any)?.bcp47);
        return (primary ?? family[0])[0];
    }
    return key;
}
