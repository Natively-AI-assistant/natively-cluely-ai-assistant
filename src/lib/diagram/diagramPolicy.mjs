// What Mermaid source Natively is willing to hand to the renderer.
//
// This is stage 1 of diagram validation (see docs/diagrams/README.md): a
// cheap, synchronous, dependency-free check that runs before Mermaid's own
// parser. It decides three things about a completed block:
//
//   1. which diagram family it is, and whether that family is supported;
//   2. whether it is small enough to lay out without stalling the overlay;
//   3. whether it carries anything a model-written diagram has no business
//      carrying: its own Mermaid configuration, click/link interaction,
//      remote images or icons, raw HTML.
//
// Config and interaction statements are *neutralised* (removed from the text
// that is rendered — the saved/copied source stays exactly what the model
// wrote). Remote resources, raw HTML, unsupported families and oversized
// graphs are *rejected*: the card shows the source and a readable reason.
//
// Passing this check says nothing about whether Mermaid can parse the text,
// and nothing at all about whether the architecture is right.

/** Header keyword → { type, view }. `view` is the product-facing name. */
const DIAGRAM_TYPES = [
  { re: /^flowchart(?:-elk)?\b/, type: 'flowchart', view: 'flowchart' },
  { re: /^graph\b/, type: 'flowchart', view: 'flowchart' },
  { re: /^sequenceDiagram\b/, type: 'sequence', view: 'sequence' },
  { re: /^stateDiagram(?:-v2)?\b/, type: 'state', view: 'state' },
  { re: /^classDiagram(?:-v2)?\b/, type: 'class', view: 'class' },
  { re: /^erDiagram\b/, type: 'er', view: 'er' },
];

export const SUPPORTED_DIAGRAM_TYPES = Object.freeze(['flowchart', 'sequence', 'state', 'class', 'er']);

export const DIAGRAM_LIMITS = Object.freeze({
  /** Hard ceiling on source size handed to the renderer. */
  maxSourceChars: 8000,
  maxLines: 220,
  /** Hard ceilings on estimated graph size (the prompt asks for far less). */
  maxNodes: 60,
  maxEdges: 120,
});

export const DIAGRAM_REJECTION = Object.freeze({
  EMPTY: 'empty',
  UNSUPPORTED_TYPE: 'unsupported_type',
  TOO_LARGE: 'too_large',
  REMOTE_RESOURCE: 'remote_resource',
  RAW_HTML: 'raw_html',
});

const REJECTION_TEXT = {
  empty: 'The diagram block is empty.',
  unsupported_type: 'This diagram type is not supported here.',
  too_large: 'This diagram is too large to draw here.',
  remote_resource: 'This diagram refers to an outside image or link, which is not allowed.',
  raw_html: 'This diagram contains HTML, which is not allowed.',
};

/** A short sentence a person can read, for a rejection code. */
export function describeDiagramRejection(code) {
  return REJECTION_TEXT[code] || 'This diagram could not be drawn.';
}

function normaliseNewlines(source) {
  return String(source ?? '').replace(/\r\n?/g, '\n');
}

/** Remove a leading YAML frontmatter block ("---\n…\n---"). */
function stripFrontmatter(text, notes) {
  const m = /^\s*---[ \t]*\n[\s\S]*?\n---[ \t]*(?:\n|$)/.exec(text);
  if (!m) return text;
  notes.push('frontmatter');
  return text.slice(m[0].length);
}

/** Remove %%{ … }%% directives (init/config), which may span lines. */
function stripDirectives(text, notes) {
  let found = false;
  const out = text.replace(/%%\{[\s\S]*?\}%%[ \t]*\n?/g, () => {
    found = true;
    return '';
  });
  if (found) notes.push('directive');
  return out;
}

const INTERACTION_LINE_RE = /^\s*(?:click\s+\S+|links?\s+[^:\n]+:)/;

/** Remove click / link / links statements (they do nothing in strict mode). */
function stripInteraction(text, notes) {
  let found = false;
  const kept = text.split('\n').filter((line) => {
    if (INTERACTION_LINE_RE.test(line)) {
      found = true;
      return false;
    }
    return true;
  });
  if (found) notes.push('interaction');
  return kept.join('\n');
}

function firstStatement(text) {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('%%')) continue;
    return line;
  }
  return '';
}

/** Identify the diagram family from its header line. */
export function detectDiagramType(source) {
  const head = firstStatement(normaliseNewlines(source));
  for (const entry of DIAGRAM_TYPES) {
    if (entry.re.test(head)) return { type: entry.type, view: entry.view, header: head };
  }
  return { type: null, view: null, header: head };
}

