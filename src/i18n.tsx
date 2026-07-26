import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { RU_GENERATED } from './i18n.ru.generated';
import { RU_GENERATED2 } from './i18n.ru.generated2';
import { ZH_GENERATED } from './i18n.zh.generated';
import { JA_GENERATED } from './i18n.ja.generated';
import { ES_GENERATED } from './i18n.es.generated';

// ─── Lightweight in-house i18n ────────────────────────────────────────────────
// No external dependency. `t(englishText)` returns the translation for the
// active language (ru / zh / ja / es), falling back to the English source when
// a phrase isn't in the dictionary. `en` returns the English source unchanged.
// Keying the dictionary by the English source string keeps call sites readable
// (`{t('Start Natively')}`) and means untranslated phrases degrade gracefully to
// English instead of showing a raw key.
//
// Scope: key screens only (launcher home, settings menu, AI Providers, Audio,
// General). Abbreviations that read the same in every language — API, AI, STT,
// RAG, URL, JSON, etc. — are intentionally left untranslated.

export type Lang = 'en' | 'ru' | 'zh' | 'ja' | 'es';

const STORAGE_KEY = 'natively_lang';
const SUPPORTED_LANGS: Lang[] = ['en', 'ru', 'zh', 'ja', 'es'];

function isSupportedLang(v: string | null): v is Lang {
    return v !== null && (SUPPORTED_LANGS as string[]).includes(v);
}

