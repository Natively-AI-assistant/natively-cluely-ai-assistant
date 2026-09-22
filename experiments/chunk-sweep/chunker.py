"""Semantic chunkers for the sweep.

TWO chunkers live here as of 2026-08-28:

  chunk_markdown()  — the ORIGINAL sweep chunker (greedy whole-section packing
                      to a target, subdivide above 1.5x). Kept unchanged so the
                      recorded before-numbers in results.json / ablation_results.json
                      / continuity_precision.json remain reproducible.

  chunk_production() — a PORT of the shipped chunker
                      (electron/services/modes/semanticChunker.ts): boundary-driven
                      units, merge floor 100 / soft target 350 / hard cap 1000,
                      atomic code blocks and tables, heading-ancestor prefixes.
                      Its purpose is comparability: an A/B run through the same
                      corpus, the same embeddings and the same scorer is the only
                      honest way to say whether the production change helped.

Keep them behaviourally in step with their TypeScript counterpart or the
before/after numbers stop meaning anything.


Design constraints (followed exactly):
- NEVER cut at a raw token/character offset.
- Pack whole markdown heading sections greedily up to a target token size.
- If a single section alone exceeds 1.5x the target, subdivide it at blank-line
  paragraph boundaries ONLY; a fact sentence is never split across chunks.
- Prefix every chunk with its heading path, e.g.
  [context: Project: FieldServe-CRM Sync > Idempotency]
- Tokens are approximated as chars/4.
"""
import re
from dataclasses import dataclass


def est_tokens(text: str) -> int:
    return max(1, len(text) // 4)


@dataclass
class Section:
    path: list  # heading path, outermost first (excluding the doc title)
    body: str


HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")


def parse_sections(markdown: str):
    """Split a markdown document into heading-scoped sections (leaf bodies)."""
    lines = markdown.splitlines()
    stack = []  # (level, title)
    sections = []
    buf = []

    def flush():
        body = "\n".join(buf).strip()
        if body:
            sections.append(Section(path=[t for _, t in stack], body=body))
        buf.clear()

    for line in lines:
        m = HEADING_RE.match(line)
        if m:
            flush()
            level = len(m.group(1))
            title = m.group(2).strip()
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, title))
        else:
            buf.append(line)
    flush()
    return sections


def _context_prefix(path):
    # Drop the document-level H1 from the visible path; keep project + section.
    visible = [p for p in path if not p.lower().startswith("integration project history")]
    return f"[context: {' > '.join(visible)}]" if visible else "[context: document]"


def chunk_markdown(markdown: str, target_tokens: int):
    """Greedy section packing with paragraph-boundary subdivision."""
    sections = parse_sections(markdown)
    chunks = []
    pending_texts = []   # section texts packed into the current chunk
    pending_prefix = None
    pending_tokens = 0

    def flush_pending():
        nonlocal pending_texts, pending_prefix, pending_tokens
        if pending_texts:
            chunks.append(pending_prefix + "\n" + "\n\n".join(pending_texts))
        pending_texts, pending_prefix, pending_tokens = [], None, 0

    for sec in sections:
        prefix = _context_prefix(sec.path)
        body_tokens = est_tokens(sec.body)

        if body_tokens > int(1.5 * target_tokens):
            # Oversized section: subdivide at blank-line paragraph boundaries only.
            flush_pending()
            paragraphs = [p.strip() for p in re.split(r"\n\s*\n", sec.body) if p.strip()]
            part = []
            part_tokens = 0
            for para in paragraphs:
                pt = est_tokens(para)
                if part and part_tokens + pt > target_tokens:
                    chunks.append(prefix + "\n" + "\n\n".join(part))
                    part, part_tokens = [], 0
                part.append(para)  # a paragraph (and its sentences) is never split
                part_tokens += pt
            if part:
                chunks.append(prefix + "\n" + "\n\n".join(part))
            continue

        # Greedy packing of whole sections up to the target.
        labeled = prefix + "\n" + sec.body if (pending_prefix != prefix) else sec.body
        if pending_texts and pending_tokens + body_tokens > target_tokens:
            flush_pending()
            labeled = prefix + "\n" + sec.body
        if not pending_texts:
            pending_prefix = prefix
            # Body carries its own prefix line already via pending_prefix.
            pending_texts.append(sec.body)
        else:
            # Same chunk, possibly a different section: keep its own context line
            # inline so identity still travels with the packed text.
            pending_texts.append(labeled if labeled is not sec.body else sec.body)
        pending_tokens += body_tokens

    flush_pending()
    return chunks


