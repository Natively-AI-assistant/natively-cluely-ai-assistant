// src/i18n.answerLength.ts
//
// Settings › Overlay › Answer length (AnswerLengthRow and ANSWER_LENGTHS in
// src/components/settings/OverlaySettings.tsx). English source → [ru, zh, ja,
// es], one row per string. Same shape as src/i18n.screenshotQuestion.ts.
//
// The rows must match the strings the row passes to t() exactly, the option
// labels and descriptions included: src/components/__tests__/
// AnswerLengthSetting2026_11_15.test.mjs fails on a missing row or a leftover row.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  'Answer length': [
    'Длина ответа',
    '回答长度',
    '回答の長さ',
    'Longitud de la respuesta',
  ],
  'Shorter': [
    'Короче',
    '更短',
    '短め',
    'Más corta',
  ],
  'Smart': [
    'Умная',
    '智能',
    'スマート',
    'Inteligente',
  ],
  'Longer': [
    'Длиннее',
    '更长',
    '長め',
    'Más larga',
  ],
  '1–2 sentences, 15–35 words': [
    '1–2 предложения, 15–35 слов',
    '1–2 句，15–35 个词',
    '1〜2文、15〜35語',
    '1–2 frases, 15–35 palabras',
  ],
  'Fits each question, usually 40–60 words': [
    'Под каждый вопрос, обычно 40–60 слов',
    '按问题调整，通常 40–60 个词',
    '質問に合わせて調整、通常40〜60語',
    'Se ajusta a cada pregunta, normalmente 40–60 palabras',
  ],
  'Fuller answers, 90–200 words': [
    'Более полные ответы, 90–200 слов',
    '更完整的回答，90–200 个词',
    'より詳しい回答、90〜200語',
    'Respuestas más completas, 90–200 palabras',
  ],
  // "Real-time prompt" stays in English: the Modes editor's heading is not translated.
  "Your mode's Real-time prompt sets the length": [
    'Длину задаёт Real-time prompt вашего режима',
    '长度由当前模式的 Real-time prompt 决定',
    '長さはモードの Real-time prompt で設定されています',
    'La longitud la fija el Real-time prompt de tu modo',
  ],
  "Couldn't save the answer length. Please try again.": [
    'Не удалось сохранить длину ответа. Попробуйте ещё раз.',
    '无法保存回答长度，请重试。',
    '回答の長さを保存できませんでした。もう一度お試しください。',
    'No se pudo guardar la longitud de la respuesta. Inténtalo de nuevo.',
  ],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const ANSWER_LENGTH_EN = Object.freeze(Object.keys(ROWS));
export const ANSWER_LENGTH_RU = column(0);
export const ANSWER_LENGTH_ZH = column(1);
export const ANSWER_LENGTH_JA = column(2);
export const ANSWER_LENGTH_ES = column(3);
