/**
 * The result a coding site shows for the last run of the user's code (#646):
 * the status, the compiler message, the run's test input, the program's
 * output, the expected output, stderr and debug output, each under the label
 * the page gives it. The capture sends this as its own RUN RESULT section, so
 * the model can tell what the program really printed from the problem's
 * sample text, and debug the failure the user is looking at.
 *
 * Only HackerRank's result panel is read. Its markup is the one its shipped
 * bundle builds (hrcdn.net fcore chunks 496 and 4955, read 2026-11-26):
 *
 *   .code-compile-test-view                  the result card
 *     .compilation-errors-card pre           Codechecker errors
 *     .compile-error-wrapper p.status        "Wrong Answer :(", "Compilation error :("
 *                            p.compile-advice  "1/2 test cases failed"
 *     .compile-time-response p.compile-field-label + pre   Compile Message, Exit Status
 *     .testcases-result-wrapper              one tab per test case:
 *       [role=tab][aria-selected] .testcase-tab-item.tab-item-color-{success|error|info}
 *       .run-time-message                    one per field of the open test case:
 *         .compile-field-label               its label, then .compile-field-label__links
 *         pre.compiler-message__value        the value, or one
 *         pre.lines-container__content       per line, or
 *         pre.no-response                    "~ no response on stdout ~"
 *       .hidden-testcase-wrapper             a hidden test case: no input or output
 *     .tc-live-status                        the run is still going
 *
 * LeetCode's panel has no semantic class names (utility classes only), so it
 * is found by the one stable hook in it, the status heading's
 * `data-e2e-locator="console-result"`, and read as the page lays it out. In
 * its shipped bundle (leetcode.com _next chunk 00rr3b16oc2yw, read
 * 2026-11-26) every result view puts that heading three levels below the
 * panel, and each part of the result (the error, Input, Stdout, Output,
 * Expected, Last Executed Input) is a label line followed by its value in a
 * `whitespace-pre-wrap` block.
 *
 * On any other site this reads nothing, and its result reaches the capture
 * only as page text, as before.
 *
 * Reads with `tag`, `.class` and `tag.class` selectors and parentNode walks
 * only, so it runs on the tests' small DOM as on the page. No page code runs.
 */

import { DEFAULT_REGISTRY, findPlatform, normalizeHost } from './registry/registry';

/**
 * The most a RUN RESULT section takes of the capture, its cut marker included
 * under the desktop's 8000-character cap on an envelope field (sanitize.ts).
 */
export const RUN_RESULT_MAX_CHARS = 7900;
/** The most one field takes: the head of a long input or output is kept. */
const FIELD_MAX_CHARS = 1500;

/** The class of HackerRank's result card. */
const HACKERRANK_RESULT_CARD = 'code-compile-test-view';

/** The RUN RESULT section for the page, or '' when it shows no run result. */
export function readRunResult(doc: ParentNode, host: string, url: string): string {
  const rule = host ? findPlatform(DEFAULT_REGISTRY, normalizeHost(host), url) : null;
  if (rule?.id === 'hackerrank') return readHackerRank(doc);
  if (rule?.id === 'leetcode') return readLeetCode(doc);
  return '';
}

/**
 * Whether `node` sits inside a run result panel the reader reads. The code
 * collectors skip those nodes: the run's input and output are not code.
 */
export function isInRunResult(node: Node): boolean {
  for (let n: Node | null = node; n; n = n.parentNode) {
    if (n.nodeType === 1 && hasClass(n as Element, HACKERRANK_RESULT_CARD)) return true;
  }
  return false;
}

const SOURCE_NOTE =
  "the run's own test data and what the program printed, not the problem's samples. The page does not " +
  'say which version of the code produced it; if the code was edited after the run, this may be out of date';

/** The section, cut to RUN_RESULT_MAX_CHARS with a marker. */
function finishSection(text: string): string {
  return text.length > RUN_RESULT_MAX_CHARS
    ? `${text.slice(0, RUN_RESULT_MAX_CHARS)}\n…(the rest of the run result was not captured)`
    : text;
}

/* ─────────────────────────── LeetCode ─────────────────────────── */

const LEETCODE_STATUS = 'console-result';
/** Levels from the status heading up to its result panel. */
const LEETCODE_PANEL_DEPTH = 3;

