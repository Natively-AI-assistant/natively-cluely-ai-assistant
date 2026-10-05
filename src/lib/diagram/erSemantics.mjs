// Reads the MEANING of a Mermaid `erDiagram` (crow's-foot notation).
//
// Mermaid's parser says whether the text can be drawn. It does not say whether
// the drawing means what was intended, and the two classic slips are silent:
//
//   - an endpoint read the wrong way round. A relationship line has a marker at
//     each end, and each marker describes the entity NEXT TO IT, as seen from
//     the other entity. `CUSTOMER ||--o{ ORDER` says: one ORDER belongs to
//     exactly one CUSTOMER (the `||` beside CUSTOMER), and one CUSTOMER has
//     zero or many ORDERs (the `o{` beside ORDER);
//
//   - a solid (identifying) line used for every foreign key. Solid means the
//     child cannot be identified without the parent — the parent's key is part
//     of the child's key. A child with its own independent key is a
//     non-identifying relationship: a dashed line (`..`).
//
// This module parses the relationships and attribute blocks, turns each
// relationship into two plain sentences (one per reading direction), and
// reports the second slip when the diagram itself shows it. It never changes
// the diagram: a cardinality nobody stated cannot be recovered from the text,
// so nothing here guesses one.
//
// Pure and synchronous.

/** Marker beside the LEFT entity → how many of the left entity one right entity relates to. */
const LEFT_MARKERS = Object.freeze({ '||': [1, 1], '|o': [0, 1], '}o': [0, Infinity], '}|': [1, Infinity] });
/** Marker beside the RIGHT entity → how many of the right entity one left entity relates to. */
const RIGHT_MARKERS = Object.freeze({ '||': [1, 1], 'o|': [0, 1], 'o{': [0, Infinity], '|{': [1, Infinity] });

const ENTITY = String.raw`([A-Za-z_][\w-]*|"[^"\n]+")`;
const RELATION_RE = new RegExp(String.raw`^\s*${ENTITY}\s*(\|\||\|o|\}o|\}\|)\s*(--|\.\.)\s*(\|\||o\||o\{|\|\{)\s*${ENTITY}\s*(?::\s*(.+?))?\s*$`);
const BLOCK_OPEN_RE = new RegExp(String.raw`^\s*${ENTITY}(?:\s*\[[^\]\n]*\])?\s*\{\s*$`);
const ATTRIBUTE_RE = /^\s*([^\s"]+)\s+([^\s"]+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"[^"]*")?\s*$/;

const unquote = (name) => String(name).replace(/^"|"$/g, '');

/** "exactly one", "zero or one", "zero or many", "one or many". */
export function cardinalityWords([min, max]) {
  if (min === 1 && max === 1) return 'exactly one';
  if (min === 0 && max === 1) return 'zero or one';
  if (min === 0) return 'zero or many';
  return 'one or many';
}

/**
 * @param {string} source Mermaid erDiagram text
 * @returns {{ isEr: boolean, entities: Array<{ name: string, attributes: Array<{ type: string, name: string, keys: string[] }> }>, relationships: Array<object>, notes: string[] }}
 */
