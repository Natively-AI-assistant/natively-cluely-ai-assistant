// Requests for a drawing said in Spanish, Russian, Chinese or Japanese.
//
// The decision rules in diagramRequest.mjs read English. The app ships in
// these four languages too, and until 2026-10-02 a request made in one of them
// ("Dibuja la arquitectura", "Нарисуй схему", "画一个架构图", "構成図を描いて")
// was answered in words with no drawing and no notice.
//
// This module is consulted ONLY when the English rules found nothing to do
// (see `resolveDiagramRequest`), and only for text in one of these languages,
// so nothing the English rules decide can change because of it.
//
// It follows the same principles, in a much smaller vocabulary:
//   - a drawing is asked for by the MOOD of a sentence — an instruction, a
//     request, a wish for one — never by a statement that mentions one
//     ("ayer dibujé un diagrama", "我昨天画了一个架构图"), a question about what
//     one is ("¿qué es un diagrama de secuencia?"), or a remark that one is not
//     wanted ("sin diagrama", "без схемы", "不要画图", "図はいらない");
//   - "design a <software system>" gets an architecture; designing a logo or a
//     poster does not;
//   - a follow-up on the drawing on the table needs evidence that it is about
//     it: it names the drawing ("el diagrama", "на схеме", "图里", "この図"),
//     or — while the conversation is on it — it uses a word a design is
//     discussed in, or one of the drawing's own labels. An edit that goes
//     somewhere else ("añade a María a la invitación") is not one.
//
// What it does NOT do: unasked ("contextual") visuals, the finer follow-up
// forms (pronoun-only edits, capability questions, elliptical questions), and
// reading the inputs of a calculation out of the sentence. Those remain
// English-only. Languages other than these four are not recognised at all.
//
// What these rules cannot place is not dropped (2026-10-02). Five blind sets
// showed that they do not converge: about a third of real requests on unseen
// sentences went unrecognised, whatever was added after the set before. So a
// turn they cannot place, in which a drawing is plausibly in play — the one on
// the table is in focus or is named, or a visual is mentioned at all — is
// handed to the model that answers, with the question left open (see
// `undecidedOtherLanguageTurn`, and the "undecided" contract in
// diagramContract.mjs). No second call: the same generation decides and answers.

const MAX_CHARS = 2400;
const MAX_SENTENCES = 6;

// A letter-or-digit boundary. (`\b` is ASCII-only in JavaScript, with or
// without the `u` flag: `\bдиаграмм` never matches.)
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const word = (alternatives, flags = 'u') => new RegExp(`${B}(?:${alternatives})${E}`, flags);
const startsWith = (alternatives) => new RegExp(`^(?:${alternatives})${E}`, 'u');

/** @typedef {{ view: string, chartIntent?: string, layout?: 'lanes' | 'tree' }} Visual */

// ── Spanish ─────────────────────────────────────────────────────────────────

const ES_WORD_RE = word(
  'dibuj\\w+|diagramas?|esquemas?|grafic[oa]s?|arquitectura|flujo|flujograma|secuencia|tabla|organigrama|cronograma|disen[ae]\\w*|muestra\\w*|mostrar\\w*|hazme|hazlo|anad\\w+|agreg\\w+|quita\\w*|elimina(?:r|lo|la|le|los|las)?|elimine|reemplaza\\w*|cambia\\w*|ponlo|quiero|necesito|puedes|podrias|hagamos|explica(?:me|nos|r|lo)?|servicio|cache de',
);

// Two of the small words English is made of, and no letter English lacks: the
// sentence is English, whatever Spanish-looking word it holds ("eliminate",
// "explicate", "cola").
const EN_SMALL_RE = /(?<![\p{L}\p{N}])(?:the|and|of|to|is|are|for|with|this|that|it|you|my|we|can|was|have|does|what|how|why)(?![\p{L}\p{N}])/gu;

const ES = {
  code: 'es',
  spaced: true,
  // What tells this text from English: a letter or a mark English does not
  // use, or two of the small words Spanish is made of. (This module is only
  // asked when the English rules found nothing, and then still needs a
  // Spanish verb, so a stray match here costs nothing.)
  marks: {
    test(q) {
      if (/[ñ¿¡áéíóú]/u.test(q)) return true;
      const english = q.match(EN_SMALL_RE);
      if (english && new Set(english).size >= 2) return false;
      // A short command may hold neither ("dibuja la arquitectura", "quita la
      // cola"): a word that is Spanish and is not an English word.
      if (ES_WORD_RE.test(q)) return true;
      const small = q.match(/(?<![\p{L}\p{N}])(?:el|la|los|las|un|una|del|al|que|por|para|con|es|como|de|en|lo|se|su|mi|tu|y|esto|este|esta|eso|entonces|nunca|pero|porque|tambien|también|ahora|estoy|estamos|muy|donde|cuando|quien|nos|les|sus)(?![\p{L}\p{N}])/gu);
      return Boolean(small) && new Set(small).size >= 2;
    },
  },
  lead: startsWith('ok(?:ay)?|vale|bueno|bien|entonces|ahora|oye|mira|a ver|por favor|porfa|y|pues|eh|este|claro|perfecto|genial|listo|che|dale|escucha(?:me)?|oigan?'),
  // "¿Puedes …?", "quiero que …", "me gustaría que …": what follows is asked for.
  // (Also the voseo of the Río de la Plata — "¿me podés armar…?" — and the
  // formal "¿puede usted…?".)
  ask: startsWith(
    '(?:me |nos )?(?:puedes|pod[eé]s|podr[ií]as|puede|podr[ií]a|pueden|podr[ií]an)(?: usted| ustedes| t[uú]| vos)?(?: por favor)?|te importar[ií]a|le importar[ií]a|ser[ií]a posible|(?:quiero|necesito|quisiera|me gustar[ií]a|queremos|necesitamos) que|vamos a|hay que|ay[uú]dame a|ay[uú]danos a|estar[ií]a (?:bueno|bien|genial|b[aá]rbaro|copado) que|vendr[ií]a bien que|ser[ií]a (?:bueno|genial|[uú]til|ideal) que|me servir[ií]a que',
  ),
  draw: startsWith(
    '(?:me |nos )(?:lo |la |los |las )?dibuj[aá]s|expl[ií]ca(?:me|nos)? (?:visualmente|graficamente)|dib[uú]ja(?:me|nos|lo|la|los|las)?|dibuje(?:me|n)?|dibujes|dibujar(?:me|lo|la)?|dibujemos|me dibujas|esboza(?:me)?|esbozar|bosqueja(?:me)?|bosquejar|traza(?:me)?(?= (?:un|una|el|la|los|las|como|esto|eso|este|esta|en un|en una))|trazar|grafica(?:me)?|graf[ií]came|graficar|ilustra(?:me)?|ilustrar|visualiza(?:me)?|visualizar|p[ií]nta(?:me)?(?= (?:un|una|el|la|c[oó]mo))|diagrama(?:me)?(?= (?:el|la|los|las|esto|eso|c[oó]mo|un|una))',
  ),
  show: startsWith(
    '(?:me |nos )(?:lo |la |los |las )?(?:muestres|hagas|armes|pases|pongas|prepares|generes|des)|mostr[aá](?:me|nos)(?:lo|la)?|armemos|montemos|preparemos|construyamos|(?:me |nos )(?:lo |la |los |las )?(?:pon[eé]s|pones|pas[aá]s|hac[eé]s|haces|arm[aá]s|mostr[aá]s|muestras|das)|mu[eé]stra(?:me|nos)?(?:lo|la)?|p[aá]sa(?:me)?l[oa]|convi[eé]rtel[oa]|transf[oó]rmal[oa]|repres[eé]ntal[oa]|muestre(?:me|n)?|muestres|me muestras|mostrar(?:me)?|ens[eé][ñn]a(?:me|nos)?|haz(?:me|nos)?|hacer(?:me)?|h[aá]ga(?:me|nos)?|hagas|hagamos|hac[eé](?:me|nos)?|me hac[eé]s|me haces|me hace|me har[ií]as?|arm[aá](?:me|nos)|crea(?:me)?|crear|cree|crees|genera(?:me)?|generar|genere|generes|prepara(?:me)?|preparar|prepare|elabora(?:me)?|elaborar|elabore|arma(?:me)?|armar|me armas|dame|deme|d[eé]me|danos|pon(?:me|lo|la)?|poner|representa(?:lo|la|me)?|representar|represente|convierte|convi[eé]rte(?:lo|la)|p[aá]sa(?:lo|la|me)|organiza|organizar|resume|resumir|compara|comparar',
  ),
  chartVerb: /^graf[ií]c/u,
  // "Quiero un diagrama de …", "necesito ver un gráfico de …".
  want: startsWith('(?:quiero|necesito|necesitar[ií]a|necesitar[ií]amos|querr[ií]a|quisiera|me gustar[ií]a|me vendr[ií]a bien|queremos|necesitamos|nos gustar[ií]a)(?: (?:ver|tener))?|(?:lo |la |los |las )?(?:puedo|podemos|podr[ií]a|se puede|se podr[ií]a) ver(?:lo|la)?|(?:me |nos )?ech[aá]s? (?:una|la) mano con|(?:me |nos )?ayudas con'),
  // "Un diagrama de secuencia del login", "diagrama de flujo, por favor".
  indefinite: startsWith('un|una|unos|unas'),
  polite: word('por favor|porfa|gracias'),
  finite: word('es|est[aá]|est[aá]n|era|eran|fue|fueron|tiene|tienen|ten[ií]a|muestra|qued[oó]|sirve|parece|hay|hab[ií]a|hizo|hice|hicimos|dibuj[eéó]|dibujamos|cre[eéó]'),
  figurative: startsWith('(?:me |nos )?(?:un |una |el |la )?(?:cuadro|retrato|panorama|l[ií]nea roja|imagen mental)'),
  negation: word(
    'sin (?:ning[uú]n |el |la |los |las )?(?:diagrama|gr[aá]fic[oa]|dibujo|esquema|imagen|im[aá]gen|tabla)\\w*|no (?:me )?(?:dibujes|grafiques|hagas (?:un |el |ning[uú]n )?(?:diagrama|dibujo|gr[aá]fic[oa]|esquema)|quiero (?:un |el |ning[uú]n )?(?:diagrama|dibujo|gr[aá]fic[oa]|esquema)|necesito (?:un |el |ning[uú]n )?(?:diagrama|dibujo|gr[aá]fic[oa]|esquema)|hace falta (?:un |el |ning[uú]n )?(?:diagrama|dibujo|gr[aá]fic[oa]))|s[oó]lo (?:con )?(?:texto|palabras)|solamente texto',
  ),
  about: word('qu[eé] es (?:un|una|el|la)|qu[eé] son (?:los|las)|qu[eé] significa|cu[aá]l es la diferencia entre (?:un|una|el|la) (?:diagrama|gr[aá]fic[oa]|esquema|tabla)|para qu[eé] sirve|c[oó]mo se (?:lee|llama|hace) (?:un|una)'),
  // "Un resumen DEL diagrama", "una copia de la tabla": one that exists.
  reference: word('(?:resumen|copia|captura|foto|enlace|link|ticket|nota|versi[oó]n|pdf|correo|t[ií]tulo|autor|due[ñn]o) (?:de|del|sobre|con)(?: el| la| los| las)?$'),
  design: startsWith('dise[ñn]a(?:me|nos)?|dise[ñn]e(?:n|mos|s)?|dise[ñn]ar|c[oó]mo dise[ñn]ar[ií]as?|c[oó]mo dise[ñn]ar|c[oó]mo dise[ñn]amos'),
  designNot: word(
    'logo(?:tipo)?|p[aá]gina|cartel|p[oó]ster|folleto|presentaci[oó]n|diapositiva|camiseta|men[uú]|portada|encuesta|plan de (?:estudios|carrera)|curr[ií]culum|oficina|casa|vestido|tarjeta|banner|anuncio|experimento|taller|entrevista|cuestionario',
  ),
  nouns: [
    [word('organigrama|estructura organizativa'), { view: 'responsibility' }],
    [word('[aá]rbol de decisi[oó]n(?:es)?'), { view: 'decision' }],
    [word('diagrama de arquitectura|arquitectura del? sistema|diagrama de componentes|diagrama de despliegue'), { view: 'architecture' }],
    [word('diagrama de secuencias?'), { view: 'sequence' }],
    [word('carriles|swimlanes?|diagrama de (?:carriles|calles)'), { view: 'flowchart', layout: 'lanes' }],
    [word('(?:como|en) (?:un )?[aá]rbol|diagrama de [aá]rbol|jerarqu[ií]a'), { view: 'flowchart', layout: 'tree' }],
    [word('diagrama de flujo|flujograma|diagrama de procesos?'), { view: 'flowchart' }],
    [word('diagrama de estados?|m[aá]quina de estados?'), { view: 'state' }],
    [word('diagrama (?:er|e-r|entidad[- ]relaci[oó]n|de entidad[- ]relaci[oó]n)|modelo (?:de datos|entidad[- ]relaci[oó]n)|esquema de (?:la )?base de datos'), { view: 'er' }],
    [word('diagrama de clases|diagrama uml'), { view: 'class' }],
    [word('mapa (?:mental|conceptual)'), { view: 'mindmap' }],
    [word('diagrama de gantt|gantt|cronograma'), { view: 'gantt' }],
    [word('l[ií]nea de(?:l)? tiempo|cronolog[ií]a'), { view: 'timeline' }],
    [word('diagrama de dependencias|mapa de dependencias|grafo de dependencias'), { view: 'dependency' }],
    [word('gr[aá]fic[oa] (?:circular|de (?:pastel|torta|tarta|sectores|pie))'), { view: 'chart', chartIntent: 'breakdown' }],
    [word('gr[aá]fic[oa] de (?:barras|l[ií]neas|columnas|[aá]reas|dispersi[oó]n)|histograma'), { view: 'chart', chartIntent: 'trend' }],
    [word('embudo'), { view: 'chart', chartIntent: 'funnel' }],
    [word('(?:un|una|el|la|este|esta|ese|esa|como|en un|en una) gr[aá]fic[oa]s?'), { view: 'chart', chartIntent: 'generic' }],
    [word('tabla comparativa|cuadro comparativo|(?:en|como|a) (?:una )?tabla|una tabla (?:de|con|que)'), { view: 'matrix' }],
    [word('diagramas?|esquemas?'), { view: null }],
  ],
  hints: [
    [word('arquitectura|componentes|infraestructura|despliegue|cach[eé]s?|balanceador(?:es)?'), 'architecture'],
    [word('qui[eé]n (?:le )?reporta a qui[eé]n|a qui[eé]n (?:le )?reporta|qui[eé]n depende de qui[eé]n'), 'responsibility'],
    [word('secuencia|interacci[oó]n|handshake|llamadas|mensajes entre|se comunican|comunicaci[oó]n entre'), 'sequence'],
    [word('estados|ciclo de vida'), 'state'],
  ],
  // What names the drawing on the table.
  // (Not "el modelo de precios" or "el diseño de la campaña": named with a
  // complement of its own, it is another thing.)
  artifact: word('(?:el|este|ese|la|esta|esa|nuestro|nuestra|del|al|en el|en la) (?:diagrama|esquema|dibujo|gr[aá]fic[oa])|(?:este|ese|esta|esa|nuestro|nuestra) (?:dise[ñn]o|arquitectura)|(?:el|la|del|al|en el|en la) (?:dise[ñn]o|arquitectura)(?! (?:de|del) (?!(?:el |la )?(?:sistema|soluci[oó]n)))'),
  artifactByView: [[word('(?:el|este|ese|nuestro|del|al|en el) modelo(?! (?:de|del) (?!datos))'), ['er', 'class']]],
  // "ESTE diseño", "el sistema actual": the one on the table, pointed at.
  thisDesign: word('(?:este|ese|esta|esa|nuestro|nuestra|dicho|dicha) (?:diagrama|esquema|dise[ñn]o|arquitectura|gr[aá]fic[oa]|dibujo|sistema|tabla)|(?:el|la|del|al) (?:dise[ñn]o|arquitectura|sistema|diagrama|gr[aá]fic[oa]) (?:actual|anterior|de arriba|de antes)|(?:los|esos|estos) mismos datos|la misma informaci[oó]n'),
  // ("It" is the drawing only as the OBJECT of the request — "muéstralo como…",
  // "lo puedo ver como tabla" — never a stray "eso es urgente".)
  itPronoun: word('(?:muestra|convierte|pasa|pon|dibuja|transforma|representa|haz|cambia|expresa|reescribe)(?:me)?l[oa]|l[oa]s? (?:puedo|podemos|puedes|podes|quiero|necesito|pones|pasas|muestras|dibujas)|verl[oa]|(?:muestra|convierte|pasa|pon|dibuja|transforma|representa|haz|cambia|expresa)(?:me)? (?:esto|eso)(?! que)|lo mismo (?:pero|como|en|con)'),
  // A question about what was SAID: its answer is in the meeting's record.
  recall: word('que (?:dijo|dijeron|dijiste|comento|comentaron|menciono|mencionaron|decidimos|decidieron|acordamos|acordaron|quedamos)|quien (?:dijo|menciono|propuso|comento)|que se (?:dijo|decidio|acordo|comento|hablo)|de que (?:hablamos|hablaron)'),
  // A question with its asking word, or its doubt, anywhere in it.
  interrogative: word('que|como|cual(?:es)?|quien(?:es)?|o tambien|o no|acaso|verdad|me lo explicas|no me queda claro|no entiendo'),
  // What a sentence says about where the drawing comes from.
  meeting: word('lo que (?:hemos |acabamos de |ya )?(?:hablado|discutido|comentado|dicho|descrito|hablar|discutir|comentar|describir)|lo que (?:se )?(?:hablo|discutio|dijo|comento|describio|dijimos|hablamos|discutimos|comentamos)|lo (?:discutido|hablado|comentado)|(?:de|en|segun) (?:esta|la|nuestra) (?:reunion|conversacion|llamada|charla)'),
  source: word('(?:en|de|segun) (?:esta|la|mi|el|este) (?:captura|pantalla|imagen|foto|pizarra|documento|archivo|diapositiva)|lo que hay en (?:pantalla|la pantalla)'),
  hypothetical: word('ejemplo|hipotetic[oa]s?|fictici[oa]s?|inventad[oa]s?|supon(?:ga|gamos|iendo)|imagin(?:a|emos|ate)'),
  forecast: word('crec(?:e|en|er|imiento)|proyeccion|pronostico|tasa|interes compuesto'),
  fn: /(?<![\p{L}])(?:y|f\(x\))\s*=|(?<![\p{L}])(?:funcion|parabola|seno|coseno)(?![\p{L}])|x al cuadrado|x\^2/u,
  edit: startsWith(
    'm[eé]te(?:le|lo|la)?|meter(?:le)?|metamos|s[uú]male|sumarle|incorpor[aá](?:le)?|incorporar|(?:yo )?(?:ahi |aqui )?(?:pondria|anadiria|añadiria|agregaria|quitaria|meteria|cambiaria)|a[ñn][aá]de(?:le|lo|los|las)?|a[ñn]adir(?:le)?|a[ñn]adamos|agr[eé]ga(?:le|lo|los|las)?|agregar(?:le)?|agreguemos|inserta(?:r|le)?|coloca(?:r|le)?|falta(?:n)?(?= (?:el|la|los|las|un|una))|quita(?:le|lo)?|quitar|elimina(?:lo|la)?|eliminar|borra(?:lo|la)?|borrar|reemplaza(?:lo|la)?|reemplazar|sustituye|sustituir|cambia(?:lo|la)?|cambiar|conecta(?:lo|la)?|conectar|desconecta|mueve|mover|pon(?:lo|la|le)?|pone(?:le|lo|la)?|poner|saca(?:le|lo|la)?|sacar|c[aá]mbiale|ordena(?:lo|la|los|las)?|ordenar|reordena(?:r|lo|la|los|las)?|agrupa(?:r|lo|la|los|las)?|separa|separar|divide|dividir|une|unir|renombra|renombrar|actual[ií]za(?:lo|la)?|actualizar|incluye|incluir|usa|usar|simplifica(?:lo)?|simplificar|ampl[ií]a(?:lo)?',
  ),
  question: startsWith('por qu[eé]|para qu[eé]|c[oó]mo|qu[eé] pasa(?:r[ií]a)? si|qu[eé] ocurre si|d[oó]nde|cu[aá]l(?:es)?|cu[aá]nt[oa]s?|cada cu[aá]nto|qu[eé]|qui[eé]n(?:es)?|expl[ií]ca(?:me|nos)?|explicar|cu[eé]ntame'),
  // A request that starts late in a spoken sentence, in a form that is
  // addressed to the listener and to nobody else: a request frame, an
  // imperative with "me"/"nos" on it, "let's …", "que me muestres".
  late: /^(?:(?:me |nos )?(?:puedes|podes|podrias|podrian|pueden)(?![\p{L}])|(?:quiero|necesito|quisiera|me gustaria|queremos|necesitamos) que |estaria (?:bueno|bien|genial|barbaro|copado) que |vendria bien que |seria (?:bueno|genial|util|ideal) que |(?:dibuja|esboza|bosqueja|traza|grafica|ilustra|pinta|muestra|mostra|ense[ñn]a|pasa|hace|haz|arma|crea|genera|prepara)(?:me|nos)(?:lo|la|los|las)?(?![\p{L}])|(?:armemos|hagamos|dibujemos|montemos|preparemos|construyamos)(?![\p{L}])|que (?:me |nos )(?:lo |la )?(?:muestres|hagas|armes|pases|pongas|prepares|generes|dibujes)(?![\p{L}]))/u,
  // …unless it is told as something asked of someone: "le pedí que me arme…".
  reported: word('ped[ií]|pidi[oó]|dije|dijo|dijeron|mand[eéo]|encargu[eé]|encarg[oó]|sugiri[oó]|propuso|propuse'),
  // A verb of change after where it goes: "después del reembolso agregá un paso…".
  editAnywhere: word('(?:agrega|a[ñn]ade|pon|pone|mete|inserta|coloca|suma|incorpora|saca|quita|elimina|borra)(?:le|lo|la)? (?:un|una|otro|otra|el|la|ese|esa|este|esta) (?:paso|caja|nodo|servicio|cola|flecha|etapa|rombo|decisi[oó]n|bloque|componente|carril|columna|barra)'),
  // What a part of the drawing SHOULD do is a change to the drawing: "que
  // pagos también mande un evento a la cola", "mejor que la app no pase por
  // el gateway".
  jussive: /^(?:mejor |prefiero |preferiria |yo haria |hagamos |hace(?:r)? )?que (?:el |la |los |las )?[\p{L}\p{N} ]{2,40}? (?:(?:tambien|no|ya no|siempre|directamente|solo) )*(?:mande|envie|pase|vaya|escriba|lea|llame|use|hable|consulte|guarde|publique|notifique|avise|dependa|conecte|apunte|salga|entre|reciba|procese|valide)n?(?![\p{L}])/u,
  // Whether the design holds up, asked of the design: "¿y esto aguanta el Black Friday?".
  holdsUp: word('aguanta\\p{L}*|soporta\\p{L}*|resist(?:e|en|ira|iria)|escala(?:r|ria|ra)?|se (?:nos |me |les )?cae|da abasto|revienta|colapsa|se satura|cuello de botella'),
  barePronoun: word('esto|eso'),
  // An asking word wherever it stands: "¿y la caché cada cuánto se invalida?",
  // "y si la cola se llena qué pasa con los mensajes".
  asksAnywhere: word('por qu[eé]|para qu[eé]|cada cu[aá]nto|cu[aá]nt[oa]s?|qu[eé] pasa|qu[eé] ocurre|d[oó]nde'),
  terms: word(
    'cach[eé]s?|colas?|bases? de datos|bd|servicios?(?! (?:de|al) (?:limpieza|catering|comida|seguridad|transporte|mensajer[ií]a|taxi|habitaciones|atenci[oó]n al cliente|cliente))|microservicios?|balanceador(?:es)?|r[eé]plicas?|nodos?|api|gateway|pasarela|autenticaci[oó]n|broker|kafka|redis|cdn|reintentos?|flechas?|componentes?|servidor(?:es)?|workers?|trabajadores|limitador|almacenamiento|[ií]ndices?|particiones|partici[oó]n|monitoreo|cuello de botella',
  ),
  // Words of everyday speech too ("¿cuántos clientes tenemos?", "los próximos
  // pasos"): each is evidence only for a drawing of the kind that has such
  // things, or one that has the word in it.
  everyday: [
    [word('pasos?|etapas?'), ['flowchart', 'sequence', 'state', 'gantt', 'timeline', 'decision']],
    [word('estados?|transici[oó]n(?:es)?'), ['state']],
    [word('entidad(?:es)?|columnas?|campos?|relaci[oó]n(?:es)?|claves?'), ['er', 'class']],
    [word('participantes?'), ['sequence']],
    [word('clientes?|cajas?|capas?|regi[oó]n(?:es)?'), []],
  ],
  purpose: /^para /u,
  notThis: { before: /(?:no quiero|no necesito|no hace falta|en vez de|en lugar de|nada de)\s*$/u },
  // "Usa el cliente la API actualmente": the verb first, then WHO does it and
  // WHAT to — two noun phrases with nothing between them. The imperative has
  // one ("usa la cola para los pedidos"), and what follows it is a
  // preposition or a measure ("mueve la cola un paso"), not another "el/la".
  verbFirstStatement: /^(?:usa|a[ñn]ade|agrega|incluye|incorpora|cambia|mueve|quita|elimina|borra|reemplaza|sustituye|conecta|desconecta|separa|divide|une|actuali[zs]a|simplifica|ampl[ií]a|inserta|coloca|renombra) (?:el|la|los|las) [\p{L}\p{N}-]+ (?:el|la|los|las|su|sus) [\p{L}\p{N}]/u,
  // A lane of a swimlane diagram, said as one.
  laneWord: word('carril(?:es)?|swimlanes?|calle(?:s)?'),
  // A drawing is MENTIONED, in any mood and by any verb that makes one. Far
  // too wide to decide on — it is only what makes the turn worth asking the
  // model about (see undecidedOtherLanguageTurn).
  // What KIND a mentioned drawing would be, where the nouns above ask for a
  // form of request these do not ("una tabla" in any place in the sentence).
  // Read only for an undecided turn: they never decide anything.
  // A question about a KIND of drawing — what one is, what it is for, how two
  // differ, how to read one. Wider than `about` above, and read only for an
  // undecided turn: with no verb that draws in the sentence, it asks for words.
  aboutKind: word('que es|que son|que significa|para que sirven?|cual es la diferencia|que diferencia hay|en que se diferencian?|como se leen?|como se interpreta'),
  looseNouns: [
    [word('tablas?|tablita|cuadro (?:comparativo|resumen|sinoptico)'), { view: 'matrix' }],
    [word('grafic[oa]s?|grafiqu\\p{L}*'), { view: 'chart', chartIntent: 'generic' }],
  ],
  visualish: word('cajitas?|flech(?:a|ita)s?|recuadros?|dibuj\\p{L}*|pint(?:a|as|ame|anos|alo|ala|e|es|eme|ar|arlo|arla|arme)|esquem\\p{L}*|diagram\\p{L}*|grafi[cq]\\p{L}*|bosquej\\p{L}*|esboz\\p{L}*|ilustr\\p{L}*|visual\\p{L}*|plasm\\p{L}*|tablas?|tablita|cuadro (?:comparativo|resumen|sinoptico)|organigrama|cronograma|gantt|linea de(?:l)? tiempo|mapa (?:mental|conceptual)|flujograma|embudo|a la vista|de un vistazo'),
  nextSteps: word('(?:proximos|siguientes) pasos|pasos (?:a seguir|siguientes)|siguiente paso'),
  chartTerms: word('tasa|crecimiento|churn|bajas|valor inicial|base|horizonte|meses|mensual|anual|trimestral|per[ií]odo|periodo|proyecci[oó]n|eje|barras?|columnas?|l[ií]neas?'),
  elsewhere: word(
    '(?:al|del|(?:a|en|de|para) (?:la|el|las|los|mi|tu|su|nuestra|nuestro)) (?:invitaci[oó]n|reuni[oó]n|calendario|correo|factura|acta|presentaci[oó]n|documento|informe|lista|agenda|ticket|diapositiva|llamada|pedido|carrito|contrato|canal|restaurante|hotel|tienda|banco|aeropuerto|hospital)',
  ),
};

