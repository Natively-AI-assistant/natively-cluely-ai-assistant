export type AnswerPressKind = 'answered' | 'message' | 'empty' | 'failed';
export declare const ANSWER_PRESS_KINDS: readonly AnswerPressKind[];
export declare function classifyAnswerPress(r?: {
  threw?: boolean;
  error?: unknown;
  answer?: unknown;
  answersBefore?: number;
  answersAfter?: number;
}): AnswerPressKind;
export declare function answerPressProps(
  counts: { answered: number; message: number; empty: number; failed: number },
  waitingSince: number[],
  now: number,
): Record<string, number>;
