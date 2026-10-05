// No raw error line reaches the overlay's chat any more (2026-10-05).
//
// The overlay used to post what was thrown as text: "❌ Error (what_to_say):
// …", "❌ Error starting stream: …", "Error: Error: Error invoking remote
// method …", and "[Error: …]" written into a half-streamed answer. Every one
// of those sites now hands the raw error to failedLine, and the row draws
// DirectAssistNotice. This pins the wiring; the wording is tested in
// chatFailure2026_10_05.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(dirname, rel), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
const overlay = stripComments(read('../../components/NativelyInterface.tsx'));
const notice = stripComments(read('../../components/ui/DirectAssistNotice.tsx'));

test('no message text is built from a raw error, an emoji mark or a bracketed dump', () => {
  assert.doesNotMatch(overlay, /❌|⏳|⚠️|✅/, 'no emoji used as a status mark');
  assert.doesNotMatch(overlay, /text:\s*`[^`]*\$\{(?:err|error)\b/, 'no `text` template that prints the thrown value');
  assert.doesNotMatch(overlay, /text:\s*`[^`]*\$\{data\.error\}/);
  assert.doesNotMatch(overlay, /\[[A-Za-z ]*Error:/, 'the error is never written into the answer ("[Error: …]", "[RAG Error: …]")');
  assert.doesNotMatch(overlay, /text:\s*lastMsg\.text \+/, 'nothing is appended to an answer\'s text on failure');
  assert.doesNotMatch(overlay, /Error starting stream/);
  assert.doesNotMatch(overlay, /one moment…|— one moment/);
});

test('every failure goes through one place, which makes notice data and one plain sentence', () => {
  assert.ok(overlay.includes("import { chatFailureFromError, isProviderFailureSentence } from '../lib/chatFailure.mjs';"));
  const def = overlay.slice(overlay.indexOf('const failedLine = useCallback('), overlay.indexOf('}, []);', overlay.indexOf('const failedLine = useCallback(')));
  assert.ok(def.includes('chatFailureFromError(raw, { provider: chatProviderLabelRef.current })'), 'named the way the model dropdown names the provider');
  assert.ok(def.includes('directAssistFailureText(failure, chatFailureT.current)'), 'the text is the one sentence Copy takes');
  assert.ok(overlay.includes("chatProviderLabelRef.current = config.provider ? modelSelectorGroupLabel(config.provider) : '';"));
  // The quick actions, the suggestion error, the engine error, a stream that
  // fails to start (two call sites, two branches each) and one that fails midway.
  const uses = overlay.split('failedLine(').length - 1;
  assert.ok(uses >= 14, `failedLine is used at ${uses - 1} sites`);
  assert.equal(overlay.split('...failedLine(err)').length - 1, 11);
});

test('a What to Answer failure is never silent, and is said once', () => {
  const handler = overlay.slice(overlay.indexOf('window.electronAPI.onIntelligenceError((data) => {'));
  const body = handler.slice(0, handler.indexOf('\n      }),'));
  // Posted for every mode: the engine only follows a PROVIDER failure with a
  // sentence. For anything else it returns a retry line that nothing shows.
  assert.doesNotMatch(body, /if \(data\.mode === 'what_to_say'\) return;/);
  assert.ok(body.includes('...failedLine(data.error),'));
  assert.ok(body.includes("...(data.mode === 'what_to_say' ? { intent: WHAT_TO_SAY_ERROR_INTENT } : {}),"), 'marked, so the sentence can take it back');
  // The engine side: the raw error first, then (provider failures only) the sentence.
  const engine = read('../../../electron/IntelligenceEngine.ts');
  const at = engine.indexOf("this.emit('error', error as Error, 'what_to_say');");
  assert.ok(at > 0);
  const after = engine.slice(at, at + 1400);
  assert.ok(after.indexOf("this.emit('suggested_answer', providerMessage") > 0);
  assert.ok(after.includes('return buildGracefulRetry(question);'), 'the other branch emits nothing');
  // When that sentence arrives, the notice posted a moment before goes: only
  // if it is still the last row, so an older one is never removed.
  const answer = overlay.slice(overlay.indexOf('window.electronAPI.onIntelligenceSuggestedAnswer((data) => {'));
  const head = answer.slice(0, 1800);
  assert.ok(head.includes('takeBackWhatToSayNotice(data.answer);'));
  assert.ok(head.indexOf('if (!decision.accept) return;') < head.indexOf('takeBackWhatToSayNotice(data.answer);'), 'a superseded answer removes nothing');
  const takeBack = overlay.slice(overlay.indexOf('const takeBackWhatToSayNotice = useCallback('), overlay.indexOf('}, []);', overlay.indexOf('const takeBackWhatToSayNotice = useCallback(')));
  assert.ok(takeBack.includes('if (!isProviderFailureSentence(answer)) return;'));
  assert.ok(takeBack.includes('prev[prev.length - 1]?.intent === WHAT_TO_SAY_ERROR_INTENT ? prev.slice(0, -1) : prev'));
  assert.ok(overlay.includes("const WHAT_TO_SAY_ERROR_INTENT = 'what_to_say_error';"));
});