// ── Russian ─────────────────────────────────────────────────────────────────

const RU = {
  code: 'ru',
  spaced: true,
  marks: /[Ѐ-ӿ]/u,
  lead: startsWith('ну|так|ладно|хорошо|окей|ок|слушай(?:те)?|смотри(?:те)?|пожалуйста|а|и|тогда|теперь|ага|понятно|отлично|супер|вот'),
  ask: startsWith(
    '(?:а )?(?:ты |вы )?(?:можешь|можете|сможешь|сможете|мог(?:ла)? бы|могли бы|не мог(?:ла)? бы|не могли бы)(?: ты| вы)?(?: пожалуйста)?|(?:я )?(?:хочу|хотел(?:а)? бы|хотим|хотелось бы)(?:,)? чтобы (?:ты|вы)|нужно|надо|помоги(?:те)?|давай(?:те)?|можно(?: ли)?|стоит(?: ли)?',
  ),
  draw: startsWith(
    'ты (?:нарисуешь|рисуешь)|нарисуй(?:те)?|нарисовать|нарисуем|нарисуешь|нарисуете|(?:вместе |сейчас |быстро )(?:нарисуем|набросаем)|начерти(?:те)?|начертить|изобрази(?:те)?|изобразить|набросай(?:те)?|набросать|накидай(?:те)?|накидать|накидаем|визуализируй(?:те)?|визуализировать|отрисуй(?:те)?|отрисовать|зарисуй(?:те)?',
  ),
  show: startsWith(
    'ты (?:построишь|строишь|сделаешь|делаешь|составишь|составляешь|покажешь)|покажи(?:те)?|показать|построй(?:те)?|построить|построим|сделай(?:те)?|сделать|сделаем|создай(?:те)?|создать|составь(?:те)?|составить|сгенерируй(?:те)?|сгенерировать|подготовь(?:те)?|подготовить|представь(?:те)?|представить|выведи(?:те)?|вывести|оформи(?:те)?|оформить|сведи(?:те)?|свести|разложи(?:те)?|разложить|разложим|распиши(?:те)?|расписать|дай(?:те)?|преобразуй(?:те)?|переведи(?:те)?|сравни(?:те)?|сравнить',
  ),
  // ("Мне бы диаграмму …", "давай схему: …": a wish for the thing, with no verb.)
  want: startsWith('можно(?: ли)?(?= (?:\\p{L}+ ){0,3}(?:схем|диаграмм|график|таблиц|блок))|(?:я )?(?:хочу|хотел(?:а)? бы|хотим|хотелось бы)(?: (?:увидеть|видеть|посмотреть|получить))?|(?:мне |нам )?(?:нужн[аоы]?|нужен|понадобится)|(?:мне|нам) бы|давай(?:те)?(?= (?:\\p{L}+ )?(?:схем|диаграмм|график|таблиц|блок|таймлайн|майнд))'),
  indefinite: null,
  polite: word('пожалуйста|плиз|спасибо'),
  finite: word('есть|был[аои]?|будет|устарел[аои]?|показывает|выглядит|лежит|находится|нарисовал[аи]?|сделал[аи]?|построил[аи]?|видел[аи]?|отправил[аи]?'),
  figurative: startsWith('(?:мне |нам )?(?:общую |полную |эту |такую )?(?:картин\\p{L}*|портрет\\p{L}*|образ\\p{L}*)'),
  negation: word(
    'без (?:всяких |каких-либо )?(?:диаграмм|схем|график|рисунк|картин|визуал|таблиц)\\p{L}*|не (?:рисуй(?:те)?|надо рисовать|нужно рисовать|стоит рисовать|нужн[аоы]? (?:никак\\p{L}* )?(?:диаграмм|схем|график)\\p{L}*|надо (?:диаграмм|схем)\\p{L}*)|только (?:текст\\p{L}*|словами)|просто словами',
  ),
  about: word('что такое|что значит|чем отлича\\p{L}+|в ч[её]м разница|для чего нуж\\p{L}+|как называется|как читать'),
  reference: word('(?:резюме|копи\\p{L}+|скриншот\\p{L}*|ссылк\\p{L}+|тикет\\p{L}*|заметк\\p{L}+|верси\\p{L}+|автор\\p{L}*|владел\\p{L}+|описани\\p{L}+)(?: к| по| для| на)?$'),
  design: startsWith(
    'спроектируй(?:те)?|спроектировать|спроектируем|спроектируешь|чтобы (?:ты|вы) спроектировал[аи]?|разработай(?:те)? архитектуру|разработать архитектуру|как (?:бы )?(?:ты |вы )?спроектировал[аи]?(?: бы)?|как спроектировать|как бы ты построил[аи]?|задизайнь(?:те)?',
  ),
  designNot: word('логотип\\p{L}*|дом\\p{L}*|здани\\p{L}+|интерьер\\p{L}*|мост\\p{L}*|упаковк\\p{L}+|одежд\\p{L}+|плакат\\p{L}*|презентаци\\p{L}+|баннер\\p{L}*|опрос\\p{L}*|анкет\\p{L}+|эксперимент\\p{L}*'),
  nouns: [
    [word('оргструктур\\p{L}*|орг\\.? ?схем\\p{L}+|организационн\\p{L}+ (?:структур|схем)\\p{L}*'), { view: 'responsibility' }],
    [word('дерев\\p{L}+ решений'), { view: 'decision' }],
    [word('архитектурн\\p{L}+ (?:схем|диаграмм)\\p{L}*|(?:схем|диаграмм)\\p{L}+ архитектур\\p{L}*|(?:схем|диаграмм)\\p{L}+ компонент\\p{L}*|(?:схем|диаграмм)\\p{L}+ развертывани\\p{L}+'), { view: 'architecture' }],
    [word('диаграмм\\p{L}+ последовательност\\p{L}+|sequence[- ]диаграмм\\p{L}+|сиквенс[- ]?диаграмм\\p{L}+'), { view: 'sequence' }],
    [word('swimlane|дорожк\\p{L}+|плавательн\\p{L}+ дорожк\\p{L}+'), { view: 'flowchart', layout: 'lanes' }],
    [word('(?:в виде|как|как в) дерев\\p{L}+|древовидн\\p{L}+|иерархи\\p{L}+'), { view: 'flowchart', layout: 'tree' }],
    [word('блок[- ]схем\\p{L}+|флоучарт\\p{L}*|(?:схем|диаграмм)\\p{L}+ (?:процесс|потока|алгоритм)\\p{L}*'), { view: 'flowchart' }],
    [word('диаграмм\\p{L}+ состояни\\p{L}+|конечн\\p{L}+ автомат\\p{L}*|машин\\p{L}+ состояни\\p{L}+'), { view: 'state' }],
    [word('er[- ]диаграмм\\p{L}+|схем\\p{L}+ (?:базы данных|бд|данных)|модел\\p{L}+ данных'), { view: 'er' }],
    [word('диаграмм\\p{L}+ классов|uml[- ]диаграмм\\p{L}+'), { view: 'class' }],
    [word('майнд[- ]?м[эа]п\\p{L}*|интеллект[- ]карт\\p{L}+|ментальн\\p{L}+ карт\\p{L}+|карт\\p{L}+ мыслей'), { view: 'mindmap' }],
    [word('диаграмм\\p{L}+ ганта|гант\\p{L}*'), { view: 'gantt' }],
    [word('таймлайн\\p{L}*|хронологи\\p{L}+|временн\\p{L}+ (?:шкал|лини)\\p{L}+|лент\\p{L}+ времени'), { view: 'timeline' }],
    [word('(?:граф|схем|диаграмм)\\p{L}* зависимост\\p{L}+'), { view: 'dependency' }],
    [word('кругов\\p{L}+ диаграмм\\p{L}+'), { view: 'chart', chartIntent: 'breakdown' }],
    [word('столбчат\\p{L}+ диаграмм\\p{L}+|гистограмм\\p{L}+|линейн\\p{L}+ график\\p{L}*'), { view: 'chart', chartIntent: 'trend' }],
    [word('воронк\\p{L}+'), { view: 'chart', chartIntent: 'funnel' }],
    // ("График работы", "график отпусков" are schedules, not charts.)
    [word('график\\p{L}*(?! (?:работ|отпуск|дежурств|встреч|платеж|поставок|смен|занятий|уборк)\\p{L}*)'), { view: 'chart', chartIntent: 'generic' }],
    [word('(?:в виде|в) табли[цч]\\p{L}+|сравнительн\\p{L}+ табли[цч]\\p{L}+|табли[цч]\\p{L}+ сравнени\\p{L}+|таблицей|табличкой'), { view: 'matrix' }],
    [word('диаграмм\\p{L}+|схем\\p{L}+(?! (?:проезд|метро|лечени|оплат)\\p{L}*)'), { view: null }],
  ],
  hints: [
    [word('кто кому подчиня\\p{L}+|кому подчиня\\p{L}+|кто кому отчитыва\\p{L}+'), 'responsibility'],
    [word('сущност\\p{L}+ и (?:их )?связ\\p{L}+|таблиц\\p{L}+ и (?:их )?связ\\p{L}+'), 'er'],
    [word('архитектур\\p{L}+|компонент\\p{L}+|инфраструктур\\p{L}+'), 'architecture'],
    [word('последовательност\\p{L}+|взаимодействи\\p{L}+|вызов\\p{L}*|обмен сообщениями|общаются|общение между'), 'sequence'],
    [word('состояни\\p{L}+|жизненн\\p{L}+ цикл\\p{L}*'), 'state'],
  ],
  // (График — a chart and a schedule; модель — a data model and any model:
  // each names the drawing only when the drawing is one.)
  artifact: word('(?:эт\\p{L}{1,3}|наш\\p{L}{1,3}|т\\p{L}{1,2}|текущ\\p{L}{2,3}|на|в|из|к|по) (?:диаграмм|схем|архитектур|дизайн|картинк|рисунк|чертеж)\\p{L}*|(?:обнови|исправь|перерисуй|поправь)(?:те)? (?:диаграмм|схем|картинк|рисунок|рисунк)\\p{L}*'),
  artifactByView: [
    [word('(?:эт\\p{L}{1,3}|наш\\p{L}{1,3}|т\\p{L}{1,2}|текущ\\p{L}{2,3}|на|в|из|к) график\\p{L}*|(?<!отста\\p{L}{1,4} |опережа\\p{L}{1,4} |ид[её]м |ид[её]т |успева\\p{L}{1,4} )по график\\p{L}*|(?:обнови|исправь|перерисуй|поправь)(?:те)? график\\p{L}*'), ['chart', 'gantt']],
    [word('(?:эт\\p{L}{1,3}|наш\\p{L}{1,3}|текущ\\p{L}{2,3}|в|из|к|по) модел\\p{L}*'), ['er', 'class']],
  ],
  thisDesign: word('(?:эт\\p{L}{1,3}|наш\\p{L}{1,3}|т(?:у|ой|от|о|ом|ого)|текущ\\p{L}{2,3}) (?:диаграмм|схем|архитектур|график|дизайн|систем|таблиц)\\p{L}*|те же (?:сам\\p{L}+ )?(?:данные|цифры|числа)|эти (?:же )?(?:данные|цифры)|ту же информацию'),
  itPronoun: word('(?:покажи|нарисуй|представь|преобразуй|переведи|сделай|оформи|выведи|изобрази|построй|перерисуй|можно)(?:те)? (?:мне |нам )?(?:это|его|е[её])(?! \\p{L}*(?:срочно|важно))|то же самое'),
  recall: word('(?:называл|озвучивал|озвучил|приводил)[аи]? (?:цифр|сумм|числ|пример|срок)\\p{L}*|что (?:\\p{L}+ )?(?:сказал[аи]?|говорил[аи]?|упоминал[аи]?|решили|договорились|предлагал[аи]?)|кто (?:сказал|говорил|упомянул|упоминал|предложил|предлагал)|о ч[её]м (?:говорили|договорились|шла речь)|что было сказано'),
  interrogative: word('ли|или|разве|неужели|не (?:станет|будет|упад[её]т|ляжет|сломается)|почему|зачем|как|что|где|сколько|како\\p{L}{1,2}'),
  meeting: word('то,? что (?:мы )?(?:только что |сейчас |уже )?(?:обсудили|обсуждали|говорили|сказали|описали|проговорили)|что (?:мы )?(?:только что |сейчас )?(?:обсудили|обсуждали|проговорили)|(?:из|по|на основе) (?:нашего |этого |нашей |этой )?(?:разговор|обсуждени|созвон|встреч|бесед)\\p{L}*|обсужд[её]нн\\p{L}+'),
  source: word('(?:на|в|из|по) (?:этом |этой |моем |мо[её]м )?(?:скриншот|экран|картинк|изображени|фото|доск|документ|файл|слайд)\\p{L}*'),
  hypothetical: word('пример\\p{L}*|например|гипотетическ\\p{L}+|условн\\p{L}+|вымышленн\\p{L}+|допустим|предположим|представим'),
  forecast: word('рост\\p{L}*|раст[её]т|прогноз\\p{L}*|ставк\\p{L}+|сложн\\p{L}+ процент\\p{L}*'),
  fn: /(?<![\p{L}])(?:y|f\(x\))\s*=|функци\p{L}+|парабол\p{L}+|синус\p{L}*|x\^2|икс в квадрате/u,
  edit: startsWith(
    'вместо(?= \\p{L}+ (?:сделаем|сделай|поставим|поставь|возьм[её]м|используем|используй|добавим|добавь))|добавь(?:те)?|добавить|добавим|соедини(?:те)?|соединить|подключи(?:те)?|вставь(?:те)?|вставить|дорисуй(?:те)?|дорисовать|пририсуй(?:те)?|допиши(?:те)?|убери(?:те)?|убрать|уберем|удали(?:те)?|удалить|замени(?:те)?|заменить|заменим|измени(?:те)?|изменить|поменяй(?:те)?|поменять|перенеси(?:те)?|перенести|вынеси(?:те)?|раздели(?:те)?|разделить|объедини(?:те)?|объединить|переименуй(?:те)?|обнови(?:те)?|обновить|используй(?:те)?|поставь(?:те)?|поставить|упрости(?:те)?|упростить|расширь(?:те)?|отсортируй(?:те)?|отсортировать|упорядочь(?:те)?|упорядочить|переставь(?:те)?|сгруппируй(?:те)?|(?:тут |здесь |там )?не хватает(?! (?:времени|денег|людей|рук|сил|ресурсов|мест[а]?|бюджета|данных|информации))',
  ),
  asksAnywhere: word('почему|зачем|для чего|как часто|что будет|что произойд[её]т|что тогда|что делать|как быть'),
  late: /^(?:нарисуй|начерти|изобрази|набросай|накидай|визуализируй|отрисуй|зарисуй|покажи|построй|сделай|создай|составь|сгенерируй|подготовь|выведи|оформи|сведи|разложи|распиши|дай|давай)(?:те)?(?![\p{L}])|^(?:можешь|можете|сможешь|не мог(?:ла)? бы|мог(?:ла)? бы|не могли бы|могли бы)(?![\p{L}])/u,
  reported: word('попросил[аи]?|просил[аи]?|сказал[аи]?|велел[аи]?|предложил[аи]?|поручил[аи]?'),
  // The imperative is its own form in Russian: wherever it stands, it asks.
  editAnywhere: word('добавь(?:те)?|убери(?:те)?|удали(?:те)?|замени(?:те)?|поменяй(?:те)?|перенеси(?:те)?|подключи(?:те)?|соедини(?:те)?|вставь(?:те)?|поставь(?:те)?|раздели(?:те)?|объедини(?:те)?|переименуй(?:те)?|отсортируй(?:те)?|дорисуй(?:те)?'),
  // "Пусть платёжный сервис тоже пишет в очередь", "лучше бы приложение ходило в CDN".
  jussive: /^(?:пусть|пускай|лучше бы|хорошо бы|(?:надо|нужно|хочу),? чтобы)(?![\p{L}])/u,
  holdsUp: word('выдерж\\p{L}+|потянет|вытянет|упад[её]т|ляжет|масштабиру\\p{L}+|справится|захлебн[её]тся'),
  barePronoun: word('это|оно'),
  question: startsWith('почему|зачем|для чего|из-за чего|как(?:ой|ая|ое|ие)?|сколько|что будет,? если|что если|что произойд[её]т,? если|где|куда|что|объясни(?:те)?|расскажи(?:те)?|поясни(?:те)?'),
  terms: word(
    'к[эе]ш\\p{L}*|очеред\\p{L}+|баз\\p{L}+ данных|бд|сервис\\p{L}*|микросервис\\p{L}*|балансировщик\\p{L}*|реплик\\p{L}+|уз[её]?л\\p{L}*|api|шлюз\\p{L}*|аутентификаци\\p{L}+|авторизаци\\p{L}+|брокер\\p{L}*|kafka|redis|cdn|ретра\\p{L}+|повторн\\p{L}+ попыт\\p{L}+|стрелк\\p{L}+|компонент\\p{L}*|сервер\\p{L}*|воркер\\p{L}*|хранилищ\\p{L}+|индекс\\p{L}*|шард\\p{L}*|мониторинг\\p{L}*|узк\\p{L}+ мест\\p{L}+',
  ),
  everyday: [
    [word('шаг\\p{L}*|этап\\p{L}*'), ['flowchart', 'sequence', 'state', 'gantt', 'timeline', 'decision']],
    [word('состояни\\p{L}+|переход\\p{L}*'), ['state']],
    [word('сущност\\p{L}+|колонк\\p{L}+|пол[ея]\\p{L}{0,2}|связ\\p{L}+|ключ\\p{L}*'), ['er', 'class']],
    [word('участник\\p{L}*'), ['sequence']],
    [word('клиент\\p{L}*|блок\\p{L}*|сло[йяюе]\\p{L}*|регион\\p{L}*'), []],
  ],
  purpose: /^для /u,
  notThis: { before: /(?:вместо|не надо|не нужно|не нужен|не нужна)\s*$/u },
  // "медкарт", "техподдержка", "зарплата": two words of a name run into one,
  // the first cut to its opening letters (see usesLabel).
  compounds: true,
  laneWord: word('дорожк\\p{L}*'),
  aboutKind: word('что такое|что значит|чем (?:[\\p{L}-]+ ){0,5}отлича\\p{L}+|в ч[её]м разница|в ч[её]м отличие|для чего нуж\\p{L}+|зачем нуж\\p{L}+|как читать|как называется'),
  looseNouns: [
    [word('табли[цч]\\p{L}*'), { view: 'matrix' }],
    [word('график\\p{L}*|столбик\\p{L}*|столбц\\p{L}*'), { view: 'chart', chartIntent: 'generic' }],
    [word('майнд[- ]?карт\\p{L}*'), { view: 'mindmap' }],
  ],
  visualish: word('столбик\\p{L}*|столбц\\p{L}*|столбчат\\p{L}*|майнд[- ]?карт\\p{L}*|нарис\\p{L}*|рису\\p{L}*|начер\\p{L}*|изобраз\\p{L}*|наброс\\p{L}*|накид\\p{L}*|отрис\\p{L}*|схем\\p{L}*|диаграмм\\p{L}*|график\\p{L}*|табли[цч]\\p{L}*|картинк\\p{L}*|нагляд\\p{L}*|визуал\\p{L}*|блок[- ]схем\\p{L}*|гант\\p{L}*|таймлайн\\p{L}*|оргструктур\\p{L}*|майнд[- ]?м[эа]п\\p{L}*|воронк\\p{L}*'),
  nextSteps: word('(?:следующ\\p{L}+|дальнейш\\p{L}+|ближайш\\p{L}+) шаг\\p{L}*|шаги дальше|что дальше'),
  chartTerms: word('ставк\\p{L}+|рост\\p{L}*|отток\\p{L}*|начальн\\p{L}+ значени\\p{L}+|баз\\p{L}+|горизонт\\p{L}*|месяц\\p{L}*|ежемесячн\\p{L}+|годов\\p{L}+|квартал\\p{L}*|период\\p{L}*|прогноз\\p{L}*|ос[ьи]\\p{L}*|столбц\\p{L}+|лини\\p{L}+'),
  elsewhere: word(
    '(?:в|на|к|из|для) (?:(?:эт|т|наш|мо|сво|ваш)\\p{L}{1,3} )?(?:приглашени|встреч|календар|письм|сч[её]т|протокол|презентаци|документ|отч[её]т|списо?к|повестк|тикет|слайд|звоно?к|заказ|корзин|договор|канал|ресторан|кафе|отел|гостиниц|магазин|банк|аэропорт|больниц)\\p{L}*',
  ),
};

