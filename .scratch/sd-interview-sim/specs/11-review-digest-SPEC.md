# SPEC 11 — Review digests (full raw + skimmable MD)

**Status:** implemented  
**Parent:** [PRD.md](../PRD.md) (offline corpus; training ≠ fine-tune)  
**Grill locks:** A+B dual export; digest option B; write A+C; retain couple A; header cues B.

## Decision

T2 does **not** need full raw JSON as model-training data. Full JSON is for **human deep review**. Overnight triage uses a paired **digest**.

| Artifact | Role |
|---|---|
| `t2-<id>.json` | Full raw transcript (source of truth) |
| `t2-<id>.digest.md` | Skimmable: meta + review tags + turns with **truncated prose (~400 chars)** and **full ASCII/mermaid fences** |

- Digest written on every `writeCorpusBundle` finalize (opt-out `skipDigest: true`).
- Post-hoc: `npm run sd-interview-sim:digest -- path/to/t2-*.json`
- `retainLastN` deletes JSON + matching `.digest.md` together.
- Soft tags (best-effort): `ascii_hld_present`, `mermaid_present`, `candidate_rewind`, `full_raw`.
- Fixture promotion remains **manual** after human review — digests are not auto-train input.
