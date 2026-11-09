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
  // An on-device model (issue #707): no key and no provider to check.
  'There is not enough free memory for the local model. Close other apps, or choose a smaller local model in Settings → Audio.': [
    'Для локальной модели не хватает свободной памяти. Закройте другие приложения или выберите модель поменьше в «Настройки» → «Аудио».',
    '本地模型所需的可用内存不足。请关闭其他应用，或在“设置”→“音频”中选择更小的本地模型。',
    'ローカルモデルに必要な空きメモリが足りません。他のアプリを閉じるか、「設定」→「オーディオ」でより小さいローカルモデルを選んでください。',
    'No hay suficiente memoria libre para el modelo local. Cierra otras aplicaciones o elige un modelo local más pequeño en Ajustes → Audio.',
  ],
  'The local model has not finished downloading. Check your internet connection, or choose a cloud provider in Settings → Audio.': [
    'Локальная модель ещё не загрузилась. Проверьте подключение к интернету или выберите облачный сервис в «Настройки» → «Аудио».',
    '本地模型尚未下载完成。请检查您的网络连接，或在“设置”→“音频”中选择云端服务。',
    'ローカルモデルのダウンロードが完了していません。インターネット接続を確認するか、「設定」→「オーディオ」でクラウドのサービスを選んでください。',
    'El modelo local no ha terminado de descargarse. Revisa tu conexión a internet o elige un proveedor en la nube en Ajustes → Audio.',
  ],
  'The local speech model stopped. Restart the meeting, or choose another local model or a cloud provider in Settings → Audio.': [
    'Локальная модель распознавания речи остановилась. Перезапустите встречу или выберите другую локальную модель или облачный сервис в «Настройки» → «Аудио».',
    '本地语音模型已停止。请重新开始会议，或在“设置”→“音频”中选择其他本地模型或云端服务。',
    'ローカルの音声モデルが停止しました。会議をやり直すか、「設定」→「オーディオ」で別のローカルモデルかクラウドのサービスを選んでください。',
    'El modelo de voz local se detuvo. Reinicia la reunión o elige otro modelo local o un proveedor en la nube en Ajustes → Audio.',
  ],
  // A local model slower than speech (2026-11-09): text still comes, late.
  'Transcription Falling Behind': [
    'Расшифровка отстаёт',
    '转录跟不上',
    '文字起こしが遅れています',
    'La transcripción se está retrasando',
  ],
  'This local model is too slow for this computer, so text arrives later and later. Choose a lighter local model in Settings → Audio.': [
    'Эта локальная модель слишком медленная для этого компьютера, поэтому текст появляется всё позже. Выберите более лёгкую локальную модель в «Настройки» → «Аудио».',
    '这个本地模型在这台电脑上太慢，文字会越来越晚出现。请在“设置”→“音频”中选择更轻量的本地模型。',
    'このローカルモデルはこのコンピューターには遅すぎるため、文字がどんどん遅れて表示されます。「設定」→「オーディオ」でより軽いローカルモデルを選んでください。',
    'Este modelo local es demasiado lento para este equipo, así que el texto llega cada vez más tarde. Elige un modelo local más ligero en Ajustes → Audio.',
  ],
  // A Pro pack ran out mid-meeting (2026-11-09). "Plans & Billing" stays in
  // English: it is the Settings tab's name, which is not translated.
  'Your pack hours are used up': [
    'Часы вашего пакета израсходованы',
    '您的套餐时长已用完',
    'パックの時間を使い切りました',
    'Has agotado las horas de tu paquete',
  ],
  'Your pack has ended': [
    'Срок действия вашего пакета истёк',
    '您的套餐已结束',
    'パックの期間が終了しました',
    'Tu paquete ha terminado',
  ],
  'Natively transcription has stopped. Add hours or choose a plan in Plans & Billing.': [
    'Расшифровка Natively остановлена. Добавьте часы или выберите тариф в «Plans & Billing».',
    'Natively 转录已停止。请在“Plans & Billing”中添加时长或选择套餐。',
    'Natively の文字起こしが停止しました。「Plans & Billing」で時間を追加するか、プランを選んでください。',
    'La transcripción de Natively se ha detenido. Añade horas o elige un plan en Plans & Billing.',
  ],
  'What the pack included has stopped. Add hours or choose a plan in Plans & Billing.': [
    'То, что входило в пакет, больше не работает. Добавьте часы или выберите тариф в «Plans & Billing».',
    '套餐包含的功能已停止。请在“Plans & Billing”中添加时长或选择套餐。',
    'パックに含まれていた機能は停止しました。「Plans & Billing」で時間を追加するか、プランを選んでください。',
    'Lo que incluía el paquete se ha detenido. Añade horas o elige un plan en Plans & Billing.',
  ],
  'Add hours': [
    'Добавить часы',
    '添加时长',
    '時間を追加',
    'Añadir horas',
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
