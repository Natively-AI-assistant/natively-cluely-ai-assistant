// Chen entity–relationship notation, drawn locally from a validated model.
//
// Mermaid's `erDiagram` is crow's-foot notation: entity boxes with attribute
// rows and cardinality marks on the line ends. Chen notation is a different
// drawing with different symbols, and Mermaid cannot draw most of them, so it
// is never passed off as Chen. This module takes a small semantic model and
// draws the real symbols:
//
//   entity                 rectangle
//   weak entity            double rectangle
//   relationship           diamond
//   identifying relation   double diamond
//   attribute              oval
//   key attribute          underlined name
//   partial key            dashed underline (the key of a weak entity)
//   multivalued attribute  double oval
//   derived attribute      dashed oval
//   composite attribute    an oval with its component ovals attached
//   total participation    double line between entity and relationship
//   cardinality            1 / N / M beside the entity's end of the line
//
// The model is checked before it is drawn: a relationship must name entities
// that exist, a weak entity must have an identifying relationship it takes
// part in totally, an identifying relationship must have a weak entity. A
// constraint nobody stated (a cardinality, a participation) is drawn WITHOUT
// the mark and listed under `unknowns` — it is never defaulted.
//
// Pure: no DOM. Layout is a simple deterministic one meant for the small
// models a conversation produces (up to eight entities).

import { estimateTextWidth, svgText, svgDocument, svgNum, truncateToWidth, clipText } from './svgText.mjs';

export const CHEN_SPEC_VERSION = 1;
export const CHEN_LIMITS = Object.freeze({ maxEntities: 8, maxRelationships: 8, maxAttributes: 8, maxComponents: 4, maxParticipants: 4, maxNameChars: 32 });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const name = (v) => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? clipText(String(v).replace(/\s+/g, ' ').trim(), CHEN_LIMITS.maxNameChars) : '');
const key = (v) => name(v).toLowerCase();

function fail(code, message) {
  return { ok: false, code, message };
}

function readAttributes(list, owner) {
  if (list === undefined || list === null) return { ok: true, attributes: [] };
  if (!Array.isArray(list)) return fail('syntax', 'The diagram data could not be read.');
  if (list.length > CHEN_LIMITS.maxAttributes) return fail('too_large', `"${owner}" has too many attributes to draw here.`);
  const attributes = [];
  const seen = new Set();
  for (const raw of list) {
    const a = typeof raw === 'string' ? { name: raw } : raw;
    if (!isObj(a) || !name(a.name)) return fail('syntax', `An attribute of "${owner}" has no name.`);
    if (seen.has(key(a.name))) return fail('duplicate', `"${owner}" lists the attribute "${name(a.name)}" twice.`);
    seen.add(key(a.name));
    const components = Array.isArray(a.components) ? a.components.map(name).filter(Boolean).slice(0, CHEN_LIMITS.maxComponents) : [];
    attributes.push({
      name: name(a.name),
      key: a.key === true,
      partialKey: a.partialKey === true,
      multivalued: a.multivalued === true,
      derived: a.derived === true,
      components,
    });
  }
  return { ok: true, attributes };
}

const CARDINALITIES = new Set(['1', 'N', 'M']);

/**
 * Validate a Chen ER model.
 *
 * @param {object} spec  parsed `natively-diagram` payload with kind "chen-er"
 * @returns {{ ok: true, model: object } | { ok: false, code: string, message: string }}
 */