test('a search of past meetings that fails mid-answer is treated the same way', () => {
  const at = overlay.indexOf('window.electronAPI.onRAGStreamError(');
  assert.ok(at > 0);
  const block = overlay.slice(at, at + 1400);
  assert.ok(block.includes('const failed = failedLine(data.error);'));
  assert.ok(block.includes('failure: { ...failed.failure, partial: true }'));
  assert.ok(block.includes(': { ...lastMsg, isStreaming: false, ...failed };'));
});

test('an answer that broke off keeps its text clean and is marked cut off; one that never began is replaced', () => {
  const at = overlay.indexOf('const failed = failedLine(error);');
  assert.ok(at > 0);
  const block = overlay.slice(at, at + 900);
  assert.ok(block.includes("? { ...lastMsg, isStreaming: false, failure: { ...failed.failure, partial: true } }"));
  assert.ok(block.includes(': { ...lastMsg, isStreaming: false, ...failed };'));
  assert.doesNotMatch(block, /lastMsg\.text \+/);
});

test('a blocked press shows one quiet line, however often it is pressed, and it leaves with the action', () => {
  assert.ok(overlay.includes("postChatHint('what_to_say');") && overlay.includes("postChatHint('code_hint');"));
  const post = overlay.slice(overlay.indexOf('const postChatHint = useCallback('), overlay.indexOf('}, []);', overlay.indexOf('const postChatHint = useCallback(')));
  assert.ok(post.includes('prev.some((m) => m.hint === actionKey)') && post.includes('? prev'), 'never stacked');
  assert.ok(post.includes('text: CHAT_HINTS[actionKey], hint: actionKey'));
  const end = overlay.slice(overlay.indexOf('const endOverlayAction = useCallback('), overlay.indexOf('const postChatHint = useCallback('));
  assert.ok(end.includes('prev.filter((m) => m.hint !== actionKey)'), 'gone when the action it waited on ends');
  assert.ok(end.includes('prev.some((m) => m.hint === actionKey) ?') && end.includes(': prev'), 'no re-render when there was none');
  // Drawn as a footnote-sized status with the sentence translated at render time.
  assert.ok(overlay.includes('<ChatHintLine>{t(CHAT_HINTS[msg.hint])}</ChatHintLine>'));
  const hint = notice.slice(notice.indexOf('export const ChatHintLine'));
  assert.ok(hint.includes('role="status"') && hint.includes('text-[11.5px]') && hint.includes('motion-reduce:animate-none'));
  assert.doesNotMatch(hint, /[A-Z][a-z]+ [a-z]+ [a-z]+/, 'no English of its own');
});

test('a quick action that failed before a word arrived does not leave "Thinking..." above its failure', () => {
  const def = overlay.slice(overlay.indexOf('const discardEmptyPlaceholder = useCallback('), overlay.indexOf('}, []);', overlay.indexOf('const discardEmptyPlaceholder = useCallback(')));
  // Only that action's own placeholder, and only while it is still empty.
  assert.ok(def.includes("if (streamingIntentRef.current !== intent || streamingTextRef.current !== '') return;"));
  assert.ok(def.includes('discardStreamingByIntentMessages(prev, intent)'));
  assert.ok(def.includes('streamingMsgIdRef.current = null;') && def.includes('streamingIntentRef.current = null;'));
  for (const [api, intent] of [['generateRecap', 'recap'], ['generateFollowUpQuestions', 'follow_up_questions'], ['generateClarify', 'clarify']]) {
    const at = overlay.indexOf(`await window.electronAPI.${api}();`);
    assert.ok(at > 0, api);
    assert.ok(overlay.slice(at, at + 200).includes(`discardEmptyPlaceholder('${intent}');`), `${api} clears its placeholder before posting`);
  }
  const handler = overlay.slice(overlay.indexOf('window.electronAPI.onIntelligenceError((data) => {'));
  assert.ok(handler.slice(0, handler.indexOf('\n      }),')).includes('discardEmptyPlaceholder(data.mode);'));
});