function readLeetCode(doc: ParentNode): string {
  const status = findByAttr(doc, 'data-e2e-locator', LEETCODE_STATUS);
  if (!status) return '';
  let panel: Node = status;
  for (let i = 0; i < LEETCODE_PANEL_DEPTH && panel.parentNode && panel.parentNode.nodeType === 1; i++) {
    panel = panel.parentNode;
  }
  const heading = oneLine(status);
  const body = panelText(panel, status);
  if (!heading && !body) return '';
  const lines = [`RUN RESULT (LeetCode, the result panel for the last Run: ${SOURCE_NOTE}):`];
  if (heading) lines.push(`STATUS: ${heading}`);
  if (body) lines.push(body);
  return finishSection(lines.join('\n'));
}

const BLOCK_TAGS = new Set(['div', 'p', 'section', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'tr', 'pre']);
const PANEL_SKIP_TAGS = new Set(['button', 'svg', 'script', 'style', 'noscript', 'template', 'textarea', 'input']);

/**
 * The text of a result panel in page order, one line per block, without
 * `skip` (the status, read on its own) and without buttons. A
 * `whitespace-pre-wrap` block or a <pre> is a value: its line breaks are
 * kept, and a long one is cut with a marker.
 */
function panelText(panel: Node, skip: Node): string {
  // Block boundaries are \u0001; a value is held out as \u0002n\u0002 so the
  // tidying of the label text below never touches its spaces or line breaks.
  const out: string[] = [];
  const values: string[] = [];
  const walk = (node: Node) => {
    for (const child of childNodes(node)) {
      if (child === skip) continue;
      if (child.nodeType === 3) {
        out.push(child.textContent || '');
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const tag = (el.localName || el.nodeName || '').toLowerCase();
      if (PANEL_SKIP_TAGS.has(tag)) continue;
      if (tag === 'pre' || hasClass(el, 'whitespace-pre-wrap')) {
        const value = verbatim(el);
        if (value) out.push(`\u0001\u0002${values.push(capValue(value)) - 1}\u0002\u0001`);
        continue;
      }
      const block = BLOCK_TAGS.has(tag);
      if (block) out.push('\u0001');
      walk(el);
      if (block) out.push('\u0001');
    }
  };
  walk(panel);
  return out
    .join('')
    .split('\u0001')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\u0002(\d+)\u0002/g, (_m, n: string) => values[Number(n)]);
}

function capValue(value: string): string {
  if (value.length <= FIELD_MAX_CHARS) return value;
  return `${value.slice(0, FIELD_MAX_CHARS)}\n…(${value.length - FIELD_MAX_CHARS} more characters of this field not captured)`;
}

/** The first element under `root` whose `attr` is `value`. */
function findByAttr(root: ParentNode, attr: string, value: string): Element | null {
  for (const child of childNodes(root as unknown as Node)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.getAttribute?.(attr) === value) return el;
    const found = findByAttr(el, attr, value);
    if (found) return found;
  }
  return null;
}

/* ─────────────────────────── HackerRank ─────────────────────────── */

