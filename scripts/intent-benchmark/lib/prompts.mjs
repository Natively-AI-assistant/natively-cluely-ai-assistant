// scripts/intent-benchmark/lib/prompts.mjs
//
// The generation prompt. Its single hardest job is STT REALISM.
//
// A cloud LLM asked for "transcript lines" reliably produces clean prose with
// the capitals stripped. That is not what Natively's classifier sees. If the
// corpus is clean prose in disguise, every candidate is scored on an input
// distribution that does not exist in production, and the winner is whichever
// model likes tidy text most. No amount of careful labelling repairs that, so
// the noise instruction is specific, exemplified, and checked by
// lib/sttRealism.mjs before a batch is accepted.

const STT_RULES = `
HOW THE \`input\` FIELD MUST LOOK

\`input\` is raw output from a streaming speech-to-text model listening to a live
call. It is NOT written text. Natively's local models (Parakeet CTC, Whisper,
Moonshine) emit no punctuation and no capitalisation at all.

Every \`input\` MUST obey all of these:
- NO punctuation whatsoever. No full stops, no commas, no question marks, no
  apostrophes. "what's" becomes "whats". "i'm" becomes "im".
- NO capital letters anywhere, including names and the word "i".
- Real disfluency. Roughly a third of lines should carry a filler in a natural
  position: "um", "uh", "like", "you know", "i mean", "sort of", "kind of".
- Repairs and restarts in maybe a fifth of lines: "so the the thing is",
  "we could uh we could try", "i think i think thats right".
- Occasional homophone and near-miss errors, the kind a CTC model makes on
  audio: "there" for "their", "to" for "two", "wont" for "want", "quarry" for
  "query", "sequel" for "SQL", "vector" for "factor", "cash" for "cache",
  "no" for "know". Use these sparingly, one line in six or so.
- Some lines cut mid-sentence, because the endpointer fired early: "and then we
  just need to make sure that the". Do not add an ellipsis; it just stops.
- Realistic length spread. Many turns are two to five words. A few are long.
- Numbers usually spelled as heard: "twenty three", "two thousand", "q three".

WRONG (clean prose with the capitals removed, which is what you will do if you
are not careful):
  "could you explain how the caching layer handles invalidation"
RIGHT:
  "so could you uh explain how the cashing layer handles invalidation"
  "wait how does the the caching layer know when to"
  "whats the deal with invalidation there"

Do not make every line noisy in the same way. Vary which defect appears.

DO NOT REUSE ANY EXAMPLE STRING FROM THESE INSTRUCTIONS. The examples above and
below show the SHAPE to imitate, not text to copy. Every line you produce must
be one you invented for this specific mode and situation. Copying an example
verbatim makes the row worthless: it measures the instruction, not the language.
`;