// English source string → translation. Each dictionary is a record keyed by the
// English source. The per-language GENERATED file (parallel-agent output) is
// spread first; the hand-authored entries below override any key collision.
// Missing keys in any non-English language silently fall back to the English
// source so the UI stays readable while translations fill in.
const RU: Record<string, string> = {
    ...RU_GENERATED,
    ...RU_GENERATED2,
    // ── Settings sidebar / navigation ──
    'General': 'Основные',
    'AI Providers': 'AI-провайдеры',
    'Skills': 'Навыки',
    'Calendar': 'Календарь',
    'Audio': 'Звук',
    'Keybinds': 'Горячие клавиши',
    'Sync': 'Синхронизация',
    'Intelligence': 'Интеллект',
    'Setup & Help': 'Настройка и помощь',
    'About': 'О программе',
    'Quit Natively': 'Выйти из Natively',
    'Close': 'Закрыть',
    'Settings': 'Настройки',
    'Language': 'Язык',
    'English': 'Английский',
    'Russian': 'Русский',
    'Interface language for Natively': 'Язык интерфейса Natively',

    // ── Launcher (home) ──
    'My Natively': 'Мой Natively',
    'Start Natively': 'Запустить Natively',
    'Detectable': 'Виден при захвате экрана',
    'Undetectable': 'Скрыт от захвата',
    'Today': 'Сегодня',
    'Search or ask anything...': 'Найти или спросить что угодно...',
    'Upcoming features': 'Скоро в приложении',
    'Link your calendar to': 'Подключите календарь, чтобы',
    'see upcoming events': 'видеть предстоящие события',
    'Connect calendar': 'Подключить календарь',

    // ── AI Providers ──
    'Pick a default model and connect the cloud, local, or custom providers you want available.':
        'Выберите модель по умолчанию и подключите нужные облачные, локальные или свои провайдеры.',
    'Active Model': 'Активная модель',
    'Applies to new chats instantly.': 'Применяется к новым чатам сразу.',
    'Cloud Providers': 'Облачные провайдеры',
    'Add API keys to unlock cloud AI models.': 'Добавьте API-ключи, чтобы разблокировать облачные AI-модели.',
    'Save': 'Сохранить',
    'Test Connection': 'Проверить соединение',
    'Fetch Models': 'Загрузить модели',
    'Saved': 'Сохранено',
    'Select model': 'Выберите модель',
    'Select Provider': 'Выберите провайдера',
    'Custom Providers': 'Свои провайдеры',
    'Add Provider': 'Добавить провайдера',
    'API Key': 'API-ключ',
    'Get Key': 'Получить ключ',
    'Saving...': 'Сохранение...',
    'Saved!': 'Сохранено!',
    'Remove API Key': 'Удалить API-ключ',
    'Testing...': 'Проверка...',
    'Connected': 'Подключено',
    'Error': 'Ошибка',
    'Fetching...': 'Загрузка...',
    'Model fetch error:': 'Ошибка загрузки моделей:',
    'Fast Response Mode': 'Режим быстрого ответа',
    'Routes responses through the fastest available provider (Codex fast mode model, Groq, or Natively). Turn off to use your selected model above.':
        'Направляет ответы через самый быстрый доступный провайдер (быстрый режим Codex, Groq или Natively). Выключите, чтобы использовать выбранную выше модель.',
    'Requires Groq, Natively API, or Codex CLI to be configured.':
        'Требуется настроенный Groq, Natively API или Codex CLI.',
    'No models available': 'Нет доступных моделей',
    'Use your ChatGPT Plus/Pro subscription as an AI provider — no API key needed.':
        'Используйте подписку ChatGPT Plus/Pro как AI-провайдера — API-ключ не нужен.',
    'ChatGPT Account': 'Аккаунт ChatGPT',
    'Sign in with ChatGPT': 'Войти через ChatGPT',
    'Local Models (Ollama)': 'Локальные модели (Ollama)',
    'Run open-source models locally.': 'Запускайте модели с открытым кодом локально.',
    'Ollama not detected': 'Ollama не обнаружен',
    'Add your own AI endpoints via cURL.': 'Добавьте свои AI-эндпоинты через cURL.',
    'No custom providers added yet.': 'Свои провайдеры пока не добавлены.',
    'Screen understanding': 'Понимание экрана',
    'Pick how Natively reads what is on your screen. All paths use the vision-capable AI provider directly; OCR is no longer used.':
        'Выберите, как Natively читает содержимое экрана. Все режимы используют vision-модель напрямую; OCR больше не используется.',
    'Vision first': 'Сначала vision',
    'Vision only': 'Только vision',
    'Private vision (local only)': 'Приватный vision (только локально)',
    'Technical interview direct vision': 'Прямой vision для тех. интервью',
    'Cloud provider data scopes': 'Область данных облачных провайдеров',
    'Control what data cloud AI providers can access. Disabled types are handled locally for privacy.':
        'Управляйте доступом облачных провайдеров к данным. Отключённые типы обрабатываются локально ради приватности.',

    // ── Sync (Phone Mirror) ──
    'Enable Phone Mirror': 'Включить зеркалирование телефона',
    'Browser Extension': 'Расширение браузера',
    'Phone Mirror runs on your local network. No traffic leaves this machine.':
        'Зеркалирование телефона работает в локальной сети. Трафик не покидает этот компьютер.',

    // ── Meeting interface (overlay) ──
    'Listening...': 'Слушаю...',
    'Ask anything on screen or conversation, or': 'Спросите что угодно об экране или разговоре, или',
    'for selective screenshot': 'для выборочного скриншота',
    'Screenshot attached': 'Скриншот прикреплён',

    // ── Intelligence ──
    'Long-term memory': 'Долговременная память',
    'Smart features': 'Умные функции',
    'Try it': 'Попробовать',

    // ── Meeting details (notes) ──
    'Summary': 'Резюме',
    'What changed': 'Что изменилось',
    'Decisions': 'Решения',
    'Action Items': 'Задачи',
    'Open Questions': 'Открытые вопросы',
    'Transcript': 'Транскрипт',
    'Risks / Blockers': 'Риски / Блокеры',
    'Follow-up draft': 'Черновик письма',
    'Follow-up Draft': 'Черновик письма',
    'Next Steps': 'Следующие шаги',
    'Coaching': 'Коучинг',
    'Connecting...': 'Подключение...',

    // ── Other settings tabs ──
    'Process Disguise': 'Маскировка процесса',
    'Keyboard shortcuts': 'Горячие клавиши',
    'Visible Calendars': 'Видимые календари',
    'No calendars': 'Нет календарей',
    'Theme': 'Тема',
    'Meeting Interface Style': 'Стиль интерфейса встречи',
    'Disguise Natively as another application to prevent detection during screen sharing.':
        'Маскирует Natively под другое приложение, чтобы избежать обнаружения при демонстрации экрана.',

    // ── About ──
    'About Natively': 'О программе Natively',
    'Designed to be invisible, intelligent, and trusted.': 'Создано быть незаметным, умным и надёжным.',
    "What's New in v2.8": 'Что нового в v2.8',
    'How Natively Works': 'Как работает Natively',
    'Privacy & Data': 'Приватность и данные',
    'Stealth & Control': 'Скрытность и контроль',
    'No Recording': 'Без записи',
    'Community': 'Сообщество',
    'Core Technology': 'Основные технологии',
    'Official Website': 'Официальный сайт',
    'Visit Website': 'Открыть сайт',
    'Telegram Community': 'Сообщество в Telegram',
    'Join Chat': 'Войти в чат',
    'LinkedIn Company Page': 'Страница компании в LinkedIn',
    'Follow Page': 'Подписаться',
    'Creator': 'Автор',
    'Star on GitHub': 'Звезда на GitHub',
    'Love Natively? Support us by starring the repo.': 'Нравится Natively? Поддержите нас звездой репозиторию.',
    'Report an Issue': 'Сообщить о проблеме',
    'Found a bug? Let us know so we can fix it.': 'Нашли баг? Сообщите нам, и мы исправим.',
    'Get in Touch': 'Связаться',
    'Open for professional collaborations and job offers.': 'Открыт для сотрудничества и предложений о работе.',
    'Contact Me': 'Написать мне',
    'Support Development': 'Поддержать разработку',
    'Natively is independent source-available software.': 'Natively — независимое ПО с открытым исходным кодом.',
    'Support Project': 'Поддержать проект',
    'Enter your license key': 'Введите лицензионный ключ',
    'Help & Setup Guide': 'Помощь и настройка',
    'Help Guide': 'Руководство',
    'Want to skip the manual setup?': 'Хотите пропустить ручную настройку?',
    'Hardware & Engine Configurations': 'Оборудование и настройки движка',
    'API Keys & Testing': 'API-ключи и проверка',
    'Specific Provider Setup': 'Настройка конкретных провайдеров',
    'Quick Actions & Hotkeys': 'Быстрые действия и горячие клавиши',
    'Global System Shortcuts': 'Глобальные системные сочетания',
    'Microphone': 'Микрофон',
    'Microphone & Speaker Loopback Selection': 'Выбор микрофона и захвата звука динамиков',
    'Language & Regional Accents': 'Язык и региональные акценты',
    'Settings > Privacy > Microphone': 'Параметры > Конфиденциальность > Микрофон',
    'Natively can capture both what you say and what you hear globally. At the top of the Audio Settings, use the Dropdowns to explicitly select your hardware Input (e.g. your physical microphone) and Output capture (what the speakers play). By default, Natively uses the System Default, so audio routing automatically follows your OS preferences.':
        'Natively может захватывать и то, что вы говорите, и то, что вы слышите. В верхней части настроек звука в выпадающих списках явно выберите аппаратный вход (например, ваш микрофон) и захват вывода (то, что играют динамики). По умолчанию используется «Системный по умолчанию», поэтому маршрутизация звука следует настройкам ОС.',
    "The recommended backend for macOS 13.0+. Uses Apple's modern, highly optimized internal framework for 0-latency loopback speaker capture securely.":
        'Рекомендуемый бэкенд для macOS 13.0+. Использует современный оптимизированный фреймворк Apple для безопасного захвата звука динамиков с нулевой задержкой.',
    'Fallback engine for older hardware. Relies on internal device aggregation to trap output audio. Only use this if SCK repeatedly drops speaker packets.':
        'Запасной движок для старого оборудования. Использует агрегацию устройств для перехвата вывода. Используйте только если SCK постоянно теряет пакеты звука.',
    'Below the provider list, specify the Language you will be speaking (e.g., English). Most importantly, select your specific regional Accent / Region mapping (e.g., en-US vs en-GB vs en-IN) — STT backends use this to greatly improve transcription accuracy based on regional inflections.':
        'Под списком провайдеров укажите язык, на котором будете говорить (например, русский). Важнее всего — выберите конкретный регион/акцент (напр. en-US, en-GB, en-IN): STT-движки используют это, чтобы заметно повысить точность распознавания с учётом региональных особенностей речи.',
    'Required to capture what you say during meetings. Windows prompts the first time you start a meeting.':
        'Нужно для захвата вашей речи во время встреч. Windows запросит доступ при первом запуске встречи.',
    'Natively supports over 8 different Audio engines to transcribe what you hear and say. From the Audio tab in settings, use the overarching dropdown to switch the active engine.':
        'Natively поддерживает более 8 движков распознавания того, что вы слышите и говорите. На вкладке «Звук» переключайте активный движок через основной выпадающий список.',
    'We strongly recommend testing connections before jumping into a live meeting. The system shows successful pings or explicit errors if credits/permissions fail.':
        'Настоятельно рекомендуем проверить соединение перед реальной встречей. Система покажет успешный отклик или явную ошибку, если не хватает кредитов/прав.',

    // ── Audio ──
    'Speech Provider': 'Провайдер распознавания речи',
    'Choose the engine that transcribes audio to text.': 'Выберите движок, который переводит речь в текст.',
    'Privacy-first: runs 100% on your device': 'Приватно: работает на 100% на вашем устройстве',
    'Local Engine Configuration': 'Настройка локального движка',
    'Select the AI models you want to use for Speech-to-Text inference.':
        'Выберите AI-модели для распознавания речи (Speech-to-Text).',
    'Split Audio Channels': 'Разделять аудиоканалы',
    'Use different models for microphone and system audio':
        'Использовать разные модели для микрофона и системного звука',
    'Model Manager': 'Менеджер моделей',
    'Install': 'Установить',
    'Audio Configuration': 'Настройка звука',
    'Manage input and output devices.': 'Управление устройствами ввода и вывода.',
    'Select the primary language being spoken in the meeting.':
        'Выберите основной язык, на котором говорят на встрече.',
    'Test Sound': 'Проверить звук',

    // ── General settings ──
    'General settings': 'Основные настройки',
    'Customize how Natively works for you': 'Настройте Natively под себя',
    'Natively is currently detectable by screen-sharing.': 'Сейчас Natively виден при демонстрации экрана.',
    'Mouse Passthrough': 'Сквозные клики мыши',
    'Overlay stays visible but lets all mouse clicks pass through to the app beneath.':
        'Оверлей остаётся видимым, но все клики мыши проходят сквозь него в приложение под ним.',
    'Open Natively when you log in': 'Открывать Natively при входе в систему',
    'Natively will open automatically when you log in to your computer.':
        'Natively будет открываться автоматически при входе в систему.',
    'Natively will open automatically when you log in to your computer':
        'Natively будет открываться автоматически при входе в систему',
    'When enabled, live assistance works but transcripts, summaries, and history are discarded when the meeting ends':
        'Когда включено, живая помощь работает, но транскрипты, резюме и история удаляются по завершении встречи',
    'Do not save meetings': 'Не сохранять встречи',
    'Verbose debug logging': 'Подробное журналирование',
    'Print detailed audio, STT, and pipeline diagnostics': 'Выводить подробную диагностику звука, STT и пайплайна',
    'Interviewer Transcript': 'Транскрипт интервьюера',
    'Show real-time transcription of the interviewer': 'Показывать транскрипцию интервьюера в реальном времени',
    'Auto Scroll': 'Автопрокрутка',
    'Automatically scroll to the latest message as new responses arrive':
        'Автоматически прокручивать к последнему сообщению при новых ответах',
};