// ── Chinese ─────────────────────────────────────────────────────────────────

const ZH_NOUNS = [
  [/组织(?:架构|结构)?图/u, { view: 'responsibility' }],
  [/决策树/u, { view: 'decision' }],
  [/架构图|系统图|结构图|部署图|拓扑图|组件图/u, { view: 'architecture' }],
  [/时序图|序列图|顺序图|交互图/u, { view: 'sequence' }],
  [/泳道图|泳道/u, { view: 'flowchart', layout: 'lanes' }],
  [/树状图|树形图|层级图|层次结构图|树形结构/u, { view: 'flowchart', layout: 'tree' }],
  [/流程图/u, { view: 'flowchart' }],
  [/状态(?:转换|迁移)?图|状态机/u, { view: 'state' }],
  [/e-?r图|实体关系图|数据模型|数据库(?:模型|表结构|结构图|设计图)/u, { view: 'er' }],
  [/类图|uml图/u, { view: 'class' }],
  [/思维导图|脑图|概念图/u, { view: 'mindmap' }],
  [/甘特图/u, { view: 'gantt' }],
  [/时间线|时间轴/u, { view: 'timeline' }],
  [/依赖(?:关系)?图/u, { view: 'dependency' }],
  [/饼图|饼状图|扇形图/u, { view: 'chart', chartIntent: 'breakdown' }],
  [/柱状图|条形图|折线图|曲线图|趋势图|直方图/u, { view: 'chart', chartIntent: 'trend' }],
  [/漏斗图/u, { view: 'chart', chartIntent: 'funnel' }],
  [/图表/u, { view: 'chart', chartIntent: 'generic' }],
  [/对比表|比较表|对照表|表格|(?<=[成为])(?:一[张个份])?表(?![格示达现明演扬情面单])/u, { view: 'matrix' }],
  [/示意图|图示|图解|关系图/u, { view: null }],
];
const ZH_NOUN = ZH_NOUNS.map(([re]) => re.source).join('|');
// A verb said of the past, of somebody's ability, or negated is not a request:
// 画了 (drew), 画过 (has drawn), 画的 (that someone drew), 画画 (painting),
// 不会画 (cannot draw), 没画 (did not draw).
// (能不能画, 可不可以画, 要不要画 ask; the 不 inside them negates nothing.)
// (Nor the 画 of 漫画, 企画, 动画, 油画, 壁画; nor a verb with its result and 了:
// 画出了, 画好了, 画完了.)
const ZH_NOT_BEFORE = '(?<!(?<![能可要会是])[不没別别未][会能想要用敢以]?)(?<![漫企動动油国壁插版名录映计])(?<!负责|擅长|喜欢|爱好|学过|学会|习惯|经常|每天|平时|只会|专门)';
const ZH_NOT_AFTER = '(?![过的画]|(?:出来?|好|完|上|下来?|成)?了)';
// Told as something that happened: "我昨天画出了一个架构图", "他上周画完了流程图".
const ZH_STATEMENT_RE = /(?:画|做|绘制|生成|整理|设计|写|发|改)(?:出来?|好|完|过|成)了|(?:已经|昨天|前天|上周|上次|上个月|去年|曾经)[^。！？!?，,]{0,14}(?:画|做|绘制|生成|整理|发)[^。！？!?，,]{0,14}了(?:[。.!！]|$)/u;

