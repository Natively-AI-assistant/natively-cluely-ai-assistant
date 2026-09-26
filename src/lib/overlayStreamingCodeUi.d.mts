export function shouldUseStreamingCodeUi(
  intent: string,
  token: string,
  previousText?: string,
): boolean;

export function isUnclosedCodeFencePart(part: string): boolean;

export function splitStreamingCodeLines(code: string): {
  completedLines: string[];
  partialLine: string;
};
