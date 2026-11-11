// src/i18n.screenshotQuestion.ts
//
// Settings › Overlay › Screenshot question (ScreenshotQuestionRow in
// src/components/settings/OverlaySettings.tsx). English source → [ru, zh, ja,
// es], one row per string. Same shape as src/i18n.screenshotScreen.ts.
// 'Reset' is already in the generated tables.
//
// The rows must match the strings the row passes to t() exactly:
// src/lib/__tests__/screenshotPrompt.test.mjs fails on a missing row or a
// leftover row.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  'Screenshot question': [
    'Вопрос к снимку экрана',
    '截图问题',
    'スクリーンショットの質問',
    'Pregunta de la captura',
  ],
  "Sent with a screenshot when you don't type a question.": [
    'Отправляется со снимком экрана, если вы не ввели вопрос.',
    '发送截图却没有输入问题时，随截图一起发送。',
    '質問を入力せずにスクリーンショットを送ると、一緒に送られます。',
    'Se envía con una captura cuando no escribes una pregunta.',
  ],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const SCREENSHOT_QUESTION_EN = Object.freeze(Object.keys(ROWS));
export const SCREENSHOT_QUESTION_RU = column(0);
export const SCREENSHOT_QUESTION_ZH = column(1);
export const SCREENSHOT_QUESTION_JA = column(2);
export const SCREENSHOT_QUESTION_ES = column(3);