const ZH = {
  code: 'zh',
  spaced: false,
  statement: ZH_STATEMENT_RE,
  marks: /[一-鿿]/u,
  negation: /不要(?:再)?(?:画|配?图|图表|表格)|不用(?:画|图|图表)|别画|無需|无需(?:画|图)|不需要(?:画|图|图表|配图)|不画图|不用配图|只要文字|只用文字|纯文字/u,
  // Asking what a KIND OF VISUAL is: the visual's name beside the asking words.
  // ("基础版和专业版的区别列成表格" compares two plans; it asks about no diagram.)
  about: new RegExp(`(?:什么是|什么叫)[^。！？!?，,]{0,6}(?:${ZH_NOUN}|图)|(?:${ZH_NOUN})[^。！？!?，,把]{0,4}(?:是什么|是啥|叫什么|什么意思|的定义|怎么读|怎么念|有什么用)|(?:${ZH_NOUN})(?:和|与|跟)[^。！？!?，,]{0,8}(?:${ZH_NOUN})[^。！？!?，,]{0,3}(?:的区别|有什么区别|有啥区别)`, 'u'),
  // A drawing verb with its object: a picture is asked for whatever it is of.
  draw: new RegExp(`${ZH_NOT_BEFORE}(?:画|绘制|绘)(?:一下|出来?|个|一个|一张|张|一幅|幅)${ZH_NOT_AFTER}|${ZH_NOT_BEFORE}(?:画|绘制)${ZH_NOT_AFTER}[^。！？!?，,]{0,24}?(?:${ZH_NOUN}|图)(?!书|片|像|标|案)|(?:画|做|整理|转|变|改|换|转换|转化|梳理|列|汇总|总结|归纳|绘制|排|写)成(?!了)(?:一[个张份])?[^。！？!?，,]{0,10}(?:${ZH_NOUN})|(?:用|以)[^。！？!?，,]{0,12}?(?:${ZH_NOUN}|图)[^。！？!?，,]{0,12}?(?:表示|展示|说明|画|呈现|显示|来表达|的形式|对比|比较|列出|总结|整理|梳理|汇总|[理捋排列讲过](?:一下|清楚?|出来|一遍))|图示一下|示意一下|可视化一下|(?:想看|想要|给我|来|要|需要)(?:一下)?(?:一[张个幅]|[张个幅])图(?![书片像标案])`, 'u'),
  // A verb that shows or makes whatever its object names: needs a visual noun.
  // (A one-character verb is also a piece of other words — 后来, 我要填, 出在,
  // 排列 — so it asks only with its measure word, or after 帮我 / 请: "来个流程图",
  // "帮我做架构图". 给我 is not the tail of 发给我; "我们来看一下架构图" looks at one.)
  show: new RegExp(`${ZH_NOT_BEFORE}(?:生成|制作|展示|显示|(?<![发交还递传送寄留])给我们?|需要|想要|想看|(?<!我们来?|咱们来?|一起来?|大家来?)(?:看看|看一下)|整理|提供|准备|列出|列一下|做一下|做成|做出)(?![了过])(?:一下|出来?|个|一个|一张|张|一份|份)?[^。！？!?，,]{0,24}?(?:${ZH_NOUN})|${ZH_NOT_BEFORE}(?<![后原本未将从近以出起回看上下过进])(?:来|要|出|列|排|弄|搞|做)(?:一下|个|一个|一张|张|一份|份|一幅)[^。！？!?，,]{0,24}?(?:${ZH_NOUN})|(?:请|帮我|帮忙|麻烦|给我们?)(?:做|列|排|弄|搞|出)[^。！？!?，,了过]{0,24}?(?:${ZH_NOUN})|(?:${ZH_NOUN})[^。！？!?，,了过]{0,6}?(?:麻烦|请|帮我|给我)(?:来|要|出|做|画|整|弄)(?:一个|个|一张|张|一份|份|一下)`, 'u'),
  // "画重点" marks the key points; "画饼" promises what will not come.
  figurative: /[画划](?:一下|个|出|下)?(?:重点|大饼|饼(?![图状])|蛇添足|龙点睛|句号|等号)/u,
  design: /(?<![的了])设计(?![了过])(?:一下|一个|一套|个|出)?(?![师图稿感了过]|模式|风格|原则|文档|评审|思路|得|的|很|不错|有问题)[^。！？!?，,]{0,28}?(?:系统|服务|架构|平台|应用|程序|api|接口|数据库|网站|短链|引擎|中间件|缓存|队列|网关|后端|功能|模块|方案|推荐|搜索|支付|聊天|消息|存储|限流|调度器|爬虫|框架)/u,
  // What is designed is the HEAD of the phrase, which Chinese puts last: "在线
  // 课程平台的后端系统" is a system; "系统的logo" is a logo.
  designNot: /(?:logo|标志|海报|页面|封面|名片|宣传册|问卷|课程|实验|发型|服装|房子|办公室)(?:吧|呢|吗)?[。！？!?，,]*$/u,
  nouns: ZH_NOUNS,
  hints: [
    [/架构|系统|组件|部署/u, 'architecture'],
    [/时序|交互|调用|握手/u, 'sequence'],
    [/状态|生命周期/u, 'state'],
  ],
  // (Not 这个方案 "this plan", 这个流程 "this process", 这个模型 "this model",
  // 表格里 "in the form" — unless the drawing on the table is one; not the 图
  // of 地图 or 截图.)
  artifact: new RegExp(String.raw`这(?:个|张|幅)?图(?![书片标像案表])|那(?:个|张)图(?![书片标像案表])|那个(?:架构|设计)(?![师稿感]|模式|风格|原则|文档|评审)|(?<![地截试企意插配贴拼])图(?:里|中|上)(?![市])|上面的图|刚才的图|之前的图|把图(?![片书标像案表])|(?:更新|修改|改一下)(?:一下)?图(?![片书标像案表])|这个(?:架构|设计)(?![师稿感]|模式|风格|原则|文档|评审)|当前(?:的)?(?:架构|设计|图)`, 'u'),
  artifactByView: [
    [/这个流程(?!图)/u, ['flowchart', 'sequence', 'state']],
    [/这个图表/u, ['chart']],
    [/这个模型/u, ['er', 'class']],
  ],
  // "流程图里", "架构图上": the kind of drawing that is on the table.
  // …and "那张架构图", "刚才那个流程图": pointed at.
  nounPlace: new RegExp(`(?:${ZH_NOUN})(?:里|中|上)|(?:这|那)(?:个|张|幅)(?:${ZH_NOUN})|(?:刚才|之前|上面|前面)(?:的|那(?:个|张|幅))?(?:${ZH_NOUN})`, 'u'),
  thisDesign: /这(?:个|张|幅)?图(?![书片标像案])|那(?:个|张)图(?![书片标像案])|这个(?:架构|设计|系统|图表)|当前(?:的)?(?:架构|设计|图|系统)|(?:上面|刚才|之前)的(?:图|架构|设计|图表)|(?:同样|一样|相同)的(?:数据|内容)|这(?:些|组|份)数据/u,
  // (把这个招聘流程画成… is "this hiring process": a noun follows. 把它画成…,
  // 把这个画成… is "it".)
  itPronoun: /把它|把这个?(?=画|做|转|换|改|整理|变|列|弄|也|再|给我)|(?<![其])它(?=画|做|转|换|改|整理|变|列|也|能|可以)|这个(?:能|可以|可不可以|怎么|也|就|直接|换|转|改|做|画|列|别用|不要用|不用)/u,
  recall: /说了(?:什么|啥)|怎么说的|说过什么|(?:谁|哪位)(?:说|提|讲)|(?:决定|定)了(?:什么|啥)|怎么定的|有没有(?:说|提)|是怎么(?:说|讲|定)的|提到过?什么/u,
  meeting: /(?:讨论|聊|讲|说|提到|描述)(?:的|过的|到的)(?:内容|东西|方案|架构|流程|系统)?|(?:根据|按照|基于)(?:我们|刚才|上面|今天)?(?:的)?(?:讨论|对话|会议|聊天)/u,
  source: /(?:截图|屏幕|图片|照片|白板|文档|文件|幻灯片)(?:里|中|上)/u,
  hypothetical: /举(?:个|一个)?例|例子|示例|例如|假设|假如|假定|虚构|随便(?:编|造|举)/u,
  forecast: /增长|增速|预测|复利/u,
  fn: /(?<![a-z])(?:y|f\(x\))\s*=|函数|抛物线|正弦|x\^2|x的平方/u,
  // (Chinese puts the place before the verb — "在网关前面加一个缓存" — so the
  // verb is found where it stands. Not the 加 of 参加, 更加, 加班 or 加油.)
  edit: /(?<![参更附])加(?:上|一个|个|入|一层|一台|两个|到|在|一步|一项|一条|一道)|连起来|直连|打通|添加|增加|去掉|删除|删掉|移除|拿掉|替换|换成|改成|改为|改名|拆分|拆成|合并|重命名|更新|简化|移到|放到|放(?:一个|个|一层|在)|补(?:上|一个|个|充)|接到|连到|排(?:一下|序|成|个序)|重新?排|调整(?:一下)?顺序/u,
  // What a part of the drawing SHOULD do: "也让支付服务往队列里发一条消息",
  // "看商品不该走网关，直接走CDN更好".
  jussive: /让(?!我|咱|大家|你|他|她)[^。！？!?，,]{1,14}?(?:往|向|给|也|都|直接|先|去|来|不要|别)|不(?:该|应该|用|要|必)[^。！？!?，,]{0,6}?走|应该(?:直接|先|也)[^。！？!?，,]{0,8}?(?:走|连|调|发|读|写)|直接走|改走|别走/u,
  holdsUp: /扛得住|撑得住|顶得住|扛不住|撑不住|顶不住|瓶颈|挂掉|崩掉|会不会崩|压垮/u,
  barePronoun: /这里面|这个|这套|这|它/u,
  whatIf: /要是|如果|万一|假如|假设|的话/u,
  notThis: { before: /(?:不要|别用|不用|不想要|不看|别)(?:这个|那个)?$/u, after: /^(?:就)?(?:不用|不要|算)了/u },
  // "我妈让我给她画个…": asked of the speaker. "回头我自己用Excel做个…": the
  // speaker's own plan.
  reportedBefore: /(?:让|叫|喊|催)我(?:给(?:他|她|它|他们|她们|客户|老板|领导)|帮(?:他|她|他们|她们))?$|我(?:们)?(?:自己|回头|晚点|之后|等会儿?|到时候|私下)[^。！？!?，,]{0,10}$/u,
  asksHow: /为什么|为啥|怎么|如何|哪/u,
  // (Chinese puts the topic first — "数据库挂了会怎么样？", "计费引擎是干什么用的？"
  // — so the asking words are found where they stand, and a final 吗 or 呢 asks.)
  question: /为什么|为啥|怎么|如何|哪里|哪儿|哪个|哪些|什么|干嘛|会怎样|怎样|多久|多少|如果|要是|解释|讲讲|说说|说明一下|吗[?？]*$|呢[?？]*$|[?？]$/u,
  asks: /为什么|为啥|怎么|如何|哪里|哪儿|哪个|哪些|哪一?[块部层环步]|干什么|做什么|是什么|查什么|干嘛|会怎样|怎样|多久|多少|几个|会不会|是不是|有没有|是否|是谁|谁(?:来|在|负责|通知|去)|是[^。！？!?，,]{1,20}还是|吗(?:[?？\s，,]|$)|呢[?？]*$/u,
  // (Not the 表 of 表格 "a form", 表示, 表达; not the 列 of 列表, 列出; not the 层 of 层次.)
  terms: /缓存|队列|数据库|服务(?!员|态度|费|生)|worker|微服务|负载均衡|副本|节点|网关|认证|鉴权|kafka|redis|cdn|重试|字段|箭头|组件|服务器|客户端|索引|分片|监控|限流|瓶颈|单点/u,
  everyday: [
    [/步骤|阶段|环节|(?:这|那|哪|上|下|第[一二三四五六七八九十\d])一?步|一步/u, ['flowchart', 'sequence', 'state', 'gantt', 'timeline', 'decision']],
    [/状态/u, ['state']],
    [/实体|关系|表(?![格示达现明演扬情面单])|列(?![表出举入车])/u, ['er', 'class']],
    [/消息/u, ['sequence']],
    [/区域|存储|日志|层(?![次面出])/u, []],
  ],
  nextSteps: /下一步|接下来|后续步骤/u,
  chartTerms: /增长率|增长|流失|基数|初始值|起始值|月|季度|年|周期|预测|坐标轴|柱|线|从高到低|从低到高|降序|升序/u,
  elsewhere: /负责人|换人|项目经理|邀请|会议|日历|邮件|发票|纪要|ppt|幻灯片|文档|报告|清单|议程|工单|电话|订单|购物车|合同|(?<![集])群(?![集])|餐厅|饭店|酒店|食堂|医院|银行|超市|快递|外卖|客服态度/u,
  // "邮件服务", "订单队列": the word names a part of a system, not the thing itself.
  compoundHead: /^[^。！？!?，,的里上中把给向对在]{0,6}?(?:服务|队列|数据库|系统|模块|组件|网关|缓存|接口|api|集群|节点|存储|索引|中心|引擎|处理器|worker)/u,
  // What an edit adds or changes, when it is a part of a system: "加个…的 worker".
  part: /服务|队列|数据库|系统|模块|组件|网关|缓存|接口|api|集群|节点|存储|索引|引擎|处理器|worker|中间件|负载均衡/u,
  partAfterVerb: true,
  // The generic end of a part's name, dropped in speech: "预约" for the "预约服务".
  genericHead: /(?:服务|系统|数据库|模块|队列|中心|平台|管理|库)$/u,
  laneWord: /泳道/u,
  // (Not the 画 of 画面 or 计划; not the 图 of 图书, 地图, 截图, 企图, 试图.)
  aboutKind: /是什么|是啥|什么是|什么叫|干什么用|干嘛用|有什么用|有啥用|做什么用|什么意思|有什么区别|有啥区别|区别是|的区别|有什么不同|怎么读|怎么看懂/u,
  looseNouns: [
    [/表格|列(?:个|一个|张|一张)表|(?:个|张|份)表(?![格示达现明演扬情面单])/u, { view: 'matrix' }],
  ],
  visualish: /列(?:个|一个|张|一张)表|画(?![面家廊])|(?<![地截试企意插配贴拼])图(?![书片像标案])|表格|时间线|时间轴|甘特|可视化|直观|一目了然|一眼(?:看|就)/u,
};

