// Independent measurement set #6 for the diagram decision — es / ru / zh / ja.
// Written and labelled BEFORE anything was run on any of these sentences,
// by an author who has never read the rules or the prompt under test.
// Labels = what a sensible listener in the meeting would expect.
//
// Fixture domain: a ticketing platform for concerts and live events.

const SRC = {
  es: `flowchart LR
  app["App web y móvil"] --> gw[Pasarela de API]
  gw --> cat[Servicio de catálogo de eventos]
  gw --> inv[(Inventario de asientos)]
  gw --> pay["Servicio de pagos / checkout"]
  pay --> cola[[Cola de pedidos]]
  cola --> emis[Emisión de entradas electrónicas]
  emis --> notif[Notificaciones]
  emis --> scan["Servicio de escaneo en puerta"]
  cat --> inv`,
  ru: `flowchart LR
  app["Веб- и мобильное приложение"] --> gw[API-шлюз]
  gw --> cat[Сервис каталога мероприятий]
  gw --> seats[(База мест в зале)]
  gw --> pay["Сервис оплаты"]
  pay --> queue[[Очередь заказов]]
  queue --> issue[Сервис выпуска электронных билетов]
  issue --> notif[Уведомления]
  issue --> scan["Сервис сканирования на входе"]
  cat --> seats`,
  zh: `flowchart LR
  app["网页和手机客户端"] --> gw[API 网关]
  gw --> cat[演出目录服务]
  gw --> seats[(座位库存数据库)]
  gw --> pay["下单支付服务"]
  pay --> queue[[订单队列]]
  queue --> issue[电子票出票服务]
  issue --> notif[通知服务]
  issue --> scan["入场验票服务"]
  cat --> seats`,
  ja: `flowchart LR
  app["Web・モバイルアプリ"] --> gw[APIゲートウェイ]
  gw --> cat[イベントカタログサービス]
  gw --> seats[(座席在庫データベース)]
  gw --> pay["決済サービス"]
  pay --> queue[[注文キュー]]
  queue --> issue[電子チケット発行サービス]
  issue --> notif[通知サービス]
  issue --> scan["入場スキャンサービス"]
  cat --> seats`,
};

const FLOW_SRC = {
  es: `flowchart TD
  sol[Llega la solicitud de reembolso] --> ver[Verificar la compra y el estado del evento]
  ver --> dec{"¿Cumple los requisitos?"}
  dec -->|Sí| op[Ofrecer reembolso o crédito]
  dec -->|No| rech[Rechazar y explicar el motivo]
  op --> proc[Procesar el reembolso o emitir el crédito]
  proc --> avis[Avisar al cliente por correo]
  rech --> avis`,
  ru: `flowchart TD
  req[Поступила заявка на возврат] --> chk[Проверить заказ и статус мероприятия]
  chk --> dec{"Возврат положен?"}
  dec -->|Да| offer[Предложить деньги или бонусный кредит]
  dec -->|Нет| deny[Отказать и объяснить причину]
  offer --> pay[Оформить возврат или начислить кредит]
  pay --> mail[Сообщить клиенту о результате]
  deny --> mail`,
  zh: `flowchart TD
  req[收到退票申请] --> chk[核对订单和演出状态]
  chk --> dec{"符合退票条件吗？"}
  dec -->|是| offer[让用户选退款或代金券]
  dec -->|否| deny[驳回并说明原因]
  offer --> pay[原路退款或发放代金券]
  pay --> msg[短信通知用户结果]
  deny --> msg`,
  ja: `flowchart TD
  req[払い戻し申請を受け付ける] --> chk[注文と公演の状況を確認する]
  chk --> dec{"払い戻しの対象か？"}
  dec -->|はい| offer[返金かクレジットを提案する]
  dec -->|いいえ| deny[お断りして理由を伝える]
  offer --> pay[返金またはクレジットを付与する]
  pay --> mail[お客様に結果をメールする]
  deny --> mail`,
};

const CHART = {
  es: { title: 'Entradas vendidas por canal de venta', x: 'Canal de venta', cats: ['Web', 'App móvil', 'Taquilla', 'Revendedores autorizados'], y: 'Entradas vendidas', series: 'Entradas' },
  ru: { title: 'Продано билетов по каналам продаж', x: 'Канал продаж', cats: ['Сайт', 'Мобильное приложение', 'Кассы', 'Партнёры'], y: 'Продано билетов', series: 'Билеты' },
  zh: { title: '各销售渠道售票量', x: '销售渠道', cats: ['官网', '小程序', '线下售票点', '代理商'], y: '售出票数', series: '票数' },
  ja: { title: '販売チャネル別チケット販売枚数', x: '販売チャネル', cats: ['公式サイト', 'アプリ', 'コンビニ', 'プレイガイド'], y: '販売枚数', series: '枚数' },
};

