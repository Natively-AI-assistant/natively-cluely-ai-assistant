# Profile/JD benchmark fixtures

Real artifacts the `scripts/e2e-profile-jd-real-path.js` harness defaults
to (overridable via `E2E_RESUME` / `E2E_JD` env vars).

- **Resume PDF** — `evinresume.pdf` (repo root): the user's own 2025 résumé.
- **JD PDF** — `profileresume/Job-Description---Data-Analyst-Sample.pdf`
  (repo root): the *Data Analyst* sample JD. Picked because it is NOT a
  nursing role — the harness therefore exercises genuine résumé/JD
  cross-source reasoning (not "both say nursing") and the comparison /
  missing-skill / false-premise categories all produce meaningful signals.
- **Optional backup fixtures** — `test-fixtures/profiles/p04/{resume.pdf,jd.txt}`
  exist for an alternate role-play persona (healthcare); override
  `E2E_RESUME=/…/p04/resume.pdf E2E_JD=/…/p04/jd.txt` if a nursing-role
  benchmark is wanted instead.

## Why these specific files

The user-provided nursing résumé + non-nursing data-analyst JD combination is
intentional: it lets the harness prove three Phase 10/11 gates the original
task named:

1. **Cross-source question correctness** — "Based on my résumé and the JD,
   what requirements do I clearly meet?" — BD/MSN are JD requirements; RN
   cert/7y are résumé strengths; the answer must surface BOTH, not invent
   either.
2. **Missing-skill detection** — "Does my résumé mention Tableau experience?"
   — answer must say NO without inventing it, even though the JD asks for
   it (a false-premise-flavoured question, since the prompt is inverting
   the "candidate has it" assumption).
3. **False-premise handling** — "Does the JD ask for an on-site role?" —
   must answer from JD, not résumé; must not affirmatively answer about
   nursing tools that aren't in either source.

A nursing/nursing benchmark would not exercise category (1) cross-source
mismatch as cleanly.