// ── Japanese ────────────────────────────────────────────────────────────────

const JA_BARE_ZU = '(?<![\\u4e00-\\u9fff])図(?![書鑑るりっら面形表工々])';
const JA_NOUNS = [
  [/組織図|体制図/u, { view: 'responsibility' }],
  [/決定木|デシジョンツリー|ディシジョンツリー/u, { view: 'decision' }],
  [/アーキテクチャ図|システム構成図|構成図|システム図|配置図|デプロイ図|コンポーネント図/u, { view: 'architecture' }],
  [/シーケンス図|シーケンスダイアグラム/u, { view: 'sequence' }],
  [/スイムレーン/u, { view: 'flowchart', layout: 'lanes' }],
  [/ツリー図|樹形図|階層図|ツリー構造|木構造/u, { view: 'flowchart', layout: 'tree' }],
  [/フローチャート|フロー図|流れ図|業務フロー|処理フロー/u, { view: 'flowchart' }],
  [/状態遷移図|ステートマシン図?|状態図/u, { view: 'state' }],
  [/e-?r図|実体関連図|データモデル|テーブル設計/u, { view: 'er' }],
  [/クラス図|uml図/u, { view: 'class' }],
  [/マインドマップ|概念図/u, { view: 'mindmap' }],
  [/ガントチャート|工程表/u, { view: 'gantt' }],
  // (時系列で説明して is "explain it in order of time": no drawing.)
  [/タイムライン|年表|時系列(?:図|の図|チャート|グラフ|表)/u, { view: 'timeline' }],
  [/依存関係図|依存グラフ/u, { view: 'dependency' }],
  [/円グラフ/u, { view: 'chart', chartIntent: 'breakdown' }],
  [/棒グラフ|折れ線グラフ|ヒストグラム|推移グラフ/u, { view: 'chart', chartIntent: 'trend' }],
  [/ファネル/u, { view: 'chart', chartIntent: 'funnel' }],
  [/グラフ|チャート/u, { view: 'chart', chartIntent: 'generic' }],
  // (表に名前を書いて writes a name on a form: 表に counts with what turns something INTO one.)
  [/比較表|一覧表|対応表|表(?:で(?!は)|形式|として|に(?:して|し(?:た|ま)|する)|に(?=まとめ|整理|変換|直し|起こし|落とし))/u, { view: 'matrix' }],
  // 図 alone, or in a compound that is a diagram. Not the 図 of 図書館 (library),
  // 地図 (map), 意図 (intention), 路線図 (route map), 天気図 (weather chart),
  // 心電図 (ECG): after any other kanji it is part of that word.
  [new RegExp(`ダイアグラム|図解|(?:関係|相関|概要|全体|構造|接続|設計|概念|模式|俯瞰|処理|通信|連携|遷移|機能|仕組み)図|${JA_BARE_ZU}`, 'u'), { view: null }],
];
const JA_NOUN = JA_NOUNS.map(([re]) => re.source).join('|');
// The te-form of a verb, as a request: 描いて, 描いてください, 描いてもらえますか.
// Not 描いている (is drawing), 描いてある (has been drawn), 描いてくれた (drew for me).
// (描いていただけますか is the polite request: いただ is not いた.)
// Nor 描いてみた (tried drawing), 描いても (even if drawn). 描いてみましょう and
// 描いてみたい do ask, and so does 描いてから…見せて (draw it, then show…).
const JA_REQUEST_TAIL = '(?!い(?:る|ま|て|た(?!だ))|あ[るり]|お[くき]|[くも]れた|もらった|た|ない|しま|みた(?!い)|みました|も(?!ら)|は|[\\u4e00-\\u9fff][\\u4e00-\\u9fff\\u3040-\\u309f]{0,3}ます(?!か))';
// 書いて is "write" as well as "draw" — "メールを書いて", "議事録を書いて" — so it
// asks for a picture only when one is named: it stands with the verbs that
// show or make, not with the ones that can only mean drawing.
const JA_DRAW_STEM = '(?:描い|図示し|図にし|図式化し|可視化し|見える化し|ビジュアル化し|図解し)';
const JA_SHOW_STEM = '(?:書い|作っ|作成し|示し|見せ|出し|生成し|表し|まとめ|用意し|整理し|出力し|起こし|変換し|直し|落とし|比較し|並べ|くださ|下さ)';

// A sentence that ends in the past tells what happened: "比較表を作ってお客様に
// 送りました" (made a table and sent it) asks for nothing, whatever て-form
// stands in the middle of it.
const JA_PAST_END_RE = /(?:ました|でした|だった|かった|られた|[いきしちにひみりぎじびっん]た)(?:んです|のです|んだ)?(?:よ|ね|けど|が|の)?[。.!！]*$/u;

const JA = {
  code: 'ja',
  spaced: false,
  statement: JA_PAST_END_RE,
  marks: /[぀-ヿ]/u,
  negation: /図(?:は|も|とか)?(?:いらない|要らない|不要|なし|無し|いりません|要りません)|図なしで|図は(?:描かないで|書かないで|やめて|省いて)|描かなくて(?:いい|よい|大丈夫|結構)|文章だけ|テキストだけ|言葉だけで/u,
  // Asking what a KIND OF VISUAL is: the visual's name beside the asking words.
  // ("ベーシックとプロの違いを表にまとめて" compares two plans.)
  about: new RegExp(`(?:${JA_NOUN})(?:と(?:いうの)?は|って(?:何|なに|なん)|の意味|の読み方|とは(?:何|なに|なん))|(?:${JA_NOUN})と[^。！？!?、,]{0,10}(?:${JA_NOUN})の違い`, 'u'),
  draw: new RegExp(`${JA_DRAW_STEM}て${JA_REQUEST_TAIL}|(?:描け|書け)(?:ますか|る[?？]|ます[?？])|(?:図|絵)にして${JA_REQUEST_TAIL}|図で(?:説明|示|表|教え)|図にすると|図示(?:を)?お願い|可視化(?:を)?お願い`, 'u'),
  show: new RegExp(`(?:${JA_NOUN})[^。！？!?、,]{0,16}?(?:${JA_SHOW_STEM}て${JA_REQUEST_TAIL}|(?:を|が|、|,)?\\s?(?:お願い|ください|下さい|欲しい|ほしい|見たい|必要|ちょうだい)|を?ご?用意(?:いただけ|願え|ください)|にして${JA_REQUEST_TAIL}|で(?:お願い|(?:見せて|示して|表して|まとめて|説明して)${JA_REQUEST_TAIL}|見られ|見れ|見たい|もらえ)|(?:見られ|見れ)(?:る|ます)|見たい|(?<=して)(?:もらえ|いただけ|くれ(?!た)|くださ|下さ|ほし|欲し))`, 'u'),
  // What is designed stands right before を設計: a system word, or a loanword
  // in katakana (スケジューラ, クローラ) — which is what software is named in.
  design: /(?:システム|サービス|アーキテクチャ|api|アプリ|データベース|基盤|プラットフォーム|機能|バックエンド|サイト|短縮|検索|決済|通知|(?<![\u30a0-\u30ffー])[\u30a0-\u30ffー]{3,24}(?![\u30a0-\u30ffー]))[^。！？!?、,]{0,20}?(?:を|の)?設計(?:して(?!い(?:る|ま|た(?!だ))|あ[るり])|をして|をお願い|するなら|するとしたら|しましょう|してみて|したい|するには|はどう)|どう(?:やって)?設計(?:し|す)|どのように設計(?:し|す)/u,
  // (The head, which Japanese puts last: "オフィスの入退室管理システム" is a system.)
  designNot: /(?:ロゴ|ポスター|チラシ|名刺|表紙|アンケート|授業|実験|髪型|服|家|オフィス|パンフレット|バナー)(?:を|の)?設計/u,
  nouns: JA_NOUNS,
  hints: [
    [/アーキテクチャ|システム|構成|コンポーネント/u, 'architecture'],
    [/シーケンス|やり取り|呼び出し|ハンドシェイク/u, 'sequence'],
    [/状態|ライフサイクル/u, 'state'],
  ],
  // (Not このモデル "this model" or このフロー "this flow" unless the drawing
  // is one; a kind of drawing named with に/で names the one on the table
  // only when that is the kind on the table.)
  artifact: new RegExp(String.raw`(?:この|その|あの|さっきの|今の|上の|前の)(?:図|設計|アーキテクチャ|構成)|${JA_BARE_ZU}(?:に|の(?!よう)|で|から|を(?:見|更新|修正|直|変))`, 'u'),
  artifactByView: [
    [/(?:この|その|あの|さっきの|今の|上の|前の)(?:グラフ|チャート)/u, ['chart', 'gantt']],
    [/(?:この|その|あの|さっきの|今の|上の|前の)モデル/u, ['er', 'class']],
    [/(?:この|その|あの|さっきの|今の|上の|前の)フロー/u, ['flowchart', 'sequence', 'state']],
  ],
  nounPlace: new RegExp(`(?:${JA_NOUN})(?:に|で|では|の中)`, 'u'),
  thisDesign: /(?:この|その|あの|さっきの|今の|上の|前の)(?:図|設計|アーキテクチャ|構成|グラフ|チャート|システム|表)|同じ(?:内容|データ|数字|情報)|この(?:データ|数字)/u,
  itPronoun: /(?:これ|それ|こちら)(?:を|も|って|\s)|同じもの/u,
  recall: /(?:何|なん)(?:と|て)(?:言|おっしゃ)|(?:言って|話して|おっしゃって)(?:いました|ました|た)(?:っけ|か)|誰が(?:言|話|提案)|(?:何が|どう)決ま(?:りました|った)/u,
  meeting: /(?:話し(?:た|合った|ていた)|議論し(?:た|ていた)|説明し(?:た|ていた)|言っ(?:た|ていた)|出(?:た|てきた))(?:内容|こと|もの|話|構成|設計)|(?:会話|議論|会議|打ち合わせ|ミーティング)(?:の内容|で(?:出た|話した|決まった))/u,
  source: /(?:スクリーンショット|スクショ|画面|画像|写真|ホワイトボード|資料|ファイル|スライド)(?:に|の|から)(?:ある|写って|書いて|映って|中)/u,
  hypothetical: /例えば|たとえば|例として|一例|サンプル|仮に|架空|仮定|ダミー/u,
  forecast: /成長|伸び|予測|複利|増加率/u,
  fn: /(?<![a-z])(?:y|f\(x\))\s*=|関数|放物線|サイン|x\^2|xの2乗|xの二乗/u,
  edit: /(?:分け|追加し|入れ|置い|外し|消し|変え|まとめ|統合し)たほうが(?:いい|良い|よい)|(?:追加し|加え|足し|入れ|置い|配置し|設置し|削除し|消し|外し|取り除い|置き換え|変更し|変え|分け|分割し|統合し|更新し|使っ|簡略化し|シンプルにし|移し|移動し|つなげ|接続し|並べ替え|並び替え|並べ直し|並べ|ソートし|入れ替え)て(?!い(?:る|ま|た(?!だ))|あ[るり]|[くも]れた|た)|(?:挟ん|つない|繋い)で(?!い(?:る|ま|た(?!だ)))|(?:を|に)(?:追加|削除|変更|置換)(?:で|お願い|して)/u,
  question: /^(?:で、?|じゃあ、?|では、?|あと、?|それで、?)*(?:なぜ|どうして|なんで|どう|どこ|どの|どれ|何|もし)|(?:説明して|教えて)(?:ください|下さい|もらえ|ほしい|欲しい|くれ)?[。?？!！]*$|(?:ですか|ますか|ませんか|ましたか|でしたか|でしょうか|のか|の)[?？]*$|なぜ|どうして|どこ|[?？]$/u,
  // What a part of the drawing SHOULD do: "…キューにイベントを流すようにして",
  // "…CDNに直接行くほうがいい".
  jussive: /ようにして|ようにしたい|ようにする|(?:[うくすつぬむるぐぶ]|ない)(?:ほう|方)が(?:いい|良い|よい)|べき(?:です|だ|では|じゃ)/u,
  holdsUp: /耐えられ|耐えき|詰まり|詰まる|ボトルネック|さばけ|さばき|パンク|落ちま|落ちる/u,
  barePronoun: /これ|それ/u,
  whatIf: /もし|たら|場合|なら/u,
  notThis: { after: /^(?:じゃ|や|では|で)(?:なく|なしに)|^(?:は|を)?(?:やめて|いらない|要らない)|^の代わり/u },
  // "「図で説明して」って言われた": said by somebody, to the speaker.
  reportedAfter: /^[^。！？!?]{0,4}(?:って|と)(?:言われ|頼まれ|言って|聞かれ|お願いされ|指示され|言う)/u,
  // The generic end of a part's name: "注文" for the "注文サービス".
  genericHead: /(?:サービス|システム|データベース|キュー|ゲートウェイ|モジュール|アプリ)$/u,
  asks: /なぜ|どうして|なんで|どこ|どの|どれ|どう(?:なる|なり|やって|して)|何(?:を|が|の|です|で)/u,
  terms: /キャッシュ|キュー|データベース|ワーカー|db|サービス(?!が(?:悪|良|いい)|料|業)|マイクロサービス|ロードバランサ|レプリカ|リージョン|ノード|ゲートウェイ|認証|kafka|redis|cdn|リトライ|矢印|コンポーネント|レイヤ|サーバ|ストレージ|インデックス|シャード|監視|ボトルネック|単一障害点/u,
  everyday: [
    [/ステップ|段階|工程/u, ['flowchart', 'sequence', 'state', 'gantt', 'timeline', 'decision']],
    [/状態/u, ['state']],
    [/テーブル|エンティティ|カラム|フィールド|リレーション/u, ['er', 'class']],
    [/メッセージ/u, ['sequence']],
    [/ログ(?!イン)|クライアント/u, []],
  ],
  nextSteps: /次のステップ|今後のステップ|次の段階/u,
  laneWord: /レーン/u,
  // (Not the 図 of 地図, 意図, 図書館.)
  aboutKind: /とは|って(?:何|なに|なん)|何のため|なんのため|違い|の意味|読み方|どういう(?:もの|意味)/u,
  looseNouns: [
    [/一覧表|比較表|表(?:で|に|形式)/u, { view: 'matrix' }],
  ],
  visualish: /(?<![地意合指企])図(?![書鑑る])|グラフ|チャート|ダイアグラム|タイムライン|年表|マインドマップ|フロー|描[いかきくけこ]|可視化|見える化|ビジュアル|一覧表|比較表|表(?:で|に|形式)|ぱっと見|ひと目|一目で/u,
  part: /サービス|キュー|データベース|システム|モジュール|コンポーネント|ゲートウェイ|キャッシュ|api|クラスタ|ノード|ストレージ|インデックス|エンジン|サーバ|ワーカー|db|バランサ/u,
  partAfterVerb: false,
  chartTerms: /成長率|成長|解約|初期値|開始値|ヶ月|か月|カ月|四半期|年|期間|予測|軸|棒|線/u,
  elsewhere: /招待|会議|カレンダー|メール|請求書|議事録|スライド|資料|報告書|リスト|アジェンダ|チケット|電話|注文|カート|契約|チャンネル|レストラン|ホテル|お店|店員|銀行|病院|空港/u,
  compoundHead: /^[^。！？!?、,のをにではが]{0,10}?(?:サービス|キュー|データベース|システム|モジュール|コンポーネント|ゲートウェイ|キャッシュ|api|クラスタ|ノード|ストレージ|インデックス|エンジン|サーバ|ワーカー|db)/u,
};

const LANGUAGES = [JA, ZH, RU, ES];

// ── shared machinery ────────────────────────────────────────────────────────

