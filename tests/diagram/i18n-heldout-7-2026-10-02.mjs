// Independent measurement set #7 for the diagram decision — es / ru / zh / ja.
// Written and labelled BEFORE anything was run on any of these sentences,
// by an author who has never read the rules or the prompt under test.
// Labels = what a sensible listener in the meeting would expect.
// The drawings on the table are labelled in ENGLISH, as a model labels them.
//
// Fixture domain: a telemedicine service.

const SRC = `flowchart LR
  app["Patient App"] --> gw["API Gateway"]
  gw --> sched["Scheduling Service"]
  gw --> video["Video Session Service"]
  gw --> rx["Prescription Service"]
  sched --> db[("Patient Records DB")]
  video --> db
  rx --> db
  rx --> pharm["Pharmacy Integration"]
  rx --> q[["Event Queue"]]
  video --> q
  q --> bill["Billing Service"]
  q --> notif["Notification Service"]`;

const FLOW_SRC = `flowchart TD
  req["Refill request received"] --> elig["Check eligibility"]
  elig --> review["Doctor review"]
  review --> ok{"Refill approved?"}
  ok -->|"yes"| send["Send to pharmacy"]
  ok -->|"no"| decline["Notify patient of decline"]
  send --> done["Notify patient: ready for pickup"]`;

const CHART = { title: 'Completed visits by specialty', x: 'Specialty', cats: ['General Practice', 'Dermatology', 'Pediatrics', 'Mental Health'], y: 'Completed visits', series: 'Last quarter' };

const fx = (foreground) => ({ artifactId: 'design-1.v1', artifact: 'mermaid', view: 'architecture', version: 1, foreground, source: SRC });

export const FIXTURES = {
  arch_fg: fx(true),
  arch_bg: fx(false),
  chart_fg: {
    artifactId: 'chart-1.v1', artifact: 'chart', view: 'chart', version: 1, foreground: true,
    source: JSON.stringify({ v: 1, type: 'bar', title: CHART.title, x: { label: CHART.x, values: CHART.cats }, y: { label: CHART.y }, series: [{ name: CHART.series, values: [1240, 860, 430, 610], status: 'illustrative' }] }),
  },
  flow_fg: { artifactId: 'flow-1.v1', artifact: 'mermaid', view: 'flowchart', version: 1, foreground: true, source: FLOW_SRC },
};

const R = (id, lang, list, q, mode, ctx, expect, extra = {}) => ({ id, lang, list, q, mode, ctx, expect, ...extra });
const BL = { borderline: true };

