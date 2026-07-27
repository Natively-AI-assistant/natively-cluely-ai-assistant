#!/usr/bin/env node
// scripts/sd-interview-sim-digest.js
//
// Post-hoc digest regenerate for existing T2 corpus JSON files.
//   node scripts/sd-interview-sim-digest.js traces/sd-interview-sim/t2-....json
//   npm run sd-interview-sim:digest -- traces/sd-interview-sim/t2-....json

'use strict';

const fs = require('fs');
const path = require('path');
const { writeCorpusDigest } = require('./lib/sd-interview-sim/digest');

function main() {
  const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (targets.length === 0) {
    console.error(
      'Usage: sd-interview-sim-digest <t2-*.json> [more.json...]\n' +
        'Writes paired <same-stem>.digest.md beside each JSON.',
    );
    process.exit(2);
  }

  let ok = 0;
  for (const target of targets) {
    const jsonPath = path.resolve(target);
    if (!fs.existsSync(jsonPath)) {
      console.error(`[digest] missing: ${jsonPath}`);
      process.exitCode = 1;
      continue;
    }
    const bundle = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const { path: digestPath } = writeCorpusDigest(bundle, { jsonPath });
    console.log(`[digest] wrote ${digestPath}`);
    ok += 1;
  }
  if (ok === 0) process.exitCode = 1;
}

main();
