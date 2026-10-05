import { SYSTEM_DESIGN_ACTION_INSTRUCTION, VISUAL_ACTIONS } from '../../llm/systemDesignAction';

export interface ActionTrigger {
    type: string;
    patterns: RegExp[];
    priority: number;
    label: string;
    promptInstruction: string;
    answerStyle?: {
        maxWords: number;
        format: 'bullets' | 'short_script' | 'code' | 'checklist' | 'summary';
        tone: string;
    };
}

const GENERAL_TRIGGERS: ActionTrigger[] = [
    {
        type: 'general_assistance_request',
        patterns: [
            /\b(can you help me|help me with|what should I say|how should I respond|how do I answer)\b/i,
        ],
        priority: 0.82,
        label: 'Suggest response',
        promptInstruction:
            'You are in General mode. The user needs help responding. Provide a concise, context-aware answer they can say out loud.',
        answerStyle: { maxWords: 100, format: 'short_script', tone: 'helpful' },
    },
    {
        type: 'general_summarize',
        patterns: [/\b(summarize this|recap this|quick summary|what did they say|what was decided)\b/i],
        priority: 0.78,
        label: 'Summarize discussion',
        promptInstruction:
            'You are in General mode. Summarize the relevant discussion into the fewest useful bullets.',
        answerStyle: { maxWords: 90, format: 'bullets', tone: 'neutral' },
    },
    {
        type: 'general_explain',
        patterns: [/\b(explain that|what does that mean|break that down|in simple terms)\b/i],
        priority: 0.76,
        label: 'Explain clearly',
        promptInstruction:
            'You are in General mode. Explain the current topic plainly and avoid inventing details not present in context.',
        answerStyle: { maxWords: 120, format: 'bullets', tone: 'clear' },
    },
];

