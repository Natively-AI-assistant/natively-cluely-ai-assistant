// src/i18n.assist.ts
//
// The assist features (2026-10-15): the overlay's live helpers and the
// calendar reminder's Running late draft in the launcher
// (src/components/assist/AssistToday.tsx). Coming up today, Catch up and
// Yours to do were taken out of the launcher on 2026-11-01. English source →
// [ru, zh, ja, es], one row per sentence, the same shape as src/i18n.trial.ts.
//
// The rows must match the strings those components pass to t() exactly:
// src/lib/__tests__/AssistI18n2026_10_15.test.mjs fails on a missing row.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  // ── Overlay: live helpers ──
  'What did I miss?': ['Что я пропустил?', '我错过了什么？', '何を聞き逃した？', '¿Qué me perdí?'],
  'Define': ['Объяснить', '解释', '意味', 'Definir'],
  'Sound smart': ['Умная мысль', '说点有见地的', '鋭い一言', 'Aporta algo'],

  // ── Launcher: the calendar reminder's Running late draft ──
  'To': ['Кому', '收件人', '宛先', 'Para'],
  'min': ['мин', '分钟', '分', 'min'],
  'Open in mail app': ['Открыть в почте', '在邮件应用中打开', 'メールアプリで開く', 'Abrir en la app de correo'],
  'Open in Gmail': ['Открыть в Gmail', '在 Gmail 中打开', 'Gmail で開く', 'Abrir en Gmail'],
  'Copied. Paste it into your email or chat.': ['Скопировано. Вставьте в письмо или чат.', '已复制。粘贴到邮件或聊天中即可。', 'コピーしました。メールやチャットに貼り付けてください。', 'Copiado. Pégalo en tu correo o chat.'],
  'Could not copy. Select the text and copy it instead.': ['Не удалось скопировать. Выделите текст и скопируйте вручную.', '无法复制。请选中文本后手动复制。', 'コピーできませんでした。テキストを選択してコピーしてください。', 'No se pudo copiar. Selecciona el texto y cópialo.'],
  'No mail app opened. The draft is on your clipboard instead.': ['Почтовое приложение не открылось. Черновик скопирован.', '没有打开邮件应用。草稿已复制到剪贴板。', 'メールアプリが開きませんでした。下書きはクリップボードにあります。', 'No se abrió ninguna app de correo. El borrador está en tu portapapeles.'],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const ASSIST_EN = Object.freeze(Object.keys(ROWS));
export const ASSIST_RU = column(0);
export const ASSIST_ZH = column(1);
export const ASSIST_JA = column(2);
export const ASSIST_ES = column(3);
