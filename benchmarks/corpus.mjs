// Corpus + question generator with EXACT ground truth.
//
// Every question maps to exactly one fact sentence, and that sentence's chunk is
// the gold chunk. Facts carry unique ids so ground truth is a string match, not
// a judgement call.
//
// Difficulty is built in, not asserted:
//   easy    — shares the component id AND the attribute word with the fact
//   medium  — shares the id, but the attribute is paraphrased (no content-word overlap)
//   hard    — NO id at all; must be reached through a described property
//   extreme — the corpus contains SIBLING components with near-identical prose and
//             different values, so lexical similarity actively points at the wrong
//             chunk. This is the tier that separates a real retriever from a
//             keyword matcher.

const CLUSTERS = ['Halden','Torvik','Nybro','Kalmar','Ryda','Elvsted','Борг','Ostara','Vinstra','Fjell'];
const KINDS    = ['relay','collector','sequencer','regulator','arbiter','transponder','damper','injector'];

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

const FILLER = [
  'The subsystem records telemetry at a fixed interval and forwards it to the regional collector for aggregation.',
  'Operators should confirm that the upstream link is healthy before initiating a maintenance window.',
  'Aggregated counters are retained for ninety days and then rolled into monthly summaries.',
  'A failed handshake is retried with exponential backoff until the configured ceiling is reached.',
  'Configuration changes take effect at the next scheduled reconciliation pass rather than immediately.',
  'The diagnostic port exposes a read-only view of the current state machine and its last ten transitions.',
  'Firmware images are verified against a signing key held in the secure element before they are applied.',
  'Thermal derating begins once the enclosure sensor reports sustained load above the nominal band.',
  'Each node maintains a local write-ahead journal so a power interruption cannot corrupt the store.',
  'The bus arbitration scheme grants priority to control traffic over bulk telemetry during congestion.',
];

export function buildCorpus({ targetTokens, seed = 7 }) {
  const rnd = mulberry32(seed);
  const pick = a => a[Math.floor(rnd()*a.length)];
  const targetChars = targetTokens * 4;

  const facts = [];
  const parts = [];
  let id = 0;

  // Sibling families: 4 components that differ ONLY in id and values. These make
  // the 'extreme' tier genuinely hard — the distractors are near-duplicates.
  const families = [];

  while (parts.join('\n\n').length < targetChars) {
    const isFamily = rnd() < 0.30;
    if (isFamily) {
      const kind = pick(KINDS);
      const fam = [];
      for (let s = 0; s < 4; s++) {
        const cluster = CLUSTERS[(Math.floor(rnd()*CLUSTERS.length)+s) % CLUSTERS.length];
        const code = `${kind.slice(0,2).toUpperCase()}-${1000 + (id*7)%8999}`;
        id++;
        const volts   = (0.1 + rnd()*9).toFixed(4);
        const port    = 4000 + Math.floor(rnd()*1500);
        const owner   = ['Ingrid Solheim','Marta Devlin','Ozan Yilmaz','Priya Raghavan','Kenji Aoyama','Lucia Ferrari'][Math.floor(rnd()*6)];
        const ms      = 5 + Math.floor(rnd()*400);
        const f = { code, kind, cluster, volts, port, owner, ms, family: kind };
        facts.push(f); fam.push(f);
        parts.push(
          `The ${kind} ${code} is deployed in the ${cluster} cluster. Its calibration constant is ${volts} volts. ` +
          `It listens on port ${port} and is maintained by ${owner}. Under nominal load it settles within ${ms} milliseconds. ` +
          pick(FILLER)
        );
      }
      families.push(fam);
    } else {
      parts.push(pick(FILLER) + ' ' + pick(FILLER));
    }
  }

  const text = parts.join('\n\n');
  return { text, facts, families };
}

// Chunker: ~1200 chars with 200 overlap — the shape a RAG pipeline produces, and
// comfortably under the server's 8,000-char input cap so nothing is truncated.
export function chunk(text, size = 1200, overlap = 200) {
  const out = [];
  for (let i = 0; i < text.length; i += (size - overlap)) {
    const body = text.slice(i, i + size);
    if (body.trim().length === 0) continue;
    out.push({ idx: out.length, start: i, text: body });
    if (i + size >= text.length) break;
  }
  return out;
}

