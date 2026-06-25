export const MAX_SCREENSHOT_ATTACHMENTS = 5;

export function appendScreenshotAttachment(existing, screenshot, max = MAX_SCREENSHOT_ATTACHMENTS) {
  const current = Array.isArray(existing) ? existing : [];
  if (!screenshot || typeof screenshot.path !== 'string' || screenshot.path.length === 0) {
    return current;
  }
  if (current.some(item => item?.path === screenshot.path)) return current;
  return [...current, screenshot].slice(-max);
}

export function mergePendingScreenshotAttachment(existing, pending, max = MAX_SCREENSHOT_ATTACHMENTS) {
  return appendScreenshotAttachment(existing, pending, max);
}

export function actionNeedsScreenCapture(action) {
  if (!action || typeof action !== 'object') return false;
  if (action.type === 'screen_coding_problem') return true;
  return Array.isArray(action.evidenceRefs) && action.evidenceRefs.some(ref => ref?.source === 'screen');
}
