// Session context: the resume and job description the user loads from the
// launcher ("Resume & JD") before a session. Stored as plain text in
// SettingsManager and appended to the system prompt of every live answer by
// LLMHelper.injectLanguageInstruction, so all providers and all answer paths
// (what to answer, typed questions, follow-ups) see it.
//
// This is a free, standalone feature. The premium Profile Intelligence
// pipeline injects its own <candidate_profile>; when that is already in a
// prompt this block is not added again.
//
// The tag names match what the answer prompts already treat as grounding
// (<candidate_profile>, <target_job>), so the model uses the resume as the
// candidate's own experience instead of saying "no profile is loaded".

import type { SettingsManager as SettingsManagerType } from './SettingsManager';

// Required lazily, like LLMHelper's provider-scope read: LLMHelper is inlined
// into many esbuild bundles, some of which load without a settings store.
const settings = (): SettingsManagerType =>
  (require('./SettingsManager') as typeof import('./SettingsManager')).SettingsManager.getInstance();

export type SessionContextKind = 'resume' | 'jd';

/** Caps keep the block inside the 8k-char profile budget used elsewhere
 *  (IntelligenceEngine sanitizeManualContextText) so a long resume does not
 *  push the latest interviewer turn out of the model's attention. */
export const SESSION_RESUME_MAX_CHARS = 6000;
export const SESSION_JD_MAX_CHARS = 3000;

export interface SessionContextState {
  enabled: boolean;
  resumeText: string;
  resumeFileName: string;
  jdText: string;
  jdFileName: string;
}

const maxFor = (kind: SessionContextKind) => (kind === 'resume' ? SESSION_RESUME_MAX_CHARS : SESSION_JD_MAX_CHARS);

export function normalizeSessionText(text: unknown, kind: SessionContextKind): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxFor(kind));
}

/** The prompt block for a given state; '' when off or empty. Pure. */
export function buildSessionContextBlock(state: SessionContextState): string {
  if (!state.enabled) return '';
  const resume = state.resumeText.trim();
  const jd = state.jdText.trim();
  if (!resume && !jd) return '';
  const parts: string[] = [];
  if (resume) parts.push(`<candidate_profile source="user_resume">\n${resume}\n</candidate_profile>`);
  if (jd) parts.push(`<target_job source="user_jd">\n${jd}\n</target_job>`);
  const rules: string[] = [];
  if (resume) rules.push('The user is the candidate in <candidate_profile>: when asked about their background, answer in the first person using only facts from it, and never invent experience, employers, numbers or skills that are not there.');
  if (jd) rules.push('Tailor answers to the role in <target_job>: connect the candidate\'s experience to its requirements where it fits naturally.');
  return `\n\n${parts.join('\n')}\n${rules.join(' ')}`;
}

/** Appends `block` to a system prompt unless the prompt already carries a
 *  candidate profile (premium Profile Intelligence). Pure. */
export function withSessionContext(systemPrompt: string, block: string): string {
  if (!block) return systemPrompt;
  if (systemPrompt.includes('<candidate_profile')) return systemPrompt;
  return `${systemPrompt}${block}`;
}

export function getSessionContext(): SessionContextState {
  const sm = settings();
  return {
    enabled: sm.get('sessionContextEnabled') !== false,
    resumeText: String(sm.get('sessionResumeText') ?? ''),
    resumeFileName: String(sm.get('sessionResumeFileName') ?? ''),
    jdText: String(sm.get('sessionJdText') ?? ''),
    jdFileName: String(sm.get('sessionJdFileName') ?? ''),
  };
}

/** Read LIVE on every call, never memoised: esbuild inlines this module into
 *  several bundles, and a cache in one would go stale when another writes.
 *  SettingsManager is anchored on globalThis, so this read is one truth. */
export function getSessionContextBlock(): string {
  try {
    return buildSessionContextBlock(getSessionContext());
  } catch {
    return '';
  }
}

/** @returns false when the settings store refused the write. */
export function setSessionContextText(kind: SessionContextKind, text: unknown, fileName = ''): boolean {
  const sm = settings();
  const clean = normalizeSessionText(text, kind);
  if (kind === 'resume') {
    return sm.set('sessionResumeText', clean) && sm.set('sessionResumeFileName', clean ? fileName : '');
  }
  return sm.set('sessionJdText', clean) && sm.set('sessionJdFileName', clean ? fileName : '');
}

export function clearSessionContext(kind: SessionContextKind): boolean {
  return setSessionContextText(kind, '', '');
}

export function setSessionContextEnabled(enabled: boolean): boolean {
  return settings().set('sessionContextEnabled', enabled);
}

/** What the renderer shows: names, sizes and the text itself (for editing). */
export function describeSessionContext() {
  const s = getSessionContext();
  return {
    enabled: s.enabled,
    resume: { fileName: s.resumeFileName, chars: s.resumeText.length, text: s.resumeText },
    jd: { fileName: s.jdFileName, chars: s.jdText.length, text: s.jdText },
    limits: { resume: SESSION_RESUME_MAX_CHARS, jd: SESSION_JD_MAX_CHARS },
  };
}