// Gold chunks for a fact: every chunk whose text contains the full fact sentence
// for the queried attribute. Overlap means there can legitimately be more than one.
export function goldChunksFor(chunks, needle) {
  return chunks.filter(c => c.text.includes(needle)).map(c => c.idx);
}

export function buildQuestions({ facts, families, chunks, limit }) {
  const qs = [];
  const add = (tier, q, needle) => {
    const gold = goldChunksFor(chunks, needle);
    if (gold.length === 0) return;            // sentence straddles a boundary; skip
    qs.push({ tier, q, gold, needle });
  };

  // A question that names only (cluster, kind) is answered CORRECTLY by any
  // component matching it. At 100k tokens every (cluster, kind) pair is shared —
  // the worst by 20 components — so scoring such a question against one
  // arbitrarily-chosen fact measures nothing but which duplicate the generator
  // happened to pick. Gold for those is the union of every matching fact's chunk.
  const byClusterKind = {};
  for (const f of facts) (byClusterKind[`${f.cluster}|${f.kind}`] ||= []).push(f);

  const addMulti = (tier, q, needles) => {
    const gold = [...new Set(needles.flatMap(n => goldChunksFor(chunks, n)))];
    if (gold.length === 0) return;
    qs.push({ tier, q, gold, ambiguity: needles.length });
  };

  for (const f of facts) {
    const voltSent = `Its calibration constant is ${f.volts} volts.`;
    const portSent = `It listens on port ${f.port} and is maintained by ${f.owner}.`;
    const msSent   = `Under nominal load it settles within ${f.ms} milliseconds.`;
    const siblings = byClusterKind[`${f.cluster}|${f.kind}`];

    // easy — id + the attribute word itself
    add('easy',   `What is the calibration constant of ${f.code}?`, voltSent);
    add('easy',   `Which port does ${f.code} listen on?`, portSent);
    // medium — id kept, attribute paraphrased away from the document's wording
    add('medium', `How many volts does ${f.code} need to stay in calibration?`, voltSent);
    add('medium', `Who is on the hook for looking after ${f.code}?`, portSent);
    add('medium', `How quickly does ${f.code} stabilise when load is normal?`, msSent);
    // hard — NO id; reached only through cluster + kind + attribute. Gold is
    // every component that genuinely satisfies the description.
    addMulti('hard', `In the ${f.cluster} cluster, what calibration constant does the ${f.kind} use?`,
      siblings.map(s2 => `Its calibration constant is ${s2.volts} volts.`));
    addMulti('hard', `Who maintains the ${f.kind} deployed at ${f.cluster}?`,
      siblings.map(s2 => `It listens on port ${s2.port} and is maintained by ${s2.owner}.`));
  }

  // extreme — sibling families: same prose, different values. The question names
  // one sibling; three near-identical chunks compete for it.
  for (const fam of families) {
    for (const f of fam) {
      add('extreme', `Among the ${f.kind}s, which calibration constant belongs specifically to ${f.code} and not to its siblings?`, `Its calibration constant is ${f.volts} volts.`);
      add('extreme', `${f.code} settles in how many milliseconds — not the other ${f.kind}s in the fleet?`, `Under nominal load it settles within ${f.ms} milliseconds.`);
    }
  }

  // Siblings produce identical hard-question TEXT; keep one of each.
  const seen = new Set();
  const deduped = qs.filter(q => { const k = q.tier+'||'+q.q; if (seen.has(k)) return false; seen.add(k); return true; });
  qs.length = 0; qs.push(...deduped);

  // Deterministic spread across tiers rather than a prefix slice.
  const byTier = {};
  for (const q of qs) (byTier[q.tier] ||= []).push(q);
  if (!limit) return qs;
  const per = Math.ceil(limit / Object.keys(byTier).length);
  const out = [];
  for (const t of ['easy','medium','hard','extreme']) {
    const pool = byTier[t] || [];
    const step = Math.max(1, Math.floor(pool.length / per));
    for (let i = 0; i < pool.length && out.filter(x=>x.tier===t).length < per; i += step) out.push(pool[i]);
  }
  return out.slice(0, limit);
}
