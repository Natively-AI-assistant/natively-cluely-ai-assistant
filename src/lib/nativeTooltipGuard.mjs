// Native tooltips break stealth.
//
// Chromium draws an HTML `title` as a native OS tooltip window — on macOS and
// Windows alike — owned by the app but NOT covered by the content protection
// the overlay windows carry. Measured 2026-09-27 on macOS: hovering a titled
// chip opened a 223x20 window with kCGWindowSharingState 1 (ReadOnly) beside
// overlay windows reading 0, and both ScreenCaptureKit and legacy CoreGraphics
// capture showed the tooltip floating over an otherwise empty desktop.
//
// So the overlay family never keeps a `title`. Rather than trust every
// component (plus markdown output, premium components and whatever lands
// later) to leave it off, the guard strips it at the document level: once at
// install, then on every insertion or change via a MutationObserver. Its
// callbacks run as a microtask after React commits, long before the ~1s hover
// delay a tooltip needs.
//
// The text is kept for assistive tech: an element with no text of its own
// (icon buttons) gets it as `aria-label`, anything else as `aria-description`,
// and neither overwrites a label the component already set.
//
// A title is BLANKED (title="", which shows no tooltip), not removed. React
// removing an attribute that is already gone queues no mutation record, so a
// removed title that React later dropped left a stale stash and aria text
// behind; with the attribute still present, React's removal or change is
// observed and the stash follows it.
//
// The launcher is protected from capture only in Undetectable mode, so it
// strips only then (createSwitchableTooltipGuard): every stripped title is
// stashed on the element and put back, with the aria attribute the guard
// added removed, when the mode turns off.

/** Every `?window=` route that is part of the capture-protected overlay. */
export const TOOLTIP_FREE_WINDOWS = Object.freeze([
  'overlay',
  'overlay-pill',
  'overlay-toggle',
  'settings', // SettingsPopup, the overlay's quick-toggles panel
  'model-selector',
  'cropper',
]);

export function shouldSuppressNativeTooltips(windowParam) {
  return TOOLTIP_FREE_WINDOWS.includes(windowParam);
}

const STASH = 'data-native-title';
const STASH_ARIA = 'data-native-title-aria';
// Their accessible name comes from a <label>, `alt` or value, never from text
// content, so an empty textContent does not make them icon-only.
const NAMED_ELSEWHERE = new Set(['INPUT', 'IMG', 'SELECT', 'TEXTAREA']);

// Remove the aria attribute the guard added, if it still holds the guard's
// text: the component may have set its own value on that attribute since.
function dropGuardAria(el) {
  const added = el.getAttribute(STASH_ARIA);
  if (!added) return;
  if (el.getAttribute(added) === (el.getAttribute(STASH) ?? '').trim()) el.removeAttribute(added);
  el.removeAttribute(STASH_ARIA);
}

/** Blank `el`'s title, preserving its text as an accessible name/description. */
export function stripTitle(el) {
  const title = el.getAttribute('title');
  if (title === null) {
    // React removed a blanked title: the text is gone for real.
    if (el.hasAttribute(STASH)) {
      dropGuardAria(el);
      el.removeAttribute(STASH);
    }
    return;
  }
  if (title === '' && el.hasAttribute(STASH)) return; // the guard's own blank
  // A new title while stripped: the previous aria text is stale.
  dropGuardAria(el);
  el.setAttribute(STASH, title);
  if (title !== '') el.setAttribute('title', '');
  const text = title.trim();
  if (!text) return;
  let added = null;
  if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) {
    if (!el.hasAttribute('aria-description')) added = 'aria-description';
  } else if ((el.textContent || '').trim() === '' && !NAMED_ELSEWHERE.has(el.tagName)) {
    added = 'aria-label';
  } else if (!el.hasAttribute('aria-description')) {
    added = 'aria-description';
  }
  if (added) {
    el.setAttribute(added, text);
    el.setAttribute(STASH_ARIA, added);
  }
}

/** Undo stripTitle for every element under `root` (the root included). */
export function restoreTitles(root) {
  const els = root.hasAttribute?.(STASH) ? [root] : [];
  for (const el of root.querySelectorAll(`[${STASH}]`)) els.push(el);
  for (const el of els) {
    dropGuardAria(el);
    el.setAttribute('title', el.getAttribute(STASH));
    el.removeAttribute(STASH);
  }
}

function stripTree(node) {
  if (!node || node.nodeType !== 1) return; // elements only
  if (node.hasAttribute('title')) stripTitle(node);
  for (const el of node.querySelectorAll('[title]')) stripTitle(el);
}

/**
 * Strip every title under `root` now and keep it that way. Returns a disposer.
 * `MutationObserverImpl` is injectable for tests.
 */
export function installNativeTooltipGuard(root, MutationObserverImpl = globalThis.MutationObserver) {
  stripTree(root);
  const observer = new MutationObserverImpl((records) => {
    for (const record of records) {
      if (record.type === 'attributes') stripTitle(record.target);
      else for (const node of record.addedNodes) stripTree(node);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title'],
  });
  return () => observer.disconnect();
}

/**
 * A guard that can be switched on and off, for a window that is capture-
 * protected only some of the time. `setActive(true)` strips as
 * installNativeTooltipGuard does; `setActive(false)` stops and restores.
 */
export function createSwitchableTooltipGuard(root, MutationObserverImpl = globalThis.MutationObserver) {
  let dispose = null;
  return {
    setActive(active) {
      if (active && !dispose) {
        dispose = installNativeTooltipGuard(root, MutationObserverImpl);
      } else if (!active && dispose) {
        dispose();
        dispose = null;
        restoreTitles(root);
      }
    },
    isActive: () => dispose !== null,
  };
}
