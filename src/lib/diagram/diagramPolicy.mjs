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
  { re: /^mindmap\b/, type: 'mindmap', view: 'mindmap' },
  { re: /^timeline\b/, type: 'timeline', view: 'timeline' },
  { re: /^gantt\b/, type: 'gantt', view: 'gantt' },
];

/**
 * The Mermaid families this app draws. A product decision, not "whatever the
 * installed Mermaid can parse": each family here was rendered with the pinned
 * version under this app's configuration and sanitiser, has a prompt rule and
 * a size estimate, and is covered by the render check.
 *
 * Deliberately NOT here:
 *   xychart / pie / quadrantChart   numbers go through `natively-chart`, which
 *                                   carries units, status and provenance and
 *                                   computes forecasts itself;
 *   journey                         needs satisfaction scores (which a meeting
 *                                   rarely has) and draws with foreignObject;
 *   sankey                          needs real flow magnitudes; not offered;
 *   kanban, requirementDiagram, C4, gitGraph, block, packet, architecture
 *                                   no reviewed use here.
 */
export const SUPPORTED_DIAGRAM_TYPES = Object.freeze(['flowchart', 'sequence', 'state', 'class', 'er', 'mindmap', 'timeline', 'gantt']);

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
  // Mermaid's own directive pattern makes the closing "}%%" OPTIONAL, so a
  // directive that is never closed is still read as one. What is left of an
  // opening "%%{" after the closed ones are gone is removed to the end of its
  // line.
  const out = text.replace(/%%\{[\s\S]*?\}%%[ \t]*\n?|%%\{[^\n]*\n?/g, () => {
    found = true;
    return '';
  });
  if (found) notes.push('directive');
  return out;
}

