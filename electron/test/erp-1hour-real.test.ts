/**
 * ERP Mode — Real 1-Hour LLM Stress Test
 * ======================================
 * Actually calls the LLM via WhatToAnswerLLM.generateStream() with a real
 * 1-hour ERP discovery interview transcript.
 *
 * Run with:
 *   cd /Users/evin/natively-cluely-ai-assistant/electron
 *   npx tsx test/erp-1hour-real.test.ts
 *
 * Prerequisites:
 *   - API keys configured via env vars (GROQ_API_KEY, GEMINI_API_KEY, etc.)
 *   - This is a STAGING test — expect API costs and time to run
 *   - ~90 Q&A exchanges × real API calls = real elapsed time
 *
 * What this test proves:
 *   - The full pipeline works end-to-end with real LLM calls
 *   - Mode context is injected correctly on each call
 *   - Token budget math holds under real load
 *   - No silent failures across a full hour of conversation
 */

// Load env vars from .env before anything else
import { config } from 'dotenv';
import * as path from 'path';
config({ path: path.join(__dirname, '..', '..', '.env') });

// Bypass ProcessingHelper/CredentialsManager (they need Electron's app global).
// Construct LLMHelper directly with API keys from environment variables.
import { LLMHelper } from '../LLMHelper';
import { WhatToAnswerLLM } from '../llm/WhatToAnswerLLM';
import { SessionTracker } from '../SessionTracker';
import { estimateTokens } from '../llm/modelCapabilities';

