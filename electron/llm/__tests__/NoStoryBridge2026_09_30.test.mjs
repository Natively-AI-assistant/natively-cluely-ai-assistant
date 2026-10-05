// The no-story bridge is not part of the answer (2026-09-30).
//
// Asked for a story no evidence holds, candidates' answers opened "I don't have
// a specific failure story I can point to here, so let me answer it honestly
// in terms of how I handle it." — words no candidate says about their own
// career (spec: "do NOT say 'I don't have a story loaded'"). The prompt rule
// cut them from 12 to 4 of 120 dev replays; the preamble gate removes the rest.
// Only a PURE bridge goes: one that pivots to "so let me / I'll / here's".
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { stripPlanningPreamble, PreambleStreamGate } from '../../../dist-electron/electron/llm/planningPreamble.js';

const streamed = (text, step) => { const g = new PreambleStreamGate(); let out = ''; for (let i = 0; i < text.length; i += step) out += g.push(text.slice(i, i + step)); return out + g.flush(); };

const BRIDGED = [
  ["I don't have a specific failure story I can point to here, so let me answer it honestly in terms of how I handle it. When something goes wrong, my first move is to own it quickly.", 'When something goes wrong, my first move is to own it quickly.'],
  ["I don't have a specific blow-up story I'd want to hold up as an example, so let me tell you how I actually handle it when a disagreement with a manager doesn't land well. I keep it about the work, not the person.", 'I keep it about the work, not the person.'],
  ["I don't have a specific incident I can point to, so let me be straight about how I handle it when I do drop the ball. I own it early and directly.", 'I own it early and directly.'],
  ["I don't have a second specific failure story I can point to, so let me give you another angle on the same thing. The pattern I watch for is scope creep.", 'The pattern I watch for is scope creep.'],
  ["Honestly, I don't have a specific story from my background to pull from here, so here's how I operate under pressure. I get more deliberate, not less.", 'I get more deliberate, not less.'],
];
describe('a pure no-story bridge is removed', () => {
  for (const [input, want] of BRIDGED) {
    test(input.slice(0, 60), () => {
      assert.equal(stripPlanningPreamble(input).text, want);
      for (const step of [1, 3, 7, 40]) assert.equal(streamed(input, step).trim(), want, `step ${step}`);
    });
  }
});

describe('content-bearing or ordinary openings stay', () => {
  for (const keep of [
    "I don't have a specific example with Kubernetes, but I've run Nomad clusters for three years, so the scheduling model is familiar.",
    "I don't have any experience with Rust yet. I've been writing Go for six years.",
    "I don't have a strong preference between Postgres and MySQL here; for this workload either works.",
    'I once led a migration that slipped two weeks because I underestimated the data backfill.',
    "The biggest failure I learned from was shipping a cache without an invalidation plan.",
    "I don't have a story like that",
  ]) {
    test(keep.slice(0, 60), () => {
      assert.equal(stripPlanningPreamble(keep).text, keep);
      for (const step of [1, 5, 40]) assert.equal(streamed(keep, step), keep, `step ${step}`);
    });
  }
});