export function validateChenEr(spec) {
  if (!isObj(spec)) return fail('syntax', 'The diagram data could not be read.');
  const rawEntities = Array.isArray(spec.entities) ? spec.entities : [];
  if (rawEntities.length === 0) return fail('missing_input', 'There are no entities to draw.');
  if (rawEntities.length > CHEN_LIMITS.maxEntities) return fail('too_large', 'This model has too many entities to draw here.');

  const entities = [];
  const byKey = new Map();
  for (const raw of rawEntities) {
    const e = typeof raw === 'string' ? { name: raw } : raw;
    if (!isObj(e) || !name(e.name)) return fail('syntax', 'An entity has no name.');
    if (byKey.has(key(e.name))) return fail('duplicate', `The entity "${name(e.name)}" appears twice.`);
    const attrs = readAttributes(e.attributes, name(e.name));
    if (!attrs.ok) return attrs;
    const entity = { name: name(e.name), weak: e.weak === true, attributes: attrs.attributes };
    byKey.set(key(e.name), entity);
    entities.push(entity);
  }

  const rawRelationships = Array.isArray(spec.relationships) ? spec.relationships : [];
  if (rawRelationships.length > CHEN_LIMITS.maxRelationships) return fail('too_large', 'This model has too many relationships to draw here.');
  const relationships = [];
  const unknowns = [];
  for (const raw of rawRelationships) {
    if (!isObj(raw) || !name(raw.name)) return fail('syntax', 'A relationship has no name.');
    const relName = name(raw.name);
    const parts = Array.isArray(raw.participants) ? raw.participants : [];
    if (parts.length < 2) return fail('bad_relationship', `"${relName}" must connect at least two entities.`);
    if (parts.length > CHEN_LIMITS.maxParticipants) return fail('too_large', `"${relName}" connects too many entities to draw here.`);
    const participants = [];
    for (const rawPart of parts) {
      const p = typeof rawPart === 'string' ? { entity: rawPart } : rawPart;
      if (!isObj(p)) return fail('syntax', 'The diagram data could not be read.');
      const entity = byKey.get(key(p.entity));
      if (!entity) return fail('unknown_entity', `"${relName}" refers to "${name(p.entity) || '?'}", which is not one of the entities.`);
      const cardinality = String(p.cardinality ?? '').trim().toUpperCase();
      const participation = p.participation === 'total' || p.participation === 'partial' ? p.participation : 'unknown';
      if (cardinality && !CARDINALITIES.has(cardinality)) return fail('bad_cardinality', `"${relName}" gives "${entity.name}" a cardinality that is not 1, N or M.`);
      if (!cardinality) unknowns.push(`Cardinality of ${entity.name} in "${relName}"`);
      if (participation === 'unknown') unknowns.push(`Whether every ${entity.name} takes part in "${relName}"`);
      participants.push({ entity: entity.name, cardinality, participation, role: name(p.role) });
    }
    const attrs = readAttributes(raw.attributes, relName);
    if (!attrs.ok) return attrs;
    relationships.push({ name: relName, identifying: raw.identifying === true, participants, attributes: attrs.attributes });
  }

  // Weak entities and identifying relationships define each other.
  const notes = [];
  for (const rel of relationships) {
    if (!rel.identifying) continue;
    const weak = rel.participants.filter((p) => byKey.get(key(p.entity)).weak);
    if (weak.length === 0) return fail('identifying_without_weak', `"${rel.name}" is marked identifying but none of its entities is a weak entity.`);
    // The owner is a strong entity — or a weak one that is itself identified
    // by another relationship (Building → Floor → Room).
    const hasOwner = rel.participants.some((p) => {
      const e = byKey.get(key(p.entity));
      if (!e.weak) return true;
      return relationships.some((other) => other !== rel && other.identifying && other.participants.some((q) => key(q.entity) === key(e.name)));
    });
    if (!hasOwner) return fail('identifying_without_owner', `"${rel.name}" is marked identifying but has no owner entity.`);
  }
  for (const entity of entities) {
    if (entity.weak) {
      const owning = relationships.filter((r) => r.identifying && r.participants.some((p) => key(p.entity) === key(entity.name)));
      if (owning.length === 0) return fail('weak_without_owner', `"${entity.name}" is a weak entity but has no identifying relationship to an owner.`);
      // A weak entity exists only through its owner: its participation is total by definition.
      for (const rel of owning) {
        for (const p of rel.participants) {
          if (key(p.entity) === key(entity.name) && p.participation !== 'total') {
            if (p.participation === 'partial') return fail('weak_must_be_total', `A weak entity always takes part in its identifying relationship; "${entity.name}" cannot be optional in "${rel.name}".`);
            p.participation = 'total';
            const at = unknowns.indexOf(`Whether every ${entity.name} takes part in "${rel.name}"`);
            if (at !== -1) unknowns.splice(at, 1);
          }
        }
      }
      if (!entity.attributes.some((a) => a.partialKey)) notes.push(`"${entity.name}" is a weak entity with no partial key stated.`);
      if (entity.attributes.some((a) => a.key)) return fail('weak_with_full_key', `"${entity.name}" is a weak entity, so it has a partial key, not a full key of its own.`);
    } else {
      if (entity.attributes.some((a) => a.partialKey)) return fail('partial_key_on_strong', `"${entity.name}" has a partial key but is not a weak entity.`);
      if (entity.attributes.length > 0 && !entity.attributes.some((a) => a.key)) notes.push(`No key was stated for "${entity.name}".`);
    }
  }
  for (const rel of relationships) {
    const names = rel.participants.map((p) => key(p.entity));
    if (new Set(names).size !== names.length && rel.participants.some((p) => !p.role)) {
      notes.push(`"${rel.name}" relates ${rel.participants[0].entity} to itself; the two roles were not named.`);
    }
  }

  return { ok: true, model: { v: CHEN_SPEC_VERSION, title: name(spec.title), entities, relationships, unknowns, notes } };
}

