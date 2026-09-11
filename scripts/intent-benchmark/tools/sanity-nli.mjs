// Sanity check: is the zero-shot pipeline being driven correctly?
// Uses clean, unambiguous prose — if the model can't do THESE, the harness is
// broken; if it can, then its failure on real STT text is a real finding.
const { pipeline, env } = await import('@huggingface/transformers');
env.allowRemoteModels = false;
env.localModelPath = new URL('../../../resources/models', import.meta.url).pathname;
const pipe = await pipeline('zero-shot-classification', 'Xenova/mobilebert-uncased-mnli', { local_files_only: true, dtype: 'q8' });
const LABELS = [
  'asking for clarification or explanation',
  'asking about what happened next or follow-up',
  'requesting more detail or deeper explanation',
  'asking for a personal experience or behavioral example',
  'requesting a concrete example or instance',
  'summarizing or confirming understanding',
  'asking about code, programming, or implementation',
  'general conversation or question',
];
const CASES = [
  ['Can you explain what you mean by that?', 'clarification'],
  ['Write a function that reverses a linked list.', 'coding'],
  ['Tell me about a time you handled conflict.', 'behavioral'],
  ['So to summarize, we agreed on the Q3 date.', 'summary_probe'],
  ['what happened next', 'follow_up'],
];
for (const [text, want] of CASES) {
  const r = await pipe(text, LABELS, { multi_label: false });
  console.log(`want=${want.padEnd(15)} top=${r.labels[0].slice(0,42).padEnd(44)} score=${r.scores[0].toFixed(3)}`);
}
