// electron/intelligence/memory/HindsightTagBuilder.ts
//
// Spec Phase 16 — strict tagging + isolation. Per Phase 0 research, Hindsight banks are
// strictly isolated and recall/reflect filter by TAGS (tags_match "all_strict" excludes
// untagged). So we enforce isolation two ways (defense in depth):
//   1. BANK per tenant boundary (user, or org when present) — the strongest isolation.
//   2. Scope TAGS on every retained item, and recall ALWAYS filters with the required
//      tags using all_strict, so a foreign/untagged memory can never be returned.
//
// Pure, deterministic, never throws.

import type { MemoryScope, MemorySourceType } from './MemoryProvider';

// Hash a potentially-sensitive id into a short, stable, non-reversible-ish tag token
// (FNV-1a — same as the rollout bucketing). We never put raw PII in a tag value.
function tagHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const sanitizeTagValue = (v: string): string => (v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

export class HindsightTagBuilder {
  /**
   * The bank id for a scope — one bank per tenant boundary. Org-level when an org is
   * present (shared org memory), else per-user. This is the PRIMARY isolation: banks
   * never leak across each other.
   */
  bankId(scope: MemoryScope, defaultBank?: string): string {
    if (scope.orgId) return `org_${sanitizeTagValue(scope.orgId)}`;
    if (scope.userId) return `user_${sanitizeTagValue(scope.userId)}`;
    return defaultBank || 'default';
  }

  /**
   * The REQUIRED scope tags every retained item must carry. These are also the tags
   * recall filters on (all_strict) so isolation is enforced at retrieval, not just by
   * bank. user/org/visibility are mandatory.
   */
  requiredTags(scope: MemoryScope): string[] {
    const tags = [`user:${sanitizeTagValue(scope.userId)}`, 'visibility:private'];
    tags.push(`org:${scope.orgId ? sanitizeTagValue(scope.orgId) : 'personal'}`);
    return tags;
  }

  /** Full tag set for a retain: required scope tags + source/mode + optional context. */
  retainTags(scope: MemoryScope, source: MemorySourceType, mode?: string): string[] {
    const tags = [...this.requiredTags(scope), `source:${source}`];
    if (mode) tags.push(`mode:${sanitizeTagValue(mode)}`);
    if (scope.meetingId) tags.push(`meeting:${sanitizeTagValue(scope.meetingId)}`);
    if (scope.sessionId) tags.push(`session:${sanitizeTagValue(scope.sessionId)}`);
    if (scope.courseId) tags.push(`course:${sanitizeTagValue(scope.courseId)}`);
    if (scope.lectureId) tags.push(`lecture:${sanitizeTagValue(scope.lectureId)}`);
    if (scope.company) tags.push(`company:${sanitizeTagValue(scope.company)}`);
    if (scope.participantHash) tags.push(`participant:${tagHash(scope.participantHash)}`);
    if (scope.documentId) tags.push(`document:${sanitizeTagValue(scope.documentId)}`);
    if (scope.date) tags.push(`date:${sanitizeTagValue(scope.date)}`);
    return [...new Set(tags)];
  }

  /** The tags a recall MUST filter on so only this scope's memories return. */
  recallTags(scope: MemoryScope): string[] {
    // Only the mandatory isolation tags — narrower context filters are optional and
    // would over-restrict recall. Isolation = user + org + private.
    return this.requiredTags(scope);
  }
}