/** Plain sentences for a screen reader, the phone and the constraint notes. */
export function describeChenEr(model) {
  const lines = [];
  for (const e of model.entities) {
    const keys = e.attributes.filter((a) => a.key || a.partialKey).map((a) => a.name);
    lines.push(`${e.weak ? 'Weak entity' : 'Entity'} ${e.name}${keys.length ? ` (${e.weak ? 'partial key' : 'key'} ${keys.join(', ')})` : ''}.`);
  }
  for (const r of model.relationships) {
    const parts = r.participants.map((p) => {
      const count = p.cardinality === '1' ? 'one' : p.cardinality ? 'many' : 'an unstated number of';
      const must = p.participation === 'total' ? ', and every one takes part' : p.participation === 'partial' ? ', and taking part is optional' : '';
      return `${count} ${p.entity}${p.role ? ` as ${p.role}` : ''}${must}`;
    });
    lines.push(`${r.identifying ? 'Identifying relationship' : 'Relationship'} "${r.name}" connects ${parts.join('; ')}.`);
  }
  return lines.join(' ');
}

// ── layout ──────────────────────────────────────────────────────────────────

const FONT = 12;
const ENTITY_H = 36;
const OVAL_RY = 15;
const ATTR_ROW = 40;
const ATTR_GAP = 10;
const COLUMN_GAP = 34;
const DIAMOND_H = 46;

const entityWidth = (e) => Math.max(84, Math.ceil(estimateTextWidth(e.name, 13, 600)) + 30);
const ovalRx = (label) => Math.max(30, Math.ceil(estimateTextWidth(label, FONT) / 2) + 15);
const diamondWidth = (r) => Math.max(96, Math.ceil(estimateTextWidth(r.name, FONT) * 1.5) + 40);

/** Entities in an order that keeps related ones next to each other. */
function orderEntities(model) {
  const adjacency = new Map(model.entities.map((e) => [e.name, new Set()]));
  for (const r of model.relationships) {
    for (const a of r.participants) for (const b of r.participants) if (a.entity !== b.entity) adjacency.get(a.entity).add(b.entity);
  }
  const order = [];
  const placed = new Set();
  const byDegree = [...model.entities].sort((a, b) => adjacency.get(a.name).size - adjacency.get(b.name).size);
  const start = byDegree.find((e) => adjacency.get(e.name).size > 0) || model.entities[0];
  let current = start.name;
  while (order.length < model.entities.length) {
    if (!placed.has(current)) {
      order.push(current);
      placed.add(current);
    }
    const next = [...adjacency.get(current)].find((n) => !placed.has(n))
      || order.flatMap((n) => [...adjacency.get(n)]).find((n) => !placed.has(n))
      || (model.entities.find((e) => !placed.has(e.name)) || {}).name;
    if (!next) break;
    current = next;
  }
  return order.map((n) => model.entities.find((e) => e.name === n));
}

