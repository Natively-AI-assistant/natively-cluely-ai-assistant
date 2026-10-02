// Independent measurement set #5 for resolveDiagramRequest — es / ru / zh / ja.
// Written and labelled BEFORE the function was run on any of these sentences,
// by an author who has never read the rules under test.
// Labels = what a sensible listener in the meeting would expect.
//
// Fixture domain: a city bike-share service.

const SRC = {
  es: `flowchart LR
  app[App del ciclista]
  gw["Pasarela de API"]
  viajes[Servicio de viajes]
  inv[(Inventario de bicis y estaciones)]
  pagos["Servicio de pagos"]
  cola[[Cola de eventos]]
  candados[Control de candados]
  rebal["Planificador de rebalanceo"]
  notif[Notificaciones]
  app --> gw
  gw --> viajes
  viajes --> inv
  viajes --> pagos
  viajes --> candados
  viajes --> cola
  cola --> rebal
  cola --> notif
  rebal --> inv`,
  ru: `flowchart LR
  app[Приложение райдера]
  gw["API-шлюз"]
  rides[Сервис поездок]
  inv[(База велосипедов и станций)]
  pay["Платёжный сервис"]
  q[[Очередь событий]]
  lock[Управление замками]
  reb["Планировщик перераспределения"]
  notif[Уведомления]
  app --> gw
  gw --> rides
  rides --> inv
  rides --> pay
  rides --> lock
  rides --> q
  q --> reb
  q --> notif
  reb --> inv`,
  zh: `flowchart LR
  app[骑行App]
  gw["API网关"]
  ride[骑行服务]
  inv[(车辆与站点库存库)]
  pay["支付服务"]
  mq[[事件队列]]
  lock[车锁控制服务]
  plan["调度规划器"]
  notif[消息通知]
  app --> gw
  gw --> ride
  ride --> inv
  ride --> pay
  ride --> lock
  ride --> mq
  mq --> plan
  mq --> notif
  plan --> inv`,
  ja: `flowchart LR
  app[ライダーアプリ]
  gw["APIゲートウェイ"]
  ride[ライドサービス]
  inv[(車両・ステーション在庫DB)]
  pay["決済サービス"]
  q[[イベントキュー]]
  lock[ロック制御サービス]
  plan["再配置プランナー"]
  notif[通知サービス]
  app --> gw
  gw --> ride
  ride --> inv
  ride --> pay
  ride --> lock
  ride --> q
  q --> plan
  q --> notif
  plan --> inv`,
};

const FLOW_SRC = {
  es: `flowchart TD
  aviso[Aviso de bici averiada]
  bloqueo[Bloquear la bici en la app]
  recogida["Recogida con la furgoneta"]
  revision[Revisión en el taller]
  dec{"¿Tiene arreglo?"}
  reparar[Reparar y probar]
  baja["Dar de baja y reciclar"]
  vuelta[Devolver a una estación]
  aviso --> bloqueo
  bloqueo --> recogida
  recogida --> revision
  revision --> dec
  dec -->|Sí| reparar
  dec -->|No| baja
  reparar --> vuelta`,
  ru: `flowchart TD
  report[Жалоба на сломанный велосипед]
  block[Блокировка велосипеда в приложении]
  pickup["Вывоз фургоном"]
  inspect[Осмотр в мастерской]
  dec{"Подлежит ремонту?"}
  repair[Ремонт и проверка]
  retire["Списание"]
  back[Возврат на станцию]
  report --> block
  block --> pickup
  pickup --> inspect
  inspect --> dec
  dec -->|Да| repair
  dec -->|Нет| retire
  repair --> back`,
  zh: `flowchart TD
  report[用户报修]
  block[App里锁定车辆]
  pickup["调度车回收"]
  inspect[维修点检测]
  dec{"还能修吗？"}
  repair[维修并试骑]
  retire["报废回收"]
  back[重新投放到站点]
  report --> block
  block --> pickup
  pickup --> inspect
  inspect --> dec
  dec -->|能| repair
  dec -->|不能| retire
  repair --> back`,
  ja: `flowchart TD
  report[故障報告の受付]
  block[アプリで車両を貸出停止]
  pickup["トラックで回収"]
  inspect[整備拠点で点検]
  dec{"修理できる？"}
  repair[修理して試運転]
  retire["廃車・リサイクル"]
  back[ステーションへ再配備]
  report --> block
  block --> pickup
  pickup --> inspect
  inspect --> dec
  dec -->|はい| repair
  dec -->|いいえ| retire
  repair --> back`,
};

const CHART = {
  es: { title: 'Viajes por tipo de día', x: 'Tipo de día', cats: ['Lunes a jueves', 'Viernes', 'Sábado', 'Domingo y festivos'], y: 'Viajes al día', series: 'Viajes' },
  ru: { title: 'Поездки по дням недели', x: 'Дни недели', cats: ['Пн–Чт', 'Пятница', 'Суббота', 'Воскресенье'], y: 'Поездок в день', series: 'Поездки' },
  zh: { title: '各类日期的日均骑行量', x: '日期类型', cats: ['周一至周四', '周五', '周六', '周日'], y: '日均骑行次数', series: '骑行次数' },
  ja: { title: '曜日別の利用回数', x: '曜日区分', cats: ['月〜木', '金曜', '土曜', '日曜・祝日'], y: '1日あたりの利用回数', series: '利用回数' },
};