/** NFKC folds full-width punctuation and letters ("ＥＲ図？" → "er図?"). */
function normalise(text) {
  const raw = String(text ?? '');
  const tail = raw.length > MAX_CHARS ? raw.slice(-MAX_CHARS) : raw;
  let out;
  try {
    out = tail.normalize('NFKC');
  } catch {
    out = tail;
  }
  return out
    .toLowerCase()
    .replace(/[“”"«»「」『』¿¡]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Which of the four languages this is said in, or null. Japanese before Chinese: kana decides. */
export function detectRequestLanguage(text) {
  const q = normalise(text);
  if (!q) return null;
  for (const lang of LANGUAGES) {
    if (lang.marks.test(q)) return lang.code;
  }
  return null;
}

function languageOf(q) {
  for (const lang of LANGUAGES) {
    if (lang.marks.test(q)) return lang;
  }
  return null;
}

/** á é í ó ú ü without their marks; ñ kept. Spanish only. */
function foldAccents(text) {
  return text.normalize('NFD').replace(/[\u0301\u0308]/g, '').normalize('NFC');
}

/** The turn's sentences. A question keeps its mark: it is how some questions are told. */
function sentencesOf(q) {
  const all = (q.match(/[^.!?。…\n]+[?]?/gu) || []).map((s) => s.trim()).filter((s) => s && s !== '?');
  return all.length > MAX_SENTENCES ? all.slice(-MAX_SENTENCES) : all;
}

/** The visual a clause names, if any. `view: null` is "a diagram", kind unsaid. */
function visualIn(lang, text, before = '') {
  // "Show THIS CHART as a table": the chart is the one that exists, the table
  // the one asked for. A visual named by pointing at it is passed over when
  // the sentence names another.
  const pointed = lang.thisDesign ? lang.thisDesign.exec(text) : null;
  let passedOver = null;
  /** Is the visual matched by `m` turned down where it stands? */
  const refused = (m) => Boolean(lang.notThis) && ((lang.notThis.after && lang.notThis.after.test(text.slice(m.index + m[0].length))) || (lang.notThis.before && lang.notThis.before.test(text.slice(0, m.index))));
  // (Found before the others are read: the one turned down may be named after
  // the one asked for in the list below — "不要表格，给我画一个流程图".)
  let turnedDown = null;
  if (lang.notThis) {
    for (const [re, visual] of lang.nouns) {
      const m = re.exec(text);
      if (m && refused(m)) { turnedDown = { ...visual, at: m.index, length: m[0].length }; break; }
    }
  }
  for (const [re, visual] of lang.nouns) {
    const m = re.exec(text);
    if (!m) continue;
    // "A summary OF THE diagram": one that exists, not one to draw.
    if (lang.reference && lang.reference.test(`${before}${text.slice(0, m.index)}`.trimEnd())) continue;
    const found = { ...visual, at: m.index, length: m[0].length };
    // "グラフじゃなくて表で", "不要图表，换成表格", "no quiero el gráfico, pásamelo
    // a una tabla": the one turned down is not the one asked for. (With no
    // other named, nothing is asked for: "図じゃなくて言葉で説明して".)
    if (refused(m)) continue;
    if (pointed && m.index < pointed.index + pointed[0].length && m.index + m[0].length > pointed.index) {
      passedOver = passedOver || found;
      continue;
    }
    return turnedDown ? { ...found, insteadOf: turnedDown.view } : found;
  }
  return passedOver && turnedDown ? { ...passedOver, insteadOf: turnedDown.view } : passedOver;
}

// Boxes and arrows: people call any of these by any of these names.
const BOXES = new Set(['architecture', 'flowchart', 'dependency', 'decision', 'responsibility']);

/** Does the sentence name the drawing on the table? */
function namesDrawing(lang, sentence, active) {
  if (lang.artifact.test(sentence)) return true;
  const view = String(active.view || '');
  for (const [re, views] of lang.artifactByView || []) {
    if (views.includes(view) && re.test(sentence)) return true;
  }
  if (lang.nounPlace) {
    const m = lang.nounPlace.exec(sentence);
    const named = m ? visualIn({ ...lang, thisDesign: null, reference: null }, m[0]) : null;
    if (named && (named.view === null || named.view === view || (BOXES.has(named.view) && BOXES.has(view)))) return true;
  }
  return false;
}

/** Is the drawing on the table pointed at — "este diseño", "この図", or "it" while it is in focus? */
function pointsAtDesign(lang, sentence, active) {
  if (lang.thisDesign && lang.thisDesign.test(sentence)) return true;
  return active.foreground !== false && Boolean(lang.itPronoun) && lang.itPronoun.test(sentence);
}

/** An everyday word that is evidence here: the drawing is of the kind that has such things, or has the word in it. */
function everydayEvidence(lang, sentence, active, labels) {
  if (!lang.everyday) return false;
  if (lang.nextSteps && lang.nextSteps.test(sentence)) return false;
  const view = String(active.view || '');
  for (const [re, views] of lang.everyday) {
    const m = re.exec(sentence);
    if (!m) continue;
    if (views.includes(view)) return true;
    const said = m[0];
    const stem = lang.spaced ? said.slice(0, Math.max(4, said.length - 2)) : said;
    // (Its own label, not one word of a longer one: "clientes" is not the
    // "Portal de clientes".)
    if (labels.some((label) => {
      if (!lang.spaced) return label === stem;
      const parts = label.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length >= 4);
      return parts.length === 1 && parts[0].startsWith(stem);
    })) return true;
  }
  return false;
}

function hintedView(lang, text) {
  for (const [re, view] of lang.hints) {
    if (re.test(text)) return view;
  }
  return 'flowchart';
}

/** Strip lead-ins ("vale, entonces …", "ну ладно, …") from a spaced language. A bounded loop. */
function stripLead(lang, text) {
  let rest = text;
  for (let i = 0; i < 6; i += 1) {
    const m = lang.lead.exec(rest);
    if (!m) break;
    const next = rest.slice(m[0].length).replace(/^[\s,;:]+/u, '');
    if (next === rest || !next) break;
    rest = next;
  }
  return rest;
}

/**
 * How a clause of a spaced language (Spanish, Russian) asks for a visual.
 * Mood is read at the START of the clause: an instruction, a request frame
 * followed by its verb, or a wish for a named visual.
 * @returns {{ kind: 'draw' | 'show' | 'want' | 'fragment', rest: string, before: string } | null}
 */
function spacedRequest(lang, clause) {
  let rest = stripLead(lang, clause);
  const asked = lang.ask.exec(rest);
  if (asked) rest = stripLead(lang, rest.slice(asked[0].length).trim());
  const take = (re) => {
    const m = re.exec(rest);
    return m ? { verb: m[0], rest: rest.slice(m[0].length).trim() } : null;
  };
  const draw = take(lang.draw);
  if (draw) return lang.figurative.test(draw.rest) ? null : { kind: 'draw', rest: draw.rest, before: draw.verb };
  const show = take(lang.show);
  if (show) return { kind: 'show', rest: show.rest, before: show.verb };
  // A wish for the thing itself — read from before the request frame, which
  // may be the same word: "давай схему" (a wish) / "давай нарисуем" (a request).
  const unframed = stripLead(lang, clause);
  const wish = lang.want.exec(unframed);
  if (wish) return { kind: 'want', rest: unframed.slice(wish[0].length).trim(), before: wish[0] };
  // A fragment: "un diagrama de secuencia del login", "блок-схему процесса, пожалуйста".
  if (!asked) {
    const visual = visualIn(lang, rest);
    const politely = lang.polite.test(rest);
    const indefinite = lang.indefinite ? lang.indefinite.test(rest) : false;
    if (visual && visual.at <= (indefinite ? 6 : 0) + 2 && (politely || indefinite) && !lang.finite.test(rest)) {
      return { kind: 'fragment', rest, before: '' };
    }
  }
  return null;
}

/** Split on the marks that separate clauses; each is read as the start of a sentence. */
function clausesOf(sentence) {
  return sentence.split(/\s*[,;:]\s+|\s+[—–-]\s+/u).map((c) => c.trim()).filter(Boolean);
}

/** "No chart — make it a table": one visual turned down, another named. */
function asksForAnotherInstead(lang, sentence) {
  const visual = visualIn(lang, sentence);
  return Boolean(visual) && visual.insteadOf !== undefined;
}

/**
 * A fresh request for a drawing in this sentence, or null.
 * @returns {{ view: string, chartIntent?: string, layout?: string, reason: string, designAsk?: boolean, kind: string } | null}
 */
function freshRequest(lang, sentence, { coding }) {
  if (lang.negation.test(sentence) && !asksForAnotherInstead(lang, sentence)) return null;
  if (lang.spaced) {
    // A design ask: "diseña un acortador de URLs", "спроектируй сервис …".
    const led = stripLead(lang, sentence);
    const afterAsk = (() => {
      const asked = lang.ask.exec(led);
      return asked ? stripLead(lang, led.slice(asked[0].length).replace(/^[\s,;:]+/u, '')) : led;
    })();
    const design = lang.design.exec(afterAsk);
    if (design && !coding) {
      const object = afterAsk.slice(design[0].length).trim();
      const visual = visualIn(lang, object);
      // "Diseña un diagrama de flujo para …" asks for that drawing.
      if (visual && visual.view) return { view: visual.view, chartIntent: visual.chartIntent, layout: visual.layout, reason: 'explicit_request', kind: 'show' };
      // What is designed is the HEAD of the object, which these languages put
      // first: "систему умного дома" is a system, "дом" is a house.
      const head = object.replace(/^(?:(?:un|una|el|la|los|las|nuestro|nuestra|mi|tu|su|nuestr\p{L}+|мо\p{L}{1,2}|наш\p{L}{1,3}|нов\p{L}{2,3}|nuev[oa]) )+/u, '').split(/\s+/u).slice(0, 2).join(' ');
      if (object && !lang.designNot.test(head)) return { view: 'architecture', reason: 'design_ask', designAsk: true, kind: 'design' };
    }
    const about = lang.about.test(sentence);
    const clauses = clausesOf(sentence);
    for (let i = 0; i < clauses.length; i += 1) {
      const request = spacedRequest(lang, clauses[i]);
      if (!request) continue;
      // The rest of the sentence belongs to the request ("…, con reintentos").
      const object = [request.rest, ...clauses.slice(i + 1)].join(', ');
      const visual = visualIn(lang, object, `${request.before} `);
      if (request.kind === 'draw') {
        if (visual && visual.view) return { view: visual.view, chartIntent: visual.chartIntent, layout: visual.layout, reason: 'explicit_request', kind: 'draw' };
        if (!object) continue;
        // "Grafica la evolución de los ingresos": the verb itself names a chart.
        if (lang.chartVerb && lang.chartVerb.test(request.before)) return { view: 'chart', chartIntent: 'generic', reason: 'explicit_visual', kind: 'draw' };
        return { view: hintedView(lang, object), reason: 'explicit_request', kind: 'draw' };
      }
      // A verb that shows or makes, a wish, a fragment: only with a visual named.
      if (!visual || coding) continue;
      // "¿Me puedes explicar qué es un diagrama de secuencia?" asks what one is.
      if (about && request.kind !== 'fragment') continue;
      return { view: visual.view || hintedView(lang, object), chartIntent: visual.chartIntent, layout: visual.layout, reason: visual.view ? 'explicit_visual' : 'explicit_request', kind: request.kind };
    }
    // Said aloud, a sentence has no commas and gets to its request late: "…y
    // después de todo lo que hablamos estaría bueno que me muestres en un
    // gráfico de barras…", "…так что давай диаграмму последовательности…".
    // Mood is still read at a start — the start of the request, found by a
    // form that is addressed to the listener and to nobody else — and a late
    // request counts only with its visual named.
    if (lang.late && !coding && !about) {
      const words = sentence.split(/\s+/u);
      for (let i = 1; i < words.length - 1; i += 1) {
        const tail = words.slice(i).join(' ');
        if (!lang.late.test(tail)) continue;
        // ("Le pedí a Juan que me arme un diagrama": told, not asked.)
        if (lang.reported && lang.reported.test(words.slice(0, i).join(' '))) break;
        const request = spacedRequest(lang, tail);
        if (!request || request.kind === 'fragment') continue;
        const visual = visualIn(lang, request.rest, `${request.before} `);
        if (!visual) continue;
        return { view: visual.view || hintedView(lang, request.rest), chartIntent: visual.chartIntent, layout: visual.layout, reason: visual.view ? 'explicit_visual' : 'explicit_request', kind: request.kind };
      }
    }
    return null;
  }
  // Chinese, Japanese: no spaces, so the forms are matched where they stand.
  if (lang.statement && lang.statement.test(sentence)) return null;
  if (lang.figurative && lang.figurative.test(sentence)) return null;
  const about = lang.about.test(sentence);
  const design = lang.design.exec(sentence);
  /** A request form that is told, not made: quoted as said, asked of the speaker, or the speaker's own plan. */
  const told = (m) => Boolean(m) && ((lang.reportedAfter && lang.reportedAfter.test(sentence.slice(m.index + m[0].length))) || (lang.reportedBefore && lang.reportedBefore.test(sentence.slice(0, m.index))));
  /** The first match of `re` that is asked, not told ("図で説明してと言われたので、…図にしてください" asks with its second). */
  const asked = (re) => {
    const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of sentence.matchAll(all)) if (!told(m)) return m;
    return null;
  };
  const draws = asked(lang.draw);
  const visual = visualIn(lang, sentence);
  // ("画个图解释一下什么是三次握手" asks for the drawing.)
  if (draws) {
    if (visual && visual.view) return { view: visual.view, chartIntent: visual.chartIntent, layout: visual.layout, reason: 'explicit_request', kind: 'draw' };
    return { view: hintedView(lang, sentence), reason: 'explicit_request', kind: 'draw' };
  }
  if (design && !coding && !about && !lang.designNot.test(sentence)) {
    if (visual && visual.view) return { view: visual.view, chartIntent: visual.chartIntent, layout: visual.layout, reason: 'explicit_request', kind: 'show' };
    return { view: 'architecture', reason: 'design_ask', designAsk: true, kind: 'design' };
  }
  if (!coding && !about && visual && asked(lang.show)) {
    return { view: visual.view || hintedView(lang, sentence), chartIntent: visual.chartIntent, layout: visual.layout, reason: visual.view ? 'explicit_visual' : 'explicit_request', kind: 'show' };
  }
  return null;
}

const NOT_A_NAME = new Set(['subgraph', 'direction', 'participant', 'flowchart', 'graph', 'state', 'class', 'note', 'actor', 'title', 'section', 'style', 'classdef', 'click', 'linkstyle']);

/** What a chart shows by name: its title, axis labels, categories and series. Not the keys of its JSON. */
function chartLabels(source) {
  try {
    const spec = JSON.parse(String(source ?? ''));
    const out = [];
    const add = (value) => {
      const text = typeof value === 'string' ? value.normalize('NFKC').toLowerCase().trim() : '';
      if ((text.length >= 2 || /^[\u3040-\u30ff\u4e00-\u9fff]$/u.test(text)) && out.length < 80) out.push(text);
    };
    add(spec.title);
    for (const axis of [spec.x, spec.y]) {
      if (!axis || typeof axis !== 'object') continue;
      add(axis.label);
      if (Array.isArray(axis.values)) axis.values.forEach(add);
    }
    if (Array.isArray(spec.series)) spec.series.forEach((one) => add(one && one.name));
    return out;
  } catch {
    return [];
  }
}

/** The titles of a diagram's groups or lanes (`subgraph Title`, `subgraph id [Title]`), lower-cased. */
function groupTitles(source) {
  const out = [];
  for (const m of String(source ?? '').slice(0, 12000).matchAll(/(?:^|\n)[ \t]*subgraph[ \t]+(?:[^\s\["\n]+[ \t]*\[[ \t]*"?([^"\]\n]{2,60})"?[ \t]*\]|"([^"\n]{2,60})"|([^\["\n]{2,60}))[ \t]*(?=\n|$)/gu)) {
    const title = (m[1] || m[2] || m[3] || '').normalize('NFKC').toLowerCase().trim();
    if (title && !out.includes(title)) out.push(title);
  }
  return out;
}

/**
 * Is a lane of the drawing named as one — "el carril de Finanzas", "в дорожке
 * поддержки", "财务泳道", "経理のレーン"? The lane's name and the word for a
 * lane, in the same sentence.
 */
function namesALane(lang, sentence, active) {
  if (!lang.laneWord || !lang.laneWord.test(sentence)) return false;
  const titles = groupTitles(active.source);
  if (titles.length < 2) return false;
  return titles.some((title) => (lang.spaced ? usesLabel(lang, sentence, [title]) || saysWord(sentence, title) : sentence.includes(title.replace(/\s+/g, ''))));
}