const FLOW_EDGE_RE = /(?:<|o|x)?(?:-{2,}|={2,}|-\.+-)(?:>|o|x)?|~~~/g;
const SEQ_MESSAGE_RE = /-{1,2}(?:>>|>|x|\))/;
const STATE_EDGE_RE = /-->/;

/**
 * Rough node/edge counts. Good enough to refuse a 300-node graph; not a
 * parser, and never used to accept or reject anything semantic.
 */
export function estimateDiagramComplexity(source, type = detectDiagramType(source).type) {
  const lines = normaliseNewlines(source)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('%%'));
  let edges = 0;
  const nodes = new Set();

  if (type === 'sequence') {
    for (const line of lines) {
      const decl = /^(?:participant|actor)\s+(\S+)/.exec(line);
      if (decl) nodes.add(decl[1]);
      if (SEQ_MESSAGE_RE.test(line) && line.includes(':')) {
        edges += 1;
        const m = /^(\S+?)\s*-{1,2}(?:>>|>|x|\))[+-]?\s*(\S+?)\s*:/.exec(line);
        if (m) {
          nodes.add(m[1]);
          nodes.add(m[2]);
        }
      }
    }
  } else if (type === 'state') {
    for (const line of lines) {
      const m = /^(\[\*\]|[\w.-]+)\s*-->\s*(\[\*\]|[\w.-]+)/.exec(line);
      if (m) {
        edges += 1;
        if (m[1] !== '[*]') nodes.add(m[1]);
        if (m[2] !== '[*]') nodes.add(m[2]);
      } else if (STATE_EDGE_RE.test(line)) {
        edges += 1;
      }
      const decl = /^state\s+(?:"[^"]*"\s+as\s+)?([\w.-]+)/.exec(line);
      if (decl) nodes.add(decl[1]);
    }
  } else {
    // flowchart / class / er: count arrow operators, and identifiers that
    // start a statement or follow an arrow.
    for (const line of lines.slice(1)) {
      if (/^(?:subgraph|end|direction|classDef|class|style|linkStyle)\b/.test(line)) continue;
      // Labels can contain arrow-like text; blank them out before counting.
      const bare = line.replace(/"[^"]*"/g, '""').replace(/\|[^|]*\|/g, '||');
      const arrows = bare.match(FLOW_EDGE_RE);
      if (arrows) edges += arrows.length;
      for (const m of bare.matchAll(/(?:^|[>ox\-=.~|&\s])([A-Za-z_][\w-]*)(?=\s*(?:[[({>@]|-{2,}|={2,}|-\.|~~~|&|$))/g)) {
        nodes.add(m[1]);
      }
    }
  }
  return { nodes: nodes.size, edges, lines: lines.length };
}

// A real URL or script scheme. Deliberately narrow: labels such as
// "Upload file: 5 MB" or "data: user row" are ordinary text.
const REMOTE_RE = /\b(?:https?|ftp|file|wss?):\/\/|\b(?:javascript|vbscript)\s*:|\bdata:[a-z]+\/[a-z0-9.+-]+|\burl\s*\(/i;
// Flowchart "@{ img: … }" / "@{ icon: … }" shapes pull images or icon packs.
const MEDIA_SHAPE_RE = /@\{[^}]*\b(?:img|icon)\s*:/i;
// Tags that load, run or embed something, and any tag carrying an on*=
// handler. Not "any angle bracket": "<<choice>>" and "List<String>" are
// legitimate Mermaid/label text, and "<br/>" is a label line break.
const HTML_TAG_RE =
  /<\s*\/?\s*(?:script|iframe|embed|foreignobject)\b|<\s*(?:img|svg|style|link|meta|base|video|audio|object|form|input)\s+[a-z-]+\s*=|<\s*a\s+[^<>]*href\s*=|<[a-z][^<>]*\son[a-z]+\s*=/i;

/**
 * Stage-1 check of a completed Mermaid block.
 *
 * @param {string} source  block content exactly as the model wrote it
 * @param {{ limits?: Partial<typeof DIAGRAM_LIMITS>, allowedTypes?: readonly string[] }} [options]
 * @returns {{
 *   ok: boolean,
 *   type: string | null,
 *   view: string | null,
 *   renderSource: string,
 *   neutralised: string[],
 *   complexity: { nodes: number, edges: number, lines: number },
 *   rejection?: string,
 *   message?: string,
 * }}
 */
// ── reserved words used as node ids ─────────────────────────────────────────

// Words the pinned Mermaid's flowchart grammar reads as keywords wherever they
// appear, so a node CALLED one of them does not parse. Measured against
// mermaid 11.17.2 (each word as a defined node, a first node and a bare
// reference): every word here fails; `default`, `direction`, `node`, `link`,
// `state`, `title` and capitalised variants (`End`, `Graph`) are fine.
// Found live: a real model named the "Social Graph" node `graph`.
export const RESERVED_FLOWCHART_IDS = Object.freeze([
  'graph', 'end', 'subgraph', 'flowchart', 'class', 'classDef', 'style', 'click', 'linkStyle', 'call', 'href', 'interpolate',
]);
const RESERVED_ID_RE = new RegExp(`(?<![A-Za-z0-9_:.])(${RESERVED_FLOWCHART_IDS.join('|')})(?![A-Za-z0-9_])`, 'g');
// A line that IS one of Mermaid's own statements (and so keeps its keyword).
const KEYWORD_STATEMENT_RE = /^(?:subgraph|classDef|class|style|linkStyle|click|direction|accTitle|accDescr)(?:\s|$)/;
const FLOW_LINK_RE = /--|==|-\.|~~~/;
const SHAPE_CLOSER = { '[': ']', '(': ')', '{': '}' };

/** The line with every label blanked out (quotes, |edge labels|, shape brackets), same length. */
function maskFlowLabels(line) {
  const out = line.split('');
  const blank = (from, to) => {
    for (let k = from; k < to; k += 1) out[k] = ' ';
  };
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === '|') {
      const close = line.indexOf(ch, i + 1);
      const end = close === -1 ? line.length : close;
      blank(i + 1, end);
      i = end + 1;
    } else if (SHAPE_CLOSER[ch]) {
      let depth = 1;
      let k = i + 1;
      while (k < line.length && depth > 0) {
        const c = line[k];
        if (c === '"') {
          const q = line.indexOf('"', k + 1);
          k = q === -1 ? line.length : q + 1;
        } else {
          if (SHAPE_CLOSER[c]) depth += 1;
          else if (c === ']' || c === ')' || c === '}') depth -= 1;
          k += 1;
        }
      }
      blank(i + 1, depth === 0 ? k - 1 : k);
      i = k;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/**
 * Rename flowchart node ids that are Mermaid keywords (`graph` → `graph_node`)
 * so the diagram parses. Labels, edge labels and Mermaid's own statements
 * (`subgraph …`, a lone `end`, `style …`) are left exactly as written. The same
 * word gets the same new id on every line, so connections stay intact.
 *
 * Deterministic and local: this is the cheap fix that makes a model repair
 * call unnecessary for the most common real-world slip.
 *
 * @param {string} source flowchart source, header on its first line
 * @returns {{ text: string, renamed: string[] }} `renamed` lists the words that were ids
 */
export function renameReservedFlowchartIds(source) {
  const lines = normaliseNewlines(source).split('\n');
  const renamed = new Map();
  const newIdFor = (word) => {
    if (!renamed.has(word)) {
      let candidate = `${word}_node`;
      // Never collide with an id the diagram already uses.
      while (new RegExp(`(?<![A-Za-z0-9_])${candidate}(?![A-Za-z0-9_])`).test(source)) candidate += '_';
      renamed.set(word, candidate);
    }
    return renamed.get(word);
  };
  let headerSeen = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%%')) return line;
    if (!headerSeen) {
      headerSeen = true; // `flowchart LR` / `graph TD`
      return line;
    }
    if (trimmed === 'end') return line; // closes a subgraph
    const masked = maskFlowLabels(line);
    if (KEYWORD_STATEMENT_RE.test(trimmed) && !FLOW_LINK_RE.test(masked)) return line;
    let result = '';
    let last = 0;
    RESERVED_ID_RE.lastIndex = 0;
    for (let m = RESERVED_ID_RE.exec(masked); m; m = RESERVED_ID_RE.exec(masked)) {
      result += line.slice(last, m.index) + newIdFor(m[1]);
      last = m.index + m[1].length;
    }
    return result + line.slice(last);
  });
  return { text: renamed.size ? out.join('\n') : normaliseNewlines(source), renamed: [...renamed.keys()] };
}

export function checkDiagramSource(source, options = {}) {
  const limits = { ...DIAGRAM_LIMITS, ...(options.limits || {}) };
  const allowed = options.allowedTypes || SUPPORTED_DIAGRAM_TYPES;
  const neutralised = [];
  const original = normaliseNewlines(source);

  const reject = (rejection, extra = {}) => ({
    ok: false,
    type: null,
    view: null,
    renderSource: '',
    neutralised,
    complexity: { nodes: 0, edges: 0, lines: 0 },
    rejection,
    message: describeDiagramRejection(rejection),
    ...extra,
  });

  if (!original.trim()) return reject(DIAGRAM_REJECTION.EMPTY);
  if (original.length > limits.maxSourceChars) return reject(DIAGRAM_REJECTION.TOO_LARGE);

  let text = stripFrontmatter(original, neutralised);
  text = stripDirectives(text, neutralised);
  text = stripInteraction(text, neutralised);
  text = text.replace(/\s+$/, '');
  if (!text.trim()) return reject(DIAGRAM_REJECTION.EMPTY);

  const { type, view } = detectDiagramType(text);
  if (!type || !allowed.includes(type)) return reject(DIAGRAM_REJECTION.UNSUPPORTED_TYPE, { type, view });

  // A node id that is a Mermaid keyword does not parse; rename it locally.
  if (type === 'flowchart') {
    const fixed = renameReservedFlowchartIds(text);
    if (fixed.renamed.length) {
      text = fixed.text;
      neutralised.push('reserved_id');
    }
  }

  if (MEDIA_SHAPE_RE.test(text) || REMOTE_RE.test(text)) {
    return reject(DIAGRAM_REJECTION.REMOTE_RESOURCE, { type, view });
  }
  if (HTML_TAG_RE.test(text)) return reject(DIAGRAM_REJECTION.RAW_HTML, { type, view });

  const complexity = estimateDiagramComplexity(text, type);
  if (complexity.lines > limits.maxLines || complexity.nodes > limits.maxNodes || complexity.edges > limits.maxEdges) {
    return reject(DIAGRAM_REJECTION.TOO_LARGE, { type, view, complexity });
  }

  return { ok: true, type, view, renderSource: text, neutralised, complexity };
}

/** Human label for a diagram family, used as the card title. */
export function diagramViewLabel(view) {
  switch (view) {
    case 'sequence':
      return 'Sequence diagram';
    case 'state':
      return 'State diagram';
    case 'class':
      return 'Class diagram';
    case 'er':
      return 'Data model';
    case 'architecture':
      return 'Architecture diagram';
    case 'flowchart':
      return 'Flowchart';
    default:
      return 'Diagram';
  }
}

/**
 * The title a diagram CARD shows, on every surface. A flowchart header covers
 * both architecture and process diagrams and the source cannot say which, so
 * that family is simply a "Diagram".
 */
export function diagramCardLabel(view) {
  return view && view !== 'flowchart' ? diagramViewLabel(view) : 'Diagram';
}

// ── rendered SVG ────────────────────────────────────────────────────────────

// Anything in a produced SVG that could fetch or execute. Local fragment
// references (url(#marker), href="#id") are how SVG markers work and stay.
// Attribute checks are scoped to the inside of a tag: label TEXT such as
// "retry once = ok" must not read as an on*= handler.
const UNSAFE_SVG_RE =
  /url\(\s*(?:&quot;|["'])?\s*(?!#)[^)\s]|@import|<[^<>]*\s(?:xlink:)?href\s*=\s*["']\s*(?!#)[^"'\s]|<\s*(?:script|foreignObject|iframe|image|img|a|use|animate|animateTransform|animateMotion|set)\b|<[^<>]*\son[a-z]+\s*=|javascript:/i;

/** Largest rendered SVG accepted across a process boundary (chars). */
export const DIAGRAM_SVG_MAX_CHARS = 400_000;

/**
 * Is this text a self-contained, inert SVG drawing? A pure text check, usable
 * where there is no DOM (the main process re-checks SVG a renderer window
 * produced before it goes to the phone). The renderer additionally runs the
 * markup through DOMPurify; this is the check both sides share.
 */
export function isSafeDiagramSvg(svg) {
  if (typeof svg !== 'string') return false;
  if (svg.length === 0 || svg.length > DIAGRAM_SVG_MAX_CHARS) return false;
  if (!/^\s*<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) return false;
  return !UNSAFE_SVG_RE.test(svg);
}

/** Stable short key for a diagram source (FNV-1a + length). Not a security boundary. */
export function diagramSourceKey(source) {
  const text = normaliseNewlines(source).trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}-${text.length.toString(36)}`;
}