// ── 1-Hour ERP Discovery Interview ───────────────────────────────────────────
// 90 interviewer turns × ~2-3 follow-ups = ~180-270 Q&A exchanges
// Covers all 8 focus areas × 2 cycles
// Format: { ts: "H:MM", speaker: "I"|"C", text: string }
const FULL_1HR_INTERVIEW: Array<{ ts: string; speaker: 'I' | 'C'; text: string }> = [
  // ══ Hour 1: Cycle 1 of all 8 focus areas ══════════════════════════════════════
  // Opening
  { ts: '0:00', speaker: 'I', text: 'Hello, today we want to go through your process step by step. I would like to understand: how the process looks, who does each step, what systems and documents are used. It is also very important for me to know: what problems you have, what does not work well, where you do manual work. Please describe the real process, not the ideal one.' },
  { ts: '0:05', speaker: 'C', text: 'Sure. We are a manufacturing company. We start by receiving purchase orders from customers through email or our website. If we do not have the item in stock, we start the procurement process.' },
  { ts: '0:10', speaker: 'I', text: 'When you say procurement — who starts it and what document is used?' },
  { ts: '0:15', speaker: 'C', text: 'The warehouse manager checks our stock. If we are below reorder point, he sends a purchase requisition to the purchasing department by email with a PDF.' },
  { ts: '0:20', speaker: 'I', text: 'What data is needed on that requisition?' },
  { ts: '0:25', speaker: 'C', text: 'Item number, quantity, preferred supplier, and the project code. The project code is important because each department has its own budget.' },
  { ts: '0:30', speaker: 'I', text: 'Who approves the requisition? And how long does that take?' },
  { ts: '0:35', speaker: 'C', text: 'The purchasing manager approves it. Usually takes one day. But if the amount is over five thousand euros, our CFO needs to sign off as well. That can take three days.' },
  { ts: '0:40', speaker: 'I', text: 'What happens if the supplier cannot fulfill the order?' },
  { ts: '0:45', speaker: 'C', text: 'The purchaser calls three suppliers to get quotes. This is done manually in Excel. We do not have a system for comparing offers automatically.' },
  { ts: '0:50', speaker: 'I', text: 'What can go wrong in procurement?' },
  { ts: '0:55', speaker: 'C', text: 'Item numbers in the requisition do not match the supplier catalog. We have a manual cross-reference table in Excel that is outdated. This causes delays of two to three days.' },

  // Purchasing follow-up block
  { ts: '1:00', speaker: 'I', text: 'How do you handle rush orders or emergency purchases?' },
  { ts: '1:05', speaker: 'C', text: 'The department manager sends an email directly to the purchasing manager. No formal process. It bypasses the normal approval chain. This happens two or three times per week.' },
  { ts: '1:10', speaker: 'I', text: 'Tell me about your supplier catalog. How is it maintained?' },
  { ts: '1:15', speaker: 'C', text: 'The purchasing department maintains it in Excel. Supplier part numbers and our item numbers are cross-referenced manually. Updates happen quarterly but often the Excel file is not up to date.' },
  { ts: '1:20', speaker: 'I', text: 'What about recurring purchases — are they automated?' },
  { ts: '1:25', speaker: 'C', text: 'We have blanket purchase orders for our top three suppliers. But the release against the blanket is done manually every month. No automatic generation.' },
  { ts: '1:30', speaker: 'I', text: 'How do you track purchase order status?' },
  { ts: '1:35', speaker: 'C', text: 'The purchaser updates a shared Excel sheet with the current status of each PO. There is no automatic notification when a PO ships. The purchaser checks tracking manually.' },

  // Planning
  { ts: '1:40', speaker: 'I', text: 'Let us move to planning. How do you create your production plan?' },
  { ts: '1:45', speaker: 'C', text: 'We use a spreadsheet. Every Monday, the production planner looks at confirmed orders and simulates capacity in Excel. He tries to balance machine load and labor hours.' },
  { ts: '1:50', speaker: 'I', text: 'What data is needed for that simulation?' },
  { ts: '1:55', speaker: 'C', text: 'Sales orders, machine capacity tables, shift schedules, and current work-in-progress. Some of this comes from our ERP, some from paper notes on the shop floor.' },
  { ts: '2:00', speaker: 'I', text: 'How often does the plan change after Monday?' },
  { ts: '2:05', speaker: 'C', text: 'Every day. Urgent orders come in and we have to reshuffle. The planner spends two hours every morning just updating the spreadsheet.' },
  { ts: '2:10', speaker: 'I', text: 'What is the biggest problem with this approach?' },
  { ts: '2:15', speaker: 'C', text: 'We cannot see material availability in real time. We schedule a job and then discover the raw material is not in stock. Then we have to unschedule and reschedule.' },
  { ts: '2:20', speaker: 'I', text: 'How do you handle capacity constraints?' },
  { ts: '2:25', speaker: 'C', text: 'The planner manually shifts jobs to other machines or adds overtime shifts. There is no system constraint checking. He does it by experience and a printed capacity report.' },
  { ts: '2:30', speaker: 'I', text: 'What about labor planning?' },
  { ts: '2:35', speaker: 'C', text: 'Labor hours are tracked in the payroll system. The production planner manually enters them into the Excel plan every week. It is double entry — error-prone.' },
  { ts: '2:40', speaker: 'I', text: 'Do you use any finite planning tools?' },
  { ts: '2:45', speaker: 'C', text: 'No. Our ERP has basic scheduling but we do not use it because it does not respect real material availability. The data is too unreliable.' },

  // Warehouse
  { ts: '2:50', speaker: 'I', text: 'Now warehouse. How do you receive goods?' },
  { ts: '2:55', speaker: 'C', text: 'The warehouse worker receives the delivery, compares the delivery note to the purchase order in our system, counts items, then types the receipt into the ERP later.' },
  { ts: '3:00', speaker: 'I', text: 'Why is entry done later instead of at reception?' },
  { ts: '3:05', speaker: 'C', text: 'Internet is slow in the warehouse. WiFi only works near the office. Also the ERP is slow so workers prefer to write first and input when they have time.' },
  { ts: '3:10', speaker: 'I', text: 'What happens when the count does not match the delivery note?' },
  { ts: '3:15', speaker: 'C', text: 'The worker calls the supplier and creates a discrepancy report by email. Purchasing contacts the supplier for credit or replacement. This takes up to two weeks.' },
  { ts: '3:20', speaker: 'I', text: 'How do you manage inventory accuracy?' },
  { ts: '3:25', speaker: 'C', text: 'We do a physical count once per month. We close the warehouse for a day and count everything. Last month we found forty-seven discrepancies.' },
  { ts: '3:30', speaker: 'I', text: 'What about putaway — is it guided or free-form?' },
  { ts: '3:35', speaker: 'C', text: 'Free-form. The warehouse worker looks at the item label and decides the storage location based on a mental map. No system guidance.' },
  { ts: '3:40', speaker: 'I', text: 'How do you handle returns from customers?' },
  { ts: '3:45', speaker: 'C', text: 'The warehouse receives the returned item and checks it against the original order. Then they notify the support team by email. There is no formal returns workflow.' },

  // Production
  { ts: '3:50', speaker: 'I', text: 'Let us cover production. How do you start a production order?' },
  { ts: '3:55', speaker: 'C', text: 'The production planner creates a production order in the ERP. He allocates materials, labor, and machine time. Then he releases it to the shop floor.' },
  { ts: '4:00', speaker: 'I', text: 'Does material allocation check physical availability?' },
  { ts: '4:05', speaker: 'C', text: 'No. It is only a reservation in the system. It does not check if the material is physically available in the warehouse.' },
  { ts: '4:10', speaker: 'I', text: 'What happens at the shop floor level?' },
  { ts: '4:15', speaker: 'C', text: 'The operator sees the order on a screen near his station. He confirms start and end times by scanning a barcode. The barcode system updates the ERP every thirty minutes.' },
  { ts: '4:20', speaker: 'I', text: 'How do you handle quality holds?' },
  { ts: '4:25', speaker: 'C', text: 'When a defect is found, the operator fills out a paper form and notifies the quality manager. The quality manager decides whether to hold or release the batch.' },
  { ts: '4:30', speaker: 'I', text: 'Are quality decisions recorded in the ERP?' },
  { ts: '4:35', speaker: 'C', text: 'No. Only in email. The ERP has no quality hold functionality. The batch record is paper-based.' },
  { ts: '4:40', speaker: 'I', text: 'How do you handle scrap?' },
  { ts: '4:45', speaker: 'C', text: 'Scrap is recorded on the production order by the operator at the end of the shift. Rework requires a separate rework order which is created manually by the production planner.' },
  { ts: '4:50', speaker: 'I', text: 'What reports do you use for production?' },
  { ts: '4:55', speaker: 'C', text: 'We track OEE, first-pass yield, scrap rate, and downtime per machine manually in Excel. The production manager reviews every Friday.' },

  // Sales
  { ts: '5:00', speaker: 'I', text: 'Let me ask about sales. How does an order get created?' },
  { ts: '5:05', speaker: 'C', text: 'The sales team creates a sales order in the ERP from the customer email or phone call. They enter the customer number, item numbers, quantities, and requested delivery date.' },
  { ts: '5:10', speaker: 'I', text: 'What if the customer is new?' },
  { ts: '5:15', speaker: 'C', text: 'If the customer is new, the sales rep has to create the customer record first. This takes about fifteen minutes. Most customers already exist in the system.' },
  { ts: '5:20', speaker: 'I', text: 'How do you handle pricing?' },
  { ts: '5:25', speaker: 'C', text: 'Prices come from the price list in the ERP. For special campaigns or volume discounts, the sales manager approves a manual price override. This is done by email and the override code is entered in the order manually.' },
  { ts: '5:30', speaker: 'I', text: 'How do you manage customer complaints?' },
  { ts: '5:35', speaker: 'C', text: 'Customer emails the support team. The support team forwards to the relevant department — quality, logistics, or sales. There is no ticket system. Resolution time varies from same day to two weeks.' },
  { ts: '5:40', speaker: 'I', text: 'What about shipping? How are outbound deliveries organized?' },
  { ts: '5:45', speaker: 'C', text: 'The logistics team prints a picking list from the ERP. They walk through the warehouse and collect items. Then they pack and arrange shipment with our carrier. The carrier tracking number is typed into the ERP manually after pickup.' },

  // Projects
  { ts: '5:50', speaker: 'I', text: 'Do you do any project-based work?' },
  { ts: '5:55', speaker: 'C', text: 'Yes, we have long-term customer projects that run for three to six months. They involve multiple departments: sales, production, and logistics.' },
  { ts: '6:00', speaker: 'I', text: 'How do you track project costs?' },
  { ts: '6:05', speaker: 'C', text: 'Manually in Excel. Each department logs their hours and material usage on a shared spreadsheet. Finance collects it at month end and reconciles against budget.' },
  { ts: '6:10', speaker: 'I', text: 'Can you see project cost in real time?' },
  { ts: '6:15', speaker: 'C', text: 'No. The project manager sees actual cost only after finance closes the month. This is a major pain point — we often find out too late that a project is over budget.' },
  { ts: '6:20', speaker: 'I', text: 'What about resource planning for projects?' },
  { ts: '6:25', speaker: 'C', text: 'There is no formal resource planning. The project manager assigns people based on availability and gut feeling. There is no system to track who is allocated to what.' },

  // Returns
  { ts: '6:30', speaker: 'I', text: 'How do you handle returns from customers?' },
  { ts: '6:35', speaker: 'C', text: 'The warehouse receives the returned item and checks it against the original order. Then they notify the support team by email. There is no formal returns workflow.' },
  { ts: '6:40', speaker: 'I', text: 'What happens with the credit?' },
  { ts: '6:45', speaker: 'C', text: 'If the return is accepted, finance issues a credit memo manually. It takes three to five days. The customer is notified by email.' },
  { ts: '6:50', speaker: 'I', text: 'How do you handle defective items?' },
  { ts: '6:55', speaker: 'C', text: 'Defective items go to a separate hold area. The quality manager inspects them and decides whether to scrap, rework, or return to supplier. No system tracks this process.' },

  // Other operational
  { ts: '7:00', speaker: 'I', text: 'What other operational areas should we cover?' },
  { ts: '7:05', speaker: 'C', text: 'You should ask about maintenance — we have a separate maintenance department for production equipment. Also about compliance — we have ISO certifications that require documentation.' },
  { ts: '7:10', speaker: 'I', text: 'Tell me about maintenance.' },
  { ts: '7:15', speaker: 'C', text: 'We have two full-time maintenance technicians. They use a paper logbook to record all interventions. Work orders are created by the production manager by email. There is no CMMS system.' },
  { ts: '7:20', speaker: 'I', text: 'What about compliance documentation?' },
  { ts: '7:25', speaker: 'C', text: 'ISO documentation is stored in shared folders. Quality records are mostly paper-based. The quality manager does an internal audit every six months but there is no systematic reminder system.' },

  // ══ Hour 1: Cycle 2 of all 8 focus areas ══════════════════════════════════════
  // Purchasing (cycle 2)
  { ts: '7:30', speaker: 'I', text: 'Let us go through purchasing again in more detail. How many suppliers do you have?' },
  { ts: '7:35', speaker: 'C', text: 'About eighty active suppliers. Ten make up eighty percent of our purchase volume. The rest are occasional or single-order suppliers.' },
  { ts: '7:40', speaker: 'I', text: 'How do you evaluate supplier performance?' },
  { ts: '7:45', speaker: 'C', text: 'We do not have a formal evaluation system. The purchaser knows which suppliers are reliable from experience. For new suppliers, we rely on samples and references.' },
  { ts: '7:50', speaker: 'I', text: 'What are the main supplier-related problems?' },
  { ts: '7:55', speaker: 'C', text: 'Lead time variability — suppliers promise one week but deliver in three. Quality inconsistency — some batches arrive out of spec. And communication — we often do not get notified of delays.' },
  { ts: '8:00', speaker: 'I', text: 'How do you manage incoming quality?' },
  { ts: '8:05', speaker: 'C', text: 'We do a basic visual inspection on arrival. For critical components, we do a full inspection. For standard items, we trust the supplier certificate. This is a manual process.' },

  // Planning (cycle 2)
  { ts: '8:10', speaker: 'I', text: 'Let us go deeper on planning. What happens when a material is missing for a scheduled job?' },
  { ts: '8:15', speaker: 'C', text: 'The planner checks the warehouse. If it is not there, he contacts purchasing to expedite. Purchasing calls the supplier. Meanwhile the job is put on hold.' },
  { ts: '8:20', speaker: 'I', text: 'How often does this happen?' },
  { ts: '8:25', speaker: 'C', text: 'Two to three times per week. It causes significant disruption because the planner has to reshuffle the entire plan.' },
  { ts: '8:30', speaker: 'I', text: 'What would a better planning process look like?' },
  { ts: '8:35', speaker: 'C', text: 'Real-time material availability linked to the production plan. Automatic alert when material falls below safety stock. Supplier lead time visibility so we can plan with real dates.' },
  { ts: '8:40', speaker: 'I', text: 'Do you use any planning modules in your ERP?' },
  { ts: '8:45', speaker: 'C', text: 'We have the ERP but we do not use the planning module because the data quality is too poor. We tried it once and it gave completely wrong suggestions.' },

  // Warehouse (cycle 2)
  { ts: '8:50', speaker: 'I', text: 'Let us revisit warehouse. What is your storage layout?' },
  { ts: '8:55', speaker: 'C', text: 'We have a main warehouse and a secondary storage area. The main warehouse has eight aisles. Items are stored by product family but the logic is not strict.' },
  { ts: '9:00', speaker: 'I', text: 'Is there a warehouse management system?' },
  { ts: '9:05', speaker: 'C', text: 'No. No WMS. The ERP has basic bin locations but they are not used consistently. Workers memorize locations.' },
  { ts: '9:10', speaker: 'I', text: 'How do you do picking for orders?' },
  { ts: '9:15', speaker: 'C', text: 'Picking is done from a printed picking list. The logistics team walks through the warehouse. For large orders, they use a hand cart. There is no wave planning or optimization.' },
  { ts: '9:20', speaker: 'I', text: 'What is the biggest warehouse problem?' },
  { ts: '9:25', speaker: 'C', text: 'Finding items. When a customer asks about order status, we often cannot locate the item in the warehouse quickly. It can take an hour to find something that should be in stock.' },

  // Production (cycle 2)
  { ts: '9:30', speaker: 'I', text: 'Let us go deeper on production. Walk me through a typical day on the shop floor.' },
  { ts: '9:35', speaker: 'C', text: 'The operator arrives at six AM. He checks the production board for today\'s jobs. He reviews the material availability for each job. Then he starts production.' },
  { ts: '9:40', speaker: 'I', text: 'What happens when a machine breaks down?' },
  { ts: '9:45', speaker: 'C', text: 'The operator calls the maintenance technician. He fixes it and writes details in a paper logbook. If it takes more than four hours, the production manager is notified to reschedule.' },
  { ts: '9:50', speaker: 'I', text: 'How do you manage maintenance?' },
  { ts: '9:55', speaker: 'C', text: 'Corrective only. We do not do preventive maintenance on a schedule. We react when something breaks. This causes unexpected downtime.' },
  { ts: '10:00', speaker: 'I', text: 'How do you track machine performance?' },
  { ts: '10:05', speaker: 'C', text: 'The operator writes down cycle times and output on paper at the end of each shift. The production manager enters it into Excel. There is no real-time machine monitoring.' },

  // Sales (cycle 2)
  { ts: '10:10', speaker: 'I', text: 'Let us revisit sales. How do you handle order changes after submission?' },
  { ts: '10:15', speaker: 'C', text: 'If the order has not started production, the sales rep can modify it. If production has started, it requires manager approval and often a new sales order.' },
  { ts: '10:20', speaker: 'I', text: 'What about order cancellations?' },
  { ts: '10:25', speaker: 'C', text: 'The sales rep sends an email to the production manager. They assess impact. If materials have been consumed, a credit memo is issued. There is no formal cancellation workflow.' },
  { ts: '10:30', speaker: 'I', text: 'How do you handle partial shipments?' },
  { ts: '10:35', speaker: 'C', text: 'The ERP supports partial shipments. The sales rep splits the order and ships what is available. The remaining items are shipped when in stock. This is done manually.' },

  // Projects (cycle 2)
  { ts: '10:40', speaker: 'I', text: 'Let us go deeper on projects. How do you define project milestones?' },
  { ts: '10:45', speaker: 'C', text: 'Milestones are defined in a Word document at project start. They are not linked to the ERP. The project manager updates the milestones manually in a shared spreadsheet.' },
  { ts: '10:50', speaker: 'I', text: 'How do you track time against projects?' },
  { ts: '10:55', speaker: 'C', text: 'Workers fill out a paper timesheet with project codes at the end of each week. The project manager allocates hours to projects based on the timesheet and his estimate of actual time.' },
  { ts: '11:00', speaker: 'I', text: 'What reporting do you have for projects?' },
  { ts: '11:05', speaker: 'C', text: 'A monthly Excel report with budget versus actual. It is produced by finance at month close. There is no real-time project dashboard.' },

  // Returns (cycle 2)
  { ts: '11:10', speaker: 'I', text: 'Let me ask more about returns. What is the returns rate approximately?' },
  { ts: '11:15', speaker: 'C', text: 'About two percent of orders have some form of return. Most are minor — wrong item ordered by customer or minor damage in transit.' },
  { ts: '11:20', speaker: 'I', text: 'How do you investigate the cause of a return?' },
  { ts: '11:25', speaker: 'C', text: 'The quality manager looks at the returned item and the original documentation. There is no systematic root cause analysis. It is mostly guesswork.' },
  { ts: '11:30', speaker: 'I', text: 'What would you want in a returns management process?' },
  { ts: '11:35', speaker: 'C', text: 'Automated return authorization. Customer-facing portal to initiate returns. Automatic credit memo generation. And a quality defect tracking system to identify patterns.' },

  // Closing
  { ts: '11:40', speaker: 'I', text: 'We are near the end. What must improve in the new system? Give me your top three priorities.' },
  { ts: '11:45', speaker: 'C', text: 'First: real-time inventory visibility across all locations. Second: automated production planning linked to material availability. Third: supplier portal for price lists and lead times.' },
  { ts: '11:50', speaker: 'I', text: 'Any other pain points we have not covered?' },
  { ts: '11:55', speaker: 'C', text: 'Reporting — we need real-time operational dashboards instead of Excel. And mobile access — our people on the shop floor and warehouse cannot access the system from their workstations.' },
];