const LABEL_RULES = `
LABELLING

Label what the utterance IS, not what a good assistant would do about it.

dialogue_act   question | request | statement | answer | backchannel | interruption
needs_response yes | optional | no
               "no" is the important one and it is COMMON in a live call.
               Backchannels ("mhm", "right", "yeah exactly"), the other party
               thinking aloud, two other people talking to each other, admin
               chatter, and the USER'S OWN speech on their own channel are all
               needs_response=no.
voice          first_person_script | advisor | capture | silent
               MUST be "silent" whenever needs_response is "no".

               For a responding turn, voice is decided by WHO SPEAKS THE OUTPUT,
               and it follows the mode. Getting this wrong is the single most
               common labelling error, because "advisor" sounds like the safe
               default and it is wrong in most modes.

               first_person_script — the user will SAY the output OUT LOUD, as
                 themselves, with no editing. The output is their script.
                 This is the DEFAULT in: technical-interview, looking-for-work,
                 sales, seminar, call-center. A candidate answering an
                 interviewer, a seller answering a prospect, a presenter
                 answering the audience, an agent answering a customer: all
                 first_person_script.
               advisor — the output is guidance ABOUT the situation, written to
                 the user, never spoken aloud. The DEFAULT in: recruiting (the
                 user is evaluating someone else), lecture (explaining a concept
                 to the student), general.
               capture — the output is a RECORD of what was said: an action
                 item, a decision, a risk. The DEFAULT in team-meet, which
                 switches to first_person_script only when the user is called on
                 by name and must reply.
               silent — needs_response is "no".

               Deviating from the mode default is allowed and sometimes correct,
               but it must be justified in notes. If you are labelling a sales
               or interview turn "advisor", stop and check: is the user really
               being given advice, or are they being given words to say?
task           answer | explain | create | debug | summarize | compare | rewrite
               | plan | research | extract | none
               MUST be "none" whenever needs_response is "no".
secondary_tasks  Additional tasks for genuinely multi-intent turns, else [].
                 "find the bug and give me the fixed implementation" is
                 task=debug with secondary_tasks=["create"].
mode_intent    One of the mode's own labels, listed below.
answer_form    code | fact | explanation | example | recommendation | summary
               | rebuttal | steps | table | none
grounding      profile | mode_files | knowledge_base | conversation_memory | none
               You may ONLY use "mode_files" when mode_has_reference_files is
               true for that row. If it is false, "mode_files" is forbidden.
capabilities   any of conversation_context, screen, files, retrieval, web, tools
current_information  true only if answering needs facts newer than a model's
                     training data (live prices, today's news, current headcount).

legacy_intent  Additionally map the turn onto the OLD eight-label taxonomy so the
               control model can be scored: coding | clarification | follow_up |
               deep_dive | behavioral | example_request | summary_probe | general.
               Pick the closest. Most live non-questions map to "general".
`;

/**
 * Code-switching briefs.
 *
 * Both are Latin script, because that is what an English-trained STT model
 * emits when it hears Hindi or Malayalam: it transliterates rather than
 * switching alphabet, and it mangles the non-English words in characteristic
 * ways. Devanagari or Malayalam script in `input` would be wrong for this
 * pipeline, not more authentic.
 *
 * These are generated but NOT verified by a speaker of either language, so the
 * slices are reported separately and never gated on. A synthetic guess at
 * code-switching can look plausible to someone who does not speak it and still
 * be wrong about which words switch and where.
 */
export const LANGUAGE_BRIEFS = {
  hinglish: `LANGUAGE: HINGLISH (Hindi-English code-switching), as an English-trained
speech model transcribes it.

- Latin script only. Never Devanagari.
- Switch mid-sentence the way bilingual professionals actually do: English for
  technical nouns, Hindi for the connective and emotional tissue. "matlab", "toh",
  "haan", "nahi", "thoda", "abhi", "kya", "bas", "acha", "theek hai", "yaar",
  "kar diya", "ho gaya", "karna hai", "chahiye", "lagta hai", "pata nahi".
- Technical terms stay English: "deployment", "latency", "pull request", "sprint".
- The model mis-transcribes Hindi words it half-knows: "matlab" as "mutlub",
  "acha" as "archa", "theek" as "teek", "haan" as "han" or "hun". Use this in
  maybe one line in five.
- All the English STT rules still apply: no punctuation, no capitals, fillers,
  repairs, mid-sentence cuts.

Examples of the SHAPE (do not copy these):
  "toh matlab uh deployment kab hoga"
  "haan haan wo to ho gaya bas testing baaki hai"
  "nahi yaar thoda latency issue aa raha hai abhi"`,

  manglish: `LANGUAGE: MANGLISH (Malayalam-English code-switching), as an
English-trained speech model transcribes it.

- Latin script only. Never Malayalam script.
- Malayalam carries the grammar and the discourse markers, English carries the
  technical nouns: "enthaa", "alle", "aanu", "illa", "und", "pinne", "ippo",
  "sheri", "athu", "ithu", "cheyyam", "venam", "ariyilla", "nokkam", "mathi",
  "kittiyo", "parayu", "ok aanu".
- Malayalam agglutinates, so the model runs words together or splits them
  wrongly: "cheyyanam" as "cheyanam" or "cheyya nam", "ariyilla" as "ari illa",
  "enthaanu" as "entha anu". Use this in maybe one line in four, since it is
  more common than the Hindi case.
- Technical terms stay English: "database", "merge", "standup", "release".
- All the English STT rules still apply: no punctuation, no capitals, fillers,
  repairs, mid-sentence cuts.

Examples of the SHAPE (do not copy these):
  "athu enthaa uh ippo release cheyyan pattille"
  "sheri sheri njan nokkam pinne parayam"
  "illa database issue und ippo"`,
};

