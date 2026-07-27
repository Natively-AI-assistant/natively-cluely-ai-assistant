// scripts/lib/sd-interview-sim/mermaid.js
//
// Lightweight mermaid syntax check (soft). Invalid → syntaxValid=false;
// never aborts the interview.

'use strict';

const DIAGRAM_STARTERS = [
  'graph',
  'flowchart',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'mindmap',
  'timeline',
  'gitGraph',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
];

/**
 * Strip optional markdown fences and return the mermaid body.
 * @param {string} source
 * @returns {string}
 */
function stripFence(source) {
  const raw = String(source || '').trim();
  const fenced = raw.match(/^```(?:mermaid)?\s*\n?([\s\S]*?)\n?```$/i);
  return (fenced ? fenced[1] : raw).trim();
}

/**
 * Soft validity: known diagram keyword present + non-empty body +
 * roughly balanced brackets. Does not invoke the mermaid parser.
 *
 * @param {string} source
 * @returns {boolean}
 */
function checkMermaidSyntax(source) {
  const body = stripFence(source);
  if (!body) return false;

  const firstLine = body.split(/\r?\n/, 1)[0].trim();
  const hasStarter = DIAGRAM_STARTERS.some(
    (kw) => firstLine === kw || firstLine.startsWith(`${kw} `) || firstLine.startsWith(`${kw}\t`),
  );
  if (!hasStarter) return false;

  let depth = 0;
  for (const ch of body) {
    if (ch === '[' || ch === '{' || ch === '(') depth += 1;
    else if (ch === ']' || ch === '}' || ch === ')') {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  if (depth !== 0) return false;

  return true;
}

module.exports = { checkMermaidSyntax, stripFence };
