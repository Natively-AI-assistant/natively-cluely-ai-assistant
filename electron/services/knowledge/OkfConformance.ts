// electron/services/knowledge/OkfConformance.ts
//
// OKF v0.1 conformance checker. Per docs/investigations/okf-official-spec-notes.md:
//   1. Every non-reserved .md file has parseable YAML frontmatter.
//   2. Every frontmatter block has a non-empty `type` field.
//   3. Reserved index.md/log.md follow their intended structure when present.
// Consumers (and so this checker) MUST NOT fail a bundle for missing optional
// fields, unknown type values, unknown extra frontmatter keys, broken links,
// or missing nested index.md files — only the 3 rules above are enforced.

import type { ConformanceResult } from './types';

export interface BundleFile {
  /** Bundle-relative path, e.g. "thesis/openvla-oft.md" or "index.md". */
  path: string;
  content: string;
}

const RESERVED_NAMES = new Set(['index.md', 'log.md']);

function isReserved(path: string): boolean {
  const base = path.split('/').pop() || '';
  return RESERVED_NAMES.has(base);
}

function parseFrontmatter(content: string): { frontmatter: string | null; body: string } {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { frontmatter: null, body: content };
  }
  const end = content.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: null, body: content };
  const frontmatter = content.slice(4, end);
  const bodyStart = content.indexOf('\n', end + 4);
  const body = bodyStart === -1 ? '' : content.slice(bodyStart + 1);
  return { frontmatter, body };
}

/** Minimal YAML key extraction sufficient for conformance checking (not a full YAML parser). */
function extractYamlField(frontmatter: string, key: string): string | null {
  const re = new RegExp(`^${key}:\\s*(.*)$`, 'm');
  const m = frontmatter.match(re);
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, '');
}

/**
 * Line-level structural check for the ONE class of frontmatter breakage this
 * codebase's exporter is known to have been able to produce prior to the
 * 2026-07-01 fix in OkfMarkdownExporter.yamlEscapeScalar (an unquoted plain
 * scalar value ending in a bare colon, e.g. `title: 3.4.1 Definitions:`,
 * which real YAML parsers — verified against js-yaml — reject with "bad
 * indentation of a mapping entry"). This is NOT a full YAML parser and does
 * not attempt to validate general YAML syntax (multi-line block scalars,
 * anchors, nested mappings, etc. are all out of scope per the spec's
 * intentionally-minimal design) — it exists specifically so this checker
 * doesn't rubber-stamp the one concrete non-conformant shape this exporter
 * could produce before the source-level fix, as defense-in-depth against a
 * future regression or a third-party producer emitting the same shape.
 */
function hasUnquotedTrailingColonValue(frontmatter: string): boolean {
  for (const line of frontmatter.split('\n')) {
    const m = line.match(/^[A-Za-z_][\w-]*:\s+(.*)$/);
    if (!m) continue;
    const value = m[1];
    if (!value) continue;
    const firstChar = value[0];
    const isQuotedOrBracketed = firstChar === '"' || firstChar === "'" || firstChar === '[' || firstChar === '{';
    if (!isQuotedOrBracketed && /:\s*$/.test(value)) return true;
  }
  return false;
}

export function checkConformance(files: BundleFile[]): ConformanceResult {
  const violations: ConformanceResult['violations'] = [];

  for (const file of files) {
    if (!file.path.endsWith('.md')) continue;

    if (isReserved(file.path)) {
      // index.md/log.md rules: no frontmatter EXCEPT the bundle-root index.md,
      // which MAY declare okf_version. We don't fail on extra frontmatter
      // (permissive per spec) — just confirm the file is non-empty.
      if (file.content.trim().length === 0) {
        violations.push({ path: file.path, reason: 'reserved file is empty' });
      }
      continue;
    }

    // Rule 1: parseable YAML frontmatter.
    const { frontmatter } = parseFrontmatter(file.content);
    if (frontmatter === null) {
      violations.push({ path: file.path, reason: 'missing or unparseable YAML frontmatter block' });
      continue;
    }
    if (hasUnquotedTrailingColonValue(frontmatter)) {
      violations.push({ path: file.path, reason: 'frontmatter contains an unquoted scalar value ending in a bare colon (invalid YAML plain-scalar syntax)' });
      continue;
    }

    // Rule 2: non-empty `type` field.
    const type = extractYamlField(frontmatter, 'type');
    if (!type || type.trim().length === 0) {
      violations.push({ path: file.path, reason: 'missing or empty `type` frontmatter field' });
    }
  }

  return {
    conformant: violations.length === 0,
    totalFiles: files.length,
    violations,
  };
}
