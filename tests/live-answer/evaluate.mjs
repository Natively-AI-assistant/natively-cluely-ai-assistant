// Objective properties of a live answer, measured on what the overlay SHOWS
// (the renderer's own splitGistLine: body = the answer, gist = the chip).
import { splitGistLine } from '../../src/lib/displayMarkup.ts';

const stripCode = (t) => t.replace(/```[\s\S]*?```/g, ' ');
export function spokenWords(t) {
  const prose = stripCode(t).replace(/`[^`]*`/g, (m) => m.slice(1, -1)).replace(/[*_#>]/g, ' ');
  return (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu) || []).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}
const sentences = (t) => (stripCode(t).replace(/\*\*/g, '').replace(/\b(e\.g|i\.e|etc|vs|Mr|Dr)\./gi, '$1').match(/[^.!?\n]*[\p{L}\p{N}][^.!?\n]*(?:[.!?]+|$)/gmu) || []).filter(s => s.trim().length > 1).length;
const paragraphs = (t) => stripCode(t).split(/\n\s*\n/).filter(p => p.trim()).length;

const HEADING_RE = /^\s{0,3}#{1,6}\s|^\s*\*\*[^*\n]{1,40}:\*\*\s*$|^\s*\*\*[^*\n]{1,40}:\*\*/m;
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+\S/m;
const LABEL_RE = /^\s*\**\s*(answer|response|good (interview )?answer|interview answer|suggested (answer|response)|key points|what to say|say this|script|example answer|sample answer|short version|tl;?dr|in short)\s*:?\**\s*:/im;
const COACHING_RE = new RegExp([
  'good interview answer', 'a shape that works', 'fill[- ]in', 'what makes it land', 'you (could|can|might|should) say',
  'you could answer', 'try saying', 'here(?:\'s| is) (?:a |how|what|one way)', 'a possible way to phrase', 'possible phrasing',
  '\\bframe (?:it|this|your)\\b', 'your answer should', 'when answering', 'interviewers? (?:want|look|are looking)', '\\bstructure (?:it|your answer)\\b',
  'star (?:method|format)', 'the (?:situation|task|action|result)\\s*:', 'tailor', 'not on file', 'i don\'t have your', 'i do not have your',
  'if you (?:tell|share|give) me', '\\bplug in\\b', '\\bswap in\\b', '(?<!\\[)\\[(?!\\[)[^\\]]{2,40}\\](?!\\])', '\\btemplate\\b', 'as the candidate', 'the user\'s',
].join('|'), 'i');
// Offers to do more for the USER (assistant voice). A question put to the other
// party in the conversation is normal speech and is not counted here.
const FOLLOWUP_RE = /(let me know if|happy to (?:help|adjust|expand|tailor)|want me to|would you like me to|if you(?:'d| would) like(?:,)? I|i can (?:also |help |tailor|adjust|expand|make|write|draft|turn)|feel free to|shall i|do you want me to|i'?ll help you|i can help you)/i;
const META_RE = /(as an ai|i'?m natively|ai assistant|language model|evin john|profile intelligence|in settings|upload(?:ed)? (?:a |your )?(?:résumé|resume|document|file)|no (?:document|file|résumé|resume) (?:is |has been )?(?:attached|added|uploaded)|(?:résumé|resume|profile|material|notes|documents?) (?:do(?:es)?n'?t|does not|do not) (?:mention|cover|include|say)|not (?:in|on) (?:file|the notes|my notes)|general knowledge|retrieved|the evidence|the transcript)/i;
const DISCLAIMER_OPEN_RE = /^(?:\W*)(?:i don'?t have|i do not have|without (?:more|additional|knowing)|based on (?:the|what)|as an ai|there are (?:several|a few|many) (?:factors|things)|it depends|i can'?t (?:say|tell|know)|i'?m not sure (?:what|which))/i;
const QUOTE_WRAP_RE = /^\s*["“][\s\S]{20,}["”]\s*$/;
const INNER_QUOTE_BLOCK_RE = /(^|\n)\s*[*_]*["“][^"”\n]{40,}["”]/;
// Past-tense personal experience claims — flags CANDIDATES for fabrication
// review; adjudicated per item against the context actually supplied.
const PERSONAL_CLAIM_RE = /\b(?:I|we)\s+(?:once\s+|recently\s+|previously\s+)?(?:led|built|worked|spent|managed|shipped|launched|increased|reduced|cut|grew|delivered|joined|migrated|designed|architected|mentored|owned|was (?:working|leading|responsible|on)|had (?:to|a|an)|faced|noticed|realized|discovered|inherited|took over|ran|handled|resolved|fixed|improved|drove|created|developed|implemented|made a mistake|missed|pushed|found)\b|\bmy (?:last|previous|current|former) (?:role|job|company|team|position|manager|employer)\b|\bat my (?:last|previous|current) (?:role|job|company)\b|\bin my (?:last|previous|current) (?:role|job|position)\b|\b(?:I|I've|I have) (?:been|spent) (?:the )?(?:last|past)? ?(?:few|several|\d+|two|three|four|five) (?:years|months)\b|\b\d{1,3}\s?%/i;

// Shared context that was never supplied (no-context runs): references to a prior
// discussion, a document, or situational facts the model could not know.
const INVENTED_CONTEXT_RE = /\b(?:we|you|I)(?:'ve| have)? (?:discussed|mentioned|talked about|covered|agreed on|went over|outlined)\b|\bas (?:we )?discussed\b|\b(?:our|the) (?:last|previous|recent) (?:call|meeting|planning session|sprint|conversation|discussion|retro)\b|\bthe recent [\w-]+ (?:issues?|problems?|incidents?|feedback|complaints?|outages?)\b|\byou(?:'ve| have) (?:structured|outlined|proposed|shared|laid out|put together)\b|\b(?:this|the) proposal (?:covers|includes|focuses|addresses|does)\b|\bwe (?:have|had) (?:planned|scheduled|committed)\b|\bthe goals we\b|\bin our conversation\b|\bthe technical challenges we\b|\bthat (?:were|was) discussed\b/i;
// Unrealistic / unsupported commitments to an outcome or deadline.
const COMMITMENT_RE = /\b(?:I|we) (?:can|will|'ll) (?:definitely |absolutely |certainly )?(?:hit|deliver|finish|complete|ship|get (?:it|this|everything) done|be done|make it|have (?:it|everything) (?:done|ready))\b[^.]{0,50}\b(?:by|before) (?:friday|monday|tomorrow|the deadline|end of)|\b(?:yes|absolutely|definitely),? (?:we|I) (?:can|will)\b/i;
// Hands the question back instead of answering it.
// The question handed back to the USER for more input (assistant voice), not a
// question to the other party ("could you share the budgeted range?").
const STALL_RE = /\b(?:tell me (?:a bit about |more about )?(?:your|my) (?:background|experience|work history|role|project|strengths)|if you (?:tell|give|share|paste) me|paste (?:your|it|the)|send (?:me )?(?:your|the) (?:résumé|resume|notes|details)|once (?:you|I) (?:share|tell|see your)|I'?ll (?:help you|turn it into|shape it|write the real|tighten it))\b/i;

// A claimed past event about the user ("I once…", "early in my career…"). In a
// no-context run every hit is fabricated; with a résumé it must match it.
const EVENT_RE = /\b(I once|one time|early in (?:my career|a project)|at my (?:last|previous|former) (?:job|company|role|employer)|in my (?:last|previous|former) (?:role|job|position)|there was a (?:time|situation|project)|I remember (?:when|a time)|a few (?:months|years) ago|last (?:year|quarter)|on a (?:recent|previous|past) project|in a (?:recent|previous|past) project|I encountered|I led a|I(?:'ve| have) spent the last)\b/i;

// Chatbot register (second spec, Part 17): assistant phrasing that no one says
// aloud in a live conversation.
const AI_ASSISTANT_RE = /\b(?:certainly!|here'?s a (?:concise|quick|short|brief) (?:answer|version|summary)|there are (?:several|many|a few) (?:factors|things|considerations) to consider|based on the information (?:provided|given)|it'?s important to note|a good way to approach this|here'?s how i would structure|let me break (?:it|this) down|here are the key points|if you'?d like|feel free to|i hope (?:that|this) helps|would you like me to|great question)\b/i;
// The answer names where its information came from, or that it is missing
// (Parts 19, 20, 25): internal system language an interviewer should never hear.
const CONTEXT_EXPOSED_RE = /\b(?:according to (?:your|the) (?:resume|résumé|cv|notes|profile|document|file|transcript)|based on (?:your|the) (?:notes|resume|résumé|profile|uploaded|document|provided context)|on file|(?:is|are|isn'?t|aren'?t|nothing|what'?s) loaded|your profile|my notes|the notes|in front of me|i don'?t have (?:access to|anything on|any (?:details|information|info|context) (?:on|about)|your|the (?:details|specifics|project|release|scope|notes|approach|proposal))|retrieved|document context|uploaded (?:document|file|résumé|resume)|no (?:context|information) (?:was |has been )?(?:provided|given|available)|without (?:more )?(?:context|details|information) (?:about|on))\b/i;

export function evaluate(finalText, { kind } = {}) {
  const { body, gist } = splitGistLine(finalText || '');
  const w = spokenWords(body);
  const sec = Math.round(w / 150 * 60);
  const opening = body.replace(/[*_#>`]/g, '').trim().split(/\s+/).slice(0, 8).join(' ');
  const coaching = COACHING_RE.test(body) || LABEL_RE.test(body);
  const followup = FOLLOWUP_RE.test(body);
  const endsWithQuestion = /\?\s*$/.test(body.trim());
  const meta = META_RE.test(body);
  const headings = HEADING_RE.test(body);
  const bullets = BULLET_RE.test(body);
  const labels = LABEL_RE.test(body) || /^\s*\*\*[^*\n]{1,40}:\*\*/m.test(body);
  const quoteWrapped = QUOTE_WRAP_RE.test(body);
  const quotedScript = INNER_QUOTE_BLOCK_RE.test(body);
  const disclaimerOpen = DISCLAIMER_OPEN_RE.test(body);
  const personalClaim = PERSONAL_CLAIM_RE.test(body);
  const pastEvent = EVENT_RE.test(body);
  const inventedContext = INVENTED_CONTEXT_RE.test(body);
  const commitment = COMMITMENT_RE.test(body);
  const stall = STALL_RE.test(body);
  const duplicate = /good interview answer|short version|in short|tl;?dr|to summari[sz]e|in summary/i.test(body) || quotedScript;
  const code = /```/.test(body);
  const aiAssistant = AI_ASSISTANT_RE.test(body);
  const contextExposed = CONTEXT_EXPOSED_RE.test(body);
  const speakable = !coaching && !followup && !meta && !headings && !labels && !quoteWrapped && !quotedScript && !disclaimerOpen
    && !(bullets && kind === 'spoken') && !code && !inventedContext && !commitment && !aiAssistant && !contextExposed;
  return { words: w, seconds: sec, sentences: sentences(body), paragraphs: paragraphs(body), headings, bullets, labels,
    coaching, followup, meta, quoteWrapped, quotedScript, disclaimerOpen, personalClaim, pastEvent, inventedContext, commitment, stall, endsWithQuestion, duplicate, code, aiAssistant, contextExposed, gist: gist ?? null,
    speakable, opening, body };
}
