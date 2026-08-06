/** Quote-agnostic helpers for static analysis tests over ipcHandlers.ts. */
export function findSafeHandle(source, channel) {
  const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`safeHandle\\(\\s*['"]${escaped}['"]`, 'm');
  const m = source.match(re);
  return m?.index ?? -1;
}

export function sliceSafeHandleBlock(source, channel) {
  const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startMatch = source.match(new RegExp(`safeHandle\\(\\s*['"]${escaped}['"]`, 'm'));
  if (!startMatch || startMatch.index === undefined) return '';
  const start = startMatch.index;
  const searchFrom = start + startMatch[0].length;
  const nextRel = source.slice(searchFrom).search(/safeHandle\s*\(\s*['"]/);
  const end = nextRel === -1 ? source.length : searchFrom + nextRel;
  return source.slice(start, end);
}

export function safeHandlePattern(channel) {
  const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`safeHandle\\(\\s*['"]${escaped}['"]`, 'm');
}

/**
 * Slice the shared `applyModesSetActive` helper (used by modes:set-active IPC
 * and Phone Mirror `modes:set`). Falls back to the modes:set-active safeHandle
 * block for older layouts.
 */
export function sliceApplyModesSetActive(source) {
  const start = source.indexOf('const applyModesSetActive = async');
  if (start >= 0) {
    const end = source.indexOf("safeHandle('modes:set-active'", start);
    if (end > start) return source.slice(start, end);
  }
  return sliceSafeHandleBlock(source, 'modes:set-active');
}