export const ROWS = [
  // ───────────────────────────── SPANISH ─────────────────────────────
  // A — must draw, nothing on the table
  R('es-A01', 'es', 'A', 'dibujame cómo viaja un pedido en una app de delivery, desde que el cliente toca pagar hasta que el repartidor lo entrega, con el restaurante y la pasarela de pago en el medio', 'technical-interview', 'none', 'draw'),
  R('es-A02', 'es', 'A', 'oye porfa ármame una tablita comparando postgres mongo y redis en consistencia escalabilidad y costo de operación', 'team-meet', 'none', 'draw', { view: 'matrix' }),
  R('es-A03', 'es', 'A', 'A ver, ¿me puedes poner en un diagrama de arquitectura un acortador de URLs típico? Balanceador, servidores web, caché, base de datos y el servicio que genera los códigos.', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('es-A04', 'es', 'A', 'necesitaría ver en una línea de tiempo las etapas de la Segunda Guerra Mundial: invasión de Polonia en el 39, Pearl Harbor en el 41, Stalingrado, Normandía en el 44 y la rendición en el 45', 'lecture', 'none', 'draw', { view: 'timeline' }),
  R('es-A05', 'es', 'A', 'Supongamos que vendimos 120 licencias en enero, 150 en febrero, 90 en marzo y 210 en abril. Pásamelo a barras para que se vea la tendencia.', 'sales', 'none', 'draw', { view: 'chart' }),
  R('es-A06', 'es', 'A', 'parce hágame el favor y me pinta el flujo de cómo se aprueba una solicitud de vacaciones, el empleado la pide, el jefe la revisa, si la aprueba va a recursos humanos y si no vuelve al empleado', 'general', 'none', 'draw', { view: 'flowchart' }),
  R('es-A07', 'es', 'A', 'Quiero un organigrama de una startup chica: CEO arriba, debajo el CTO y la directora comercial, del CTO cuelgan dos devs y una diseñadora, de la comercial dos vendedores.', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('es-A08', 'es', 'A', 'los estados por los que pasa un ticket de soporte, abierto, en progreso, esperando al cliente, resuelto y cerrado, con qué puede pasar a qué... ¿lo podés graficar?', 'call-center', 'none', 'draw', { view: 'state' }),
  R('es-A09', 'es', 'A', 'Vale, y ya que estamos, ¿nos haces un Gantt con el plan del trimestre que acabamos de comentar?', 'team-meet', 'none', 'draw', { view: 'gantt' }),
  R('es-A10', 'es', 'A', 'la verdad me sirve más algo visual, un mapa mental de las ramas del aprendizaje automático, supervisado, no supervisado y por refuerzo, con dos o tres algoritmos colgando de cada una', 'lecture', 'none', 'draw', { view: 'mindmap' }),
  // B — must not draw, nothing on the table
  R('es-B01', 'es', 'B', 'Ayer Marta dibujó toda la arquitectura en la pizarra y la verdad quedó clarísima.', 'team-meet', 'none', 'nodraw'),
  R('es-B02', 'es', 'B', 'el lunes voy a armar el diagrama de flujo para la presentación del cliente, hoy no llego', 'team-meet', 'none', 'nodraw'),
  R('es-B03', 'es', 'B', 'Mi jefa me pidió que le dibujara el organigrama del área, pero todavía no sé ni quién reporta a quién.', 'general', 'none', 'nodraw'),
  R('es-B04', 'es', 'B', '¿qué diferencia hay entre un diagrama de secuencia y uno de actividad?', 'technical-interview', 'none', 'nodraw'),
  R('es-B05', 'es', 'B', 'ese cuadro que cuelga en la sala de reuniones es horrible, cachai, alguien debería sacarlo', 'general', 'none', 'nodraw'),
  R('es-B06', 'es', 'B', 'No me pintes un panorama tan negro, que las ventas del trimestre no fueron tan malas.', 'sales', 'none', 'nodraw'),
  R('es-B07', 'es', 'B', 'el diagrama que mandó el proveedor es un desastre, las flechas se cruzan por todos lados y no se entiende nada', 'sales', 'none', 'nodraw'),
  R('es-B08', 'es', 'B', 'En mi último trabajo yo era el que modelaba los datos y mantenía al día el mapa de dependencias.', 'looking-for-work', 'none', 'nodraw'),
  R('es-B09', 'es', 'B', '¿a qué hora dijo Andrés que teníamos que entregar la propuesta?', 'team-meet', 'none', 'nodraw'),
  R('es-B10', 'es', 'B', 'tío, se me ha quemado la tarjeta gráfica del portátil, por eso estoy conectado desde el móvil', 'general', 'none', 'nodraw'),
  // C — question about the architecture on the table
  R('es-C01', 'es', 'C', '¿Y por qué el servicio de recetas escribe en la cola en vez de llamar directo a facturación?', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('es-C02', 'es', 'C', 'una duda, el gateway ese habla con todos los servicios o solo con los tres que tiene pegados', 'team-meet', 'arch_fg', 'claim', { op: 'explain' }),
  R('es-C03', 'es', 'C', 'ese cilindro del medio, ¿qué guarda exactamente?', 'lecture', 'arch_fg', 'claim', { op: 'explain' }),
  R('es-C04', 'es', 'C', 'no me queda claro qué pasa si se cae lo de las videollamadas, cachai, ¿el paciente igual puede agendar?', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('es-C05', 'es', 'C', '¿Quién le avisa a la farmacia cuando el médico firma la receta, según lo que tenemos acá?', 'sales', 'arch_fg', 'claim', { op: 'explain' }),
  R('es-C06', 'es', 'C', 'vea pues, una pregunta: la flecha que sale de video y llega a la cola, ¿eso para qué es?', 'general', 'arch_fg', 'claim', { op: 'explain' }),
  R('es-C07', 'es', 'C', '¿Notification Service de dónde saca los datos del paciente si no está conectado a la base?', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('es-C08', 'es', 'C', 'volviendo al diagrama de antes, ¿cuál era el único punto de entrada para la app?', 'team-meet', 'arch_bg', 'claim', { op: 'explain' }),
  R('es-C09', 'es', 'C', 'en la arquitectura que nos mostraste hace un rato, ¿facturación dependía de la cola o del gateway? ya no me acuerdo', 'sales', 'arch_bg', 'claim', { op: 'explain' }),
  // D — change to the architecture on the table
  R('es-D01', 'es', 'D', 'Ponle un caché entre el gateway y agendamiento, que eso recibe muchísima lectura.', 'team-meet', 'arch_fg', 'claim', { op: 'update' }),
  R('es-D02', 'es', 'D', 'sacá la flecha que va de video a la base, video no debería tocar las historias clínicas', 'technical-interview', 'arch_fg', 'claim', { op: 'update' }),
  R('es-D03', 'es', 'D', 'la cajita de notificaciones pintala de otro color para que se distinga de las demás', 'general', 'arch_fg', 'claim', { op: 'update' }),
  R('es-D04', 'es', 'D', 'Facturación no tendría que enterarse por la cola, mejor que el servicio de recetas la llame directamente.', 'technical-interview', 'arch_fg', 'claim', { op: 'update' }),
  R('es-D05', 'es', 'D', 'cámbiale el nombre a Pharmacy Integration, ponle Conector de Farmacias', 'sales', 'arch_fg', 'claim', { op: 'update' }),
  R('es-D06', 'es', 'D', 'esto me gustaría verlo de arriba hacia abajo en vez de izquierda a derecha', 'lecture', 'arch_fg', 'claim', { op: 'update' }),
  R('es-D07', 'es', 'D', 'Falta la app del médico. Agrégala al lado de la del paciente, entrando por el mismo gateway.', 'team-meet', 'arch_fg', 'claim', { op: 'update' }),
  R('es-D08', 'es', 'D', 'oye y si partimos la base en dos, una para historias clínicas y otra solo para citas, cómo quedaría', 'team-meet', 'arch_fg', 'claim', { op: 'update', ...BL }),
  R('es-D09', 'es', 'D', 'al esquema de antes añádele un servicio de autenticación delante de todo, que se nos ha olvidado', 'team-meet', 'arch_bg', 'claim', { op: 'update' }),
  // E — a drawing is on the table, the sentence is about something else
  R('es-E01', 'es', 'E', '¿Alguien sabe si Paula de facturación ya volvió de vacaciones?', 'team-meet', 'arch_fg', 'noclaim'),
  R('es-E02', 'es', 'E', 'hice una cola de media hora en el banco, por eso llegué tarde, perdón', 'general', 'arch_fg', 'noclaim'),
  R('es-E03', 'es', 'E', '¿Qué fue lo que dijo el cliente sobre el presupuesto al principio de la llamada?', 'sales', 'arch_fg', 'noclaim'),
  R('es-E04', 'es', 'E', 'me llegó una notificación de que se vence el dominio mañana, ¿quién lo renueva?', 'team-meet', 'arch_fg', 'noclaim'),
  R('es-E05', 'es', 'E', 'El diagrama que nos pasó la consultora la semana pasada era ilegible, letra tamaño hormiga.', 'sales', 'arch_bg', 'noclaim'),
  R('es-E06', 'es', 'E', 'tengo la agenda llena hasta el jueves, ¿lo vemos el viernes a primera hora?', 'general', 'arch_bg', 'noclaim'),
  R('es-E07', 'es', 'E', 'Mi hija tiene cita con la dermatóloga a las cinco, así que hoy me desconecto antes.', 'team-meet', 'chart_fg', 'noclaim'),
  R('es-E08', 'es', 'E', 'ahorita no puedo, estoy en otra llamada, márcame en diez minutos', 'general', 'chart_fg', 'noclaim'),
  R('es-E09', 'es', 'E', 'cuéntame de alguna vez que tuviste que rechazar la propuesta de un compañero', 'recruiting', 'flow_fg', 'noclaim'),
  R('es-E10', 'es', 'E', 'después paso por la farmacia a buscar lo de mi vieja, ¿necesitás algo?', 'general', 'flow_fg', 'noclaim'),
  // F — the bar chart is on the table
  R('es-F01', 'es', 'F', '¿por qué pediatría está tan abajo comparada con medicina general?', 'sales', 'chart_fg', 'claim', { op: 'explain' }),
  R('es-F02', 'es', 'F', 'ordená las barras de mayor a menor y ponele el número arriba de cada una', 'team-meet', 'chart_fg', 'claim', { op: 'update' }),
  R('es-F03', 'es', 'F', 'Esto mismo pásamelo a una tabla, con especialidad y cantidad de consultas.', 'sales', 'chart_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('es-F04', 'es', 'F', '¿Te acuerdas de qué dijo Lucía sobre la salud mental del equipo en la retro?', 'team-meet', 'chart_fg', 'noclaim'),
  // G — the refill flowchart is on the table
  R('es-G01', 'es', 'G', 'no entiendo, ¿la revisión del médico va siempre o solo cuando hay dudas con la elegibilidad?', 'call-center', 'flow_fg', 'claim', { op: 'explain' }),
  R('es-G02', 'es', 'G', 'cuando se rechaza, que no termine ahí: agrégale una salida que ofrezca agendar una videoconsulta', 'call-center', 'flow_fg', 'claim', { op: 'update' }),
  R('es-G03', 'es', 'G', 'No soy elegible para el bono este año porque entré en julio, qué rabia.', 'general', 'flow_fg', 'noclaim'),

  // ───────────────────────────── RUSSIAN ─────────────────────────────
  // A — must draw, nothing on the table
  R('ru-A01', 'ru', 'A', 'Нарисуй, пожалуйста, архитектуру обычного мессенджера: клиенты, вебсокет-сервер, сервис сообщений, очередь, база и пуш-уведомления.', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('ru-A02', 'ru', 'A', 'слушай а накидай-ка схемку как письмо идёт от отправителя к получателю ну там почтовый клиент smtp сервер dns запрос mx и ящик получателя', 'general', 'none', 'draw'),
  R('ru-A03', 'ru', 'A', 'Мне бы табличку: сравнить Kafka, RabbitMQ и SQS по пропускной способности, гарантиям доставки и сложности поддержки.', 'technical-interview', 'none', 'draw', { view: 'matrix' }),
  R('ru-A04', 'ru', 'A', 'Бюджет на маркетинг такой: сорок процентов на контекст, двадцать пять на соцсети, двадцать на мероприятия, остальное на контент. Покажите это круговой диаграммой.', 'sales', 'none', 'draw', { view: 'chart' }),
  R('ru-A05', 'ru', 'A', 'Сделайте, пожалуйста, диаграмму Ганта по переезду офиса: поиск помещения две недели, договор неделя, ремонт месяц, перевозка мебели три дня.', 'team-meet', 'none', 'draw', { view: 'gantt' }),
  R('ru-A06', 'ru', 'A', 'Изобрази дерево решений, брать ли ипотеку: есть ли первый взнос, стабильный ли доход, ставка выше или ниже пятнадцати процентов.', 'lecture', 'none', 'draw', { view: 'decision' }),
  R('ru-A07', 'ru', 'A', 'набросай диаграмму классов для шахмат: доска, клетка, фигура с наследниками король ферзь пешка, и игрок', 'technical-interview', 'none', 'draw', { view: 'class' }),
  R('ru-A08', 'ru', 'A', 'покажи оргструктуру нашего отдела продаж кто кому подчиняется', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('ru-A09', 'ru', 'A', 'Объясняю студентам ER-модель, так что нужны сущности онлайн-кинотеатра — пользователь, подписка, фильм, просмотр — и связи между ними, прямо картинкой.', 'lecture', 'none', 'draw', { view: 'er' }),
  R('ru-A10', 'ru', 'A', 'ну и хорошо бы увидеть на шкале времени основные версии питона: двойка в двухтысячном, тройка в две тысячи восьмом, конец поддержки двойки в двадцатом', 'lecture', 'none', 'draw', { view: 'timeline' }),
  // B — must not draw, nothing on the table
  R('ru-B01', 'ru', 'B', 'На прошлой работе я каждую неделю строил графики по оттоку для руководства.', 'looking-for-work', 'none', 'nodraw'),
  R('ru-B02', 'ru', 'B', 'Давайте так: Катя к среде подготовит диаграмму, а мы пока обсудим цифры.', 'team-meet', 'none', 'nodraw'),
  R('ru-B03', 'ru', 'B', 'Заказчик ещё в понедельник просил прислать ему схему интеграции, а мы так и не отправили.', 'sales', 'none', 'nodraw'),
  R('ru-B04', 'ru', 'B', 'А что такое вообще диаграмма Исикавы, ею кто-нибудь реально пользуется?', 'lecture', 'none', 'nodraw'),
  R('ru-B05', 'ru', 'B', 'Он опять рисуется перед начальством, смотреть противно.', 'general', 'none', 'nodraw'),
  R('ru-B06', 'ru', 'B', 'по графику у меня отпуск с пятнадцатого так что на релизе меня не будет', 'team-meet', 'none', 'nodraw'),
  R('ru-B07', 'ru', 'B', 'В их отчёте графики без подписей осей, я вообще не понял, что там растёт.', 'sales', 'none', 'nodraw'),
  R('ru-B08', 'ru', 'B', 'У меня карта не проходит, можно я по счёту оплачу?', 'sales', 'none', 'nodraw'),
  R('ru-B09', 'ru', 'B', 'напомни что Ольга говорила про штрафы в договоре', 'team-meet', 'none', 'nodraw'),
  R('ru-B10', 'ru', 'B', 'Слышно меня нормально? А то у соседей ремонт, сверлят с самого утра.', 'general', 'none', 'nodraw'),
  // C — question about the architecture on the table
  R('ru-C01', 'ru', 'C', 'А если очередь встанет, что у нас отвалится в первую очередь?', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('ru-C02', 'ru', 'C', 'вот этот блок с двойной рамкой он чем от остальных отличается', 'general', 'arch_fg', 'claim', { op: 'explain' }),
  R('ru-C03', 'ru', 'C', 'Правильно ли я понимаю, что платёжка узнаёт о визите только через события?', 'team-meet', 'arch_fg', 'claim', { op: 'explain' }),
  R('ru-C04', 'ru', 'C', 'Проведи меня по схеме: пациент нажал «записаться» — что дальше происходит?', 'sales', 'arch_fg', 'claim', { op: 'explain' }),
  R('ru-C05', 'ru', 'C', 'Поясните, пожалуйста, каким образом сервис видеосвязи взаимодействует с базой данных пациентов.', 'sales', 'arch_fg', 'claim', { op: 'explain' }),
  R('ru-C06', 'ru', 'C', 'а стрелочка от рецептов к аптекам это синхронный вызов или как', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('ru-C07', 'ru', 'C', 'Pharmacy Integration ходит наружу через гейтвей или напрямую?', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('ru-C08', 'ru', 'C', 'Вернёмся к схеме, которая была раньше: там база одна на всех или у каждого сервиса своя?', 'technical-interview', 'arch_bg', 'claim', { op: 'explain' }),
  R('ru-C09', 'ru', 'C', 'на той архитектуре что ты показывал где будет узкое место при нагрузке', 'general', 'arch_bg', 'claim', { op: 'explain' }),
  // D — change to the architecture on the table
  R('ru-D01', 'ru', 'D', 'Добавь перед гейтвеем балансировщик.', 'technical-interview', 'arch_fg', 'claim', { op: 'update' }),
  R('ru-D02', 'ru', 'D', 'обведи-ка рамочкой три сервиса посерединке и подпиши бэкенд', 'team-meet', 'arch_fg', 'claim', { op: 'update' }),
  R('ru-D03', 'ru', 'D', 'Прошу добавить заголовок «Целевая архитектура, версия 2» и убрать с диаграммы сервис уведомлений.', 'sales', 'arch_fg', 'claim', { op: 'update' }),
  R('ru-D04', 'ru', 'D', 'пусть расписание тоже пишет в очередь, чтобы уведомлялка могла слать напоминания о приёме', 'technical-interview', 'arch_fg', 'claim', { op: 'update' }),
  R('ru-D05', 'ru', 'D', 'стрелку из очереди в биллинг сделай пунктирной, это же асинхронно', 'team-meet', 'arch_fg', 'claim', { op: 'update' }),
  R('ru-D06', 'ru', 'D', 'Аналитику ещё забыли. Пусть тоже читает из очереди событий.', 'team-meet', 'arch_fg', 'claim', { op: 'update' }),
  R('ru-D07', 'ru', 'D', 'подсвети весь путь рецепта от приложения до аптеки чтобы сразу было видно', 'general', 'arch_fg', 'claim', { op: 'update' }),
  R('ru-D08', 'ru', 'D', 'Видео мы сами не гоняем, там внешний провайдер — дорисуй его справа от видеосервиса.', 'technical-interview', 'arch_fg', 'claim', { op: 'update' }),
  R('ru-D09', 'ru', 'D', 'В ту схему, что была до этого, надо ещё внести внешний платёжный шлюз после биллинга.', 'sales', 'arch_bg', 'claim', { op: 'update' }),
  // E — a drawing is on the table, the sentence is about something else
  R('ru-E01', 'ru', 'E', 'Кто-нибудь помнит, что Дима говорил про бюджет на следующий квартал?', 'team-meet', 'arch_fg', 'noclaim'),
  R('ru-E02', 'ru', 'E', 'мне от вас счёт так и не пришёл, вы его точно выставили?', 'sales', 'arch_fg', 'noclaim'),
  R('ru-E03', 'ru', 'E', 'У Лены из биллинга сегодня день рождения, скидываемся по пятьсот.', 'team-meet', 'arch_fg', 'noclaim'),
  R('ru-E04', 'ru', 'E', 'Видео у меня тормозит, я камеру выключу, ладно?', 'general', 'arch_fg', 'noclaim'),
  R('ru-E05', 'ru', 'E', 'расписание на завтра у меня забито до шести давай послезавтра', 'general', 'arch_bg', 'noclaim'),
  R('ru-E06', 'ru', 'E', 'Gateway — это же ещё и кофейня на первом этаже, я там утром был, очередь до дверей.', 'general', 'arch_bg', 'noclaim'),
  R('ru-E07', 'ru', 'E', 'Мне завтра с младшим к педиатру, так что буду после обеда.', 'team-meet', 'chart_fg', 'noclaim'),
  R('ru-E08', 'ru', 'E', 'Расскажите немного о себе: где вы работали до этого?', 'recruiting', 'chart_fg', 'noclaim'),
  R('ru-E09', 'ru', 'E', 'Мне вчера в визе отказали, представляешь, без объяснения причин.', 'general', 'flow_fg', 'noclaim'),
  R('ru-E10', 'ru', 'E', 'Проверка из налоговой на следующей неделе, бухгалтерия вся на ушах.', 'team-meet', 'flow_fg', 'noclaim'),
  // F — the bar chart is on the table
  R('ru-F01', 'ru', 'F', 'А вон тот третий столбик почему такой низенький?', 'sales', 'chart_fg', 'claim', { op: 'explain' }),
  R('ru-F02', 'ru', 'F', 'добавь сюда ещё стоматологию, пусть будет условно пятьсот визитов', 'team-meet', 'chart_fg', 'claim', { op: 'update' }),
  R('ru-F03', 'ru', 'F', 'Дайте то же самое таблицей, пожалуйста: специальность и число визитов.', 'sales', 'chart_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ru-F04', 'ru', 'F', 'Столбик термометра сегодня до минус двадцати упал, я еле машину завёл.', 'general', 'chart_fg', 'noclaim'),
  // G — the refill flowchart is on the table
  R('ru-G01', 'ru', 'G', 'А кто проверяет право на продление — система сама или живой человек?', 'call-center', 'flow_fg', 'claim', { op: 'explain' }),
  R('ru-G02', 'ru', 'G', 'ромбик сделай с тремя выходами: да, нет и «нужен очный приём»', 'call-center', 'flow_fg', 'claim', { op: 'update' }),
  R('ru-G03', 'ru', 'G', 'клиент на линии спрашивает до скольки работает аптека на Ленина', 'call-center', 'flow_fg', 'noclaim'),

  // ───────────────────────────── CHINESE ─────────────────────────────
  // A — must draw, nothing on the table
  R('zh-A01', 'zh', 'A', '帮我画一下微信扫码支付是怎么走的,用户扫码、商户后台下单、支付平台扣款、回调通知商户、最后给用户出结果', 'technical-interview', 'none', 'draw'),
  R('zh-A02', 'zh', 'A', '整一个表呗,把 iPhone、华为、小米三款旗舰在价格、续航、拍照这几项上比一比', 'general', 'none', 'draw', { view: 'matrix' }),
  R('zh-A03', 'zh', 'A', '北上广深四个城市的平均房价,就按六万、七万、四万、六万五算,出个柱状图对比一下', 'sales', 'none', 'draw', { view: 'chart' }),
  R('zh-A04', 'zh', 'A', '能不能把一个典型短视频 App 的后端架构图弄出来:客户端、CDN、网关、上传服务、转码、推荐、对象存储', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('zh-A05', 'zh', 'A', '我想看下咱们组现在的人员架构 谁带谁', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('zh-A06', 'zh', 'A', '讲到这儿我觉得光说不直观,TCP 三次握手客户端和服务器之间来回发的那几个包,按时序摆出来给大家看一下吧', 'lecture', 'none', 'draw', { view: 'sequence' }),
  R('zh-A07', 'zh', 'A', '唐宋元明清几个朝代的起止年份,拉条时间线出来先啦', 'lecture', 'none', 'draw', { view: 'timeline' }),
  R('zh-A08', 'zh', 'A', '脑图 前端技术栈 分框架/构建工具/状态管理/测试 每类列两三个', 'general', 'none', 'draw', { view: 'mindmap' }),
  R('zh-A09', 'zh', 'A', '订单状态机画一个:待支付、已支付、已发货、已签收、已取消,标清楚哪些状态之间能跳转', 'technical-interview', 'none', 'draw', { view: 'state' }),
  R('zh-A10', 'zh', 'A', '麻烦把我们刚才聊的上线计划排成甘特图,谢谢', 'team-meet', 'none', 'draw', { view: 'gantt' }),
  // B — must not draw, nothing on the table
  R('zh-B01', 'zh', 'B', '上次评审的时候我把 ER 图发群里了,大家应该都看过了吧', 'team-meet', 'none', 'nodraw'),
  R('zh-B02', 'zh', 'B', '架构图等需求定了再画,现在画了也是白画', 'team-meet', 'none', 'nodraw'),
  R('zh-B03', 'zh', 'B', '客户上周就让我们出个对比表,结果销售一直拖着没给', 'sales', 'none', 'nodraw'),
  R('zh-B04', 'zh', 'B', '泳道图是个啥,跟普通流程图有区别吗', 'lecture', 'none', 'nodraw'),
  R('zh-B05', 'zh', 'B', '别老给我画大饼,年终奖到底发不发', 'general', 'none', 'nodraw'),
  R('zh-B06', 'zh', 'B', '他们家那个图表做得太丑了,配色跟红绿灯似的', 'sales', 'none', 'nodraw'),
  R('zh-B07', 'zh', 'B', '我以前做过三年平面模特,后来才转行做的产品', 'looking-for-work', 'none', 'nodraw'),
  R('zh-B08', 'zh', 'B', '刚才张总说的折扣是几个点来着', 'sales', 'none', 'nodraw'),
  R('zh-B09', 'zh', 'B', '你那边是不是卡了 我这儿听不清', 'general', 'none', 'nodraw'),
  R('zh-B10', 'zh', 'B', '我表停了,现在几点了,是不是该散会了', 'general', 'none', 'nodraw'),
  // C — question about the architecture on the table
  R('zh-C01', 'zh', 'C', '支付那块算不算在问诊的主链路上?它慢了会不会拖住视频', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('zh-C02', 'zh', 'C', '这个框是干嘛的,就最左边数第二个', 'general', 'arch_fg', 'claim', { op: 'explain' }),
  R('zh-C03', 'zh', 'C', '那个 Gateway 是不是单点啊,它挂了是不是全完了', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('zh-C04', 'zh', 'C', '医生开完处方之后,这几个服务是按什么顺序被触发的?', 'team-meet', 'arch_fg', 'claim', { op: 'explain' }),
  R('zh-C05', 'zh', 'C', '请问预约服务和视频服务之间为什么没有连线?', 'sales', 'arch_fg', 'claim', { op: 'explain' }),
  R('zh-C06', 'zh', 'C', '这图到底算微服务还是啥 看着库是共用的', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('zh-C07', 'zh', 'C', 'Event Queue 后面挂了几个消费者?', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('zh-C08', 'zh', 'C', '回到刚才那张架构图,登录鉴权是放在哪一层做的?', 'sales', 'arch_bg', 'claim', { op: 'explain' }),
  R('zh-C09', 'zh', 'C', '之前那个图里病人的资料有没有传到药房那边去啊', 'team-meet', 'arch_bg', 'claim', { op: 'explain' }),
  // D — change to the architecture on the table
  R('zh-D01', 'zh', 'D', '把数据库挪到最下面,现在挤在中间太乱了', 'general', 'arch_fg', 'claim', { op: 'update' }),
  R('zh-D02', 'zh', 'D', '通知那里分出两个出口先啦,一个短信一个推送', 'team-meet', 'arch_fg', 'claim', { op: 'update' }),
  R('zh-D03', 'zh', 'D', '队列后面再挂个死信队列,消费失败的消息都丢那儿', 'technical-interview', 'arch_fg', 'claim', { op: 'update' }),
  R('zh-D04', 'zh', 'D', '药房对接别让处方直接调了,改成订阅队列里的事件', 'technical-interview', 'arch_fg', 'claim', { op: 'update' }),
  R('zh-D05', 'zh', 'D', '太细了,合并一下,预约、视频、处方三个并成一个“业务服务”就行', 'sales', 'arch_fg', 'claim', { op: 'update' }),
  R('zh-D06', 'zh', 'D', '数据库得有个只读副本。预约那边的查询都走副本,别压主库。', 'technical-interview', 'arch_fg', 'claim', { op: 'update' }),
  R('zh-D07', 'zh', 'D', '把 Billing Service 那个框标红,旁边注一句“待重构”', 'team-meet', 'arch_fg', 'claim', { op: 'update' }),
  R('zh-D08', 'zh', 'D', '麻烦在每条箭头上标一下走的是 HTTP 还是消息', 'sales', 'arch_fg', 'claim', { op: 'update' }),
  R('zh-D09', 'zh', 'D', '前面那张图里处方和药房之间改成双向箭头吧,药房还要回传配药状态', 'team-meet', 'arch_bg', 'claim', { op: 'update' }),
  // E — a drawing is on the table, the sentence is about something else
  R('zh-E01', 'zh', 'E', '药房那边的合同法务审完了吗,对方催了两回了', 'sales', 'arch_fg', 'noclaim'),
  R('zh-E02', 'zh', 'E', '我们不图别的,就图个稳定,价格贵点无所谓', 'sales', 'arch_fg', 'noclaim'),
  R('zh-E03', 'zh', 'E', '刚才李工说的那个上线时间是下周三还是下周四?', 'team-meet', 'arch_fg', 'noclaim'),
  R('zh-E04', 'zh', 'E', '食堂今天排队排到门口了,咱们晚点再去吧', 'general', 'arch_fg', 'noclaim'),
  R('zh-E05', 'zh', 'E', '我预约了下午三点的会议室,咱们换个地方聊', 'team-meet', 'arch_bg', 'noclaim'),
  R('zh-E06', 'zh', 'E', 'Billing 组新来的那个同事叫什么名字来着', 'team-meet', 'arch_bg', 'noclaim'),
  R('zh-E07', 'zh', 'E', '全科医生现在是不是特别缺啊,我看新闻老这么说', 'general', 'chart_fg', 'noclaim'),
  R('zh-E08', 'zh', 'E', '你平时周末都干点啥', 'recruiting', 'chart_fg', 'noclaim'),
  R('zh-E09', 'zh', 'E', '这个季度的续约单有资格拿提成吗,HR 说了没', 'sales', 'flow_fg', 'noclaim'),
  R('zh-E10', 'zh', 'E', '说说你上一份工作为什么离职吧', 'recruiting', 'flow_fg', 'noclaim'),
  // F — the bar chart is on the table
  R('zh-F01', 'zh', 'F', '皮肤科怎么比心理的还高,这数对吗', 'sales', 'chart_fg', 'claim', { op: 'explain' }),
  R('zh-F02', 'zh', 'F', '换成饼图看看各科占比', 'team-meet', 'chart_fg', 'claim', { op: 'update', ...BL }),
  R('zh-F03', 'zh', 'F', '这个给我转成表格吧,专科一列,完成量一列', 'sales', 'chart_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('zh-F04', 'zh', 'F', '柱子后面那个工位是谁的,怎么老没人', 'general', 'chart_fg', 'noclaim'),
  // G — the refill flowchart is on the table
  R('zh-G01', 'zh', 'G', '第二步和第三步能不能并行,还是必须先查资格再给医生看', 'call-center', 'flow_fg', 'claim', { op: 'explain' }),
  R('zh-G02', 'zh', 'G', '最后别直接结束,拒了的那条加个箭头回到开头,让病人可以重新申请', 'call-center', 'flow_fg', 'claim', { op: 'update' }),
  R('zh-G03', 'zh', 'G', '我的报销单审批到哪一步了,有人知道吗', 'general', 'flow_fg', 'noclaim'),

  // ───────────────────────────── JAPANESE ─────────────────────────────
  // A — must draw, nothing on the table
  R('ja-A01', 'ja', 'A', 'IoTの温度監視システムの構成図を描いてもらえますか。センサー、ゲートウェイ端末、MQTTブローカー、ストリーム処理、時系列DB、ダッシュボードで。', 'technical-interview', 'none', 'draw', { view: 'architecture' }),
  R('ja-A02', 'ja', 'A', 'すまんけど、問い合わせ対応の流れをフローにしてくれへん? 電話受けて、本人確認して、FAQにあったらその場で回答、なかったら二次対応にエスカレーション、みたいな感じで', 'call-center', 'none', 'draw', { view: 'flowchart' }),
  R('ja-A03', 'ja', 'A', 'React と Vue と Svelte を学習コスト、エコシステム、パフォーマンスで比べた表がほしいです', 'technical-interview', 'none', 'draw', { view: 'matrix' }),
  R('ja-A04', 'ja', 'A', 'たとえば利用者数が1月から順に1200人、1500人、1400人、2100人、2600人と推移したとして、それを折れ線グラフにしていただけますでしょうか', 'sales', 'none', 'draw', { view: 'chart' }),
  R('ja-A05', 'ja', 'A', 'うちのチームの体制図って出せる', 'recruiting', 'none', 'draw', { view: 'responsibility' }),
  R('ja-A06', 'ja', 'A', '明治維新から太平洋戦争までの主な出来事を年表にまとめてください。大政奉還、明治憲法の発布、日清戦争、日露戦争、関東大震災、真珠湾攻撃。', 'lecture', 'none', 'draw', { view: 'timeline' }),
  R('ja-A07', 'ja', 'A', 'ログインのときにブラウザと認証サーバーとアプリの間でどういう順番でやりとりしてるのか、OAuthの認可コードフローで、図で見せてほしいんだけど', 'technical-interview', 'none', 'draw', { view: 'sequence' }),
  R('ja-A08', 'ja', 'A', 'さっき話した移行スケジュール、ガントチャートにしといて', 'team-meet', 'none', 'draw', { view: 'gantt' }),
  R('ja-A09', 'ja', 'A', 'クラウドに移すかオンプレに残すかの判断を分岐で整理してほしい。データが機密かどうか、年間予算が一千万を超えるか、運用チームがいるか、で枝分かれする形で', 'general', 'none', 'draw', { view: 'decision' }),
  R('ja-A10', 'ja', 'A', '自販機って、待機中、お金が入った、商品を選んだ、払い出し中、おつり返却って状態が移っていくじゃないですか。あれの遷移を絵にしてほしいんです', 'lecture', 'none', 'draw', { view: 'state' }),
  // B — must not draw, nothing on the table
  R('ja-B01', 'ja', 'B', '先月の報告会で使った円グラフ、あれ結構評判よかったんですよ', 'team-meet', 'none', 'nodraw'),
  R('ja-B02', 'ja', 'B', 'フロー図は来週こっちで作っておくので、今日は口頭だけで大丈夫です', 'sales', 'none', 'nodraw'),
  R('ja-B03', 'ja', 'B', 'お客さんから構成図を出してくれって三回くらい言われてるらしいですよ、営業が', 'team-meet', 'none', 'nodraw'),
  R('ja-B04', 'ja', 'B', 'ガントチャートって結局どういうときに使うものなんですか', 'lecture', 'none', 'nodraw'),
  R('ja-B05', 'ja', 'B', 'それは絵に描いた餅やで、ほんまにできるんかいな', 'general', 'none', 'nodraw'),
  R('ja-B06', 'ja', 'B', '前任者が残した構成図、三年前のままで全然あてにならないんですよね', 'team-meet', 'none', 'nodraw'),
  R('ja-B07', 'ja', 'B', '前職では主に設計書のレビューと、後輩の図面チェックを担当しておりました', 'looking-for-work', 'none', 'nodraw'),
  R('ja-B08', 'ja', 'B', 'さっき佐藤さんが言ってた納期っていつでしたっけ', 'sales', 'none', 'nodraw'),
  R('ja-B09', 'ja', 'B', '今日めっちゃ暑ないですか、エアコン効いてます?', 'general', 'none', 'nodraw'),
  R('ja-B10', 'ja', 'B', 'さっきのランチの店、テーブル席が空いてなくてカウンターでした', 'general', 'none', 'nodraw'),
  // C — question about the architecture on the table
  R('ja-C01', 'ja', 'C', '決済のとこ、キューが詰まったら請求漏れとか起きないんですか', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('ja-C02', 'ja', 'C', 'この右端の箱たちって、どこにも矢印が出てないけど、ここで処理が終わるってこと?', 'general', 'arch_fg', 'claim', { op: 'explain' }),
  R('ja-C03', 'ja', 'C', 'アクセスが十倍になったら、最初にスケールさせるのはどこですか', 'technical-interview', 'arch_fg', 'claim', { op: 'explain', ...BL }),
  R('ja-C04', 'ja', 'C', '処方箋サービスが患者データベースを直接見にいってるのは、何か理由があるんでしょうか', 'team-meet', 'arch_fg', 'claim', { op: 'explain' }),
  R('ja-C05', 'ja', 'C', '恐れ入りますが、ビデオ通話の部分で障害が起きた場合、予約済みの診察はどうなるのかご説明いただけますか', 'sales', 'arch_fg', 'claim', { op: 'explain' }),
  R('ja-C06', 'ja', 'C', 'これ、薬局につながってるのは処方箋のとこだけなん? ほかは関係ないん?', 'team-meet', 'arch_fg', 'claim', { op: 'explain' }),
  R('ja-C07', 'ja', 'C', 'Scheduling Service が Event Queue につながってないのはわざとですか', 'technical-interview', 'arch_fg', 'claim', { op: 'explain' }),
  R('ja-C08', 'ja', 'C', 'さっきの構成図の話に戻るんですが、DBに書き込むサービスって全部でいくつありましたっけ', 'sales', 'arch_bg', 'claim', { op: 'explain' }),
  R('ja-C09', 'ja', 'C', '前に出してもらった図って、障害に一番弱いのはどのあたりでしたっけ', 'team-meet', 'arch_bg', 'claim', { op: 'explain' }),
  // D — change to the architecture on the table
  R('ja-D01', 'ja', 'D', 'ラベル、全部日本語に直してもらえますか。英語のままだとお客さんに見せにくいので', 'sales', 'arch_fg', 'claim', { op: 'update' }),
  R('ja-D02', 'ja', 'D', 'ビデオからDBへの線、消しといてくれへん? あれいらんわ', 'team-meet', 'arch_fg', 'claim', { op: 'update' }),
  R('ja-D03', 'ja', 'D', 'キューは請求用と通知用の二本に分けたいです', 'technical-interview', 'arch_fg', 'claim', { op: 'update' }),
  R('ja-D04', 'ja', 'D', '薬局連携は社外のシステムなので、点線の枠で囲って外部だとわかるようにしてください', 'sales', 'arch_fg', 'claim', { op: 'update' }),
  R('ja-D05', 'ja', 'D', '患者アプリ、Webとモバイルで箱を分けよか', 'team-meet', 'arch_fg', 'claim', { op: 'update' }),
  R('ja-D06', 'ja', 'D', 'ゲートウェイが単一障害点になってますね。二台構成にしておいてください。', 'technical-interview', 'arch_fg', 'claim', { op: 'update' }),
  R('ja-D07', 'ja', 'D', 'Billing Service は自前でやらずに外部のSaaSを使う想定なので、そこ差し替えで', 'technical-interview', 'arch_fg', 'claim', { op: 'update' }),
  R('ja-D08', 'ja', 'D', '予約のところからも通知に直接つながるようにしたい、リマインド送るから', 'team-meet', 'arch_fg', 'claim', { op: 'update' }),
  R('ja-D09', 'ja', 'D', 'さっきの図に凡例をつけといてもらえる? 四角がサービスで円柱がDBってわかるように', 'general', 'arch_bg', 'claim', { op: 'update' }),
  // E — a drawing is on the table, the sentence is about something else
  R('ja-E01', 'ja', 'E', '御社が描いている将来像について、もう少し伺ってもよろしいですか', 'sales', 'arch_fg', 'noclaim'),
  R('ja-E02', 'ja', 'E', '通知がうるさいんで Slack ミュートにしますね', 'team-meet', 'arch_fg', 'noclaim'),
  R('ja-E03', 'ja', 'E', 'さっき山本さんが言ってた予算の上限、いくらでしたっけ', 'sales', 'arch_fg', 'noclaim'),
  R('ja-E04', 'ja', 'E', '来週の会議室、Bで予約取っときましたんで', 'team-meet', 'arch_fg', 'noclaim'),
  R('ja-E05', 'ja', 'E', 'キューといえば、最近ビリヤードのキュー買ったんですよ', 'general', 'arch_bg', 'noclaim'),
  R('ja-E06', 'ja', 'E', '今日の記録は誰が取ってます? 議事録あとで共有お願いします', 'team-meet', 'arch_bg', 'noclaim'),
  R('ja-E07', 'ja', 'E', '最近メンタルやられ気味なんで、来週ちょっと休みもらいます', 'general', 'chart_fg', 'noclaim'),
  R('ja-E08', 'ja', 'E', 'ところで、このあとの面接って何時からでしたっけ', 'recruiting', 'chart_fg', 'noclaim'),
  R('ja-E09', 'ja', 'E', 'お医者さんに腰をやったって言われて、しばらく在宅にします', 'general', 'flow_fg', 'noclaim'),
  R('ja-E10', 'ja', 'E', '承認待ちの稟議がたまってて、今週は身動き取れないです', 'team-meet', 'flow_fg', 'noclaim'),
  // F — the bar chart is on the table
  R('ja-F01', 'ja', 'F', '一番多いのって General Practice ですよね。二番目との差ってどれくらいあります?', 'sales', 'chart_fg', 'claim', { op: 'explain' }),
  R('ja-F02', 'ja', 'F', '皮膚科のバーだけ色変えて目立たせてもらえますか', 'team-meet', 'chart_fg', 'claim', { op: 'update' }),
  R('ja-F03', 'ja', 'F', '同じ内容を表でもいただけますか。診療科と件数の二列で', 'sales', 'chart_fg', 'claim', { op: 'create', view: 'matrix' }),
  R('ja-F04', 'ja', 'F', 'きょうこのあと打ち合わせ何件入ってたっけ', 'general', 'chart_fg', 'noclaim'),
  // G — the refill flowchart is on the table
  R('ja-G01', 'ja', 'G', 'このひし形のとこで「いいえ」になった場合、患者さんには誰が連絡するんですか', 'call-center', 'flow_fg', 'claim', { op: 'explain' }),
  R('ja-G02', 'ja', 'G', '薬局に送る前に、在庫確認のステップをはさんでください', 'call-center', 'flow_fg', 'claim', { op: 'update' }),
  R('ja-G03', 'ja', 'G', 'リフィルって言えば、あの店コーヒーのおかわり自由らしいですよ', 'general', 'flow_fg', 'noclaim'),
];
