// src/i18n.sttStatus.ts
//
// The overlay's transcription banners (NativelyInterface.tsx, sttStatusBanner):
// what stopped, then what to do. English source → [ru, zh, ja, es], one row
// per sentence, so a language can never miss a row the others have. Same shape
// as src/i18n.ambientChat.ts.
//
// The rows must match the strings the overlay passes to t() exactly:
// src/components/__tests__/SttConnectionBlockedBanner2026_10_29.test.mjs fails
// on a missing row or a leftover row.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  'Transcription Stopped': [
    'Расшифровка остановлена',
    '转录已停止',
    '文字起こしが停止しました',
    'Transcripción detenida',
  ],
  'Transcription Reconnecting': [
    'Переподключение расшифровки',
    '转录正在重新连接',
    '文字起こしを再接続中',
    'Reconectando la transcripción',
  ],
  // What stopped.
  'Nothing is being transcribed right now.': [
    'Сейчас ничего не расшифровывается.',
    '目前没有任何内容在转录。',
    '現在、何も文字起こしされていません。',
    'Ahora mismo no se está transcribiendo nada.',
  ],
  'Your microphone is no longer being transcribed.': [
    'Ваш микрофон больше не расшифровывается.',
    '您的麦克风已不再转录。',
    'マイクの音声は文字起こしされなくなりました。',
    'Tu micrófono ya no se está transcribiendo.',
  ],
  'Interviewer audio is no longer being transcribed.': [
    'Звук собеседника больше не расшифровывается.',
    '面试官的音频已不再转录。',
    '面接官の音声は文字起こしされなくなりました。',
    'El audio del entrevistador ya no se está transcribiendo.',
  ],
  'The connection to your speech-to-text provider dropped.': [
    'Соединение с сервисом распознавания речи прервалось.',
    '与语音转文字服务的连接已断开。',
    '音声認識サービスとの接続が切れました。',
    'Se perdió la conexión con tu proveedor de voz a texto.',
  ],
  // What to do.
  'Check your transcription provider and its key in Settings.': [
    'Проверьте сервис расшифровки и его ключ в настройках.',
    '请在设置中检查您的转录服务及其密钥。',
    '設定で文字起こしサービスとそのキーを確認してください。',
    'Revisa tu proveedor de transcripción y su clave en Ajustes.',
  ],
  'Retrying.': [
    'Повторная попытка.',
    '正在重试。',
    '再試行しています。',
    'Reintentando.',
  ],
  'Antivirus HTTPS scanning or a network filter is intercepting the connection. Allow Natively in your antivirus, or turn off its HTTPS scanning for Natively.': [
    'Проверка HTTPS в антивирусе или сетевой фильтр перехватывает соединение. Разрешите Natively в антивирусе или отключите для Natively проверку HTTPS.',
    '杀毒软件的 HTTPS 扫描或网络过滤器正在拦截连接。请在杀毒软件中允许 Natively，或为 Natively 关闭 HTTPS 扫描。',
    'ウイルス対策ソフトの HTTPS スキャンまたはネットワークフィルターが接続を傍受しています。ウイルス対策ソフトで Natively を許可するか、Natively の HTTPS スキャンをオフにしてください。',
    'El análisis HTTPS de tu antivirus o un filtro de red está interceptando la conexión. Permite Natively en tu antivirus o desactiva su análisis HTTPS para Natively.',
  ],
  'Natively cannot reach the transcription service. Check your internet connection, and allow Natively in your firewall and antivirus.': [
    'Natively не может связаться с сервисом расшифровки. Проверьте подключение к интернету и разрешите Natively в брандмауэре и антивирусе.',
    'Natively 无法连接到转录服务。请检查您的网络连接，并在防火墙和杀毒软件中允许 Natively。',
    'Natively が文字起こしサービスに接続できません。インターネット接続を確認し、ファイアウォールとウイルス対策ソフトで Natively を許可してください。',
    'Natively no puede conectarse al servicio de transcripción. Revisa tu conexión a internet y permite Natively en tu firewall y antivirus.',
  ],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const STT_STATUS_EN = Object.freeze(Object.keys(ROWS));
export const STT_STATUS_RU = column(0);
export const STT_STATUS_ZH = column(1);
export const STT_STATUS_JA = column(2);
export const STT_STATUS_ES = column(3);