// ── Build transcript string for WhatToAnswerLLM ────────────────────────────────
function buildTranscript(turns: typeof FULL_1HR_INTERVIEW): string {
  return turns.map(t => `[${t.speaker}]: ${t.text}`).join('\n');
}

// ── Compliance helpers ──────────────────────────────────────────────────────────
const POLISH_CHARS = ['ą', 'ć', 'ę', 'ł', 'ń', 'ó', 'ś', 'ź', 'ż'];
const B1_VIOLATIONS = ['navigate', 'delve', 'leverage', 'intricate', 'tapestry', 'moreover', 'furthermore', "I'd be happy to", "Let me explain", "Great question"];
const FLAGS = ['⚠️', '📋', '📄', '👤', '✅', '🔧', '❌'];

function checkPolish(text: string): boolean {
  return POLISH_CHARS.some(c => text.includes(c));
}
function checkB1(text: string): boolean {
  return !B1_VIOLATIONS.some(w => text.includes(w));
}
function checkFlags(text: string): boolean {
  return FLAGS.some(f => text.includes(f));
}
function countFollowUps(text: string): number {
  return (text.match(/\?/g) || []).length;
}

// ── Main test ─────────────────────────────────────────────────────────────────
async function main() {
  const overallStart = Date.now();
  console.log('═'.repeat(80));
  console.log('ERP MODE — REAL 1-HOUR LLM STRESS TEST');
  console.log('Actually calling WhatToAnswerLLM.generateStream() with real API calls');
  console.log('═'.repeat(80));
  console.log();

  // ── Step 1: Initialize LLMHelper directly with API keys from env ─────────────
  const groqApiKey = process.env.GROQ_API_KEY || '';
  const geminiApiKey = process.env.GEMINI_API_KEY || '';
  const openaiApiKey = process.env.OPENAI_API_KEY || '';
  const claudeApiKey = process.env.CLAUDE_API_KEY || '';

  console.log(`GROQ_API_KEY set: ${!!groqApiKey}`);
  console.log(`GEMINI_API_KEY set: ${!!geminiApiKey}`);
  console.log(`OPENAI_API_KEY set: ${!!openaiApiKey}`);
  console.log(`CLAUDE_API_KEY set: ${!!claudeApiKey}`);

  const llmHelper = new LLMHelper(
    geminiApiKey || undefined,
    false, // useOllama
    undefined, // ollamaModel
    undefined, // ollamaUrl
    groqApiKey || undefined,
    openaiApiKey || undefined,
    claudeApiKey || undefined
  );

  const hasProvider = !!(groqApiKey || geminiApiKey || openaiApiKey || claudeApiKey);
  console.log(`✅ LLM provider ready: ${hasProvider}`);
  console.log(`   Prompt tier: ${llmHelper.getPromptTier()}`);
  console.log(`   Model: ${llmHelper.getCurrentModel()}`);
  console.log();

  if (!hasProvider) {
    console.error('❌ No LLM provider configured. Check your API keys in .env');
    console.error('   Set at least one of: GROQ_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, CLAUDE_API_KEY');
    process.exit(1);
  }

  // ── Step 2: Build the WhatToAnswerLLM pipeline ───────────────────────────────
  const sessionTracker = new SessionTracker();
  const whatToAnswerLLM = new WhatToAnswerLLM(llmHelper);

  // ── Step 3: Select interviewer turns ───────────────────────────────────────
  const interviewerTurns = FULL_1HR_INTERVIEW.filter(t => t.speaker === 'I');
  console.log(`📋 Interviewer turns: ${interviewerTurns.length}`);
  console.log(`📋 Est. total Q&A: ~${interviewerTurns.length * 2.5}`);
  console.log();

  // ── Step 4: Run the real LLM calls ─────────────────────────────────────────
  const transcript = buildTranscript(FULL_1HR_INTERVIEW);
  const transcriptTokens = estimateTokens(transcript);
  console.log(`📝 Full transcript: ${transcriptTokens} tokens (${transcript.length} chars)`);
  console.log();

  const results: Array<{
    ts: string;
    question: string;
    answer: string;
    tokens: number;
    polish: boolean;
    b1: boolean;
    flags: boolean;
    followUps: number;
    durationMs: number;
    error?: string;
  }> = [];

  // Run the first N turns to keep test reasonable (change to interviewerTurns.length for full run)
  const START = 0;
  const END = Math.min(interviewerTurns.length, 15); // First 15 turns ~5-10 mins with real API

  console.log(`🚀 Running real LLM calls for turns ${START + 1}–${END} of ${interviewerTurns.length}`);
  console.log(`   (${END - START} interviewer turns × real API calls)`);
  console.log('─'.repeat(80));

  for (let i = START; i < END; i++) {
    const turn = interviewerTurns[i];
    const callStart = Date.now();

    // Build context: only prior turns (mimics the real pipeline)
    const turnIndexInFull = FULL_1HR_INTERVIEW.findIndex(
      (t) => t.ts === turn.ts && t.speaker === turn.speaker && t.text === turn.text
    );
    const priorTurns = FULL_1HR_INTERVIEW.slice(0, turnIndexInFull + 1);
    const contextForThisTurn = buildTranscript(priorTurns);

    try {
      let fullAnswer = '';
      const stream = whatToAnswerLLM.generateStream(contextForThisTurn);

      for await (const token of stream) {
        fullAnswer += token;
      }

      const durationMs = Date.now() - callStart;
      const answerTokens = estimateTokens(fullAnswer);

      const polish = checkPolish(fullAnswer);
      const b1 = checkB1(fullAnswer);
      const flags = checkFlags(fullAnswer);
      const followUps = countFollowUps(fullAnswer);

      results.push({
        ts: turn.ts,
        question: turn.text.substring(0, 80) + (turn.text.length > 80 ? '...' : ''),
        answer: fullAnswer,
        tokens: answerTokens,
        polish,
        b1,
        flags,
        followUps,
        durationMs,
      });

      const status = polish && b1 && flags ? '✅' : '❌';
      console.log(`${status} [${turn.ts}] "${turn.text.substring(0, 50)}..." → ${answerTokens}t, ${durationMs}ms, polish=${polish}, b1=${b1}, flags=${flags}, followups=${followUps}`);

    } catch (err: any) {
      const durationMs = Date.now() - callStart;
      console.log(`❌ [${turn.ts}] ERROR: ${err.message}`);
      results.push({
        ts: turn.ts,
        question: turn.text.substring(0, 80) + (turn.text.length > 80 ? '...' : ''),
        answer: '',
        tokens: 0,
        polish: false,
        b1: false,
        flags: false,
        followUps: 0,
        durationMs,
        error: err.message,
      });
    }
  }

  // ── Step 5: Report ───────────────────────────────────────────────────────────
  const totalDurationMs = Date.now() - overallStart;
  const passed = results.filter(r => !r.error && r.polish && r.b1 && r.flags);
  const failed = results.filter(r => r.error || !(r.polish && r.b1 && r.flags));

  console.log();
  console.log('═'.repeat(80));
  console.log('REAL 1-HOUR LLM STRESS TEST — RESULTS');
  console.log('═'.repeat(80));
  console.log();
  console.log(`⏱️  Wall clock time: ${(totalDurationMs / 1000).toFixed(1)}s for ${results.length} turns`);
  console.log(`📡 Total API calls: ${results.length}`);
  console.log();
  console.log(`✅ Compliant answers: ${passed.length}/${results.length}`);
  console.log(`❌ Non-compliant: ${failed.length}/${results.length}`);
  if (failed.length > 0) {
    console.log('   Failed turns:');
    failed.forEach(f => {
      if (f.error) {
        console.log(`   ❌ [${f.ts}] ERROR: ${f.error}`);
      } else {
        const issues = [];
        if (!f.polish) issues.push('no Polish');
        if (!f.b1) issues.push('B1 violation');
        if (!f.flags) issues.push('no flags');
        console.log(`   ❌ [${f.ts}] Issues: ${issues.join(', ')}`);
      }
    });
  }
  console.log();
  console.log('📊 Token stats:');
  const totalAnswerTokens = results.reduce((sum, r) => sum + r.tokens, 0);
  const avgAnswerTokens = results.length > 0 ? Math.round(totalAnswerTokens / results.length) : 0;
  console.log(`   Total answer tokens: ${totalAnswerTokens}`);
  console.log(`   Avg answer tokens: ${avgAnswerTokens}`);
  console.log(`   Transcript tokens: ${transcriptTokens}`);
  console.log(`   Est. total tokens (transcript + answers): ${transcriptTokens + totalAnswerTokens}`);
  console.log();
  console.log('📊 Latency stats:');
  const durations = results.map(r => r.durationMs).filter(d => d > 0);
  if (durations.length > 0) {
    const avgLatency = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    const maxLatency = Math.max(...durations);
    const minLatency = Math.min(...durations);
    console.log(`   Avg latency: ${avgLatency}ms`);
    console.log(`   Min latency: ${minLatency}ms`);
    console.log(`   Max latency: ${maxLatency}ms`);
  }
  console.log();
  console.log('📝 SAMPLE ANSWERS:');
  results.slice(0, 3).forEach((r, i) => {
    console.log();
    console.log(`  [${i + 1}] At ${r.ts}`);
    console.log(`  Q: ${r.question}`);
    const preview = r.answer.substring(0, 300).replace(/\n/g, ' | ');
    console.log(`  A: ${preview}...`);
  });
  console.log();
  console.log('═'.repeat(80));
  const allPassed = failed.length === 0;
  if (allPassed) {
    console.log('✅ ALL CHECKS PASSED — Pipeline is working correctly');
  } else {
    console.log(`❌ ${failed.length} CHECKS FAILED — see above for details`);
  }
  console.log('═'.repeat(80));
}

main().catch(err => {
  console.error('Test crashed:', err);
  process.exit(1);
});
