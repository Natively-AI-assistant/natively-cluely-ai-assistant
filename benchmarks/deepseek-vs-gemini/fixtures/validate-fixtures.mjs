// benchmarks/deepseek-vs-gemini/fixtures/validate-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateFixtureFile(filePath, expectedCategory) {
  const errors = [];
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return { valid: false, errors: [`could not read/parse: ${err.message}`] };
  }
  if (!Array.isArray(entries)) return { valid: false, errors: ['top level must be an array'] };

  const seenIds = new Set();
  for (const [i, entry] of entries.entries()) {
    for (const field of ['id', 'category', 'context', 'question', 'rubric_notes']) {
      if (!entry[field] || typeof entry[field] !== 'string' || !entry[field].trim()) {
        errors.push(`entry ${i}: missing/empty required field "${field}"`);
      }
    }
    if (entry.category && entry.category !== expectedCategory) {
      errors.push(`entry ${i} (${entry.id}): category "${entry.category}" !== expected "${expectedCategory}"`);
    }
    if (entry.id) {
      if (seenIds.has(entry.id)) errors.push(`duplicate id "${entry.id}"`);
      seenIds.add(entry.id);
    }
  }
  return { valid: errors.length === 0, errors };
}

// CLI mode: validate all five open-ended fixture files.
if (import.meta.url === `file://${process.argv[1]}`) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const files = [
    ['meeting.json', 'meeting'],
    ['technical-interview.json', 'technical-interview'],
    ['sales.json', 'sales'],
    ['recruiting.json', 'recruiting'],
    ['general.json', 'general'],
  ];
  let allValid = true;
  for (const [file, category] of files) {
    const result = validateFixtureFile(path.join(__dirname, file), category);
    const entries = JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8'));
    console.log(`${file}: ${entries.length} entries — ${result.valid ? 'OK' : 'INVALID'}`);
    if (!result.valid) {
      allValid = false;
      for (const e of result.errors) console.log(`  - ${e}`);
    }
  }
  process.exit(allValid ? 0 : 1);
}
