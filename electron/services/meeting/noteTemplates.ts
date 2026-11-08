/**
 * Note templates (2026-10-20): Granola's template library, for the notes only.
 *
 * A template shapes the notes written after a meeting: the sections they are
 * in and a short description of the meeting for the model. It does not touch
 * live answers, which keep following the mode. Picked in the notepad ("/" ›
 * Templates, All templates…) for the running meeting, or after Stop to write
 * the notes again in it.
 *
 * The set, the groups and the section headings follow Granola's built-ins; the
 * meeting descriptions and section instructions are written for Natively.
 *
 * Pure data and helpers, shared by main (MeetingPersistence) and the notepad.
 * Platform-independent.
 */

export interface NoteTemplateSection {
    title: string;
    description: string;
}

export type NoteTemplateGroup = 'Popular' | 'Commercial' | 'Leadership' | 'Product' | 'Recruiting' | 'Team' | 'VC';

export interface NoteTemplate {
    id: string;
    name: string;
    group: NoteTemplateGroup;
    /** What kind of meeting this is, from the user's side: read by the model before the sections. */
    context: string;
    sections: NoteTemplateSection[];
}

export const NOTE_TEMPLATE_GROUPS: readonly NoteTemplateGroup[] = ['Popular', 'Commercial', 'Leadership', 'Product', 'Recruiting', 'Team', 'VC'];