function readHackerRank(doc: ParentNode): string {
  const card = all(doc, `.${HACKERRANK_RESULT_CARD}`)[0];
  if (!card) return '';
  const lines: string[] = [];

  for (const wrapper of all(card, '.compile-error-wrapper')) {
    const status = oneLine(all(wrapper, '.status')[0]);
    const advice = oneLine(all(wrapper, '.compile-advice')[0]);
    if (status) lines.push(`STATUS: ${status}${advice ? ` (${advice})` : ''}`);
  }
  if (all(card, '.tc-live-status').length || all(card, '.loading-testcase').length) {
    lines.push('STATUS: the run was still running when this was captured; the result below may be incomplete.');
  }

  const fields: string[] = [];
  for (const err of all(card, 'pre.compilation-errors')) {
    fields.push(formatField('Codechecker Error', verbatim(err)));
  }
  // Compile Message and Exit Status of a run that did not compile.
  for (const response of all(card, '.compile-time-response')) {
    for (const label of all(response, 'p.compile-field-label')) {
      const pre = label.parentNode ? childElements(label.parentNode).find((c) => c.localName === 'pre') : undefined;
      if (pre) fields.push(formatField(oneLine(label), verbatim(pre)));
    }
  }

  const tabs = all(card, '.testcase-tab-item').filter((t) => !insideClass(t, 'tc-live-status'));
  if (tabs.length) {
    lines.push(`TEST CASES: ${tabs.map((t) => `${tabTitle(t)} ${tabStatus(t)}`).join(', ')}`);
    const shown = tabs.find(isSelectedTab) ?? (tabs.length === 1 ? tabs[0] : undefined);
    if (shown) lines.push(`SHOWN: ${tabTitle(shown)} (${tabStatus(shown)})`);
  }

  for (const message of all(card, '.run-time-message')) {
    const label = fieldLabel(message);
    if (label) fields.push(formatField(label, fieldValue(message)));
  }
  if (all(card, '.hidden-testcase-wrapper').length) {
    fields.push("HackerRank hides this test case's input and expected output; only what is shown above is known.");
  }
  for (const note of all(card, '.no-sample-testcases')) fields.push(oneLine(note));

  if (!lines.length && !fields.length) return '';
  const head = `RUN RESULT (HackerRank, the result panel for the last Run Code: ${SOURCE_NOTE}):`;
  return finishSection([head, ...lines, ...fields].join('\n'));
}

/** `label:` then the value on its own lines, capped with a marker. */
function formatField(label: string, value: string): string {
  return `${label}:\n${capValue(value)}`;
}

/** The label of a `.run-time-message`, without its Download / Run links. */
function fieldLabel(message: Element): string {
  const label = all(message, '.compile-field-label')[0];
  if (!label) return '';
  const own = childNodes(label)
    .filter((c) => !(c.nodeType === 1 && hasClass(c as Element, 'compile-field-label__links')))
    .map((c) => c.textContent || '')
    .join('');
  return own.replace(/\s+/g, ' ').trim();
}

/** The value of a `.run-time-message`, line breaks kept. */
function fieldValue(message: Element): string {
  const lines = all(message, 'pre.lines-container__content');
  let value = lines.length
    ? lines.map((l) => l.textContent || '').join('\n')
    : verbatim(all(message, 'pre.compiler-message__value')[0] ?? all(message, 'pre')[0]);
  const tle = all(message, '.compiler-message__tle')[0];
  if (tle) value = [value, oneLine(tle)].filter(Boolean).join('\n');
  if (value.includes('{-truncated-}')) {
    value += '\n(HackerRank cut this short on the page; the rest is only in its Download link.)';
  }
  return value;
}

function tabTitle(tab: Element): string {
  return oneLine(all(tab, '.tab-item-label')[0]) || 'Test case';
}

function tabStatus(tab: Element): string {
  if (hasClass(tab, 'tab-item-color-success')) return 'passed';
  if (hasClass(tab, 'tab-item-color-error')) return 'failed';
  return 'not finished';
}

/** The test case open below the tabs: its `[role=tab]` is aria-selected. */
function isSelectedTab(tab: Element): boolean {
  for (let n: Node | null = tab; n; n = n.parentNode) {
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    if (el.getAttribute?.('role') === 'tab') return el.getAttribute('aria-selected') === 'true';
  }
  return false;
}

/* ─────────────────────────── DOM helpers ─────────────────────────── */

function all(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function childNodes(node: Node): Node[] {
  return Array.from(node.childNodes || []);
}

function childElements(node: Node): Element[] {
  return childNodes(node).filter((c): c is Element => c.nodeType === 1);
}

function hasClass(el: Element, cls: string): boolean {
  return (el.getAttribute?.('class') || '').split(/\s+/).includes(cls);
}

function insideClass(el: Element, cls: string): boolean {
  for (let n: Node | null = el.parentNode; n; n = n.parentNode) {
    if (n.nodeType === 1 && hasClass(n as Element, cls)) return true;
  }
  return false;
}

/** Text with its line breaks and indentation, outer blank lines dropped. */
function verbatim(el: Element | undefined): string {
  if (!el) return '';
  return (el.textContent || '')
    .replace(/ /g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+|\n+$/g, '');
}

function oneLine(el: Element | undefined): string {
  return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
}
