// electron/services/knowledge/OkfSlugger.ts
//
// Slug / Concept ID generation for OKF Knowledge Cards. The OKF spec defines
// a Concept ID as "the path of the concept's file within the bundle, with the
// .md suffix removed" — slugify() produces the filename-safe segment, and
// conceptIdFor() joins it with the bundle directory (e.g. "thesis/openvla-oft").

const STOPWORD_PREFIXES = /^(?:the|a|an|of|what is|what are|how is|how does)\s+/i;

export function slugify(title: string): string {
  const cleaned = title
    .replace(STOPWORD_PREFIXES, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned || 'untitled';
}

/** Builds a unique slug by appending -2, -3, ... when a collision is found in `taken`. */
export function uniqueSlug(title: string, taken: Set<string>): string {
  const base = slugify(title);
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

/** Joins a bundle-relative directory with a slug to form an OKF Concept ID (no .md suffix). */
export function conceptIdFor(bundleDir: string, slug: string): string {
  const dir = bundleDir.replace(/^\/+|\/+$/g, '');
  return dir ? `${dir}/${slug}` : slug;
}
