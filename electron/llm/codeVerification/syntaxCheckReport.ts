// electron/llm/codeVerification/syntaxCheckReport.ts
//
// Records the fenced-JavaScript syntax check for a finished answer on the
// turn's telemetry (piTelemetry marker) and debug log. OBSERVE-ONLY: the
// answer is never changed. Shared by the hotkey What-to-Answer turn and the
// typed chat turn so both surfaces report the same fields.

import { checkFencedJavaScriptSyntax, type FencedJsSyntaxSummary } from './syntaxCheck';
import { piTelemetry } from '../piTelemetry';

export type SyntaxCheckSurface = 'what_to_answer' | 'manual_chat_v3' | 'manual_chat_legacy';

/**
 * Check the answer's ```js / ```javascript blocks and record the result.
 * Returns null (and records nothing) when the answer has no such block.
 * Never throws.
 */
export function observeAnswerJsSyntax(answer: string, surface: SyntaxCheckSurface): FencedJsSyntaxSummary | null {
  try {
    if (!answer || !/```[ \t]*(?:javascript|js|mjs|cjs|node)\b/i.test(answer)) return null;
    const summary = checkFencedJavaScriptSyntax(answer);
    if (summary.blocks === 0) return null;
    piTelemetry.emit('code_syntax_checked', {
      surface,
      blocks: summary.blocks,
      valid: summary.valid,
      invalid: summary.invalid,
      skipped: summary.skipped,
      ...(summary.firstError?.line ? { firstErrorLine: summary.firstError.line } : {}),
    });
    if (summary.invalid > 0) {
      console.warn('[CodeSyntax] fenced JavaScript does not compile (observe-only, answer unchanged)', {
        surface,
        blocks: summary.blocks,
        invalid: summary.invalid,
        firstError: summary.firstError,
      });
    }
    return summary;
  } catch {
    return null;
  }
}
