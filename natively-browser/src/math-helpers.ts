/**
 * Mathematical formula detection and text normalization for browser capture.
 *
 * Problem context on coding platforms (HackerRank, LeetCode, Codeforces, etc.)
 * frequently embeds mathematical expressions using:
 *  1. KaTeX (MathML <annotation> + rendered HTML/SVG)
 *  2. MathJax (<script type="math/tex"> or .MathJax containers)
 *  3. MathML (<math> with <annotation> or alttext)
 *  4. Accessible SVGs (<svg role="img" aria-label="..."> or <svg><title>...</title></svg>)
 *  5. Data attributes ([data-math], [data-formula], [data-latex], [data-tex])
 *  6. Raw geometry SVG paths without text (e.g. HackerRank Matrix Layer Rotation)
 *
 * For types 1-5, this helper extracts clean mathematical text and replaces the
 * markup containers so Readability, innerTextFallback, and platform selectors
 * preserve the formula text.
 *
 * For type 6 (pure SVG paths without textual equivalents), formula expressions
 * are replaced with a clear placeholder `[Formula (SVG): math expression omitted]`
 * rather than vanishing into empty strings, and omittedSvgMathCount is tracked
 * so the capture can be flagged partial with a screenshot recommendation.
 */

export const SVG_MATH_OMITTED_NOTICE =
  'NOTE: Mathematical formulas on this page are rendered as SVG paths without text. For complete math and constraints, capture with screenshot (Ctrl+H).';

export const SVG_MATH_PLACEHOLDER = '[Formula (SVG): math expression omitted]';

export interface MathNormalizationResult {
  /** Count of mathematical expressions rendered only as SVG paths without text equivalents. */
  omittedSvgMathCount: number;
}