// Chinese — ZH_GENERATED spread first, then hand-authored overrides on any collision.
const ZH: Record<string, string> = {
    ...ZH_GENERATED,
    'Language': '语言',
    'English': '英语',
    'Russian': '俄语',
    'Chinese': '中文',
    'Japanese': '日语',
    'Spanish': '西班牙语',
    'Interface language for Natively': 'Natively 界面语言',
    'Settings': '设置',
    'General': '通用',
    'Close': '关闭',
};

// Japanese — JA_GENERATED (parallel-agent output) spread first, then hand-authored
// overrides win on any key collision.
const JA: Record<string, string> = {
    ...JA_GENERATED,
    'Language': '言語',
    'English': '英語',
    'Russian': 'ロシア語',
    'Chinese': '中国語',
    'Japanese': '日本語',
    'Spanish': 'スペイン語',
    'Interface language for Natively': 'Natively のインターフェース言語',
    'Settings': '設定',
    'General': '一般',
    'Close': '閉じる',
};

// Spanish — ES_GENERATED spread first, then hand-authored overrides on any collision.
const ES: Record<string, string> = {
    ...ES_GENERATED,
    'Language': 'Idioma',
    'English': 'Inglés',
    'Russian': 'Ruso',
    'Chinese': 'Chino',
    'Japanese': 'Japonés',
    'Spanish': 'Español',
    'Interface language for Natively': 'Idioma de la interfaz de Natively',
    'Settings': 'Ajustes',
    'General': 'General',
    'Close': 'Cerrar',
};

