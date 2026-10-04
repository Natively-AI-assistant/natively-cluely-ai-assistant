// src/i18n.directAssist.ts
//
// What the overlay says when a provider fails on the direct-ask path
// (src/lib/directAssistFailure.mjs, drawn by DirectAssistNotice). English
// source → [ru, zh, ja, es], one row per sentence, so a language can never
// miss a row the others have. Same shape as src/i18n.onboarding.ts.
//
// Placeholders — {provider}, {seconds} — are filled AFTER translation, so the
// name sits where the language puts it (ja and zh move it; "couldn't be
// reached" moves it in ru and es too). Provider names and the provider's own
// words are never translated.
//
// "AI Providers" is the Settings tab, named as each language's dictionary
// already names it (es keeps the English name).
//
// The rows must match DIRECT_ASSIST_PHRASES + DIRECT_ASSIST_OPEN_PROVIDERS
// exactly: src/lib/__tests__/directAssistI18n2026_10_01.test.mjs fails on a
// missing row, a leftover row, or a dropped placeholder.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  // ── Why one provider failed ──
  '{provider} rejected your key or sign-in': [
    '{provider} отклонил ваш ключ или вход',
    '{provider} 拒绝了你的密钥或登录',
    '{provider} がキーまたはサインインを拒否しました',
    '{provider} rechazó tu clave o tu inicio de sesión',
  ],
  '{provider} is out of credits': [
    'У {provider} закончились кредиты',
    '{provider} 的额度已用完',
    '{provider} のクレジットが不足しています',
    '{provider} se quedó sin créditos',
  ],
  "{provider} doesn't have this model": [
    'У {provider} нет этой модели',
    '{provider} 没有这个模型',
    '{provider} ではこのモデルを利用できません',
    '{provider} no tiene este modelo',
  ],
  "{provider} isn't set up": [
    '{provider} не настроен',
    '{provider} 尚未设置',
    '{provider} が設定されていません',
    '{provider} no está configurado',
  ],
  '{provider} is rate limiting requests': [
    '{provider} ограничивает частоту запросов',
    '{provider} 正在限制请求频率',
    '{provider} がリクエストを制限しています',
    '{provider} está limitando las solicitudes',
  ],
  '{provider} stopped responding': [
    '{provider} перестал отвечать',
    '{provider} 停止了响应',
    '{provider} が応答しなくなりました',
    '{provider} dejó de responder',
  ],
  "{provider} didn't respond in time": [
    '{provider} не ответил вовремя',
    '{provider} 未及时响应',
    '{provider} が時間内に応答しませんでした',
    '{provider} no respondió a tiempo',
  ],
  "{provider} didn't respond in {seconds} s": [
    '{provider} не ответил за {seconds} с',
    '{provider} 在 {seconds} 秒内未响应',
    '{provider} が {seconds} 秒以内に応答しませんでした',
    '{provider} no respondió en {seconds} s',
  ],
  '{provider} returned an empty answer': [
    '{provider} вернул пустой ответ',
    '{provider} 返回了空回答',
    '{provider} から空の回答が返されました',
    '{provider} devolvió una respuesta vacía',
  ],
  '{provider} stopped before finishing': [
    '{provider} остановился, не закончив',
    '{provider} 未完成就停止了',
    '{provider} が途中で停止しました',
    '{provider} se detuvo antes de terminar',
  ],
  "{provider} couldn't be reached": [
    'Не удалось связаться с {provider}',
    '无法连接到 {provider}',
    '{provider} に接続できませんでした',
    'No se pudo conectar con {provider}',
  ],
  '{provider} rejected the request as too large': [
    '{provider} отклонил запрос: он слишком большой',
    '{provider} 因请求过大而拒绝',
    '{provider} がリクエストを大きすぎるとして拒否しました',
    '{provider} rechazó la solicitud por ser demasiado grande',
  ],
  '{provider} rejected the request': [
    '{provider} отклонил запрос',
    '{provider} 拒绝了请求',
    '{provider} がリクエストを拒否しました',
    '{provider} rechazó la solicitud',
  ],
  '{provider} is overloaded': [
    '{provider} перегружен',
    '{provider} 负载过高',
    '{provider} が混雑しています',
    '{provider} está sobrecargado',
  ],
  '{provider} had a server error': [
    'У {provider} произошла ошибка сервера',
    '{provider} 服务器出错',
    '{provider} でサーバーエラーが発生しました',
    '{provider} tuvo un error de servidor',
  ],
  '{provider} failed': [
    'У {provider} произошёл сбой',
    '{provider} 出错了',
    '{provider} でエラーが発生しました',
    '{provider} falló',
  ],

  // ── What happened to the answer ──
  'Answered by {provider}': [
    'Ответил {provider}',
    '由 {provider} 回答',
    '{provider} が回答しました',
    'Respondió {provider}',
  ],
  'Trying {provider}…': [
    'Пробуем {provider}…',
    '正在尝试 {provider}…',
    '{provider} を試しています…',
    'Probando {provider}…',
  ],
  'None of your providers could answer': [
    'Ни один из ваших провайдеров не смог ответить',
    '你的提供商都未能回答',
    'どのプロバイダーも回答できませんでした',
    'Ninguno de tus proveedores pudo responder',
  ],
  'Answer cut off': [
    'Ответ оборвался',
    '回答中断',
    '回答が途中で切れました',
    'Respuesta interrumpida',
  ],
  'It reached the length limit': [
    'Достигнут предел длины',
    '已达到长度上限',
    '長さの上限に達しました',
    'Llegó al límite de longitud',
  ],
  'It started repeating itself': [
    'Ответ начал повторяться',
    '回答开始重复',
    '回答が同じ内容を繰り返し始めました',
    'Empezó a repetirse',
  ],
  'Natively lost track of this answer. Ask again.': [
    'Natively потерял этот ответ. Спросите ещё раз.',
    'Natively 丢失了这次回答。请再问一次。',
    'Natively がこの回答を見失いました。もう一度質問してください。',
    'Natively perdió esta respuesta. Vuelve a preguntar.',
  ],
  'No AI provider is set up yet': [
    'Ни один AI-провайдер ещё не настроен',
    '尚未设置任何 AI 提供商',
    'AI プロバイダーがまだ設定されていません',
    'Aún no hay ningún proveedor de IA configurado',
  ],
  "The request couldn't be completed.": [
    'Не удалось выполнить запрос.',
    '请求未能完成。',
    'リクエストを完了できませんでした。',
    'No se pudo completar la solicitud.',
  ],

  // ── The one action ──
  'Open AI Providers': [
    'Открыть «AI-провайдеры»',
    '打开“AI 提供商”',
    '「AI プロバイダー」を開く',
    'Abrir «AI Providers»',
  ],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const DIRECT_ASSIST_RU = column(0);
export const DIRECT_ASSIST_ZH = column(1);
export const DIRECT_ASSIST_JA = column(2);
export const DIRECT_ASSIST_ES = column(3);