export function buildGenerationPrompt({ modeKey, spec, category, count, withFiles, language = 'en' }) {
  const cat = CATEGORY_BRIEFS[category];
  if (!cat) throw new Error(`unknown category ${category}`);

  return `You are building a benchmark corpus for a live-conversation intent router.

MODE: ${modeKey}
SITUATION: ${spec.scenario}
THE USER IS: the ${spec.userRole}, speaking on the microphone.
THE SYSTEM AUDIO CHANNEL CARRIES: the ${spec.systemCarries}.
REFERENCE FILES ATTACHED TO THIS MODE: ${withFiles ? 'YES' : 'NO'}
${withFiles ? '' : 'Because no files are attached, grounding MUST NOT be "mode_files" in any row.\n'}
ALLOWED mode_intent VALUES (use only these): ${spec.modeIntents.join(', ')}

WHAT TO GENERATE
${cat.brief}

Produce exactly ${count} rows.
${STT_RULES}
${language !== 'en' ? LANGUAGE_BRIEFS[language] ?? '' : ''}
${LABEL_RULES}

Also provide for each row:
- history: 2 to 4 prior turns, each prefixed "[SYSTEM] " or "[USER] ", also in
  raw STT style. These give the router context; make them a coherent lead-in.
- app_state.question_pending: is an unanswered question already outstanding
- app_state.coding_task_active: is a coding problem currently being worked
- app_state.seconds_since_user_spoke: plausible integer, 0 to 300
- channel: "system" for anything the other party said, "mic" for the user's own
  speech, "typed" for something the user typed into the box
- notes: one short clause on why the labels are what they are, only where a
  reader might disagree. Otherwise "".

Vary sentence shape, topic and speaker mood across the ${count} rows. Do not
reuse the same opening words. Do not produce near-duplicate rows.`;
}

export const CATEGORY_BRIEFS = {
  no_response: {
    // The brief requires at least 40% of the corpus to be live events that need
    // no response. This is the category that makes the needs_response axis
    // measurable at all, and it is the one a naive generator underproduces.
    share: 0.40,
    brief: `Live transcript events that need NO RESPONSE. This is the most
important category and the hardest to get right. Every row here must be
needs_response="no", voice="silent", task="none".

Spread them across these kinds, roughly evenly:
- backchannels and acknowledgements from the other party: "mhm", "right right",
  "yeah exactly", "got it", "ok sure"
- the other party thinking aloud mid-sentence, not addressing the user
- two other people on the call talking to EACH OTHER, not to the user
- the USER'S OWN speech on their own microphone channel (channel="mic") that is
  not a question to the assistant. The assistant must not answer the user's own
  words back at them.
- meeting admin: scheduling, "can everyone hear me", "let me share my screen"
- noise, crosstalk, half-captured fragments that carry no intent`,
  },
  normal_request: {
    share: 0.20,
    brief: `Straightforward turns that clearly DO need a response: a direct
question or request to the user, in this mode's normal register.`,
  },
  fragment: {
    share: 0.12,
    brief: `Conversational fragments that only make sense against the history:
"why", "what about the second one", "make that simpler", "and the other one",
"how come", "says who". The history you provide must make the referent clear.`,
  },
  ambiguous: {
    share: 0.10,
    brief: `Genuinely ambiguous turns where a careful human could reasonably
label needs_response either "yes" or "optional": "make it better", "is this
good", "hmm i wonder", "that seems off". Use needs_response="optional" where it
truly is optional. These exist to measure calibration, so do not resolve the
ambiguity artificially.`,
  },
  multi_intent: {
    share: 0.08,
    brief: `Turns carrying TWO OR MORE tasks: "find the bug and give me the fixed
implementation", "summarise that and tell me what you would push back on".
Set task to the primary one and secondary_tasks to the rest.`,
  },
  trap: {
    share: 0.10,
    brief: `ADVERSARIAL PAIRS. For each pair, produce two rows that are
superficially similar in wording but must receive DIFFERENT labels. Make the
surface similarity real, so a keyword matcher gets one of them wrong. Put the
distinguishing reason in notes for both rows of the pair.`,
  },
};

