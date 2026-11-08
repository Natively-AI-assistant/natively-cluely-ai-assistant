// electron/services/knowledge/OwnAnswersStore.ts
//
// Where "Cue Cards" live (see ownAnswers.ts for what they are). One row per
// question in profile_own_answers (DatabaseManager v32).
//
// Every read returns a neutral value when the database is unavailable: this
// store feeds live answers, and a profile that cannot be read must leave the
// answer as it was, never break it.

import { DatabaseManager } from '../../db/DatabaseManager';
import { OWN_ANSWER_QUESTIONS, cleanOwnAnswer, ownAnswerQuestion, type OwnAnswerRow, type OwnAnswerStatus } from './ownAnswers';

interface SqliteLike {
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown; get(...p: unknown[]): unknown };
  exec(sql: string): unknown;
  transaction<T>(fn: () => T): () => T;
}

const db = (): SqliteLike | null => {
  try { return DatabaseManager.getInstance().getDb() as unknown as SqliteLike | null; } catch { return null; }
};

const isStatus = (v: unknown): v is OwnAnswerStatus => v === 'draft' || v === 'saved';

/** Every stored row, in the catalogue's order. Unknown keys (a question since removed) are left out. */
export function listOwnAnswers(): OwnAnswerRow[] {
  const d = db();
  if (!d) return [];
  try {
    // SELECT *: `origin` (v33) is read when the column exists; a row without it is the user's own words.
    const rows = d.prepare('SELECT * FROM profile_own_answers').all() as Array<Record<string, unknown>>;
    const byKey = new Map(rows.map((r) => [String(r.key), r]));
    const out: OwnAnswerRow[] = [];
    for (const q of OWN_ANSWER_QUESTIONS) {
      const r = byKey.get(q.key);
      const text = typeof r?.answer === 'string' ? r.answer : '';
      if (!r || !text.trim()) continue;
      out.push({ key: q.key, text, status: isStatus(r.status) ? r.status : 'saved', origin: r.origin === 'drafted' ? 'drafted' : 'user', updatedAt: typeof r.updated_at === 'string' ? r.updated_at : undefined });
    }
    return out;
  } catch { return []; }
}

const UPSERT = `INSERT INTO profile_own_answers (key, answer, status, origin, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET answer = excluded.answer, status = excluded.status, origin = excluded.origin, updated_at = excluded.updated_at`;

/**
 * The user's own text for one question. Saving is what makes it readable by a
 * meeting; saving an empty box removes the row. Returns the stored text.
 */
export function saveOwnAnswer(key: string, text: unknown): { ok: boolean; text: string } {
  const q = ownAnswerQuestion(key);
  const d = db();
  if (!q || !d) return { ok: false, text: '' };
  const cleaned = cleanOwnAnswer(q.key, text);
  if (!cleaned) { d.prepare('DELETE FROM profile_own_answers WHERE key = ?').run(q.key); return { ok: true, text: '' }; }
  // Saving a draft's words unchanged is the same as pressing Use: still Natively's draft.
  const before = d.prepare('SELECT answer, origin FROM profile_own_answers WHERE key = ?').get(q.key) as { answer?: string; origin?: string } | undefined;
  const origin = before?.origin === 'drafted' && String(before.answer ?? '').trim() === cleaned.trim() ? 'drafted' : 'user';
  d.prepare(UPSERT).run(q.key, cleaned, 'saved', origin);
  return { ok: true, text: cleaned };
}

/** Approve drafts as they stand: the given keys, or every draft. Returns how many changed. */
export function useOwnAnswerDrafts(keys?: readonly string[]): number {
  const d = db();
  if (!d) return 0;
  const wanted = keys?.length ? keys.filter((k) => ownAnswerQuestion(k)) : OWN_ANSWER_QUESTIONS.map((q) => q.key);
  let changed = 0;
  d.transaction(() => {
    const stmt = d.prepare(`UPDATE profile_own_answers SET status = 'saved', updated_at = datetime('now') WHERE key = ? AND status = 'draft' AND trim(answer) <> ''`);
    for (const k of wanted) changed += Number((stmt.run(k) as { changes?: number })?.changes ?? 0);
  })();
  return changed;
}

/**
 * Store a drafting run. A draft never replaces what the user wrote or
 * approved: a 'saved' row is skipped, whatever the run returned for it.
 * Returns the keys written.
 */
export function storeOwnAnswerDrafts(drafts: Record<string, string>): string[] {
  const d = db();
  if (!d) return [];
  const written: string[] = [];
  d.transaction(() => {
    const existing = d.prepare('SELECT status, answer FROM profile_own_answers WHERE key = ?');
    const upsert = d.prepare(UPSERT);
    for (const q of OWN_ANSWER_QUESTIONS) {
      if (!q.drafted) continue;
      const cleaned = cleanOwnAnswer(q.key, drafts[q.key]);
      if (!cleaned) continue;
      const row = existing.get(q.key) as { status?: string; answer?: string } | undefined;
      if (row?.status === 'saved' && String(row.answer ?? '').trim()) continue;
      upsert.run(q.key, cleaned, 'draft', 'drafted');
      written.push(q.key);
    }
  })();
  return written;
}

/** Drafts were written from a résumé: when that résumé is removed they go with it. What the user saved stays. */
export function deleteOwnAnswerDrafts(): void {
  const d = db();
  if (!d) return;
  d.prepare(`DELETE FROM profile_own_answers WHERE status = 'draft'`).run();
}

/** Everything, for the profile wipe. A missing table holds nothing to wipe. */
export function wipeOwnAnswers(): void {
  const d = db();
  if (!d) return;
  try { d.exec('DELETE FROM profile_own_answers;'); }
  catch (e) { if (!/no such table/i.test(String((e as Error)?.message))) throw e; }
}
