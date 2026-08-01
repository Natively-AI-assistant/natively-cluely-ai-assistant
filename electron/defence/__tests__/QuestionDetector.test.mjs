import test from 'node:test';
import assert from 'node:assert/strict';
import { QuestionDetector, detectLanguage } from '../../../dist-electron/electron/defence/questionDetector.js';

test('partial transcript does not trigger until stable or silent', () => {
  const detector = new QuestionDetector();
  assert.notEqual(detector.push('How do you prove the retrieval', { final: false }).state, 'complete');
  const complete = detector.push('How do you prove the retrieval quality of your system?', { final: true, silenceMs: 1000 });
  assert.equal(complete.state, 'complete');
  assert.match(complete.question, /retrieval quality/);
});

test('duplicate transcript does not generate twice and follow-up merges', () => {
  const detector = new QuestionDetector();
  detector.push('你如何处理 no evidence？', { final: true, silenceMs: 1000 });
  assert.equal(detector.push('你如何处理 no evidence？', { final: true, silenceMs: 1000 }).state, 'duplicate');
  const next = detector.push('还有测试吗？', { final: true, silenceMs: 1000 });
  assert.equal(next.state, 'complete');
  assert.match(next.question, /no evidence.*测试/s);
});

test('language detection supports Chinese, English and mixed terminology', () => {
  assert.equal(detectLanguage('为什么这样设计？'), 'zh');
  assert.equal(detectLanguage('How does retrieval work?'), 'en');
  assert.equal(detectLanguage('你在 retrieval pipeline 里怎么处理 no evidence？'), 'mixed');
});
