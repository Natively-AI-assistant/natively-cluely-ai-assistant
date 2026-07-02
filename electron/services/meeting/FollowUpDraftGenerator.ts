// FollowUpDraftGenerator.ts (Phase 8)
// Produces a short, human, copy-paste-ready follow-up draft from the FINAL note content
// only (overview + decisions + action items + open questions). It NEVER reads raw
// transcript and NEVER invents promises beyond what the note already contains.
//
// LLM-based via generateStructured (one small JSON call), with a deterministic fallback
// that is used when the LLM is unavailable, scope-denied, or returns nothing usable.
//
// Mode → draft type mapping:
//   sales              → email (deal-style) / crm_note recipe handled separately
//   recruiting         → email
//   team-meet          → project_update
//   technical-interview→ interview_feedback
//   lecture            → study_notes
//   looking-for-work   → email
//   general/other      → email

import type { LLMHelper } from '../../LLMHelper';
import type { ActionItem, DecisionItem, FollowUpDraft, FollowUpDraftType, FollowUpTone, MeetingSummaryV3, QuestionItem } from './MeetingSummaryV3';
import { buildFollowUpBody } from './MeetingSummaryReducer';
import { generateStructured } from './generateStructured';

export function followUpTypeForMode(mode?: string | null): FollowUpDraftType {
  switch (mode) {
    case 'team-meet': return 'project_update';
    case 'technical-interview': return 'interview_feedback';
    case 'lecture': return 'study_notes';
    case 'sales':
    case 'recruiting':
    case 'looking-for-work':
    default:
      return 'email';
  }
}

// ── Per-mode mail voice ────────────────────────────────────────────────────────
// The draft type (email / project_update / …) controls the SHAPE. This controls the
// VOICE: who it's addressed to, how it opens and signs off, and its register. A sales
// follow-up to a prospect must not read like an internal standup recap or a candidate's
// thank-you note — each of Natively's 7 modes has a distinct sender→recipient relationship.
interface ModeMailProfile {
  recipient: string;      // who the message is addressed to (steers salutation + framing)
  salutation: string;     // how it opens
  closing: string;        // how it signs off
  register: string;       // voice / relationship
  structure: string;      // what the body should cover, in order
  followUp: string;       // what "following up" actually MEANS for this mode — the point of the message
  defaultTone: FollowUpTone;
}