const fx = (lang, foreground) => ({ artifactId: 'design-1.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground, source: SRC[lang] });
const chartFx = (lang) => ({
  artifactId: 'chart-1.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true,
  source: JSON.stringify({ v: 1, type: 'bar', title: CHART[lang].title, x: { label: CHART[lang].x, values: CHART[lang].cats }, y: { label: CHART[lang].y }, series: [{ name: CHART[lang].series, values: [5400, 2100, 900, 1600], status: 'illustrative' }] }),
});
const flowFx = (lang) => ({ artifactId: 'flow-1.v1', artifact: 'mermaid', view: 'flowchart', version: 1, foreground: true, source: FLOW_SRC[lang] });

export const FIXTURES = {
  arch_es_fg: fx('es', true), arch_es_bg: fx('es', false),
  arch_ru_fg: fx('ru', true), arch_ru_bg: fx('ru', false),
  arch_zh_fg: fx('zh', true), arch_zh_bg: fx('zh', false),
  arch_ja_fg: fx('ja', true), arch_ja_bg: fx('ja', false),
  chart_es_fg: chartFx('es'), chart_ru_fg: chartFx('ru'), chart_zh_fg: chartFx('zh'), chart_ja_fg: chartFx('ja'),
  flow_es_fg: flowFx('es'), flow_ru_fg: flowFx('ru'), flow_zh_fg: flowFx('zh'), flow_ja_fg: flowFx('ja'),
};

const R = (id, lang, list, q, mode, ctx, expect, extra = {}) => ({ id, lang, list, q, mode, ctx, expect, ...extra });
const BL = { borderline: true };

export const ROWS = [
  // ───────────────────────────── SPANISH ─────────────────────────────
  // A — must draw, nothing on the table
  R('es-A01', 'es', 'A', 'oye, ¿me dibujas cómo va montado un servicio de vídeo en streaming tipo Netflix? el cliente, la CDN, el servicio de recomendaciones, la base de usuarios y el transcodificador', 'general', 'none', 'draw', { view: 'architecture' }),
  R('es-A02', 'es', 'A', 'a ver, ponme en cajitas con flechas los pasos para dar de alta a un proveedor: llega la solicitud, se valida el RFC, compras aprueba y se registra en el sistema', 'team-meet', 'none', 'draw', { view: 'flowchart' }),
  R('es-A03', 'es', 'A', 'che, haceme un gráfico de barras con las ventas del trimestre: enero 120, febrero 95 y marzo 140', 'sales', 'none', 'draw', { view: 'chart' }),
  R('es-A04', 'es', 'A', 'me regalas un cuadro comparativo entre PostgreSQL, MongoDB y DynamoDB por costo, escalabilidad y facilidad de consultas porfa', 'technical-interview', 'none', 'draw', { view: 'matrix' }),
  R('es-A05', 'es', 'A', 'ya po, ármame una línea de tiempo de la historia de internet, desde ARPANET hasta los smartphones, con los hitos principales', 'lecture', 'none', 'draw', { view: 'timeline' }),
  R('es-A06', 'es', 'A', 'mira, el entrevistador me acaba de preguntar por el login con OAuth y la verdad es que me lío al contarlo de palabra, así que mejor enséñame el diagrama de secuencia entre el usuario, la app, el servidor de autorización y la API', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('es-A07', 'es', 'A', 'Necesito el organigrama del equipo de soporte. Ponlo con los tres turnos y sus supervisores.', 'call-center', 'none', 'draw', { view: 'responsibility' }),
  R('es-A08', 'es', 'A', 'píntame los estados por los que pasa un pedido en una tienda online pendiente pagado enviado entregado devuelto y cómo se pasa de uno a otro', 'technical-interview', 'none', 'draw', { view: 'state' }),
  R('es-A09', 'es', 'A', '¿se podría ver en forma de árbol de decisión cuándo conviene alquilar y cuándo comprar piso, según los ahorros, el tipo de interés y los años que piensas quedarte?', 'general', 'none', 'draw', { view: 'decision' }),
  R('es-A10', 'es', 'A', 'ármame algo visual con el plan de lanzamiento del que venimos hablando, qué va primero, qué depende de qué y para cuándo', 'team-meet', 'none', 'draw'),
  // B — must not draw, nothing on the table
  R('es-B01', 'es', 'B', 'ayer le dibujé a Marta el diagrama de la base de datos en la pizarra y aun así no lo pilló', 'team-meet', 'none', 'nodraw'),
  R('es-B02', 'es', 'B', 'luego en casa hago yo el organigrama con calma y se lo mando al equipo el lunes', 'team-meet', 'none', 'nodraw'),
  R('es-B03', 'es', 'B', 'la jefa me pidió que le hiciera un gráfico de las ventas para el comité, ¿tú sabes a qué hora es el comité?', 'general', 'none', 'nodraw'),
  R('es-B04', 'es', 'B', '¿cómo pinta el trimestre que viene? porque el cliente no nos dibuja un panorama muy alentador que digamos', 'sales', 'none', 'nodraw'),
  R('es-B05', 'es', 'B', 'el cuadro que tienen colgado en recepción es un original o una copia', 'general', 'none', 'nodraw'),
  R('es-B06', 'es', 'B', 'el diagrama que mandó consultoría es un desastre, no se entiende nada y encima trae los colores del año pasado', 'team-meet', 'none', 'nodraw'),
  R('es-B07', 'es', 'B', '¿qué diferencia hay entre un diagrama de Gantt y un cronograma normal?', 'lecture', 'none', 'nodraw'),
  R('es-B08', 'es', 'B', 'qué modelo de portátil nos van a dar a los nuevos, ¿sabes si es el de catorce pulgadas?', 'recruiting', 'none', 'nodraw'),
  R('es-B09', 'es', 'B', 'qué fue lo que dijo Andrés hace un momento sobre el mapa de riesgos, ¿que lo actualizaban cada mes?', 'team-meet', 'none', 'nodraw'),
  R('es-B10', 'es', 'B', 'no me cargaba el mapa en el celular y terminé dando vueltas por todo Providencia, por eso llegué tarde, disculpen', 'general', 'none', 'nodraw'),
  // C — questions about the architecture on the table
  R('es-C01', 'es', 'C', '¿y por qué el pago pasa por una cola en vez de llamar directo a la emisión de entradas?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C02', 'es', 'C', 'qué pasa si se cae la pasarela, ¿se queda todo sin servicio?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C03', 'es', 'C', 'no entiendo esa flecha que va del catálogo al inventario, para qué necesita el catálogo hablar con los asientos', 'team-meet', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C04', 'es', 'C', 'en lo que nos mostraste hace un rato, ¿el escaneo en puerta funciona sin conexión o depende de que emisión le responda?', 'sales', 'arch_es_bg', 'claim', { op: 'explain' }),
  R('es-C05', 'es', 'C', 'oye y las notis quién las dispara, la cola o el servicio que emite las entradas', 'team-meet', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C06', 'es', 'C', 'explícame el recorrido completo desde que el fan le da a comprar hasta que le llega la entrada', 'sales', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C07', 'es', 'C', '¿cuál de todas esas cajas es el cuello de botella el día que sale a la venta una gira grande?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C08', 'es', 'C', 'volviendo al esquema de antes, ¿dónde quedaba guardado qué asientos están bloqueados mientras alguien paga?', 'technical-interview', 'arch_es_bg', 'claim', { op: 'explain' }),
  R('es-C09', 'es', 'C', 'entonces el checkout nunca toca el inventario directamente o me estoy perdiendo algo', 'team-meet', 'arch_es_fg', 'claim', { op: 'explain' }),
  // D — changes to the architecture on the table
  R('es-D01', 'es', 'D', 'ponle una caché delante del catálogo de eventos', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D02', 'es', 'D', 'quita las notificaciones, eso lo lleva un proveedor externo y no hace falta que salga', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D03', 'es', 'D', 'cámbiale el nombre a la pasarela, ponle API Gateway como le decimos nosotros', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D04', 'es', 'D', 'mira yo creo que para la demo del jueves convendría que entre el checkout y la cola metas un antifraude porque el cliente siempre pregunta por eso', 'sales', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D05', 'es', 'D', 'agregale una sala de espera virtual antes de la pasarela, para cuando hay mucha demanda', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D06', 'es', 'D', 'el inventario de asientos pártelo en dos: una base para lectura y otra para reservas', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D07', 'es', 'D', 'al diagrama de la arquitectura añádele un servicio de reventa conectado a la emisión de entradas', 'team-meet', 'arch_es_bg', 'claim', { op: 'update' }),
  R('es-D08', 'es', 'D', 'oye que el escaneo también debería mandar eventos a notificaciones, conecta esas dos', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D09', 'es', 'D', 'ponlo de arriba hacia abajo en vez de izquierda a derecha, que así no cabe en la pantalla', 'general', 'arch_es_fg', 'claim', { op: 'update' }),
  // E — a drawing is on the table, the sentence is about something else
  R('es-E01', 'es', 'E', '¿a qué hora abren las puertas el sábado? es que quiero llegar antes de que haya cola', 'general', 'arch_es_fg', 'noclaim'),
  R('es-E02', 'es', 'E', 'el de pagos me dijo que la nómina entra el viernes, así que tranquilos', 'team-meet', 'arch_es_fg', 'noclaim'),
  R('es-E03', 'es', 'E', 'qué dijo Lucía al principio sobre el presupuesto para el año que viene', 'team-meet', 'arch_es_fg', 'noclaim'),
  R('es-E04', 'es', 'E', 'me llegó la notificación de Hacienda justo en mitad de la reunión, qué susto', 'general', 'arch_es_bg', 'noclaim'),
  R('es-E05', 'es', 'E', 'el diagrama que hizo el equipo de Bogotá el mes pasado estaba mucho peor, ese sí que no había quien lo leyera', 'team-meet', 'arch_es_fg', 'noclaim', BL),
  R('es-E06', 'es', 'E', 'por cierto, ¿quién atiende la taquilla del teatro los domingos? porque fui y estaba cerrada', 'general', 'chart_es_fg', 'noclaim'),
  R('es-E07', 'es', 'E', 'se me colgó la app del banco otra vez, dame un segundo que entro por la web', 'sales', 'chart_es_fg', 'noclaim'),
  R('es-E08', 'es', 'E', 'el lunes preparo yo las gráficas del otro informe, el de recursos humanos, no te preocupes por eso', 'team-meet', 'chart_es_fg', 'noclaim'),
  R('es-E09', 'es', 'E', '¿a ti te devolvieron la plata del concierto de Shakira que cancelaron? a mí todavía nada', 'general', 'flow_es_fg', 'noclaim'),
  R('es-E10', 'es', 'E', 'me rechazaron el crédito del banco y ni me explicaron el motivo', 'call-center', 'flow_es_fg', 'noclaim'),
  // F — the bar chart is on the table
  R('es-F01', 'es', 'F', '¿por qué taquilla vende tan poquito comparado con la web?', 'sales', 'chart_es_fg', 'claim', { op: 'explain' }),
  R('es-F02', 'es', 'F', 'ordena las barras de mayor a menor y ponle los números encima', 'sales', 'chart_es_fg', 'claim', { op: 'update' }),
  R('es-F03', 'es', 'F', 'esto mismo pásamelo a una tabla, canal y entradas vendidas', 'sales', 'chart_es_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('es-F04', 'es', 'F', 'en la tabla vamos terceros, si ganamos el domingo quedamos punteros', 'general', 'chart_es_fg', 'noclaim'),
  // G — the refund flowchart is on the table
  R('es-G01', 'es', 'G', 'y si el evento solo se reprogramó, no se canceló, ¿por dónde sale en el rombo?', 'call-center', 'flow_es_fg', 'claim', { op: 'explain' }),
  R('es-G02', 'es', 'G', 'después de avisar al cliente agrégale un paso para cerrar el caso en el CRM', 'call-center', 'flow_es_fg', 'claim', { op: 'update' }),
  R('es-G03', 'es', 'G', 'acuérdate de avisar al cliente de Monterrey que la demo se pasa al jueves', 'sales', 'flow_es_fg', 'noclaim'),

  // ───────────────────────────── RUSSIAN ─────────────────────────────
  // A — must draw, nothing on the table
  R('ru-A01', 'ru', 'A', 'слушай, накидай-ка схему, как устроен обычный интернет-магазин: фронт, бэкенд, база товаров, корзина, оплата и доставка', 'general', 'none', 'draw', { view: 'architecture' }),
  R('ru-A02', 'ru', 'A', 'Будьте добры, изобразите в виде блок-схемы порядок согласования отпуска: заявление, виза руководителя, отдел кадров, приказ.', 'team-meet', 'none', 'draw', { view: 'flowchart' }),
  R('ru-A03', 'ru', 'A', 'построй столбики по выручке за квартал июль два миллиона август два и три сентябрь миллион восемь', 'sales', 'none', 'draw', { view: 'chart' }),
  R('ru-A04', 'ru', 'A', 'сведи в табличку питон, го и раст по скорости, порогу входа и экосистеме, чтобы наглядно было', 'technical-interview', 'none', 'draw', { view: 'matrix' }),
  R('ru-A05', 'ru', 'A', 'меня сейчас спросили про то как браузер открывает страницу и я чувствую что словами запутаюсь так что покажи лучше диаграмму последовательности браузер днс сервер и база', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('ru-A06', 'ru', 'A', 'можно мне на временной шкале основные вехи космической гонки, от первого спутника до высадки на Луну?', 'lecture', 'none', 'draw', { view: 'timeline' }),
  R('ru-A07', 'ru', 'A', 'давай разложим тему «подготовка к собеседованию» на майнд-карту: резюме, алгоритмы, системный дизайн, вопросы к компании', 'looking-for-work', 'none', 'draw', { view: 'mindmap' }),
  R('ru-A08', 'ru', 'A', 'Нарисуй ER-модель для библиотеки. Книги, читатели, выдачи, авторы — со связями.', 'technical-interview', 'none', 'draw', { view: 'er' }),
  R('ru-A09', 'ru', 'A', 'мне бы оргструктурку нашего отдела продаж, кто кому подчиняется', 'sales', 'none', 'draw', { view: 'responsibility' }),
  R('ru-A10', 'ru', 'A', 'а можно как-то картинкой показать, что у нас по срокам на следующий спринт?', 'team-meet', 'none', 'draw'),
  // B — must not draw, nothing on the table
  R('ru-B01', 'ru', 'B', 'у меня график два через два, так что в субботу я выйти не смогу', 'call-center', 'none', 'nodraw'),
  R('ru-B02', 'ru', 'B', 'это какая-то мутная схема с обналичкой, я бы в такое не лез', 'general', 'none', 'nodraw'),
  R('ru-B03', 'ru', 'B', 'я вчера уже нарисовал архитектуру на доске, Костя сфоткал и скинул в чат', 'team-meet', 'none', 'nodraw'),
  R('ru-B04', 'ru', 'B', 'диаграмму классов я сам вечером набросаю, сейчас не до неё', 'team-meet', 'none', 'nodraw'),
  R('ru-B05', 'ru', 'B', 'Она просила меня построить график продаж к пятнице, а я даже цифр ещё не получил', 'sales', 'none', 'nodraw'),
  R('ru-B06', 'ru', 'B', 'картина в целом вырисовывается невесёлая, клиент уходит к конкурентам', 'sales', 'none', 'nodraw'),
  R('ru-B07', 'ru', 'B', 'что такое диаграмма Исикавы, напомни в двух словах', 'lecture', 'none', 'nodraw'),
  R('ru-B08', 'ru', 'B', 'схема от подрядчика — просто ужас, стрелки во все стороны, шрифт мелкий, я ничего не разобрал', 'team-meet', 'none', 'nodraw'),
  R('ru-B09', 'ru', 'B', 'что там Ирина Петровна говорила про таблицу с бюджетом, к какому числу её надо сдать?', 'team-meet', 'none', 'nodraw'),
  R('ru-B10', 'ru', 'B', 'дочка весь вечер учила таблицу умножения, а потом мы с ней ещё рисовали до ночи, не выспался совсем', 'general', 'none', 'nodraw'),
  // C — questions about the architecture on the table
  R('ru-C01', 'ru', 'C', 'а где тут хранятся сами заказы, в очереди что ли? отдельной базы заказов я не вижу', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C02', 'ru', 'C', 'очередь заказов — это Кафка или что-то попроще, и что будет, если она забьётся?', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C03', 'ru', 'C', 'почему шлюз ходит в базу мест напрямую, а не через отдельный сервис?', 'team-meet', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C04', 'ru', 'C', 'на той схеме, что была до этого, уведомления — это почта, смс или пуши?', 'sales', 'arch_ru_bg', 'claim', { op: 'explain' }),
  R('ru-C05', 'ru', 'C', 'сканер на входе как понимает что билет настоящий он в сервис выпуска стучится', 'team-meet', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C06', 'ru', 'C', 'какие из этих сервисов без состояния, чтобы их можно было просто размножить под нагрузкой?', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C07', 'ru', 'C', 'Поясните, пожалуйста, какая часть этой схемы попадает под требования по защите платёжных данных.', 'sales', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C08', 'ru', 'C', 'вернёмся к архитектуре: а где там авторизация, я её что-то не вижу', 'technical-interview', 'arch_ru_bg', 'claim', { op: 'explain' }),
  R('ru-C09', 'ru', 'C', 'так это по сути монолит с очередью или реально отдельные сервисы', 'general', 'arch_ru_fg', 'claim', { op: 'explain' }),
  // D — changes to the architecture on the table
  R('ru-D01', 'ru', 'D', 'добавь сервис авторизации, пусть шлюз сначала идёт в него', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D02', 'ru', 'D', 'приложение разбей на два квадратика, веб отдельно, мобилка отдельно', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D03', 'ru', 'D', 'подпиши стрелки, где у нас обычный HTTP, а где сообщения через очередь', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D04', 'ru', 'D', 'я вот думаю, раз уж заказчик всё время спрашивает про отчёты, пририсуй хранилище для аналитики и заведи в него события из очереди заказов, чтобы на демо было видно', 'sales', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D05', 'ru', 'D', 'рядом с очередью заказов поставь очередь для упавших сообщений, DLQ', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D06', 'ru', 'D', 'в архитектурную схему допишите ещё балансировщик нагрузки перед шлюзом', 'team-meet', 'arch_ru_bg', 'claim', { op: 'update' }),
  R('ru-D07', 'ru', 'D', 'стрелочку от каталога к базе мест убери, она тут лишняя', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D08', 'ru', 'D', 'Просьба объединить сервисы оплаты, выпуска билетов и уведомлений в один блок с подписью «Обработка заказа».', 'sales', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D09', 'ru', 'D', 'выдели цветом всё, что не наше, ну то есть оплату и уведомлялку', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  // E — a drawing is on the table, the sentence is about something else
  R('ru-E01', 'ru', 'E', 'в столовой сегодня такая очередь была, что я без обеда остался', 'general', 'arch_ru_fg', 'noclaim'),
  R('ru-E02', 'ru', 'E', 'оплата за садик прошла? а то мне уведомление так и не пришло', 'general', 'arch_ru_fg', 'noclaim'),
  R('ru-E03', 'ru', 'E', 'кстати, а на собесе в Яндексе тоже просят такие схемы рисовать или там только код спрашивают?', 'looking-for-work', 'arch_ru_fg', 'noclaim', BL),
  R('ru-E04', 'ru', 'E', 'у меня на входе в бизнес-центр пропуск опять не сканируется, пришлось охрану звать', 'general', 'arch_ru_bg', 'noclaim'),
  R('ru-E05', 'ru', 'E', 'я потом сам перерисую это в фигме для презентации, не заморачивайся', 'team-meet', 'arch_ru_fg', 'noclaim', BL),
  R('ru-E06', 'ru', 'E', 'какая у тебя модель телефона, приложение банка на нём не тормозит?', 'general', 'chart_ru_fg', 'noclaim'),
  R('ru-E07', 'ru', 'E', 'партнёры из Казани прилетают в четверг, кто их встречает?', 'sales', 'chart_ru_fg', 'noclaim'),
  R('ru-E08', 'ru', 'E', 'график отпусков на лето уже утвердили или ещё можно поменяться?', 'team-meet', 'chart_ru_fg', 'noclaim'),
  R('ru-E09', 'ru', 'E', 'мне вчера банк в кредите отказал и даже причину не объяснил, представляешь', 'general', 'flow_ru_fg', 'noclaim'),
  R('ru-E10', 'ru', 'E', 'а Лёша заявку на отпуск подал уже, не знаешь?', 'team-meet', 'flow_ru_fg', 'noclaim'),
  // F — the bar chart is on the table
  R('ru-F01', 'ru', 'F', 'сколько всего продано, если сложить все четыре канала, и какая доля у сайта?', 'sales', 'chart_ru_fg', 'claim', { op: 'explain' }),
  R('ru-F02', 'ru', 'F', 'добавь рядом столбики за прошлый год: сайт 4800, приложение 1500, кассы 1400, партнёры 1700', 'sales', 'chart_ru_fg', 'claim', { op: 'update' }),
  R('ru-F03', 'ru', 'F', 'а можно то же самое таблицей, канал и сколько продано?', 'sales', 'chart_ru_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ru-F04', 'ru', 'F', 'сайт госуслуг опять лежит, не могу запись к врачу оформить', 'general', 'chart_ru_fg', 'noclaim'),
  // G — the refund flowchart is on the table
  R('ru-G01', 'ru', 'G', 'почему при отказе мы всё равно идём в «сообщить клиенту», а не заканчиваем сразу?', 'call-center', 'flow_ru_fg', 'claim', { op: 'explain' }),
  R('ru-G02', 'ru', 'G', 'переименуй «бонусный кредит» в «сертификат», у нас так в договоре написано', 'call-center', 'flow_ru_fg', 'claim', { op: 'update' }),
  R('ru-G03', 'ru', 'G', 'Марина, заказ пропусков для гостей мероприятия кто проверяет — вы или охрана?', 'team-meet', 'flow_ru_fg', 'noclaim'),

  // ───────────────────────────── CHINESE ─────────────────────────────
  // A — must draw, nothing on the table
  R('zh-A01', 'zh', 'A', '你给我画个图呗，就一般外卖平台那套：用户端、商家端、骑手端，后面是订单服务、派单服务和支付', 'general', 'none', 'draw', { view: 'architecture' }),
  R('zh-A02', 'zh', 'A', '报销流程画一下：提交单据→主管审批→财务审核→打款', 'team-meet', 'none', 'draw', { view: 'flowchart' }),
  R('zh-A03', 'zh', 'A', '帮我出个柱状图，一月销量三百二，二月两百八，三月四百一', 'sales', 'none', 'draw', { view: 'chart' }),
  R('zh-A04', 'zh', 'A', '把 MySQL、Redis、MongoDB 列个表对比一下，从读写性能、一致性、适用场景三个方面', 'technical-interview', 'none', 'draw', { view: 'matrix' }),
  R('zh-A05', 'zh', 'A', '面试官刚问我微信扫码登录是怎么回事，我嘴上讲不清楚，你能不能用时序图把手机、网页、服务器这三方的交互给我摆出来', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('zh-A06', 'zh', 'A', '可不可以帮我整理一条时间线，讲中国高铁从2008年京津城际到现在的发展，几个关键节点标出来就好啦', 'lecture', 'none', 'draw', { view: 'timeline' }),
  R('zh-A07', 'zh', 'A', '订单状态机长什么样？待支付、已支付、已发货、已完成、已取消，怎么流转的，画出来看看', 'technical-interview', 'none', 'draw', { view: 'state' }),
  R('zh-A08', 'zh', 'A', '咱们项目组谁负责啥，弄个分工图吧', 'team-meet', 'none', 'draw', { view: 'responsibility' }),
  R('zh-A09', 'zh', 'A', '我在纠结要不要跳槽。给我做个决策树，按薪资涨幅、通勤时间、成长空间来分。', 'looking-for-work', 'none', 'draw', { view: 'decision' }),
  R('zh-A10', 'zh', 'A', '有没有办法把“如何准备产品经理面试”拆成一张脑图，简历、案例、行业认知、反问环节这几块', 'looking-for-work', 'none', 'draw', { view: 'mindmap' }),
  // B — must not draw, nothing on the table
  R('zh-B01', 'zh', 'B', '老板又在画饼了，说年底人人有期权，谁信啊', 'general', 'none', 'nodraw'),
  R('zh-B02', 'zh', 'B', '这事儿得走流程，先填表再找领导签字，急不来', 'team-meet', 'none', 'nodraw'),
  R('zh-B03', 'zh', 'B', '上周五的评审会上我已经把拓扑图画给客户看过了，他们没什么意见', 'sales', 'none', 'nodraw'),
  R('zh-B04', 'zh', 'B', '图表我回头自己用 Excel 弄，今天先把数据对一遍', 'team-meet', 'none', 'nodraw'),
  R('zh-B05', 'zh', 'B', '领导让我画个甘特图周一交，我连任务都还没拆呢，烦死了', 'general', 'none', 'nodraw'),
  R('zh-B06', 'zh', 'B', '外包给的那张流程图乱七八糟的，箭头都连错了，根本没法看', 'team-meet', 'none', 'nodraw'),
  R('zh-B07', 'zh', 'B', '泳道图和普通流程图到底有啥区别啊', 'lecture', 'none', 'nodraw'),
  R('zh-B08', 'zh', 'B', '高德地图上显示公司附近新开了家湖南菜，中午要不要去试试', 'general', 'none', 'nodraw'),
  R('zh-B09', 'zh', 'B', '刚才王总说的那个模型上线时间是几号来着', 'team-meet', 'none', 'nodraw'),
  R('zh-B10', 'zh', 'B', '你说他这么拼图什么呢，不就图个年终奖嘛', 'general', 'none', 'nodraw'),
  // C — questions about the architecture on the table
  R('zh-C01', 'zh', 'C', '目录服务和座位库存为什么要分开，放一个库里不行吗', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C02', 'zh', 'C', '搜索是哪个服务在管？图上好像没单独画', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C03', 'zh', 'C', '出票服务同时连着通知和验票，这两条线传的是一样的东西吗', 'team-meet', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C04', 'zh', 'C', '回到前面那张架构图，要是想支持把票加到手机钱包，现在还缺哪一块', 'sales', 'arch_zh_bg', 'claim', { op: 'explain' }),
  R('zh-C05', 'zh', 'C', '图上这些箭头表示的是调用方向还是数据流向', 'team-meet', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C06', 'zh', 'C', '座位库存这个库里具体存些什么，是每个座位一条记录吗', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C07', 'zh', 'C', '如果只做最小可用版本，这里面哪几个框可以先不做', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C08', 'zh', 'C', '之前那个图里，下单支付后面接的是什么来着，是直接到出票吗', 'team-meet', 'arch_zh_bg', 'claim', { op: 'explain' }),
  R('zh-C09', 'zh', 'C', '网关除了转发请求还干别的吗，比如限流鉴权这些', 'sales', 'arch_zh_fg', 'claim', { op: 'explain' }),
  // D — changes to the architecture on the table
  R('zh-D01', 'zh', 'D', '在客户端前面加个 CDN', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D02', 'zh', 'D', '支付后面再画一个支付宝微信的框。标成外部的。', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D03', 'zh', 'D', '给验票加个本地缓存，断网的时候也能验', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D04', 'zh', 'D', '给座位加个 Redis 锁座，放在网关和座位库存中间', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D05', 'zh', 'D', '订单队列后面再加一个消费者，专门给主办方结算用的', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D06', 'zh', 'D', '架构图上把“下单支付服务”拆开，下单一个框，支付一个框', 'team-meet', 'arch_zh_bg', 'claim', { op: 'update' }),
  R('zh-D07', 'zh', 'D', '通知那里注明一下是短信加微信模板消息', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D08', 'zh', 'D', '客户老问对账怎么做，我觉得支付后面得补一个对账服务，每天跟队列里的订单核一遍，你给加上哈', 'sales', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D09', 'zh', 'D', '目录到座位库存那条线方向反了吧，应该是库存推给目录，帮我调过来', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  // E — a drawing is on the table, the sentence is about something else
  R('zh-E01', 'zh', 'E', '今天下单的奶茶还没到，订单显示还在排队', 'general', 'arch_zh_fg', 'noclaim'),
  R('zh-E02', 'zh', 'E', '你收到人事的通知没有，说下周一调休', 'team-meet', 'arch_zh_fg', 'noclaim'),
  R('zh-E03', 'zh', 'E', '王工让我回头把这图发他一份，他邮箱是多少来着', 'team-meet', 'arch_zh_fg', 'noclaim', BL),
  R('zh-E04', 'zh', 'E', '周末去看演出我的座位在二楼，离舞台有点远', 'general', 'arch_zh_bg', 'noclaim'),
  R('zh-E05', 'zh', 'E', '画图我是真不行，上学的时候美术课就没及格过', 'general', 'arch_zh_fg', 'noclaim'),
  R('zh-E06', 'zh', 'E', '官网上说周六体检，你报名了吗', 'general', 'chart_zh_fg', 'noclaim'),
  R('zh-E07', 'zh', 'E', '我们的代理商王总明天几点到，谁去机场接', 'sales', 'chart_zh_fg', 'noclaim'),
  R('zh-E08', 'zh', 'E', '小程序开发那个岗位招到人了吗', 'recruiting', 'chart_zh_fg', 'noclaim'),
  R('zh-E09', 'zh', 'E', '我上个月的报销被驳回了，财务也不说原因，真无语', 'general', 'flow_zh_fg', 'noclaim'),
  R('zh-E10', 'zh', 'E', '代金券今天过期，谁要喝咖啡我请', 'general', 'flow_zh_fg', 'noclaim'),
  // F — the bar chart is on the table
  R('zh-F01', 'zh', 'F', '官网为什么比其他几个加起来还多？', 'sales', 'chart_zh_fg', 'claim', { op: 'explain' }),
  R('zh-F02', 'zh', 'F', '纵轴改成百分比，别用绝对数', 'sales', 'chart_zh_fg', 'claim', { op: 'update' }),
  R('zh-F03', 'zh', 'F', '这个能不能换成表格给我，渠道一列票数一列', 'sales', 'chart_zh_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('zh-F04', 'zh', 'F', '今年销售渠道的年会定在哪儿开，有人知道吗', 'sales', 'chart_zh_fg', 'noclaim'),
  // G — the refund flowchart is on the table
  R('zh-G01', 'zh', 'G', '“核对订单和演出状态”这一步是人工做还是系统自动的', 'call-center', 'flow_zh_fg', 'claim', { op: 'explain' }),
  R('zh-G02', 'zh', 'G', '在退款那步后面加个判断，超过七天没到账就自动升级给主管', 'call-center', 'flow_zh_fg', 'claim', { op: 'update' }),
  R('zh-G03', 'zh', 'G', '我自己网购那个订单的退款到现在都没到账，客服一直让我等', 'general', 'flow_zh_fg', 'noclaim'),

  // ───────────────────────────── JAPANESE ─────────────────────────────
  // A — must draw, nothing on the table
  R('ja-A01', 'ja', 'A', 'フードデリバリーのシステム構成ざっくり図にしてくれる？注文アプリ、店舗側、配達員アプリ、マッチング、決済あたりで', 'general', 'none', 'draw', { view: 'architecture' }),
  R('ja-A02', 'ja', 'A', '恐れ入りますが、経費精算の流れをフローチャートにまとめていただけますか。申請、上長承認、経理チェック、振込の順でお願いします。', 'team-meet', 'none', 'draw', { view: 'flowchart' }),
  R('ja-A03', 'ja', 'A', '四半期の売上、棒グラフにしてくれへん？4月が120万、5月が95万、6月が140万やねん', 'sales', 'none', 'draw', { view: 'chart' }),
  R('ja-A04', 'ja', 'A', 'ReactとVueとSvelteを学習コスト、パフォーマンス、エコシステムで比較表にして', 'technical-interview', 'none', 'draw', { view: 'matrix' }),
  R('ja-A05', 'ja', 'A', 'いま面接でECサイトの注文から発送までの連携を聞かれてて口だと絶対こんがらがるから、ユーザー、注文サービス、在庫、配送のやりとりをシーケンス図で出してもらえると助かる', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('ja-A06', 'ja', 'A', '日本の元号を明治から令和まで年表にしてほしいんですけど、主な出来事も一つずつ添えて', 'lecture', 'none', 'draw', { view: 'timeline' }),
  R('ja-A07', 'ja', 'A', '引っ越しの段取りをガントチャートで見たい。見積もり1週目、荷造り2〜3週目、手続き3週目、搬入4週目。', 'general', 'none', 'draw', { view: 'gantt' }),
  R('ja-A08', 'ja', 'A', 'クラス図書いて 動物が親でイヌとネコが継承してて それぞれ鳴くメソッド持ってるやつ', 'technical-interview', 'none', 'draw', { view: 'class' }),
  R('ja-A09', 'ja', 'A', 'うちの営業部の体制図、誰が誰の下かわかるやつ出せます？', 'sales', 'none', 'draw', { view: 'responsibility' }),
  R('ja-A10', 'ja', 'A', 'さっきから話してるリリースまでの段取り、ぱっと見てわかる形にならんかな', 'team-meet', 'none', 'draw', BL),
  // B — must not draw, nothing on the table
  R('ja-B01', 'ja', 'B', 'その計画、正直絵に描いた餅やと思うで、人も予算も足りてへんし', 'team-meet', 'none', 'nodraw'),
  R('ja-B02', 'ja', 'B', '今週のヒットチャート見た？あのバンド3週連続1位らしいよ', 'general', 'none', 'nodraw'),
  R('ja-B03', 'ja', 'B', '構成図は昨日の定例でホワイトボードに描いて説明済みです', 'team-meet', 'none', 'nodraw'),
  R('ja-B04', 'ja', 'B', 'ER図はあとで自分で起こすんで、今は要件の確認だけさせてください', 'technical-interview', 'none', 'nodraw'),
  R('ja-B05', 'ja', 'B', '部長にグラフ作っといてって言われたんですけど、締め切りっていつでしたっけ', 'team-meet', 'none', 'nodraw'),
  R('ja-B06', 'ja', 'B', 'ベンダーさんが送ってきたフロー図、矢印がぐちゃぐちゃで全然読めなかったんですよね', 'team-meet', 'none', 'nodraw'),
  R('ja-B07', 'ja', 'B', 'ユースケース図ってそもそも何を表すものなんですか', 'lecture', 'none', 'nodraw'),
  R('ja-B08', 'ja', 'B', '図書館で借りた本、今日が返却日なのすっかり忘れてた', 'general', 'none', 'nodraw'),
  R('ja-B09', 'ja', 'B', 'さっき田中さんが言ってたモデルの精度って何パーセントでしたっけ', 'team-meet', 'none', 'nodraw'),
  R('ja-B10', 'ja', 'B', 'あいつ最近ちょっと図に乗ってるよな、契約一本取っただけなのに', 'sales', 'none', 'nodraw'),
  // C — questions about the architecture on the table
  R('ja-C01', 'ja', 'C', 'この中で外部のサービスを使ってる箱ってどれとどれですか', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C02', 'ja', 'C', 'アプリからいきなり決済に行くことはなくて、必ずゲートウェイ通るってこと？', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C03', 'ja', 'C', '注文キューだけ箱の形ちゃうけど、あれ何か意味あるん', 'team-meet', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C04', 'ja', 'C', '先ほどの構成図ですが、電子チケット発行サービスが止まった場合、すでに決済が済んだ注文はどうなる想定でしょうか', 'sales', 'arch_ja_bg', 'claim', { op: 'explain' }),
  R('ja-C05', 'ja', 'C', 'これ一回チケット買うのにサービスいくつ通るの 数えてみて', 'team-meet', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C06', 'ja', 'C', '通知サービスって発行からしか呼ばれてないけど、公演中止のお知らせとかはどこから出すんですか', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C07', 'ja', 'C', '在庫DBのところ、これはRDBのつもりですか、それともKVS？', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C08', 'ja', 'C', 'さっきの図に戻るけど、主催者さんが公演を登録する画面ってどこにつながるんやったっけ', 'team-meet', 'arch_ja_bg', 'claim', { op: 'explain' }),
  R('ja-C09', 'ja', 'C', 'この構成で一番お金がかかりそうなのってどの部分ですか', 'sales', 'arch_ja_fg', 'claim', { op: 'explain' }),
  // D — changes to the architecture on the table
  R('ja-D01', 'ja', 'D', 'モニタリング用の箱を一個足して、全部のサービスからログが流れる感じにして', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D02', 'ja', 'D', '座席在庫データベースの横に、注文履歴用のデータベースを追加していただけますか', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D03', 'ja', 'D', '発行サービスと入場スキャンの間の線に「QRコード」ってラベルつけといて', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D04', 'ja', 'D', '先方から転売対策を毎回聞かれるので、発行サービスの隣に本人確認の仕組みを一つ入れておきたいです', 'sales', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D05', 'ja', 'D', '注文キューを通常用と先行抽選用の二本に分けてもらえますか', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D06', 'ja', 'D', '構成図のほうに、主催者向けの管理画面を追加してカタログとつないでおいてください', 'team-meet', 'arch_ja_bg', 'claim', { op: 'update' }),
  R('ja-D07', 'ja', 'D', '決済から座席在庫に「席を確定」って矢印を一本足しといて', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D08', 'ja', 'D', 'カタログの横に検索用のElasticsearch置いといてくれへん？ゲートウェイからも線つないでな', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D09', 'ja', 'D', 'あと図のタイトルつけてほしい、「チケット販売システム全体像」で', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  // E — a drawing is on the table, the sentence is about something else
  R('ja-E01', 'ja', 'E', 'スマホの通知がうるさくて集中できへんわ、アプリ消そかな', 'general', 'arch_ja_fg', 'noclaim'),
  R('ja-E02', 'ja', 'E', '来週のイベント、座席ってもう決まってましたっけ、社員総会のやつです', 'team-meet', 'arch_ja_fg', 'noclaim'),
  R('ja-E03', 'ja', 'E', '冒頭で佐藤さんが言ってた納期の話、結局いつまでって言ってました？', 'team-meet', 'arch_ja_fg', 'noclaim'),
  R('ja-E04', 'ja', 'E', '入場のとき社員証かざしても反応せえへんかってん、また再発行やわ', 'general', 'arch_ja_bg', 'noclaim'),
  R('ja-E05', 'ja', 'E', 'カードの決済、昨日の飲み会の分まだ落ちてないんだけど割り勘どうする', 'general', 'arch_ja_fg', 'noclaim'),
  R('ja-E06', 'ja', 'E', '帰りにコンビニ寄るけど何かいる？', 'general', 'chart_ja_fg', 'noclaim'),
  R('ja-E07', 'ja', 'E', '公式サイトの採用ページ、いつ更新されるか人事から聞いてます？', 'recruiting', 'chart_ja_fg', 'noclaim'),
  R('ja-E08', 'ja', 'E', 'グラフといえば、うちの子の夏休みの自由研究、朝顔の観察グラフやってん', 'general', 'chart_ja_fg', 'noclaim'),
  R('ja-E09', 'ja', 'E', '有給の申請って誰に出せばいいんでしたっけ、課長？', 'team-meet', 'flow_ja_fg', 'noclaim'),
  R('ja-E10', 'ja', 'E', 'この前の飲み会のお金、まだ返金してもらってないんやけど', 'general', 'flow_ja_fg', 'noclaim'),
  // F — the bar chart is on the table
  R('ja-F01', 'ja', 'F', 'アプリとプレイガイドを足しても公式サイトには届かない感じですか', 'sales', 'chart_ja_fg', 'claim', { op: 'explain' }),
  R('ja-F02', 'ja', 'F', '棒の色をチャネルごとに変えて、凡例もつけて', 'sales', 'chart_ja_fg', 'claim', { op: 'update' }),
  R('ja-F03', 'ja', 'F', 'これ表にしてもらっていい？チャネルと枚数だけで', 'sales', 'chart_ja_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ja-F04', 'ja', 'F', 'アプリのアップデート来てたから入れたら、スマホめっちゃ重たなったわ', 'general', 'chart_ja_fg', 'noclaim'),
  // G — the refund flowchart is on the table
  R('ja-G01', 'ja', 'G', '「返金かクレジットを提案する」のところ、選ぶのはお客様側ですか、こちら側ですか', 'call-center', 'flow_ja_fg', 'claim', { op: 'explain' }),
  R('ja-G02', 'ja', 'G', '「お断り」で終わりじゃなくて、そのあとに異議申し立ての窓口を案内するステップを足してください', 'call-center', 'flow_ja_fg', 'claim', { op: 'update' }),
  R('ja-G03', 'ja', 'G', 'お客様へのメール、来週の訪問日程の件はもう送りました？', 'sales', 'flow_ja_fg', 'noclaim'),
];
