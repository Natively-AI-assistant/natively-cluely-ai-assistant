// electron/llm/customContextClassifier.ts
//
// Backward-compatible custom-context categorisation (REPORT_TO_CHATGPT Phase 3).
//
// Custom context is stored today as a SINGLE trusted blob (Mode.customContext).
// The spec wants it split into three categories so the
// prompt can decide what to include per answer type:
//
//   - pinned     : short, broadly-useful user instructions ("speak concisely",
//                  "I'm a senior backend engineer"). Always safe to surface in a
//                  compressed form.
//   - searchable : facts/notes/docs that should only appear when relevant to the
//                  current question (longer, topical chunks).
//   - sensitive  : salary, confidential pricing, private metrics, hidden
//                  strategy. Only surfaced when the answerType genuinely needs it
//                  (negotiation/sales) — never leaked into a coding/identity turn.
//
// This module does NOT change storage. It is a PURE, read-time classifier over
// the existing blob, so old users keep working with zero migration. It splits on
// blank-line / bullet boundaries, tags each chunk by content heuristics, and
// exposes a selector that picks the categories an AnswerType is allowed to see.
// No I/O, no LLM, no embeddings — cheap enough for the live path and unit-testable.

import type { AnswerType } from './AnswerPlanner';
import {
  analyzeUserInstructions, hasFactSignature, isDirectiveShaped, isFirstPersonFact,
  parseInstructionLines, splitInstructionClauses, USER_INSTRUCTIONS_MAX_CHARS,
} from './userInstructionContract';

export type CustomContextCategory = 'pinned' | 'searchable' | 'sensitive';

export interface CustomContextChunk {
  text: string;
  category: CustomContextCategory;
  /**
   * Position in the user's original text. Selection re-sorts by it: grouping
   * by category hoisted every "pinned"-shaped paragraph above the rest, so
   * "When asked about pricing, follow this order." landed AFTER the steps it
   * introduces (reproduced 2026-09-20). The author's order is part of the
   * instruction. Optional so hand-built chunks in older callers still type-check.
   */
  index?: number;
  /** Machine reason for the tag (debug metadata only — safe, no raw content). */
  reason: string;
}

export interface ClassifiedCustomContext {
  pinned: CustomContextChunk[];
  searchable: CustomContextChunk[];
  sensitive: CustomContextChunk[];
  /** True when the blob held any sensitive chunk (for safety telemetry). */
  hasSensitive: boolean;
  /**
   * The user's text defines an answer FORMAT. Decided on the RAW blob: chunk
   * splitting strips bullet markers, and "For coding questions:" + a bulleted
   * list of steps is only recognisable as a format while the bullets exist.
   */
  definesAnswerFormat?: boolean;
}

// A chunk is "pinned" when it is a short directive — an instruction about HOW to
// answer rather than a fact to retrieve. Imperative openers + brevity are the
// signal. Kept deliberately small so long notes fall through to searchable.
const PINNED_MAX_CHARS = 160;
const PINNED_DIRECTIVE_RE =
  /^(always|never|please|use|prefer|avoid|keep|be |speak|respond|answer|don'?t|do not|make sure|remember|note:|tone:|style:|i am |i'?m |my role|my name is|call me)\b/i;