export const NOTE_TEMPLATES: readonly NoteTemplate[] = [
    {
        id: 'one-to-one', name: '1 to 1', group: 'Popular',
        context: 'A one to one with someone on my team. Keep the notes short and actionable: their priorities, progress, what is in the way, and feedback either way.',
        sections: [
            { title: 'Top of mind', description: 'The most pressing issues or priorities raised, the ones that need attention now.' },
            { title: 'Updates and wins', description: 'Recent progress and achievements; what is going well and moving forward.' },
            { title: 'Challenges and blockers', description: 'Anything slowing them down or standing in the way.' },
            { title: 'Mutual feedback', description: 'Feedback they gave me on what I could do differently or change for the team, and any feedback I gave them.' },
            { title: 'Next Milestone', description: 'Action items with who does what by when.' },
        ],
    },
    {
        id: 'customer-discovery', name: 'Customer: Discovery', group: 'Popular',
        context: 'A first call with a potential customer. I want what helps me follow up and close: their needs, worries and goals, with exact figures and quotes. Only what they said, not me.',
        sections: [
            { title: 'Their background', description: 'Their business, industry and role: the context behind what they need.' },
            { title: 'Pain points and needs', description: 'The problems they want solved and what they look for in a solution.' },
            { title: 'Questions or concerns', description: 'Every question or worry they raised, so I can answer it in the follow-up.' },
            { title: 'Budget and timeline', description: 'What they can spend and any dates that matter.' },
            { title: 'Next Steps', description: 'The follow-ups we agreed (another call, material to send) with any dates or deadlines mentioned.' },
        ],
    },
    {
        id: 'hiring', name: 'Hiring', group: 'Popular',
        context: 'An interview with a candidate. Capture their background, what fits the role, their motivation and the practical details.',
        sections: [
            { title: 'Their background', description: 'Career path, education, current role and responsibilities, notable achievements or projects.' },
            { title: 'Skills and experience', description: 'The skills and experience most relevant to the role: technical, interpersonal and specialist.' },
            { title: 'Motivation and fit', description: 'What they want from their career and why this role and company.' },
            { title: 'Availability and salary expectations', description: 'Notice period or earliest start, salary expectations and other compensation questions.' },
            { title: 'My thoughts', description: 'My own opinions if I wrote any in my notes; otherwise N/A.' },
            { title: 'Next steps', description: 'The next stages I mentioned, and any timing or availability they raised.' },
        ],
    },
    {
        id: 'stand-up', name: 'Stand-Up', group: 'Popular',
        context: 'A daily stand-up. Each person\'s update: what they finished, what they are on now, and what blocks them. Short and to the point.',
        sections: [
            { title: 'Announcements', description: 'Anything worth noting from the small talk or announcements at the start.' },
            { title: 'Updates', description: 'Per person: done since last time, working on today, and blockers that could slow things.' },
            { title: 'Sidebar', description: 'Discussions after the updates: who worked together, decisions, other points raised.' },
            { title: 'Action Items', description: 'Next steps with an owner each, reminders and immediate tasks.' },
        ],
    },
    {
        id: 'weekly-team-meeting', name: 'Weekly Team Meeting', group: 'Popular',
        context: 'My weekly team meeting: how the work is going, what changed, and that everyone knows their part for the week.',
        sections: [
            { title: 'Announcements', description: 'Company, team or personal news shared in the meeting.' },
            { title: 'Review of Progress', description: 'Where the team stands against its goals.' },
            { title: 'Key Achievements', description: 'What people finished or won since last week.' },
            { title: 'Challenges and Adjustments Needed', description: 'Problems the team faces and any change of plan agreed to deal with them.' },
            { title: 'Action Items and Accountability for the Week Ahead', description: 'This week\'s action items with owners and deadlines.' },
        ],
    },
    {
        id: 'account-management', name: 'Account Management', group: 'Commercial',
        context: 'A check-in with a key account: how they use the product today, where adoption can grow, and any risk to keeping them.',
        sections: [
            { title: 'Current Product Use and Satisfaction', description: 'How they use the product now: team size, use cases, and quotes on how satisfied they are.' },
            { title: 'Additional Needs and Pain Points', description: 'Needs or difficulties they raised, and where the product could serve them better.' },
            { title: 'Future Roadmap', description: 'Their upcoming projects, growth or hiring that could change how they use the product.' },
            { title: 'Agreed Next Steps', description: 'What each side will do next, with dates.' },
        ],
    },
    {
        id: 'customer-existing', name: 'Customer: Existing', group: 'Commercial',
        context: 'A call with an existing customer about the difference the product makes for them. Specific feedback for the product, customer success and account growth.',
        sections: [
            { title: 'Current satisfaction', description: 'How satisfied they are overall: good experiences and pain points.' },
            { title: 'Recent use and outcomes', description: 'How they have used the product lately and what came of it.' },
            { title: 'Challenges and support needs', description: 'Problems they have, the help they need, and features or fixes they asked for.' },
            { title: 'Opportunities and next steps', description: 'Room to expand the account, and the follow-ups or next check-in agreed.' },
        ],
    },
    {
        id: 'pipeline-review', name: 'Pipeline Review', group: 'Commercial',
        context: 'A sales pipeline review: the state of our deals, what could stall them, and the actions that move the important ones forward.',
        sections: [
            { title: 'Current Pipeline Status', description: 'Number of open deals, their stages, and what changed since the last review.' },
            { title: 'Key Deals and Progress', description: 'Updates on the important deals and their expected close dates.' },
            { title: 'Blockers and Risks', description: 'What could hold deals back and how the team plans to handle it.' },
            { title: 'Next Steps and Actions', description: 'Actions to move deals forward, with owners and deadlines.' },
        ],
    },
    {
        id: 'advisory', name: 'Advisory', group: 'Leadership',
        context: 'A conversation with an advisor about our business. Capture their advice and recommendations accurately.',
        sections: [
            { title: 'Current situation', description: 'The situation or problem we brought to them.' },
            { title: 'Their insights', description: 'Their advice, recommendations and the approaches they suggested.' },
            { title: 'Next steps', description: 'What we will do based on their advice, with owners and timing.' },
        ],
    },
    {
        id: 'board-meeting', name: 'Board Meeting', group: 'Leadership',
        context: 'A meeting with my company\'s board. Capture their guidance and decisions accurately.',
        sections: [
            { title: 'Strategic Guidance', description: 'Their advice on strategy, market position and long-term goals.' },
            { title: 'Operational Feedback', description: 'Suggestions on operations, the team or how we work.' },
            { title: 'Financial Insights', description: 'Recommendations on finances, fundraising or budget.' },
            { title: 'Risks and Opportunities', description: 'Risks they pointed out and opportunities they suggested.' },
            { title: 'Key Decisions', description: 'Decisions made: strategy, budget, hiring, votes and approved plans.' },
        ],
    },
    {
        id: 'investor-current', name: 'Investor: Current', group: 'Leadership',
        context: 'An update with a current investor. Capture their recommendations, what they see in the market, and the help they offered.',
        sections: [
            { title: 'Catch Up', description: 'Anything worth noting from the opening chat.' },
            { title: 'Their Key Recommendations', description: 'Their advice on strategy, operations, finances and product.' },
            { title: 'Market Insights', description: 'What they said about market trends, competitors and openings.' },
            { title: 'Offers to Help', description: 'Specific help they offered and introductions they can make.' },
            { title: 'My Next Steps', description: 'What I said I would do next.' },
        ],
    },
    {
        id: 'investor-prospective', name: 'Investor: Prospective', group: 'Leadership',
        context: 'A first meeting with a prospective investor. Capture who they are, what they asked and anything they committed to.',
        sections: [
            { title: 'Introductions', description: 'How they heard of us and any people we both know.' },
            { title: 'Their fund', description: 'Fund size and number, focus areas, regions and industries.' },
            { title: 'Pitch Q&A', description: 'The questions they asked during the pitch.' },
            { title: 'Next Steps', description: 'What they committed to, possible introductions, and important dates.' },
        ],
    },
    {
        id: 'networking', name: 'Networking', group: 'Leadership',
        context: 'Meeting someone new to learn from them and see how we can help each other.',
        sections: [
            { title: 'Their background', description: 'How we met, what we have in common, and details of their career and life worth remembering.' },
            { title: 'Topics of discussion', description: 'What we talked about, and the stories, advice or information they shared.' },
            { title: 'Opportunities for future collaboration', description: 'Introductions, follow-ups and ways to work together that we agreed.' },
        ],
    },
    {
        id: 'customer-onboarding', name: 'Customer Onboarding', group: 'Product',
        context: 'An onboarding session with a new customer: their situation, first reactions and concerns, so we can tailor how we work with them. Leave out details of our own product.',
        sections: [
            { title: 'Key Information About Them', description: 'Their company, industry, goals and how they plan to use the product.' },
            { title: 'Questions and Concerns', description: 'Questions they asked and difficulties they expect.' },
            { title: 'Timeline and Next Steps', description: 'The onboarding timeline and milestones, next steps, owners and deadlines.' },
        ],
    },
    {
        id: 'product-demo', name: 'Product Demo', group: 'Product',
        context: 'A demo of our product to potential customers, to see how interested they are in going ahead.',
        sections: [
            { title: 'Their reactions', description: 'How they reacted during the demo, including what impressed them.' },
            { title: 'Questions and Concerns', description: 'Questions and concerns they raised, and anything they wanted clarified.' },
            { title: 'Feedback and Suggestions', description: 'Their feedback, feature requests and ideas for improvement.' },
            { title: 'Next Steps', description: 'Agreed follow-ups, owners and timing.' },
        ],
    },
    {
        id: 'requirements-gathering', name: 'Requirements Gathering', group: 'Product',
        context: 'Talking to a stakeholder to understand a problem we need to solve. I care about the reasoning that leads to the action items.',
        sections: [
            { title: 'Context', description: 'What we are trying to achieve and the background needed to understand it.' },
            { title: 'Brainstorming', description: 'The topics discussed and what we concluded on each.' },
            { title: 'Decision', description: 'What was decided, turned into action items.' },
        ],
    },
    {
        id: 'troubleshooting', name: 'Troubleshooting', group: 'Product',
        context: 'A call with a customer who has a problem with our product. Record the problem exactly and what I did to help.',
        sections: [
            { title: 'Their challenge or problem', description: 'A clear description of the problem, with every detail they gave.' },
            { title: 'My suggested solutions and their outcomes', description: 'What I suggested or tried, and what happened.' },
            { title: 'Next steps', description: 'What still needs doing, follow-ups and who owns them.' },
        ],
    },
    {
        id: 'user-interview', name: 'User interview', group: 'Product',
        context: 'An interview with a user about our product. Thorough but focused notes on their experience and suggestions, with direct quotes and figures where they help.',
        sections: [
            { title: 'User background', description: 'Their role, experience, how they come to the product, and other tools or workarounds they use.' },
            { title: 'Current product usage', description: 'How often they use it, which features, and for what.' },
            { title: 'Positive feedback and pain points', description: 'What they like and what frustrates them.' },
            { title: 'Impact of the product', description: 'What the product has changed in their work or life.' },
            { title: 'Next steps and follow up', description: 'Follow-ups agreed and who owns them.' },
        ],
    },
    {
        id: 'hiring-advanced', name: 'Hiring (Advanced)', group: 'Recruiting',
        context: 'A late-stage interview with a candidate: their expertise and how they would fit, in depth, including how they work and what they value.',
        sections: [
            { title: 'Past Projects and Achievements', description: 'Their past projects in detail and the skills each one shows.' },
            { title: 'Their Values', description: 'What matters to them in a career and a workplace.' },
            { title: 'My thoughts', description: 'My own opinions if I wrote any in my notes.' },
            { title: 'Next Steps', description: 'The next stages I mentioned, and any timing or availability they raised.' },
        ],
    },
    {
        id: 'all-hands', name: 'All Hands Meeting', group: 'Team',
        context: 'Our company all-hands: where the company is going, announcements, and what it means for my work.',
        sections: [
            { title: 'Business Overview', description: 'How the company is doing, big wins and its position in the market.' },
            { title: 'Strategic Direction', description: 'Plans and goals ahead, and any change of strategy or focus.' },
            { title: 'Team Updates', description: 'News from departments, new initiatives and major projects.' },
            { title: 'Impact on my role', description: 'What affects my role and team: changes, expectations, opportunities.' },
        ],
    },
    {
        id: 'brainstorm', name: 'Brainstorm', group: 'Team',
        context: 'Working on a problem together, sharing ideas and reactions to them.',
        sections: [
            { title: 'The problem', description: 'The problem we are solving: context, where things stand and what has been tried.' },
            { title: 'Themes discussion', description: 'The main themes the discussion explored.' },
            { title: 'Specific ideas', description: 'The most important individual ideas and points raised.' },
            { title: 'Future directions', description: 'What to keep in mind from here, and directions we chose to explore.' },
        ],
    },
    {
        id: 'project-kick-off', name: 'Project Kick-Off', group: 'Team',
        context: 'A project kick-off: the scope, our shared goals, my part in it, and the first steps.',
        sections: [
            { title: 'Context', description: 'Why the project exists and what it sets out to achieve.' },
            { title: 'Deliverables', description: 'What the project must produce.' },
            { title: 'Timelines', description: 'Milestones, deadlines and other dates mentioned.' },
            { title: 'Ownership and Accountability', description: 'Who is responsible for each part.' },
            { title: 'Next Steps', description: 'Immediate actions, owners, and the next meetings or checkpoints.' },
        ],
    },
    {
        id: 'project-sync', name: 'Project Sync', group: 'Team',
        context: 'A project sync: where we stand, what is coming, what is in the way, and that we agree on the next moves.',
        sections: [
            { title: 'Project Status', description: 'Progress since the last sync, finished tasks and milestones reached.' },
            { title: 'Current Roadblocks', description: 'What is holding the work up and how we plan to get past it.' },
            { title: 'Upcoming Tasks and Milestones', description: 'What comes next, with deadlines and priorities.' },
            { title: 'Team Collaboration and Action Items', description: 'Who does what, new action items, and agreed timing.' },
        ],
    },
    {
        id: 'sprint-planning', name: 'Sprint Planning', group: 'Team',
        context: 'Planning the next sprint with my team: prioritising the backlog, sizing the work and committing to what we can deliver.',
        sections: [
            { title: 'Review of Previous Sprint', description: 'What the last sprint finished and left over, and lessons from the retrospective.' },
            { title: 'Prioritization of Backlog Items', description: 'How backlog items were ranked, and what was taken in or pushed back.' },
            { title: 'Sprint Goals and Objectives', description: 'What the team means to achieve by the end of the sprint.' },
            { title: 'Task Assignment and Capacity Planning', description: 'Who takes which task and whether the load fits the team\'s capacity.' },
        ],
    },
    {
        id: 'catch-up-investor', name: 'Catch-up: investor', group: 'VC',
        context: 'A catch-up with another investor to swap notes on companies and people worth talking to.',
        sections: [
            { title: 'Personal update', description: 'Personal news shared on the call; "NA" if none.' },
            { title: 'Companies they talked about', description: 'Each company they mentioned and what they said about it.' },
            { title: 'Companies I talked about', description: 'Each company I mentioned and what I said.' },
            { title: 'Other Topics', description: 'Anything else we discussed.' },
            { title: 'Promised introductions', description: 'Every introduction either of us promised.' },
        ],
    },
    {
        id: 'catch-up-portfolio', name: 'Catch-up: portfolio company', group: 'VC',
        context: 'A catch-up with one of my portfolio companies: how things are going and where I can help.',
        sections: [
            { title: 'Growth', description: 'Traction and growth, with the numbers mentioned; "NA" if not discussed.' },
            { title: 'Challenges', description: 'What is holding the company back right now.' },
            { title: 'Burn rate', description: 'Burn and remaining runway; "NA" if not discussed.' },
            { title: 'Action items', description: 'Follow-ups agreed and who owns them.' },
        ],
    },
    {
        id: 'lp-prospective', name: 'LP: prospective', group: 'VC',
        context: 'A meeting with a prospective LP, to see whether they would be a good investor in our fund.',
        sections: [
            { title: 'Investment Strategy and Check Size', description: 'Their check size, overall strategy and other investments; "NA" if not discussed.' },
            { title: 'What they look for', description: 'What they look for: segment, region, size; "NA" if not discussed.' },
            { title: 'Timeline', description: 'When they invest and how they approve an investment; "NA" if not discussed.' },
            { title: 'Other funds they are in', description: 'Other funds they mentioned investing in; "NA" if none.' },
            { title: 'Personal information', description: 'Personal details they shared (family, holidays); "NA" if none.' },
        ],
    },
    {
        id: 'vc-board-meeting', name: 'VC: Board Meeting', group: 'VC',
        context: 'A board meeting of a startup where I sit on the board: their updates and our feedback on strategy.',
        sections: [
            { title: 'Progress', description: 'Progress since the last board meeting, with every KPI and number given.' },
            { title: 'Plans', description: 'The plan ahead and the events, goals or KPIs of the coming months.' },
            { title: 'Challenges', description: 'Blockers or challenges they expect.' },
            { title: 'Requests for support', description: 'Each request for help, with how board members offered to help as sub-bullets.' },
            { title: 'Next steps', description: 'What was decided as next steps.' },
        ],
    },
    {
        id: 'vc-pitch', name: 'VC: Pitch', group: 'VC',
        context: 'A startup pitching me as an investor, to decide whether to invest.',
        sections: [
            { title: 'Team', description: 'The founders and team, and their previous experience.' },
            { title: 'Problem', description: 'The problem they solve: who has it, how many, and why it matters.' },
            { title: 'Product', description: 'What they are building, how it works and how it solves the problem.' },
            { title: 'Go-to-market', description: 'How they sell and reach customers, pricing, and how they will grow.' },
            { title: 'Traction', description: 'Users, revenue and other progress so far.' },
            { title: 'Funding', description: 'Whether they are raising, how much and on what terms; past rounds, from whom and on what terms.' },
            { title: 'Agreed next steps', description: 'Dates or deadlines for when I get back to them.' },
        ],
    },
];

