/**
 * Version comparison utilities extracted from AppState.
 * Pure functions — no dependencies on Electron or AppState.
 */

/**
 * Compares two semver strings and returns true if `latest` is newer than `current`.
 * Strips pre-release suffixes (e.g. "2.1.0-beta.1" → "2.1.0") before comparing.
 */
export function isVersionNewer(current: string, latest: string): boolean {
  const stripPre = (v: string) => v.replace(/-.*$/, '');
  const c = stripPre(current).split('.').map(Number);
  const l = stripPre(latest).split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}
