// src/i18n.textSize.ts
//
// Settings › Overlay › Text size (TextSizeRow in
// src/components/settings/OverlaySettings.tsx, #673). English source → [ru,
// zh, ja, es], one row per string. Same shape as src/i18n.screenshotScreen.ts.
//
// The rows must match the strings the row passes to t() exactly:
// src/components/__tests__/InterviewTextSizeSetting2026_11_05.test.mjs fails
// on a missing row or a leftover row.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  'Text size': [
    'Размер текста',
    '文字大小',
    '文字サイズ',
    'Tamaño del texto',
  ],
  'Size of the questions and answers in the meeting overlay. The buttons and the input stay the same size.': [
    'Размер вопросов и ответов в оверлее встречи. Кнопки и поле ввода не меняют размер.',
    '会议浮窗中问题和回答的文字大小。按钮和输入框大小不变。',
    'ミーティングオーバーレイに表示される質問と回答の文字サイズです。ボタンと入力欄のサイズは変わりません。',
    'Tamaño de las preguntas y respuestas en el overlay de la reunión. Los botones y el campo de texto mantienen su tamaño.',
  ],
  'Smaller text': [
    'Уменьшить текст',
    '缩小文字',
    '文字を小さく',
    'Texto más pequeño',
  ],
  'Larger text': [
    'Увеличить текст',
    '放大文字',
    '文字を大きく',
    'Texto más grande',
  ],
  'Reset': [
    'Сбросить',
    '重置',
    'リセット',
    'Restablecer',
  ],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const TEXT_SIZE_EN = Object.freeze(Object.keys(ROWS));
export const TEXT_SIZE_RU = column(0);
export const TEXT_SIZE_ZH = column(1);
export const TEXT_SIZE_JA = column(2);
export const TEXT_SIZE_ES = column(3);
