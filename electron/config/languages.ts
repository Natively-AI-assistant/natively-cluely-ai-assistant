
export type LanguageOption = {
    label: string;
    code: string; // Internal key (e.g. 'russian')
    bcp47: string; // For Google, Azure (e.g. 'ru-RU')
    iso639: string; // For OpenAI, Groq (e.g. 'ru')
    group: string; // For UI grouping
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

export const RECOGNITION_LANGUAGES: Record<string, LanguageOption> = {
    'auto': { label: 'Auto Detect', code: 'auto', bcp47: 'auto', iso639: 'auto', group: 'Auto' },
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
];
