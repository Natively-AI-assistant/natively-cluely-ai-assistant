// Independent measurement set #3 for resolveDiagramRequest — es / ru / zh / ja.
// Written and labelled BEFORE the function was run on any of these sentences,
// by an author who has never read the rules under test.
// Labels = what a sensible listener in the meeting would expect.
//
// Fixture domain: a veterinary clinic — appointments and pharmacy.
// Three kinds of drawing can be "on the table":
//   arch_<lang>_fg / arch_<lang>_bg  — the system architecture (in focus / in background)
//   chart_<lang>_fg                  — a bar chart of weekly appointments by visit type
//   flow_<lang>_fg                   — the prescription-refill process as a flowchart

const SRC = {
  es: `flowchart LR
  portal["Portal de clientes"] --> gw[Pasarela de API]
  gw --> citas["Servicio de citas"]
  gw --> farmacia[Servicio de recetas y farmacia]
  citas --> historias[(Base de datos de historias clínicas)]
  farmacia --> historias
  farmacia --> pedidos[[Cola de pedidos]]
  pedidos --> inventario[Inventario de medicamentos]
  citas --> correo["Notificaciones por correo"]`,
  ru: `flowchart LR
  portal["Портал для владельцев"] --> gw[Шлюз API]
  gw --> appt["Сервис записи на приём"]
  gw --> pharm[Сервис рецептов и аптеки]
  appt --> records[(База медицинских карт)]
  pharm --> records
  pharm --> orders[[Очередь заказов]]
  orders --> stock[Учёт лекарств на складе]
  appt --> mail["Уведомления по почте"]`,
  zh: `flowchart LR
  portal["宠物主人门户"] --> gw[API 网关]
  gw --> appt["预约服务"]
  gw --> pharm[处方与药房服务]
  appt --> records[(病历数据库)]
  pharm --> records
  pharm --> orders[[订单队列]]
  orders --> stock[药品库存管理]
  appt --> mail["邮件通知服务"]`,
  ja: `flowchart LR
  portal["飼い主向けポータル"] --> gw[API ゲートウェイ]
  gw --> appt["予約サービス"]
  gw --> pharm[処方箋と薬局のサービス]
  appt --> records[(カルテのデータベース)]
  pharm --> records
  pharm --> orders[[注文キュー]]
  orders --> stock[薬の在庫管理]
  appt --> mail["メール通知"]`,
};

const FLOW_SRC = {
  es: `flowchart TD
  a[El cliente pide la reposición de la receta] --> b[Recepción verifica la ficha de la mascota]
  b --> c{"¿La receta sigue vigente?"}
  c -->|Sí| d[Farmacia prepara el medicamento]
  c -->|No| e[El veterinario revisa y renueva la receta]
  e --> d
  d --> f[Se avisa al cliente para la recogida]`,
  ru: `flowchart TD
  a[Владелец просит продлить рецепт] --> b[Регистратура проверяет карту питомца]
  b --> c{"Рецепт ещё действует?"}
  c -->|Да| d[Аптека собирает лекарство]
  c -->|Нет| e[Ветеринар продлевает рецепт]
  e --> d
  d --> f["Владельцу сообщают, что заказ можно забрать"]`,
  zh: `flowchart TD
  a[主人申请续开处方] --> b[前台核对宠物档案]
  b --> c{"处方还在有效期内吗"}
  c -->|是| d[药房配药]
  c -->|否| e[兽医复核并续方]
  e --> d
  d --> f[通知主人来取药]`,
  ja: `flowchart TD
  a[飼い主が処方箋の再発行を依頼する] --> b[受付がペットのカルテを確認する]
  b --> c{"処方箋はまだ有効か"}
  c -->|はい| d[薬局が薬を用意する]
  c -->|いいえ| e[獣医が診て処方箋を更新する]
  e --> d
  d --> f[飼い主に受け取りの連絡をする]`,
};

const CHART = {
  es: { title: 'Citas por tipo de consulta', x: 'Tipo de consulta', cats: ['Vacunas', 'Cirugías', 'Urgencias', 'Revisiones'], y: 'Citas por semana', series: 'Citas' },
  ru: { title: 'Приёмы по типам обращений', x: 'Тип обращения', cats: ['Вакцинация', 'Операции', 'Экстренные', 'Осмотры'], y: 'Приёмов в неделю', series: 'Приёмы' },
  zh: { title: '各类就诊的预约量', x: '就诊类型', cats: ['疫苗', '手术', '急诊', '体检'], y: '每周预约数', series: '预约数' },
  ja: { title: '診療の種類ごとの予約数', x: '診療の種類', cats: ['ワクチン', '手術', '救急', '健康診断'], y: '週あたりの予約数', series: '予約数' },
};

const fx = (lang, foreground) => ({
  artifactId: 'design-1.v1',
  artifact: 'mermaid',
  view: 'architecture',
  version: 1,
  foreground,
  source: SRC[lang],
});

const chartFx = (lang) => ({
  artifactId: 'chart-1.v1',
  artifact: 'chart',
  view: 'chart',
  version: 1,
  foreground: true,
  source: JSON.stringify({
    v: 1,
    type: 'bar',
    title: CHART[lang].title,
    x: { label: CHART[lang].x, values: CHART[lang].cats },
    y: { label: CHART[lang].y },
    series: [{ name: CHART[lang].series, values: [12, 18, 9, 22], status: 'illustrative' }],
  }),
});

