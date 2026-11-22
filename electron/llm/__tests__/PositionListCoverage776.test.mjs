// electron/llm/__tests__/PositionListCoverage776.test.mjs
//
// #776: "what should be the first line, middle line, last line?" asks for
// three parts with one wh-word. hasMultipleSubQuestions called it a single
// question, so assessAnswerCoverage never flagged an answer that named the
// base image and the copy step and stopped before the startup instruction.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (f) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm', f)).href;
const { assessAnswerCoverage, shouldAttemptClauseRepair } = await import(dist('answerCoverage.js'));
const { hasMultipleSubQuestions, detectIncompleteSubQuestionAnswer, classifyDocumentQuestionShape } = await import(dist('documentGroundedPrompt.js'));
const { extractPositionParts } = await import(dist('positionList.js'));
const { enumerableFormLine } = await import(dist('answerStyle.js'));
const isPositionList = (q) => extractPositionParts(q).length >= 2;
const { materialHasAttachedDocuments, materialHasNoDocuments, describeVerifierEdit } = await import(dist('claimVerifier.js'));

// Verbatim interviewer turn and suggestion from the issue's saved transcript.
const LIVE_Q = 'like, what what should be the first line, middle line, last line, like, at high level?';
const SHIPPED_ANSWER = "I'd use a Dockerfile. The first line would choose a suitable base image. Then I'd add instructions to copy the application files and handle its dependencies.";
const FULL_ANSWER = 'First, FROM selects a Java runtime image. In the middle, COPY adds the JAR to the image. Finally, ENTRYPOINT starts the app with java -jar /app/app.jar.';

describe('extractPositionParts: position lists', () => {
  test('the issue question is multi-part', () => {
    assert.equal(isPositionList('What should be the first line, middle line, last line?'), true);
    assert.equal(isPositionList(LIVE_Q), true);
  });

  test('a shared trailing noun and other joiners count', () => {
    assert.equal(isPositionList('What are the first, middle and last instructions?'), true);
    assert.equal(isPositionList('What is the first step and the final step?'), true);
    assert.equal(isPositionList('What do you do first and then second?'), true);
  });

  test('one position, or positions not joined as a list, stay single-part', () => {
    assert.equal(isPositionList('What is the first thing you check?'), false);
    assert.equal(isPositionList('What was your last role?'), false);
    assert.equal(isPositionList('Was that the first time you led the last release?'), false);
    assert.equal(isPositionList('Is this a first-class feature in the last version?'), false);
  });

  test('idioms that pair two positions are not lists', () => {
    assert.equal(isPositionList('What is your first and last name?'), false);
    assert.equal(isPositionList('What matters first and foremost here?'), false);
  });

  test('a choice between positions is not a list (review 2026-11-21)', () => {
    assert.equal(isPositionList('Should we go with the first or second approach?'), false);
    assert.equal(isPositionList('Is this your first or second interview?'), false);
    assert.equal(isPositionList('What is your first or last name?'), false);
    assert.equal(isPositionList('Was it the first, second, or third sprint?'), false);
    const a = assessAnswerCoverage('Should we go with the first or second approach?', "I'd go with the second approach because it scales.");
    assert.equal(a.incomplete, false);
    assert.equal(enumerableFormLine('Should we go with the first or second approach?').includes('parts'), false);
  });

  test('parts come from the list only, not position words elsewhere in the question', () => {
    const parts = extractPositionParts('What are the first and last steps, and why did you leave your second job?');
    assert.deepEqual(parts.map((p) => p.label), ['first steps', 'last steps']);
  });

  test('a position list does not change the document answer shape', () => {
    // hasMultipleSubQuestions also picks the shape: two values stay a numeric question.
    assert.equal(hasMultipleSubQuestions('What were the first and final success rates?'), false);
    assert.equal(hasMultipleSubQuestions('What should be the first line, middle line, last line?'), false);
    assert.notEqual(classifyDocumentQuestionShape('What were the first and final success rates?'), 'list_answer');
  });
});

describe('assessAnswerCoverage: position lists', () => {
  test('the shipped answer is missing the last line (the reported bug)', () => {
    const a = assessAnswerCoverage(LIVE_Q, SHIPPED_ANSWER);
    assert.equal(a.multiPart, true);
    assert.equal(a.incomplete, true);
    assert.deepEqual(a.missing, ['last line']);
    assert.equal(shouldAttemptClauseRepair(a), true);
  });

  test('an answer covering first, middle and last passes', () => {
    const a = assessAnswerCoverage(LIVE_Q, FULL_ANSWER);
    assert.equal(a.multiPart, true);
    assert.equal(a.incomplete, false);
    assert.deepEqual(a.missing, []);
  });

  test('the shipped answer plus the startup instruction passes (the repair would be accepted)', () => {
    const repaired = `${SHIPPED_ANSWER}\n\nThe last line is the ENTRYPOINT or CMD that runs the JAR.`;
    assert.equal(assessAnswerCoverage(LIVE_Q, repaired).incomplete, false);
  });

  test('a position word inside another word does not count ("end" in "dependencies")', () => {
    const r = detectIncompleteSubQuestionAnswer({
      question: 'What should be the first line and last line?',
      answer: 'The first line picks a base image and installs dependencies.',
    });
    assert.deepEqual(r.missing, ['last line']);
  });

  test('a shared trailing noun labels every missing part', () => {
    const r = detectIncompleteSubQuestionAnswer({
      question: 'What are the first, middle and last instructions?',
      answer: 'It starts with FROM.',
    });
    assert.deepEqual(r.missing, ['middle instructions', 'last instructions']);
  });

  test('a refusal is never flagged', () => {
    assert.equal(assessAnswerCoverage(LIVE_Q, 'I would rather not say.', { answerIsRefusal: true }).incomplete, false);
  });
});

