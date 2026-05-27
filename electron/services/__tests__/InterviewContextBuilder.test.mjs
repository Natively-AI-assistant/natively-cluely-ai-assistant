// InterviewContextBuilder — pause scenario retains session spine
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadModules() {
  const builderPath = path.resolve(__dirname, '../../../dist-electron/electron/services/context/InterviewContextBuilder.js');
  const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
  const [builderMod, sessionMod] = await Promise.all([
    import(pathToFileURL(builderPath).href),
    import(pathToFileURL(sessionPath).href),
  ]);
  return { builderMod, SessionTracker: sessionMod.SessionTracker };
}

describe('InterviewContextBuilder', () => {
  test('after long pause, spine still includes early session content', async () => {
    const { builderMod, SessionTracker } = await loadModules();
    const { buildInterviewContext } = builderMod;
    const session = new SessionTracker();

    const early = Date.now() - 6 * 60 * 1000;
    session.addTranscript({
      speaker: 'interviewer',
      text: 'Design a rate limiter for a distributed API gateway.',
      timestamp: early,
      final: true,
    });
    session.setCodingQuestion('Design a rate limiter for a distributed API gateway.', 'transcript');

    session.addTranscript({
      speaker: 'interviewer',
      text: 'What tradeoffs would you consider?',
      timestamp: Date.now() - 2000,
      final: true,
    });

    const bundle = buildInterviewContext(session);
    assert.ok(bundle.spine.includes('rate limiter'), 'spine should retain early problem statement');
    assert.ok(bundle.activeProblemStatement?.includes('rate limiter'));
    assert.ok(bundle.recencyTranscript.length > 0);
  });

  test('formatInterviewContextForChat emits session_spine block', async () => {
    const { builderMod, SessionTracker } = await loadModules();
    const { buildInterviewContext, formatInterviewContextForChat } = builderMod;
    const session = new SessionTracker();
    session.addTranscript({
      speaker: 'interviewer',
      text: 'Tell me about a challenging project.',
      timestamp: Date.now() - 1000,
      final: true,
    });

    const formatted = formatInterviewContextForChat(buildInterviewContext(session));
    assert.match(formatted, /<session_spine>/);
    assert.match(formatted, /<transcript>/);
  });

  test('acceptedRequirements come from ActiveProblem.constraints', async () => {
    const { builderMod, SessionTracker } = await loadModules();
    const { buildInterviewContext } = builderMod;
    const session = new SessionTracker();
    session.setCodingQuestion('Two Sum', 'transcript');
    session.updateActiveProblemConstraints(['Input is sorted', 'No duplicates']);

    const bundle = buildInterviewContext(session);
    assert.deepEqual(bundle.acceptedRequirements, ['Input is sorted', 'No duplicates']);
  });
});
