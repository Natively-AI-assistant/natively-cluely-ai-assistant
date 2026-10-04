// I11+I14 replay: status="expired|outdated|draft" on each evidence block from its own text (detectDocumentStatus,
// bundled from the app source), the precedence sentences in the system prompt, and the TODAY line.
// The bundle is generated, not committed: npx esbuild <app>/electron/context-intelligence/retrieval/mode-retrieval-port.ts
//   --bundle --platform=node --format=esm --external:electron --outfile=tools/variants/_mrp-bundle.mjs
import { detectDocumentStatus } from './_mrp-bundle.mjs';
import { transform as today } from './today-v1.mjs';
const NOW = new Date(2026, 8, 30);
const PRECEDENCE = '# Source precedence\nEvidence items carry a status="…" attribute from their own document. When two sources disagree on a value, the one whose status is current/active takes precedence over retired/superseded/legacy/deprecated/archived. If asked WHY a value was chosen, explain it from those statuses and source_name attributes — never invent a mechanism (environment overrides, deploy order) the evidence does not state. A status of expired or outdated means that document\'s values may no longer hold, even when nothing contradicts it: when you use one, say where it comes from and that it needs confirming ("that\'s from the 2025 partner sheet, which ran through December, so let me confirm today\'s price"), and prefer a current source that disagrees. A draft\'s decisions are proposed, not settled: present them that way.';
export function transform({ system, user, item }) {
  let marked = false;
  const u = user.replace(/<evidence ([^>]*)>\n([\s\S]*?)<\/evidence>/g, (all, attrs, body) => {
    if (/\bstatus="/.test(attrs)) return all;
    const st = detectDocumentStatus(body, NOW);
    if (!st) return all;
    marked = true;
    return `<evidence ${attrs} status="${st}">\n${body}</evidence>`;
  });
  let sys = system;
  if (marked) sys = sys.includes('# Source precedence') ? sys.replace(/# Source precedence\n[^\n]*/, PRECEDENCE) : `${sys}\n\n${PRECEDENCE}`;
  return today({ system: sys, user: u, item });
}
