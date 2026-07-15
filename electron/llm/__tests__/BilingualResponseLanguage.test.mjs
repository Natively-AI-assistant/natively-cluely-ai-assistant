import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../../..');
const moduleUrl = pathToFileURL(
  path.join(root, 'dist-electron', 'shared', 'aiResponseLanguage.js'),
).href;
const language = await import(moduleUrl);
const { SessionTracker } = await import(pathToFileURL(
  path.join(root, 'dist-electron', 'electron', 'SessionTracker.js'),
).href);
const { RecapLLM } = await import(pathToFileURL(
  path.join(root, 'dist-electron', 'electron', 'llm', 'RecapLLM.js'),
).href);
const { BrainstormLLM } = await import(pathToFileURL(
  path.join(root, 'dist-electron', 'electron', 'llm', 'BrainstormLLM.js'),
).href);
const { ClarifyLLM } = await import(pathToFileURL(
  path.join(root, 'dist-electron', 'electron', 'llm', 'ClarifyLLM.js'),
).href);
const { FollowUpLLM } = await import(pathToFileURL(
  path.join(root, 'dist-electron', 'electron', 'llm', 'FollowUpLLM.js'),
).href);
const { FollowUpQuestionsLLM } = await import(pathToFileURL(
  path.join(root, 'dist-electron', 'electron', 'llm', 'FollowUpQuestionsLLM.js'),
).href);

test('bilingual instruction is persistent, exact, and provider-safe', () => {
  const suffix = language.buildAiResponseLanguageInstructionSuffix(
    language.AI_RESPONSE_LANGUAGE_BILINGUAL_EN_PT,
  );

  assert.match(suffix, /APPLY TO EVERY RESPONSE/);
  assert.match(suffix, /Always emit both exact markers on every response/);
  assert.match(suffix, /faithfully translate the English section/);
  assert.ok(suffix.includes(language.BILINGUAL_EN_MARKER));
  assert.ok(suffix.includes(language.BILINGUAL_PT_BR_MARKER));
  assert.equal(
    language.getProviderLanguageHint(language.AI_RESPONSE_LANGUAGE_BILINGUAL_EN_PT),
    undefined,
  );
});

test('existing language modes keep their current instruction and provider semantics', () => {
  assert.equal(language.buildAiResponseLanguageInstructionSuffix('English'), '');
  assert.match(language.buildAiResponseLanguageInstructionSuffix('auto'), /same language/);
  assert.match(language.buildAiResponseLanguageInstructionSuffix('Portuguese'), /in Portuguese/);
  assert.equal(language.getProviderLanguageHint('English'), undefined);
  assert.equal(language.getProviderLanguageHint('auto'), 'auto');
  assert.equal(language.getProviderLanguageHint('Portuguese'), 'Portuguese');
});

test('formatter and parser round-trip a complete bilingual Markdown response', () => {
  const english = 'I would use **idempotency keys** for safe retries.';
  const portuguese = 'Eu usaria **chaves de idempotência** para tentativas seguras.';
  const raw = language.formatBilingualResponse(english, portuguese);
  const response = language.parseBilingualResponse(raw);

  assert.deepEqual(response, {
    bilingual: true,
    english,
    portuguese,
    englishStarted: true,
    portugueseStarted: true,
  });
});

test('reviewed app fallbacks use both non-empty bilingual sections only in bilingual mode', () => {
  const english = 'The model did not answer in time. Please try again.';
  const portuguese = 'O modelo não respondeu a tempo. Tente novamente.';
  const raw = language.formatLanguageAwareFallback(
    language.AI_RESPONSE_LANGUAGE_BILINGUAL_EN_PT,
    english,
    portuguese,
  );
  const response = language.parseBilingualResponse(raw);

  assert.equal(response.bilingual, true);
  assert.equal(response.english, english);
  assert.equal(response.portuguese, portuguese);
  assert.ok(response.english.length > 0);
  assert.ok(response.portuguese.length > 0);
  assert.equal(language.formatLanguageAwareFallback('English', english, portuguese), english);
});

test('user-visible action catches preserve the bilingual contract', async () => {
  const helper = {
    getAiResponseLanguage: () => language.AI_RESPONSE_LANGUAGE_BILINGUAL_EN_PT,
    getPromptTier: () => 'full',
    fitContextForCurrentModel: (context) => context,
    async *streamChat() {
      throw new Error('provider unavailable');
    },
  };
  const collect = async (stream) => {
    let value = '';
    for await (const chunk of stream) value += chunk;
    return value;
  };

  const outputs = [
    await collect(new BrainstormLLM(helper).generateStream('Visible problem')),
    await collect(new ClarifyLLM(helper).generateStream('Conversation context')),
    await collect(new FollowUpLLM(helper).generateStream('Previous answer', 'Make it shorter')),
    await collect(new FollowUpQuestionsLLM(helper).generateStream('Conversation context')),
  ];

  for (const output of outputs) {
    const parsed = language.parseBilingualResponse(output);
    assert.equal(parsed.bilingual, true);
    assert.ok(parsed.english.length > 0);
    assert.ok(parsed.portuguese.length > 0);
  }
});

