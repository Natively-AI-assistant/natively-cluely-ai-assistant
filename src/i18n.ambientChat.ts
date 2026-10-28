// src/i18n.ambientChat.ts
//
// The banner shown from the start of a meeting that captures no audio because
// Ambient AI Chat is on (NativelyInterface.tsx, fold-ambient-mic). English
// source → [ru, zh, ja, es], one row per sentence, so a language can never miss
// a row the others have. Same shape as src/i18n.trial.ts.
//
// "Ambient AI Chat" is the setting's name as Settings › General shows it, and
// stays in English in every language, as it does there.
//
// The rows must match the strings the overlay passes to t() exactly:
// src/components/__tests__/AmbientChatNotListening2026_10_23.test.mjs fails on
// a missing row or a leftover row.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  'Ambient AI Chat is on, so this meeting is not being heard or transcribed.': [
    'Включён Ambient AI Chat, поэтому эта встреча не прослушивается и не расшифровывается.',
    '已开启 Ambient AI Chat，因此不会收听或转录本次会议。',
    'Ambient AI Chat がオンのため、この会議は聞き取られず、文字起こしもされません。',
    'Ambient AI Chat está activado, así que esta reunión no se escucha ni se transcribe.',
  ],
  // The banner's title and button; its message is the row above.
  'Mic is off': [
    'Микрофон выключен',
    '麦克风已关闭',
    'マイクはオフです',
    'El micrófono está apagado',
  ],
  'Turn on mic': [
    'Включить микрофон',
    '开启麦克风',
    'マイクをオンにする',
    'Activar micrófono',
  ],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const AMBIENT_CHAT_EN = Object.freeze(Object.keys(ROWS));
export const AMBIENT_CHAT_RU = column(0);
export const AMBIENT_CHAT_ZH = column(1);
export const AMBIENT_CHAT_JA = column(2);
export const AMBIENT_CHAT_ES = column(3);