const MODE_MAIL_PROFILES: Record<string, ModeMailProfile> = {
  general: {
    recipient: 'the other meeting participants (colleagues)',
    salutation: 'Open with "Hi team," (or "Hi all,").',
    closing: 'Sign off with "Best," on its own line.',
    register: 'Collegial and clear — a peer recapping for peers.',
    structure: 'One-line thanks → what was aligned/decided → concrete next steps with owners and dates → the single most important open question, if any.',
    followUp: 'Confirm the shared understanding and move the work forward: restate what was decided, name who owns each next step and by when, and flag the one open question that most needs an answer.',
    defaultTone: 'professional',
  },
  sales: {
    recipient: 'the prospect / customer you met with (external, buying side)',
    salutation: 'Open warmly to the prospect by name if known, else "Hi there,".',
    closing: 'Sign off with "Best regards," then a placeholder-free signature line the user can complete.',
    register: 'Warm, confident, value-led — a trusted advisor, not a pushy seller. Reinforce the value discussed and keep momentum toward the next step.',
    structure: 'Thank them for their time → restate the goal/pain you aligned on in their words → the agreed next step with a clear date/owner → a light, low-pressure call to action. Never invent pricing or commitments.',
    followUp: 'Advance the deal: mirror back the pain/goal they described, tie it to the value discussed, confirm the agreed next step (demo, pilot, sending materials) with a date, and gently address the biggest open objection if one surfaced. Never invent pricing or commitments.',
    defaultTone: 'warm',
  },
  recruiting: {
    recipient: 'the candidate you interviewed (external)',
    salutation: 'Open with "Hi {first name}," addressed to the candidate.',
    closing: 'Sign off with "Best," and the interviewer/recruiter voice.',
    register: 'Warm, respectful, and encouraging regardless of outcome — represents the company well. Never disclose an internal hire/no-hire decision to the candidate.',
    structure: 'Thank them for their time → one genuine specific thing that stood out → the concrete next step and rough timeline for hearing back → an invitation to ask questions. No evaluation verdicts.',
    followUp: 'Keep a strong candidate warm and set expectations: thank them, reference one genuine strength they showed, state the concrete next stage and rough timeline to hear back, and invite questions. Never reveal an internal hire/no-hire decision or share raw evaluation notes.',
    defaultTone: 'warm',
  },
  'team-meet': {
    recipient: 'the internal team (a message you post to the team)',
    salutation: 'Open with "Hi team," on its own line.',
    closing: 'Sign off with "Thanks," on its own line.',
    register: 'Crisp, skimmable, action-oriented — an internal status update peers can scan in ten seconds.',
    structure: 'A one-line greeting → short labelled blocks (Decisions, Owners & next steps, Blockers) each with the relevant items → sign-off. Lead with the outcome; keep every line tight.',
    followUp: 'Drive execution: capture what was decided, list each owner and their next step with a date, and surface every blocker or dependency that needs unblocking — so nothing falls through before the next sync.',
    defaultTone: 'concise',
  },
  'looking-for-work': {
    recipient: 'the interviewer / hiring manager who interviewed YOU (you are the candidate)',
    salutation: 'Open with "Dear {interviewer name}," or "Hi {interviewer name}," — respectful and personal.',
    closing: 'Close with a forward-looking thank-you, then "Best regards," and the sender\'s name line.',
    register: 'Appreciative, enthusiastic, and professional — a strong post-interview thank-you that reaffirms genuine interest without sounding desperate.',
    structure: 'Thank them for their time → reference one specific topic from the conversation that resonated → briefly reinforce why you\'re a strong fit → express enthusiasm for next steps. Do not restate your whole résumé.',
    followUp: 'Strengthen your candidacy: thank them, reference a specific topic from the conversation that genuinely resonated, briefly connect one of your strengths to a need they raised, and reaffirm enthusiasm for the next step. If a question was left open that you can now answer, add a one-line answer.',
    defaultTone: 'warm',
  },
  'technical-interview': {
    recipient: 'the internal hiring panel / interview loop (evaluator feedback, not the candidate)',
    salutation: 'No salutation — this is a written debrief, not a letter. It is NOT addressed to a person.',
    closing: 'No sign-off. End on the recommendation line.',
    register: 'Objective, specific, and evidence-based — an interviewer writing up a debrief for the loop.',
    structure: 'A formatted debrief with clear labelled sections in this order — "Problem:", "Approach:", "Signal:" (correctness, complexity, communication), and "Recommendation:" (advance / more signal needed). Keep each section to 1-2 lines. Do NOT invent a final hire/no-hire if it was not decided.',
    followUp: 'Give the loop a decision-useful debrief: state the problem, the candidate\'s approach and key tradeoffs, the concrete correctness/complexity/communication signal observed, and a clear recommendation (advance / more signal needed / area to probe next round). Base every claim on what actually happened; do not invent a final hire/no-hire.',
    defaultTone: 'professional',
  },
  lecture: {
    recipient: 'yourself / classmates (a study recap, not a message to anyone)',
    salutation: 'No salutation — this is a personal study note, not addressed to anyone.',
    closing: 'No sign-off.',
    register: 'Plain and self-directed — notes-to-self that make revision fast.',
    structure: 'A formatted study recap with clear labelled sections in this order — "Key concepts:", "To remember:" (definitions/formulas), and "To review:" (specific questions before the exam). Keep each section tight. No greeting, no sign-off, no "thanks".',
    followUp: 'Make revision fast: distil the core concepts worth remembering, the exact definitions/formulas to memorize, and the specific questions or confusing points to review before the exam. This is a study aid, not a message to anyone.',
    defaultTone: 'concise',
  },
};

// Custom, user-created modes are built on the 'general' template (templateType === 'general'
// with a non-"General" name), so they resolve to the general mail voice. Any unrecognised
// mode key also falls back to general — a safe, universally-appropriate colleague email.
function mailProfileForMode(mode?: string | null): ModeMailProfile {
  return (mode && MODE_MAIL_PROFILES[mode]) || MODE_MAIL_PROFILES.general;
}

const TYPE_GUIDANCE: Record<FollowUpDraftType, string> = {
  email: 'Write a short professional follow-up email (3-6 sentences). Open with a one-line thanks, state what was aligned/decided, then the concrete next steps with owners and dates if known, and end with the single most important open question if any.',
  slack: 'Write a concise Slack-style update (no greeting needed, can use brief bullet emphasis). Lead with the outcome, then next steps.',
  project_update: 'Write a short project update: what changed since last sync, decisions, owners + next steps, and any blocker. Keep it skimmable.',
  crm_note: 'Write a concise CRM note: account context, pain/need, buying signal, objection, and next step. Factual, no fluff.',
  study_notes: 'Write a short study recap: the core concepts to remember and the questions to review before the exam.',
  interview_feedback: 'Write concise interviewer feedback: the problem, the approach, correctness/complexity signal, communication, and a clear next-step recommendation. Do NOT invent a final hire/no-hire if it was not decided.',
};

