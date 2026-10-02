// Content-free timing marks for a diagram-bearing answer.
//
// What is recorded: a turn id, mark names, millisecond timestamps and a few
// numbers (durations, counts, a failure category). Never question text,
// answer text or Mermaid source.
//
// Marks, in the order a turn normally produces them:
//   request_accepted     the question was submitted / the action triggered
//   first_token          first provider token reached the renderer
//   first_text_visible   first characters actually painted (reveal is paced)
//   block_complete       a Mermaid block's closing fence ARRIVED (receipt)
//   block_revealed       the paced reveal reached that block (it becomes a card)
//   diagram_visible      the drawn image loaded on screen
//   answer_complete      the reveal finished and the row sealed
// plus per-diagram numbers: parseMs, renderMs, coldLoadMs, repairs,
// failureStage.
//
// Token arrival and paced reveal are separate marks on purpose: "time to
// diagram receipt" (block_complete − request_accepted) and "time to visible
// diagram" (diagram_visible − request_accepted) are different measurements.

/**
 * @param {{ max?: number }} [options]
 */
export function createDiagramTimingLog(options = {}) {
  const max = Number.isFinite(options.max) ? options.max : 40;
  /** @type {Map<string, { id: string, marks: Record<string, number>, numbers: Record<string, number | string> }>} */
  const turns = new Map();

  function entry(id) {
    let e = turns.get(id);
    if (!e) {
      e = { id, marks: {}, numbers: {} };
      turns.set(id, e);
      while (turns.size > max) {
        const oldest = turns.keys().next().value;
        if (oldest === undefined) break;
        turns.delete(oldest);
      }
    }
    return e;
  }

  return {
    /** Record a mark once per turn (the first occurrence wins). */
    mark(id, name, at) {
      if (!id || !name || !Number.isFinite(at)) return;
      const e = entry(String(id));
      if (e.marks[name] === undefined) e.marks[name] = at;
    },
    /** Record a number or category for a turn (last write wins). */
    set(id, name, value) {
      if (!id || !name) return;
      if (typeof value !== 'number' && typeof value !== 'string') return;
      entry(String(id)).numbers[name] = value;
    },
    /** Move a turn's marks to a new id (a pending question id → its answer row id). */
    rename(fromId, toId) {
      const from = turns.get(String(fromId));
      if (!from || !toId || fromId === toId) return;
      turns.delete(String(fromId));
      const to = entry(String(toId));
      for (const [k, v] of Object.entries(from.marks)) if (to.marks[k] === undefined) to.marks[k] = v;
      Object.assign(to.numbers, from.numbers);
    },
    get(id) {
      const e = turns.get(String(id));
      return e ? { id: e.id, marks: { ...e.marks }, numbers: { ...e.numbers } } : null;
    },
    all() {
      return [...turns.values()].map((e) => ({ id: e.id, marks: { ...e.marks }, numbers: { ...e.numbers } }));
    },
    /** Durations from request_accepted (or the earliest mark), in ms. */
    summary(id) {
      const e = turns.get(String(id));
      if (!e) return null;
      const origin = e.marks.request_accepted ?? Math.min(...Object.values(e.marks));
      if (!Number.isFinite(origin)) return null;
      const since = (name) => (e.marks[name] === undefined ? null : Math.round(e.marks[name] - origin));
      return {
        id: e.id,
        hasRequestMark: e.marks.request_accepted !== undefined,
        firstTokenMs: since('first_token'),
        firstTextVisibleMs: since('first_text_visible'),
        diagramReceivedMs: since('block_complete'),
        diagramRevealedMs: since('block_revealed'),
        diagramVisibleMs: since('diagram_visible'),
        answerCompleteMs: since('answer_complete'),
        ...e.numbers,
      };
    },
    clear() {
      turns.clear();
    },
  };
}

/** The window's one log. */
export const diagramTimings = createDiagramTimingLog();

/** p50 / p95 over a list of numbers (nearest-rank). Null for an empty list. */
export function percentiles(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  return { n: sorted.length, min: sorted[0], p50: at(50), p95: at(95), max: sorted[sorted.length - 1] };
}