export function analyseErDiagram(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.find((l) => l.trim() && !l.trim().startsWith('%%')) || '';
  const out = { isEr: /^\s*erDiagram\b/.test(first), entities: [], relationships: [], notes: [] };
  if (!out.isEr) return out;

  const entities = new Map();
  const entity = (name) => {
    const key = unquote(name);
    if (!entities.has(key)) entities.set(key, { name: key, attributes: [], declared: false });
    return entities.get(key);
  };
  let open = null;
  for (const raw of lines.slice(lines.indexOf(first) + 1)) {
    // A comment starts at %% — unless that %% is inside a quoted attribute comment.
    const commentAt = (() => {
      for (let i = raw.indexOf('%%'); i !== -1; i = raw.indexOf('%%', i + 2)) {
        if ((raw.slice(0, i).match(/"/g) || []).length % 2 === 0) return i;
      }
      return -1;
    })();
    const line = commentAt === -1 ? raw : raw.slice(0, commentAt);
    if (!line.trim()) continue;
    if (open) {
      if (/^\s*\}\s*$/.test(line)) {
        open = null;
        continue;
      }
      const attr = ATTRIBUTE_RE.exec(line);
      if (attr) open.attributes.push({ type: attr[1], name: attr[2], keys: attr[3] ? attr[3].split(',').map((k) => k.trim()) : [] });
      continue;
    }
    const block = BLOCK_OPEN_RE.exec(line);
    if (block) {
      open = entity(block[1]);
      open.declared = true;
      continue;
    }
    const rel = RELATION_RE.exec(line);
    if (rel) {
      const left = entity(rel[1]);
      const right = entity(rel[5]);
      out.relationships.push({
        left: left.name,
        right: right.name,
        // How many LEFT per one RIGHT, and how many RIGHT per one LEFT.
        leftPerRight: LEFT_MARKERS[rel[2]],
        rightPerLeft: RIGHT_MARKERS[rel[4]],
        identifying: rel[3] === '--',
        label: rel[6] ? unquote(rel[6].trim()) : '',
      });
    }
  }

  // Which side is the child is only knowable in a one-to-many: the "many" side.
  // In a 1:1 or a many-to-many neither end is "the child", so nothing is said
  // (PROFILE ||--|| USER used to be told that USER was the child).
  const plain = (name) => String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
  // In a 1:1 the child is the side whose key is borrowed from the other — and
  // only when exactly one side says so.
  const borrowsKeyFrom = (name, other) => {
    const e = entities.get(name);
    return Boolean(e) && e.attributes.some((a) => a.keys.includes('PK') && a.keys.includes('FK') && plain(a.name).includes(plain(other)));
  };
  const childOf = (r) => {
    const rightMany = r.rightPerLeft[1] !== 1;
    const leftMany = r.leftPerRight[1] !== 1;
    if (rightMany && leftMany) return null;
    if (!rightMany && !leftMany) {
      const rightBorrows = borrowsKeyFrom(r.right, r.left);
      const leftBorrows = borrowsKeyFrom(r.left, r.right);
      if (rightBorrows === leftBorrows) return null;
      return rightBorrows ? { child: r.right, parent: r.left } : { child: r.left, parent: r.right };
    }
    return rightMany ? { child: r.right, parent: r.left } : { child: r.left, parent: r.right };
  };
  const parentsOf = new Map();
  for (const r of out.relationships) {
    const link = childOf(r);
    if (link) parentsOf.set(link.child, (parentsOf.get(link.child) || 0) + 1);
  }
  for (const r of out.relationships) {
    const link = childOf(r);
    if (!link) continue;
    const child = entities.get(link.child);
    if (!child.declared || child.attributes.length === 0) continue;
    const keyedColumns = child.attributes.filter((a) => a.keys.includes('PK') && a.keys.includes('FK'));
    const ownKey = child.attributes.some((a) => a.keys.includes('PK') && !a.keys.includes('FK'));
    // A key column borrowed from THIS parent: the only parent, or a column named after it.
    const keyedByThisParent = keyedColumns.length > 0
      && (parentsOf.get(link.child) === 1 || keyedColumns.some((a) => plain(a.name).includes(plain(link.parent))));
    if (r.identifying && keyedColumns.length === 0 && ownKey) {
      out.notes.push(`${child.name} has its own key, so its relationship to ${link.parent} is non-identifying: a dashed line (..), not a solid one.`);
    } else if (!r.identifying && keyedByThisParent && !ownKey) {
      out.notes.push(`${child.name}'s key includes ${link.parent}'s key, which makes the relationship identifying: a solid line (--).`);
    }
  }
  for (const e of entities.values()) {
    const pks = e.attributes.filter((a) => a.keys.includes('PK'));
    if (e.declared && e.attributes.length > 0 && pks.length === 0) out.notes.push(`No primary key is marked for ${e.name}.`);
  }
  out.entities = [...entities.values()].map((e) => ({ name: e.name, attributes: e.attributes }));
  return out;
}

/** Each relationship read in BOTH directions, as plain sentences. */
export function describeErDiagram(analysis) {
  if (!analysis || !analysis.isEr) return '';
  return analysis.relationships
    .map((r) => {
      const verb = r.label ? ` (${r.label})` : '';
      return `Each ${r.right} relates to ${cardinalityWords(r.leftPerRight)} ${r.left}; each ${r.left} relates to ${cardinalityWords(r.rightPerLeft)} ${r.right}${verb}.`;
    })
    .join(' ');
}
