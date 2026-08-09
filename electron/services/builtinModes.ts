// electron/services/builtinModes.ts
//
// The "default mode" concept, which did not exist until 2026-08-09.
//
// Every row in `modes` was a user-created `mode_<uuid>` with a freely editable
// `template_type` — including the ones NAMED "General", "Team Meet" and
// "Technical Interview". Nothing distinguished an app default from something
// the user built, and `updateMode` would persist any template onto any row.
//
// That is the deeper cause of the reported defect: a mode named "Technical
// Interview" ran as `general`, and because `general` is the only built-in with
// `profileSources: []`, the user's résumé was never loaded into scope. The
// answer ("I don't have your CGPA") was correct for the state the turn was in,
// and the state was wrong for reasons nothing surfaced.
//
// A built-in mode's TEMPLATE IS FIXED. Its name, custom context, reference
// files and Answer policy all stay editable — locking the template is what
// prevents the identity confusion, and locking anything more would take away
// choices users have already made.
//
// This module is deliberately free of database and Electron imports so the
// adoption rule — which RECLASSIFIES USER DATA — can be read and tested on its
// own.

/** The canonical name each built-in template ships with. */
export const BUILTIN_MODE_LABELS = {
  'general': 'General',
  'sales': 'Sales',
  'recruiting': 'Recruiting',
  'team-meet': 'Team Meet',
  'looking-for-work': 'Looking for work',
  'technical-interview': 'Technical Interview',
  'lecture': 'Lecture',
  'seminar': 'Seminar',
} as const;

export type BuiltinModeTemplate = keyof typeof BUILTIN_MODE_LABELS;

/** Stable id for a seeded built-in, so re-running the migration cannot duplicate. */
export const builtinModeId = (t: BuiltinModeTemplate): string => `mode_builtin_${t}`;

export interface AdoptionCandidate {
  id: string;
  name: string;
  templateType: string;
  createdAt: string;
  isBuiltin?: boolean;
}

export interface AdoptionPlan {
  /** Existing rows to mark built-in. */
  adopt: string[];
  /** Templates with no existing row to adopt — seed a fresh one. */
  seed: BuiltinModeTemplate[];
}

/**
 * Decide which existing modes become built-ins, and which templates need one.
 *
 * ADOPT requires the row's name to be EXACTLY the canonical label FOR ITS OWN
 * template. Two clauses, both load-bearing:
 *
 *   - name match alone is not enough. A row named "Technical Interview" that is
 *     running as `general` is the reported bug; adopting it would freeze the
 *     wrong template permanently.
 *   - template match alone is not enough either. A `general` mode the user
 *     named "Lecture" is their own construction, and locking it would remove a
 *     choice they made.
 *
 * ONE per template, the OLDEST, because duplicates exist in real tables and two
 * immutable modes with the same name are indistinguishable in the UI.
 *
 * Idempotent: rows already marked built-in are skipped rather than re-adopted,
 * and they still satisfy their template so it is not seeded again.
 */
export function planBuiltinAdoption(rows: readonly AdoptionCandidate[]): AdoptionPlan {
  const adopt: string[] = [];
  const covered = new Set<string>();

  const ordered = [...rows].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  // Already-migrated rows cover their template without being re-adopted.
  for (const r of ordered) {
    if (r.isBuiltin && isBuiltinTemplate(r.templateType)) covered.add(r.templateType);
  }

  for (const r of ordered) {
    if (r.isBuiltin) continue;
    const t = r.templateType;
    if (!isBuiltinTemplate(t) || covered.has(t)) continue;
    if (String(r.name).trim() !== BUILTIN_MODE_LABELS[t]) continue;
    adopt.push(r.id);
    covered.add(t);
  }

  const seed = (Object.keys(BUILTIN_MODE_LABELS) as BuiltinModeTemplate[])
    .filter((t) => !covered.has(t));

  return { adopt, seed };
}

function isBuiltinTemplate(v: string): v is BuiltinModeTemplate {
  return Object.prototype.hasOwnProperty.call(BUILTIN_MODE_LABELS, v);
}