const flowFx = (lang) => ({
  artifactId: 'flow-1.v1',
  artifact: 'mermaid',
  view: 'flowchart',
  version: 1,
  foreground: true,
  source: FLOW_SRC[lang],
});

export const FIXTURES = {
  arch_es_fg: fx('es', true),
  arch_es_bg: fx('es', false),
  arch_ru_fg: fx('ru', true),
  arch_ru_bg: fx('ru', false),
  arch_zh_fg: fx('zh', true),
  arch_zh_bg: fx('zh', false),
  arch_ja_fg: fx('ja', true),
  arch_ja_bg: fx('ja', false),
  chart_es_fg: chartFx('es'),
  chart_ru_fg: chartFx('ru'),
  chart_zh_fg: chartFx('zh'),
  chart_ja_fg: chartFx('ja'),
  flow_es_fg: flowFx('es'),
  flow_ru_fg: flowFx('ru'),
  flow_zh_fg: flowFx('zh'),
  flow_ja_fg: flowFx('ja'),
};

const R = (id, lang, list, q, mode, ctx, expect, extra = {}) => ({ id, lang, list, q, mode, ctx, expect, ...extra });
const BL = { borderline: true };

export const ROWS = [
  // ───────────────────────────── SPANISH ─────────────────────────────
  // A — must draw, nothing on the table
  R('es-A01', 'es', 'A', 'Dibujá la arquitectura de una app de reparto de comida, con sus servicios y sus bases de datos.', 'general', 'none', 'draw', { view: 'architecture' }),
  R('es-A02', 'es', 'A', 'un diagrama de secuencia del pago con tarjeta por favor', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('es-A03', 'es', 'A', 'Oye, ¿me echas la mano con un diagrama de flujo de cómo se tramita una incapacidad?', 'call-center', 'none', 'draw', { view: 'flowchart' }),
  R('es-A04', 'es', 'A', 'Me gustaría ver en un diagrama de Gantt las fases de la mudanza de la oficina.', 'team-meet', 'none', 'draw', { view: 'gantt' }),
  R('es-A05', 'es', 'A', 'Estamos comparando tres proveedores de nube. ¿Me lo ponés en una tabla comparativa con precio, soporte y latencia?', 'sales', 'none', 'draw', { view: 'matrix' }),
  R('es-A06', 'es', 'A', 'muéstrame con un gráfico de barras las ventas por región del último trimestre', 'sales', 'none', 'draw', { view: 'chart' }),
  R('es-A07', 'es', 'A', 'A ver, supongamos una biblioteca municipal. ¿Cómo modelarías los datos? Hazme el diagrama entidad-relación.', 'technical-interview', 'none', 'draw', { view: 'er' }),
  R('es-A08', 'es', 'A', 'Necesitaría un organigrama del equipo de soporte, que se vea quién reporta a quién.', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('es-A09', 'es', 'A', 'explicame visualmente cómo funciona un balanceador de carga', 'general', 'none', 'draw', BL),
  R('es-A10', 'es', 'A', 'Los estados de un pedido en línea, creado, pagado, enviado, entregado y devuelto, ¿me los dibujas como máquina de estados?', 'technical-interview', 'none', 'draw', { view: 'state' }),

  // B — must NOT draw, nothing on the table
  R('es-B01', 'es', 'B', 'Ayer dibujé la arquitectura en la pizarra y nadie me dijo nada.', 'team-meet', 'none', 'nodraw'),
  R('es-B02', 'es', 'B', 'marcos ya terminó el diagrama de flujo y lo subió a la carpeta compartida', 'team-meet', 'none', 'nodraw'),
  R('es-B03', 'es', 'B', '¿Qué es exactamente un diagrama de Gantt y para qué sirve?', 'lecture', 'none', 'nodraw'),
  R('es-B04', 'es', 'B', 'Rellena la tabla con tu nombre y tu número de empleado, porfa.', 'recruiting', 'none', 'nodraw'),
  R('es-B05', 'es', 'B', 'vamos con dos semanas de retraso respecto al cronograma', 'team-meet', 'none', 'nodraw'),
  R('es-B06', 'es', 'B', 'Redáctame el acta de la reunión de hoy y un correo para avisar al cliente del retraso.', 'team-meet', 'none', 'nodraw'),
  R('es-B07', 'es', 'B', 'Explicámelo en orden cronológico, sin diagramas ni nada, solo texto.', 'general', 'none', 'nodraw'),
  R('es-B08', 'es', 'B', 'Pintame el panorama del mercado de mascotas en Argentina, ¿cómo lo ves?', 'sales', 'none', 'nodraw'),
  R('es-B09', 'es', 'B', 'El arquitecto nos mandó los planos del local nuevo, ¿ya los viste?', 'general', 'none', 'nodraw'),
  R('es-B10', 'es', 'B', 'El perro llegó con un cuadro de gastroenteritis bastante feo.', 'general', 'none', 'nodraw'),

  // C — question about the architecture in focus
  R('es-C01', 'es', 'C', 'En este diagrama, ¿por qué el portal no habla directo con el servicio de citas?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C02', 'es', 'C', '¿Qué pasa si se cae la cola de pedidos?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C03', 'es', 'C', 'y la pasarela para qué está exactamente', 'team-meet', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C04', 'es', 'C', '¿Por qué citas y farmacia comparten la misma base de historias clínicas?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C05', 'es', 'C', 'Explicame la flecha que va de farmacia a la cola.', 'general', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C06', 'es', 'C', 'No me queda claro qué pinta aquí el inventario de medicamentos, ¿me lo explicas?', 'team-meet', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C07', 'es', 'C', 'las notificaciones por correo las dispara solo el servicio de citas o también el de recetas', 'team-meet', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C08', 'es', 'C', '¿Cuál sería el cuello de botella de este diseño si se triplican las reservas?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'explain' }),
  R('es-C09', 'es', 'C', 'y esto aguanta la campaña de vacunación de marzo o se nos cae', 'team-meet', 'arch_es_fg', 'claim', { ...BL, op: 'explain' }),

  // D — change to the architecture in focus
  R('es-D01', 'es', 'D', 'Agregá un servicio de facturación que cuelgue de la pasarela.', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D02', 'es', 'D', 'Vale, quita el inventario de medicamentos, eso lo lleva otro equipo.', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D03', 'es', 'D', 'cambia la cola de pedidos por kafka', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D04', 'es', 'D', 'Renombra el portal de clientes a "App de dueños".', 'general', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D05', 'es', 'D', 'Conecta el servicio de recetas con las notificaciones por correo, que también avise cuando el medicamento está listo.', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D06', 'es', 'D', 'falta una base de datos de documentos para guardar las radiografías, ponla al lado de la de historias clínicas', 'team-meet', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D07', 'es', 'D', 'Metele un worker que sincronice el calendario de los veterinarios con el del celular.', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D08', 'es', 'D', '¿Podrías poner una caché delante de la base de historias clínicas?', 'technical-interview', 'arch_es_fg', 'claim', { op: 'update' }),
  R('es-D09', 'es', 'D', 'Yo ahí pondría un balanceador delante de la pasarela.', 'technical-interview', 'arch_es_fg', 'claim', { ...BL, op: 'update' }),

  // E — a drawing is on the table, but the sentence is about something else
  R('es-E01', 'es', 'E', '¿Cuántos clientes nuevos tuvimos este trimestre?', 'sales', 'arch_es_fg', 'noclaim'),
  R('es-E02', 'es', 'E', 'Bueno, ¿y ahora qué sigue? ¿Cuáles son los siguientes pasos con el proveedor?', 'team-meet', 'arch_es_bg', 'noclaim'),
  R('es-E03', 'es', 'E', 'Agrega a María a la invitación de la reunión del jueves.', 'team-meet', 'arch_es_fg', 'noclaim'),
  R('es-E04', 'es', 'E', 'por qué había tanta cola en el banco esta mañana', 'general', 'arch_es_fg', 'noclaim'),
  R('es-E05', 'es', 'E', '¿Qué dijo Pedro sobre los pedidos atrasados del proveedor?', 'team-meet', 'arch_es_fg', 'noclaim'),
  R('es-E06', 'es', 'E', 'Este plan me parece demasiado caro para una clínica chica.', 'sales', 'arch_es_bg', 'noclaim'),
  R('es-E07', 'es', 'E', '¿Qué tan preciso es este modelo para detectar tumores en radiografías?', 'technical-interview', 'arch_es_fg', 'noclaim'),
  R('es-E08', 'es', 'E', 'tengo cita con el dentista a las cinco, terminamos antes', 'team-meet', 'arch_es_fg', 'noclaim'),
  R('es-E09', 'es', 'E', 'Pasame la receta de la torta de zanahoria que llevaste el viernes.', 'general', 'arch_es_bg', 'noclaim'),
  R('es-E10', 'es', 'E', '¿Me reenvías el correo de Laura con el presupuesto?', 'sales', 'arch_es_fg', 'noclaim'),

  // F — a chart is on the table
  R('es-F01', 'es', 'F', 'Pásame este gráfico a una tabla.', 'sales', 'chart_es_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('es-F02', 'es', 'F', 'lo puedo ver como tabla en vez de barras', 'team-meet', 'chart_es_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('es-F03', 'es', 'F', '¿Por qué las urgencias salen tan bajas comparadas con las revisiones?', 'team-meet', 'chart_es_fg', 'claim', { op: 'explain' }),
  R('es-F04', 'es', 'F', '¿A qué hora es la revisión médica de la empresa mañana?', 'general', 'chart_es_fg', 'noclaim'),

  // G — a process flowchart is on the table
  R('es-G01', 'es', 'G', 'En el paso donde recepción verifica la ficha, ¿qué miran exactamente?', 'call-center', 'flow_es_fg', 'claim', { op: 'explain' }),
  R('es-G02', 'es', 'G', 'añade un paso de cobro antes de avisar al cliente', 'call-center', 'flow_es_fg', 'claim', { op: 'update' }),
  R('es-G03', 'es', 'G', '¿Cuáles son nuestros próximos pasos para el lanzamiento de la app?', 'team-meet', 'flow_es_fg', 'noclaim'),

  // ───────────────────────────── RUSSIAN ─────────────────────────────
  // A — must draw, nothing on the table
  R('ru-A01', 'ru', 'A', 'Нарисуй архитектуру сервиса доставки еды: клиенты, курьеры, платежи.', 'general', 'none', 'draw', { view: 'architecture' }),
  R('ru-A02', 'ru', 'A', 'диаграмму последовательности как курьер подтверждает доставку пожалуйста', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('ru-A03', 'ru', 'A', 'Можешь изобразить блок-схему: что делать клиенту, если он потерял банковскую карту?', 'call-center', 'none', 'draw', { view: 'flowchart' }),
  R('ru-A04', 'ru', 'A', 'Покажи, как устроен конвейер CI/CD от коммита до продакшена.', 'technical-interview', 'none', 'draw', BL),
  R('ru-A05', 'ru', 'A', 'Мы выбираем между тремя CRM. Сведи их в сравнительную таблицу: цена, интеграции, поддержка.', 'sales', 'none', 'draw', { view: 'matrix' }),
  R('ru-A06', 'ru', 'A', 'построй график как росла выручка по кварталам за прошлый год', 'sales', 'none', 'draw', { view: 'chart' }),
  R('ru-A07', 'ru', 'A', 'Набросай ER-диаграмму для интернет-магазина.', 'technical-interview', 'none', 'draw', { view: 'er' }),
  R('ru-A08', 'ru', 'A', 'Хотелось бы увидеть оргструктуру отдела продаж в виде схемы: кто кому подчиняется.', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('ru-A09', 'ru', 'A', 'Давай так: я называю классы, а ты строишь диаграмму классов. Заказ, Позиция, Клиент, Платёж.', 'technical-interview', 'none', 'draw', { view: 'class' }),
  R('ru-A10', 'ru', 'A', 'Сделай мне дерево решений: брать ипотеку сейчас или подождать год.', 'general', 'none', 'draw', { view: 'decision' }),

  // B — must NOT draw, nothing on the table
  R('ru-B01', 'ru', 'B', 'Я вчера нарисовал архитектуру, но Лена сказала, что всё надо переделывать.', 'team-meet', 'none', 'nodraw'),
  R('ru-B02', 'ru', 'B', 'Он уже доделал блок-схему и отправил её заказчику.', 'team-meet', 'none', 'nodraw'),
  R('ru-B03', 'ru', 'B', 'мы отстаём от графика недели на две', 'team-meet', 'none', 'nodraw'),
  R('ru-B04', 'ru', 'B', 'Заполни таблицу в общем доступе и впиши туда свою фамилию.', 'recruiting', 'none', 'nodraw'),
  R('ru-B05', 'ru', 'B', 'А что такое диаграмма состояний и чем она отличается от блок-схемы?', 'lecture', 'none', 'nodraw'),
  R('ru-B06', 'ru', 'B', 'Напиши протокол встречи и разошли участникам.', 'team-meet', 'none', 'nodraw'),
  R('ru-B07', 'ru', 'B', 'Обрисуй в двух словах ситуацию с поставщиками.', 'sales', 'none', 'nodraw'),
  R('ru-B08', 'ru', 'B', 'расскажи по порядку что случилось только без схем просто словами', 'call-center', 'none', 'nodraw'),
  R('ru-B09', 'ru', 'B', 'У меня график работы два через два, в субботу выйти не смогу.', 'looking-for-work', 'none', 'nodraw'),
  R('ru-B10', 'ru', 'B', 'Дочка весь вечер рисовала комиксы про нашего кота.', 'general', 'none', 'nodraw'),

  // C — question about the architecture in focus
  R('ru-C01', 'ru', 'C', 'А на этой схеме почему портал ходит через шлюз, а не напрямую в сервис записи?', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C02', 'ru', 'C', 'Что будет, если очередь заказов упадёт?', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C03', 'ru', 'C', 'зачем аптеке доступ к базе медкарт', 'team-meet', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C04', 'ru', 'C', 'Объясни, что делает учёт лекарств и откуда он берёт данные.', 'general', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C05', 'ru', 'C', 'Почему стрелка идёт от аптеки к очереди, а не наоборот?', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C06', 'ru', 'C', 'Уведомления по почте отправляет только сервис записи или сервис рецептов тоже?', 'team-meet', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C07', 'ru', 'C', 'а шлюз тут не станет единой точкой отказа', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C08', 'ru', 'C', 'Где на этой диаграмме хранятся данные о прививках?', 'lecture', 'arch_ru_fg', 'claim', { op: 'explain' }),
  R('ru-C09', 'ru', 'C', 'а оно вообще выдержит, если клиник станет в десять раз больше', 'team-meet', 'arch_ru_fg', 'claim', { ...BL, op: 'explain' }),

  // D — change to the architecture in focus
  R('ru-D01', 'ru', 'D', 'Добавь рядом с аптекой сервис счетов, чтобы выставлять счета владельцам.', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D02', 'ru', 'D', 'Убери учёт лекарств, он у нас в отдельной системе.', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D03', 'ru', 'D', 'замени очередь заказов на rabbitmq', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D04', 'ru', 'D', 'Переименуй портал для владельцев в «Личный кабинет».', 'general', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D05', 'ru', 'D', 'Соедини сервис рецептов с уведомлениями по почте.', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D06', 'ru', 'D', 'ещё нужна база документов для рентгеновских снимков, добавь её рядом с медкартами', 'team-meet', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D07', 'ru', 'D', 'Вставь воркер синхронизации календаря врачей, пусть подписывается на сервис записи.', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),
  R('ru-D08', 'ru', 'D', 'А давай вместо почты сделаем сервис смс-рассылки.', 'team-meet', 'arch_ru_fg', 'claim', { ...BL, op: 'update' }),
  R('ru-D09', 'ru', 'D', 'Можно добавить очередь писем перед уведомлениями, чтобы ничего не терялось при сбоях?', 'technical-interview', 'arch_ru_fg', 'claim', { op: 'update' }),

  // E — a drawing is on the table, but the sentence is about something else
  R('ru-E01', 'ru', 'E', 'Сколько у нас клиентов в этом квартале?', 'sales', 'arch_ru_fg', 'noclaim'),
  R('ru-E02', 'ru', 'E', 'Ну и что дальше, какие следующие шаги по договору?', 'team-meet', 'arch_ru_bg', 'noclaim'),
  R('ru-E03', 'ru', 'E', 'Добавь Машу в приглашение на завтрашнюю встречу.', 'team-meet', 'arch_ru_fg', 'noclaim'),
  R('ru-E04', 'ru', 'E', 'почему в банке сегодня была такая очередь', 'general', 'arch_ru_fg', 'noclaim'),
  R('ru-E05', 'ru', 'E', 'Что Пётр говорил про заказы — их уже отгрузили?', 'team-meet', 'arch_ru_fg', 'noclaim'),
  R('ru-E06', 'ru', 'E', 'Этот тариф для нас слишком дорогой.', 'sales', 'arch_ru_bg', 'noclaim'),
  R('ru-E07', 'ru', 'E', 'Насколько точна эта модель на реальных снимках, вы её проверяли?', 'technical-interview', 'arch_ru_fg', 'noclaim'),
  R('ru-E08', 'ru', 'E', 'Пришли, пожалуйста, запись вчерашней встречи.', 'team-meet', 'arch_ru_fg', 'noclaim'),
  R('ru-E09', 'ru', 'E', 'карта не проходит можно оплатить по счёту', 'call-center', 'arch_ru_bg', 'noclaim'),
  R('ru-E10', 'ru', 'E', 'Дай рецепт того пирога, который ты приносила в пятницу.', 'general', 'arch_ru_bg', 'noclaim'),

  // F — a chart is on the table
  R('ru-F01', 'ru', 'F', 'Покажи этот график в виде таблицы.', 'sales', 'chart_ru_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ru-F02', 'ru', 'F', 'можно то же самое таблицей а не столбиками', 'team-meet', 'chart_ru_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ru-F03', 'ru', 'F', 'Почему операций получилось больше, чем вакцинаций?', 'team-meet', 'chart_ru_fg', 'claim', { op: 'explain' }),
  R('ru-F04', 'ru', 'F', 'У меня завтра плановый осмотр у стоматолога, буду после обеда.', 'general', 'chart_ru_fg', 'noclaim'),

  // G — a process flowchart is on the table
  R('ru-G01', 'ru', 'G', 'А что происходит на шаге, где регистратура проверяет карту?', 'call-center', 'flow_ru_fg', 'claim', { op: 'explain' }),
  R('ru-G02', 'ru', 'G', 'Добавь шаг оплаты перед тем, как сообщать владельцу.', 'call-center', 'flow_ru_fg', 'claim', { op: 'update' }),
  R('ru-G03', 'ru', 'G', 'какие у нас следующие шаги по запуску приложения', 'team-meet', 'flow_ru_fg', 'noclaim'),

  // ───────────────────────────── CHINESE ─────────────────────────────
  // A — must draw, nothing on the table
  R('zh-A01', 'zh', 'A', '帮我画一个外卖平台的系统架构图，包括用户端、骑手端和支付。', 'general', 'none', 'draw', { view: 'architecture' }),
  R('zh-A02', 'zh', 'A', '扫码点餐的时序图 麻烦来一个', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('zh-A03', 'zh', 'A', '微服务之间是怎么互相调用的，给我示意一下。', 'technical-interview', 'none', 'draw', BL),
  R('zh-A04', 'zh', 'A', '能不能用流程图把新员工入职第一周的安排画出来？', 'recruiting', 'none', 'draw', { view: 'flowchart' }),
  R('zh-A05', 'zh', 'A', '我们在比较三家云厂商，价格、售后、延迟，给我列个对比表。', 'sales', 'none', 'draw', { view: 'matrix' }),
  R('zh-A06', 'zh', 'A', '用柱状图展示一下各个季度的销售额', 'sales', 'none', 'draw', { view: 'chart' }),
  R('zh-A07', 'zh', 'A', '先说下背景，我们要做一个图书馆管理系统。你给出个ER图吧。', 'technical-interview', 'none', 'draw', { view: 'er' }),
  R('zh-A08', 'zh', 'A', '给我出一张销售部的组织架构图，谁向谁汇报要标清楚。', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('zh-A09', 'zh', 'A', '帮我做个思维导图 主题是减少塑料垃圾的办法', 'general', 'none', 'draw', { view: 'mindmap' }),
  R('zh-A10', 'zh', 'A', '订单从下单到签收有哪些状态？画个状态图给我看看。', 'technical-interview', 'none', 'draw', { view: 'state' }),

  // B — must NOT draw, nothing on the table
  R('zh-B01', 'zh', 'B', '我昨天已经把架构图画好了，发群里了。', 'team-meet', 'none', 'nodraw'),
  R('zh-B02', 'zh', 'B', '他流程图早就做完了，现在在写文档。', 'team-meet', 'none', 'nodraw'),
  R('zh-B03', 'zh', 'B', '我们的进度已经比计划表落后两周了', 'team-meet', 'none', 'nodraw'),
  R('zh-B04', 'zh', 'B', '请把你的名字填到表格里，然后发给人事。', 'recruiting', 'none', 'nodraw'),
  R('zh-B05', 'zh', 'B', '什么是时序图？跟流程图有什么区别？', 'lecture', 'none', 'nodraw'),
  R('zh-B06', 'zh', 'B', '他试图说服客户续约，但最后没成功。', 'sales', 'none', 'nodraw'),
  R('zh-B07', 'zh', 'B', '老板又在给我们画饼，说年底人人涨薪。', 'general', 'none', 'nodraw'),
  R('zh-B08', 'zh', 'B', '按时间顺序给我讲一遍就行 不用画图', 'general', 'none', 'nodraw'),
  R('zh-B09', 'zh', 'B', '狗狗的心电图结果出来了，医生说没问题。', 'general', 'none', 'nodraw'),
  R('zh-B10', 'zh', 'B', '帮我画一下重点，这份合同哪些条款要注意。', 'sales', 'none', 'nodraw'),

  // C — question about the architecture in focus
  R('zh-C01', 'zh', 'C', '这张图里，门户为什么不直接调预约服务？', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C02', 'zh', 'C', '订单队列要是挂了会怎么样？', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C03', 'zh', 'C', '网关在这里起什么作用', 'team-meet', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C04', 'zh', 'C', '为什么预约和药房共用一个病历库？', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C05', 'zh', 'C', '药房到队列的那条线是什么意思？', 'general', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C06', 'zh', 'C', '库存管理这块具体是干嘛的，数据从哪儿来？', 'team-meet', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C07', 'zh', 'C', '邮件通知只有预约服务会触发吗 处方那边会不会也发', 'team-meet', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C08', 'zh', 'C', '这个架构图里哪个环节最容易成为瓶颈？', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'explain' }),
  R('zh-C09', 'zh', 'C', '那这样会不会有单点故障', 'technical-interview', 'arch_zh_fg', 'claim', { ...BL, op: 'explain' }),

  // D — change to the architecture in focus
  R('zh-D01', 'zh', 'D', '加一个账单服务，挂在网关后面。', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D02', 'zh', 'D', '把药品库存管理去掉吧，那块归别的团队。', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D03', 'zh', 'D', '订单队列换成 Kafka', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D04', 'zh', 'D', '把宠物主人门户改名叫“客户小程序”。', 'general', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D05', 'zh', 'D', '把处方服务也连到邮件通知上，药配好了要通知主人。', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D06', 'zh', 'D', '还缺一个文档数据库存X光片 加在病历库旁边', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D07', 'zh', 'D', '再加个日历同步的 worker，把医生的排班同步到手机日历。', 'technical-interview', 'arch_zh_fg', 'claim', { op: 'update' }),
  R('zh-D08', 'zh', 'D', '我觉得药房和库存之间应该直接连起来，不用走队列。', 'technical-interview', 'arch_zh_fg', 'claim', { ...BL, op: 'update' }),
  R('zh-D09', 'zh', 'D', '除了邮件，再加一个微信消息推送服务。', 'team-meet', 'arch_zh_fg', 'claim', { op: 'update' }),

  // E — a drawing is on the table, but the sentence is about something else
  R('zh-E01', 'zh', 'E', '我们这个季度一共有多少客户？', 'sales', 'arch_zh_fg', 'noclaim'),
  R('zh-E02', 'zh', 'E', '那接下来的步骤是什么，谁来跟进？', 'team-meet', 'arch_zh_bg', 'noclaim'),
  R('zh-E03', 'zh', 'E', '把小李加到周四的会议邀请里。', 'team-meet', 'arch_zh_fg', 'noclaim'),
  R('zh-E04', 'zh', 'E', '今天银行怎么排那么长的队', 'general', 'arch_zh_fg', 'noclaim'),
  R('zh-E05', 'zh', 'E', '老王刚才说订单的事是怎么说的来着？', 'team-meet', 'arch_zh_fg', 'noclaim'),
  R('zh-E06', 'zh', 'E', '这个套餐对我们来说太贵了。', 'sales', 'arch_zh_bg', 'noclaim'),
  R('zh-E07', 'zh', 'E', '这个模型在新数据上的准确率有多高？', 'technical-interview', 'arch_zh_fg', 'noclaim'),
  R('zh-E08', 'zh', 'E', '我下午三点预约了牙医，可能得早点走。', 'team-meet', 'arch_zh_fg', 'noclaim'),
  R('zh-E09', 'zh', 'E', '医生给我开的处方药吃了老犯困', 'general', 'arch_zh_bg', 'noclaim'),
  R('zh-E10', 'zh', 'E', '那封邮件你收到通知了吗，我昨晚发的。', 'team-meet', 'arch_zh_bg', 'noclaim'),

  // F — a chart is on the table
  R('zh-F01', 'zh', 'F', '把这张图表换成表格给我看。', 'sales', 'chart_zh_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('zh-F02', 'zh', 'F', '这个能不能不用柱子 直接列成表', 'team-meet', 'chart_zh_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('zh-F03', 'zh', 'F', '急诊为什么比体检少这么多？', 'team-meet', 'chart_zh_fg', 'claim', { op: 'explain' }),
  R('zh-F04', 'zh', 'F', '公司体检是下周几来着？', 'general', 'chart_zh_fg', 'noclaim'),

  // G — a process flowchart is on the table
  R('zh-G01', 'zh', 'G', '前台核对档案那一步具体要查什么？', 'call-center', 'flow_zh_fg', 'claim', { op: 'explain' }),
  R('zh-G02', 'zh', 'G', '在通知主人之前加一步收费。', 'call-center', 'flow_zh_fg', 'claim', { op: 'update' }),
  R('zh-G03', 'zh', 'G', '我们产品上线的下一步是什么', 'team-meet', 'flow_zh_fg', 'noclaim'),

  // ───────────────────────────── JAPANESE ─────────────────────────────
  // A — must draw, nothing on the table
  R('ja-A01', 'ja', 'A', 'フードデリバリーアプリのアーキテクチャ図を描いてください。', 'general', 'none', 'draw', { view: 'architecture' }),
  R('ja-A02', 'ja', 'A', 'ATMでお金を引き出すときのシーケンス図 お願いします', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('ja-A03', 'ja', 'A', 'マイクロサービス同士のやり取り、見える化してもらえる？', 'technical-interview', 'none', 'draw', BL),
  R('ja-A04', 'ja', 'A', 'オフィス移転の各フェーズをガントチャートで見たいんだけど。', 'team-meet', 'none', 'draw', { view: 'gantt' }),
  R('ja-A05', 'ja', 'A', 'クラウド三社を比べてるんですが、料金・サポート・遅延で比較表にまとめてください。', 'sales', 'none', 'draw', { view: 'matrix' }),
  R('ja-A06', 'ja', 'A', '四半期ごとの売上を棒グラフで見せて', 'sales', 'none', 'draw', { view: 'chart' }),
  R('ja-A07', 'ja', 'A', 'ロードバランサーの仕組みを図解してほしいです。', 'lecture', 'none', 'draw'),
  R('ja-A08', 'ja', 'A', '営業部の組織図を作ってもらえますか。誰が誰の上司か分かるように。', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('ja-A09', 'ja', 'A', '会社の創業から今までの出来事を年表にしてください。', 'general', 'none', 'draw', { view: 'timeline' }),
  R('ja-A10', 'ja', 'A', '注文って発注から配達完了までいろいろ変わりますよね。それを状態遷移図にしてほしいです。', 'technical-interview', 'none', 'draw', { view: 'state' }),

  // B — must NOT draw, nothing on the table
  R('ja-B01', 'ja', 'B', '昨日アーキテクチャ図を描いたんですけど、まだ誰も見てくれてなくて。', 'team-meet', 'none', 'nodraw'),
  R('ja-B02', 'ja', 'B', '田中さんがもうフローチャートを仕上げてくれました。', 'team-meet', 'none', 'nodraw'),
  R('ja-B03', 'ja', 'B', 'スケジュールが二週間ほど押してます', 'team-meet', 'none', 'nodraw'),
  R('ja-B04', 'ja', 'B', 'この表に名前と社員番号を記入してください。', 'recruiting', 'none', 'nodraw'),
  R('ja-B05', 'ja', 'B', 'シーケンス図って何ですか？フローチャートとどう違うんでしょう。', 'lecture', 'none', 'nodraw'),
  R('ja-B06', 'ja', 'B', '先方の意図がよく分からないので、もう一度メールで確認します。', 'sales', 'none', 'nodraw'),
  R('ja-B07', 'ja', 'B', 'コスト削減を図るために、外注を減らす方針です。', 'team-meet', 'none', 'nodraw'),
  R('ja-B08', 'ja', 'B', '時系列で順番に説明してください 図は要りません', 'general', 'none', 'nodraw'),
  R('ja-B09', 'ja', 'B', '地図を見たら、病院まで歩いて二十分くらいでした。', 'general', 'none', 'nodraw'),
  R('ja-B10', 'ja', 'B', '正直、その売上目標は絵に描いた餅だと思います。', 'sales', 'none', 'nodraw'),

  // C — question about the architecture in focus
  R('ja-C01', 'ja', 'C', 'この図で、ポータルが予約サービスを直接呼ばないのはなぜですか？', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C02', 'ja', 'C', '注文キューが落ちたらどうなりますか', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C03', 'ja', 'C', 'ここのゲートウェイって何のためにあるの？', 'general', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C04', 'ja', 'C', '予約と薬局が同じカルテのデータベースを使っているのはどうして？', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C05', 'ja', 'C', '薬局からキューに伸びてる矢印はどういう意味？', 'general', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C06', 'ja', 'C', '在庫管理は具体的に何をしていて、データはどこから来るんでしょうか。', 'team-meet', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C07', 'ja', 'C', 'メール通知を送るのは予約サービスだけ？処方箋のほうからも送る？', 'team-meet', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C08', 'ja', 'C', 'この構成図だと、カルテはどこに保存されるんですか', 'lecture', 'arch_ja_fg', 'claim', { op: 'explain' }),
  R('ja-C09', 'ja', 'C', 'これ、どこがボトルネックになりそう？', 'technical-interview', 'arch_ja_fg', 'claim', { ...BL, op: 'explain' }),

  // D — change to the architecture in focus
  R('ja-D01', 'ja', 'D', 'ゲートウェイの後ろに請求書サービスを追加して。', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D02', 'ja', 'D', '薬の在庫管理は別チームの担当なので消してください。', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D03', 'ja', 'D', '注文キューを Kafka に置き換えて', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D04', 'ja', 'D', '飼い主向けポータルの名前を「お客様アプリ」に変えてください。', 'general', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D05', 'ja', 'D', '処方箋のサービスからもメール通知につないでください。薬の準備ができたら知らせたいので。', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D06', 'ja', 'D', 'レントゲン画像を置く書類用のデータベースも要るので、カルテの横に足しておいて', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D07', 'ja', 'D', '先生たちの予定をカレンダーと同期するワーカーを入れてほしい。', 'technical-interview', 'arch_ja_fg', 'claim', { op: 'update' }),
  R('ja-D08', 'ja', 'D', 'カルテのデータベース、予約用と薬局用で分けたほうがいいと思うんですよね。', 'technical-interview', 'arch_ja_fg', 'claim', { ...BL, op: 'update' }),
  R('ja-D09', 'ja', 'D', 'メールに加えて、LINE のメッセージ配信サービスも追加で。', 'team-meet', 'arch_ja_fg', 'claim', { op: 'update' }),

  // E — a drawing is on the table, but the sentence is about something else
  R('ja-E01', 'ja', 'E', '今期の新規クライアントは何社でしたっけ？', 'sales', 'arch_ja_fg', 'noclaim'),
  R('ja-E02', 'ja', 'E', 'この件、次のステップは何でしたっけ 誰が担当ですか', 'team-meet', 'arch_ja_bg', 'noclaim'),
  R('ja-E03', 'ja', 'E', '木曜の会議の招待に佐藤さんを追加しておいて。', 'team-meet', 'arch_ja_fg', 'noclaim'),
  R('ja-E04', 'ja', 'E', 'お昼の注文、もうまとめて出しちゃった？', 'general', 'arch_ja_fg', 'noclaim'),
  R('ja-E05', 'ja', 'E', '鈴木さんはさっき在庫の件で何て言ってましたっけ', 'team-meet', 'arch_ja_fg', 'noclaim'),
  R('ja-E06', 'ja', 'E', 'このプランはうちにはちょっと高すぎますね。', 'sales', 'arch_ja_bg', 'noclaim'),
  R('ja-E07', 'ja', 'E', 'このモデルの精度って、新しいデータだとどのくらい出るんですか？', 'technical-interview', 'arch_ja_fg', 'noclaim'),
  R('ja-E08', 'ja', 'E', '三時に歯医者の予約があるので、早めに抜けます。', 'team-meet', 'arch_ja_fg', 'noclaim'),
  R('ja-E09', 'ja', 'E', '花粉症の薬、処方箋がないと買えないんだよね。', 'general', 'arch_ja_bg', 'noclaim'),
  R('ja-E10', 'ja', 'E', 'さっきのメール、通知が来てなかったのでもう一回送ってもらえますか。', 'team-meet', 'arch_ja_bg', 'noclaim'),

  // F — a chart is on the table
  R('ja-F01', 'ja', 'F', 'このグラフを表にしてください。', 'sales', 'chart_ja_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ja-F02', 'ja', 'F', 'これ 棒じゃなくて表で見られる？', 'team-meet', 'chart_ja_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ja-F03', 'ja', 'F', '救急が健康診断よりずっと少ないのはなぜ？', 'team-meet', 'chart_ja_fg', 'claim', { op: 'explain' }),
  R('ja-F04', 'ja', 'F', '会社の健康診断って来週の何曜日でしたっけ。', 'general', 'chart_ja_fg', 'noclaim'),

  // G — a process flowchart is on the table
  R('ja-G01', 'ja', 'G', '受付がカルテを確認するステップでは、具体的に何を見ているんですか？', 'call-center', 'flow_ja_fg', 'claim', { op: 'explain' }),
  R('ja-G02', 'ja', 'G', '飼い主に連絡する前に、会計のステップを追加して。', 'call-center', 'flow_ja_fg', 'claim', { op: 'update' }),
  R('ja-G03', 'ja', 'G', 'アプリのリリースに向けた次のステップは何ですか', 'team-meet', 'flow_ja_fg', 'noclaim'),
];