// Sensitive = compensation / confidential commercial data / private strategy.
// Matched per-chunk so only the sensitive lines are gated, not the whole blob.
// Deliberately broad: a false POSITIVE (a benign line gated to negotiation-only)
// is a minor relevance loss, but a false NEGATIVE leaks salary/pricing into a
// coding/behavioral answer — the exact failure this gate exists to prevent. The
// lexicon was hardened against real comp/pricing phrasings the original missed
// ("30 lakhs", "$185k base", "TC", "gross margins", "COGS", "do not disclose").
const SENSITIVE_RE =
  /\b(salar(?:y|ies)|compensation|\bctc\b|\blpa\b|\btc\b|lakhs?|\bcrore?s?\b|\bcr\b|base\s+(?:pay|salary)|total\s+comp(?:ensation)?|take[- ]?home|equity|stock|\brsu\b|options?\b|bonus|commission|severance|notice period|garden(?:ing)? leave|confidential|do not (?:share|disclose|reveal|leak)|don'?t (?:share|disclose|reveal)|keep (?:this )?(?:internal|private|confidential)|internal only|\bnda\b|under embargo|gross margins?|net margins?|\bmargins?\b|cost price|\bcogs\b|\bebitda\b|wholesale price|discount (?:floor|ceiling|limit|cap)|(?:price|pricing) (?:floor|cap)|floor price|list price|rack rate|\barr\b|\bmrr\b|\bacv\b|\btcv\b|churn|win rate|quota|burn rate|runway|cap table|valuation|rebate|take rate|bookings)\b/i;

// A money amount (₹/$/explicit unit + number, or number + comp unit) is treated
// as sensitive even when the surrounding word didn't match the lexicon —
// "I make 185k base", "₹30,00,000", "320k TC", "$50/seat" all trip this.
const MONEY_AMOUNT_RE =
  // Digit runs are BOUNDED ({0,24}): the unbounded `[\d,.]*` made this quadratic on
  // a long "1,1,1,…" blob (450 ms at 16k chars, measured) and this gate runs on
  // every live turn. No real amount is longer than 25 characters.
  /(?:[$₹€£]\s?\d[\d,.]{0,24}|(?<![\w.,])\d[\d,.]{0,24}\s?(?:k\b|m\b|mm\b|lpa\b|lakhs?\b|cr\b|crores?\b|usd\b|inr\b|million\b|\/(?:seat|user|month|mo|year|yr|seat\/mo)))/i;

const isSensitive = (chunk: string): boolean => SENSITIVE_RE.test(chunk) || MONEY_AMOUNT_RE.test(chunk);

// ── A PROTECTIVE INSTRUCTION IS NOT SENSITIVE DATA (2026-09-21) ─────────────
//
// "do not disclose our roadmap", "Never discuss salary in the first call", "When
// asked about salary expectations, give a range not a number" all trip the
// lexicon above — and were therefore WITHHELD from every ordinary answer. But
// they hold no data: they ARE the safeguard, and the model cannot obey a rule it
// never sees. What the gate exists to keep out is DATA — a figure, or a statement
// of fact ("Our EBITDA is up; keep this internal", "salary is confidential",
// "Do not disclose that our margin is 70 percent"). So a sentence is protective
// when it matches the lexicon, carries no figure, states nothing (no copula, no
// "that we/our ..."), and has an instruction in it.
//
// PASS 4 (a third blind tester, 2026-09-21): the first version checked only for
// DIGITS, so "Do not disclose my salary of forty lakhs", "Do not disclose the
// layoffs planned for March" and "Do not reveal we're raising at a hundred crore"
// all rode the exemption into sales and behavioural answers. The exemption now
// requires ZERO data signals: no number in digits OR WORDS, no money/percent unit,
// no named entity, no time reference, no event, no statement (contractions too).
const STATEMENT_RE = /\b(?:is|are|was|were|has|have|had|being|hai|hain|tha|thi)\b|\bthat\s+(?:we|our|i|my|the|they|it)\b|\b(?:we|i|it|they|he|she|that|there)['’](?:re|m|s|ve|d|ll)\b/i;
const NUMBER_WORD_RE = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakhs?|lacs?|crores?|million|billion|half|halved|doubled?|tripled?|zeroed|ek|teen|chaar|paanch|das|bees|tees|chalis|pachas|saath|sattar|assi|nabbe|sau|hazaar)\b/i;
const MONEY_UNIT_RE = /\b(?:lpa|percent|per\s*cent|dollars?|rupees?|rs|inr|usd|eur|per\s+annum|a\s+seat|per\s+seat|bucks)\b/i;
const TEMPORAL_RE = /\b(?:next|last|this|coming)\s+(?:week|month|quarter|year|sprint)\b|\b(?:january|february|march|april|june|july|august|september|october|november|december|q[1-4])\b|\b(?:months?|weeks?|quarters?|years?)\s+(?:left|ago|away|in\s+a\s+row)\b/i;
const EVENT_RE = /\b(?:resign\w*|acquir\w*|acquisition|layoffs?|laid\s+off|fired|raising|down\s+round|pip|merger|bankrupt\w*|lawsuit|sued|churn(?:ed|ing)|lost|losing|missed|severance|zeroed|halved|spik\w*|plung\w*|surg\w*|declin\w*|dropp\w*|slump\w*|hike[ds]?|cuts?|delay(?:ed|s)?|slipp\w*|breach\w*|outage|leak(?:ed)?)\b/i;
const carriesDataSignal = (t: string): boolean =>
  /\d/.test(t) || /[$₹€£%]/.test(t) || STATEMENT_RE.test(t) || NUMBER_WORD_RE.test(t) || MONEY_UNIT_RE.test(t)
  || TEMPORAL_RE.test(t) || EVENT_RE.test(t) || namesAnyEntity(t);
const isProtectiveInstruction = (sentence: string): boolean =>
  isSensitive(sentence) && !carriesDataSignal(sentence) && splitInstructionClauses(sentence).some(isDirectiveShaped);
/** One sentence carries sensitive DATA (as opposed to merely naming a sensitive topic in a rule). */
const isSensitiveSentence = (sentence: string): boolean => isSensitive(sentence) && !isProtectiveInstruction(sentence);
/** Any sentence of the text carries sensitive data. A text whose sensitivity only shows ACROSS sentences counts too. */
const hasSensitiveData = (text: string): boolean => {
  if (!isSensitive(text)) return false;
  const sentences = parseInstructionLines(text).flatMap(l => l.sentences);
  return sentences.some(isSensitiveSentence) || !sentences.some(isSensitive);
};

const isLikelyDirective = (chunk: string): boolean =>
  chunk.length <= PINNED_MAX_CHARS && PINNED_DIRECTIVE_RE.test(chunk.trim());

// ── FORMAT DIRECTIVES (RC-2, live session C 2026-08-21) ────────────────────
// An OUTPUT-FORMAT directive is an instruction about how the assistant's
// answers should be produced (language, length, style) — as opposed to a FACT
// to be woven into an answer. The coding-forbidden gate below exists to keep
// FACTS out of self-contained algorithm answers; a format directive cannot
// contaminate one, and coding turns are exactly where it matters ("ALL the
// technical code should be in Cpp" reached zero coding answers live — every
// coding press emitted Python).
//
// Shape: a deontic/imperative signal + a reference to the assistant's OUTPUT,
// kept short (long paragraphs are notes, not directives). Sensitive chunks are
// classified sensitive BEFORE this ever runs, so a salary "directive" can
// never ride this lane.
// ── THE FORBIDDEN-TYPE GATE IS A WHITELIST (2026-09-20, second pass) ────────
//
// The first widening of this gate kept a WHOLE chunk as soon as it found any
// instruction in it, and blacklisted facts by pattern. An independent
// adversarial pass (~1,400 executed calls) walked straight through both:
// "Answer in 100 words. The candidate has 8 years at Google." delivered the
// fact to a coding turn, and 28 first-person phrasings the fact regex had never
// heard of ("I previously worked at…", "Am working at…") rode along with any
// directive in the same paragraph.
//
// A blacklist of facts cannot be completed. So on a self-contained answer the
// gate now keeps ONLY what is positively instruction-shaped, sentence by
// sentence — and, when a sentence also carries a fact, clause by clause ("I am
// preparing for interviews so always answer in Java" keeps the second clause).
// Everything else is dropped without having to be recognised as anything.
// Was 200, then 320: a run-on instruction is still an instruction, and the fact /
// entity / sensitive checks below — not length — are what keep notes out.
const FORMAT_DIRECTIVE_SENTENCE_MAX_CHARS = 800;
const DIRECTIVE_OUTPUT_SUBJECT_RE = /\b(code|coding|answers?|responses?|repl(?:y|ies)|outputs?|solutions?|explanations?|questions?|words?|sentences?|lines?|paragraphs?|bullets?(?:\s+points?)?|language|format|style|structure|template|headings?|headers?|sections?|steps?|numbered|markdown|tables?|examples?|tone|voice|persona|concise(?:ly)?|brief(?:ly)?|short|detailed|detail|depth|elaborate|points?|paras?|formal(?:ly)?|casual(?:ly)?|simple|simply|plain|jargon|dry[- ]?run|complexity|approach|problem|variables?|naming|names|comments?|functions?|readable|idiomatic|recursion|iterative|edge\s+cases?|trade-?offs?|assumptions?|spanish|english|french|german|hindi|malayalam|java|javascript|typescript|python|c\+\+|cpp|c#|golang|rust|kotlin|swift|ruby|php|scala|sql)\b/i;

// A chunk that TELLS the assistant to inject content ("Always mention that I
// prefer remote work in your answers") is a FACT-bearing behavioral
// instruction, not a format directive — admitting it through the forbidden
// gate contaminates self-contained coding answers with personal facts
// (code-review 2026-08-22, verified against the built classifier).
//
// 2026-09-20: this used to end `|\bmy\b|\bme\b`, a proxy for "first-person
// fact" that also fired on imperatives where they are mere OBJECTS — "Give me
// all code in Java only" — and dropped them from every coding turn. It also
// knew only a handful of verbs ("bring in", "drop in", "tell the interviewer
// about" walked past it), and it blocked the legitimate "Always mention time
// complexity". An injection verb is now fine exactly when its object is
// TECHNICAL and nobody's person is in the sentence.
const DIRECTIVE_CONTENT_BEARING_RE = /\b(mention|highlight|emphasi[sz]e|bring\s+(?:up|in)|say\b[^.\n]{0,40}\bthat|state\s+that|note\s+that|point\s+out|(?:^|\b(?:to|never|not|don'?t|dont|always|please|and|or|must|should)\s+)(?:reference|cite)\b|talk\s+about|tell\s+(?:the|them|him|her)\b|drop\s+in|slip|work\s+in|weave|plug|name-?drop|showcase|promote|relate\b[^.\n]{0,40}\bto|reflect|add\s+(?:a\s+)?(?:sentence|line|note|point|word)s?\s+(?:about|on)|include\s+(?:that|my|the\s+fact|a\s+(?:sentence|line|note))|(?:a\s+)?(?:line|sentence|note|word)\s+about|(?:start|begin|open|end|close|finish|conclude|sign\s+off)\b[^.\n]{0,40}\b(?:with|as|by)\b)/i;
// What such a verb may legitimately point at: technical content, or a PART of
// the answer ("Start with the approach", "End with a one-line summary").
const TECHNICAL_OBJECT_RE = /\b(time|space|complexit(?:y|ies)|big[- ]?o|edge\s+cases?|corner\s+cases?|trade-?offs?|assumptions?|test\s+cases?|examples?|approach(?:es)?|algorithms?|data\s+structures?|invariants?|pitfalls?|variables?|naming|comments?|constraints?|optimi[sz]ations?|alternatives?|brute\s+force|runtime|memory|thread\s+safety|concurrency|code|summary|recap|tl;?dr|restatement|problem|question|takeaways?|dry[- ]?run|steps?|explanation|intuition|pseudo-?code|headings?|bullets?)\b/i;
const PERSON_RE = /\b(?:I|my|me|mine|our|we|us)\b/i;
// A named entity beside an injection verb is content no matter what else the
// sentence mentions: "Always weave RedisMart into the explanation" has a
// perfectly technical object and still exists to plant "RedisMart". Languages,
// spoken languages and section names are capitalised too and are not entities.
const NOT_AN_ENTITY_RE = /^(?:Java|JavaScript|TypeScript|Python|Kotlin|Swift|Rust|Ruby|Scala|Dart|Go|Golang|Cpp|Sql|Php|English|Spanish|French|German|Hindi|Malayalam|Tamil|Telugu|Approach|Technique|Code|Dry|Run|Complexity|Problem|Idea|Steps?|Summary|Example|Edge|Cases?|Interviewer|Follow|Points?|Big|Markdown|LeetCode|HackerRank|Time|Space|British|American|Indian|Hinglish|Format|Answer|Output)$/;
const namesAnEntity = (raw: string): boolean =>
  namesKnownOrg(withoutNonEntities(raw)) || withoutNonEntities(raw).split(/[^A-Za-z-]+/).slice(1).some(w => /^(?:[a-z]+-)?[A-Z][a-z]+(?:[A-Z][a-z]+)*$/.test(w) && !NOT_AN_ENTITY_RE.test(w));
// A PROHIBITION cannot inject: "Do not cite sources", "Never reference the
// screen" forbid content. (A named entity or a person in the sentence still
// blocks it — "Never forget to slip RedisMart into answers".)
const NEGATED_INJECTION_RE = /\b(?:never|not|don'?t|dont|do\s+not|avoid|no|stop|without)\s+(?:\w+\s+){0,2}?(?:mention|highlight|emphasi[sz]e|bring|say|state|note|point|reference|cite|talk|tell|plug|showcase|promote|start|begin|open|end|close|finish|conclude|sign)\b/i;
const injectsContent = (t: string): boolean => {
  if (!DIRECTIVE_CONTENT_BEARING_RE.test(t)) return false;
  // "End with a follow-up question I can ask the interviewer": the "I" belongs to a
  // relative clause about how the OUTPUT will be used, not to a fact about the user.
  const withoutUseClause = t.replace(/\bI\s+(?:can|could|should|might|may|will|would)\s+\w+/gi, ' ');
  if (PERSON_RE.test(withoutUseClause) || namesAnEntity(t)) return true;
  if (NEGATED_INJECTION_RE.test(t)) return false;
  return !TECHNICAL_OBJECT_RE.test(t);
};

const carriesFact = (t: string): boolean => isFirstPersonFact(t) || hasFactSignature(t);
const PRIVATE_LABEL_RE = /\b(?:pay|package|secret|confidential|revenue|profit|loss|losses|budget|margins?|password|passcode|pin|phone|mobile|email|address|age|dob|notice\s+period|visa|employer|company|client|customer)\b/i;
// "If I am stuck give a hint first, not the answer." — the imperative sits INSIDE the condition clause.
const CONDITIONAL_IMPERATIVE_RE = /\b(?:if|when|whenever|unless|in\s+case|once)\b[^,.;]{3,60}?\b(?:give|tell|show|explain|answer|list|compare|mention|ask|use|keep|say|offer|suggest|provide|state|walk|start|stop|skip|add|write)\b/i;
const CONDITION_LEAD_RE = /^(?:if|when|whenever|unless|in\s+case|once|after|before|while)\b/i;
const CODE_LANGUAGE_NAME_RE = /(?<![A-Za-z])(?:java|javascript|typescript|python|c\+\+|cpp|c#|golang|kotlin|sql|php)(?![A-Za-z])/i;

// ── THE GATE KEYS ON CONTENT, NOT ON INSTRUCTION VERBS (second pass, 2026-09-21) ──
//
// The first whitelist asked "does this LOOK like an instruction?" — a list of
// imperative verbs plus an "output" noun. A second independent tester found it
// dropped 42 of 140 plausible coding instructions (30%): "O(n) only.", "Return -1
// if not found.", "Use ArrayList not arrays.", "Follow PEP8.", every conditional
// ("If the question is unclear, list your assumptions."), and all eight Hinglish
// ones ("pehle approach batao phir code"). No verb list is ever complete, in any
// language.
//
// What the gate protects against is CONTENT reaching a self-contained answer:
// who the user is, where they work, their numbers, their money. Content has
// signals that instructions almost never carry — a named entity, a figure, a
// fact signature, "my <project/deal/name>", a sensitive term, an injection verb.
// So: a clause with none of those signals passes when it is instruction-shaped
// OR simply short and not a statement; a clause with any of them never does.
const CODE_IDENTIFIER_RE = /^(?:ArrayList|LinkedList|HashMap|HashSet|TreeMap|TreeSet|LinkedHashMap|PriorityQueue|ArrayDeque|Deque|Queue|Stack|List|Map|Set|StringBuilder|StringBuffer|String|Integer|Long|Double|Boolean|Character|Optional|Stream|Collections|Arrays|Math|Object|Solution|Node|TreeNode|ListNode|Scanner|System|Exception|Comparator|Iterator|Runnable|Thread|Vector|Pair|Tuple|Counter|Dict|None|True|False|NumPy|Pandas|React|Promise|Array|Number|Date|Error|Trie|Heap|Graph|Tree|Union|Find|Dijkstra|Kadane|Fibonacci|Floyd|Bellman|Ford|Kruskal|Prim|Morris|Boyer|Moore|Knuth|Manacher|Fenwick|Tarjan|Hindi|Tamil|Telugu|Kannada|Marathi|Bengali|Gujarati|Punjabi|Urdu|Arabic|Chinese|Japanese|Korean|Portuguese|Italian|Russian)$/;
// A capital letter is the only lexical sign of a name, and people type names in
// lower case: "code like a stripe engineer", "the razorpay naming convention",
// "as enforced at zerodha". A short list of UNAMBIGUOUS employer / product names
// closes the common cases (the third tester's probes are full of them). Ambiguous
// ones are deliberately absent: "meta", "apple", "oracle" (a database), "ola",
// "cred", "uber" all have ordinary meanings a coding instruction can use.
const KNOWN_ORGS = new Set('google googler amazon microsoft facebook netflix stripe flipkart infosys tcs wipro cognizant accenture capgemini deloitte razorpay zerodha swiggy zomato paytm meesho phonepe byju byjus freshworks zoho hotstar myntra nykaa adobe salesforce atlassian walmart samsung ibm hcl mindtree mphasis goldman jpmorgan linkedin twitter spotify airbnb redismart'.split(' '));
/** Tokens, with camelCase split, so "meeshoCart" and "Flipkart-grade" both show their name. */
const nameTokens = (t: string): string[] =>
  t.split(/[^A-Za-z]+/).filter(Boolean).flatMap(w => w.split(/(?<=[a-z])(?=[A-Z])/)).map(w => w.toLowerCase());
const namesKnownOrg = (t: string): boolean => nameTokens(t).some(w => KNOWN_ORGS.has(w));
const isEntityWord = (w: string): boolean =>
  /^(?:[a-z]+-)?[A-Z][a-z]+(?:[A-Z][a-z]+)*(?:-[a-z]+)?$/.test(w) && !NOT_AN_ENTITY_RE.test(w) && !CODE_IDENTIFIER_RE.test(w);
/** A capitalised word that is not a language, a section name or a code identifier. The first word is a sentence start — unless the clause is too short to be a sentence. */
// A published STYLE GUIDE is named after a company and is still just a style:
// "Follow Google Java style", "Use Airbnb style for JavaScript", "Follow PEP 8".
const STYLE_GUIDE_RE = /\b(?:the\s+)?(?:google|airbnb|oracle|microsoft|mozilla|apple|uber|jetbrains|linux(?:\s+kernel)?|standard)\s+(?:(?:java|javascript|typescript|python|c\+\+|go|kotlin|swift|shell|html|css)\s+)?(?:style(?:\s+guide)?|guidelines?|conventions?|coding\s+standards?)\b|\beffective\s+java\b|\bclean\s+code\b|\bpep\s?-?8\b/gi;
// In a PROHIBITION, a quoted phrase is something the model must NOT say —
// "Don't say 'Great question'" plants nothing. (In "Always say 'As a RedisMart
// veteran'" the quote IS the payload, so it is only stripped under a negator.)
const PROHIBITION_LEAD_RE = /^\s*(?:never|do\s+not|don'?t|dont|avoid|stop|no)\b/i;
// The apostrophe in "Don't" is not an opening quote: a quote mark must not touch a letter on its outside.
const QUOTED_RE = /"[^"]{1,80}"|(?<![A-Za-z])'[^']{1,80}'(?![A-Za-z])|“[^”]{1,80}”|‘[^’]{1,80}’/g;
// PASS 4: a DOUBLE negation makes the quote the payload ("No answer without 'Rahul
// Verma, Infosys'", "Do not forget the signature ..."), and so does a positive
// clause riding the prohibition ("Never write "tmp", always write "Infosys""). So
// the quotes are ignored only when there is no such marker AND nothing but
// connectors follows the first quote ("Sure" or "Certainly").
const QUOTE_BECOMES_PAYLOAD_RE = /\b(?:without|forget\w*|lack\w*|skip\w*|omit\w*|miss\w*|fail\w*|unless|except|other\s+than|but|only|instead)\b/i;
const quotesAreInert = (t: string): boolean => {
  if (!PROHIBITION_LEAD_RE.test(t) || QUOTE_BECOMES_PAYLOAD_RE.test(t)) return false;
  const first = t.search(QUOTED_RE);
  QUOTED_RE.lastIndex = 0;
  if (first < 0) return false;
  return /^[\s,;.!]*(?:(?:or|and|nor)[\s,;.!]*)*$/i.test(t.slice(first).replace(QUOTED_RE, ' '));
};
const withoutNonEntities = (t: string): string =>
  (quotesAreInert(t) ? t.replace(QUOTED_RE, ' ') : t).replace(STYLE_GUIDE_RE, ' style ');
const SETTING_LABEL_RE = /^(?:Tone|Length|Style|Format|Language|Voice|Persona|Mode|Note|Rules?|Output|Answers?|Code|Plain|Short|Long|Simple|Steps?|Depth|Level|Audience)$/;
const namesAnyEntity = (raw: string): boolean => {
  const t = withoutNonEntities(raw);
  const words = t.split(/[^A-Za-z-]+/).filter(Boolean);
  // The first word is normally just a sentence start. In a clause too short to be
  // a sentence it may BE the content ("Google", "Alpha") — unless it is an
  // instruction word or a setting label ("Be brief", "No emojis", "Tone: friendly").
  const first = words[0] || '';
  const checkFirst = words.length <= 2 && !isDirectiveShaped(first) && !SETTING_LABEL_RE.test(first);
  // The hyphen-suffix form ("Flipkart-grade") is for words INSIDE a sentence: as a first
  // word it would make "In-place only." a name.
  return namesKnownOrg(t) || words.slice(1).some(isEntityWord) || (checkFirst && isEntityWord(first) && !first.includes('-'));
};
// A figure that is somebody's data: a long number, or a number with a people /
// money / tenure unit. "Java 17", "O(n)", "-1", "0-based", "4 space", "2
// approaches" and a resolved answer length are not.
const CONTENT_NUMBER_RE = /\d{4,}|\d[\d,.]*\s*(?:%|k\b|l\b|lacs?\b|lpa\b|lakhs?\b|cr\b|crores?\b|users?\b|customers?\b|clients?\b|people\b|employees\b|engineers?\b|years?\b|yrs?\b|months?\b|million\b|billion\b)/i;
// "my Swiggy project", "the HDFC deal", "my name Rahul Verma" — the noun gives it
// away even when the name is ALL CAPS (which emphasis also is).
// (`name` only after my/our: "the pattern name" is a technical noun, "my name Rahul" is not.)
const CONTENT_NOUN_RE = /\b(?:my|our|the)\s+(?:[\w-]+\s+){0,2}(?:deal|project|account|client|customer|company|employer|offer|product|startup|resume|résumé|cv|manager|boss)\b|\b(?:my|our)\s+(?:[\w-]+\s+){0,2}name\b/i;
const SUBJECT_STATEMENT_RE = /^(?:we|our|they|their|he|she|it|this|that|these|those|i|my|you\s+are|the\s+(?:company|role|product|team|candidate|interviewer|jd|client|customer))\b/i;
const COPULA_RE = /\b(?:is|are|was|were|has|have|had)\b/i;

// "we / our / us" is the COMPANY speaking: "Secret: we lose money on every unit"
// is instruction-shaped only because "every" is a deontic word.
const COMPANY_VOICE_RE = /\b(?:we|our|ours|us)\b/i;
// An e-mail address, a domain, a reverse-DNS package: "com.infosys.rahul" names an
// employer and a person without one capital letter. (Two dots, so "node.js" is not one.)
const CONTENT_IDENTIFIER_RE = /[\w.+-]+@[\w-]+\.[\w.-]+|\b[a-z][\w-]*(?:\.[a-z][\w-]*){2,}\b|\bhttps?:\/\//i;
const carriesContent = (t: string): boolean =>
  CONTENT_IDENTIFIER_RE.test(t) || hasSensitiveData(t) || carriesFact(t) || injectsContent(t) || namesAnyEntity(t) || CONTENT_NOUN_RE.test(t) || COMPANY_VOICE_RE.test(t)
  || (CONTENT_NUMBER_RE.test(t) && !analyzeUserInstructions(t).length);

/**
 * One sentence OR clause is an instruction and carries nothing else. `lenient`
 * admits the unshaped short lane and is for WHOLE sentences only: a fragment
 * rescued from a sentence that was rejected ("My main project is Natively, a
 * meeting copilot." -> "a meeting copilot.") is the tail of a fact, and must be
 * instruction-shaped in its own right.
 */
const isDirectiveSentence = (text: string, lenient = true): boolean => {
  const t = (text || '').trim();
  if (!t || t.length > FORMAT_DIRECTIVE_SENTENCE_MAX_CHARS || carriesContent(t)) return false;
  const a = analyzeUserInstructions(t);
  if (a.length || a.bindsProgrammingLanguage || a.layout) return true;
  if (isDirectiveShaped(t)) return true;
  if (!lenient) return false;
  // Not recognisably imperative — another language, a bare setting ("Tone:
  // friendly."), a terse constraint. Short, and not a statement about someone.
  // This lane has no instruction SHAPE to vouch for it, so it is stricter than
  // the shaped one: nobody's person in it, and no private-data label ("Current
  // pay: 32L fixed.", "Secret: we lose money on every unit." both rode it).
  // (Bare "me" is excluded from the person test here: in "Hindi me samjhao" it is
  // the Hindi postposition "in"; an English "me" is the object of an imperative,
  // which takes the shaped lane above.)
  if (t.split(/\s+/).length > 12 || SUBJECT_STATEMENT_RE.test(t) || /\b(?:I|my|mine|myself)\b/i.test(t) || PRIVATE_LABEL_RE.test(t)) return false;
  // A copula normally marks a statement ("Password for the demo is hunter2"); a
  // statement ABOUT THE CODE is a permission or constraint ("Java 17 features are ok").
  return !COPULA_RE.test(t) || CODE_SCOPED_RE.test(t) || CODE_LANGUAGE_NAME_RE.test(t);
};

/** The instruction part of one sentence: all of it, its clean clauses, or ''. */
const keepDirectivePart = (sentence: string): string => {
  const t = (sentence || '').trim();
  if (!t) return '';
  if (isDirectiveSentence(t)) return t;
  const clauses = splitInstructionClauses(t);
  if (clauses.length < 2) return '';
  // A CONDITIONAL instruction is one instruction: "If the question is unclear,
  // list your assumptions." Its condition is not imperative, so the clause
  // filter used to keep only "list your assumptions." and lose the WHEN.
  if (CONDITION_LEAD_RE.test(t) && !carriesContent(t) && (clauses.slice(1).some(isDirectiveShaped) || CONDITIONAL_IMPERATIVE_RE.test(t))) return t;
  return clauses.filter(c => isDirectiveSentence(c, false)).join(', ');
};

// A heading or list item of a REAL format contract ("## Problem", "4. Complexity")
// is a label, not a sentence. Kept only under a format context and only when it
// is made of format vocabulary — so "Google" / "Alpha" never ride as "labels".
const FORMAT_LABEL_VOCAB_RE = /\b(big[- ]?o|problem|idea|approach|intuition|solution|code|complexity|time|space|dry[- ]?run|example|walk-?through|steps?|summary|explanation|edge\s+cases?|tests?|notes?|follow-?ups?|answer|restatement|plan|pseudo-?code|optimi[sz]ation|brute\s+force|trade-?offs?|result|output|input|key\s+points?|takeaways?|tl;?dr|recap|context|assumptions?)\b/i;
const isFormatLabel = (body: string): boolean =>
  body.split(/\s+/).length <= 8 && FORMAT_LABEL_VOCAB_RE.test(body) && !hasSensitiveData(body) && !carriesFact(body) && !injectsContent(body);

/**
 * The instruction-only remainder of a chunk, line structure preserved: a line
 * whose every sentence survives is returned VERBATIM (list marker included), a
 * line that loses sentences keeps its marker and the survivors. `formatContext`
 * is true when the user's text as a whole defines an answer format.
 */
/** A colon-terminated lead-in. It says nothing itself, so it is kept only when what it introduces is. */
export const isIntroLine = (line: string): boolean => {
  const t = (line || '').trim();
  return /:\s*$/.test(t) && t.length <= 160 && !hasSensitiveData(t) && !carriesFact(t) && !injectsContent(t) && !/\d/.test(t);
};

export const extractInstructionText = (chunk: string, formatContext = false, keepSentence: (s: string) => boolean = () => true): string => {
  const kept: string[] = [];
  let pendingIntro: string | null = null;
  const push = (line: string) => { if (pendingIntro) { kept.push(pendingIntro); pendingIntro = null; } kept.push(line); };
  for (const l of parseInstructionLines(chunk)) {
    if (hasSensitiveData(l.line)) { pendingIntro = null; continue; }
    if (isIntroLine(l.line) && keepDirectivePart(l.body) !== l.body) { pendingIntro = l.line; continue; }
    if (formatContext && (l.isListItem || l.sentences.length <= 1) && isFormatLabel(l.body) && keepSentence(l.body)) { push(l.line); continue; }
    const parts = l.sentences.map(keepDirectivePart).map(p => (p && keepSentence(p) ? p : ''));
    if (parts.length > 0 && parts.every((p, i) => p === l.sentences[i])) push(l.line);
    else if (parts.some(Boolean)) push(`${l.marker}${parts.filter(Boolean).join(' ')}`);
    else pendingIntro = null;
  }
  return kept.join('\n');
};

/** True when the WHOLE chunk is an output-format directive (nothing had to be removed). */
export const isFormatDirective = (chunk: string): boolean => {
  const t = (chunk || '').trim();
  if (!t) return false;
  return extractInstructionText(t, analyzeUserInstructions(t).definesAnswerStructure) === parseInstructionLines(t).map(l => l.line).join('\n');
};

/** Kept for callers of the first pass; the directive remainder of a mixed chunk. */
export const extractDirectiveSentences = (chunk: string): string => extractInstructionText(chunk);

// A directive that only makes sense for CODE ("Use Java only"). An identity
// answer is a spoken self-introduction: it should obey "Answer in 100 words" /
// "Respond in Spanish", and has no use for a coding-language rule.
const CODE_SCOPED_RE = /\b(code|coding|program(?:s|ming)?|algorithms?|dsa|leetcode|solutions?|functions?|methods?|snippets?|variables?|recursion|recursive|iterative|imports?|comments?|complexity|big[- ]?o|indentation|braces?|snake_case|camelcase|class|arrays?|hashmap|arraylist|data\s+structures?|in-?place|indexing|indexed|dry[- ]?run|brute\s+force|pep8|package|unit\s+tests?|main\s+method|compile|runtime)\b|\bO\(/i;
const isCodeScopedDirective = (text: string): boolean =>
  CODE_SCOPED_RE.test(text) || analyzeUserInstructions(text).bindsProgrammingLanguage;

/**
 * Split a raw custom-context blob into chunks. Prefers blank-line separated
 * paragraphs; if there are none, falls back to bullet/newline lines so a flat
 * list of notes still categorises per-line. Empty fragments are dropped.
 */
export const splitCustomContextChunks = (raw: string): string[] => {
  // Non-strings are "no context"; the bound keeps the quadratic detectors below
  // off pathological input (ModesManager caps what is DELIVERED at half this).
  const trimmed = (typeof raw === 'string' ? raw : '').slice(0, USER_INSTRUCTIONS_MAX_CHARS * 2).trim();
  if (!trimmed) return [];
  const byBlankLine = trimmed.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);
  if (byBlankLine.length > 1) return byBlankLine;
  // Single paragraph: split on bullet markers / newlines so a notes list still
  // categorises line-by-line (a salary line shouldn't taint a style line).
  // Drop fragments that are only bullet glyphs / punctuation after stripping.
  const hasWordChar = (s: string): boolean => /[A-Za-z0-9]/.test(s);
  const byLine = trimmed
    .split(/\n+/)
    // ONE marker, and only with whitespace after it: the old `[-*•\s]+` also ate
    // markdown emphasis, turning "- **Never** interrupt" into "Never** interrupt".
    .map(s => s.replace(/^\s*[-*•]\s+/, '').trim())
    .filter(s => s.length > 0 && hasWordChar(s));
  return byLine.length > 0 ? byLine : (hasWordChar(trimmed) ? [trimmed] : []);
};

/**
 * Classify a raw custom-context blob into pinned/searchable/sensitive chunks.
 * Pure and deterministic. Order of precedence per chunk: sensitive > pinned >
 * searchable (a short directive that also names salary is treated as sensitive
 * so it can never leak into a non-negotiation answer).
 */
export const classifyCustomContext = (raw: string): ClassifiedCustomContext => {
  const result: ClassifiedCustomContext = { pinned: [], searchable: [], sensitive: [], hasSensitive: false };
  result.definesAnswerFormat = analyzeUserInstructions(raw).definesAnswerStructure;
  splitCustomContextChunks(raw).forEach((chunk, index) => {
    // SENSITIVITY IS PER SENTENCE (2026-09-21). It was per chunk, so one sentence
    // naming salary/pricing deleted its whole paragraph on every ordinary turn:
    // "Be brief. Never discuss salary before they bring it up. End with a
    // question." came back EMPTY, and so did a 7,500-char paragraph containing one
    // such sentence. Sales and call-centre prompts are full of those words.
    let text = chunk;
    if (hasSensitiveData(chunk)) {
      const kept: string[] = []; const withheld: string[] = [];
      for (const l of parseInstructionLines(chunk)) {
        const safe = l.sentences.filter(sn => !isSensitiveSentence(sn));
        withheld.push(...l.sentences.filter(sn => isSensitiveSentence(sn)));
        if (safe.length === l.sentences.length) kept.push(l.line);
        else if (safe.length) kept.push(`${l.marker}${safe.join(' ')}`);
      }
      // A chunk whose sensitivity only shows ACROSS sentences stays wholly sensitive.
      if (withheld.length === 0) { withheld.push(chunk); kept.length = 0; }
      result.sensitive.push({ text: withheld.join(' '), category: 'sensitive', reason: 'matched_sensitive_terms', index });
      result.hasSensitive = true;
      text = kept.join('\n');
      if (!text || hasSensitiveData(text)) return;
    }
    if (isLikelyDirective(text)) {
      result.pinned.push({ text, category: 'pinned', reason: 'short_imperative_directive', index });
    } else {
      result.searchable.push({ text, category: 'searchable', reason: 'topical_fact_or_note', index });
    }
  });
  return result;
};

// Which answer types are permitted to see SENSITIVE custom context. Sensitive
// data (salary/pricing/strategy) is only justified for compensation and sales
// answers — never for coding, identity, behavioral, JD-fit, etc.
const SENSITIVE_ALLOWED_TYPES = new Set<AnswerType>([
  'negotiation_answer',
]);

// Answer types where NO custom context (not even pinned) should appear, because
// the answer is a self-contained algorithmic/identity artifact and any custom
// note risks polluting it. Mirrors AnswerPlanner's forbidden-layer rules for
// custom_context (coding/DSA/system-design/debugging forbid it).
const CUSTOM_CONTEXT_FORBIDDEN_TYPES = new Set<AnswerType>([
  'coding_question_answer',
  'dsa_question_answer',
  'system_design_answer',
  'debugging_question_answer',
  'identity_answer',
  // Code-review 2026-08-22: technical_concept_answer is in AnswerPlanner's
  // custom_context-forbidden group (forbiddenLayersFor), but was missing
  // here. Since the RC-2 fix made this classifier the sole gate on the
  // scoped fetch path, the omission let the full pinned+searchable blob ride
  // the system prompt on "what's a semaphore?"-class turns. Directives still
  // pass via the directive lane; facts are dropped, restoring parity.
  'technical_concept_answer',
]);

/** Restore the author's order (stable for chunks without an index). */
const inSourceOrder = (chunks: CustomContextChunk[]): CustomContextChunk[] =>
  chunks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => ((a.c.index ?? Number.MAX_SAFE_INTEGER) - (b.c.index ?? Number.MAX_SAFE_INTEGER)) || (a.i - b.i))
    .map(x => x.c);

export interface CustomContextSelection {
  /** Chunks selected to include, already category-gated for this answer type. */
  included: CustomContextChunk[];
  /** Categories that were excluded, with a reason (debug metadata, no content). */
  excluded: { category: CustomContextCategory; reason: string }[];
  /** True when a sensitive chunk was deliberately included (safety telemetry). */
  sensitiveIncluded: boolean;
}

/**
 * Select which classified chunks to surface for a given answer type. Pinned and
 * searchable are included for context-bearing answers; sensitive only for the
 * narrow set that needs it. Coding/identity answers get nothing (forbidden).
 *
 * `searchable` selection is intentionally NOT semantic here — that is the job of
 * the existing retrieval layer. This selector's contract is the CATEGORY GATE
 * (what an answer type is allowed to see), so a downstream retriever can still
 * narrow `included` further by relevance.
 */
export const selectCustomContextForAnswer = (
  classified: ClassifiedCustomContext,
  answerType: AnswerType,
): CustomContextSelection => {
  const excluded: CustomContextSelection['excluded'] = [];

  if (CUSTOM_CONTEXT_FORBIDDEN_TYPES.has(answerType)) {
    // RC-2 (session C, 2026-08-21): OUTPUT-FORMAT directives survive the gate
    // for coding/technical types — they are instructions about the answer's
    // shape, not facts that could contaminate a self-contained artifact, and
    // coding turns are exactly where they matter (live: "ALL the technical
    // code should be in Cpp" reached zero coding answers; every one emitted
    // Python). identity_answer keeps the historical full block: a scripted
    // self-intro has no use for a coding-language directive.
    //
    // 2026-09-20: a chunk is kept WHOLE when it is an instruction, and a chunk
    // that mixes instructions with facts in one paragraph contributes only its
    // directive sentences (facts, injected content and sensitive sentences
    // still never pass). identity_answer used to receive nothing at all, so
    // "Answer in 100 words" was ignored on "tell me about yourself"; it now
    // receives presentation directives that are not about code.
    const directives: CustomContextChunk[] = [];
    const keptWhole = new Set<string>();
    const candidates = [...classified.pinned, ...classified.searchable];
    // A single paragraph is split per LINE upstream, so a format contract's
    // steps arrive as separate chunks. Whether they are steps of a format is a
    // property of the user's text as a whole.
    const ordered = inSourceOrder(candidates);
    const formatContext = classified.definesAnswerFormat
      ?? analyzeUserInstructions(ordered.map(c => c.text).join('\n')).definesAnswerStructure;
    const keepSentence = answerType === 'identity_answer' ? (t: string) => !isCodeScopedDirective(t) : undefined;
    const extracted = ordered.map(c => extractInstructionText(c.text, formatContext, keepSentence));
    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i];
      // A one-line chunk that only INTRODUCES the next one ("For coding
      // questions:") is kept exactly when what it introduces survived.
      const text = extracted[i] || (isIntroLine(c.text) && extracted[i + 1] ? c.text : '');
      if (!text) continue;
      if (text === c.text) keptWhole.add(c.text);
      directives.push(text === c.text ? c : { text, category: c.category, reason: 'directive_sentences_of_mixed_chunk', index: c.index });
    }
    const pinnedDropped = classified.pinned.some(c => !keptWhole.has(c.text));
    const searchableDropped = classified.searchable.some(c => !keptWhole.has(c.text));
    if (pinnedDropped) excluded.push({ category: 'pinned', reason: 'forbidden_for_answer_type' });
    if (searchableDropped) excluded.push({ category: 'searchable', reason: 'forbidden_for_answer_type' });
    if (classified.sensitive.length) excluded.push({ category: 'sensitive', reason: 'forbidden_for_answer_type' });
    return { included: inSourceOrder(directives), excluded, sensitiveIncluded: false };
  }

  const included: CustomContextChunk[] = [...classified.pinned, ...classified.searchable];

  let sensitiveIncluded = false;
  if (classified.sensitive.length) {
    if (SENSITIVE_ALLOWED_TYPES.has(answerType)) {
      included.push(...classified.sensitive);
      sensitiveIncluded = true;
    } else {
      excluded.push({ category: 'sensitive', reason: 'not_relevant_to_answer_type' });
    }
  }

  return { included: inSourceOrder(included), excluded, sensitiveIncluded };
};

/**
 * Convenience: classify + select + render the included chunks back into a single
 * blob suitable for the existing single-string custom-context slot. Backward
 * compatible — when nothing is gated out this returns the same content the old
 * single-blob path would have used. Returns '' when nothing is selected.
 */
export const buildScopedCustomContext = (
  raw: string,
  answerType: AnswerType,
): { text: string; selection: CustomContextSelection; classified: ClassifiedCustomContext } => {
  const classified = classifyCustomContext(raw);
  const selection = selectCustomContextForAnswer(classified, answerType);
  const text = selection.included.map(c => c.text).join('\n');
  return { text, selection, classified };
};

/** PII-free summary of a selection for telemetry (counts + categories only). */
export const summarizeCustomContextSelection = (
  selection: CustomContextSelection,
  classified: ClassifiedCustomContext,
): Record<string, unknown> => ({
  pinned: classified.pinned.length,
  searchable: classified.searchable.length,
  sensitive: classified.sensitive.length,
  includedCount: selection.included.length,
  sensitiveIncluded: selection.sensitiveIncluded,
  excluded: selection.excluded.map(e => `${e.category}:${e.reason}`),
});