/** Attribute ovals for one owner, laid out in rows relative to (0, 0) = the owner's anchor. `dir` -1 = above, +1 = below. */
function layoutAttributes(attributes, dir) {
  const cells = attributes.map((a) => {
    const rx = ovalRx(a.name);
    const comps = a.components.map((c) => ({ name: c, rx: ovalRx(c) }));
    const compsWidth = comps.reduce((sum, c) => sum + c.rx * 2, 0) + Math.max(0, comps.length - 1) * ATTR_GAP;
    return { attr: a, rx, comps, width: Math.max(rx * 2, compsWidth) };
  });
  const perRow = cells.length <= 3 ? cells.length : Math.ceil(cells.length / 2);
  const rows = [];
  for (let i = 0; i < cells.length; i += perRow) rows.push(cells.slice(i, i + perRow));
  const placed = [];
  let width = 0;
  let extent = 0;
  rows.forEach((row, r) => {
    const rowWidth = row.reduce((sum, c) => sum + c.width, 0) + Math.max(0, row.length - 1) * ATTR_GAP;
    width = Math.max(width, rowWidth);
    // Rows nearer the owner are offset by the composite rows of the rows before them.
    const hasComps = row.some((c) => c.comps.length > 0);
    const y = dir * (34 + extent);
    let x = -rowWidth / 2;
    for (const cell of row) {
      const cx = x + cell.width / 2;
      const item = { attr: cell.attr, cx, cy: y, rx: cell.rx, comps: [] };
      if (cell.comps.length) {
        const total = cell.comps.reduce((sum, c) => sum + c.rx * 2, 0) + (cell.comps.length - 1) * ATTR_GAP;
        let compX = cx - total / 2;
        for (const comp of cell.comps) {
          item.comps.push({ name: comp.name, cx: compX + comp.rx, cy: y + dir * ATTR_ROW, rx: comp.rx });
          compX += comp.rx * 2 + ATTR_GAP;
        }
      }
      placed.push(item);
      x += cell.width + ATTR_GAP;
    }
    extent += ATTR_ROW + (hasComps ? ATTR_ROW : 0);
    void r;
  });
  return { placed, width, extent: cells.length ? 34 + extent - ATTR_ROW + OVAL_RY + 6 : 0 };
}

function oval(cx, cy, rx, attr, colors, isComponent = false) {
  const out = [];
  const dash = attr.derived ? ' stroke-dasharray="5 3"' : '';
  const cls = ['chen-attribute', attr.derived ? 'chen-derived' : '', attr.multivalued ? 'chen-multivalued' : '', isComponent ? 'chen-component' : ''].filter(Boolean).join(' ');
  out.push(`<ellipse class="${cls}" cx="${svgNum(cx)}" cy="${svgNum(cy)}" rx="${rx}" ry="${OVAL_RY}" fill="${colors.nodeFill}" stroke="${colors.stroke}" stroke-width="1.2"${dash}/>`);
  if (attr.multivalued) out.push(`<ellipse class="chen-multivalued-inner" cx="${svgNum(cx)}" cy="${svgNum(cy)}" rx="${rx - 4}" ry="${OVAL_RY - 4}" fill="none" stroke="${colors.stroke}" stroke-width="1.2"/>`);
  const label = truncateToWidth(attr.name, rx * 2 - 14, FONT);
  out.push(svgText(cx, cy + 4, label, { size: FONT, fill: colors.text, anchor: 'middle' }));
  if (attr.key || attr.partialKey) {
    const w = estimateTextWidth(label, FONT);
    out.push(`<line class="${attr.key ? 'chen-key-underline' : 'chen-partial-key-underline'}" x1="${svgNum(cx - w / 2)}" y1="${svgNum(cy + 7)}" x2="${svgNum(cx + w / 2)}" y2="${svgNum(cy + 7)}" stroke="${colors.text}" stroke-width="1.1"${attr.partialKey ? ' stroke-dasharray="3 2"' : ''}/>`);
  }
  return out.join('');
}