describe('coverage of answers in the asked format (review 2026-11-21)', () => {
  const Q = 'What should be the first line, middle line, last line?';

  test('a numbered answer with no position words covers every part', () => {
    const numbered = '1. FROM eclipse-temurin:21 picks the runtime.\n2. COPY app.jar /app.jar adds the build.\n3. ENTRYPOINT ["java","-jar","/app.jar"] runs it.';
    assert.equal(assessAnswerCoverage(Q, numbered).incomplete, false);
    assert.equal(detectIncompleteSubQuestionAnswer({ question: Q, answer: numbered }).incomplete, false);
  });

  test('an inline numbered run counts too', () => {
    const inline = '1) FROM python:3.12-slim 2) RUN pip install -r requirements.txt 3) CMD python app.py';
    assert.equal(assessAnswerCoverage(Q, inline).incomplete, false);
  });

  test('a short numbered list names the part it stops before', () => {
    const two = '1. FROM eclipse-temurin:21 picks the runtime.\n2. COPY app.jar /app.jar adds the build.';
    assert.deepEqual(assessAnswerCoverage(Q, two).missing, ['last line']);
  });

  test('filler words mid-sentence do not mark a position', () => {
    for (const filler of [' In the end the image stays small.', ' Keep it at the top of the repo.', ' It sits next to the source.']) {
      assert.deepEqual(assessAnswerCoverage(LIVE_Q, SHIPPED_ANSWER + filler).missing, ['last line'], filler);
    }
  });

  test('the same words opening a clause, or leading "with", still mark one', () => {
    assert.equal(assessAnswerCoverage(Q, 'Start with FROM for the base image. Then COPY the JAR. It ends with ENTRYPOINT.').incomplete, false);
    assert.equal(assessAnswerCoverage(Q, 'First, FROM picks the base, then COPY adds the JAR, and lastly ENTRYPOINT runs it.').incomplete, false);
  });

  test('a depth ask keeps the part names', () => {
    const line = enumerableFormLine('Explain in detail the first, middle and last line of the Dockerfile.');
    assert.match(line, /3 parts \(first line, middle line, last line\) in detail/);
  });
});

describe('describeVerifierEdit: what an edit did, as counts only', () => {
  test('an edit that drops the last part shows it', () => {
    const draft = `${SHIPPED_ANSWER} Finally, ENTRYPOINT runs the JAR.`;
    const s = describeVerifierEdit(LIVE_Q, draft, SHIPPED_ANSWER);
    assert.deepEqual(s.partsMissing, { draft: 0, edit: 1 });
    assert.equal(s.draftWords, s.editWords + 5);
  });

  test('the gist line is not counted', () => {
    const s = describeVerifierEdit(LIVE_Q, `${FULL_ANSWER}\n\n[[GIST]] FROM, COPY, ENTRYPOINT`, FULL_ANSWER);
    assert.equal(s.draftWords, s.editWords);
    assert.deepEqual(s.partsMissing, { draft: 0, edit: 0 });
  });

  test('a single-part question has no parts count', () => {
    const s = describeVerifierEdit('Why did you choose Kafka?', 'Because of throughput and replay.', 'Because of throughput.');
    assert.equal(s.partsMissing, undefined);
    assert.deepEqual([s.draftWords, s.editWords], [5, 3]);
  });

  test('the summary holds numbers only, never answer or question text', () => {
    const s = describeVerifierEdit(LIVE_Q, FULL_ANSWER, SHIPPED_ANSWER);
    const values = [s.draftWords, s.editWords, ...Object.values(s.partsMissing)];
    for (const v of values) assert.equal(typeof v, 'number');
    assert.deepEqual(Object.keys(s).sort(), ['draftWords', 'editWords', 'partsMissing']);
  });
});

describe('materialHasAttachedDocuments: the live transcript is not a document', () => {
  const ev = (type) => `<evidence evidence_id="e1" source_type="${type}" source_id="x">\ntext\n</evidence>`;
  test('transcript, conversation state and screen alone are not documents', () => {
    for (const t of ['MEETING_TRANSCRIPT', 'CONVERSATION_STATE', 'SCREEN_CONTEXT']) {
      assert.equal(materialHasAttachedDocuments(ev(t)), false, t);
      // One rule since #777: the no-documents check (Sales/Call Center wording, interview modes) agrees.
      assert.equal(materialHasNoDocuments(ev(t)), true, t);
    }
  });
  test('any attached source type is a document', () => {
    for (const t of ['RESUME', 'JOB_DESCRIPTION', 'PROFILE_FACT', 'REFERENCE_FILE', 'PROJECT_FILE', 'CODING_SAMPLE', 'CANDIDATE_FILE']) {
      assert.equal(materialHasAttachedDocuments(`${ev('MEETING_TRANSCRIPT')}\n${ev(t)}`), true, t);
    }
  });
  test('evidence without a source_type counts as a document; no evidence is none', () => {
    assert.equal(materialHasAttachedDocuments('<evidence source="notes.md">We ship on Fridays.</evidence>'), true);
    assert.equal(materialHasAttachedDocuments('# Evidence\nNo supporting evidence was retrieved for this question.'), false);
  });
});
