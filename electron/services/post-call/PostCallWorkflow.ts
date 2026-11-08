import * as crypto from 'crypto';

export type PostCallModeType =
  | 'general'
  | 'looking-for-work'
  | 'sales'
  | 'recruiting'
  | 'team-meet'
  | 'lecture'
  | 'technical-interview'
  | string;

export interface PostCallTranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
}

export interface StructuredActionItem {
  id: string;
  text: string;
  owner?: string;
  deadline?: string;
  sourceTimestamp?: number;
}

export interface CoachingInsight {
  id: string;
  type: string;
  title: string;
  detail: string;
  severity: 'info' | 'opportunity' | 'warning';
  evidence?: string;
}

export interface PostCallEnhancements {
  schemaVersion: 2;
  actionItemsStructured: StructuredActionItem[];
  followUpDraft: string;
  coachingInsights: CoachingInsight[];
}

// ── Coaching-insight suppression (2026-08-26, product decision) ───────────────
// The "Coaching" section on the notes page was judged unwanted: it quoted a transcript
// line back at the user under generic advice ("Uncertainty appeared in answers — Review
// these moments and prepare a tighter explanation") on every call that tripped a regex.
// It is switched OFF, not deleted, exactly like INCLUDE_NEXT_STEPS in
// electron/services/meeting/MeetingSummaryReducer.ts — see that constant for the shape.
//
// Flip INCLUDE_COACHING_INSIGHTS back to true to restore generation here.
// generateCoachingInsights() below is untouched and still unit-tested, so the flip is the
// only change needed in this file. The matching switch is the renderer:
//   src/components/MeetingDetails.tsx  (the "Coaching" <section>, removed 2026-08-26 —
//     restore it from git history; the `coachingInsights` type and the stored-schema
//     field are deliberately KEPT so already-saved notes still parse.)
export const INCLUDE_COACHING_INSIGHTS: boolean = false;