function connector(x1, y1, x2, y2, colors, double, cls) {
  if (!double) return `<line class="${cls}" x1="${svgNum(x1)}" y1="${svgNum(y1)}" x2="${svgNum(x2)}" y2="${svgNum(y2)}" stroke="${colors.stroke}" stroke-width="1.2"/>`;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = (-(y2 - y1) / len) * 2.3;
  const ny = ((x2 - x1) / len) * 2.3;
  return [1, -1]
    .map((s) => `<line class="${cls} chen-total" x1="${svgNum(x1 + nx * s)}" y1="${svgNum(y1 + ny * s)}" x2="${svgNum(x2 + nx * s)}" y2="${svgNum(y2 + ny * s)}" stroke="${colors.stroke}" stroke-width="1.2"/>`)
    .join('');
}

const DEFAULT_COLORS = Object.freeze({ text: '#111827', muted: '#4b5563', nodeFill: '#f3f4f6', stroke: '#6b7280', groupFill: '#f9fafb', accent: '#2563eb', dark: false });

/**
 * Draw a validated Chen model.
 *
 * @returns {{ svg: string, width: number, height: number }}
 */
export function renderChenErSvg(model, colors = DEFAULT_COLORS) {
  // Laid out once to see how far left it reaches (a relationship of an entity
  // with itself, or one hung under the first column, can extend past x = 0),
  // then once more starting that much further right. Nothing is clipped.
  const first = layoutChenEr(model, colors, 16);
  if (first.left >= 0) return { svg: first.svg, width: first.width, height: first.height };
  const shifted = layoutChenEr(model, colors, 16 + Math.ceil(-first.left) + 8);
  return { svg: shifted.svg, width: shifted.width, height: shifted.height };
}

