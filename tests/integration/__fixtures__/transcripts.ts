import type { CleanedSegment } from '../../../electron/rag/TranscriptPreprocessor'

export function createSegment(
  speaker: string,
  text: string,
  startMs: number,
  endMs: number,
  overrides: Partial<CleanedSegment> = {},
): CleanedSegment {
  return {
    speaker,
    text,
    startMs,
    endMs,
    isQuestion: false,
    isDecision: false,
    isActionItem: false,
    ...overrides,
  }
}

export function createRealisticTranscript(
  _meetingId: string,
): CleanedSegment[] {
  const _time = 0
  const step = 5000

  return [
    createSegment(
      'Alice',
      'Welcome to our Q3 review meeting. Let us start with the revenue numbers.',
      0,
      step,
    ),
    createSegment(
      'Alice',
      'Revenue increased by fifteen percent compared to last quarter, driven by enterprise customer growth.',
      step,
      step * 2,
    ),
    createSegment(
      'Bob',
      'What about churn rates? Are we seeing any concerning trends?',
      step * 2,
      step * 3,
    ),
    createSegment(
      'Alice',
      'Churn is stable at two percent monthly. Main reason customers leave is budget cuts, not product dissatisfaction.',
      step * 3,
      step * 4,
    ),
    createSegment(
      'Bob',
      'Great. For Q4, we should focus on expanding existing accounts.',
      step * 4,
      step * 5,
    ),
    createSegment(
      'Alice',
      'Agreed. I will prepare a detailed account expansion plan by next week.',
      step * 5,
      step * 6,
    ),
  ]
}