test('nothing about an answer is written into the answer: it is a quiet note beside it', () => {
  // No label in front, no italic suffix, no emoji mark.
  assert.doesNotMatch(overlay, /\(Late answer to:/);
  assert.doesNotMatch(overlay, /_Incomplete/);
  assert.doesNotMatch(overlay, /🎯|\*\*Answer:\*\*/);
  assert.ok(overlay.includes("finalizeStreamingByIntent('chat', data.answer);"), 'a manual answer is shown as it is');

  // A late answer: the note goes on the live row, which the finalize keeps;
  // with no row to carry it the label is still not lost.
  const late = overlay.slice(overlay.indexOf('const labelLateAnswer = useCallback('), overlay.indexOf('}, []);', overlay.indexOf('const labelLateAnswer = useCallback(')));
  assert.ok(late.includes("{ ...m, note: { kind: 'late', question } }"));
  assert.ok(late.includes('if (liveRowId == null) return `${chatNoteText('), 'fallback when there is no row');
  assert.ok(overlay.includes('const answerText = labelLateAnswer(liveRowId, isStale ? data.question : undefined, data.answer);'));

  // A cancelled or replaced answer keeps its text clean.
  assert.ok(overlay.includes('const text = active.answerText || terminalLabel;'));
  assert.ok(overlay.includes("kind: terminalLabel === 'Request cancelled.' ? 'stopped' : 'superseded',"));
  assert.ok(overlay.includes('...(failure ? { failure: { ...failure, partial: Boolean(active.answerText) } } : { note }),'), 'a failure has its notice, anything else its note');

  // Nothing to answer yet: main's reason when it gives one, ours otherwise.
  assert.ok(overlay.includes('const feedback = result.error ?? CHAT_NOTES.noneYet;'));
  assert.ok(overlay.includes("applyWhatToAnswerNullFeedbackMessages(prev, feedback, undefined, { note: noneYet })"));

  // Drawn at footnote size; a note that stands alone replaces the text, one
  // about an answer sits above (late) or under it.
  assert.ok(overlay.includes('<ChatNoteLine kind="late" className="mb-1.5">{chatNoteText(msg.note, t)}</ChatNoteLine>'));
  assert.ok(overlay.includes("<ChatNoteLine kind={msg.note.kind} className={msg.note.alone ? '' : 'mt-2'}>{chatNoteText(msg.note, t)}</ChatNoteLine>"));
  assert.ok(overlay.includes("msg.role === 'system' && msg.note?.alone ? null"));
  const line = notice.slice(notice.indexOf('export const ChatNoteLine'), notice.indexOf('export default DirectAssistNotice'));
  assert.ok(line.includes('text-[11.5px]') && line.includes('data-chat-note={kind}'));
  assert.doesNotMatch(line, /text-(red|amber|yellow)-/, 'no alarm colour: none of these is an error');
});

test('the note sentences are published, so they are translated', async () => {
  const { CHAT_NOTES, DIRECT_ASSIST_PHRASES, chatNoteText } = await import('../directAssistFailure.mjs');
  assert.deepEqual(Object.keys(CHAT_NOTES).sort(), ['late', 'noneYet', 'stopped', 'superseded']);
  for (const sentence of Object.values(CHAT_NOTES)) assert.ok(DIRECT_ASSIST_PHRASES.includes(sentence), sentence);
  assert.equal(chatNoteText({ kind: 'late', question: 'Why Redis?' }), 'Late answer to “Why Redis?”');
  assert.equal(chatNoteText({ kind: 'stopped' }), 'Stopped before it finished');
  assert.equal(chatNoteText({ kind: 'noneYet', text: 'Wait for the cooldown.' }), 'Wait for the cooldown.', "main's own reason is shown as given");
  // The feedback row carries the note through the pure reducer.
  const { applyWhatToAnswerNullFeedbackMessages } = await import('../overlayMessagePersistence.mjs');
  const open = [{ id: 'a', role: 'system', intent: 'what_to_answer', text: '', isStreaming: true }];
  assert.deepEqual(applyWhatToAnswerNullFeedbackMessages(open, 'x', undefined, { note: { kind: 'noneYet', alone: true } })[0].note, { kind: 'noneYet', alone: true });
  assert.equal(applyWhatToAnswerNullFeedbackMessages(open, 'x')[0].note, undefined, 'unchanged for callers that pass nothing');
});

test('the two Settings lines: an icon instead of an emoji, a sentence instead of a code', () => {
  const settings = stripComments(read('../../components/SettingsOverlay.tsx'));
  assert.doesNotMatch(settings, /⚠️/);
  assert.match(settings, /<TriangleAlert[^>]*aria-hidden="true" \/>\s*\{t\('Disable Undetectable mode first to change disguise\.'\)\}/);
  const skills = stripComments(read('../../components/settings/SkillsSettings.tsx'));
  assert.doesNotMatch(skills, /first\.field|first\.code|Upload failed \(/);
  assert.ok(skills.includes("`Couldn't add this skill. ${first.message}`"));
});

test('the notice is the only thing drawn for a failed line', () => {
  assert.ok(overlay.includes("msg.role === 'system' && msg.failure && !msg.failure.partial ? null : renderMessageText(msg)"));
  assert.ok(overlay.includes('<DirectAssistNotice'));
});
