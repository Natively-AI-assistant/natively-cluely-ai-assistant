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
// untranslated (zh and es "Answer" are). A key the generated files already
// translate is left out on purpose, so their wording stands.

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
  'Thinking...': ['Думаю...', '思考中...', '考え中...', 'Pensando...'],
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

  // Already translated in the generated files, but left as English in zh and es.
  'Answer': ['Ответить', '回答', '回答', 'Responder'],
  'Ask a question or click Answer': [
    'Задайте вопрос или нажмите «Ответить»', '提问，或点击“回答”', '質問を入力するか、［回答］をクリックしてください', 'Haz una pregunta o pulsa Responder',
  ],
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
