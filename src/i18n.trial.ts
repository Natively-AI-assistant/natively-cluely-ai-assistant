// src/i18n.trial.ts
//
// What the meeting overlay says about the free trial that starts by itself
// with a meeting (src/components/overlay/TrialNotice.tsx), and the two labels
// of the launcher's small trial card (src/components/trial/TrialMeterToaster.tsx). English source →
// [ru, zh, ja, es], one row per sentence, so a language can never miss a row
// the others have. Same shape as src/i18n.directAssist.ts.
//
// {minutes} is filled AFTER translation, so the number sits where the language
// puts it. "Natively" is never translated.
//
// The rows must match the strings those two components pass to t() exactly:
// src/lib/__tests__/trialNoticeI18n2026_10_09.test.mjs fails on a missing row,
// a leftover row, or a dropped placeholder.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  // ── It started ──
  'Free trial started: {minutes} minutes': [
    'Пробный период начался: {minutes} мин.',
    '免费试用已开始：{minutes} 分钟',
    '無料トライアルを開始しました：{minutes} 分',
    'Prueba gratuita iniciada: {minutes} minutos',
  ],
  "Audio and questions are processed on Natively's servers.": [
    'Аудио и вопросы обрабатываются на серверах Natively.',
    '音频和问题会在 Natively 的服务器上处理。',
    '音声と質問は Natively のサーバーで処理されます。',
    'El audio y las preguntas se procesan en los servidores de Natively.',
  ],
  'Use my own keys': [
    'Использовать свои ключи',
    '使用我自己的密钥',
    '自分のキーを使う',
    'Usar mis propias claves',
  ],

  // ── The countdown ──
  'Free trial': ['Пробный период', '免费试用', '無料トライアル', 'Prueba gratuita'],
  '{minutes} min left': ['осталось {minutes} мин', '剩余 {minutes} 分钟', '残り {minutes} 分', 'quedan {minutes} min'],

  // ── The launcher's small card: the two allowances beside the clock ──
  // (src/components/trial/TrialMeterToaster.tsx)
  'Voice': ['Голос', '语音', '音声', 'Voz'],
  'AI': ['ИИ', 'AI', 'AI', 'IA'],

  // ── Nearly over, and over ──
  'Free trial is almost over': [
    'Пробный период почти закончился',
    '免费试用即将结束',
    '無料トライアルはまもなく終了します',
    'La prueba gratuita está por terminar',
  ],
  'Free trial ended': [
    'Пробный период закончился',
    '免费试用已结束',
    '無料トライアルは終了しました',
    'La prueba gratuita terminó',
  ],
  'Pick a plan or add your own keys to keep getting answers.': [
    'Выберите тариф или добавьте свои ключи, чтобы и дальше получать ответы.',
    '选择套餐或添加你自己的密钥，以继续获得回答。',
    'プランを選ぶか自分のキーを追加すると、引き続き回答を受け取れます。',
    'Elige un plan o añade tus propias claves para seguir recibiendo respuestas.',
  ],
  'See plans': ['Посмотреть тарифы', '查看套餐', 'プランを見る', 'Ver planes'],

  // ── It could not start by itself ──
  'Free trial could not start': [
    'Не удалось начать пробный период',
    '无法开始免费试用',
    '無料トライアルを開始できませんでした',
    'No se pudo iniciar la prueba gratuita',
  ],
  'Natively could not be reached. Check your connection and try again.': [
    'Не удалось связаться с Natively. Проверьте подключение и попробуйте снова.',
    '无法连接到 Natively。请检查网络连接后重试。',
    'Natively に接続できませんでした。接続を確認して、もう一度お試しください。',
    'No se pudo conectar con Natively. Revisa tu conexión e inténtalo de nuevo.',
  ],
  'Too many attempts. Try again later.': [
    'Слишком много попыток. Попробуйте позже.',
    '尝试次数过多。请稍后再试。',
    '試行回数が多すぎます。しばらくしてからもう一度お試しください。',
    'Demasiados intentos. Inténtalo más tarde.',
  ],
  'Free trials are not available right now. Try again later.': [
    'Пробный период сейчас недоступен. Попробуйте позже.',
    '目前无法开始免费试用。请稍后再试。',
    '現在、無料トライアルはご利用いただけません。しばらくしてからもう一度お試しください。',
    'Las pruebas gratuitas no están disponibles en este momento. Inténtalo más tarde.',
  ],
  'Start free trial': ['Начать пробный период', '开始免费试用', '無料トライアルを開始', 'Iniciar prueba gratuita'],
  'Starting…': ['Запуск…', '正在开始…', '開始中…', 'Iniciando…'],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const TRIAL_NOTICE_EN = Object.freeze(Object.keys(ROWS));
export const TRIAL_NOTICE_RU = column(0);
export const TRIAL_NOTICE_ZH = column(1);
export const TRIAL_NOTICE_JA = column(2);
export const TRIAL_NOTICE_ES = column(3);