function layoutChenEr(model, colors, originX) {
  const ordered = orderEntities(model);
  const index = new Map(ordered.map((e, i) => [e.name, i]));

  // Which relationships sit between two neighbouring entities on the entity row.
  const inline = new Map(); // gap index → relationship
  const below = [];
  for (const rel of model.relationships) {
    const distinct = [...new Set(rel.participants.map((p) => p.entity))];
    if (rel.participants.length === 2 && distinct.length === 2) {
      const [a, b] = distinct.map((n) => index.get(n)).sort((x, y) => x - y);
      if (b - a === 1 && !inline.has(a)) {
        inline.set(a, rel);
        continue;
      }
    }
    below.push(rel);
  }

  const attrLayouts = ordered.map((e) => layoutAttributes(e.attributes, -1));
  const widths = ordered.map((e, i) => Math.max(entityWidth(e), attrLayouts[i].width));
  const topExtent = Math.max(0, ...attrLayouts.map((l) => l.extent));
  const titleH = model.title ? 26 : 0;
  const entityY = titleH + 12 + topExtent + ENTITY_H / 2;

  // Column centres. Each entity is centred over its own attributes; the gap
  // between two columns is widened when a relationship sits in it.
  const centres = [];
  let x = originX;
  ordered.forEach((e, i) => {
    x += widths[i] / 2;
    centres.push(x);
    x += widths[i] / 2;
    if (i === ordered.length - 1) return;
    const rel = inline.get(i);
    let gap = COLUMN_GAP;
    if (rel) {
      const needed = Math.max(diamondWidth(rel), layoutAttributes(rel.attributes, 1).width) + 56;
      const slack = (widths[i] - entityWidth(e)) / 2 + (widths[i + 1] - entityWidth(ordered[i + 1])) / 2;
      gap = Math.max(COLUMN_GAP, needed - slack);
    }
    x += gap;
  });
  let width = x + 16;

  const lines = [];
  const shapes = [];
  const labels = [];
  let bottom = entityY + ENTITY_H / 2;
  // The furthest left anything reaches (see renderChenErSvg).
  let left = 0;
  const reach = (x0, x1) => {
    left = Math.min(left, x0);
    width = Math.max(width, x1 + 16);
  };

  // `side` (+1 / -1) picks which side of the line the labels sit on, so the two
  // ends of a relationship between an entity and itself do not collide.
  const drawParticipant = (rel, p, dx, dy, ex, ey, side = 1) => {
    lines.push(connector(ex, ey, dx, dy, colors, p.participation === 'total', 'chen-link'));
    // The cardinality sits near the ENTITY's end of the line, off to one side.
    const len = Math.hypot(dx - ex, dy - ey) || 1;
    const nx = (-(dy - ey) / len) * side;
    const ny = ((dx - ex) / len) * side;
    if (p.cardinality) {
      labels.push(svgText(ex + (dx - ex) * 0.3 + nx * 10, ey + (dy - ey) * 0.3 + ny * 10 + 4, p.cardinality, { size: 11.5, weight: 600, fill: colors.text, anchor: 'middle', cls: 'chen-cardinality' }));
    }
    if (p.role) {
      const w = estimateTextWidth(p.role, 10.5);
      const roleX = ex + (dx - ex) * 0.66 + nx * (8 + w / 2);
      reach(roleX - w / 2 - 4, roleX + w / 2 + 4);
      labels.push(svgText(roleX, ey + (dy - ey) * 0.66 + ny * 8 + 4, p.role, { size: 10.5, italic: true, fill: colors.muted, anchor: 'middle', cls: 'chen-role' }));
    }
  };

  const noteBottom = (y) => {
    bottom = Math.max(bottom, y);
  };

  const drawDiamond = (rel, cx, cy) => {
    const w = diamondWidth(rel);
    const pts = (inset) => `${svgNum(cx - w / 2 + inset * 1.7)},${svgNum(cy)} ${svgNum(cx)},${svgNum(cy - DIAMOND_H / 2 + inset)} ${svgNum(cx + w / 2 - inset * 1.7)},${svgNum(cy)} ${svgNum(cx)},${svgNum(cy + DIAMOND_H / 2 - inset)}`;
    shapes.push(`<polygon class="chen-relationship${rel.identifying ? ' chen-identifying' : ''}" points="${pts(0)}" fill="${colors.nodeFill}" stroke="${colors.stroke}" stroke-width="1.2"/>`);
    if (rel.identifying) shapes.push(`<polygon class="chen-identifying-inner" points="${pts(4.5)}" fill="none" stroke="${colors.stroke}" stroke-width="1.2"/>`);
    shapes.push(svgText(cx, cy + 4, truncateToWidth(rel.name, w * 0.62, FONT), { size: FONT, fill: colors.text, anchor: 'middle' }));
    // Attributes of the relationship hang below it.
    const layout = layoutAttributes(rel.attributes, 1);
    for (const item of layout.placed) {
      lines.push(connector(cx, cy, cx + item.cx, cy + DIAMOND_H / 2 - 10 + item.cy, colors, false, 'chen-attribute-link'));
      shapes.push(oval(cx + item.cx, cy + DIAMOND_H / 2 - 10 + item.cy, item.rx, item.attr, colors));
      for (const comp of item.comps) {
        lines.push(connector(cx + item.cx, cy + DIAMOND_H / 2 - 10 + item.cy, cx + comp.cx, cy + DIAMOND_H / 2 - 10 + comp.cy, colors, false, 'chen-attribute-link'));
        shapes.push(oval(cx + comp.cx, cy + DIAMOND_H / 2 - 10 + comp.cy, comp.rx, { name: comp.name }, colors, true));
      }
    }
    noteBottom(cy + DIAMOND_H / 2);
    for (const item of layout.placed) {
      noteBottom(cy + DIAMOND_H / 2 - 10 + item.cy + OVAL_RY);
      for (const comp of item.comps) noteBottom(cy + DIAMOND_H / 2 - 10 + comp.cy + OVAL_RY);
    }
    reach(cx - Math.max(w, layout.width) / 2 - 8, cx + Math.max(w, layout.width) / 2);
  };

  // Entities and their attributes.
  ordered.forEach((e, i) => {
    const cx = centres[i];
    const w = entityWidth(e);
    for (const item of attrLayouts[i].placed) {
      lines.push(connector(cx, entityY, cx + item.cx, entityY - ENTITY_H / 2 + 10 + item.cy, colors, false, 'chen-attribute-link'));
      shapes.push(oval(cx + item.cx, entityY - ENTITY_H / 2 + 10 + item.cy, item.rx, item.attr, colors));
      for (const comp of item.comps) {
        lines.push(connector(cx + item.cx, entityY - ENTITY_H / 2 + 10 + item.cy, cx + comp.cx, entityY - ENTITY_H / 2 + 10 + comp.cy, colors, false, 'chen-attribute-link'));
        shapes.push(oval(cx + comp.cx, entityY - ENTITY_H / 2 + 10 + comp.cy, comp.rx, { name: comp.name }, colors, true));
      }
    }
    shapes.push(`<rect class="chen-entity${e.weak ? ' chen-weak' : ''}" x="${svgNum(cx - w / 2)}" y="${svgNum(entityY - ENTITY_H / 2)}" width="${w}" height="${ENTITY_H}" fill="${colors.nodeFill}" stroke="${colors.stroke}" stroke-width="1.3"/>`);
    if (e.weak) shapes.push(`<rect class="chen-weak-inner" x="${svgNum(cx - w / 2 + 4)}" y="${svgNum(entityY - ENTITY_H / 2 + 4)}" width="${w - 8}" height="${ENTITY_H - 8}" fill="none" stroke="${colors.stroke}" stroke-width="1.2"/>`);
    shapes.push(svgText(cx, entityY + 4.5, e.name, { size: 13, weight: 600, fill: colors.text, anchor: 'middle' }));
  });

  // Relationships on the entity row.
  for (const [gap, rel] of inline) {
    const leftEdge = centres[gap] + entityWidth(ordered[gap]) / 2;
    const rightEdge = centres[gap + 1] - entityWidth(ordered[gap + 1]) / 2;
    const cx = (leftEdge + rightEdge) / 2;
    const w = diamondWidth(rel);
    for (const p of rel.participants) {
      const i = index.get(p.entity);
      const ex = i === gap ? leftEdge : rightEdge;
      const dx = i === gap ? cx - w / 2 : cx + w / 2;
      drawParticipant(rel, p, dx, entityY, ex, entityY);
    }
    drawDiamond(rel, cx, entityY);
  }

  // Everything else goes underneath, one row per relationship that would collide.
  const rowsUsed = [];
  for (const rel of below) {
    const xs = rel.participants.map((p) => centres[index.get(p.entity)]);
    const distinct = new Set(rel.participants.map((p) => p.entity)).size;
    const cx = xs.reduce((sum, v) => sum + v, 0) / xs.length;
    const w = diamondWidth(rel);
    let row = 0;
    while (rowsUsed[row] && rowsUsed[row].some(([a, b]) => cx - w / 2 < b + 20 && cx + w / 2 > a - 20)) row += 1;
    (rowsUsed[row] ||= []).push([cx - w / 2, cx + w / 2]);
    const cy = entityY + ENTITY_H / 2 + 62 + row * 92;
    rel.participants.forEach((p, k) => {
      const i = index.get(p.entity);
      // A relationship of an entity with itself leaves from two points on the entity.
      const spread = distinct < rel.participants.length ? (k - (rel.participants.length - 1) / 2) * Math.min(40, entityWidth(ordered[i]) / 2.4) : 0;
      const recursive = distinct < rel.participants.length;
      drawParticipant(rel, p, cx + spread * 0.6, cy - (recursive ? DIAMOND_H / 4 : DIAMOND_H / 2), centres[i] + spread, entityY + ENTITY_H / 2, recursive && spread < 0 ? 1 : recursive ? -1 : 1);
    });
    drawDiamond(rel, cx, cy);
  }

  const height = bottom + 16;
  const title = model.title ? svgText(16, 20, truncateToWidth(model.title, width - 32, 13.5, 600), { size: 13.5, weight: 600, fill: colors.text }) : '';
  return {
    svg: svgDocument(width, height, `${title}${lines.join('')}${shapes.join('')}${labels.join('')}`, { title: model.title || 'Entity–relationship diagram (Chen notation)', kind: 'chen-er' }),
    width: Math.ceil(width),
    height: Math.ceil(height),
    left,
  };
}