# ─────────────────────────────────────────────────────────────────────────────
# PORT of electron/services/modes/semanticChunker.ts (T9, 2026-08-28).
#
# Boundaries are semantic units; size is a guardrail, not a target.
#   MERGE FLOOR 100   — a unit below it merges forward until the group crosses
#                       250. Cosine favours short focused texts, so an unmerged
#                       fragment steals a top-K slot while carrying no evidence.
#   SOFT TARGET 350   — whole units packed greedily toward it; never split to hit it.
#   HARD CAP   1000   — a single unit above it subdivides at paragraph, then line,
#                       then sentence boundaries. Never a character offset.
#   ATOMIC            — fenced code blocks and markdown tables are never split.
#                       Half a table is not smaller evidence, it is wrong evidence.
#
# An UNSTRUCTURED unit (no newline, no sentence terminator) subdivides at the
# SOFT target instead: it has no semantic boundary at all, so size is the only
# one available, and 800 tokens of undifferentiated text scores identically for
# every query.
# ─────────────────────────────────────────────────────────────────────────────

PROD_MIN_TOKENS = 100
PROD_TARGET_TOKENS = 350
PROD_MAX_TOKENS = 1000
PROD_MERGE_UNTIL_TOKENS = 250

FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
SENTENCE_RE = re.compile(r"[^.!?]+[.!?]+[\])'\"`’”]*\s*|[^.!?]+$")


def _units_of(body_lines):
    """Paragraph groups, plus atomic fenced blocks and tables."""
    units = []          # (text, atomic)
    buf = []

    def flush():
        text = "\n".join(buf).strip()
        if text:
            units.append((text, False))
        buf.clear()

    i = 0
    while i < len(body_lines):
        line = body_lines[i]
        if FENCE_RE.match(line):
            flush()
            fenced = [line]
            i += 1
            while i < len(body_lines):
                fenced.append(body_lines[i])
                if FENCE_RE.match(body_lines[i]):
                    break
                i += 1
            units.append(("\n".join(fenced), True))
            i += 1
            continue
        if TABLE_ROW_RE.match(line) and i + 1 < len(body_lines) and TABLE_ROW_RE.match(body_lines[i + 1]):
            flush()
            rows = []
            while i < len(body_lines) and TABLE_ROW_RE.match(body_lines[i]):
                rows.append(body_lines[i])
                i += 1
            units.append(("\n".join(rows), True))
            continue
        if not line.strip():
            flush()
        else:
            buf.append(line)
        i += 1
    flush()
    return units


def _pack(pieces, joiner, limit):
    out, buf = [], []
    for piece in pieces:
        buf.append(piece)
        if est_tokens(joiner.join(buf)) >= limit:
            out.append(joiner.join(buf))
            buf = []
    if buf:
        out.append(joiner.join(buf))
    return out


def _subdivide(text, atomic, max_tokens, target_tokens):
    if atomic:
        return [text]
    unstructured = "\n" not in text and not re.search(r"[.!?]", text)
    limit = target_tokens if unstructured else max_tokens
    if est_tokens(text) <= limit:
        return [text]

    by_para = _pack([p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()], "\n\n", limit)
    if len(by_para) > 1:
        return by_para
    by_line = _pack(text.split("\n"), "\n", limit)
    if len(by_line) > 1:
        return by_line
    sentences = [s.strip() for s in SENTENCE_RE.findall(text) if s.strip()]
    by_sentence = _pack(sentences, " ", limit)
    if len(by_sentence) > 1:
        return by_sentence
    by_word = _pack(text.split(), " ", limit)
    return by_word or [text]


def _prod_context_prefix(path, drop_root):
    visible = path[1:] if drop_root else path
    return f"[context: {' > '.join(visible)}]" if visible else ""


def chunk_production(markdown: str,
                     min_tokens: int = PROD_MIN_TOKENS,
                     target_tokens: int = PROD_TARGET_TOKENS,
                     max_tokens: int = PROD_MAX_TOKENS,
                     merge_until_tokens: int = PROD_MERGE_UNTIL_TOKENS):
    """Port of semanticChunker.semanticChunks. Keep the two in step."""
    sections = parse_sections(markdown)
    # Drop the outermost heading only when the file has ONE of them (a title).
    # With several top-level headings there is no title, and dropping the first
    # element would throw away the most discriminating part of the path.
    roots = {s.path[0] for s in sections if s.path}
    drop_root = len(roots) == 1

    chunks = []
    for sec in sections:
        ctx = _prod_context_prefix(sec.path, drop_root)
        heading_line = sec.path[-1] if sec.path else ""
        header = " ".join(x for x in (ctx, heading_line) if x).strip()

        pieces = []
        for text, atomic in _units_of(sec.body.split("\n")):
            for part in _subdivide(text, atomic, max_tokens, target_tokens):
                pieces.append((part, atomic))

        group, group_tokens = [], 0

        def flush_group():
            nonlocal group, group_tokens
            if group:
                body = "\n\n".join(group)
                chunks.append(f"{header}\n{body}" if header else body)
            group, group_tokens = [], 0

        for text, atomic in pieces:
            t = est_tokens(text)
            if atomic and group_tokens > 0 and group_tokens + t > target_tokens:
                flush_group()
            group.append(text)
            group_tokens += t
            if group_tokens < merge_until_tokens:
                continue
            if group_tokens >= target_tokens:
                flush_group()
        flush_group()

        if not pieces and header:
            chunks.append(header)

    return chunks
