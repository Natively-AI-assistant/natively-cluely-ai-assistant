// Independent measurement set #4 for resolveDiagramRequest — es / ru / zh / ja.
// Written and labelled BEFORE the function was run on any of these sentences,
// by an author who has never read the rules under test.
// Labels = what a sensible listener in the meeting would expect.
//
// Fixture domain: an online grocery with home delivery.

const SRC = {
  es: `flowchart LR
  app[App del cliente] --> gw["API Gateway"]
  gw --> ped[Servicio de pedidos]
  ped --> cat[(Base de datos de catálogo y stock)]
  ped --> pago["Servicio de pagos"]
  ped --> cola[[Cola de pedidos]]
  cola --> prep[Servicio de preparación en almacén]
  prep --> rep["Asignación de repartidores"]
  rep --> notif[Notificaciones]
  ped --> notif`,
  ru: `flowchart LR
  app[Приложение клиента] --> gw["API-шлюз"]
  gw --> ord[Сервис заказов]
  ord --> db[(База каталога и остатков)]
  ord --> pay["Платёжный сервис"]
  ord --> q[[Очередь заказов]]
  q --> pick[Сервис сборки на складе]
  pick --> disp["Диспетчер курьеров"]
  disp --> ntf[Уведомления]
  ord --> ntf`,
  zh: `flowchart LR
  app[用户App] --> gw["API网关"]
  gw --> ord[订单服务]
  ord --> db[(商品库存数据库)]
  ord --> pay["支付服务"]
  ord --> mq[[订单消息队列]]
  mq --> pick[仓库拣货服务]
  pick --> disp["骑手调度"]
  disp --> ntf[通知服务]
  ord --> ntf`,
  ja: `flowchart LR
  app[お客様アプリ] --> gw["APIゲートウェイ"]
  gw --> ord[注文サービス]
  ord --> db[(商品・在庫データベース)]
  ord --> pay["決済サービス"]
  ord --> mq[[注文キュー]]
  mq --> pick[倉庫ピッキングサービス]
  pick --> disp["配達員の手配"]
  disp --> ntf[通知サービス]
  ord --> ntf`,
};

const FLOW_SRC = {
  es: `flowchart TD
  a[El preparador detecta que falta un producto] --> b["Buscar un sustituto parecido"]
  b --> c{"¿El cliente acepta el sustituto?"}
  c -->|Sí| d[Añadir el sustituto al pedido]
  c -->|No| e["Reembolsar el producto"]
  d --> f[Cerrar la preparación y avisar al repartidor]
  e --> f`,
  ru: `flowchart TD
  a[Сборщик не нашёл товар на полке] --> b["Подобрать похожую замену"]
  b --> c{"Клиент согласен на замену?"}
  c -->|Да| d[Добавить замену в заказ]
  c -->|Нет| e["Вернуть деньги за товар"]
  d --> f[Завершить сборку и передать курьеру]
  e --> f`,
  zh: `flowchart TD
  a[拣货员发现商品缺货] --> b["寻找相似替代品"]
  b --> c{"顾客接受替代品吗?"}
  c -->|是| d[把替代品加入订单]
  c -->|否| e["退还该商品的款项"]
  d --> f[完成拣货并通知骑手]
  e --> f`,
  ja: `flowchart TD
  a[ピッキング担当が欠品に気づく] --> b["似た代替品を探す"]
  b --> c{"お客様は代替品でよいか?"}
  c -->|はい| d[代替品を注文に追加する]
  c -->|いいえ| e["欠品分を返金する"]
  d --> f[梱包を完了して配達員に渡す]
  e --> f`,
};

const CHART = {
  es: { title: 'Pedidos semanales por franja de entrega', x: 'Franja horaria', cats: ['Mañana', 'Mediodía', 'Tarde', 'Noche'], y: 'Pedidos', series: 'Pedidos por semana' },
  ru: { title: 'Заказы за неделю по интервалам доставки', x: 'Интервал доставки', cats: ['Утро', 'День', 'Вечер', 'Ночь'], y: 'Заказы', series: 'Заказов в неделю' },
  zh: { title: '各配送时段每周订单量', x: '配送时段', cats: ['上午', '中午', '下午', '晚上'], y: '订单数', series: '每周订单' },
  ja: { title: '配達時間帯別の週間注文数', x: '配達時間帯', cats: ['午前', '昼', '夕方', '夜'], y: '注文数', series: '週間注文' },
};