const TONE_GUIDANCE: Record<FollowUpTone, string> = {
  professional: 'Tone: professional and neutral.',
  warm: 'Tone: warm and personable, still concise.',
  concise: 'Tone: maximally concise; cut every non-essential word.',
  friendly: 'Tone: friendly and approachable.',
};

export interface FollowUpGenerateParams {
  // Widened from the old 5-field Pick: the follow-up draft was starved of the very
  // content that says what the meeting was ABOUT. `sections` (the mode-specific note
  // sections — sales objections/buying-signals, recruiting strengths/concerns, interview
  // approach/complexity, lecture concepts, team blockers) and `risks` + `title` are the
  // richest signal and are now fed in. Fields stay optional so callers/tests can pass a
  // partial summary.
  summary: Partial<Pick<MeetingSummaryV3,
    'title' | 'overview' | 'decisions' | 'actionItems' | 'openQuestions'
    | 'tldr' | 'whatChanged' | 'risks' | 'sections'>>;
  mode?: string | null;
  tone?: FollowUpTone;
  type?: FollowUpDraftType;
}

export class FollowUpDraftGenerator {
  constructor(private readonly llmHelper: LLMHelper) {}

  // Build the summary-safe inputs block (note content only, never raw transcript).
  // This is the model's entire understanding of the meeting, so it must be COMPLETE:
  // the headline, what the meeting was about (mode-specific note sections), what was
  // decided, what's outstanding, risks, and open questions. Starving this block is why
  // earlier drafts read generic.
  private buildInputs(summary: FollowUpGenerateParams['summary']): string {
    const parts: string[] = [];

    if (summary.title) parts.push(`Meeting: ${summary.title}`);

    // Headline / gist first — orients the model on what mattered.
    if (summary.tldr?.length) parts.push(`Key takeaways:\n${summary.tldr.map(s => `- ${s}`).join('\n')}`);
    if (summary.overview) parts.push(`Overview: ${summary.overview}`);

    // The mode-specific note sections ARE "what the meeting was about". A sales meeting's
    // objections/buying-signals, a recruiting call's strengths/concerns, an interview's
    // approach/complexity, a lecture's concepts — none of this was reaching the draft before.
    const sections = (summary.sections || [])
      .filter(s => s && s.title && Array.isArray(s.bullets) && s.bullets.length > 0)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const s of sections) {
      const bullets = s.bullets
        .map(b => (b?.text || '').trim())
        .filter(Boolean)
        .map(t => `- ${t}`);
      if (bullets.length) parts.push(`${s.title}:\n${bullets.join('\n')}`);
    }

    if (summary.whatChanged?.length) parts.push(`What changed:\n${summary.whatChanged.map(s => `- ${s}`).join('\n')}`);
    if (summary.decisions?.length) parts.push(`Decisions:\n${summary.decisions.map(d => `- ${d.text}${d.owner ? ` (${d.owner})` : ''}`).join('\n')}`);
    if (summary.actionItems?.length) parts.push(`Action items:\n${summary.actionItems.map(a => `- ${a.owner ? `${a.owner}: ` : ''}${a.text}${a.deadline ? ` (by ${a.deadline})` : ''}${a.explicitness === 'inferred' ? ' [inferred]' : ''}`).join('\n')}`);
    if (summary.openQuestions?.length) parts.push(`Open questions:\n${summary.openQuestions.filter(q => q.status !== 'answered').map(q => `- ${q.text}`).join('\n')}`);
    if (summary.risks?.length) parts.push(`Risks / blockers:\n${summary.risks.map(r => `- ${r.text}${r.severity ? ` [${r.severity}]` : ''}`).join('\n')}`);