const fx = (lang, foreground) => ({ artifactId: 'design-1.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground, source: SRC[lang] });
const chartFx = (lang) => ({
  artifactId: 'chart-1.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true,
  source: JSON.stringify({ v: 1, type: 'bar', title: CHART[lang].title, x: { label: CHART[lang].x, values: CHART[lang].cats }, y: { label: CHART[lang].y }, series: [{ name: CHART[lang].series, values: [820, 760, 1310, 990], status: 'illustrative' }] }),
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
  R('es-A01', 'es', 'A', 'oye, ¿me armas un diagrama de arquitectura de una plataforma de streaming de video? con su CDN, la transcodificación y todo eso', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('es-A02', 'es', 'A', 'a ver hazme porfa una línea de tiempo con los hitos del lanzamiento de la tienda en línea de aquí a diciembre', 'team-meet', 'none', 'draw', { view: 'timeline' }),
  R('es-A03', 'es', 'A', 'Necesitaría ver en una tabla la comparación entre el plan Básico, el Pro y el Empresarial: precio, usuarios y soporte.', 'sales', 'none', 'draw', { view: 'matrix' }),
  R('es-A04', 'es', 'A', 'parce, hágame un favor y me pinta ahí cómo va el flujo de aprobación de un crédito, desde que el cliente lo pide hasta que se desembolsa', 'general', 'none', 'draw', { view: 'flowchart' }),
  R('es-A05', 'es', 'A', 'Estaría bueno tener a la vista quién le reporta a quién en el área de producto, ¿lo puedes dibujar?', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('es-A06', 'es', 'A', 'ya po muéstrame un gráfico de barras con las ventas de cada trimestre del año pasado', 'sales', 'none', 'draw', { view: 'chart' }),
  R('es-A07', 'es', 'A', 'Vale, tengo que explicarle al cliente cómo se pasan los mensajes entre el programa de correo, el servidor y el filtro de spam, paso a paso y en orden. ¿Me lo esquematizas?', 'call-center', 'none', 'draw'),
  R('es-A08', 'es', 'A', 'ponme en pantalla un mapa mental con las ideas del tema de hoy, las causas de la Revolución Industrial', 'lecture', 'none', 'draw', { view: 'mindmap' }),
  R('es-A09', 'es', 'A', 'Para la mudanza de la oficina me vendría bien un Gantt con las tareas y las semanas, ¿te animas?', 'team-meet', 'none', 'draw', { view: 'gantt' }),
  R('es-A10', 'es', 'A', 'no sé cómo explicarlo sin verlo. dibuja las tablas de una biblioteca con libros socios y préstamos y cómo se relacionan', 'technical-interview', 'none', 'draw', { view: 'er' }),

  // B — must not draw, nothing on the table
  R('es-B01', 'es', 'B', 'Ayer Marta dibujó en la pizarra todo el flujo de facturación y la verdad quedó clarísimo.', 'team-meet', 'none', 'nodraw'),
  R('es-B02', 'es', 'B', 'esto no pinta nada bien, si seguimos así no llegamos a la fecha', 'team-meet', 'none', 'nodraw'),
  R('es-B03', 'es', 'B', 'Mi jefa me pidió que le dibujara un organigrama del equipo para el lunes, así que el finde me toca trabajar.', 'general', 'none', 'nodraw'),
  R('es-B04', 'es', 'B', 'Mañana con calma hago yo el diagrama de la base de datos y se los mando por correo.', 'team-meet', 'none', 'nodraw'),
  R('es-B05', 'es', 'B', 'El diagrama que mandó el proveedor es un desastre, no se entiende ni qué flecha va a dónde.', 'sales', 'none', 'nodraw'),
  R('es-B06', 'es', 'B', '¿Qué fue lo que dijo Andrés sobre la tabla de precios al principio de la llamada?', 'sales', 'none', 'nodraw'),
  R('es-B07', 'es', 'B', 'me apunté a clases de dibujo los jueves, me relaja un montón', 'general', 'none', 'nodraw'),
  R('es-B08', 'es', 'B', 'Se me quemó la tarjeta gráfica del portátil y ahora no puedo ni abrir el Excel.', 'general', 'none', 'nodraw'),
  R('es-B09', 'es', 'B', 'Tenemos que trazar una línea clara entre lo que es soporte y lo que ya es consultoría.', 'call-center', 'none', 'nodraw'),
  R('es-B10', 'es', 'B', 'Oye Lucía, cuando puedas mándame el esquema que hiciste la semana pasada, el de los permisos.', 'team-meet', 'none', 'nodraw', BL),

  // C — question about the architecture on the table
  R('es-C01', 'es', 'C', '¿Y por qué el servicio de viajes habla directo con los candados en vez de pasar por la cola?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C02', 'es', 'C', 'a ver explícame qué hace exactamente el planificador ese del rebalanceo', 'team-meet', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C03', 'es', 'C', 'No me queda claro: si se cae la pasarela, ¿qué parte sigue funcionando?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C04', 'es', 'C', 'oye y en el dibujo de dónde saca la info lo de las notis', 'general', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C05', 'es', 'C', 'Perdona que insista, pero después de darle vueltas sigo sin ver para qué sirve la cola de eventos aquí, ¿me lo aclaras?', 'lecture', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C06', 'es', 'C', 'Volviendo a la arquitectura de antes: ¿el inventario de bicis y estaciones lo escribe solo el servicio de viajes o también el planificador?', 'technical-interview', 'arch_es_bg', 'claim', { op: 'explain' }),
  R('es-C07', 'es', 'C', 'el servicio de pagos ese, ¿es nuestro o es un proveedor externo tipo Stripe?', 'sales', 'arch_es_bg', 'claim', { op: 'explain' }),
  R('es-C08', 'es', 'C', '¿Cuál sería el cuello de botella de todo esto un sábado con mucha demanda?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C09', 'es', 'C', 'oye una pregunta, esa flecha que va del rebalanceo al inventario qué onda, qué quiere decir', 'team-meet', 'arch_es_fg', 'claim', { op: 'explain' }),

  // D — change to the architecture on the table
  R('es-D01', 'es', 'D', 'Agrégale una caché entre la pasarela y el servicio de viajes.', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D02', 'es', 'D', 'quita las notificaciones por ahora que eso no entra en la primera versión', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D03', 'es', 'D', 'Cámbiale el nombre a lo de los candados, ponle "Servicio de desbloqueo".', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D04', 'es', 'D', 'vale, y ahora mete un servicio de tarifas y abonos al lado de pagos', 'general', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D05', 'es', 'D', 'Falta algo. Añade un servicio de mapas que le pase las rutas al planificador.', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D06', 'es', 'D', 'la flecha de viajes a candados debería pasar por la cola po, cámbiala al tiro', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D07', 'es', 'D', 'En el diagrama de arquitectura de hace un rato, sepárame el inventario en dos bases: una de bicis y otra de estaciones.', 'technical-interview', 'arch_es_bg', 'claim', { op: 'update' }),
  R('es-D08', 'es', 'D', 'póngale colores pues, que las bases de datos se vean distintas de los servicios', 'sales', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D09', 'es', 'D', 'Que yo sepa el rebalanceo también les manda avisos a los operarios, así que conecta el planificador con notificaciones.', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),

  // E — a drawing is on the table, the sentence is about something else
  R('es-E01', 'es', 'E', '¿A qué hora es la reunión con los de pagos mañana?', 'team-meet', 'arch_es_fg', 'noclaim'),
  R('es-E02', 'es', 'E', 'Había una cola tremenda en la cafetería, por eso llegué tarde, perdón.', 'general', 'arch_es_fg', 'noclaim'),
  R('es-E03', 'es', 'E', '¿Qué dijo Camila hace un rato sobre el presupuesto de las furgonetas?', 'team-meet', 'flow_es_fg', 'noclaim'),
  R('es-E04', 'es', 'E', 'A mí no me llegan las notificaciones del calendario al móvil, ¿a ustedes sí?', 'general', 'arch_es_bg', 'noclaim'),
  R('es-E05', 'es', 'E', 'Sábado y domingo me voy a la playa, así que el viernes salgo temprano.', 'general', 'chart_es_fg', 'noclaim'),
  R('es-E06', 'es', 'E', 'bueno cuéntame un poco de tu experiencia liderando equipos', 'recruiting', 'arch_es_fg', 'noclaim'),
  R('es-E07', 'es', 'E', 'El taller de liderazgo es el jueves, ¿quién se apunta?', 'team-meet', 'flow_es_fg', 'noclaim'),
  R('es-E08', 'es', 'E', 'A ver, pintemos la raya: de la integración se encarga el cliente, no nosotros.', 'sales', 'arch_es_fg', 'noclaim'),
  R('es-E09', 'es', 'E', '¿Cuánto cuesta la licencia por usuario si somos unos cuarenta?', 'sales', 'chart_es_fg', 'noclaim'),
  R('es-E10', 'es', 'E', 'luego le dibujo yo a mano a Sergio cómo quedaría el almacén nuevo, que con palabras no se entera', 'team-meet', 'arch_es_bg', 'noclaim'),

  // F — chart on the table
  R('es-F01', 'es', 'F', '¿Cuánta diferencia hay entre el sábado y un día normal entre semana, más o menos?', 'sales', 'chart_es_fg', 'claim', { op: 'explain' }),
  R('es-F02', 'es', 'F', 'ponle las barras en verde y ordénalas de mayor a menor', 'team-meet', 'chart_es_fg', 'claim', { op: 'update' }),
  R('es-F03', 'es', 'F', 'Pásame eso mismo a una tabla, que lo quiero copiar en el informe.', 'sales', 'chart_es_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('es-F04', 'es', 'F', 'El domingo hay partido, ¿alguien lo va a ver?', 'general', 'chart_es_fg', 'noclaim'),

  // G — process flowchart on the table
  R('es-G01', 'es', 'G', '¿Qué pasa con la bici si en el taller dicen que no tiene arreglo?', 'call-center', 'flow_es_fg', 'claim', { op: 'explain' }),
  R('es-G02', 'es', 'G', 'entre la recogida y la revisión mete un paso de limpieza', 'team-meet', 'flow_es_fg', 'claim', { op: 'update' }),
  R('es-G03', 'es', 'G', '¿Quién maneja la furgoneta el martes, Raúl o Dani?', 'team-meet', 'flow_es_fg', 'noclaim'),

  // ───────────────────────────── RUSSIAN ─────────────────────────────
  // A — must draw, nothing on the table
  R('ru-A01', 'ru', 'A', 'Как бы вы спроектировали сервис коротких ссылок? Накидайте архитектурную схему, а я пока послушаю.', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('ru-A02', 'ru', 'A', 'слушай а можешь накидать схемку что делать дежурному когда падает прод кого будить и в каком порядке', 'team-meet', 'none', 'draw', { view: 'flowchart' }),
  R('ru-A03', 'ru', 'A', 'Мне бы табличку: Постгрес против Монги — транзакции, масштабирование, стоимость поддержки.', 'technical-interview', 'none', 'draw', { view: 'matrix' }),
  R('ru-A04', 'ru', 'A', 'А можно круговую диаграмму: какую долю бюджета съедают зарплаты, аренда, реклама и всё остальное?', 'general', 'none', 'draw', { view: 'chart' }),
  R('ru-A05', 'ru', 'A', 'Давайте зафиксируем сроки. Изобрази диаграмму Ганта по выпуску мобильного приложения: дизайн, разработка, тесты, релиз.', 'team-meet', 'none', 'draw', { view: 'gantt' }),
  R('ru-A06', 'ru', 'A', 'ну-ка набросай кто за что отвечает при запуске рекламной кампании маркетинг дизайн юристы аналитики', 'team-meet', 'none', 'draw', { view: 'responsibility' }),
  R('ru-A07', 'ru', 'A', 'Хочу наглядно увидеть, в каких состояниях бывает посылка — принята, в пути, на складе, вручена, возвращена — и как она между ними переходит.', 'technical-interview', 'none', 'draw', { view: 'state' }),
  R('ru-A08', 'ru', 'A', 'покажи это картинкой а то на словах я запутался как у нас еда едет от ресторана до двери клиента', 'general', 'none', 'draw'),
  R('ru-A09', 'ru', 'A', 'если не сложно распиши в виде дерева решений когда клиенту возвращать деньги а когда предлагать замену', 'call-center', 'none', 'draw', { view: 'decision' }),
  R('ru-A10', 'ru', 'A', 'Будьте добры, подготовьте диаграмму последовательности: клиент отправляет запрос, банк проверяет, процессинг отвечает.', 'general', 'none', 'draw', { view: 'sequence' }),

  // B — must not draw, nothing on the table
  R('ru-B01', 'ru', 'B', 'Мы на прошлом ретро уже рисовали эту диаграмму потоков, и толку было ноль.', 'team-meet', 'none', 'nodraw'),
  R('ru-B02', 'ru', 'B', 'Он у нас любит рисоваться перед начальством, а работать не любит.', 'general', 'none', 'nodraw'),
  R('ru-B03', 'ru', 'B', 'Клиент на той неделе просил нарисовать ему дорожную карту, мы отказались — не наш формат.', 'sales', 'none', 'nodraw'),
  R('ru-B04', 'ru', 'B', 'К защите диплома я начерчу все схемы от руки, так научрук требует.', 'lecture', 'none', 'nodraw'),
  R('ru-B05', 'ru', 'B', 'Кто вообще делал эту инфографику для годового отчёта? Цвета вырвиглазные, подписи мелкие.', 'team-meet', 'none', 'nodraw'),
  R('ru-B06', 'ru', 'B', 'я прослушал а на каком слайде Ирина показывала отток клиентов кто-нибудь запомнил', 'team-meet', 'none', 'nodraw'),
  R('ru-B07', 'ru', 'B', 'У меня сегодня плотный график, давайте созвонимся после четырёх.', 'sales', 'none', 'nodraw'),
  R('ru-B08', 'ru', 'B', 'У них там серая схема с зарплатами, я бы туда не пошёл.', 'looking-for-work', 'none', 'nodraw'),
  R('ru-B09', 'ru', 'B', 'надо бы как-нибудь нарисовать схему всего этого хозяйства, а то новички путаются', 'team-meet', 'none', 'nodraw', BL),
  R('ru-B10', 'ru', 'B', 'Новая модель телефона вышла, а по сути то же самое, только камера другая.', 'general', 'none', 'nodraw'),

  // C — question about the architecture on the table
  R('ru-C01', 'ru', 'C', 'А платёжка у нас вызывается синхронно или тоже через очередь?', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C02', 'ru', 'C', 'объясни на пальцах зачем планировщику ходить в базу если все события и так летят через очередь', 'team-meet', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C03', 'ru', 'C', 'Если очередь событий переполнится, поездки продолжат создаваться или всё встанет?', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C04', 'ru', 'C', 'Слушайте, а где тут вообще считается стоимость поездки — в сервисе поездок или в платёжном?', 'general', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C05', 'ru', 'C', 'А управление замками — оно на каждый замок держит отдельное соединение или опрашивает их по расписанию?', 'sales', 'arch_ru_bg', 'claim', { op: 'explain' }),
  R('ru-C06', 'ru', 'C', 'а вот эта стрелочка от сервиса поездок к замкам она в одну сторону или замок тоже что-то отвечает', 'lecture', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C07', 'ru', 'C', 'По той схеме ещё вопросик: в базе велосипедов и станций хранится текущее положение великов или только станции?', 'team-meet', 'arch_ru_bg', 'claim', { op: 'explain' }),
  R('ru-C08', 'ru', 'C', 'Какой из этих компонентов вы бы масштабировали первым при росте в десять раз?', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C09', 'ru', 'C', 'Правильно ли я понимаю, что приложение райдера никогда не общается с замками напрямую, а только через API-шлюз?', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),

  // D — change to the architecture on the table
  R('ru-D01', 'ru', 'D', 'Поставь балансировщик перед шлюзом.', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D02', 'ru', 'D', 'уведомления и платежи поменяй местами а то линии пересекаются', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D03', 'ru', 'D', 'Сервис поездок и платёжный сервис обведи рамкой и подпиши «ядро».', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D04', 'ru', 'D', 'и ещё прицепи к платежам антифрод отдельным кубиком', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D05', 'ru', 'D', 'Смотри, у нас же ещё самокаты будут. Допиши в название базы «и самокатов».', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D06', 'ru', 'D', 'От шлюза проведи ещё одну линию — прямо к платёжному сервису, для вебхуков от банка.', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D07', 'ru', 'D', 'к базе велосипедов и станций добавьте пожалуйста реплику на чтение', 'sales', 'arch_ru_bg', 'claim', { op: 'update' }),
  R('ru-D08', 'ru', 'D', 'стрелки подпиши пожалуйста где синхронный вызов а где событие', 'general', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D09', 'ru', 'D', 'Раз уж приложение напрямую слушает статус замка по блютузу, проведи пунктирную стрелку от приложения райдера к управлению замками.', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),

  // E — a drawing is on the table, the sentence is about something else
  R('ru-E01', 'ru', 'E', 'Кто у нас сейчас отвечает за платёжный сервис — всё ещё Гриша или уже передали?', 'team-meet', 'arch_ru_fg', 'noclaim', BL),
  R('ru-E02', 'ru', 'E', 'Шлюз на канале закрыли на ремонт, теплоходы в этом сезоне не ходят.', 'general', 'arch_ru_fg', 'noclaim'),
  R('ru-E03', 'ru', 'E', 'Олег в начале созвона называл цифру по списанию за прошлый год — сколько там было?', 'team-meet', 'flow_ru_fg', 'noclaim'),
  R('ru-E04', 'ru', 'E', 'Замок на двери в переговорку опять заело, кто-нибудь звал завхоза?', 'general', 'arch_ru_bg', 'noclaim'),
  R('ru-E05', 'ru', 'E', 'По воскресеньям у нас поддержка не работает, так что тикет увидят только в понедельник.', 'call-center', 'chart_ru_fg', 'noclaim'),
  R('ru-E06', 'ru', 'E', 'Мне сегодня пришло уведомление из налоговой, весь день как на иголках.', 'general', 'arch_ru_bg', 'noclaim'),
  R('ru-E07', 'ru', 'E', 'Ремонт в квартире затянулся, третий месяц живу у родителей.', 'general', 'flow_ru_fg', 'noclaim'),
  R('ru-E08', 'ru', 'E', 'Я потом сам нарисую для заказчика картинку попроще, эту им показывать рано.', 'sales', 'arch_ru_fg', 'noclaim'),
  R('ru-E09', 'ru', 'E', 'График дежурств на следующую неделю уже утвердили?', 'team-meet', 'chart_ru_fg', 'noclaim'),
  R('ru-E10', 'ru', 'E', 'Картина по продажам за квартал, честно говоря, печальная, но про это потом.', 'sales', 'chart_ru_fg', 'noclaim'),

  // F — chart on the table
  R('ru-F01', 'ru', 'F', 'А субботний пик — это разовая история или так каждую неделю?', 'sales', 'chart_ru_fg', 'claim', { op: 'explain' }),
  R('ru-F02', 'ru', 'F', 'подпиши значения над столбиками и убери сетку', 'team-meet', 'chart_ru_fg', 'claim', { op: 'update' }),
  R('ru-F03', 'ru', 'F', 'А можно те же цифры таблицей, без столбиков?', 'sales', 'chart_ru_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ru-F04', 'ru', 'F', 'Авансовый отчёт по поездкам в командировки до какого числа сдавать?', 'team-meet', 'chart_ru_fg', 'noclaim'),

  // G — process flowchart on the table
  R('ru-G01', 'ru', 'G', 'Зачем блокировать велосипед в приложении ещё до того, как его забрал фургон?', 'lecture', 'flow_ru_fg', 'claim', { op: 'explain' }),
  R('ru-G02', 'ru', 'G', 'после ремонта добавь ещё один ромбик: прошёл проверку или нет, если нет — обратно в ремонт', 'team-meet', 'flow_ru_fg', 'claim', { op: 'update' }),
  R('ru-G03', 'ru', 'G', 'Проверка из пожарной инспекции будет в четверг, уберите коробки из коридора.', 'general', 'flow_ru_fg', 'noclaim'),

  // ───────────────────────────── CHINESE ─────────────────────────────
  // A — must draw, nothing on the table
  R('zh-A01', 'zh', 'A', '面试题是设计一个朋友圈那样的信息流系统，你先把整体架构给我画出来吧', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('zh-A02', 'zh', 'A', '可不可以帮我出个流程图啦，就是员工报销从提交到打款这样子一整套', 'team-meet', 'none', 'draw', { view: 'flowchart' }),
  R('zh-A03', 'zh', 'A', '近六个月日活 折线图 来一个', 'team-meet', 'none', 'draw', { view: 'chart' }),
  R('zh-A04', 'zh', 'A', '把这四个候选人的学历、工作年限、期望薪资做成一张表', 'recruiting', 'none', 'draw', { view: 'matrix' }),
  R('zh-A05', 'zh', 'A', '把这学期的教学安排按时间线排一下，开学、期中、期末、答辩', 'lecture', 'none', 'draw', { view: 'timeline' }),
  R('zh-A06', 'zh', 'A', '我想看下订单、用户、商品这几张表之间是什么关系，字段不用太细，麻烦画出来', 'technical-interview', 'none', 'draw', { view: 'er' }),
  R('zh-A07', 'zh', 'A', '新人老搞不清工单该升级给谁，给我整一个决策树呗，按故障类型和严重程度分', 'call-center', 'none', 'draw', { view: 'decision' }),
  R('zh-A08', 'zh', 'A', '弄个思维导图，把这次复盘的要点都放进去', 'team-meet', 'none', 'draw', { view: 'mindmap' }),
  R('zh-A09', 'zh', 'A', '面试官让我讲讲面向对象。帮我画个类图：动物是基类，猫和狗继承它，各自有叫的方法', 'looking-for-work', 'none', 'draw', { view: 'class' }),
  R('zh-A10', 'zh', 'A', '咱们项目各部门谁负责啥，有没有图能让我一眼看明白？', 'team-meet', 'none', 'draw', BL),

  // B — must not draw, nothing on the table
  R('zh-B01', 'zh', 'B', '上周培训的时候老师画了一张特别复杂的时序图，我到现在都没消化', 'general', 'none', 'nodraw'),
  R('zh-B02', 'zh', 'B', '他就是给咱们画大饼，年终奖的事儿到现在也没影', 'general', 'none', 'nodraw'),
  R('zh-B03', 'zh', 'B', '我妈让我给她画个去医院的路线，她不会用导航', 'general', 'none', 'nodraw'),
  R('zh-B04', 'zh', 'B', '等需求定了我再出原型图，现在画了也是白画', 'team-meet', 'none', 'nodraw'),
  R('zh-B05', 'zh', 'B', 'PPT里那个饼图比例加起来都不到一百，谁做的啊', 'sales', 'none', 'nodraw'),
  R('zh-B06', 'zh', 'B', '张经理刚刚提到的那个漏斗转化率是百分之几？我没听清', 'sales', 'none', 'nodraw'),
  R('zh-B07', 'zh', 'B', '这个要不要画个图啊？算了，先口头讲吧', 'lecture', 'none', 'nodraw', BL),
  R('zh-B08', 'zh', 'B', '这个模型训练了三天，效果还是不太行', 'technical-interview', 'none', 'nodraw'),
  R('zh-B09', 'zh', 'B', '你把地图打开看看，从这儿到机场堵不堵', 'general', 'none', 'nodraw'),
  R('zh-B10', 'zh', 'B', '我们图的不是便宜，是售后有保障', 'sales', 'none', 'nodraw'),

  // C — question about the architecture on the table
  R('zh-C01', 'zh', 'C', '网关后面为啥只挂了骑行服务一个，支付不用直接暴露吗？', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C02', 'zh', 'C', '锁控那块是怎么知道该开哪把锁的', 'team-meet', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C03', 'zh', 'C', '我想问下，调度这边的数据是从队列来的还是直接查库存？', 'general', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C04', 'zh', 'C', '图里库存库和支付之间怎么没连线，扣费的时候不用查车的状态吗', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C05', 'zh', 'C', '消息通知是只发给骑行用户，还是运维的人也能收到？', 'sales', 'arch_zh_bg', 'claim', { op: 'explain' }),
  R('zh-C06', 'zh', 'C', '你讲讲用户扫码开锁这一下，请求在图上是怎么走的呗', 'lecture', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C07', 'zh', 'C', '之前那个架构里的调度规划器，它多久跑一次啊？', 'team-meet', 'arch_zh_bg', 'claim', { op: 'explain' }),
  R('zh-C08', 'zh', 'C', '这几个服务里头哪个是单点，挂了整个就瘫了？', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C09', 'zh', 'C', '请问骑行App是每次请求都要过网关鉴权，还是有长连接？', 'sales', 'arch_zh_fg', 'claim', { op: 'explain' }),

  // D — change to the architecture on the table
  R('zh-D01', 'zh', 'D', '事件队列换成Kafka，名字直接写Kafka就行', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D02', 'zh', 'D', '支付那块拆成两个，一个扣费一个退款', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D03', 'zh', 'D', '锁控和骑行服务之间那条线上标一下“MQTT”', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D04', 'zh', 'D', '加一个优惠券服务，放在支付前面，骑行服务先调它再调支付', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D05', 'zh', 'D', '监控呢？加个监控告警，所有服务都往它那儿打日志。', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D06', 'zh', 'D', '骑行服务到库存库那条线改成双向的', 'general', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D07', 'zh', 'D', '对了，架构那张图还得补一下：骑行App旁边加一个小程序入口，也走网关。', 'sales', 'arch_zh_bg', 'claim', { op: 'update' }),
  R('zh-D08', 'zh', 'D', '整张图横着太长了，改成从上往下排', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D09', 'zh', 'D', '我记得锁那边还会上报电量，所以从锁控往队列再连一条线吧', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),

  // E — a drawing is on the table, the sentence is about something else
  R('zh-E01', 'zh', 'E', '网关那个项目的负责人是不是换人了？', 'team-meet', 'arch_zh_fg', 'noclaim'),
  R('zh-E02', 'zh', 'E', '事件营销那个方案客户看了吗？', 'sales', 'arch_zh_fg', 'noclaim'),
  R('zh-E03', 'zh', 'E', '回收这块刚才是谁说要外包的？', 'team-meet', 'flow_zh_fg', 'noclaim'),
  R('zh-E04', 'zh', 'E', '我家楼下那辆共享单车车锁坏了，停了半个月也没人管', 'general', 'arch_zh_bg', 'noclaim'),
  R('zh-E05', 'zh', 'E', '周五下班前记得把周报交了，别又拖到周六', 'team-meet', 'chart_zh_fg', 'noclaim'),
  R('zh-E06', 'zh', 'E', '你们公司支付是月结还是季结？发票能开专票吗？', 'sales', 'arch_zh_fg', 'noclaim'),
  R('zh-E07', 'zh', 'E', '试骑活动的报名链接谁有？发我一下', 'general', 'flow_zh_fg', 'noclaim'),
  R('zh-E08', 'zh', 'E', '小王你回头把上次那个甘特图更新一下发我', 'team-meet', 'arch_zh_bg', 'noclaim'),
  R('zh-E09', 'zh', 'E', '调度那边今晚谁值班？', 'team-meet', 'arch_zh_fg', 'noclaim'),
  R('zh-E10', 'zh', 'E', '回头我自己用Excel做个柱状图发群里，你们不用管', 'team-meet', 'chart_zh_fg', 'noclaim'),

  // F — chart on the table
  R('zh-F01', 'zh', 'F', '周六怎么比周日高出这么多？', 'sales', 'chart_zh_fg', 'claim', { op: 'explain' }),
  R('zh-F02', 'zh', 'F', '标题改成“工作日与周末骑行对比”，纵轴单位写清楚是“次”', 'team-meet', 'chart_zh_fg', 'claim', { op: 'update' }),
  R('zh-F03', 'zh', 'F', '这个别用图了，给我列成表格吧', 'sales', 'chart_zh_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('zh-F04', 'zh', 'F', '骑行次数多了膝盖会不会受不了啊，我最近天天骑车上班', 'general', 'chart_zh_fg', 'noclaim'),

  // G — process flowchart on the table
  R('zh-G01', 'zh', 'G', '锁定车辆和调度车回收这两步能不能同时做，为什么非得一前一后？', 'lecture', 'flow_zh_fg', 'claim', { op: 'explain' }),
  R('zh-G02', 'zh', 'G', '报废那条分支后面再接一步，通知财务做资产核销', 'team-meet', 'flow_zh_fg', 'claim', { op: 'update' }),
  R('zh-G03', 'zh', 'G', '用户那边我下午再回个电话，报修工单先挂着', 'call-center', 'flow_zh_fg', 'noclaim'),

  // ───────────────────────────── JAPANESE ─────────────────────────────
  // A — must draw, nothing on the table
  R('ja-A01', 'ja', 'A', 'ホテルの予約システムを想定して、全体のシステム構成図を一枚お願いします。', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('ja-A02', 'ja', 'A', 'ログインのとき、ブラウザと認証サーバーとAPIがどういう順番でやりとりするか、シーケンス図にして', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('ja-A03', 'ja', 'A', '月ごとの問い合わせ件数を折れ線グラフで見せてほしいねんけど', 'call-center', 'none', 'draw', { view: 'chart' }),
  R('ja-A04', 'ja', 'A', '今日話に出た課題を、内容・担当・期限の三列で一覧表にまとめていただけますか。', 'team-meet', 'none', 'draw', { view: 'matrix' }),
  R('ja-A05', 'ja', 'A', '新卒採用のスケジュール、ガントチャートでざっくり引いてみて', 'recruiting', 'none', 'draw', { view: 'gantt' }),
  R('ja-A06', 'ja', 'A', 'サポートチケットが「新規」「対応中」「保留」「解決」でどう移り変わるか、状態遷移図がほしいです', 'technical-interview', 'none', 'draw', { view: 'state' }),
  R('ja-A07', 'ja', 'A', '誰がどの作業を担当するのか、営業・開発・サポートでレーンを分けて図にしてもらえへん？', 'team-meet', 'none', 'draw', { view: 'responsibility' }),
  R('ja-A08', 'ja', 'A', 'えっと新入社員の入社手続きの流れなんですけど内定から初日までフローチャートでお願いします', 'recruiting', 'none', 'draw', { view: 'flowchart' }),
  R('ja-A09', 'ja', 'A', '会社の沿革を年表にしてくれる？創業、上場、海外進出あたりで', 'general', 'none', 'draw', { view: 'timeline' }),
  R('ja-A10', 'ja', 'A', '言葉だけやとわかりにくいな。うちの社内ネットワークの構成、ぱっと見てわかるようにしてくれへん？', 'team-meet', 'none', 'draw'),

  // B — must not draw, nothing on the table
  R('ja-B01', 'ja', 'B', '前の会社では毎週フローチャートを書かされてたんで、正直もう見たくないです。', 'looking-for-work', 'none', 'nodraw'),
  R('ja-B02', 'ja', 'B', 'それは絵に描いた餅やで、予算もないのにどうやってやるん', 'team-meet', 'none', 'nodraw'),
  R('ja-B03', 'ja', 'B', 'お客さんに「図で説明して」って言われたんですけど、電話口じゃ無理ですよね。', 'call-center', 'none', 'nodraw'),
  R('ja-B04', 'ja', 'B', 'グラフは来週の資料を作るときに私のほうでまとめて作りますので、今日は数字だけ確認させてください。', 'sales', 'none', 'nodraw'),
  R('ja-B05', 'ja', 'B', 'この前もらった路線図、字が小さすぎて老眼にはきついわ', 'general', 'none', 'nodraw'),
  R('ja-B06', 'ja', 'B', 'すみません、先ほど部長がおっしゃっていた図面の締め切り、いつでしたか。', 'team-meet', 'none', 'nodraw'),
  R('ja-B07', 'ja', 'B', 'うちの息子、設計図も見んとプラモデル組み立てよるんですわ', 'general', 'none', 'nodraw'),
  R('ja-B08', 'ja', 'B', '図書館で借りた本返すの忘れてた', 'general', 'none', 'nodraw'),
  R('ja-B09', 'ja', 'B', 'グラフ用紙ってまだ売ってるんですね、文房具屋で見かけてびっくりしました', 'general', 'none', 'nodraw'),
  R('ja-B10', 'ja', 'B', '図にしたほうがええんかな、どう思う？', 'team-meet', 'none', 'nodraw', BL),

  // C — question about the architecture on the table
  R('ja-C01', 'ja', 'C', 'ライドサービスが落ちたら、返却ってできなくなるんですか？', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C02', 'ja', 'C', '在庫DBのとこだけ形ちゃうのはなんで？', 'team-meet', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C03', 'ja', 'C', '決済のところ、二重課金を防ぐ仕組みはこの中のどこが持ってるんですか', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C04', 'ja', 'C', 'この図でいうと、ロック制御は自転車本体とどうやって通信してる想定ですか。', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C05', 'ja', 'C', 'イベントキューに流れるイベントって、具体的にどんな種類があるんですか？', 'team-meet', 'arch_ja_bg', 'claim', { op: 'explain' }),
  R('ja-C06', 'ja', 'C', 'なんでゲートウェイからキューに直接つないでへんの？', 'general', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C07', 'ja', 'C', '先ほど見せていただいたアーキテクチャの件で、通知サービスはプッシュ通知だけでしょうか、それともメールも送るのでしょうか。', 'sales', 'arch_ja_bg', 'claim', { op: 'explain' }),
  R('ja-C08', 'ja', 'C', 'この中で自前で作らんと買ってきたほうがええのはどれやと思う？', 'lecture', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C09', 'ja', 'C', 'ライダーアプリが圏外のとき、GWまで届かへんわけやけど、ロックはどうなるん？', 'team-meet', 'arch_ja_fg', 'claim', { op: 'explain' }),

  // D — change to the architecture on the table
  R('ja-D01', 'ja', 'D', '通知サービスからライダーアプリに戻る矢印が抜けているので、足してください。', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D02', 'ja', 'D', '決済サービスは外部のやつ使うから、枠を点線にしといて', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D03', 'ja', 'D', '「再配置プランナー」は来期の話やから、グレーにして「予定」って書いといて', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D04', 'ja', 'D', 'あと、管理画面を追加して在庫DBにつないでもらえますか', 'sales', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D05', 'ja', 'D', 'ドライバーさんの分が抜けてるわ。回収トラック用のアプリを足して、プランナーから指示が飛ぶようにして。', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D06', 'ja', 'D', '在庫DBは車両用とステーション用に分けなくていいので、ひとつのまま、横に検索用のキャッシュだけ足してください', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D07', 'ja', 'D', 'すみません話戻るんですが、構成図のイベントキューの先に分析基盤を足していただけますか。', 'sales', 'arch_ja_bg', 'claim', { op: 'update' }),
  R('ja-D08', 'ja', 'D', '全体をもうちょいシンプルにしたいから、キューを消して直接つなぐ形にしてみて', 'general', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D09', 'ja', 'D', '今の話を踏まえると、決済が失敗したときにロックを開けないようにしたいので、決済からロック制御に線を引いてほしいです。', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),

  // E — a drawing is on the table, the sentence is about something else
  R('ja-E01', 'ja', 'E', '通知きてたのに気づかんかった、ごめん、何の件やっけ？', 'team-meet', 'arch_ja_fg', 'noclaim'),
  R('ja-E02', 'ja', 'E', 'ロックかけ忘れて家出てきたかもしれん、ちょっと不安やわ', 'general', 'arch_ja_fg', 'noclaim'),
  R('ja-E03', 'ja', 'E', 'さっき田中さん、廃車は年に何台くらいって言うてはったっけ？', 'team-meet', 'flow_ja_fg', 'noclaim'),
  R('ja-E04', 'ja', 'E', '在庫の棚卸しって今月は何日にやるんでしたっけ。', 'team-meet', 'arch_ja_bg', 'noclaim'),
  R('ja-E05', 'ja', 'E', '金曜の定例、祝日とかぶるんで木曜に前倒しでいいですか？', 'team-meet', 'chart_ja_fg', 'noclaim'),
  R('ja-E06', 'ja', 'E', 'ゲートウェイって言えば、高輪ゲートウェイ駅って降りたことあります？', 'general', 'arch_ja_bg', 'noclaim'),
  R('ja-E07', 'ja', 'E', 'ステーションワゴンに買い替えたんですよ、荷物がようけ積めて助かってます', 'general', 'flow_ja_fg', 'noclaim'),
  R('ja-E08', 'ja', 'E', '図々しいお願いで恐縮ですが、納期を一週間だけ延ばしていただけないでしょうか。', 'sales', 'arch_ja_fg', 'noclaim'),
  R('ja-E09', 'ja', 'E', '部長に来週までに売上のグラフ作っといてって言われてて、今夜やるつもりです', 'general', 'chart_ja_fg', 'noclaim'),
  R('ja-E10', 'ja', 'E', '株のチャート見てたら昨日だいぶ下がってて、ちょっとへこんでます', 'general', 'chart_ja_fg', 'noclaim'),

  // F — chart on the table
  R('ja-F01', 'ja', 'F', '金曜だけ低いのはどうしてですか？', 'sales', 'chart_ja_fg', 'claim', { op: 'explain' }),
  R('ja-F02', 'ja', 'F', '土曜の棒だけ色を変えて目立たせてください', 'team-meet', 'chart_ja_fg', 'claim', { op: 'update' }),
  R('ja-F03', 'ja', 'F', 'グラフやなくて表で見たいわ、同じ数字で', 'sales', 'chart_ja_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ja-F04', 'ja', 'F', '利用回数の上限って、うちの契約だと月に何回でしたっけ？', 'sales', 'chart_ja_fg', 'noclaim', BL),

  // G — process flowchart on the table
  R('ja-G01', 'ja', 'G', 'この流れだと、修理が終わった自転車はどこに戻るんですか？', 'call-center', 'flow_ja_fg', 'claim', { op: 'explain' }),
  R('ja-G02', 'ja', 'G', '最初の受付のあとに「ユーザーへお詫びクーポン送付」を入れといて', 'team-meet', 'flow_ja_fg', 'claim', { op: 'update' }),
  R('ja-G03', 'ja', 'G', '点検といえば、来月うちの車の車検なんよな、また出費や', 'general', 'flow_ja_fg', 'noclaim'),
];
