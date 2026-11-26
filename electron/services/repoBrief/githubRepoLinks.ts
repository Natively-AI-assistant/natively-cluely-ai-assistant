// GitHub repository links, from a pasted URL or from the user's résumé (#781).
//
// Pure functions, no platform branches: the résumé's structured projects carry
// a `url`, the identity carries the profile link, and a project link may point
// at the profile, a repo, or a path inside a repo.

export interface GithubRepoRef {
  owner: string;
  repo: string;
}

export interface RepoSuggestion extends GithubRepoRef {
  /** https://github.com/owner/repo, the form the API is sent. */
  url: string;
  /** The résumé project the link came from, when there is one. */
  projectName?: string;
}

// GitHub's own rules: owner 1-39 of [A-Za-z0-9-], repo [A-Za-z0-9._-].
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
// First path segments that are GitHub pages, not users.
const RESERVED_OWNERS = new Set([
  'about', 'apps', 'blog', 'collections', 'contact', 'customer-stories', 'enterprise', 'explore', 'features',
  'issues', 'login', 'marketplace', 'new', 'notifications', 'orgs', 'organizations', 'pricing', 'pulls',
  'search', 'security', 'settings', 'site', 'sponsors', 'topics', 'trending', 'users',
]);

export const MAX_REPOS = 5;

/** owner/repo from any GitHub link to a repository, or null. */
export function parseGithubRepoUrl(input: string): GithubRepoRef | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(raw);
  let parts: string[];
  if (ssh) {
    parts = [ssh[1], ssh[2]];
  } else {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    let u: URL;
    try { u = new URL(withScheme); } catch { return null; }
    if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
    parts = u.pathname.split('/').filter(Boolean);
  }
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') return null;
  if (RESERVED_OWNERS.has(owner.toLowerCase())) return null;
  return { owner, repo };
}

/** The GitHub login from a profile link ("github.com/jane", "@jane", "jane"), or null. */
export function parseGithubLogin(input: string): string | null {
  const raw = String(input || '').trim().replace(/^@/, '');
  if (!raw) return null;
  if (OWNER_RE.test(raw) && !RESERVED_OWNERS.has(raw.toLowerCase())) return raw;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
    const first = u.pathname.split('/').filter(Boolean)[0];
    return first && OWNER_RE.test(first) && !RESERVED_OWNERS.has(first.toLowerCase()) ? first : null;
  } catch { return null; }
}

export function repoKey(ref: GithubRepoRef): string {
  return `${ref.owner}/${ref.repo}`.toLowerCase();
}

export function canonicalRepoUrl(ref: GithubRepoRef): string {
  return `https://github.com/${ref.owner}/${ref.repo}`;
}

const LINK_IN_TEXT_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+/gi;

/**
 * Repositories named in a résumé, in résumé order, at most `limit`. Project
 * links come first (they carry the project name), then any repo link in the
 * raw text. A link to the profile alone is not a repository and is skipped.
 */
export function suggestReposFromResume(
  profile: { identity?: { github?: string } | null; projects?: Array<{ name?: string; title?: string; url?: string }> } | null | undefined,
  rawText?: string | null,
  limit: number = MAX_REPOS,
): RepoSuggestion[] {
  const out: RepoSuggestion[] = [];
  const seen = new Set<string>();
  const push = (ref: GithubRepoRef | null, projectName?: string) => {
    if (!ref || out.length >= limit) return;
    const k = repoKey(ref);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ ...ref, url: canonicalRepoUrl(ref), ...(projectName ? { projectName } : {}) });
  };
  for (const p of Array.isArray(profile?.projects) ? profile!.projects! : []) {
    const name = String(p?.name || p?.title || '').trim() || undefined;
    for (const m of String(p?.url || '').match(LINK_IN_TEXT_RE) || []) push(parseGithubRepoUrl(m), name);
  }
  for (const m of String(rawText || '').match(LINK_IN_TEXT_RE) || []) push(parseGithubRepoUrl(m));
  return out;
}

/** The candidate's login from the résumé's profile link, else null. */
export function loginFromResume(profile: { identity?: { github?: string } | null } | null | undefined): string | null {
  return parseGithubLogin(String(profile?.identity?.github || ''));
}
