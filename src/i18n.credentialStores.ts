// src/i18n.credentialStores.ts
//
// What the credential-stores card in Settings → AI Providers says (the card is
// AmbiguousStoresCard in src/components/settings/AIProvidersSettings.tsx; its
// refusal sentences and store names come from src/lib/credentialStoresConflict.mjs).
// English source → [ru, zh, ja, es], one row per sentence, so a language can
// never miss a row the others have. Same shape as src/i18n.directAssist.ts.
//
// Placeholders — {store}, {when}, {count}, {provider} — are filled AFTER
// translation, so the name sits where the language puts it. Provider names
// (Gemini, OpenAI, Deepgram…) are never translated.
//
// Counts are written "other settings: 6", not "6 other settings": that form
// needs no plural, and Russian has three.
//
// The rows must match CREDENTIAL_STORES_PHRASES plus every t('…') in the card
// exactly: src/lib/__tests__/credentialStoresI18n2026_10_02.test.mjs fails on a
// missing row, a leftover row, or a dropped placeholder.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  // ── The card ──
  'Two saved key sets were found': [
    'Найдено два сохранённых набора ключей',
    '发现两组已保存的密钥',
    '保存済みのキーのセットが 2 つ見つかりました',
    'Se encontraron dos conjuntos de claves guardados',
  ],
  'Choose one': [
    'Выберите один',
    '请选择其一',
    '1 つ選択',
    'Elige uno',
  ],
  'This usually follows a restored backup or a move to another computer. Both sets stay in use until you choose, and new keys are saved to the app backup, the weaker of the two.': [
    'Обычно так бывает после восстановления из резервной копии или переноса на другой компьютер. Пока вы не выберете, используются оба набора, а новые ключи сохраняются в резервную копию приложения, менее защищённую из двух.',
    '这通常发生在从备份恢复或迁移到另一台电脑之后。在你做出选择之前，两组密钥都会继续使用，新密钥会保存到应用备份中，也就是两者中保护较弱的一个。',
    '通常、バックアップからの復元や別のコンピュータへの移行のあとに起こります。選択するまでは両方のセットが使われ、新しいキーは保護の弱いほうであるアプリのバックアップに保存されます。',
    'Suele ocurrir tras restaurar una copia de seguridad o pasar a otro ordenador. Hasta que elijas se usan ambos conjuntos, y las claves nuevas se guardan en la copia de la app, la menos protegida de las dos.',
  ],
  'Both files are copied aside before anything changes.': [
    'Перед любыми изменениями оба файла копируются в отдельное место.',
    '在做任何更改之前，会先为两个文件另存一份副本。',
    '変更の前に、両方のファイルのコピーが別に保存されます。',
    'Antes de cambiar nada se guarda una copia aparte de ambos archivos.',
  ],

  // ── A set ──
  'macOS Keychain': [
    'Связка ключей macOS',
    'macOS 钥匙串',
    'macOS キーチェーン',
    'Llavero de macOS',
  ],
  'Windows account': [
    'Учётная запись Windows',
    'Windows 账户',
    'Windows アカウント',
    'Cuenta de Windows',
  ],
  'System keyring': [
    'Системное хранилище ключей',
    '系统密钥环',
    'システムのキーリング',
    'Llavero del sistema',
  ],
  'App backup': [
    'Резервная копия приложения',
    '应用备份',
    'アプリのバックアップ',
    'Copia de la app',
  ],
  'Saved {when}': [
    'Сохранено {when}',
    '保存于 {when}',
    '{when} に保存',
    'Guardado el {when}',
  ],
  'Save time unknown': [
    'Время сохранения неизвестно',
    '保存时间未知',
    '保存日時は不明',
    'Fecha de guardado desconocida',
  ],
  'newer': [
    'новее',
    '较新',
    '新しいほう',
    'más reciente',
  ],
  'other settings: {count}': [
    'другие настройки: {count}',
    '其他设置：{count}',
    'その他の設定：{count}',
    'otros ajustes: {count}',
  ],
  'No keys could be read from this set.': [
    'Из этого набора не удалось прочитать ни одного ключа.',
    '无法从这一组中读取任何密钥。',
    'このセットからキーを読み取れませんでした。',
    'No se pudo leer ninguna clave de este conjunto.',
  ],
  'only here': [
    'только здесь',
    '仅此处有',
    'こちらのみ',
    'solo aquí',
  ],
  'differs': [
    'отличается',
    '不同',
    '異なる',
    'difiere',
  ],

  // ── Keys that are described rather than named ──
  'Custom embeddings': [
    'Свои эмбеддинги',
    '自定义 embeddings',
    'カスタム埋め込み',
    'Embeddings personalizados',
  ],
  'Custom reranker': [
    'Свой реранкер',
    '自定义重排序器',
    'カスタムリランカー',
    'Re-ranker personalizado',
  ],
  '{provider} speech': [
    '{provider} (речь)',
    '{provider} 语音',
    '{provider} 音声',
    '{provider} (voz)',
  ],

  // ── The choices ──
  'Keep this set': [
    'Оставить этот набор',
    '保留这一组',
    'このセットを残す',
    'Conservar este conjunto',
  ],
  'Keep both': [
    'Оставить оба',
    '两组都保留',
    '両方残す',
    'Conservar ambos',
  ],
  'Applying…': [
    'Применяется…',
    '正在应用…',
    '適用中…',
    'Aplicando…',
  ],
  'Or keep both. Where a key differs, the one in the app backup is used.': [
    'Или оставьте оба. Если ключ различается, используется тот, что в резервной копии приложения.',
    '或者两组都保留。如果某个密钥不同，则使用应用备份中的那个。',
    'または両方を残します。キーが異なる場合は、アプリのバックアップのものが使われます。',
    'O conserva ambos. Si una clave difiere, se usa la de la copia de la app.',
  ],

  // ── A refused choice: the cause, then what to do ──
  'The two files could not be copied aside first, so nothing was changed.': [
    'Не удалось сначала сделать копии двух файлов, поэтому ничего не изменено.',
    '无法先为两个文件另存副本，因此未做任何更改。',
    '先に 2 つのファイルのコピーを保存できなかったため、何も変更されていません。',
    'No se pudo guardar antes una copia de los dos archivos, así que no se cambió nada.',
  ],
  'Free up some disk space, then choose again.': [
    'Освободите место на диске и выберите ещё раз.',
    '请释放一些磁盘空间，然后重新选择。',
    'ディスクの空き容量を増やしてから、もう一度選択してください。',
    'Libera espacio en el disco y vuelve a elegir.',
  ],
  'Your choice could not be saved, so nothing was changed.': [
    'Не удалось сохранить ваш выбор, поэтому ничего не изменено.',
    '无法保存你的选择，因此未做任何更改。',
    '選択を保存できなかったため、何も変更されていません。',
    'No se pudo guardar tu elección, así que no se cambió nada.',
  ],
  'Choose again. If it keeps failing, restart Natively.': [
    'Выберите ещё раз. Если ошибка повторяется, перезапустите Natively.',
    '请重新选择。如果仍然失败，请重启 Natively。',
    'もう一度選択してください。失敗が続く場合は Natively を再起動してください。',
    'Vuelve a elegir. Si sigue fallando, reinicia Natively.',
  ],
  'The {store} set could not be read, so nothing was changed.': [
    'Набор «{store}» не удалось прочитать, поэтому ничего не изменено.',
    '无法读取“{store}”这组密钥，因此未做任何更改。',
    '「{store}」のセットを読み取れなかったため、何も変更されていません。',
    'No se pudo leer el conjunto «{store}», así que no se cambió nada.',
  ],
  'Unlock your keychain and choose again, or keep the app backup.': [
    'Разблокируйте связку ключей и выберите ещё раз или оставьте резервную копию приложения.',
    '请解锁钥匙串后重新选择，或保留应用备份。',
    'キーチェーンのロックを解除してもう一度選択するか、アプリのバックアップを残してください。',
    'Desbloquea tu llavero y vuelve a elegir, o conserva la copia de la app.',
  ],
  'Sign in to the Windows account that saved these keys and choose again, or keep the app backup.': [
    'Войдите в учётную запись Windows, в которой были сохранены эти ключи, и выберите ещё раз или оставьте резервную копию приложения.',
    '请登录保存这些密钥的 Windows 账户后重新选择，或保留应用备份。',
    'これらのキーを保存した Windows アカウントでサインインしてもう一度選択するか、アプリのバックアップを残してください。',
    'Inicia sesión en la cuenta de Windows que guardó estas claves y vuelve a elegir, o conserva la copia de la app.',
  ],
  'Unlock your system keyring and choose again, or keep the app backup.': [
    'Разблокируйте системное хранилище ключей и выберите ещё раз или оставьте резервную копию приложения.',
    '请解锁系统密钥环后重新选择，或保留应用备份。',
    'システムのキーリングのロックを解除してもう一度選択するか、アプリのバックアップを残してください。',
    'Desbloquea el llavero del sistema y vuelve a elegir, o conserva la copia de la app.',
  ],
  'The app backup could not be read, so nothing was changed.': [
    'Не удалось прочитать резервную копию приложения, поэтому ничего не изменено.',
    '无法读取应用备份，因此未做任何更改。',
    'アプリのバックアップを読み取れなかったため、何も変更されていません。',
    'No se pudo leer la copia de la app, así que no se cambió nada.',
  ],
  'Keep the {store} set instead.': [
    'Оставьте набор «{store}».',
    '请改为保留“{store}”这组密钥。',
    '代わりに「{store}」のセットを残してください。',
    'Conserva en su lugar el conjunto «{store}».',
  ],
  'Your key store is unavailable this session, so nothing was changed.': [
    'Хранилище ключей недоступно в этом сеансе, поэтому ничего не изменено.',
    '密钥存储在本次会话中不可用，因此未做任何更改。',
    'このセッションではキーの保管先を利用できないため、何も変更されていません。',
    'El almacén de claves no está disponible en esta sesión, así que no se cambió nada.',
  ],
  'Restart Natively and try again.': [
    'Перезапустите Natively и повторите попытку.',
    '请重启 Natively 后重试。',
    'Natively を再起動して、もう一度お試しください。',
    'Reinicia Natively y vuelve a intentarlo.',
  ],
  'That choice could not be applied, so nothing was changed.': [
    'Не удалось применить этот выбор, поэтому ничего не изменено.',
    '无法应用该选择，因此未做任何更改。',
    'その選択を適用できなかったため、何も変更されていません。',
    'No se pudo aplicar esa elección, así que no se cambió nada.',
  ],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const CREDENTIAL_STORES_RU = column(0);
export const CREDENTIAL_STORES_ZH = column(1);
export const CREDENTIAL_STORES_JA = column(2);
export const CREDENTIAL_STORES_ES = column(3);