/** A short one-word name said as written or inflected ("ventas", "продаж"). */
function saysWord(sentence, name) {
  if (/[^\p{L}\p{N}]/u.test(name) || name.length < 3) return false;
  const stem = name.length <= 4 ? name : name.slice(0, Math.max(4, name.length - 2));
  return sentence.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(stem) && w.length <= name.length + 3);
}

/** The labels of the drawing on the table, as written (any script), lower-cased. */
function labelsOf(source, family = 'mermaid') {
  if (family === 'chart') return chartLabels(source);
  const out = [];
  const text = String(source ?? '').slice(0, 12000);
  // Quoted (api["API Gateway"]) or not (api[API Gateway], db[(Orders DB)],
  // check{Paid?}), and a sequence diagram's "participant A as Name". The
  // contract asks for quotes; nothing makes a model use them.
  const re = /"((?:[^"\\\n]|\\.){2,80})"|[\[({]{1,2}([^\]\[(){}"|\n]{2,60})[\])}]{1,2}|(?:participant|actor)\s+\S+\s+as\s+([^\n]{2,60})/gu;
  const seen = new Set();
  for (const m of text.matchAll(re)) {
    const label = (m[1] || m[2] || m[3] || '').normalize('NFKC').toLowerCase().trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= 80) break;
  }
  // A group or a lane named by more than one word ("subgraph Atención al
  // cliente") is a part like any other. A one-word lane is a department or a
  // role — an everyday word — and counts only when it is called a lane (see
  // namesALane).
  for (const title of groupTitles(text)) {
    if (!/[\s\u3000]/u.test(title) || seen.has(title)) continue;
    seen.add(title);
    out.push(title);
  }
  // A name written with no box of its own — a state ("Pendiente --> Pagado"),
  // a bare node — is what the drawing shows for it.
  const bare = /(?:^|\n)[ \t]*([\p{L}][\p{L}\p{N}_]{3,40})[ \t]*(?:-->|---|-\.->|==>)|(?:-->|---|-\.->|==>)[ \t]*(?:\|[^|\n]*\|[ \t]*)?([\p{L}][\p{L}\p{N}_]{3,40})[ \t]*(?=\n|$|:)/gu;
  for (const m of text.matchAll(bare)) {
    const id = m[1] || m[2] || '';
    const label = id.normalize('NFKC').toLowerCase();
    if (!label || seen.has(label) || NOT_A_NAME.has(label)) continue;
    // (An id that is given a label somewhere — pedidos[[Cola de pedidos]] — is
    // shown as that label, not as itself.)
    if (text.includes(`${id}[`) || text.includes(`${id}(`) || text.includes(`${id}{`) || text.includes(`${id}>`)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= 120) break;
  }
  return out;
}

/**
 * Does the sentence use one of the drawing's own labels?
 *
 * Written as said, a label is rarely repeated letter for letter: Russian
 * inflects it ("считыватель" → "со считывателем"), and Chinese and Japanese
 * shorten it ("车牌识别器" → "识别器"). So a spaced-language word matches on its
 * stem, and a CJK label matches on its parts (see below).
 */
function usesLabel(lang, sentence, labels) {
  if (lang.spaced) {
    const said = sentence.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
    for (const label of labels) {
      // One word shared with a longer label is not enough: "la FACTURA del
      // proveedor" is not the "Servicio de Facturas", and last night's
      // "partido" is not "Partidos y Resultados". The label's only word, or
      // two of its words, is.
      const parts = label.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length >= 4);
      let hits = 0;
      for (const part of parts) {
        // ("база" → "базе": a four-letter word inflects too, and matches a
        // word of about its own length on its first three letters.)
        const stem = part.length < 5 ? part.slice(0, 3) : part.slice(0, Math.max(4, part.length - 2));
        if (said.some((w) => (part.length < 5 ? w === part || (w.startsWith(stem) && w.length <= part.length + 1) : w.startsWith(stem)))) hits += 1;
      }
      if (hits >= 2 || (hits === 1 && parts.length === 1)) return true;
      // Two neighbouring words of the label run into one, the first cut to its
      // opening letters: "медкарт" for "медицинских карт", "техподдержка" for
      // "техническая поддержка". That one word names two of the label's.
      if (lang.compounds && saysCompound(said, label)) return true;
    }
    return false;
  }
  // Chinese and Japanese: the same rule over the label's parts, which are told
  // apart by the particles between them and by a change of script
  // ("カレンダー" + "データベース", "请求" …). One part of a longer label is not
  // enough — "来週のカレンダー" is not the "カレンダーのデータベース".
  for (const label of labels) {
    const parts = cjkParts(label);
    // A one- or two-character name with no parts to tell apart — a chart's
    // "昼", "夜" — is said as it is written.
    if (parts.length === 0) {
      if (label.length <= 2 && /^[\u3040-\u30ff\u4e00-\u9fff]+$/u.test(label) && sentence.includes(label)) return true;
      continue;
    }
    // A step of a process is written as a sentence ("顾客接受替代品吗"): a
    // "what if" about it shares its words, not the whole of it. Two of them,
    // apart — and only in a what-if: "顾客今天接受采访了吗" shares the same two.
    if (parts.length === 1 && parts[0].length >= 6 && lang.whatIf && lang.whatIf.test(sentence) && sharedPairs(sentence, parts[0]) >= 2) return true;
    let hits = 0;
    for (const part of parts) if (sentence.includes(part)) hits += 1;
    if (hits >= 2 || (hits === 1 && parts.length === 1)) return true;
    // A one-word label said by its head, which these languages put last:
    // "识别器" for the "车牌识别器". Three characters of kanji at the end of it,
    // and more than half of it — not any three in a row.
    if (parts.length === 1 && parts[0].length >= 4 && /^[一-鿿]+$/u.test(parts[0])) {
      const tail = parts[0].slice(-Math.max(3, Math.ceil(parts[0].length / 2)));
      if (sentence.includes(tail)) return true;
    }
  }
  // Two parts named by what is distinctive in each, the generic end dropped as
  // in speech: "为什么预约和药房共用一个病历库" over a 预约服务 and a 药房服务. One
  // alone is an everyday word.
  if (lang.genericHead) {
    // (Two DIFFERENT words: "订单" names the "订单服务" and the "订单队列" at
    // once, and is still one everyday word.)
    // Half of a stem ("拣货" of the "仓库拣货服务") is weaker evidence, and
    // counts only in a question that asks how or why: "订单的消息你看到了吗"
    // holds two such halves and asks about a message.
    const halves = Boolean(lang.asksHow) && lang.asksHow.test(sentence);
    const said = new Set();
    for (const label of labels) {
      for (const stem of distinctiveStems(lang, label, halves)) {
        if (sentence.includes(stem)) { said.add(stem); break; }
      }
      if (said.size >= 2) return true;
    }
  }
  return false;
}

/**
 * What is distinctive in a part's name, with the generic end dropped: "预约"
 * of the "预约服务", "倉庫" and "ピッキング" of the "倉庫ピッキングサービス", and —
 * a four-character Chinese stem being two words — "仓库" and "拣货" of the
 * "仓库拣货服务".
 */
function distinctiveStems(lang, label, halves = false) {
  const parts = cjkParts(label);
  if (parts.length === 0) return [];
  const last = parts[parts.length - 1];
  const trimmed = last.replace(lang.genericHead, '');
  // Only a name that HAS a generic end: a bare "订单" is the everyday word.
  if (trimmed === last) return [];
  const out = parts.slice(0, -1).filter((part) => part.length >= 2);
  if (trimmed.length >= 2) {
    out.push(trimmed);
    if (halves && parts.length === 1 && /^[\u4e00-\u9fff]{4}$/u.test(trimmed)) out.push(trimmed.slice(0, 2), trimmed.slice(2));
  }
  return out;
}

/** How many two-character pieces of `label`, not overlapping, the sentence also holds. */
function sharedPairs(sentence, label) {
  let pairs = 0;
  for (let i = 0; i + 1 < label.length; i += 1) {
    if (sentence.includes(label.slice(i, i + 2))) { pairs += 1; i += 1; }
  }
  return pairs;
}

/**
 * Does a said word abbreviate two neighbouring words of `label` — the opening
 * two to four letters of the first, then the second (inflected as it likes)?
 */
function saysCompound(said, label) {
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (let i = 0; i + 1 < words.length; i += 1) {
    const first = words[i];
    const second = words[i + 1];
    if (first.length < 5 || second.length < 4) continue;
    const stem = second.slice(0, Math.max(3, second.length - 2));
    for (const w of said) {
      if (w.length < 6) continue;
      for (let k = 2; k <= 4; k += 1) {
        const rest = w.slice(k);
        // (Not the first word itself said whole: "медицинских" is not "мед" + …)
        if (w.startsWith(first.slice(0, k)) && rest.startsWith(stem) && rest.length <= second.length + 3 && !w.startsWith(first.slice(0, k + 1))) return true;
      }
    }
  }
  return false;
}

/**
 * Is a part of the drawing NAMED in this clause of a spaced language — its
 * whole label said, or a one-word label by its word? Stronger than
 * `usesLabel`, which two words of a longer label satisfy ("reservé una pista"
 * over a "Servicio de reservas de pistas").
 */
function namesAPart(lang, clause, labels) {
  if (saysWholeLabel(lang, clause, labels)) return true;
  // ("медкарты": one word that is two of the label's.)
  if (lang.compounds) {
    const said = clause.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4);
    if (labels.some((label) => saysCompound(said, label))) return true;
  }
  return labels.some((label) => label.split(/[^\p{L}\p{N}]+/u).filter((part) => part.length >= 4).length === 1 && usesLabel(lang, clause, [label]));
}

/** The parts of a Chinese or Japanese label: split at particles and where the script changes. */
function cjkParts(label) {
  const out = [];
  for (const chunk of label.split(/[\sの・／\/、,と与和及的&+-]+/u)) {
    for (const run of chunk.match(/[\u30a0-\u30ffー]+|[\u4e00-\u9fff]+|[\u3040-\u309f]+|[a-z0-9]+/gu) || []) {
      if (run.length >= 2 && /[\u3040-\u30ff\u4e00-\u9fff]/u.test(run)) out.push(run);
    }
  }
  return out;
}

/**
 * "Calendar", "invoice", "order" send an edit somewhere else — unless the
 * drawing itself has a part of that name: with a "calendar database" on the
 * diagram, "add a read replica to the calendar database" stays on it.
 */
function elsewhereIsALabel(lang, m, labels) {
  if (!lang.spaced) return labels.some((label) => label.replace(/\s+/g, '').includes(m[0]));
  const noun = m[0].split(/[^\p{L}\p{N}]+/u).filter(Boolean).pop() || '';
  if (noun.length < 4) return false;
  const stem = noun.slice(0, Math.max(4, noun.length - 2));
  return labels.some((label) => label.split(/[^\p{L}\p{N}]+/u).some((part) => part.startsWith(stem)));
}

/**
 * Does the sentence send its change somewhere other than the drawing?
 *
 * Every "elsewhere" word in it is looked at. One does not count when it is a
 * label of the drawing, when it only names a part of a system ("邮件服务",
 * "メール通知サービス": a mail SERVICE), or — in a spaced language — when what is
 * being changed is itself a part of a system ("añade una COLA para el
 * correo", "добавь СЕРВИС для заказов").
 */
function goesElsewhere(lang, sentence, labels) {
  const re = new RegExp(lang.elsewhere.source, lang.elsewhere.flags.includes('g') ? lang.elsewhere.flags : `${lang.elsewhere.flags}g`);
  for (const m of sentence.matchAll(re)) {
    if (elsewhereIsALabel(lang, m, labels)) continue;
    if (lang.spaced) {
      // ("Agrega este servicio A la factura" still goes to the invoice.)
      if (lang.purpose && lang.purpose.test(m[0]) && lang.terms.test(sentence.slice(0, m.index))) continue;
    } else if (lang.compoundHead && lang.compoundHead.test(sentence.slice(m.index + m[0].length))) {
      continue;
    } else if (lang.part) {
      // "再加个日历同步的 worker", "…カレンダーと同期するワーカーを入れて": what
      // the edit adds is a part of a system, described with an everyday word.
      const verb = lang.edit.exec(sentence);
      const near = verb ? (lang.partAfterVerb ? sentence.slice(verb.index + verb[0].length, verb.index + verb[0].length + 16) : sentence.slice(Math.max(0, verb.index - 16), verb.index)) : '';
      if (near && lang.part.test(near)) continue;
    }
    return true;
  }
  return false;
}

/** Is one of the drawing's labels said in full? */
function saysWholeLabel(lang, sentence, labels) {
  const flat = lang.spaced ? ` ${sentence.replace(/[^\p{L}\p{N}]+/gu, ' ')} ` : sentence.replace(/\s+/g, '');
  for (const label of labels) {
    const text = lang.spaced ? ` ${label.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} ` : label.replace(/\s+/g, '');
    if (text.trim().length >= (lang.spaced ? 6 : 3) && (lang.spaced ? text.trim().includes(' ') : true) && flat.includes(lang.spaced ? text : text)) return true;
  }
  return false;
}

/** How many names these are, a label that holds another ("日均骑行次数", "骑行次数") counting once. */
function distinctNames(labels) {
  return labels.filter((label, i) => !labels.some((other, j) => j !== i && other.includes(label) && (other !== label || j < i))).length;
}

/**
 * A follow-up on the drawing on the table, or null.
 * @returns {{ operation: 'update' | 'explain', followUp: 'strong' | 'weak' } | null}
 */
function followUp(lang, sentence, active, labels) {
  if (lang.negation.test(sentence)) return null;
  const family = active.view === 'chart' || active.artifact === 'chart' ? 'chart' : 'mermaid';
  const named = namesDrawing(lang, sentence, active);
  const inFocus = active.foreground !== false;
  // (A chart's categories are everyday words — "体检", "Revisiones" — so one of
  // them alone is not the chart: two are, or one beside a word of charts.)
  const ownLabel = family === 'chart'
    ? distinctNames(labels.filter((label) => usesLabel(lang, sentence, [label]))) >= (lang.chartTerms.test(sentence) ? 1 : 2)
    : usesLabel(lang, sentence, labels);
  const lane = family !== 'chart' && namesALane(lang, sentence, active);
  // "¿Y esto aguanta el Black Friday?", "а оно вообще выдержит?": whether it
  // holds up, asked of "this" while the design is what is being looked at.
  const holds = inFocus && family !== 'chart' && Boolean(lang.holdsUp) && lang.holdsUp.test(sentence);
  const evidence = (family === 'chart' ? lang.chartTerms.test(sentence) : lang.terms.test(sentence) || everydayEvidence(lang, sentence, active, labels)) || ownLabel || lane
    || (holds && Boolean(lang.barePronoun) && lang.barePronoun.test(sentence));
  /** A verb of change leading `rest` — and not the same verb stating what something does. */
  const isEdit = (rest) => lang.edit.test(rest) && !(lang.verbFirstStatement && lang.verbFirstStatement.test(rest));
  if (!named && !(inFocus && evidence)) return null;
  // "¿Qué dijo Pedro sobre los pedidos?": what was SAID is in the meeting's
  // record, whatever part of the drawing it mentions.
  // (A QUESTION: "añade la caché que mencionó Ana" is an edit that cites it.)
  const editLeads = lang.spaced
    ? clausesOf(sentence).some((clause) => {
        let rest = stripLead(lang, clause);
        const asked = lang.ask.exec(rest);
        if (asked) rest = stripLead(lang, rest.slice(asked[0].length).trim());
        return isEdit(rest);
      })
    : lang.edit.test(sentence) && !lang.asks.test(sentence);
  if (!named && !editLeads && lang.recall && lang.recall.test(sentence)) return null;
  // "Añade a María a la invitación", "добавь это событие в календарь": goes
  // somewhere else — even when a word of it is also a word of the drawing (an
  // "event bus" on the diagram does not make a calendar event part of it).
  // Unless one of the drawing's labels is said WHOLE: the "订单数据库" on the
  // diagram is not somebody's order.
  if (!named && !saysWholeLabel(lang, sentence, labels) && goesElsewhere(lang, sentence, labels)) return null;
  const strength = named ? 'strong' : 'weak';
  if (lang.spaced) {
    for (const clause of clausesOf(sentence)) {
      let rest = stripLead(lang, clause);
      const asked = lang.ask.exec(rest);
      if (asked) rest = stripLead(lang, rest.slice(asked[0].length).trim());
      // What a part SHOULD do is a change — read before the asking words,
      // since "que" and "что" are also how these begin.
      if (lang.jussive && lang.jussive.test(rest) && !asked) return { operation: 'update', followUp: strength };
      if (lang.question.test(rest) && !asked) return { operation: 'explain', followUp: strength };
      if (isEdit(rest)) return { operation: 'update', followUp: strength };
      if (lang.question.test(rest)) return { operation: 'explain', followUp: strength };
    }
    // A verb of change after where it goes: "después del reembolso agregá un
    // paso…", "после возврата денег добавь шаг…".
    // (After: a verb that LEADS a clause was read above, with what it may not be.)
    if (lang.editAnywhere && !(lang.asksAnywhere && lang.asksAnywhere.test(sentence))) {
      const late = lang.editAnywhere.exec(sentence);
      if (late && late.index > 0 && !clausesOf(sentence).some((clause) => stripLead(lang, clause).startsWith(late[0]))) return { operation: 'update', followUp: strength };
    }
    // A question whose asking word is not first — "кэш как часто
    // сбрасывается?", "y si la cola se llena qué pasa con los mensajes" — is
    // still a question, when no verb of change leads a clause.
    if (lang.asksAnywhere && lang.asksAnywhere.test(sentence)) return { operation: 'explain', followUp: strength };
    // A question about a part the sentence NAMES — by its label — asked with
    // its mark, or with its asking word wherever it stands, or its doubt:
    // "las notificaciones por correo las dispara solo el servicio de citas o
    // también el de recetas", "а шлюз тут не станет единой точкой отказа".
    // (In the clause that names it: "reservé una pista para el sábado, ¿te
    // apuntas?" asks about Saturday.)
    for (const clause of clausesOf(sentence)) {
      if (!(named ? lang.artifact.test(clause) || clause === sentence : namesAPart(lang, clause, labels) || namesALane(lang, clause, active))) continue;
      if (/\?\s*$/u.test(clause) || (lang.interrogative && lang.interrogative.test(clause))) return { operation: 'explain', followUp: strength };
    }
    if (holds) return { operation: 'explain', followUp: strength };
    // Named, the sentence may get to the point later: "en el diagrama falta el
    // servicio de pagos, agrégalo", "а на той диаграмме где была очередь?".
    if (named) {
      const words = sentence.split(/\s+/u);
      for (let i = 1; i < words.length; i += 1) {
        const rest = words.slice(i).join(' ');
        if (isEdit(rest)) return { operation: 'update', followUp: strength };
        if (lang.question.test(rest)) return { operation: 'explain', followUp: strength };
      }
    }
    return null;
  }
  // "为什么…要放一个队列？", "キューはどこに置いてありますか": an asking word
  // makes it a question, whatever verb of change it holds. A polite ending
  // alone does not: "キューを追加してもらえますか" asks for the change.
  if (lang.asks.test(sentence)) return { operation: 'explain', followUp: strength };
  if (lang.edit.test(sentence)) return { operation: 'update', followUp: strength };
  if (lang.jussive && lang.jussive.test(sentence)) return { operation: 'update', followUp: strength };
  if (lang.question.test(sentence)) return { operation: 'explain', followUp: strength };
  if (holds) return { operation: 'explain', followUp: strength };
  return null;
}

