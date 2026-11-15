// src/i18n.onboarding.ts
//
// The first-launch welcome, the shortcut tour and the demo overlay beside them
// (src/components/onboarding). English source → [ru, zh, ja, es], one row per
// string, so a language can never miss a row the others have.
//
// Placeholders — {n}, {total}, {keys}, {terms}, {privacy} — are filled by
// src/components/onboarding/i18nText.tsx. They stay in the translation so word
// order can follow the language (zh/ja put the number first, es/ru do not).
//
// Spread into src/i18n.tsx AFTER each *_GENERATED file and BEFORE the
// hand-authored block, so a row here also fills a key the generated file lists
// untranslated. A key the generated files already translate is left out on
// purpose, so their wording stands.

type Row = readonly [ru: string, zh: string, ja: string, es: string];

const ROWS: Record<string, Row> = {
  // ── Welcome ──
  'Welcome to Natively': ['Добро пожаловать в Natively', '欢迎使用 Natively', 'Natively へようこそ', 'Te damos la bienvenida a Natively'],
  'Real-time help,': ['Помощь в реальном времени,', '实时协助，', 'リアルタイムのサポートを、', 'Ayuda en tiempo real,'],
  'in every meeting.': ['на каждой встрече.', '尽在每场会议。', 'すべての会議で。', 'en cada reunión.'],
  'Natively listens along, answers the question in front of you, and can stay hidden from screen sharing.': [
    'Natively слушает разговор, отвечает на заданный вам вопрос и может оставаться скрытым при демонстрации экрана.',
    'Natively 全程聆听，回答摆在你面前的问题，并且可以在屏幕共享时保持隐藏。',
    'Natively は会話を聞き取り、目の前の質問に答え、画面共有中は表示されないようにもできます。',
    'Natively escucha la conversación, responde la pregunta que tienes delante y puede permanecer oculto al compartir pantalla.',
  ],
  'Get started': ['Начать', '开始使用', '始める', 'Empezar'],
  // The clock starts with the first meeting and runs for 30 minutes, across
  // meetings: "includes" read as if the minutes belonged to that one meeting.
  'Your 30 free minutes start with your first meeting. No card needed.': [
    'Ваши 30 бесплатных минут начнутся с первой встречи. Карта не нужна.',
    '30 分钟免费时长从你的第一次会议开始计时，无需绑卡。',
    '30 分の無料時間は、最初のミーティングの開始とともに始まります。カードは不要です。',
    'Tus 30 minutos gratis empiezan con tu primera reunión. Sin tarjeta.',
  ],
  'Watch a 9-minute demo': ['Смотреть 9-минутное демо', '观看 9 分钟演示', '9 分のデモを見る', 'Ver una demo de 9 minutos'],
  'By continuing, you agree to our {terms} and {privacy}.': [
    'Продолжая, вы принимаете наши {terms} и {privacy}.',
    '继续即表示你同意我们的{terms}和{privacy}。',
    '続行すると、{terms}および{privacy}に同意したものとみなされます。',
    'Al continuar, aceptas nuestros {terms} y nuestra {privacy}.',
  ],
  'Terms & Conditions': ['Условия использования', '服务条款', '利用規約', 'Términos y condiciones'],
  'Privacy Policy': ['Политику конфиденциальности', '隐私政策', 'プライバシーポリシー', 'Política de privacidad'],

  // ── Tour ──
  'Step {n} of {total}': ['Шаг {n} из {total}', '第 {n} 步，共 {total} 步', 'ステップ {n} / {total}', 'Paso {n} de {total}'],
  'Show or hide Natively': ['Показать или скрыть Natively', '显示或隐藏 Natively', 'Natively を表示／非表示', 'Mostrar u ocultar Natively'],
  'Tap it again to bring the overlay back. Works from any app.': [
    'Нажмите ещё раз, чтобы вернуть оверлей. Работает из любого приложения.',
    '再按一次即可让悬浮窗重新出现，在任何应用中都有效。',
    'もう一度押すとオーバーレイが戻ります。どのアプリからでも使えます。',
    'Púlsalo de nuevo para recuperar el overlay. Funciona desde cualquier app.',
  ],
  'Get the answer': ['Получите ответ', '获取答案', '答えを得る', 'Obtén la respuesta'],
  'Natively answers the question you were just asked.': [
    'Natively отвечает на вопрос, который вам только что задали.',
    'Natively 会回答刚刚向你提出的问题。',
    'Natively が、たった今聞かれた質問に答えます。',
    'Natively responde a la pregunta que acaban de hacerte.',
  ],
  'Show it your screen': ['Покажите ему свой экран', '让它看到你的屏幕', '画面を見せる', 'Muéstrale tu pantalla'],
  'Takes a screenshot so Natively can read what you see.': [
    'Делает снимок экрана, чтобы Natively видел то же, что и вы.',
    '截取屏幕，让 Natively 看到你所看到的内容。',
    'スクリーンショットを撮り、あなたが見ているものを Natively が読み取れるようにします。',
    'Hace una captura para que Natively lea lo que ves.',
  ],
  'Try {keys}': ['Попробовать {keys}', '试试 {keys}', '{keys} を試す', 'Probar {keys}'],
  'That’s it. Watch the overlay on the right.': [
    'Готово. Смотрите на оверлей справа.',
    '完成！请看右侧的悬浮窗。',
    'できました。右のオーバーレイをご覧ください。',
    'Listo. Mira el overlay de la derecha.',
  ],
  'Try it now: press {keys} on your keyboard, or click the keys.': [
    'Попробуйте: нажмите {keys} на клавиатуре или кликните по клавишам.',
    '现在试试：在键盘上按 {keys}，或直接点击按键。',
    '試してみましょう：キーボードで {keys} を押すか、キーをクリックしてください。',
    'Pruébalo ahora: pulsa {keys} en el teclado o haz clic en las teclas.',
  ],
  'Skip': ['Пропустить', '跳过', 'スキップ', 'Omitir'],
  'Next': ['Далее', '下一步', '次へ', 'Siguiente'],
  'Start using Natively': ['Начать пользоваться Natively', '开始使用 Natively', 'Natively を使い始める', 'Empezar a usar Natively'],

  // ── The call and the overlay beside it ──
  'Overlay hidden. Press {keys} to bring it back.': [
    'Оверлей скрыт. Нажмите {keys}, чтобы вернуть его.',
    '悬浮窗已隐藏。按 {keys} 即可恢复。',
    'オーバーレイを非表示にしました。{keys} で元に戻せます。',
    'Overlay oculto. Pulsa {keys} para recuperarlo.',
  ],
  'A video call with two participants': [
    'Видеозвонок с двумя участниками', '两位参与者的视频通话', '2 人が参加しているビデオ通話', 'Una videollamada con dos participantes',
  ],
  'What should I say?': ['Что мне ответить?', '我该怎么说？', '何と答えればいいですか？', '¿Qué debería decir?'],
  'What should I say about this?': ['Что мне сказать об этом?', '关于这个我该怎么说？', 'これについて何と答えればいいですか？', '¿Qué debería decir sobre esto?'],
  'Thinking': ['Думаю', '思考中', '考え中', 'Pensando'],
  // "N screenshots attached": Russian counts take three forms, so it is phrased as a label and a number.
  '{n} screenshot attached': ['Прикреплено скриншотов: {n}', '已附加 {n} 张截图', 'スクリーンショット {n} 枚を添付', '{n} captura adjunta'],
  '{n} screenshots attached': ['Прикреплено скриншотов: {n}', '已附加 {n} 张截图', 'スクリーンショット {n} 枚を添付', '{n} capturas adjuntas'],

  // The answers the demo gives.
  'I’d say a process has its own memory, while the threads inside it share one. That makes threads cheaper to start and switch between, but they have to coordinate access to shared data.': [
    'Я бы сказал, что у процесса своя память, а потоки внутри него используют одну общую. Поэтому потоки дешевле запускать и переключать, но им приходится согласовывать доступ к общим данным.',
    '我会说，进程拥有自己的内存，而其中的线程共享同一块内存。这使线程的创建和切换成本更低，但它们必须协调对共享数据的访问。',
    'こう答えるとよいでしょう。プロセスは独自のメモリを持ち、その中のスレッドは同じメモリを共有します。そのためスレッドは起動も切り替えも軽い一方、共有データへのアクセスを調整する必要があります。',
    'Diría que un proceso tiene su propia memoria, mientras que los hilos que contiene comparten una sola. Eso hace que los hilos sean más baratos de crear y de alternar, pero tienen que coordinar el acceso a los datos compartidos.',
  ],
  'I’d start with the index: it lets the database jump straight to the rows it needs instead of scanning the whole table, which is what keeps our lookups fast as data grows.': [
    'Я бы начал с индекса: он позволяет базе данных сразу перейти к нужным строкам, а не сканировать всю таблицу, — именно поэтому поиск остаётся быстрым по мере роста данных.',
    '我会从索引说起：它让数据库直接跳到所需的行，而不必扫描整张表，这正是数据量增长时查询依然很快的原因。',
    'まずインデックスから説明するとよいでしょう。テーブル全体をスキャンせず、必要な行に直接アクセスできるため、データが増えても検索が速いままです。',
    'Empezaría por el índice: permite que la base de datos salte directamente a las filas que necesita en lugar de recorrer toda la tabla, y eso es lo que mantiene rápidas nuestras búsquedas a medida que crecen los datos.',
  ],
  'From what’s on screen, I’d point to the numbers in the second column: they’re trending up week over week, and I can walk through what’s driving that.': [
    'Судя по экрану, я бы указал на цифры во втором столбце: они растут неделя за неделей, и я могу объяснить, что за этим стоит.',
    '从屏幕上看，我会指出第二列的数字：它们逐周上升，我可以说明背后的原因。',
    '画面を見る限り、2 列目の数字に注目するとよいでしょう。週ごとに増加しており、その要因も説明できます。',
    'Por lo que se ve en pantalla, señalaría las cifras de la segunda columna: van al alza semana tras semana y puedo explicar qué las impulsa.',
  ],

  // The voice button, Speak (was Answer until 2026-10-30), here and in the
  // real overlay, which reads this row too, as do its screenshot tray and its
  // shortcut in Settings.
  'Speak': ['Сказать', '说话', '話す', 'Hablar'],
  'Type a question or click Speak': [
    'Введите вопрос или нажмите «Сказать»', '输入问题，或点击“说话”', '質問を入力するか、［話す］をクリックしてください', 'Escribe una pregunta o pulsa Hablar',
  ],
  // ── First-run guide (components/guide) ──
  'Your first meeting': ['Ваша первая встреча', '你的第一场会议', 'はじめての会議', 'Tu primera reunión'],
  'Start your first meeting.': ['Начните свою первую встречу.', '开始你的第一场会议。', 'はじめての会議を開始しましょう。', 'Empieza tu primera reunión.'],
  'Your free trial covers it. Join your call first, or start now.': ['Бесплатный пробный период это покрывает. Сначала подключитесь к звонку или начните сейчас.', '免费试用已包含。先加入通话，或现在就开始。', '無料トライアルで使えます。先に通話に参加するか、今すぐ開始してください。', 'Tu prueba gratuita lo cubre. Únete primero a tu llamada o empieza ahora.'],
  'Your plan covers it. Join your call first, or start now.': ['Ваш тариф это покрывает. Сначала подключитесь к звонку или начните сейчас.', '你的套餐已包含。先加入通话，或现在就开始。', 'ご利用のプランで使えます。先に通話に参加するか、今すぐ開始してください。', 'Tu plan lo cubre. Únete primero a tu llamada o empieza ahora.'],
  'Waiting for you': ['Ждём вас', '等你操作', '操作を待っています', 'Esperándote'],
  'Skip guide': ['Пропустить гид', '跳过引导', 'ガイドをスキップ', 'Saltar guía'],
  '{n} of {total}': ['{n} из {total}', '{n}/{total}', '{n}/{total}', '{n} de {total}'],
  'Done': ['Готово', '完成', '完了', 'Hecho'],
  'What to answer': ['Что ответить', '如何回答', '何と答えるか', 'Qué responder'],
  'They just asked you something.': ['Вам только что задали вопрос.', '对方刚刚问了你一个问题。', '今、質問されました。', 'Te acaban de preguntar algo.'],
  'Press the keys. Natively writes your reply from the conversation.': ['Нажмите клавиши. Natively напишет ответ по ходу разговора.', '按下快捷键。Natively 会根据对话为你写出回答。', 'キーを押すと、Natively が会話から返答を作成します。', 'Pulsa las teclas. Natively escribe tu respuesta a partir de la conversación.'],
  'Not on a call? Play any interview video, or ask a question out loud.': ['Не на звонке? Включите любое видео с собеседованием или задайте вопрос вслух.', '不在通话中？播放任意面试视频，或大声提一个问题。', '通話中ではありませんか？面接の動画を再生するか、声に出して質問してください。', '¿No estás en una llamada? Reproduce cualquier vídeo de entrevista o haz una pregunta en voz alta.'],
  'Screenshots': ['Скриншоты', 'Screenshots', 'スクリーンショット', 'Screenshots'],
  'Show Natively your screen.': ['Покажите Natively свой экран.', '让 Natively 看到你的屏幕。', 'Natively に画面を見せましょう。', 'Muéstrale tu pantalla a Natively.'],
  'Whole screen': ['Весь экран', '整个屏幕', '画面全体', 'Pantalla completa'],
  'Drag an area': ['Выделить область', '拖选区域', '範囲をドラッグ', 'Arrastra un área'],
  'Notepad': ['Блокнот', '记事本', 'メモ帳', 'Bloc de notas'],
  'This is your meeting overlay.': ['Это ваш оверлей встречи.', '这是你的会议浮窗。', 'これがミーティングのオーバーレイです。', 'Esta es tu superposición de reunión.'],
  'Answers, screenshots and chat show up here, over your call.': ['Ответы, скриншоты и чат появляются здесь, поверх звонка.', '回答、截图和聊天都会显示在这里，悬浮在通话之上。', '回答、スクリーンショット、チャットは通話の上のここに表示されます。', 'Las respuestas, las capturas y el chat aparecen aquí, sobre tu llamada.'],
  'Now try the notepad.': ['Теперь попробуйте блокнот.', '现在试试记事本。', '次はノートパッドを試しましょう。', 'Ahora prueba el bloc de notas.'],
  'Pick Notepad. Your next meeting opens there: write while you talk, and Ask with recipes.': ['Выберите «Блокнот». Следующая встреча откроется там: пишите, пока говорите, и спрашивайте с рецептами.', '选择“记事本”。下一场会议会在那里打开：边聊边记，并用配方提问。', '「ノートパッド」を選んでください。次の会議はそこで開きます。話しながら書き、レシピで質問できます。', 'Elige Bloc de notas. Tu próxima reunión se abrirá ahí: escribe mientras hablas y pregunta con recetas.'],
  'Start Natively again.': ['Снова запустите Natively.', '再次启动 Natively。', 'もう一度 Natively を開始しましょう。', 'Inicia Natively de nuevo.'],
  'This time your meeting opens in the notepad.': ['На этот раз встреча откроется в блокноте.', '这次会议会在记事本中打开。', '今回は会議がノートパッドで開きます。', 'Esta vez tu reunión se abre en el bloc de notas.'],
  'Ask about the meeting.': ['Спросите о встрече.', '询问这场会议。', '会議について質問しましょう。', 'Pregunta sobre la reunión.'],
  'Click Ask anything. It knows everything said so far.': ['Нажмите «Спросить что угодно». Он знает всё, что уже было сказано.', '点击“随便问”。它知道到目前为止说过的一切。', '「何でも質問」をクリック。ここまでの会話をすべて把握しています。', 'Haz clic en Pregunta lo que quieras. Sabe todo lo dicho hasta ahora.'],
  'Try a recipe.': ['Попробуйте рецепт.', '试试一个配方。', 'レシピを試しましょう。', 'Prueba una receta.'],
  'Recipes are ready-made asks. Pick one, or type / to see them all.': ['Рецепты — это готовые вопросы. Выберите один или введите /, чтобы увидеть все.', '配方是现成的提问。选一个，或输入 / 查看全部。', 'レシピは用意された質問です。1 つ選ぶか、/ を入力してすべて表示します。', 'Las recetas son preguntas listas. Elige una o escribe / para verlas todas.'],
  'Your notepad meeting, written up.': ['Ваша встреча в блокноте, оформлена.', '你的记事本会议，已整理好。', 'ノートパッドの会議をまとめました。', 'Tu reunión del bloc de notas, redactada.'],
  'Your notes, the summary and Ask’s answers are saved together. Find them any time on Home.': ['Ваши заметки, сводка и ответы «Спросить» сохранены вместе. Их всегда можно найти на главной.', '你的笔记、摘要和提问的回答都保存在一起。随时可在主页找到。', 'メモ、要約、質問への回答はまとめて保存されます。ホームでいつでも見られます。', 'Tus notas, el resumen y las respuestas de Pregunta se guardan juntos. Encuéntralos en Inicio cuando quieras.'],
  'Press the stop button ■ in the bar at the top. Natively writes up your notes.': ['Нажмите кнопку остановки ■ на панели сверху. Natively оформит ваши заметки.', '按顶部栏中的停止按钮 ■。Natively 会整理好你的笔记。', '上のバーの停止ボタン ■ を押してください。Natively がメモをまとめます。', 'Pulsa el botón de detener ■ en la barra superior. Natively redacta tus notas.'],
  'Write while you talk.': ['Пишите, пока говорите.', '边聊边记。', '話しながら書きましょう。', 'Escribe mientras hablas.'],
  'Open notepad': ['Открыть блокнот', '打开记事本', 'メモ帳を開く', 'Abrir bloc de notas'],
  'Jot a line. It goes into your meeting notes.': ['Запишите строчку. Она попадёт в заметки о встрече.', '写一行。它会进入你的会议笔记。', '一行書いてください。会議メモに入ります。', 'Escribe una línea. Irá a tus notas de la reunión.'],
  'Stop the meeting when you’re ready.': ['Остановите встречу, когда будете готовы.', '准备好后结束会议。', '準備ができたら会議を終了してください。', 'Detén la reunión cuando quieras.'],
  'Natively writes up your notes as soon as it stops.': ['Natively составит заметки сразу после остановки.', '会议一结束，Natively 就会整理好笔记。', '終了するとすぐに Natively がメモをまとめます。', 'Natively redacta tus notas en cuanto se detiene.'],
  'Meeting notes': ['Заметки о встрече', 'Meeting notes', '会議メモ', 'Meeting notes'],
  'Your meeting, written up.': ['Ваша встреча — в заметках.', '你的会议，已整理好。', '会議の内容をまとめました。', 'Tu reunión, por escrito.'],
  'The summary and the full transcript are saved here. Find them any time on Home.': ['Здесь сохранены сводка и полная расшифровка. Их всегда можно найти на главной.', '摘要和完整转录都保存在这里。随时可在主页找到。', '要約と全文の文字起こしはここに保存されます。いつでもホームから見られます。', 'El resumen y la transcripción completa se guardan aquí. Encuéntralos cuando quieras en Inicio.'],
  'Free trial': ['Бесплатный пробный период', '免费试用', '無料トライアル', 'Prueba gratuita'],
  'Your free trial is almost used up.': ['Бесплатный пробный период почти закончился.', '你的免费试用快用完了。', '無料トライアルの残りがわずかです。', 'Tu prueba gratuita casi se ha agotado.'],
  'Your free trial is used up.': ['Бесплатный пробный период закончился.', '你的免费试用已用完。', '無料トライアルを使い切りました。', 'Tu prueba gratuita se ha agotado.'],
  'Your free trial isn’t available on this device.': ['Бесплатный пробный период недоступен на этом устройстве.', '此设备无法使用免费试用。', 'このデバイスでは無料トライアルを利用できません。', 'Tu prueba gratuita no está disponible en este dispositivo.'],
  'Keep Natively Pro after your trial.': ['Сохраните Natively Pro после пробного периода.', '试用结束后继续使用 Natively Pro。', 'トライアル後も Natively Pro を使い続けましょう。', 'Conserva Natively Pro después de tu prueba.'],
  'About {n} min left.': ['Осталось около {n} мин.', '大约还剩 {n} 分钟。', '残り約 {n} 分です。', 'Quedan unos {n} min.'],
  'Pick a plan on the right to keep Natively Pro. Or use your own AI keys, free.': ['Выберите план справа, чтобы сохранить Natively Pro. Или используйте свои ключи ИИ бесплатно.', '在右侧选择套餐以继续使用 Natively Pro。或免费使用你自己的 AI 密钥。', '右のプランを選んで Natively Pro を続けましょう。または、ご自身の AI キーを無料で使えます。', 'Elige un plan a la derecha para conservar Natively Pro. O usa tus propias claves de IA, gratis.'],
  'Use my own keys': ['Использовать свои ключи', '使用我自己的密钥', '自分のキーを使う', 'Usar mis propias claves'],
  'Natively Pro': ['Natively Pro', 'Natively Pro', 'Natively Pro', 'Natively Pro'],
  'Thanks. You’re all set.': ['Спасибо. Всё готово.', '谢谢，一切就绪。', 'ありがとうございます。準備完了です。', 'Gracias. Ya está todo listo.'],
  'Your plan covers the AI and speech-to-text. Start a meeting any time.': ['Ваш план включает ИИ и распознавание речи. Начинайте встречу когда угодно.', '你的套餐已包含 AI 和语音转文字。随时开始会议。', 'プランには AI と音声文字変換が含まれます。いつでも会議を開始できます。', 'Tu plan incluye la IA y la transcripción de voz. Empieza una reunión cuando quieras.'],
  'Your own keys': ['Ваши ключи', '你自己的密钥', '自分のキー', 'Tus propias claves'],
  'Set up Natively your way.': ['Настройте Natively под себя.', '按你的方式设置 Natively。', 'Natively を自分好みに設定しましょう。', 'Configura Natively a tu manera.'],
  'An AI provider is all you need. Speech-to-text and retrieval make it better.': ['Достаточно провайдера ИИ. Распознавание речи и поиск по документам сделают работу лучше.', '只需一个 AI 提供商即可。语音转文字和检索会让它更好用。', '必要なのは AI プロバイダーだけです。音声文字変換と検索でさらに便利になります。', 'Solo necesitas un proveedor de IA. La transcripción de voz y la búsqueda lo mejoran.'],
  'AI provider': ['Провайдер ИИ', 'AI 提供商', 'AI プロバイダー', 'Proveedor de IA'],
  'Paste a key': ['Вставьте ключ', '粘贴密钥', 'キーを貼り付け', 'Pega una clave'],
  'Speech-to-text': ['Распознавание речи', '语音转文字', '音声文字変換', 'Transcripción de voz'],
  'Pick one': ['Выберите', '选择一个', '1つ選択', 'Elige uno'],
  'Retrieval': ['Поиск по документам', '检索', '検索', 'Búsqueda'],
  'Optional': ['Необязательно', '可选', '任意', 'Opcional'],
  'Keep Natively Pro.': ['Сохраните Natively Pro.', '继续使用 Natively Pro。', 'Natively Pro を使い続けましょう。', 'Conserva Natively Pro.'],
  'Continue the guide': ['Продолжить гид', '继续引导', 'ガイドを続ける', 'Continuar la guía'],
  'Show the guide again': ['Показать гид снова', '再次显示引导', 'ガイドをもう一度表示', 'Mostrar la guía otra vez'],
  'Walks you through your first meeting, one step at a time.': ['Проведёт вас через первую встречу шаг за шагом.', '一步步带你完成第一场会议。', 'はじめての会議を一歩ずつ案内します。', 'Te acompaña en tu primera reunión, paso a paso.'],
};

function column(i: 0 | 1 | 2 | 3): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [en, row] of Object.entries(ROWS)) out[en] = row[i];
  return out;
}

export const ONBOARDING_RU = column(0);
export const ONBOARDING_ZH = column(1);
export const ONBOARDING_JA = column(2);
export const ONBOARDING_ES = column(3);