// The transcript fallback for action items (the summary's own list is added
// after). Three shapes:
//   "<someone> will / should / need(s) to / must <task>"
//   "Action: / Todo: / Follow up: <task>"
//   "<verb> <object>" as an instruction: the line STARTS with the verb
//     ("Send me the deck by Friday"), and the verb stays in the task.
// "can" / "could" are offers, not promises, and are not read: "I can go into
// the details", said by the other side, was filed as the user's task, and
// "I can't share that information" became the task "that information"
// (2026-10-17, the launcher's Loose Ends).
const ACTION_PATTERNS = [
  /\b(?:i|we|you|he|she|they|[A-Z][a-z]+)\s+(?:will|should|need to|needs to|must)\s+(.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
  /\b(?:action|todo|follow up):\s*(.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
  /^(?:please\s+)?((?:send|share|schedule|book|prepare|review|follow up|circle back|introduce|email)\s+.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
];

const OWNER_PATTERN = /\b(I|we|you|he|she|they|[A-Z][a-z]+)\s+(?:will|should|need to|needs to|must)\b/;
const DEADLINE_PATTERN = /\b(?:by|before|on|after)\s+([^.!?]+)$/i;

export function buildPostCallEnhancements(params: {
  transcript: PostCallTranscriptSegment[];
  modeTemplateType?: PostCallModeType | null;
  summaryData?: { overview?: string; actionItems?: string[]; keyPoints?: string[]; sections?: Array<{ title: string; bullets: string[] }> };
}): PostCallEnhancements {
  const actionItemsStructured = extractStructuredActionItems(params.transcript, params.summaryData?.actionItems ?? []);
  // Not invoked at all while INCLUDE_COACHING_INSIGHTS is false — the key stays on the
  // payload (stored-schema consumers read it) but is always empty.
  const coachingInsights = INCLUDE_COACHING_INSIGHTS
    ? generateCoachingInsights(params.transcript, params.modeTemplateType, params.summaryData)
    : [];

  return {
    schemaVersion: 2,
    actionItemsStructured,
    followUpDraft: buildFollowUpDraft(params.modeTemplateType, actionItemsStructured, params.summaryData),
    coachingInsights,
  };
}

export function extractStructuredActionItems(
  transcript: PostCallTranscriptSegment[],
  summaryActionItems: string[] = []
): StructuredActionItem[] {
  const items: StructuredActionItem[] = [];
  const seen = new Set<string>();

  const addItem = (text: string, sourceTimestamp?: number, owner?: string, deadline?: string) => {
    const cleaned = normalizeActionText(text);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      id: `action_${crypto.randomUUID()}`,
      text: cleaned,
      ...(owner ? { owner } : {}),
      ...(deadline ? { deadline: deadline.trim() } : {}),
      ...(typeof sourceTimestamp === 'number' ? { sourceTimestamp } : {}),
    });
  };

  for (const segment of transcript) {
    const text = segment.text.trim();
    if (!text) continue;

    for (const pattern of ACTION_PATTERNS) {
      const match = text.match(pattern);
      if (!match) continue;
      const owner = text.match(OWNER_PATTERN)?.[1];
      const deadline = match[2] ?? text.match(DEADLINE_PATTERN)?.[1];
      addItem(match[1] ?? text, segment.timestamp, normalizeOwner(owner, segment.speaker), deadline);
      break;
    }
  }

  for (const item of summaryActionItems) {
    addItem(item);
  }

  return items.slice(0, 8);
}

export function buildFollowUpDraft(
  modeTemplateType: PostCallModeType | null | undefined,
  actionItems: StructuredActionItem[],
  summaryData?: { overview?: string; keyPoints?: string[]; sections?: Array<{ title: string; bullets: string[] }> }
): string {
  const greeting = modeTemplateType === 'sales' || modeTemplateType === 'recruiting'
    ? 'Hi,'
    : 'Hi team,';
  const lines = [greeting, '', 'Thanks for the conversation today.'];

  if (summaryData?.overview) {
    lines.push('', summaryData.overview.trim());
  }

  const nextSteps = actionItems.map(item => {
    const owner = item.owner ? `${item.owner}: ` : '';
    const deadline = item.deadline ? ` by ${item.deadline}` : '';
    return `- ${owner}${item.text}${deadline}`;
  });

  // The labelled "Next steps" block is switched off (2026-08-24 product decision) —
  // see INCLUDE_NEXT_STEPS in electron/services/meeting/MeetingSummaryReducer.ts for
  // the rationale and the other three switches. Flip this one back to true with them.
  const INCLUDE_NEXT_STEPS: boolean = false;

  if (INCLUDE_NEXT_STEPS && nextSteps.length > 0) {
    lines.push('', 'Next steps:', ...nextSteps);
  } else {
    lines.push('', 'I will follow up if anything else is needed.');
  }

  lines.push('', 'Best,');
  return lines.join('\n');
}

export function generateCoachingInsights(
  transcript: PostCallTranscriptSegment[],
  modeTemplateType: PostCallModeType | null | undefined,
  summaryData?: { sections?: Array<{ title: string; bullets: string[] }> }
): CoachingInsight[] {
  const text = transcript.map(segment => segment.text).join('\n');
  const insights: CoachingInsight[] = [];

  const add = (type: string, title: string, detail: string, severity: CoachingInsight['severity'], evidence?: string) => {
    insights.push({ id: `coach_${crypto.randomUUID()}`, type, title, detail, severity, ...(evidence ? { evidence } : {}) });
  };

  if (modeTemplateType === 'sales') {
    const hasObjection = /\b(price|pricing|cost|expensive|competitor|budget|too much|not sure)\b/i.test(text);
    const hasNextStep = /\b(next step|follow up|send|schedule|pilot|trial|contract|proposal)\b/i.test(text);
    if (hasObjection && !sectionHasContent(summaryData, 'Objections')) {
      add('missed_objection', 'Objection may need a clearer note', 'The conversation included objection language, but the objection section is empty.', 'opportunity', firstMatch(text, /[^.!?]*(?:price|pricing|cost|expensive|competitor|budget|too much|not sure)[^.!?]*/i));
    }
    if (!hasNextStep) {
      add('missing_next_step', 'Next step was not explicit', 'Consider ending sales calls with a concrete owner and follow-up date.', 'opportunity');
    }
  } else if (modeTemplateType === 'recruiting') {
    if (!/\b(compensation|salary|timeline|notice period|availability|start date)\b/i.test(text)) {
      add('missing_logistics', 'Recruiting logistics not captured', 'Consider confirming compensation, timing, and availability before closing the screen.', 'opportunity');
    }
  } else if (modeTemplateType === 'looking-for-work' || modeTemplateType === 'technical-interview') {
    if (/\b(i don'?t know|not sure|maybe|i think)\b/i.test(text)) {
      add('uncertainty_pattern', 'Uncertainty appeared in answers', 'Review these moments and prepare a tighter explanation or fallback answer.', 'info', firstMatch(text, /[^.!?]*(?:i don'?t know|not sure|maybe|i think)[^.!?]*/i));
    }
  } else if (modeTemplateType === 'team-meet') {
    if (!/\b(owner|by|deadline|due|next step|action item)\b/i.test(text)) {
      add('missing_ownership', 'Ownership may be unclear', 'Team meetings are more useful when decisions include owners and dates.', 'opportunity');
    }
  } else if (modeTemplateType === 'lecture') {
    if (/\b(homework|assignment|read|chapter|due|exam|quiz)\b/i.test(text)) {
      add('study_follow_up', 'Study follow-up detected', 'Add the assignment or study item to follow-up work so it is not missed.', 'info', firstMatch(text, /[^.!?]*(?:homework|assignment|read|chapter|due|exam|quiz)[^.!?]*/i));
    }
  }

  return insights.slice(0, 5);
}

function normalizeActionText(value: string): string {
  return value
    .replace(/^\s*(?:action|todo|follow up):\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .trim();
}

/**
 * The owner as the listener means it, read from who spoke ('user' is the
 * user's own microphone). "I" is the user only on the user's side; from the
 * other side it is the speaker, who is not the user, so it is left unowned.
 * "you" is the reverse: the user when the other side says it, someone else
 * when the user does. The launcher's Loose Ends lists only the user's items
 * (assistPeople.ownerIsUser, where "Me" and "You" both mean the user).
 */
export function normalizeOwner(owner: string | undefined, speaker?: string): string | undefined {
  if (!owner) return undefined;
  const normalized = owner.trim();
  const mine = speaker === 'user';
  if (/^i$/i.test(normalized)) return mine ? 'Me' : undefined;
  if (/^you$/i.test(normalized)) return mine ? undefined : 'You';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function sectionHasContent(
  summaryData: { sections?: Array<{ title: string; bullets: string[] }> } | undefined,
  title: string
): boolean {
  return Boolean(summaryData?.sections?.some(section => section.title.toLowerCase() === title.toLowerCase() && section.bullets.length > 0));
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[0]?.trim();
}
