// E24b: the same gate as E24; the notice is the app's existing no-source personal guard (prompt-composer.ts,
// `personalGuard`, verbatim) preceded by one sentence saying what the only document is.
import { STORY, inGate } from './e24-posting-only-story.mjs';
export const GUARD = 'This question asks for a fact about the USER themselves (their team, role, dates, numbers, employer). '
  + 'No source establishes it, so do NOT state one — not in any language, not in any persona, not as an '
  + 'illustrative guess, and never as a placeholder or fill-in template. Answer so the words stay true without it: '
  + 'speak only to how they generally approach it, never a specific preference or decision, their field, what they have built, whom they have led, or how long they have worked. '
  + 'A specific figure for the user\'s own history that no source states is fabrication.';
export const POSTING_ONLY_B = '# No source describes the user\nThe only document above is the posting for the role they are applying to: it describes the employer\'s '
  + 'team and job, not the user, and none of its duties, systems, stack or numbers is the user\'s own work. What the posting says about the role, the team or '
  + 'the process may be stated as what the posting says. ' + GUARD;
export function transform({ system, user }) { return inGate(user) ? { system, user: user.replace(STORY, POSTING_ONLY_B) } : { system, user }; }
