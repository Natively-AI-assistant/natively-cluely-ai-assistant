// tests/utils/modeBriefs.mjs
// The 10 mission mode briefs, fed to the REAL generator exactly as a user would.
// `requiresGrounding` marks the modes whose answers must be restricted to the
// uploaded reference documents (3,4,6,8,9,10 per the mission acceptance rules).

export const MODE_BRIEFS = [
  {
    key: 'backend-eng',
    brief:
      'Senior Backend Engineering Interview assistant. I am interviewing for a senior backend role. ' +
      'Give concise, expert-level answers on system design, API design, databases, and distributed systems. ' +
      'Always surface the key tradeoffs and justify the decision. Sound like a staff engineer, not a tutorial.',
    requiresGrounding: false,
    templateHint: 'technical-interview',
  },
  {
    key: 'behavioral-hr',
    brief:
      'Behavioral / HR Interview assistant. Help me answer behavioral questions in STAR format ' +
      '(Situation, Task, Action, Result) with a warm, confident tone. Draw on my resume and background ' +
      'when relevant. Keep answers human and specific, with measurable outcomes.',
    requiresGrounding: false,
    templateHint: 'looking-for-work',
  },
  {
    key: 'thesis-defense',
    brief:
      'Academic Thesis Defense assistant. I am defending my master\'s thesis to a committee. ' +
      'Answer strictly from my uploaded thesis document — treat it as the source of truth. ' +
      'Cite the relevant section or page when you can, defend the claims rigorously, and honestly ' +
      'admit limitations. Do not invent results that are not in the thesis.',
    requiresGrounding: true,
    templateHint: 'lecture',
  },
  {
    key: 'data-analyst',
    brief:
      'Data Analyst Screening assistant. Answer questions grounded in the uploaded spreadsheet/dataset. ' +
      'Quote exact figures from the provided data, explain the methodology, and never fabricate numbers ' +
      'that are not in the files. If a figure is not in the dataset, say so.',
    requiresGrounding: true,
    templateHint: 'general',
  },
  {
    key: 'sales-discovery',
    brief:
      'Sales Discovery Call assistant. Detect prospect questions and objections during a discovery call ' +
      'and answer with value framing, using our product documentation. Ask clarifying discovery questions, ' +
      'stay consultative, and tie features to business outcomes.',
    requiresGrounding: false,
    templateHint: 'sales',
  },
  {
    key: 'investor-pitch',
    brief:
      'Investor Pitch Q&A assistant. During investor Q&A, answer metric and financial questions using ONLY ' +
      'the uploaded pitch deck and financials as the source of truth. Be confident but never fabricate a ' +
      'number — if a metric is not in the provided documents, say it is not disclosed here.',
    requiresGrounding: true,
    templateHint: 'general',
  },
  {
    key: 'consulting-case',
    brief:
      'Consulting Case Interview assistant. Structure answers MECE and hypothesis-first. Lay out a clear ' +
      'framework, state assumptions, and walk through the logic. Use any provided exhibit documents for data. ' +
      'Be crisp and structured like a management-consulting candidate.',
    requiresGrounding: false,
    templateHint: 'general',
  },
  {
    key: 'legal-compliance',
    brief:
      'Legal / Compliance Q&A assistant. Answer only from the provided legal and compliance documents. ' +
      'Treat the uploaded files as authoritative and explicitly flag anything that falls outside them. ' +
      'Never guess at policy or law that is not in the documents; say when something is not covered.',
    requiresGrounding: true,
    templateHint: 'general',
  },
  {
    key: 'conference-talk',
    brief:
      'Technical Conference Talk Q&A assistant. I just presented a research paper and am taking audience ' +
      'questions. Ground every answer in the uploaded research papers — defend the methods and results ' +
      'from the papers, and if a question goes beyond them, acknowledge that clearly.',
    requiresGrounding: true,
    templateHint: 'lecture',
  },
  {
    key: 'support-escalation',
    brief:
      'Customer Support Escalation assistant. Handle escalated customer issues with an empathetic, calm tone. ' +
      'Resolve strictly from the provided support knowledge document — never invent policy, prices, or ' +
      'procedures that are not in the document. If the knowledge base does not cover it, say you will escalate.',
    requiresGrounding: true,
    templateHint: 'general',
  },
];