/** Mode-specific traps the brief requires by name. */
export const REQUIRED_TRAPS = {
  recruiting: [
    'the candidate says "we" repeatedly when describing solo work (red_flag), versus a candidate legitimately describing team work (candidate_answer_to_evaluate)',
    'the USER\'S OWN probe spoken on the mic channel (needs_response=no, the user is the interviewer) versus the candidate asking the user a question (candidate_question, needs_response=yes)',
  ],
  'team-meet': [
    '"evin hows the export feature coming along" addressed to the user by name (called_on_for_status, needs_response=yes) versus "hows the export feature coming along" addressed to someone else (discussion_noise, needs_response=no)',
  ],
  lecture: [
    'a rhetorical question the lecturer answers themselves (question_to_room, needs_response=no) versus a real question put to the room that the user may want to answer (question_to_room, needs_response=optional or yes)',
  ],
  sales: [
    '"were happy with what we have" (satisfied_customer) versus "were not looking right now" (objection_timing) — different objections, different rebuttals',
  ],
  'call-center': [
    'the SAME underlying issue stated calmly (issue_description) versus stated with real frustration (frustration_escalation) — both need a response, but different answer_form',
  ],
  'technical-interview': [
    '"can you optimize that" (optimization_probe) versus "whats the complexity" (complexity_probe) versus the interviewer merely restating the problem (problem_restatement, usually needs_response=no)',
  ],
  general: [
    'each sensed scenario must appear: interview_answer, sales_objection, lecture_concept, meeting_capture, coding_question, factual_question, small_talk',
  ],
};


/**
 * Every example utterance that appears in these instructions.
 *
 * A generator asked for realistic speech will happily hand back the examples it
 * was shown. Measured at 5.4% of one full run, concentrated in exactly the
 * short universal lines the corpus most needs to be varied ("yeah exactly",
 * "right right", "make that simpler"). Those rows are worthless: they measure
 * the prompt rather than the language, and if any of these strings later
 * appears in a prompt-based candidate they are outright leakage.
 *
 * `generate.mjs` drops any row whose input matches one of these. The prompt
 * also asks the model not to copy them, but an instruction is a request and a
 * filter is a guarantee.
 */
export const PROMPT_EXAMPLE_STRINGS = new Set([
  'could you explain how the caching layer handles invalidation',
  'so could you uh explain how the cashing layer handles invalidation',
  'wait how does the the caching layer know when to',
  'whats the deal with invalidation there',
  'so the the thing is',
  'we could uh we could try',
  'i think i think thats right',
  'and then we just need to make sure that the',
  'twenty three', 'two thousand', 'q three',
  'mhm', 'right right', 'yeah exactly', 'got it', 'ok sure',
  'can everyone hear me', 'let me share my screen',
  'why', 'what about the second one', 'make that simpler', 'and the other one',
  'how come', 'says who',
  'make it better', 'is this good', 'hmm i wonder', 'that seems off',
  'find the bug and give me the fixed implementation',
  'summarise that and tell me what you would push back on',
  'evin hows the export feature coming along',
  'hows the export feature coming along',
  'were happy with what we have',
  'were not looking right now',
  'can you optimize that',
  'whats the complexity',
]);

/** Normalised membership test used by the generator's leakage filter. */
export function isPromptExample(input) {
  return PROMPT_EXAMPLE_STRINGS.has(String(input ?? '').toLowerCase().replace(/\s+/g, ' ').trim());
}