test('parser hides an opening marker while it is split across stream chunks', () => {
  const partial = language.BILINGUAL_EN_MARKER.slice(0, 12);
  assert.deepEqual(language.parseBilingualResponse(`\n${partial}`), {
    bilingual: true,
    english: '',
    portuguese: '',
    englishStarted: false,
    portugueseStarted: false,
  });
});

test('parser hides every partial Portuguese marker without truncating English', () => {
  const answer = 'I would first reproduce the issue and inspect the logs.';

  for (let length = 1; length < language.BILINGUAL_PT_BR_MARKER.length; length += 1) {
    const raw = `${language.BILINGUAL_EN_MARKER}\n${answer}\n${language.BILINGUAL_PT_BR_MARKER.slice(0, length)}`;
    const response = language.parseBilingualResponse(raw);
    assert.equal(response.bilingual, true);
    assert.equal(response.english, answer);
    assert.equal(response.portuguese, '');
    assert.equal(response.portugueseStarted, true);
  }
});

test('parser tolerates a missing opening marker when the translation boundary exists', () => {
  const response = language.parseBilingualResponse(
    `I would add a unique constraint.\n${language.BILINGUAL_PT_BR_MARKER}\nEu adicionaria uma restrição única.`,
  );

  assert.equal(response.bilingual, true);
  assert.equal(response.english, 'I would add a unique constraint.');
  assert.equal(response.portuguese, 'Eu adicionaria uma restrição única.');
});

test('plain responses remain untouched and English context excludes the translation', () => {
  const plain = 'A regular answer without protocol markers.  ';
  assert.deepEqual(language.parseBilingualResponse(plain), {
    bilingual: false,
    english: plain,
    portuguese: '',
    englishStarted: true,
    portugueseStarted: false,
  });
  assert.equal(language.englishForContext(plain), plain);

  const raw = language.formatBilingualResponse(
    'I would monitor p95 latency.',
    'Eu monitoraria a latência p95.',
  );
  assert.equal(language.englishForContext(raw), 'I would monitor p95 latency.');
});

test('SessionTracker stores only English in every model-facing assistant-memory view', () => {
  const session = new SessionTracker();
  const english = 'I would add an idempotency key before retrying the payment request.';
  const portuguese = 'Eu adicionaria uma chave de idempotência antes de repetir a requisição de pagamento.';
  const raw = language.formatBilingualResponse(english, portuguese);

  session.addAssistantMessage(raw, undefined, 'manual_chat');

  assert.equal(session.getLastAssistantMessage(), english);
  assert.equal(session.getLastAssistantMessage('manual_chat'), english);
  assert.deepEqual(
    session.getAssistantResponseHistory('manual_chat').map(({ text }) => text),
    [english],
  );
  assert.match(session.getFormattedContext(120, 'manual_chat'), new RegExp(english));
  assert.equal(session.getFullTranscript().at(-1)?.text, english);
  assert.match(session.getFullSessionContext(), new RegExp(english));

  for (const modelFacingValue of [
    session.getFormattedContext(120, 'manual_chat'),
    session.getFullSessionContext(),
    session.getLastAssistantMessage() ?? '',
    session.getAssistantResponseHistory()[0]?.text ?? '',
  ]) {
    assert.doesNotMatch(modelFacingValue, /NATIVELY_(?:EN|PT_BR)/);
    assert.doesNotMatch(modelFacingValue, /Eu adicionaria/);
  }

  // Session storage must not rewrite the caller-owned response used by the UI.
  assert.equal(raw, language.formatBilingualResponse(english, portuguese));
});

test('RecapLLM returns a clamped English-only recap when the provider emits a bilingual envelope', async () => {
  const english = '- The team chose queued retries.\n- The rollout starts on Tuesday.';
  const portuguese = '- A equipe escolheu tentativas em fila.\n- A implantação começa na terça-feira.';
  const raw = language.formatBilingualResponse(english, portuguese);
  const helper = {
    getPromptTier: () => 'full',
    fitContextForCurrentModel: (context) => context,
    async *streamChat() {
      yield raw.slice(0, 24);
      yield raw.slice(24);
    },
  };

  const recap = await new RecapLLM(helper).generate('[INTERVIEWER]: Summarize our decision.');

  assert.equal(recap, english);
  assert.doesNotMatch(recap, /NATIVELY_(?:EN|PT_BR)/);
  assert.doesNotMatch(recap, /A equipe|implantação/);
});