const NEGOTIATION_TRIGGERS: ActionTrigger[] = [
    {
        type: 'budget_probe',
        patterns: [/\b(what'?s your budget|budget range|target price|price range|how much can you spend)\b/i],
        priority: 0.88,
        label: 'Handle budget probe',
        promptInstruction:
            'You are in Negotiation mode. Respond to a budget probe without anchoring too low. Ask a calibrated question and protect leverage.',
        answerStyle: { maxWords: 90, format: 'short_script', tone: 'calm' },
    },
    {
        type: 'price_pushback',
        patterns: [/\b(price is too high|too expensive|can you do better|lower the price|discount|cheaper)\b/i],
        priority: 0.9,
        label: 'Counter price pushback',
        promptInstruction:
            'You are in Negotiation mode. The other side is pushing on price. Defend value, trade concessions for commitments, and avoid unilateral discounting.',
        answerStyle: { maxWords: 100, format: 'short_script', tone: 'firm' },
    },
    {
        type: 'final_offer',
        patterns: [/\b(final offer|best and final|take it or leave it|last offer|walk away)\b/i],
        priority: 0.92,
        label: 'Respond to final offer',
        promptInstruction:
            'You are in Negotiation mode. Respond to a final-offer frame by testing constraints, preserving optionality, and proposing a concrete next move.',
        answerStyle: { maxWords: 90, format: 'short_script', tone: 'composed' },
    },
];

// Sales triggers
const SALES_TRIGGERS: ActionTrigger[] = [
    {
        type: 'pricing_objection',
        patterns: [/\b(expensive|too much|budget|price|cost|afford)\b/i],
        priority: 0.9,
        label: 'Handle pricing objection',
        promptInstruction:
            "You are in Sales mode. The prospect has raised a pricing concern. Provide a concise, confident response that addresses value over cost. Include a bridge to next steps.",
        answerStyle: { maxWords: 80, format: 'bullets', tone: 'confident' },
    },
    {
        type: 'competitor_mention',
        patterns: [/\b(Gong|Chorus|ZoomInfo|Salesloft|Outreach|Clari|yeah\.pm)\b/i],
        priority: 0.85,
        label: 'Handle competitor comparison',
        promptInstruction:
            "You are in Sales mode. The prospect mentioned a competitor. Position Natively's advantages confidently without disparaging the competitor.",
        answerStyle: { maxWords: 100, format: 'bullets', tone: 'confident' },
    },
    {
        type: 'buying_signal',
        patterns: [/\b(ready to move|send contract|legal review|next steps|schedule|finalize)\b/i],
        priority: 0.95,
        label: 'Seize buying signal',
        promptInstruction:
            "You are in Sales mode. The prospect is showing strong buying intent. Help finalize the next steps and create urgency.",
        answerStyle: { maxWords: 60, format: 'short_script', tone: 'enthusiastic' },
    },
    {
        type: 'roi_question',
        patterns: [/\b(ROI|return on investment|business case|payback|prove the value|value case)\b/i],
        priority: 0.88,
        label: 'Build ROI case',
        promptInstruction:
            'You are in Sales mode. The prospect is asking for ROI. Tie benefits to measurable business outcomes and ask for their success metric.',
        answerStyle: { maxWords: 100, format: 'bullets', tone: 'consultative' },
    },
    {
        type: 'pricing_request',
        patterns: [/\b(send me pricing|pricing page|quote|proposal|commercials|what does it cost)\b/i],
        priority: 0.86,
        label: 'Frame pricing request',
        promptInstruction:
            'You are in Sales mode. The prospect asked for pricing. Qualify scope before giving numbers and propose a concrete follow-up.',
        answerStyle: { maxWords: 90, format: 'short_script', tone: 'consultative' },
    },
];

// Recruiting triggers
const RECRUITING_TRIGGERS: ActionTrigger[] = [
    {
        type: 'candidate_concern',
        patterns: [/\b(visa|relocation|compensation|offer|start date|security|remote|hybrid)\b/i],
        priority: 0.85,
        label: 'Address candidate concern',
        promptInstruction:
            'You are in Recruiting mode. The candidate has raised a concern. Address it factually and empathetically.',
        answerStyle: { maxWords: 100, format: 'bullets', tone: 'empathetic' },
    },
    {
        type: 'strong_fit_signal',
        patterns: [/\b(excited|love this|exactly what|great fit|perfect match)\b/i],
        priority: 0.9,
        label: 'Reinforce positive signal',
        promptInstruction:
            "You are in Recruiting mode. The candidate is showing strong interest. Reinforce why this role is a great match.",
        answerStyle: { maxWords: 60, format: 'bullets', tone: 'encouraging' },
    },
    {
        type: 'candidate_experience_probe',
        patterns: [/\b(tell me about your experience|walk me through your background|why this role|why are you interested)\b/i],
        priority: 0.84,
        label: 'Guide candidate story',
        promptInstruction:
            'You are in Recruiting mode. Help assess and guide the candidate response around experience, motivation, and fit.',
        answerStyle: { maxWords: 100, format: 'bullets', tone: 'structured' },
    },
];

// Team Meeting triggers
const TEAM_TRIGGERS: ActionTrigger[] = [
    {
        type: 'action_item',
        patterns: [
            /\b(I'll do|I'll send|need to follow up|action item|assigned to|deadline|by Friday|by Monday)\b/i,
        ],
        priority: 0.9,
        label: 'Capture action item',
        promptInstruction:
            'You are in Team Meeting mode. Extract the action item: who will do what by when.',
        answerStyle: { maxWords: 50, format: 'bullets', tone: 'direct' },
    },
    {
        type: 'decision_point',
        patterns: [/\b(decided|going with|let's go|final decision|approved|confirmed)\b/i],
        priority: 0.85,
        label: 'Confirm decision',
        promptInstruction: 'You are in Team Meeting mode. Summarize the decision that was made.',
        answerStyle: { maxWords: 40, format: 'bullets', tone: 'neutral' },
    },
    {
        type: 'blocker_check',
        patterns: [/\b(any blockers|blocked by|stuck on|risk to timeline|what's blocking|dependency)\b/i],
        priority: 0.84,
        label: 'Clarify blocker',
        promptInstruction:
            'You are in Team Meeting mode. Identify the blocker, owner, impact, and next unblock step.',
        answerStyle: { maxWords: 70, format: 'checklist', tone: 'direct' },
    },
    {
        type: 'owner_deadline_check',
        patterns: [/\b(who owns this|owner for this|by when|timeline|ETA|due date)\b/i],
        priority: 0.83,
        label: 'Lock owner and deadline',
        promptInstruction:
            'You are in Team Meeting mode. Turn the discussion into an explicit owner, deliverable, and deadline.',
        answerStyle: { maxWords: 60, format: 'checklist', tone: 'direct' },
    },
];

// Interview triggers
const INTERVIEW_TRIGGERS: ActionTrigger[] = [
    {
        type: 'behavioral_question',
        patterns: [
            /\b(tell me about a time|describe a situation|STAR|leadership|challenge|succeeded|failed)\b/i,
        ],
        priority: 0.9,
        label: 'Answer with STAR story',
        promptInstruction:
            'You are in Interview mode. The interviewer asked a behavioral question. Structure your answer using the STAR method (Situation, Task, Action, Result) with specific metrics.',
        answerStyle: { maxWords: 200, format: 'short_script', tone: 'confident' },
    },
    {
        type: 'intro_pitch',
        patterns: [/\b(tell me about yourself|walk me through your resume|introduce yourself)\b/i],
        priority: 0.88,
        label: 'Craft intro pitch',
        promptInstruction:
            'You are in Interview mode. Create a crisp candidate intro that connects background, strengths, and why this role fits.',
        answerStyle: { maxWords: 160, format: 'short_script', tone: 'confident' },
    },
    {
        type: 'company_motivation',
        patterns: [/\b(why this company|why do you want to work here|why us|what interests you about us)\b/i],
        priority: 0.86,
        label: 'Answer company motivation',
        promptInstruction:
            'You are in Interview mode. Answer why this company using concrete signals from the conversation and avoid generic flattery.',
        answerStyle: { maxWords: 140, format: 'short_script', tone: 'authentic' },
    },
    {
        type: 'weakness_question',
        patterns: [/\b(strengths and weaknesses|biggest weakness|area for improvement|weakness)\b/i],
        priority: 0.84,
        label: 'Handle weakness question',
        promptInstruction:
            'You are in Interview mode. Answer the weakness question honestly with a real mitigation and evidence of progress.',
        answerStyle: { maxWords: 140, format: 'short_script', tone: 'reflective' },
    },
];

// Lecture triggers
const LECTURE_TRIGGERS: ActionTrigger[] = [
    {
        type: 'concept_explanation',
        patterns: [/\b(this is called|definition|define|formula|theorem|principle|concept|explain the concept)\b/i],
        priority: 0.85,
        label: 'Explain concept',
        promptInstruction:
            'You are in Lecture mode. Explain the concept clearly with a practical example.',
        answerStyle: { maxWords: 150, format: 'bullets', tone: 'educational' },
    },
    {
        type: 'worked_example',
        patterns: [/\b(example of|for example|worked example|sample problem|practice problem)\b/i],
        priority: 0.82,
        label: 'Create worked example',
        promptInstruction:
            'You are in Lecture mode. Turn the concept into a worked example with steps and the intuition behind each step.',
        answerStyle: { maxWords: 180, format: 'bullets', tone: 'educational' },
    },
];

// Technical Interview triggers
const TECHNICAL_TRIGGERS: ActionTrigger[] = [
    {
        type: 'coding_problem',
        patterns: [/\b(implement|write code|solve|function|algorithm|data structure)\b/i],
        priority: 0.95,
        label: 'Solve coding problem',
        promptInstruction:
            'You are in Technical Interview mode. Provide a clear, efficient solution with time/space complexity analysis.',
        answerStyle: { maxWords: 300, format: 'code', tone: 'analytical' },
    },
    {
        type: 'screen_coding_problem',
        patterns: [/\b(screen|visible|shown|popup|error message|output|on screen)\b/i],
        priority: 0.92,
        label: 'Answer from screen',
        promptInstruction:
            'You are in Technical Interview mode. A coding problem is visible on the screen. Read the visible problem carefully and provide a solution.',
    },
    {
        type: 'complexity_analysis',
        patterns: [/\b(time complexity|space complexity|big o|runtime|optimize|more efficient)\b/i],
        priority: 0.9,
        label: 'Analyze complexity',
        promptInstruction:
            'You are in Technical Interview mode. Explain the complexity tradeoff clearly and suggest the next optimization path.',
        answerStyle: { maxWords: 180, format: 'bullets', tone: 'analytical' },
    },
    {
        type: 'system_design_prompt',
        patterns: [/\b(design a system|system design|architecture|scale to|distributed|throughput)\b/i],
        priority: 0.89,
        label: 'Structure system design',
        // The shared instruction (llm/systemDesignAction.ts): accepting this
        // action is a system-design ask, so it gets the same diagram contract
        // and renderer as a design question typed or heard on any route. The
        // engine recognises this exact text (isSystemDesignActionInstruction);
        // on Direct Assist it rides as the request's output instruction.
        promptInstruction: SYSTEM_DESIGN_ACTION_INSTRUCTION,
        answerStyle: { maxWords: 260, format: 'bullets', tone: 'analytical' },
    },
];

// ── Visual offers (nine-mode catalog, 2026-10-01) ───────────────────────────
//
// Each is offered only when the transcript shows the structure or the data the
// visual needs — steps being listed, two or more figures with units, a blocker
// being named — and sits below every mode-specific trigger in priority, so it
// never displaces one. Accepting it is an explicit visual request (see
// llm/systemDesignAction.ts); nothing is generated until then.
//
// Keys are the real mode template ids ('team-meet', 'call-center', …). The
// older tables above use different keys for some modes ('team_meeting',
// 'technical_interview'), which is why those never fire; that is left exactly
// as it was. The new keys below carry visual offers only.
const visualTrigger = (key: keyof typeof VISUAL_ACTIONS, patterns: RegExp[], priority: number): ActionTrigger => ({
    type: VISUAL_ACTIONS[key].type,
    patterns,
    priority,
    label: VISUAL_ACTIONS[key].label,
    promptInstruction: VISUAL_ACTIONS[key].instruction,
});

// Found in review (2026-10-01): the first patterns fired on ordinary talk —
// "first of all thanks for joining, then we can get started" (a workflow),
// "it depends on the weather" (dependencies), "born in 1990, moved here in
// 2015" (a timeline), "$50 a month or $500 a year" (figures to plot). A card is
// an interruption, so each now needs the structure itself, not one of its words.
const STEP_MARK = String.raw`(?:then|next|after that|second(?:ly)?|third(?:ly)?|finally|lastly|once that(?: is|'s) done)`;
const V_WORKFLOW = visualTrigger('workflow', [
    // A procedure being listed: an opening step and two more markers.
    // ("The first time I went there … then … and then" is a story, not a procedure.)
    new RegExp(String.raw`\b(?:first(?:ly)?(?! of all| time| place| thing| day| week| year| job| impression| glance)|step one)\b[^.?!]{0,160}\b${STEP_MARK}\b[^.?!]{0,160}\b${STEP_MARK}\b`, 'i'),
    /\b(?:the|our|their|your) (?:process|workflow|procedure) (?:(?:goes|works) like\b|is (?:that\b|as follows|first\b|we\b|you\b|they\b))/i,
    // A chain of hand-offs, not one ("it gets approved by my wife first").
    /\b(?:gets? (?:approved|signed off|reviewed) by|hands? (?:it )?off to)\b[^.?!]{3,100}\b(?:then|before|after that|and then|next|finally|who (?:then )?(?:sends|passes|hands|forwards|approves|signs))\b/i,
], 0.72);
const V_DATA_MODEL = visualTrigger('dataModel', [
    /\b(?:foreign key|primary key|one[- ]to[- ]many|many[- ]to[- ]many|data model|(?:two|three|four|several) tables|entit(?:y|ies) and (?:their )?relationships)\b/i,
], 0.74);
const FIGURE = String.raw`(?:[$€£₹]\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|percent|k\b|m\b|million|thousand|dollars|usd|users|tickets|customers))`;
// ("May" is left out: it is far more often the verb — "$50 may be enough".)
const PERIOD_LABEL = String.raw`\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|q[1-4]|(?:last|this|next) (?:week|month|quarter|year)|week \d+|(?:19|20)\d{2})\b`;
const V_FIGURES = visualTrigger('figures', [
    // A series: three figures with a unit in one utterance, said of something
    // that is measured (not "I paid $5 for coffee, $10 for lunch and $20 for
    // the cab") …
    new RegExp(String.raw`^(?=[^.?!]*\b(?:revenue|sales|users|tickets|customers|costs?|spend|budget|growth|rates?|conversion|churn|headcount|volume|traffic|sign-?ups|prices?|arr|mrr|pipeline|quota|margin|profit|usage|latency|errors?|score|nps|csat|bookings|leads|deals|orders)\b)[^.?!]*?(?:${FIGURE}[^.?!]{0,90}){3}`, 'i'),
    // … or two, each tied to a named period ("120 tickets in March to 134 in
    // April"). Two prices ("$50 a month or $500 a year") are not a series.
    new RegExp(String.raw`(?:${FIGURE}[^.?!]{0,30}${PERIOD_LABEL}[^.?!]{0,60}){2}`, 'i'),
], 0.7);
const V_SCENARIOS = visualTrigger('scenarios', [
    // A number that can be modelled: a rate or an amount, not a time of day
    // ("what if we push the call to 2 pm instead?").
    /\b(?:what if|best case|worst case|scenario|if (?:we|they|you) (?:grow|grew|increase|increased|reduce|reduced|cut|double|doubled))\b[^.?!]{0,90}(?:\d+(?:\.\d+)?\s?(?:%|percent|k\b|m\b|x\b|million|thousand)|[$€£₹]\s?\d)/i,
], 0.73);
const V_DEPENDENCIES = visualTrigger('dependencies', [
    // Work waiting on work. A bare "depends on" is how people say "maybe".
    /\b(?:blocked (?:by|on)|is blocking|are blocking|can'?t (?:start|ship|begin|proceed|release) until)\b/i,
    /\b(?:release|launch|migration|rollout|project|ticket|feature|team|task|milestone|deploy(?:ment)?|integration|sprint|work) (?:depends|is dependent|is waiting) on\b/i,
    /\bwaiting on\b[^.?!]{0,60}\b(?:team|review|approval|sign[- ]off|api|release|migration|design|legal|security|vendor|pr|ticket)\b/i,
], 0.74);
const V_TROUBLESHOOTING = visualTrigger('troubleshooting', [
    // (The caller's fault, not this call's: "sorry, my camera is not working today".)
    /^(?![^.?!]*\bmy (?:camera|mic|microphone|audio|video|headset|screen share|webcam)\b)[^.?!]*\b(?:not working|stopped working|keeps (?:dropping|crashing|failing|disconnecting|freezing)|error (?:code|message)|won'?t (?:connect|start|load|turn on|open)|can'?t (?:log ?in|connect|sign in|access))\b/i,
], 0.76);
// A year, not a quantity that looks like one ("we sold 2000 units, then 2010 units").
const YEAR = String.raw`\b(?:19|20)\d{2}\b(?!\s?(?:units|users|tickets|customers|dollars|usd|items|people|seats|orders|requests|records|rows|k\b|%|percent))`;
const DATED_EVENT_VERB = String.raw`\b(?:joined|started (?:at|as|with)|worked (?:at|for|as)|promoted|left|moved to|founded|launched|shipped|released|graduated|led|managed|acquired|migrated|rolled out|signed)\b`;
const V_TIMELINE = visualTrigger('timeline', [
    // Dated events being listed: three years, or two with something that
    // happened ("joined Acme in 2018 and moved to Globex in 2023"). Two years
    // alone are a remark ("born in 1990, moved here in 2015").
    new RegExp(String.raw`${YEAR}[^.?!]{0,140}${YEAR}[^.?!]{0,140}${YEAR}`),
    new RegExp(String.raw`^(?=[^.?!]*${DATED_EVENT_VERB})[^.?!]*${YEAR}[^.?!]{0,140}${YEAR}|[.?!]\s*(?=[^.?!]*${DATED_EVENT_VERB})[^.?!]*${YEAR}[^.?!]{0,140}${YEAR}`, 'i'),
], 0.68);
const V_CONCEPTS = visualTrigger('concepts', [
    /\b(?:there are|we have|consists of|is made up of) (?:two|three|four|five|six|several) (?:main |key |basic )?(?:types|kinds|categories|classes|parts|components|ideas|concepts|principles)\b/i,
], 0.72);
const V_PROCESS_STAGES = visualTrigger('workflow', [
    /\b(?:there are|we have|consists of|goes through) (?:two|three|four|five|six|several) (?:main |key )?(?:stages|phases|steps)\b/i,
], 0.72);

// The system-design card under the id the technical interview mode really has.
// (The table above is keyed 'technical_interview', which no mode uses, so the
// card — and the diagram contract accepting it carries — was never offered.)
// Offered when a design is actually being asked for, not on the word
// "architecture".
const SYSTEM_DESIGN_OFFER: ActionTrigger = {
    type: 'system_design_prompt',
    patterns: [
        /\b(?:how would you (?:design|architect|build|scale)|(?:can|could) you design|let'?s design|system design (?:question|round|problem|interview)|high[- ]level (?:design|architecture))\b/i,
        // "Design a URL shortener.", "Design Twitter.", "I'd like you to design a
        // parking lot": the ask itself, at the head of what was said.
        /(?:^|[.?!]\s+)(?:(?:ok(?:ay)?|so|now|next|alright|please)[, ]+)*(?:(?:can|could|would) you (?:please )?|i(?:'d| would) like you to |i want you to |let'?s )?design (?:(?:a|an|the|your own)\s+[a-z]|(?:twitter|instagram|facebook|whatsapp|uber|lyft|netflix|youtube|spotify|tiktok|dropbox|slack|discord|airbnb|amazon|tinyurl|pastebin)\b)/i,
    ],
    priority: 0.89,
    label: 'Structure system design',
    promptInstruction: SYSTEM_DESIGN_ACTION_INSTRUCTION,
    answerStyle: { maxWords: 260, format: 'bullets', tone: 'analytical' },
};

export const MODE_TRIGGERS: Record<string, ActionTrigger[]> = {
    general: [...GENERAL_TRIGGERS, V_WORKFLOW, V_FIGURES, V_SCENARIOS, V_DEPENDENCIES, V_TIMELINE],
    negotiation: NEGOTIATION_TRIGGERS,
    sales: [...SALES_TRIGGERS, V_WORKFLOW, V_FIGURES, V_SCENARIOS],
    recruiting: [...RECRUITING_TRIGGERS, V_WORKFLOW, V_TIMELINE],
    team_meeting: TEAM_TRIGGERS,
    interview: INTERVIEW_TRIGGERS,
    lecture: [...LECTURE_TRIGGERS, V_CONCEPTS, V_PROCESS_STAGES, V_DATA_MODEL],
    technical_interview: TECHNICAL_TRIGGERS,
    // Real template ids that had no table (visual offers only).
    'team-meet': [V_DEPENDENCIES, V_WORKFLOW, V_FIGURES, V_SCENARIOS, V_DATA_MODEL],
    'call-center': [V_TROUBLESHOOTING, V_WORKFLOW, V_FIGURES],
    'technical-interview': [SYSTEM_DESIGN_OFFER, V_DATA_MODEL],
    'looking-for-work': [V_TIMELINE],
    seminar: [V_CONCEPTS, V_PROCESS_STAGES, V_FIGURES],
};

export class DynamicActionDetector {
    private triggers: Record<string, ActionTrigger[]>;

    constructor(triggers: Record<string, ActionTrigger[]> = MODE_TRIGGERS) {
        this.triggers = triggers;
    }

    detectTriggers(params: {
        transcript: string;
        modeTemplateType: string;
        /**
         * False when "Diagrams and charts" is switched off: the cards that
         * offer a drawing are not offered. (They used to be: accepting one then
         * asked for a flowchart with no contract and no card to draw it in.)
         */
        visualsEnabled?: boolean;
    }): Array<{ trigger: ActionTrigger; match: string; index: number }> {
        const { transcript, modeTemplateType } = params;
        const matchedTriggers: Array<{ trigger: ActionTrigger; match: string; index: number }> = [];

        // Get triggers for this mode, fallback to empty array
        const offersDrawing = (t: ActionTrigger): boolean => t.type.startsWith('visual_') || t === SYSTEM_DESIGN_OFFER;
        const modeTriggers = (this.triggers[modeTemplateType] || []).filter((t) => params.visualsEnabled !== false || !offersDrawing(t));

        for (const trigger of modeTriggers) {
            for (const pattern of trigger.patterns) {
                const match = pattern.exec(transcript);
                if (match) {
                    matchedTriggers.push({
                        trigger,
                        match: match[0],
                        index: match.index,
                    });
                    break; // Only use first matching pattern per trigger
                }
            }
        }

        return matchedTriggers;
    }

    getTriggerForType(type: string): ActionTrigger | undefined {
        for (const triggers of Object.values(this.triggers)) {
            const found = triggers.find((t) => t.type === type);
            if (found) return found;
        }
        return undefined;
    }
}