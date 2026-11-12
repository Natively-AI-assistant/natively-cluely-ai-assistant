// src/i18n.keyResend.ts
//
// What "Bought a key but no email?" says under the activation card in Plans &
// Billing (src/components/settings/KeyResendHelp.tsx). English source →
// [ru, zh, ja, es], one row per sentence, so a language can never miss a row
// the others have. Same shape as src/i18n.trial.ts.
//
// "Natively" is never translated. "Spam" and "Promotions" are Gmail's folder
// and tab names; each language uses the name its Gmail shows.
//
// The rows must match the strings the component passes to t() exactly:
// src/lib/__tests__/keyResendI18n2026_11_12.test.mjs fails on a missing row or
// a leftover one.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  'Bought a key but no email? Check Spam and Promotions, or': [
    'Купили ключ, но письма нет? Проверьте «Спам» и «Промоакции» или',
    '买了密钥却没收到邮件？请查看“垃圾邮件”和“推广”，或',
    'キーを購入したのにメールが届かない場合は、「迷惑メール」と「プロモーション」を確認するか、',
    '¿Compraste una clave y no te llegó el correo? Revisa Spam y Promociones, o',
  ],
  'email it again': [
    'отправьте его ещё раз',
    '重新发送',
    'もう一度メールで送る',
    'envíala de nuevo',
  ],
  'Email you paid with': [
    'Email, с которого вы платили',
    '付款时使用的邮箱',
    '支払いに使ったメールアドレス',
    'Correo con el que pagaste',
  ],
  'Send': ['Отправить', '发送', '送信', 'Enviar'],
  'Sending…': ['Отправка…', '正在发送…', '送信中…', 'Enviando…'],
  "If that email has a Natively API key, it's on its way. Check Spam and Promotions too.": [
    'Если на этот email оформлен ключ Natively API, письмо уже в пути. Проверьте также «Спам» и «Промоакции».',
    '如果该邮箱有 Natively API 密钥，邮件已在路上。也请查看“垃圾邮件”和“推广”。',
    'このメールアドレスに Natively API キーがあれば、メールを送信しました。「迷惑メール」と「プロモーション」も確認してください。',
    'Si ese correo tiene una clave de Natively API, ya va en camino. Revisa también Spam y Promociones.',
  ],
  'Cancel': ['Отмена', '取消', 'キャンセル', 'Cancelar'],
  'Too many tries. Please try again in an hour.': [
    'Слишком много попыток. Попробуйте через час.',
    '尝试次数过多。请一小时后再试。',
    '試行回数が多すぎます。1 時間後にもう一度お試しください。',
    'Demasiados intentos. Vuelve a intentarlo en una hora.',
  ],
  "That doesn't look like an email address.": [
    'Это не похоже на адрес электронной почты.',
    '这看起来不像邮箱地址。',
    'メールアドレスの形式ではないようです。',
    'Eso no parece una dirección de correo.',
  ],
  "Couldn't reach Natively. Check your connection and try again.": [
    'Не удалось связаться с Natively. Проверьте подключение и попробуйте снова.',
    '无法连接到 Natively。请检查网络连接后重试。',
    'Natively に接続できませんでした。接続を確認して、もう一度お試しください。',
    'No se pudo conectar con Natively. Revisa tu conexión e inténtalo de nuevo.',
  ],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const KEY_RESEND_EN = Object.freeze(Object.keys(ROWS));
export const KEY_RESEND_RU = column(0);
export const KEY_RESEND_ZH = column(1);
export const KEY_RESEND_JA = column(2);
export const KEY_RESEND_ES = column(3);