// Per-language dictionary lookup. `en` always returns the source string (no
// dictionary needed). Missing keys in any other language fall through to the
// English source so the UI stays readable while translations are in progress.
const DICT: Record<Exclude<Lang, 'en'>, Record<string, string>> = {
    ru: RU,
    zh: ZH,
    ja: JA,
    es: ES,
};

interface LanguageContextValue {
    lang: Lang;
    setLang: (l: Lang) => void;
    t: (text: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
    lang: 'en',
    setLang: () => {},
    t: (text: string) => text,
});

function readStoredLang(): Lang {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return isSupportedLang(v) ? v : 'en';
    } catch {
        return 'en';
    }
}

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [lang, setLangState] = useState<Lang>(readStoredLang);

    const setLang = useCallback((l: Lang) => {
        setLangState(l);
        try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
    }, []);

    // Keep other windows (settings-popup, overlay) in sync — the `storage` event
    // fires in every OTHER same-partition renderer when one of them writes.
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY && isSupportedLang(e.newValue)) {
                setLangState(e.newValue);
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const t = useCallback(
        (text: string) => (lang === 'en' ? text : (DICT[lang][text] ?? text)),
        [lang],
    );

    return (
        <LanguageContext.Provider value={{ lang, setLang, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

export function useLanguage(): LanguageContextValue {
    return useContext(LanguageContext);
}

// Convenience hook: `const t = useT();` then `t('Save')`.
export function useT(): (text: string) => string {
    return useContext(LanguageContext).t;
}