const fx = (lang, foreground) => ({ artifactId: 'design-1.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground, source: SRC[lang] });
const chartFx = (lang) => ({
  artifactId: 'chart-1.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true,
  source: JSON.stringify({ v: 1, type: 'bar', title: CHART[lang].title, x: { label: CHART[lang].x, values: CHART[lang].cats }, y: { label: CHART[lang].y }, series: [{ name: CHART[lang].series, values: [140, 95, 210, 160], status: 'illustrative' }] }),
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
  R('es-A01', 'es', 'A', 'píntame cómo se conectan las piezas de un sistema de reservas de vuelos, con la caché y el balanceador de carga', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('es-A02', 'es', 'A', 'che armame un diagrama de flujo de cómo se aprueba una solicitud de vacaciones', 'team-meet', 'none', 'draw', { view: 'flowchart' }),
  R('es-A03', 'es', 'A', 'me vendría bien ver en una tabla la comparación entre el plan básico y el premium', 'sales', 'none', 'draw', { view: 'matrix' }),
  R('es-A04', 'es', 'A', 'podés hacerme una línea de tiempo con los hitos del lanzamiento desde enero hasta junio', 'team-meet', 'none', 'draw', { view: 'timeline' }),
  R('es-A05', 'es', 'A', 'a ver quiero un organigrama del área de producto con quién reporta a quién', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('es-A06', 'es', 'A', 'bueno después de todo lo que hablamos de la migración estaría bueno que me muestres en un gráfico de barras las ventas por trimestre del año pasado', 'sales', 'none', 'draw', { view: 'chart' }),
  R('es-A07', 'es', 'A', 'Hazme un diagrama de secuencia del login con doble factor entre el navegador, el servidor y el proveedor de SMS.', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('es-A08', 'es', 'A', 'necesito un mapa mental con las ideas principales de la clase sobre la revolución industrial', 'lecture', 'none', 'draw', { view: 'mindmap' }),
  R('es-A09', 'es', 'A', 'no me lo cuentes con palabras mostrámelo en un esquema cómo viaja un mensaje desde mi teléfono hasta el del otro', 'general', 'none', 'draw'),
  R('es-A10', 'es', 'A', 'armemos un árbol de decisión para ver si nos conviene alquilar o comprar la oficina', 'general', 'none', 'draw', { view: 'decision' }),
  // B — must not draw, nothing on the table
  R('es-B01', 'es', 'B', 'ayer Marta dibujó el diagrama en la pizarra y nadie lo entendió', 'team-meet', 'none', 'nodraw'),
  R('es-B02', 'es', 'B', 'de todo esto saco la conclusión de que el modelo de precios no nos sirve', 'sales', 'none', 'nodraw'),
  R('es-B03', 'es', 'B', 'mi hijo todavía no se sabe la tabla del siete y tiene examen el jueves', 'general', 'none', 'nodraw'),
  R('es-B04', 'es', 'B', 'el sorteo de la lotería es el sábado y todavía no compré el número', 'general', 'none', 'nodraw'),
  R('es-B05', 'es', 'B', '¿Qué dijo Lucía sobre el diagrama de arquitectura en la reunión del lunes?', 'team-meet', 'none', 'nodraw'),
  R('es-B06', 'es', 'B', 'abrí Google Maps y el mapa me mandó por una calle cortada', 'general', 'none', 'nodraw'),
  R('es-B07', 'es', 'B', 'en contabilidad nos pidieron actualizar el cuadro de cuentas antes del cierre del mes', 'team-meet', 'none', 'nodraw'),
  R('es-B08', 'es', 'B', 'eso que te ofrecieron suena a esquema piramidal yo no metería plata ahí', 'looking-for-work', 'none', 'nodraw'),
  R('es-B09', 'es', 'B', 'en mi último trabajo yo era quien hacía los diagramas de flujo para el equipo de operaciones', 'looking-for-work', 'none', 'nodraw'),
  R('es-B10', 'es', 'B', 'cuál es la diferencia entre un diagrama de secuencia y uno de flujo', 'lecture', 'none', 'nodraw', BL),
  // C — question about the architecture on the table
  R('es-C01', 'es', 'C', 'por qué el servicio de pedidos habla directo con pagos y no pasa por la cola', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C02', 'es', 'C', '¿Qué pasa si se cae la cola? ¿Se pierden los pedidos?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C03', 'es', 'C', 'explicame para qué está el gateway ahí adelante', 'team-meet', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C04', 'es', 'C', 'y lo del almacén cómo se entera de que hay un pedido nuevo', 'general', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C05', 'es', 'C', 'cuál de estas cajas es el cuello de botella en hora pico', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C06', 'es', 'C', 'volviendo al diagrama de antes, quién le avisa al cliente cuando sale el repartidor', 'sales', 'arch_es_bg', 'claim', { op: 'explain' }),
  R('es-C07', 'es', 'C', 'en el esquema de arquitectura que vimos hace un rato la base de stock la consulta solo pedidos o también preparación', 'team-meet', 'arch_es_bg', 'claim', { op: 'explain' }),
  R('es-C08', 'es', 'C', 'no entiendo la flecha que va de pedidos a notificaciones, qué se manda por ahí', 'lecture', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C09', 'es', 'C', 'esto aguanta el Black Friday o se nos cae por la base de datos', 'sales', 'arch_es_fg', 'claim', { op: 'explain' }),
  // D — change to the architecture on the table
  R('es-D01', 'es', 'D', 'agregale un caché entre el gateway y el servicio de pedidos', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D02', 'es', 'D', 'quita las notificaciones, por ahora no las vamos a hacer', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D03', 'es', 'D', 'cámbiale el nombre a la cola y ponle Kafka', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D04', 'es', 'D', 'falta un servicio de promociones conectado a pedidos, añádelo', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D05', 'es', 'D', 'separá la base en dos una para catálogo y otra para stock', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D06', 'es', 'D', 'que pagos también mande un evento a la cola cuando se confirma el cobro', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D07', 'es', 'D', 'pon un balanceador delante del gateway y duplica el servicio de pedidos', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D08', 'es', 'D', 'en el diagrama de antes, el de la arquitectura, sacá la asignación de repartidores y poné un proveedor externo de logística', 'sales', 'arch_es_bg', 'claim', { op: 'update' }),
  R('es-D09', 'es', 'D', 'mejor que la app no pase por el gateway para ver el catálogo, que vaya contra una CDN', 'team-meet', 'arch_es_fg', 'claim', { op: 'update', ...BL }),
  // E — a drawing is on the table, the sentence is about something else
  R('es-E01', 'es', 'E', 'quién lleva pagos en tu equipo, sigue siendo Andrés', 'recruiting', 'arch_es_fg', 'noclaim', BL),
  R('es-E02', 'es', 'E', 'a qué hora pasa el repartidor con mi pedido de hoy, lo sabes', 'general', 'arch_es_fg', 'noclaim'),
  R('es-E03', 'es', 'E', 'compramos un cuadro precioso para el salón y lo colgamos el domingo', 'general', 'chart_es_fg', 'noclaim'),
  R('es-E04', 'es', 'E', 'me pasás el número de Sofía que la tengo que llamar por lo del contrato', 'team-meet', 'flow_es_fg', 'noclaim'),
  R('es-E05', 'es', 'E', '¿Cuánto nos cuesta la licencia por usuario al mes?', 'sales', 'arch_es_bg', 'noclaim'),
  R('es-E06', 'es', 'E', 'qué dijo Pablo hace un rato sobre los plazos de entrega del proyecto', 'team-meet', 'arch_es_fg', 'noclaim'),
  R('es-E07', 'es', 'E', 'el viernes por la tarde no puedo tengo médico lo pasamos a la mañana', 'team-meet', 'chart_es_fg', 'noclaim'),
  R('es-E08', 'es', 'E', 'ayer devolví unas zapatillas y todavía no me hicieron el reembolso', 'call-center', 'flow_es_fg', 'noclaim'),
  R('es-E09', 'es', 'E', 'traduce al inglés lo último que dije', 'general', 'arch_es_fg', 'noclaim'),
  R('es-E10', 'es', 'E', 'resumime en tres puntos lo que acordamos hasta ahora', 'team-meet', 'arch_es_bg', 'noclaim'),
  // F — a bar chart is on the table
  R('es-F01', 'es', 'F', 'por qué la tarde tiene tantos más pedidos que el mediodía', 'sales', 'chart_es_fg', 'claim', { op: 'explain' }),
  R('es-F02', 'es', 'F', 'ordená las barras de mayor a menor', 'team-meet', 'chart_es_fg', 'claim', { op: 'update' }),
  R('es-F03', 'es', 'F', 'pásame esto mismo a una tabla, con las franjas y los pedidos', 'sales', 'chart_es_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('es-F04', 'es', 'F', 'esta noche hay partido así que cortamos a las siete', 'team-meet', 'chart_es_fg', 'noclaim'),
  // G — a process flowchart is on the table
  R('es-G01', 'es', 'G', 'qué pasa si el cliente no contesta cuando le proponen el sustituto', 'call-center', 'flow_es_fg', 'claim', { op: 'explain' }),
  R('es-G02', 'es', 'G', 'después del reembolso agregá un paso para mandarle un cupón de disculpa', 'call-center', 'flow_es_fg', 'claim', { op: 'update' }),
  R('es-G03', 'es', 'G', 'cuándo sale la próxima versión de la app, ya hay fecha', 'team-meet', 'flow_es_fg', 'noclaim'),

  // ───────────────────────────── RUSSIAN ─────────────────────────────
  // A — must draw, nothing on the table
  R('ru-A01', 'ru', 'A', 'нарисуй архитектуру сервиса коротких ссылок с кэшем и базой', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('ru-A02', 'ru', 'A', 'слушай а накидай-ка блок-схему как у нас проходит согласование отпуска', 'team-meet', 'none', 'draw', { view: 'flowchart' }),
  R('ru-A03', 'ru', 'A', 'сведи в табличку три тарифа базовый стандарт и про чтобы было видно чем они отличаются', 'sales', 'none', 'draw', { view: 'matrix' }),
  R('ru-A04', 'ru', 'A', 'мне бы на временной шкале увидеть этапы запуска продукта с января по июнь', 'team-meet', 'none', 'draw', { view: 'timeline' }),
  R('ru-A05', 'ru', 'A', 'покажи схемой кто кому подчиняется в отделе маркетинга', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('ru-A06', 'ru', 'A', 'построй график как росло число пользователей по месяцам за этот год', 'general', 'none', 'draw', { view: 'chart' }),
  R('ru-A07', 'ru', 'A', 'ну вот мы уже полчаса обсуждаем авторизацию а я всё равно путаюсь так что давай диаграмму последовательности что куда летит между браузером сервером и смс-шлюзом', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('ru-A08', 'ru', 'A', 'Набросай сущности и связи для базы библиотеки: книги, читатели и выдачи.', 'technical-interview', 'none', 'draw', { view: 'er' }),
  R('ru-A09', 'ru', 'A', 'изобрази какие состояния проходит заявка в поддержку от создания до закрытия', 'call-center', 'none', 'draw', { view: 'state' }),
  R('ru-A10', 'ru', 'A', 'разложи задачи по ремонту офиса на диаграмме Ганта со сроками', 'general', 'none', 'draw', { view: 'gantt' }),
  // B — must not draw, nothing on the table
  R('ru-B01', 'ru', 'B', 'вчера Петя нарисовал схему на доске но её уже стёрли', 'team-meet', 'none', 'nodraw'),
  R('ru-B02', 'ru', 'B', 'у нас сменный график два через два так что в субботу я работаю', 'looking-for-work', 'none', 'nodraw'),
  R('ru-B03', 'ru', 'B', 'модель ценообразования у них простая платишь за каждого пользователя', 'sales', 'none', 'nodraw'),
  R('ru-B04', 'ru', 'B', 'это не бизнес а мошенническая схема не лезь туда', 'general', 'none', 'nodraw'),
  R('ru-B05', 'ru', 'B', 'не надо мне рисовать радужные перспективы скажи честно сколько это стоит', 'sales', 'none', 'nodraw'),
  R('ru-B06', 'ru', 'B', 'сын в школе никак не выучит таблицу умножения', 'general', 'none', 'nodraw'),
  R('ru-B07', 'ru', 'B', 'Что Аня говорила про диаграмму на прошлом созвоне, напомни?', 'team-meet', 'none', 'nodraw'),
  R('ru-B08', 'ru', 'B', 'я на прошлой работе рисовал схемы процессов в визио и вёл документацию', 'looking-for-work', 'none', 'nodraw'),
  R('ru-B09', 'ru', 'B', 'розыгрыш призов будет в пятницу победителей вытянут случайно', 'general', 'none', 'nodraw'),
  R('ru-B10', 'ru', 'B', 'я смотрел по карте в навигаторе там пробка до самого моста', 'general', 'none', 'nodraw'),
  // C — question about the architecture on the table
  R('ru-C01', 'ru', 'C', 'а зачем между сервисом заказов и складом очередь почему не напрямую', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C02', 'ru', 'C', 'что будет если платёжный сервис ляжет заказы потеряются', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C03', 'ru', 'C', 'объясни что тут делает шлюз', 'lecture', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C04', 'ru', 'C', 'откуда диспетчер курьеров узнаёт что заказ собран', 'team-meet', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C05', 'ru', 'C', 'где тут узкое место при пиковой нагрузке', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C06', 'ru', 'C', 'вернёмся к той схеме что была раньше там уведомления кто отправляет сервис заказов или диспетчер', 'team-meet', 'arch_ru_bg', 'claim', { op: 'explain' }),
  R('ru-C07', 'ru', 'C', 'в архитектуре которую ты показывал до этого база остатков одна на все склады или у каждого своя', 'sales', 'arch_ru_bg', 'claim', { op: 'explain' }),
  R('ru-C08', 'ru', 'C', 'Я не понял стрелку от заказов к уведомлениям, что по ней идёт?', 'general', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C09', 'ru', 'C', 'а очередь заказов гарантирует порядок или сборка может получить заказы вперемешку', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  // D — change to the architecture on the table
  R('ru-D01', 'ru', 'D', 'добавь кэш между шлюзом и сервисом заказов', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D02', 'ru', 'D', 'убери уведомления мы их пока не делаем', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D03', 'ru', 'D', 'переименуй очередь заказов в Kafka', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D04', 'ru', 'D', 'тут не хватает сервиса промокодов подключи его к заказам', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D05', 'ru', 'D', 'раздели базу на две каталог отдельно остатки отдельно', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D06', 'ru', 'D', 'пусть платёжный сервис тоже пишет в очередь когда оплата прошла', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D07', 'ru', 'D', 'поставь балансировщик перед шлюзом и сделай две копии сервиса заказов', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D08', 'ru', 'D', 'на схеме архитектуры которая была до этого замени диспетчера курьеров на внешнюю службу доставки', 'sales', 'arch_ru_bg', 'claim', { op: 'update' }),
  R('ru-D09', 'ru', 'D', 'лучше бы приложение ходило за каталогом не через шлюз а сразу в CDN', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update', ...BL }),
  // E — a drawing is on the table, the sentence is about something else
  R('ru-E01', 'ru', 'E', 'а кто у вас в команде отвечает за платежи всё ещё Сергей', 'recruiting', 'arch_ru_fg', 'noclaim', BL),
  R('ru-E02', 'ru', 'E', 'курьер сегодня во сколько приедет я дома только до шести', 'general', 'arch_ru_fg', 'noclaim'),
  R('ru-E03', 'ru', 'E', 'какой у тебя график на следующей неделе во вторник выйдешь', 'team-meet', 'chart_ru_fg', 'noclaim'),
  R('ru-E04', 'ru', 'E', 'скинь мне номер Оли надо ей позвонить по договору', 'team-meet', 'flow_ru_fg', 'noclaim'),
  R('ru-E05', 'ru', 'E', 'Сколько стоит лицензия на одного пользователя в месяц?', 'sales', 'arch_ru_bg', 'noclaim'),
  R('ru-E06', 'ru', 'E', 'что Дима говорил в начале встречи про сроки напомни', 'team-meet', 'arch_ru_fg', 'noclaim'),
  R('ru-E07', 'ru', 'E', 'вечером я не могу давай созвонимся завтра утром', 'general', 'chart_ru_fg', 'noclaim'),
  R('ru-E08', 'ru', 'E', 'я вчера вернул кроссовки в магазин а деньги до сих пор не пришли', 'call-center', 'flow_ru_fg', 'noclaim'),
  R('ru-E09', 'ru', 'E', 'переведи на английский то что я сейчас сказал', 'general', 'arch_ru_fg', 'noclaim'),
  R('ru-E10', 'ru', 'E', 'подведи итог в трёх пунктах о чём мы договорились', 'team-meet', 'arch_ru_bg', 'noclaim'),
  // F — a bar chart is on the table
  R('ru-F01', 'ru', 'F', 'почему вечером заказов настолько больше чем днём', 'sales', 'chart_ru_fg', 'claim', { op: 'explain' }),
  R('ru-F02', 'ru', 'F', 'отсортируй столбцы по убыванию', 'team-meet', 'chart_ru_fg', 'claim', { op: 'update' }),
  R('ru-F03', 'ru', 'F', 'покажи это же таблицей интервалы и количество заказов', 'sales', 'chart_ru_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ru-F04', 'ru', 'F', 'ночью обещают заморозки не забудь занести цветы с балкона', 'general', 'chart_ru_fg', 'noclaim'),
  // G — a process flowchart is on the table
  R('ru-G01', 'ru', 'G', 'а если клиент вообще не отвечает на предложение замены что тогда', 'call-center', 'flow_ru_fg', 'claim', { op: 'explain' }),
  R('ru-G02', 'ru', 'G', 'после возврата денег добавь шаг отправить клиенту промокод с извинениями', 'call-center', 'flow_ru_fg', 'claim', { op: 'update' }),
  R('ru-G03', 'ru', 'G', 'когда выходит следующая версия приложения дата уже есть', 'team-meet', 'flow_ru_fg', 'noclaim'),

  // ───────────────────────────── CHINESE ─────────────────────────────
  // A — must draw, nothing on the table
  R('zh-A01', 'zh', 'A', '帮我画一下短链接服务的架构图,要有缓存和数据库', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('zh-A02', 'zh', 'A', '能不能把请假审批的流程画出来 从员工提交到HR归档', 'team-meet', 'none', 'draw', { view: 'flowchart' }),
  R('zh-A03', 'zh', 'A', '把基础版 专业版 企业版三个套餐做个对比表给我看看', 'sales', 'none', 'draw', { view: 'matrix' }),
  R('zh-A04', 'zh', 'A', '产品上线从一月到六月的关键节点 用时间轴给我理一下', 'team-meet', 'none', 'draw', { view: 'timeline' }),
  R('zh-A05', 'zh', 'A', '市场部现在谁向谁汇报 给我出一张组织架构图', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('zh-A06', 'zh', 'A', '去年四个季度的销售额,做成柱状图。', 'sales', 'none', 'draw', { view: 'chart' }),
  R('zh-A07', 'zh', 'A', '登录加短信验证这块我一直绕不明白 浏览器 服务器 短信网关之间到底怎么交互的 你给我来个时序图吧', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('zh-A08', 'zh', 'A', '今天这节课讲的工业革命 帮我整理成思维导图', 'lecture', 'none', 'draw', { view: 'mindmap' }),
  R('zh-A09', 'zh', 'A', '工单从创建到关闭有哪些状态 画个状态图', 'call-center', 'none', 'draw', { view: 'state' }),
  R('zh-A10', 'zh', 'A', '光说我听不明白 你直接图示一下数据包怎么从我家路由器到服务器的', 'general', 'none', 'draw'),
  // B — must not draw, nothing on the table
  R('zh-B01', 'zh', 'B', '昨天小王在白板上画了架构图 结果被保洁擦掉了', 'team-meet', 'none', 'nodraw'),
  R('zh-B02', 'zh', 'B', '老板又在给我们画饼 说年底一定上市', 'general', 'none', 'nodraw'),
  R('zh-B03', 'zh', 'B', '他们的定价模型很简单 按人头收费', 'sales', 'none', 'nodraw'),
  R('zh-B04', 'zh', 'B', '我新买的手表表带太长了 得去店里截一段', 'general', 'none', 'nodraw'),
  R('zh-B05', 'zh', 'B', '公司年会抽奖我又什么都没抽到', 'general', 'none', 'nodraw'),
  R('zh-B06', 'zh', 'B', '打开高德地图一看 前面堵了三公里', 'general', 'none', 'nodraw'),
  R('zh-B07', 'zh', 'B', '财务那边说会计科目表下周要更新', 'team-meet', 'none', 'nodraw'),
  R('zh-B08', 'zh', 'B', '刚才李总关于流程图是怎么说的?我没听清。', 'team-meet', 'none', 'nodraw'),
  R('zh-B09', 'zh', 'B', '我上一份工作主要负责画原型图和写需求文档', 'looking-for-work', 'none', 'nodraw'),
  R('zh-B10', 'zh', 'B', '我女儿每个周六上午都去学画画 所以周六我开不了会', 'general', 'none', 'nodraw'),
  // C — question about the architecture on the table
  R('zh-C01', 'zh', 'C', '订单服务为什么直接调支付 不走消息队列', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C02', 'zh', 'C', '队列要是挂了会怎么样?订单会丢吗?', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C03', 'zh', 'C', '网关在这里是干嘛的 给我讲讲', 'lecture', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C04', 'zh', 'C', '拣货那边是怎么知道有新订单的', 'general', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C05', 'zh', 'C', '高峰期这里面哪一块最容易成为瓶颈', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C06', 'zh', 'C', '回到刚才那张架构图 骑手出发的时候是谁通知用户的', 'sales', 'arch_zh_bg', 'claim', { op: 'explain' }),
  R('zh-C07', 'zh', 'C', '之前画的那个架构里 库存数据库是只有订单服务在读 还是拣货也会读', 'team-meet', 'arch_zh_bg', 'claim', { op: 'explain' }),
  R('zh-C08', 'zh', 'C', '订单到通知那条线我没看懂 上面传的是什么', 'team-meet', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C09', 'zh', 'C', '这套东西双十一扛得住吗 还是会卡在数据库上', 'sales', 'arch_zh_fg', 'claim', { op: 'explain' }),
  // D — change to the architecture on the table
  R('zh-D01', 'zh', 'D', '在网关和订单服务中间加一层缓存', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D02', 'zh', 'D', '通知服务先去掉 这期不做', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D03', 'zh', 'D', '把消息队列改名叫Kafka', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D04', 'zh', 'D', '这里少了个优惠券服务 接到订单服务上', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D05', 'zh', 'D', '数据库拆成两个,商品一个,库存一个', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D06', 'zh', 'D', '支付成功之后也让支付服务往队列里发一条消息', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D07', 'zh', 'D', '网关前面放个负载均衡 订单服务画成两个实例', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D08', 'zh', 'D', '前面那张架构图里 把骑手调度换成第三方配送平台', 'sales', 'arch_zh_bg', 'claim', { op: 'update' }),
  R('zh-D09', 'zh', 'D', '我觉得App看商品不该走网关 直接走CDN更好', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update', ...BL }),
  // E — a drawing is on the table, the sentence is about something else
  R('zh-E01', 'zh', 'E', '你们组现在支付是谁在负责 还是老张吗', 'recruiting', 'arch_zh_fg', 'noclaim', BL),
  R('zh-E02', 'zh', 'E', '我今天的外卖骑手怎么还没到 都超时二十分钟了', 'general', 'arch_zh_fg', 'noclaim'),
  R('zh-E03', 'zh', 'E', '我下午三点有个面试 上午可以开会', 'looking-for-work', 'chart_zh_fg', 'noclaim'),
  R('zh-E04', 'zh', 'E', '把小刘的电话发我一下 合同的事我得找她', 'team-meet', 'flow_zh_fg', 'noclaim'),
  R('zh-E05', 'zh', 'E', '每个用户每个月的授权费是多少?', 'sales', 'arch_zh_bg', 'noclaim'),
  R('zh-E06', 'zh', 'E', '刚才王经理开头说的交付时间是哪天来着', 'team-meet', 'arch_zh_fg', 'noclaim'),
  R('zh-E07', 'zh', 'E', '我的手表好像慢了五分钟 现在到底几点', 'general', 'chart_zh_fg', 'noclaim'),
  R('zh-E08', 'zh', 'E', '我昨天退了一双鞋 钱到现在还没退回来', 'call-center', 'flow_zh_fg', 'noclaim'),
  R('zh-E09', 'zh', 'E', '把我刚才那句话翻译成英文', 'general', 'arch_zh_fg', 'noclaim'),
  R('zh-E10', 'zh', 'E', '把我们到现在为止定下来的事总结成三条', 'team-meet', 'arch_zh_bg', 'noclaim'),
  // F — a bar chart is on the table
  R('zh-F01', 'zh', 'F', '下午的订单为什么比中午多这么多', 'sales', 'chart_zh_fg', 'claim', { op: 'explain' }),
  R('zh-F02', 'zh', 'F', '把柱子按从高到低排一下', 'team-meet', 'chart_zh_fg', 'claim', { op: 'update' }),
  R('zh-F03', 'zh', 'F', '同样的数据给我换成表格 列出时段和订单数', 'sales', 'chart_zh_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('zh-F04', 'zh', 'F', '今天晚上有球赛 我们七点前结束吧', 'team-meet', 'chart_zh_fg', 'noclaim'),
  // G — a process flowchart is on the table
  R('zh-G01', 'zh', 'G', '要是顾客一直不回复接不接受替换 那怎么办', 'call-center', 'flow_zh_fg', 'claim', { op: 'explain' }),
  R('zh-G02', 'zh', 'G', '退款后面加一步 给顾客发一张道歉优惠券', 'call-center', 'flow_zh_fg', 'claim', { op: 'update' }),
  R('zh-G03', 'zh', 'G', 'App下个版本什么时候发 日期定了吗', 'team-meet', 'flow_zh_fg', 'noclaim'),

  // ───────────────────────────── JAPANESE ─────────────────────────────
  // A — must draw, nothing on the table
  R('ja-A01', 'ja', 'A', '短縮URLサービスの構成図を描いてください。キャッシュとデータベースも入れて。', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('ja-A02', 'ja', 'A', '有給申請が承認されるまでの流れをフローチャートにしてくれる', 'team-meet', 'none', 'draw', { view: 'flowchart' }),
  R('ja-A03', 'ja', 'A', 'ベーシックとプレミアムのプランの違いを表にまとめていただけますか', 'sales', 'none', 'draw', { view: 'matrix' }),
  R('ja-A04', 'ja', 'A', 'リリースまでのマイルストーンを一月から六月まで年表っぽく並べてほしい', 'team-meet', 'none', 'draw', { view: 'timeline' }),
  R('ja-A05', 'ja', 'A', 'マーケ部の組織図を作って 誰が誰の下についてるかわかるように', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('ja-A06', 'ja', 'A', '去年の四半期ごとの売上を棒グラフで見せて', 'sales', 'none', 'draw', { view: 'chart' }),
  R('ja-A07', 'ja', 'A', 'さっきから二段階認証の話をしてるけど正直ごちゃごちゃしてきたから ブラウザとサーバーとSMS業者のやりとりをシーケンス図で出してもらえると助かる', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('ja-A08', 'ja', 'A', '会員 本 貸出の三つのテーブルがある図書館システムのER図をお願いします', 'technical-interview', 'none', 'draw', { view: 'er' }),
  R('ja-A09', 'ja', 'A', 'オフィス移転のタスクをガントチャートに落として 期限つきで', 'general', 'none', 'draw', { view: 'gantt' }),
  R('ja-A10', 'ja', 'A', '賃貸か購入か迷ってるので 判断の分かれ道を決定木で整理してもらえませんか', 'general', 'none', 'draw', { view: 'decision' }),
  // B — must not draw, nothing on the table
  R('ja-B01', 'ja', 'B', '昨日田中さんがホワイトボードに構成図を描いてくれたんですが もう消されてました', 'team-meet', 'none', 'nodraw'),
  R('ja-B02', 'ja', 'B', 'その計画は絵に描いた餅だよ 予算がついてないんだから', 'general', 'none', 'nodraw'),
  R('ja-B03', 'ja', 'B', '来週の学会発表の準備がまだ全然終わってなくて', 'lecture', 'none', 'nodraw'),
  R('ja-B04', 'ja', 'B', '料金モデルはシンプルで、ユーザー数に応じた従量課金です。', 'sales', 'none', 'nodraw'),
  R('ja-B05', 'ja', 'B', '金曜の七時に四人でテーブルを予約しておきました', 'general', 'none', 'nodraw'),
  R('ja-B06', 'ja', 'B', '地図アプリを見たら この先三キロ渋滞って出てた', 'general', 'none', 'nodraw'),
  R('ja-B07', 'ja', 'B', '経理から勘定科目表を来週更新するって連絡がありました', 'team-meet', 'none', 'nodraw'),
  R('ja-B08', 'ja', 'B', 'さっき佐藤さんはフローチャートについて何て言ってましたっけ', 'team-meet', 'none', 'nodraw'),
  R('ja-B09', 'ja', 'B', '前職では業務フロー図の作成とマニュアル整備を担当していました', 'looking-for-work', 'none', 'nodraw'),
  R('ja-B10', 'ja', 'B', '忘年会の抽選でまた何も当たらなかった', 'general', 'none', 'nodraw'),
  // C — question about the architecture on the table
  R('ja-C01', 'ja', 'C', '注文サービスが決済を直接呼んでるのはなぜですか キューを通さない理由は', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C02', 'ja', 'C', 'キューが落ちたらどうなるの 注文は消える', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C03', 'ja', 'C', 'ゲートウェイって何のために置いてるんですか', 'lecture', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C04', 'ja', 'C', '倉庫のほうは新しい注文が来たことをどうやって知るんですか', 'general', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C05', 'ja', 'C', 'ピーク時にボトルネックになりそうなのはこの中のどれ', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C06', 'ja', 'C', 'さっきの構成図に戻りますけど 配達員が出発したときお客様に知らせるのはどこですか', 'sales', 'arch_ja_bg', 'claim', { op: 'explain' }),
  R('ja-C07', 'ja', 'C', '前に出してもらったアーキテクチャの図で 在庫データベースを読むのは注文サービスだけですか ピッキングも読みますか', 'team-meet', 'arch_ja_bg', 'claim', { op: 'explain' }),
  R('ja-C08', 'ja', 'C', '注文から通知に伸びてる矢印がよくわからない 何を送ってるの', 'team-meet', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C09', 'ja', 'C', 'これ年末のセールに耐えられますか データベースで詰まりませんか', 'sales', 'arch_ja_fg', 'claim', { op: 'explain' }),
  // D — change to the architecture on the table
  R('ja-D01', 'ja', 'D', 'ゲートウェイと注文サービスの間にキャッシュを入れて', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D02', 'ja', 'D', '通知サービスは外してください 今回は作らないので', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D03', 'ja', 'D', '注文キューの名前をKafkaに変えて', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D04', 'ja', 'D', 'クーポンサービスが抜けてるので 注文サービスにつないで追加してください', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D05', 'ja', 'D', 'データベースを商品用と在庫用の二つに分けて', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D06', 'ja', 'D', '決済が通ったら決済サービスからもキューにイベントを流すようにして', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D07', 'ja', 'D', 'ゲートウェイの前にロードバランサーを置いて、注文サービスは二台にしておいて', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D08', 'ja', 'D', 'さっきのアーキテクチャ図のほうですが 配達員の手配を外部の配送業者に置き換えてください', 'sales', 'arch_ja_bg', 'claim', { op: 'update' }),
  R('ja-D09', 'ja', 'D', 'アプリが商品を見るときはゲートウェイじゃなくてCDNに直接行くほうがいいと思うんですよね', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update', ...BL }),
  // E — a drawing is on the table, the sentence is about something else
  R('ja-E01', 'ja', 'E', '御社で決済まわりを担当されているのは今も鈴木さんですか', 'recruiting', 'arch_ja_fg', 'noclaim', BL),
  R('ja-E02', 'ja', 'E', '今日頼んだ荷物の配達員さん まだ来ないんだけど何時ごろになるかな', 'general', 'arch_ja_fg', 'noclaim'),
  R('ja-E03', 'ja', 'E', '明日の午前は図書館に寄るので 午後からなら打ち合わせできます', 'team-meet', 'chart_ja_fg', 'noclaim'),
  R('ja-E04', 'ja', 'E', '山田さんの電話番号を送ってもらえますか 契約の件で連絡したくて', 'team-meet', 'flow_ja_fg', 'noclaim'),
  R('ja-E05', 'ja', 'E', 'ライセンスは一ユーザーあたり月いくらですか?', 'sales', 'arch_ja_bg', 'noclaim'),
  R('ja-E06', 'ja', 'E', '冒頭で部長が納期について何て言ってたか もう一度教えて', 'team-meet', 'arch_ja_fg', 'noclaim'),
  R('ja-E07', 'ja', 'E', '先方の意図がまだ読めないので 返事は少し待ちましょう', 'sales', 'chart_ja_fg', 'noclaim'),
  R('ja-E08', 'ja', 'E', '昨日スニーカーを返品したんですけど まだ返金されてないんですよ', 'call-center', 'flow_ja_fg', 'noclaim'),
  R('ja-E09', 'ja', 'E', '今言ったことを英語に訳して', 'general', 'arch_ja_fg', 'noclaim'),
  R('ja-E10', 'ja', 'E', 'ここまでで決まったことを三点にまとめてください', 'team-meet', 'arch_ja_bg', 'noclaim'),
  // F — a bar chart is on the table
  R('ja-F01', 'ja', 'F', '夕方が昼よりこんなに多いのはなぜですか', 'sales', 'chart_ja_fg', 'claim', { op: 'explain' }),
  R('ja-F02', 'ja', 'F', '棒を多い順に並べ替えて', 'team-meet', 'chart_ja_fg', 'claim', { op: 'update' }),
  R('ja-F03', 'ja', 'F', '同じ内容を表にしてもらえますか 時間帯と注文数で', 'sales', 'chart_ja_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ja-F04', 'ja', 'F', '今夜は試合があるので 七時には終わりにしましょう', 'team-meet', 'chart_ja_fg', 'noclaim'),
  // G — a process flowchart is on the table
  R('ja-G01', 'ja', 'G', 'お客様から代替品の返事が来なかった場合はどうなるんですか', 'call-center', 'flow_ja_fg', 'claim', { op: 'explain' }),
  R('ja-G02', 'ja', 'G', '返金のあとに お詫びのクーポンを送るステップを足して', 'call-center', 'flow_ja_fg', 'claim', { op: 'update' }),
  R('ja-G03', 'ja', 'G', 'アプリの次のバージョンはいつ出るんですか 日付は決まってますか', 'team-meet', 'flow_ja_fg', 'noclaim'),
];
