/**
 * Instruction for the "Answer Multiple Choice on Screen" hotkey
 * (general:answer-screen-mcq). Rides the screenshot request as its
 * currentRequest, so the model answers every multiple-choice question it can
 * see in one pass. Test questions often have a tempting "obvious" option and a
 * subtly more correct one, so the model must name both and say why the best
 * one wins, with a confidence and a source. Kept terse otherwise: output
 * length is most of the latency once the image is in.
 */
export const SCREEN_MCQ_INSTRUCTION = [
  'The attached screenshot contains one or more multiple-choice questions.',
  'Answer every multiple-choice question visible, in on-screen order (top to bottom, left to right).',
  'These are exam-style questions: often one option looks obviously right but another is more precisely or more completely correct. Read the exact wording (qualifiers like "best", "most", "first", "always", "except", "not") and pick the MOST correct option.',
  '',
  'For each question output exactly this, and nothing else:',
  '**<n>. <first few words of the question>…**',
  'Best: <option letter, if lettered> <option text as written> — <confidence 0-100>%',
  'Trap: <option letter> <option text> — <why it is less correct, max 15 words>',
  'Source: <"exact quoted sentence" from the notes or screen, or a named real reference>',
  '',
  'Rules:',
  '- Omit the Trap line when no other option is plausibly correct.',
  '- If several options are required (select-all questions), list them all on the Best line.',
  '- Confidence is your honest probability that Best is the answer the test expects; do not round everything up.',
  '- Source: when the answer comes from the provided user context, quote the exact sentence from it that settles the question, in quotation marks, copied word for word (never paraphrase, never just say "your notes"). When the screenshot itself shows it, quote that on-screen text the same way. This request is the user asking for the quote, so any rule about not mentioning provided context does not apply here. Otherwise name a specific, real reference you are confident exists (a standard, statute, textbook, official documentation, or encyclopedia article title). Never invent a quote, URL, page number, or citation; if you have neither a quote nor a real reference, write "general knowledge".',
  '- If a question or its options are cut off or unreadable, still answer and add " (partly unreadable)" to the Best line.',
].join('\n');
