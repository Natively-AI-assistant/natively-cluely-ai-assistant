// electron/services/knowledge/ownAnswersDrafting.ts
//
// Drafts "Cue Cards" from the résumé (and the job description, when one is
// loaded) in one model call, off the live path. See ownAnswers.ts for what a
// draft is and why a meeting never reads one until the user approves it.
//
// Runs after a résumé or job description is saved (owner's pick, 2026-10-14:
// "Draft all ten automatically at résumé upload", with every box editable).
// What only the user knows (salary, relocation, notice) is never drafted.

import { draftableOwnAnswerKeys, ownAnswerDraftPrompt, parseOwnAnswerDrafts, type OwnAnswerRow } from './ownAnswers';

export interface OwnAnswersDraftDeps {
  /** One completion for one prompt. The knowledge engine's structured call. */
  generate: (prompt: string) => Promise<unknown>;
  /** Read when the run starts, so a queued run drafts from the documents of that moment. */
  resumeText: () => string;
  jobText: () => string;
  listAnswers: () => OwnAnswerRow[];
  storeDrafts: (drafts: Record<string, string>) => string[];
  /** Told once per run that finished, with the keys it wrote (possibly none). */
  onFinished?: (written: string[]) => void;
}

export interface OwnAnswersDraftOptions {
  /**
   * Only questions with no text at all. A new job description drafts the answer
   * about the role without rewriting drafts the user may be reading; a new
   * résumé redrafts every draft, because the old ones describe the old résumé.
   */
  onlyMissing?: boolean;
}

/** One run at a time; a run requested meanwhile starts when this one ends. */
let chain: Promise<string[]> = Promise.resolve([]);
let running = 0;

export function isDraftingOwnAnswers(): boolean { return running > 0; }

async function runOnce(deps: OwnAnswersDraftDeps, opts: OwnAnswersDraftOptions): Promise<string[]> {
  const resumeText = String(deps.resumeText() ?? '').trim();
  if (!resumeText) return [];
  const jobText = String(deps.jobText() ?? '').trim();
  const rows = deps.listAnswers();
  const present = new Set(rows.filter((r) => r.text.trim()).map((r) => r.key));
  const keys = draftableOwnAnswerKeys(rows, Boolean(jobText)).filter((k) => !opts.onlyMissing || !present.has(k));
  if (keys.length === 0) return [];
  const reply = await deps.generate(ownAnswerDraftPrompt({ resumeText, jobText, keys }));
  const drafts = parseOwnAnswerDrafts(reply, keys);
  return Object.keys(drafts).length ? deps.storeDrafts(drafts) : [];
}

/** Queue a drafting run. Never throws: a failed draft leaves the boxes as they were. */
export function draftOwnAnswers(deps: OwnAnswersDraftDeps, opts: OwnAnswersDraftOptions = {}): Promise<string[]> {
  running += 1;
  const run = async (): Promise<string[]> => {
    let written: string[] = [];
    try { written = await runOnce(deps, opts); }
    catch (e) { console.warn('[OwnAnswers] drafting failed:', (e as Error)?.message ?? e); }
    finally { running -= 1; }
    try { deps.onFinished?.(written); } catch { /* a listener must not fail the run */ }
    return written;
  };
  const next = chain.then(run, run);
  chain = next.catch(() => []);
  return next;
}

interface OrchestratorDocLike { raw_text?: string | null; structured_data?: unknown }

/** A profile document's text for the drafting call: the raw text, or the structured extraction when that is all there is. */
export function profileDocumentText(doc: OrchestratorDocLike | null | undefined): string {
  if (!doc) return '';
  if (typeof doc.raw_text === 'string' && doc.raw_text.trim()) return doc.raw_text;
  if (doc.structured_data == null) return '';
  try { return JSON.stringify(doc.structured_data); } catch { return ''; }
}