/**
 * Decide a turn said in Spanish, Russian, Chinese or Japanese.
 *
 * @param {{
 *   question?: string | null,
 *   activeDesign?: { artifactId?: string, artifact?: string, view?: string, source?: string, foreground?: boolean } | null,
 *   answerType?: string | null,
 *   questionTypes?: readonly string[] | null,
 * }} input
 * @returns {object | null} a request in the shape `resolveDiagramRequest` returns, or null
 */
export function resolveOtherLanguageRequest(input = {}) {
  const raw = normalise(input.question);
  if (!raw) return null;
  const lang = languageOf(raw);
  if (!lang) return null;
  const q = lang.code === 'es' ? foldAccents(raw) : lang.code === 'ru' ? raw.replace(/(\p{L})-ка(?![\p{L}])/gu, '$1') : raw;
  const types = Array.isArray(input.questionTypes) ? input.questionTypes : [];
  const coding = input.answerType === 'coding_question_answer' || input.answerType === 'dsa_question_answer' || types.includes('CODING_TASK');
  const active = input.activeDesign && input.activeDesign.source ? input.activeDesign : null;
  const sentences = sentencesOf(q);
  // "No diagram" said anywhere in the turn holds for all of it.
  if (sentences.some((s) => lang.negation.test(s) && !asksForAnotherInstead(lang, s))) return null;

  // 1. A fresh request, in any of the turn's sentences.
  for (const sentence of sentences) {
    const fresh = freshRequest(lang, sentence, { coding });
    if (!fresh) continue;
    // Asked of the drawing on the table ("muestra ESTE diseño como diagrama de
    // secuencia", "これをシーケンス図にして"): a new view of it, handed the old one
    // to work from. Pointed at, not merely a drawing named with "the": "hazme
    // EL diagrama de flujo del proceso de contratación" is about hiring.
    const family = active && (active.view === 'chart' || active.artifact === 'chart') ? 'chart' : active && active.view === 'matrix' ? 'table' : 'mermaid';
    // "Not a chart — a table", said with the chart in focus: the chart turned
    // down is the one on the table, and the table is of what it holds.
    const swapped = active && active.foreground !== false ? visualIn(lang, sentence) : null;
    const swapsActive = Boolean(swapped) && swapped.insteadOf !== undefined
      && (family === 'chart' ? swapped.insteadOf === 'chart' : family === 'mermaid' && swapped.insteadOf !== 'chart' && swapped.insteadOf !== 'matrix');
    const ofActive = Boolean(active) && !fresh.designAsk && (pointsAtDesign(lang, sentence, active) || swapsActive);
    // Another form of the same chart ("este gráfico, pero de barras") keeps
    // what it holds: an edit of it, as in English.
    const reshapes = ofActive && family === 'chart' && fresh.view === 'chart';
    // Where the drawing comes from, and what kind of numbers a chart holds.
    const basis = fresh.designAsk ? 'proposed-design'
      : lang.meeting && lang.meeting.test(q) ? 'meeting-reconstruction'
      : lang.source && lang.source.test(q) ? 'source-reconstruction'
      : lang.hypothetical && lang.hypothetical.test(q) ? 'illustrative'
      : 'proposed-design';
    let chartIntent = fresh.chartIntent;
    if (fresh.view === 'chart' && !reshapes && (!chartIntent || chartIntent === 'generic' || chartIntent === 'trend')) {
      if (lang.fn && lang.fn.test(q)) chartIntent = 'function';
      else if (lang.forecast && lang.forecast.test(q) && (q.match(/\d+(?:[.,]\d+)?/g) || []).length >= 2) chartIntent = 'forecast';
    }
    return {
      enabled: true,
      view: fresh.view,
      operation: reshapes ? 'update' : 'create',
      output: 'text-and-diagram',
      basis,
      ...(ofActive ? { parentArtifactId: active.artifactId, followUp: 'strong', parentFamily: family } : {}),
      withCode: false,
      explicit: !fresh.designAsk,
      attachActiveDesign: ofActive,
      reason: reshapes ? 'update_design' : ofActive ? 'explicit_view_of_design' : fresh.reason,
      language: lang.code,
      ...(chartIntent ? { chartIntent } : {}),
      ...(fresh.layout ? { layout: fresh.layout } : {}),
    };
  }

  // 2. A follow-up on the drawing on the table.
  if (!active || coding) return null;
  const labels = labelsOf(active.source, active.view === 'chart' || active.artifact === 'chart' ? 'chart' : 'mermaid');
  for (const sentence of sentences) {
    const follow = followUp(lang, sentence, active, labels);
    if (!follow) continue;
    const explain = follow.operation === 'explain';
    return {
      enabled: true,
      view: active.view || 'architecture',
      operation: follow.operation,
      output: explain ? 'text-only' : 'text-and-diagram',
      basis: 'proposed-design',
      parentArtifactId: active.artifactId,
      withCode: false,
      explicit: false,
      attachActiveDesign: true,
      followUp: follow.followUp,
      reason: explain ? 'explain_design' : 'update_design',
      language: lang.code,
    };
  }
  return null;
}

// ── an answer about the drawing ─────────────────────────────────────────────

/**
 * Does a prose answer written in one of the four languages talk about this
 * drawing — two of its own parts, by their labels? (`answerIsAbout` in
 * activeDesign.mjs reads ASCII words only: for a drawing labelled "Сервис
 * поездок" or "決済サービス" it could never say yes, so the drawing left focus
 * after every answer that did not redraw it.) As demanding as the English
 * test: one label, or a word two labels share, is not enough.
 */
export function answerNamesParts(answer, source) {
  const raw = normalise(String(answer ?? '').replace(/```[\s\S]*?```/g, ' ').slice(0, 6000));
  if (!raw) return false;
  const lang = languageOf(raw);
  if (!lang) return false;
  const text = prepared(lang, raw);
  const chart = /^\s*\{/.test(String(source ?? ''));
  const labels = labelsOf(source, chart ? 'chart' : 'mermaid').filter((label) => /[^\x00-\x7f]/.test(label));
  if (labels.length < 2) return false;
  const used = labels.filter((label) => (lang.spaced ? usesLabel(lang, text, [label]) : text.includes(label.replace(/\s+/g, ''))));
  return distinctNames(used) >= 2;
}

// ── a turn the rules cannot place ───────────────────────────────────────────

/** The text as the rules of `lang` read it. */
function prepared(lang, raw) {
  return lang.code === 'es' ? foldAccents(raw) : lang.code === 'ru' ? raw.replace(/(\p{L})-ка(?![\p{L}])/gu, '$1') : raw;
}

/** Does the turn say anything to decide on? "Vale.", "ага", "はい" do not. */
function saysSomething(lang, q) {
  if (!lang.spaced) return q.replace(/[^\p{L}\p{N}]+/gu, '').length >= 4;
  const rest = stripLead(lang, q.replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim());
  return rest.split(/\s+/u).filter(Boolean).length >= 2;
}

/** "No diagrams", said in any of the four languages (a standing instruction is one sentence among others). */
export function saysNoDrawing(text) {
  const raw = normalise(text);
  if (!raw) return false;
  return LANGUAGES.some((lang) => lang.negation.test(prepared(lang, raw)));
}

/**
 * A turn said in Spanish, Russian, Chinese or Japanese that the rules above
 * could not place, in which a drawing is nonetheless plausibly in play.
 *
 * Called only when `resolveOtherLanguageRequest` returned nothing. What comes
 * back is NOT a decision: it is the request the turn WOULD be if it is one,
 * and the caller marks the turn undecided. The contract built from it asks
 * the model that answers to say which it is — a request for the drawing, a
 * change to the one on the table, a question about it, or none of these — in
 * the same generation as the answer.
 *
 * In play means one of:
 *   - the drawing on the table is what the conversation is on (it leaves
 *     focus with the first answer that is not about it); or, out of focus,
 *     the turn names the drawing or one of its parts.
 *     In focus no word of the turn is asked for. A gate on "shares a word
 *     with a label" was tried and removed: a model asked in Spanish or
 *     Japanese labels its drawing in English as often as not ("Payment
 *     Service"), and "決済のところ…名前を変えといて" then shares nothing with
 *     it (seen in the real engine, 2026-10-02). The cost is the turn right
 *     after a drawing that is about something else: it carries the drawing
 *     too, and the contract tells the model to take nothing from it;
 *   - a visual is mentioned at all, in any mood ("me lo esquematizas",
 *     "покажи это картинкой", "折线图 来一个", "ガントチャートで引いてみて").
 *
 * Never: a coding turn, a turn that says no drawing is wanted, or one with
 * nothing in it to decide on.
 *
 * @param {{
 *   question?: string | null,
 *   activeDesign?: { artifactId?: string, artifact?: string, view?: string, source?: string, foreground?: boolean } | null,
 *   answerType?: string | null,
 *   questionTypes?: readonly string[] | null,
 * }} input
 * @returns {object | null} the request this turn would be, in the shape `resolveDiagramRequest` returns
 */
export function undecidedOtherLanguageTurn(input = {}) {
  const raw = normalise(input.question);
  if (!raw) return null;
  const lang = languageOf(raw);
  if (!lang) return null;
  const q = prepared(lang, raw);
  const types = Array.isArray(input.questionTypes) ? input.questionTypes : [];
  if (input.answerType === 'coding_question_answer' || input.answerType === 'dsa_question_answer' || types.includes('CODING_TASK')) return null;
  const sentences = sentencesOf(q);
  if (sentences.length === 0 || !saysSomething(lang, q)) return null;
  if (sentences.some((s) => lang.negation.test(s) && !asksForAnotherInstead(lang, s))) return null;

  const active = input.activeDesign && input.activeDesign.source ? input.activeDesign : null;
  // The visual the turn names, if it names one.
  let named = null;
  for (const sentence of sentences) {
    const visual = visualIn(lang, sentence);
    if (visual) { named = { visual, sentence }; break; }
  }

  /** A drawing that may be asked for: of what is on the table when the sentence points at it. */
  const fresh = (visual, sentence) => {
    // "¿Para qué sirve un diagrama ER?", "类图和对象图有什么区别？": a question
    // about a kind of drawing, with no verb that draws. Asked to decide, a
    // model illustrates its answer with one (seen live, in three languages).
    if (lang.aboutKind && lang.aboutKind.test(sentence) && !lang.draw.test(sentence)) return null;
    const family = active && (active.view === 'chart' || active.artifact === 'chart') ? 'chart' : active && active.view === 'matrix' ? 'table' : 'mermaid';
    const ofActive = Boolean(active) && pointsAtDesign(lang, sentence, active);
    const view = (visual && visual.view) || hintedView(lang, sentence);
    const basis = lang.meeting && lang.meeting.test(q) ? 'meeting-reconstruction'
      : lang.source && lang.source.test(q) ? 'source-reconstruction'
      : lang.hypothetical && lang.hypothetical.test(q) ? 'illustrative'
      : 'proposed-design';
    let chartIntent = visual ? visual.chartIntent : undefined;
    if (view === 'chart' && (!chartIntent || chartIntent === 'generic' || chartIntent === 'trend')) {
      if (lang.fn && lang.fn.test(q)) chartIntent = 'function';
      else if (lang.forecast && lang.forecast.test(q) && (q.match(/\d+(?:[.,]\d+)?/g) || []).length >= 2) chartIntent = 'forecast';
    }
    return {
      enabled: true,
      view,
      operation: 'create',
      output: 'text-and-diagram',
      basis,
      ...(ofActive ? { parentArtifactId: active.artifactId, followUp: 'weak', parentFamily: family } : {}),
      withCode: false,
      explicit: false,
      attachActiveDesign: ofActive,
      reason: 'undecided_request',
      language: lang.code,
      ...(chartIntent ? { chartIntent } : {}),
      ...(visual && visual.layout ? { layout: visual.layout } : {}),
    };
  };

  if (active) {
    const chart = active.view === 'chart' || active.artifact === 'chart';
    const labels = labelsOf(active.source, chart ? 'chart' : 'mermaid');
    const inPlay = active.foreground !== false || sentences.some((s) => namesDrawing(lang, s, active)
      || (chart
        ? distinctNames(labels.filter((label) => usesLabel(lang, s, [label]))) >= (lang.chartTerms.test(s) ? 1 : 2)
        : usesLabel(lang, s, labels) || namesALane(lang, s, active)));
    if (inPlay) {
      // Another kind of drawing is named: it may be asked for — of what is on
      // the table when the sentence points at it, of something else otherwise.
      const view = String(active.view || '');
      const another = named && named.visual.view && named.visual.view !== view && !(BOXES.has(named.visual.view) && BOXES.has(view));
      if (another) return fresh(named.visual, named.sentence);
      return {
        enabled: true,
        view: active.view || 'architecture',
        operation: 'update',
        output: 'text-and-diagram',
        basis: 'proposed-design',
        parentArtifactId: active.artifactId,
        withCode: false,
        explicit: false,
        attachActiveDesign: true,
        followUp: 'weak',
        reason: 'undecided_follow_up',
        language: lang.code,
        // The conversation has moved on from the drawing: said so, the model
        // is told to hold the turn to a higher bar (see the contract).
        ...(active.foreground === false ? { away: true } : {}),
      };
    }
  }

  if (named) return fresh(named.visual, named.sentence);
  const mentions = lang.visualish ? sentences.find((s) => lang.visualish.test(s)) : null;
  if (!mentions) return null;
  const loose = (lang.looseNouns || []).find(([re]) => re.test(mentions));
  return fresh(loose ? loose[1] : null, mentions);
}