// A click STATEMENT has a target id and an action: `click A href "…"`, `click A
// call fn()`, `click A "https://…"`. Only flowcharts, class diagrams and Gantt
// charts have one. A node that happens to be called `click` ("user --> click",
// "click --> call"), and a mind-map branch that reads `click the "Start"
// button`, are content — their lines used to be deleted.
const CLICK_STATEMENT_RE = /^\s*click\s+[A-Za-z_][\w-]*\s+(?:href\b|call\b|callback\b|"|')/;
const CLICK_AFTER_SEMICOLON_RE = /;\s*click\s+[A-Za-z_][\w-]*\s+(?:href\b|call\b|callback\b|"|')[^;]*/g;
const HAS_CLICK_STATEMENTS = /^\s*(?:flowchart|graph|classDiagram|gantt)\b/;
// `link Actor: label @ url` and `links Actor: {…}` exist only in a sequence
// diagram, and name an actor — not a message FROM a participant called link
// ("link ->> A: resolve"). Elsewhere "link created : …" is a timeline period
// and "link checker :a1, …" a gantt task.
const SEQUENCE_LINK_RE = /^\s*links?\s+[\w ]+:\s/;

/** Remove click / link / links statements (they do nothing in strict mode). */
function stripInteraction(text, notes) {
  let found = false;
  const header = firstStatement(text);
  const isSequence = /^\s*sequenceDiagram\b/.test(header);
  const hasClicks = HAS_CLICK_STATEMENTS.test(header);
  if (!isSequence && !hasClicks) return text;
  const kept = text.split('\n').filter((line) => {
    if ((hasClicks && CLICK_STATEMENT_RE.test(line)) || (isSequence && SEQUENCE_LINK_RE.test(line))) {
      found = true;
      return false;
    }
    return true;
  }).map((line) => {
    // A statement can also follow a semicolon: "a --> b; click a call f()".
    if (!hasClicks || line.indexOf(';') === -1 || !/;\s*click\s/.test(line)) return line;
    const cut = line.replace(CLICK_AFTER_SEMICOLON_RE, '');
    if (cut !== line) found = true;
    return cut;
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
  } else if (type === 'er') {
    // Entities are block headers and relationship endpoints; attribute lines are not nodes.
    for (const line of lines.slice(1)) {
      const rel = /^("[^"]+"|[\w-]+)\s*(?:\|\||\|o|\}o|\}\|)\s*(?:--|\.\.)\s*(?:\|\||o\||o\{|\|\{)\s*("[^"]+"|[\w-]+)/.exec(line);
      if (rel) {
        edges += 1;
        nodes.add(rel[1]);
        nodes.add(rel[2]);
        continue;
      }
      const block = /^("[^"]+"|[\w-]+)(?:\s*\[[^\]]*\])?\s*\{\s*$/.exec(line);
      if (block) nodes.add(block[1]);
    }
  } else if (type === 'class') {
    // Classes are declarations and relationship endpoints; members are not nodes.
    for (const line of lines.slice(1)) {
      const decl = /^class\s+([\w-]+)/.exec(line);
      if (decl) {
        nodes.add(decl[1]);
        continue;
      }
      const rel = /^([\w-]+)\s*(?:"[^"]*"\s*)?(?:<\|--|<\|\.\.|--\|>|\.\.\|>|\*--|--\*|o--|--o|-->|<--|\.\.>|<\.\.|--|\.\.)\s*(?:"[^"]*"\s*)?([\w-]+)/.exec(line);
      if (rel) {
        edges += 1;
        nodes.add(rel[1]);
        nodes.add(rel[2]);
      }
    }
  } else if (type === 'mindmap') {
    // One node per line after the header; the tree's edges are its nodes minus the root.
    for (const line of lines.slice(1)) nodes.add(`${nodes.size}:${line}`);
    edges = Math.max(0, nodes.size - 1);
  } else if (type === 'timeline') {
    // "period : event" lines and ": event" continuation lines.
    for (const line of lines.slice(1)) {
      if (/^(?:title|section)\b/.test(line)) continue;
      nodes.add(`${nodes.size}:${line}`);
      edges += (line.match(/:/g) || []).length;
    }
  } else if (type === 'gantt') {
    for (const line of lines.slice(1)) {
      if (/^(?:title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday|section|inclusiveEndDates|topAxis)\b/.test(line)) continue;
      if (line.includes(':')) {
        nodes.add(`${nodes.size}:${line}`);
        if (/\bafter\b/.test(line)) edges += 1;
      }
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
// "Short URL (base62)", "Long URL(original)" and a participant called
// JavaScript ("API-->>JavaScript: JSON response") are label text, and were
// refused as links. A script URL matters only where a link is being declared,
// and `url(` only where a style is.
// A web address written in a label ("GET https://sho.rt/abc", "wss://chat") is
// text: the drawing is shown as an image and nothing in it is a link. It was
// refused wherever it stood — which refused any URL-shortener or websocket
// design, and a policy refusal is never repaired. It is refused only where a
// statement could reference it (a click, a link, a style).
const REMOTE_RE =
  /(?:^|\n)\s*(?:click|links?|href|style|classDef|linkStyle|cssClass)\b(?!\s*(?:[[({>]|-{2,}|={2,}|-\.|~~~|&|:::))[^\n]*\b(?:https?|ftp|file|wss?):\/\/|\b(?:href|click|link|src)\b[^\n]*\b(?:javascript|vbscript)\s*:|["'(=]\s*(?:javascript|vbscript)\s*:(?!\s)|\bdata:[a-z]+\/[a-z0-9.+-]+|(?:^|\n)\s*(?:style|classDef|linkStyle|cssClass)\b[^\n]*\burl\s*\(|\b(?:fill|stroke|background(?:-image)?|filter|mask|clip-path|marker(?:-start|-mid|-end)?|content|cursor|src)\s*:\s*url\s*\(/i;
// Flowchart "@{ img: … }" / "@{ icon: … }" shapes pull images or icon packs.
const MEDIA_SHAPE_RE = /@\{[^}]*\b(?:img|icon)\s*:/i;
// Tags that load, run or embed something, and any tag carrying an on*=
// handler. Not "any angle bracket": "<<choice>>" and "List<String>" are
// legitimate Mermaid/label text, and "<br/>" is a label line break.
// Attributes can be separated by "/" as well as by space ("<img/src=x/onerror=…>"),
// and "<style>" needs no attribute at all. (Not after a word or another "<":
// "List<Style>" and "<<style>>" are label text.)
const HTML_TAG_RE =
  /<\s*\/?\s*(?:script|iframe|embed|foreignobject)\b|<\s*(?:img|svg|style|link|meta|base|video|audio|object|form|input)[\s/]+[a-z-]+\s*=|(?<![<\w])<\s*style\s*>|<\s*a[\s/]+[^<>]*href\s*=|<[a-z][^<>]*[\s/]on(?:load|error|click|dblclick|mouse[a-z]+|key[a-z]+|focus[a-z]*|blur|begin|end|repeat|abort|activate|input|change|submit|toggle|pointer[a-z]+|touch[a-z]+|wheel|scroll|animation[a-z]+|transition[a-z]+|unload|resize|drag[a-z]*|drop|copy|cut|paste)\s*=/i;

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
  // Text written inside a link ("a -- end of flow --> b", "a == call ==> b")
  // is a label too.
  const masked = out.join('');
  return masked.replace(/(--|==|-\.)(\s+[^\n|>]*?\s+)(?=-->|==>|\.->|---|===)/g, (_m, open, text) => open + ' '.repeat(text.length));
}


const MINDMAP_SHAPE_OPEN_RE = /^(\s*)(?:[A-Za-z_][\w-]*)?(\(\(|\)\)|\{\{|\(|\[)/;
const MINDMAP_SHAPE_CLOSERS = ['))', '((', '}}', ')', ']'];

/**
 * A mind-map node without its shape: `  root((Plan))` → `  Plan`. Done by
 * slicing, not by one pattern: the pattern that did this (optional spaces and
 * quotes on both sides of a lazy group) took seconds on a run of spaces.
 */
function plainMindmapLine(line) {
  const open = MINDMAP_SHAPE_OPEN_RE.exec(line);
  if (!open) return line;
  const body = line.slice(open[0].length).trimEnd();
  const closer = MINDMAP_SHAPE_CLOSERS.find((c) => body.endsWith(c));
  if (!closer) return line;
  const inner = body.slice(0, body.length - closer.length).trim().replace(/^"|"$/g, '');
  if (inner.includes('"') || inner.includes('\n')) return line;
  return `${open[1]}${inner}`;
}

// ── a drawing with nothing in it ────────────────────────────────────────────
//
// Asked to draw facts it does not have, a model sometimes draws the gap itself:
// "Paper (not retrieved) --> Method (unknown)", "Dates not provided : Roles
// needed" (both seen live). Every box says the same thing as the sentence
// above it, so the app shows the sentence and not the drawing. Only a diagram
// in which EVERY node is such a label counts; one real node keeps it.
// A phrase that says "this is not known". Not a bare "needed" or "required":
// "Approval needed?" and "No action needed" are steps, not gaps.
const PLACEHOLDER_PHRASE =
  String.raw`unknown|tbd|tbc|n\/a|placeholder|unavailable|not (?:provided|retrieved|given|stated|available|known|specified|supplied|shared|discussed|covered)|(?:details?|dates?|roles?|steps?|data|information|info|inputs?|outputs?) (?:needed|missing|required|not given)|to be (?:confirmed|provided|determined|added)`;
const PLACEHOLDER_LABEL_RE = new RegExp(String.raw`\b(?:${PLACEHOLDER_PHRASE})\b`, 'i');
const PLACEHOLDER_STRIP_RE = new RegExp(String.raw`\b(?:${PLACEHOLDER_PHRASE})\b`, 'gi');
const FILLER_WORDS = new Set(['and', 'or', 'the', 'an', 'of', 'for', 'is', 'are', 'yet', 'still', 'here']);

/** How many words of a label say something once its "not known" phrases are taken out. */
function contentWords(label) {
  return String(label).replace(PLACEHOLDER_STRIP_RE, ' ').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !FILLER_WORDS.has(w)).length;
}

/** "Method (unknown)", "Dates not provided", "Database: TBD": a gap with at most a name on it. */
const isGapLabel = (label) => PLACEHOLDER_LABEL_RE.test(label) && contentWords(label) <= 2;
/** "unknown", "TBD", "not provided": nothing but the gap. */
const isBareGap = (label) => PLACEHOLDER_LABEL_RE.test(label) && contentWords(label) === 0;

/**
 * True when a Mermaid flowchart, timeline or mind map says nothing but "not
 * known". Deliberately hard to satisfy — it removes something from the screen:
 *  - a flowchart: every node is a gap, there is no node without a label (a
 *    bare `Client --> LB` is a real node), and no arrow says anything real
 *    ("Owner: unknown" -->|"owns"| "Approver: unknown" still shows who owns);
 *  - a timeline: every period and event is a gap;
 *  - a mind map: every branch is NOTHING BUT a gap. A map of open questions
 *    ("Budget unknown", "Owner TBD") is its content, and stays.
 * Never true for a diagram with no readable labels, or for other types.
 */
export function isPlaceholderDiagram(source, type) {
  // Policy refuses anything larger; nothing that will not be drawn is scanned.
  if (String(source ?? '').length > DIAGRAM_LIMITS.maxSourceChars) return false;
  if (type === undefined) type = detectDiagramType(source).type;
  const lines = normaliseNewlines(String(source ?? ''))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('%%'))
    .slice(1);
  if (type === 'flowchart') {
    const nodes = [];
    const edges = [];
    for (const line of lines) {
      if (/^(?:subgraph|end|direction|style|classDef|class|linkStyle)\b/.test(line)) continue;
      // (One class between the bars: optional spaces and quotes on both sides
      // of a lazy group went cubic on a run of spaces.)
      for (const m of line.matchAll(/\|([^|]*)\|/g)) {
        const label = m[1].trim().replace(/^"|"$/g, '').trim();
        if (label) edges.push(label);
      }
      // Node labels only: text inside a shape, not the |"…"| on an arrow.
      const withoutEdges = line.replace(/\|[^|]*\|/g, ' ');
      for (const m of withoutEdges.matchAll(/[\[({]+"([^"]+)"[\])}]+|[\[({]+([^"\[\](){}|]+)[\])}]+/g)) nodes.push(m[1] ?? m[2]);
    }
    if (nodes.length === 0) return false;
    // A node drawn by its id alone has no label to be a gap.
    if (estimateDiagramComplexity(source, 'flowchart').nodes > new Set(nodes).size) return false;
    return nodes.every(isGapLabel) && edges.every((label) => PLACEHOLDER_LABEL_RE.test(label));
  }
  if (type === 'timeline') {
    const labels = [];
    for (const line of lines) {
      if (/^(?:title|section)\b/.test(line)) continue;
      for (const part of line.split(':')) if (part.trim()) labels.push(part.trim());
    }
    return labels.length > 0 && labels.every(isGapLabel);
  }
  if (type === 'mindmap') {
    // The root names the subject; the branches are what would carry content.
    const branches = lines.slice(1).map((line) => line.replace(/^[\w-]*[\[({]+"?|"?[\])}]+$/g, ''));
    return branches.length > 0 && branches.every(isBareGap);
  }
  return false;
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
    if (/^end\s*;?\s*(?:%%.*)?$/.test(trimmed)) return line; // closes a subgraph ("end", "end;", "end %% core")
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
  // Mermaid's own statements NAME ids too: "style graph fill:#f9f", "class
  // graph,end hot", "subgraph graph [Social]". Left as written while every
  // other reference became graph_node, they pointed at nothing (or still did
  // not parse).
  const reserved = new Set(RESERVED_FLOWCHART_IDS);
  const inStep = out.map((line) => {
    let m = /^(\s*style\s+)([A-Za-z_][\w-]*)(\s.*)$/.exec(line);
    if (m && reserved.has(m[2])) return `${m[1]}${newIdFor(m[2])}${m[3]}`;
    m = /^(\s*class\s+)([\w-]+(?:\s*,\s*[\w-]+)*)(\s+\S.*)$/.exec(line);
    if (m) return `${m[1]}${m[2].split(',').map((id) => (reserved.has(id.trim()) ? newIdFor(id.trim()) : id)).join(',')}${m[3]}`;
    m = /^(\s*subgraph\s+)([A-Za-z_][\w-]*)(\s*(?:\[.*)?)$/.exec(line);
    if (m && reserved.has(m[2])) return `${m[1]}${newIdFor(m[2])}${m[3]}`;
    return line;
  });
  return { text: renamed.size ? inStep.join('\n') : normaliseNewlines(source), renamed: [...renamed.keys()] };
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

  // Presentation-only normalisations for two families (the meaning of the
  // diagram is untouched; the saved and copied source stays as written):
  //  - a mind map node written with a shape (`root((Plan))`) is drawn as plain
  //    text. With text labels the pinned Mermaid misplaces a shaped node's
  //    label, and a mind map's shapes carry no meaning to lose;
  //  - a Gantt chart gets no "today" line. It marks the day the chart is
  //    VIEWED, which on a saved answer is a line through an unrelated date.
  if (type === 'mindmap') {
    const plain = text
      .split('\n')
      .map((line, i) => (i === 0 ? line : plainMindmapLine(line)))
      .join('\n');
    if (plain !== text) {
      text = plain;
      neutralised.push('node_shape');
    }
  }
  //  - a sequence participant named with quotes (`participant q as "Queue"`)
  //    is drawn without them. Mermaid prints an alias as written, quotes and
  //    all, and a model that quotes labels in flowcharts quotes them here too
  //    (seen live: every box read "Producer Service" with the marks, and a
  //    name broke mid-word to fit them). Only a plain name is touched.
  if (type === 'sequence') {
    const plain = text.replace(/^(\s*(?:participant|actor)\s+\S+\s+as\s+)"([^"\n;#:<>]*)"[ \t]*$/gm, '$1$2');
    if (plain !== text) {
      text = plain;
      neutralised.push('alias_quotes');
    }
  }
  if (type === 'gantt' && !/^\s*todayMarker\b/m.test(text)) {
    text = text.replace(/^(\s*gantt[^\n]*)(\n|$)/, '$1\n    todayMarker off$2');
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
    case 'mindmap':
      return 'Mind map';
    case 'timeline':
      return 'Timeline';
    case 'gantt':
      return 'Schedule';
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
//
// The check reads each TAG — its element name, its attribute names and the
// targets of its links — rather than one pattern over the whole text. A
// pattern that wanted a space before `onload=` or `href=` was passed by
// `<g/onload=…>`, `<g id="a"onload=…>` and `<feImage/href=…>`; one that
// listed element names was passed by a namespace prefix (`<s:script>`); and
// the `url(` test refused a quoted local reference (`url("#arrow")`).
const FORBIDDEN_SVG_ELEMENTS = new Set([
  'script', 'foreignobject', 'iframe', 'image', 'img', 'a', 'use', 'animate', 'animatetransform', 'animatemotion', 'set', 'feimage',
  'video', 'audio', 'source', 'track', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'handler', 'listener',
]);
// A url() that is not a reference to something inside the same drawing.
const NON_LOCAL_URL_RE = /url\(\s*(?!(?:&quot;|&#34;|&#x22;|&apos;|&#39;|["'])?\s*#)/i;
const UNSAFE_TEXT_RE = /@import|javascript:|vbscript:|expression\s*\(|image-set\s*\(/i;

/**
 * CSS as the browser reads it: `\75rl(` is `url(`, `\6a avascript:` is
 * `javascript:`. The checks read the text both as written and as decoded.
 */
function cssDecoded(text) {
  if (!text.includes('\\')) return text;
  return text
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\uFFFD';
    })
    .replace(/\\([^\n\r\f])/g, '$1');
}

const unsafeCss = (text) => NON_LOCAL_URL_RE.test(text) || UNSAFE_TEXT_RE.test(text);
const unsafeCssEitherWay = (text) => unsafeCss(text) || (text.includes('\\') && unsafeCss(cssDecoded(text)));
// For text that cannot be split into tags (a comment, CDATA, an unterminated
// quote): the same rules as one conservative pattern.
const UNSAFE_SVG_RE =
  /url\(\s*(?!(?:&quot;|&#34;|&#x22;|&apos;|&#39;|["'])?\s*#)|@import|[\s/"'](?:[\w.-]+:)?href\s*=\s*["']?\s*(?!#)[^"'\s>]|[\s/"']src(?:set)?\s*=|<\s*\/?\s*(?:[\w.-]+:)?(?:script|foreignObject|iframe|image|img|a|use|animate|animateTransform|animateMotion|set|feImage|video|audio|source|track|object|embed|link|meta|base|form|input|button|textarea|handler|listener)\b|[\s/"']on[a-z]+\s*=|javascript:|vbscript:|expression\s*\(/i;

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
  // Text between tags cannot load or run anything (a "<" there is "&lt;"), so
  // a label that says "JavaScript: The Good Parts" or "url(img.png)" is not a
  // reference. Only the tags themselves and the contents of <style> are read.
  const parts = splitSvgMarkup(svg);
  // Not cleanly separable (a comment, CDATA, an unterminated quote): judge the
  // whole text.
  if (!parts) return !UNSAFE_SVG_RE.test(svg) && !unsafeCssEitherWay(svg) && !(svg.includes('\\') && UNSAFE_SVG_RE.test(cssDecoded(svg)));
  for (const tag of parts.tags) if (!isSafeSvgTag(tag)) return false;
  // A <style> block of a drawing has no business naming an outside address at all.
  return !unsafeCssEitherWay(parts.style) && !/(?:https?|ftp|wss?|file):\/\/|\bdata:/i.test(cssDecoded(parts.style));
}

// An attribute name can follow a space, a "/" or the closing quote of the
// value before it.
const SVG_HANDLER_RE = /[\s/"']on[a-z]+\s*=/i;
const SVG_SRC_RE = /[\s/"']src(?:set)?\s*=/i;
const SVG_HREF_RE = /[\s/"'](?:[\w.-]+:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi;
const SVG_ELEMENT_NAME_RE = /^<\s*\/?\s*(?:[A-Za-z][\w.-]*:)?([A-Za-z][\w.-]*)/;

/** One tag of an SVG: an allowed element, with no handler, no src, and only local links. */
function isSafeSvgTag(tag) {
  const name = SVG_ELEMENT_NAME_RE.exec(tag);
  if (!name) return false;
  if (FORBIDDEN_SVG_ELEMENTS.has(name[1].toLowerCase())) return false;
  // Attribute NAMES are read with the quoted values emptied, so a ">" or an
  // "onload=" inside a value is not mistaken for one.
  const names = tag.replace(/"[^"]*"|'[^']*'/g, '""');
  if (SVG_HANDLER_RE.test(names) || SVG_SRC_RE.test(names)) return false;
  SVG_HREF_RE.lastIndex = 0;
  for (let m = SVG_HREF_RE.exec(tag); m; m = SVG_HREF_RE.exec(tag)) {
    const target = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!target.startsWith('#')) return false;
  }
  return !unsafeCssEitherWay(tag);
}

// A tag, with quoted attribute values allowed to contain ">" (the HTML
// serialiser does not escape it there).
const SVG_TOKEN_RE = /<(?:[^<>"']|"[^"]*"|'[^']*')*>|[^<]+/gy;

/** The tags of an SVG and the text of its <style> elements, or null when it cannot be split reliably. */
function splitSvgMarkup(svg) {
  if (/<!--|<!\[CDATA\[|<\?/.test(svg)) return null;
  const tags = [];
  let style = '';
  let inStyle = false;
  let consumed = 0;
  SVG_TOKEN_RE.lastIndex = 0;
  for (let m = SVG_TOKEN_RE.exec(svg); m; m = SVG_TOKEN_RE.exec(svg)) {
    const token = m[0];
    consumed += token.length;
    if (token[0] === '<') {
      tags.push(token);
      if (/^<\s*(?:[\w.-]+:)?style\b/i.test(token) && !/\/>$/.test(token)) inStyle = true;
      else if (/^<\s*\/\s*(?:[\w.-]+:)?style\b/i.test(token)) inStyle = false;
    } else if (inStyle) {
      style += token;
    }
  }
  // Anything the tokens did not cover means the text is not what it seems.
  return consumed === svg.length ? { tags, style } : null;
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
