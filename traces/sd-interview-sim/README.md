# SD interview sim corpus

Overnight / training-corpus transcript bundles land here as redacted JSON files:

```text
traces/sd-interview-sim/<run_id>.json
```

- **File-based only** — never written to the meeting DB.
- **Gitignored** — runtime artifacts stay local (this README is the tracked exception).
- Writers: `writeCorpusBundle` + `retainLastN` in `scripts/lib/sd-interview-sim/corpus.js`.
