/**
 * Smart Browser Context v2 — just-in-time page signal gathering.
 *
 * Runs IN the page (content script) at capture/answer time ONLY — never in the
 * background. Returns coarse BOOLEAN signals (no page text) used by the local
 * classifier to confirm category + confidence and to enforce the sensitive
 * floor. No eval, no page-script execution.
 */

export interface GatheredSignals {
  // sensitive floor
  hasPasswordField: boolean;
  hasLoginForm: boolean;
  hasPaymentWords: boolean;
  hasCardInput: boolean;
  // coding confidence
  codeEditorPresent: boolean;
  ioConstraintSignals: boolean;
  runSubmitSignals: boolean;
  hasSelection: boolean;
}

const CODE_EDITOR_SELECTORS = ['.monaco-editor', '.cm-content', '.CodeMirror-code', '.ace_content'];
const IO_CONSTRAINT_WORDS = ['constraints', 'input format', 'output format', 'sample input', 'sample output', 'example 1'];
const RUN_SUBMIT_WORDS = ['run code', 'run', 'submit', 'test cases', 'compile'];
const PAYMENT_WORDS = ['card number', 'cvv', 'expiry', 'billing address', 'routing number'];

function safeQuery(doc: ParentNode, sel: string): boolean {
  try {
    return doc.querySelector(sel) != null;
  } catch {
    return false;
  }
}

/**
 * Gather page signals. `visibleTextSample` should be a short, lowercased slice of
 * visible text (the caller caps it) used only for keyword presence — it is not
 * returned or transmitted.
 */
export function gatherPageSignals(
  doc: Document,
  selection: string,
  visibleTextSample: string,
): GatheredSignals {
  const sample = (visibleTextSample || '').toLowerCase();

  const hasPasswordField = safeQuery(doc, 'input[type="password"]');
  const hasCardInput =
    safeQuery(doc, 'input[autocomplete="cc-number"]') ||
    safeQuery(doc, 'input[name*="card" i]') ||
    safeQuery(doc, 'input[id*="card" i]');
  const hasLoginForm =
    hasPasswordField ||
    safeQuery(doc, 'form[action*="login" i]') ||
    safeQuery(doc, 'form[action*="signin" i]');

  const codeEditorPresent = CODE_EDITOR_SELECTORS.some((s) => safeQuery(doc, s));
  const ioConstraintSignals = IO_CONSTRAINT_WORDS.some((w) => sample.includes(w));
  const runSubmitSignals = RUN_SUBMIT_WORDS.some((w) => sample.includes(w));
  const hasPaymentWords = PAYMENT_WORDS.some((w) => sample.includes(w));

  return {
    hasPasswordField,
    hasLoginForm,
    hasPaymentWords,
    hasCardInput,
    codeEditorPresent,
    ioConstraintSignals,
    runSubmitSignals,
    hasSelection: (selection || '').trim().length > 0,
  };
}