/** Safe querySelectorAll that never throws even on unsupported selectors in DOM shims. */
function safeQuery(root: ParentNode, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/** Safe querySelector that never throws. */
function safeQueryOne(root: ParentNode, selector: string): Element | null {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

/** Walk up parentNode or use closest() if available. */
function safeClosest(el: Element, selector: string): Element | null {
  if (typeof (el as any).closest === 'function') {
    try {
      return (el as any).closest(selector);
    } catch {
      /* fall through to manual walk */
    }
  }

  const parts = selector.toLowerCase().split(',').map((s) => s.trim());
  let cur: any = el.parentNode;
  while (cur && cur.tagName) {
    const t = cur.tagName.toLowerCase();
    for (const sel of parts) {
      if (sel === t) return cur;
      if (sel.startsWith('.') && cur.classList?.contains?.(sel.slice(1))) return cur;
      if (sel.startsWith('.') && typeof cur.className === 'string' && cur.className.includes(sel.slice(1))) return cur;
      if (sel.startsWith('[') && sel.includes('=')) {
        const [attr, val] = sel.slice(1, -1).split('=');
        const cleanVal = (val || '').replace(/["']/g, '');
        if (cur.getAttribute?.(attr) === cleanVal) return cur;
      }
    }
    cur = cur.parentNode;
  }
  return null;
}

/**
 * Replace an element with text content. Handles modern browsers (replaceWith),
 * standard DOM (replaceChild with Text node), and test shims.
 */
export function replaceWithText(el: Element, text: string): void {
  const formatted = text.trim();
  const spaced = ` ${formatted} `;

  if (typeof (el as any).replaceWith === 'function') {
    try {
      (el as any).replaceWith(spaced);
      return;
    } catch {
      /* fall through */
    }
  }

  const parent = el.parentNode;
  const ownerDoc = el.ownerDocument || ((el as any).createElement ? el : null);
  if (parent && typeof parent.replaceChild === 'function' && ownerDoc && typeof ownerDoc.createTextNode === 'function') {
    try {
      const textNode = ownerDoc.createTextNode(spaced);
      parent.replaceChild(textNode, el);
      return;
    } catch {
      /* fall through */
    }
  }

  // Fallback for minimal test shims: clear children and set textContent
  try {
    if ((el as any).children && Array.isArray((el as any).children)) {
      (el as any).children = [];
    }
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  } catch {
    /* ignore */
  }
  el.textContent = spaced;
}

/** Check if an element is inside navigation, headers, or clickable buttons (UI icon, not math). */
function isInsideUiControl(svg: Element): boolean {
  return safeClosest(svg, 'button, nav, header, footer, a[href], [role="button"], [role="navigation"]') != null;
}

/** Check if an SVG represents a mathematical formula or problem constraint expression. */
function isMathOrProblemSvg(svg: Element): boolean {
  // Explicit math containers
  if (safeClosest(svg, '.math, [class*="math" i], .formula, .katex, .MathJax, mjx-container') != null) {
    return true;
  }
  // Constraints containers (HackerRank, LeetCode, etc.)
  if (safeClosest(svg, '.challenge_constraints_body, [class*="constraint" i]') != null) {
    return true;
  }
  // Problem statement containers (HackerRank, etc.)
  if (
    safeClosest(
      svg,
      '.challenge-body-html, .problem-statement, [class*="problem-statement" i], [class*="coding-question" i], [class*="question-description" i]',
    ) != null
  ) {
    if (svg.getAttribute?.('role') === 'img' || safeClosest(svg, 'p, li, td, span, pre') != null) {
      return true;
    }
  }
  // role="img" inside a paragraph or list item in main content
  if (svg.getAttribute?.('role') === 'img' && safeClosest(svg, 'p, li, td') != null) {
    return true;
  }
  return false;
}

/**
 * Preprocess a DOM root (typically a cloned document or element) to convert
 * accessible math representations into plain text and detect raw SVG formulas
 * that have no textual equivalent.
 */
export function normalizeMathDom(root: ParentNode): MathNormalizationResult {
  let omittedSvgMathCount = 0;

  // 1. KaTeX containers: extract TeX annotation or aria-label
  const katexEls = safeQuery(root, '.katex');
  for (const katex of katexEls) {
    const annotation = safeQueryOne(katex, 'annotation[encoding*="tex" i], annotation');
    const tex = (annotation?.textContent || '').trim();
    if (tex) {
      replaceWithText(katex, tex);
      continue;
    }
    const label = (katex.getAttribute?.('aria-label') || katex.getAttribute?.('title') || '').trim();
    if (label) {
      replaceWithText(katex, label);
      continue;
    }
    const mathml = safeQueryOne(katex, '.katex-mathml');
    const mathmlText = (mathml?.textContent || '').trim();
    if (mathmlText) {
      replaceWithText(katex, mathmlText);
      continue;
    }
  }

  // 2. Standalone MathML <math> elements
  const mathEls = safeQuery(root, 'math');
  for (const math of mathEls) {
    if (!math.parentNode && !(math as any).parentElement) continue;
    const annotation = safeQueryOne(math, 'annotation');
    const tex = (annotation?.textContent || '').trim();
    if (tex) {
      replaceWithText(math, tex);
      continue;
    }
    const alt = (math.getAttribute?.('alttext') || math.getAttribute?.('aria-label') || '').trim();
    if (alt) {
      replaceWithText(math, alt);
      continue;
    }
  }

  // 3. MathJax <script type="math/tex..."> tags (before script stripping removes them)
  const mathScripts = safeQuery(root, 'script[type^="math/tex"]');
  for (const script of mathScripts) {
    const tex = (script.textContent || '').trim();
    if (tex) {
      replaceWithText(script, tex);
    }
  }

  // 4. Data attributes containing math/formula
  const dataMathEls = safeQuery(root, '[data-math], [data-formula], [data-latex], [data-tex]');
  for (const el of dataMathEls) {
    if (!el.parentNode && !(el as any).parentElement) continue;
    const math = (
      el.getAttribute?.('data-math') ||
      el.getAttribute?.('data-formula') ||
      el.getAttribute?.('data-latex') ||
      el.getAttribute?.('data-tex') ||
      ''
    ).trim();
    if (math) {
      replaceWithText(el, math);
    }
  }

  // 5. SVG elements
  const svgEls = safeQuery(root, 'svg');
  for (const svg of svgEls) {
    if (!svg.parentNode && !(svg as any).parentElement) continue;

    // 5a. Accessible label on SVG
    const ariaLabel = (svg.getAttribute?.('aria-label') || '').trim();
    if (ariaLabel) {
      replaceWithText(svg, ariaLabel);
      continue;
    }

    const titleEl = safeQueryOne(svg, 'title');
    const titleText = (titleEl?.textContent || '').trim();
    if (titleText) {
      replaceWithText(svg, titleText);
      continue;
    }

    const dataMath = (
      svg.getAttribute?.('data-math') ||
      svg.getAttribute?.('data-formula') ||
      svg.getAttribute?.('data-latex') ||
      svg.getAttribute?.('data-tex') ||
      ''
    ).trim();
    if (dataMath) {
      replaceWithText(svg, dataMath);
      continue;
    }

    // 5b. Pure SVG path formulas with no textual equivalent
    const textContent = (svg.textContent || '').trim();
    if (textContent.length > 0) {
      continue;
    }

    // Skip UI icons
    if (isInsideUiControl(svg)) {
      continue;
    }

    // Check if this SVG is a problem formula / constraint expression
    if (isMathOrProblemSvg(svg)) {
      replaceWithText(svg, SVG_MATH_PLACEHOLDER);
      omittedSvgMathCount++;
    }
  }

  return { omittedSvgMathCount };
}
