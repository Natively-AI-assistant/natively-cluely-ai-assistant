// Shared by the source-order tests in this folder: read a source file without
// its line comments, and cut out one method or one call block by matching
// braces (so an edit elsewhere in the file cannot change what is asserted).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** File contents with `//` line comments removed (not the `//` in a URL). */
export function readSource(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** From `start`, the text up to and including the brace that closes the first `{`. */
export function braceBlock(source, start) {
  const open = source.indexOf('{', start);
  assert.ok(open !== -1, 'no opening brace');
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote || ch === '\n') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unbalanced braces');
}

/** The declaration and body of a class method, by name. */
export function methodBody(source, name) {
  const match = new RegExp(`\\n\\s*(?:(?:public|private|protected|async)\\s+)*${name}\\(`).exec(source);
  assert.ok(match, `method not found: ${name}`);
  // Skip the parameter list: its default values and types can hold braces.
  let depth = 0;
  let i = match.index + match[0].length - 1;
  for (; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) break;
  }
  return source.slice(match.index, i) + braceBlock(source, i).slice(0);
}

/** A call block that starts at `marker`, e.g. one safeHandle(...) registration. */
export function blockFrom(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at !== -1, `marker not found: ${marker}`);
  return braceBlock(source, at);
}

/**
 * The text from `index` to where the code leaves `levels` enclosing blocks:
 * 1 = the rest of the block the index is in, 2 = that block and the rest of
 * the one around it. Quotes are skipped the same way braceBlock skips them.
 */
export function restOfBlocks(source, index, levels = 1) {
  let depth = 0;
  let quote = null;
  for (let i = index; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote || ch === '\n') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === -levels) return source.slice(index, i);
  }
  return source.slice(index);
}