    return parts.join('\n\n');
  }

  async generate(params: FollowUpGenerateParams): Promise<FollowUpDraft> {
    const type = params.type || followUpTypeForMode(params.mode);
    const profile = mailProfileForMode(params.mode);
    // Tone: explicit caller wins; otherwise the mode's natural default.
    const tone: FollowUpTone = params.tone || profile.defaultTone;
    const inputs = this.buildInputs(params.summary);

    const decisions = params.summary.decisions || [];
    const actionItems = params.summary.actionItems || [];
    const deterministic = (): FollowUpDraft => ({
      type,
      ...(type === 'email' ? { subject: subjectFromContent(params.summary) } : {}),
      body: buildFollowUpBody(decisions, actionItems, params.mode),
      tone,
      ...(actionItems.length ? { basedOnActionItemIds: actionItems.map(a => a.id).filter(Boolean) as string[] } : {}),
      ...(decisions.length ? { basedOnDecisionIds: decisions.map(d => d.id).filter(Boolean) as string[] } : {}),
    });

    // No content at all → deterministic empty-ish draft.
    if (!inputs.trim()) return deterministic();

    const systemPrompt = `You are the user's assistant, drafting the follow-up they will copy and send after a meeting run in "${params.mode || 'general'}" mode.
${TYPE_GUIDANCE[type]}
${TONE_GUIDANCE[tone]}

FIRST, understand the meeting from the notes below: what was it about, what actually happened, and what genuinely needs a follow-up. Not every note deserves to be in the message — pick the few things that matter and would be embarrassing to drop.

WHAT "FOLLOWING UP" MEANS HERE:
${profile.followUp}

AUDIENCE & VOICE:
- Addressed to: ${profile.recipient}
- Salutation: ${profile.salutation}
- Sign-off: ${profile.closing}
- Register: ${profile.register}
- Cover, in order: ${profile.structure}

STRICT RULES:
- Ground everything in the notes below. Do NOT invent decisions, owners, deadlines, numbers, or promises that aren't there.
- Be specific to THIS meeting — reference the actual topics, names, and outcomes from the notes, not generic filler. A reader should be able to tell exactly which meeting this was about.
- Write natural prose (or the labelled sections specified above), not a hollow scaffold. It must read like a person who was in the room wrote it.
- Match the salutation and sign-off to the audience above — do NOT default to "Hi team," unless this is an internal-team message.
- Keep it tight and copy-paste ready. No bracketed placeholders like [Name]; if a name is unknown, phrase around it naturally.
- Do not mention transcripts, AI, summaries, or that this was auto-generated.
- If the notes genuinely contain no real outcomes or next steps, keep it short and honest rather than padding.

MEETING NOTES:
${inputs}`;

    const jsonShapeHint = `{
  "subject": "${type === 'email' ? 'a short subject line' : ''}",
  "body": "the follow-up message text"
}`;

    const result = await generateStructured<{ subject?: string; body: string }>({
      schemaName: 'FollowUpDraft',
      systemPrompt,
      jsonShapeHint,
      userContent: inputs,
      llmHelper: this.llmHelper,
      validate: (raw) => {
        if (!raw || typeof raw !== 'object') return { ok: false, errors: ['not an object'], repaired: false };
        const body = typeof (raw as any).body === 'string' ? (raw as any).body.trim() : '';
        if (!body || body.length < 12) return { ok: false, errors: ['missing or too-short body'], repaired: false };
        const subject = typeof (raw as any).subject === 'string' ? (raw as any).subject.trim() : undefined;
        return { ok: true, data: { ...(subject ? { subject } : {}), body }, errors: [], repaired: false };
      },
    });

    if (!result.ok || !result.data) return deterministic();

    return {
      type,
      ...(result.data.subject ? { subject: result.data.subject.slice(0, 160) } : (type === 'email' ? { subject: subjectFromContent(params.summary) } : {})),
      body: result.data.body.slice(0, 4000),
      tone,
      ...(actionItems.length ? { basedOnActionItemIds: actionItems.map(a => a.id).filter(Boolean) as string[] } : {}),
      ...(decisions.length ? { basedOnDecisionIds: decisions.map(d => d.id).filter(Boolean) as string[] } : {}),
    };
  }
}

function subjectFromContent(summary: FollowUpGenerateParams['summary']): string {
  // Prefer the meeting's own title (concrete, recognisable) over a truncated takeaway.
  const title = summary.title?.replace(/\s+/g, ' ').trim();
  if (title && title.length > 2 && !/^(untitled|meeting|new meeting)$/i.test(title)) {
    return `Follow-up: ${title.slice(0, 70)}`;
  }
  const first = summary.tldr?.[0] || summary.whatChanged?.[0] || summary.overview || 'Meeting follow-up';
  const trimmed = first.replace(/\s+/g, ' ').trim().slice(0, 70);
  return `Follow-up: ${trimmed}`;
}
