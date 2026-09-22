export const CJK_RE: RegExp;

export function hasCJK(text: string | undefined | null): boolean;

export interface CjkMeetingLike {
  title?: string;
  summary?: string;
  detailedSummary?: {
    actionItems?: string[];
    keyPoints?: string[];
  };
  transcript?: Array<{ speaker?: string; text?: string }>;
  usage?: Array<{ question?: string; answer?: string }>;
}

export function meetingHasCJK(meeting: CjkMeetingLike | null | undefined): boolean;

export function needsEmbeddedFont(ch: string): boolean;

export interface PdfFontRun {
  text: string;
  embedded: boolean;
}

export function splitFontRuns(text: string): PdfFontRun[];

export function wrapCjkText(
  text: string,
  contentWidth: number,
  measure: (text: string) => number,
): string[];
