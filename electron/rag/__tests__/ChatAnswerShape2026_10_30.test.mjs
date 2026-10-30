// The two meeting search chats' answers (owner, 2026-10-30, on an answer to
// "ff": "the response structure is so bad for both"). Pins the shared answer
// shape in both RAG prompts and the shared Markdown rendering in both chats.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const src = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('meeting and global chat answers', () => {
  const prompts = src('electron/rag/prompts.ts');
  const meetingPrompt = prompts.slice(prompts.indexOf('export const MEETING_RAG_SYSTEM_PROMPT'), prompts.indexOf('export const GLOBAL_RAG_SYSTEM_PROMPT'));
  const globalPrompt = prompts.slice(prompts.indexOf('export const GLOBAL_RAG_SYSTEM_PROMPT'), prompts.indexOf('export const NO_CONTEXT_FALLBACK'));
  const shape = prompts.slice(prompts.indexOf('const ANSWER_SHAPE = `'), prompts.indexOf('`;', prompts.indexOf('const ANSWER_SHAPE = `')));

  test('both prompts carry the shared answer shape', () => {
    assert.match(meetingPrompt, /\$\{ANSWER_SHAPE\}/);
    assert.match(globalPrompt, /\$\{ANSWER_SHAPE\}/);
  });

  test('a gap is one sentence, then a "Generally," answer, with no "not from your meetings" label', () => {
    assert.match(shape, /ONE short sentence that says so/);
    assert.match(shape, /starting with "Generally," or "In general,"/);
    assert.match(shape, /do not label anything "\(not from your meetings\)"/);
    for (const p of [meetingPrompt, globalPrompt]) assert.doesNotMatch(p, /clearly marked as general knowledge/);
  });

  test('a typo is asked about, not defined', () => {
    assert.match(shape, /do not explain what the letters could stand for/);
  });

  test('the prompts model no em or en dashes', () => {
    for (const p of [shape, meetingPrompt, globalPrompt]) assert.doesNotMatch(p, /[–—]/);
  });

  test('both chats render answers through the shared Markdown renderer', () => {
    for (const f of ['src/components/MeetingChatOverlay.tsx', 'src/components/GlobalChatOverlay.tsx']) {
      assert.match(src(f), /renderMarkdown=\{renderChatMarkdown\}/, f);
    }
    assert.doesNotMatch(src('src/components/GlobalChatOverlay.tsx'), /<React\.Fragment key=\{key\}>\{chunk\}<\/React\.Fragment>/);
  });
});