/** The five the notepad's "/" menu and the notes menu list first (Granola's). */
export const QUICK_NOTE_TEMPLATE_IDS: readonly string[] = ['one-to-one', 'customer-discovery', 'hiring', 'stand-up', 'weekly-team-meeting'];

/**
 * Not a note template: the Modes Manager's "This mode" pick, which puts back
 * the sections a mode's type starts with (ModesManager's TEMPLATE_NOTE_SECTIONS)
 * after the user removed or replaced them. No template carries this id.
 */
export const MODE_DEFAULT_NOTE_TEMPLATE_ID = 'mode-default';

export function noteTemplateById(id: unknown): NoteTemplate | null {
    if (typeof id !== 'string' || !id || id.length > 64) return null;
    return NOTE_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function quickNoteTemplates(): NoteTemplate[] {
    return QUICK_NOTE_TEMPLATE_IDS.map((id) => noteTemplateById(id)).filter((t): t is NoteTemplate => !!t);
}

/** Templates whose name, group or a section heading has every word of `query`; empty keeps all. */
export function searchNoteTemplates(query: string, templates: readonly NoteTemplate[] = NOTE_TEMPLATES): NoteTemplate[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [...templates];
    return templates.filter((t) => {
        const hay = `${t.name} ${t.group} ${t.sections.map((s) => s.title).join(' ')}`.toLowerCase();
        return words.every((w) => hay.includes(w));
    });
}

/**
 * The notes' sections and context with a template applied: the template's
 * sections replace the mode's, and its meeting description goes before the
 * mode's own context (kept: the user's mode context still says who they are).
 */
export function applyNoteTemplate(
    template: NoteTemplate,
    modeContextBlock: string,
): { sections: NoteTemplateSection[]; contextBlock: string } {
    const block = `NOTES TEMPLATE: ${template.name}\nThis meeting: ${template.context}\nWrite the notes in the sections below, in this order. Leave out a section with nothing to say rather than inventing content.`;
    return {
        sections: template.sections.map((s) => ({ ...s })),
        contextBlock: modeContextBlock ? `${block}\n\n${modeContextBlock}` : block,
    };
}
