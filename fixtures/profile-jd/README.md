# Profile/JD benchmark fixtures

Real artifacts the `scripts/e2e-profile-jd-real-path.js` harness defaults
to (overridable via `E2E_RESUME` / `E2E_JD` env vars).

- **Resume PDF** — `evinresume.pdf` (repo root): the user's own résumé.
  Evin John — AI & Full Stack Engineer Intern, B.Tech CS at CUSAT,
  projects include Natively (privacy-first AI meeting copilot), TalentScope,
  RedisMart. **Not a nursing/healthcare résumé.** The earlier harness draft
  assumed a nursing fixture (mistakenly used `test-fixtures/profiles/p04/
  _resume.txt` which IS the nursing one — that was the bug that produced
  17/40 with the wrong must-regex patterns; the harness was running on the
  correct PDF, the assertions were wrong). The current `Q` array is
  authored against the real `evinresume.pdf` content.

- **JD PDF** — `profileresume/Job-Description---Data-Analyst-Sample.pdf`
  (repo root): a Data Analyst sample JD. Intentionally NON-matching with
  Evin's software-engineer résumé. The mismatch is the point:
  - "JD direct requirements" answers come from the JD (data analyst skills).
  - "Resume direct facts" answers come from the résumé (software / AI skills).
  - "Compare / missing / false-premise" categories specifically require the
    model to reason about the gap between the two — that's not testable
    against a matching pair.

- **Optional backup fixtures** — `test-fixtures/profiles/p04/{resume.pdf,
  jd.txt}` exist for an alternate role-play persona (nursing clinical-care
  coordinator). Override `E2E_RESUME=/…/p04/resume.pdf E2E_JD=…/p04/jd.txt`
  if a nursing benchmark is wanted instead. (Note: the JD there is text,
  not a PDF — set `E2E_JD` accordingly.)

## Why a non-matching pair matters

The original Phase 10/11 task asked the harness to prove "explicit switch
accuracy ≥ 98%", "return-to-default accuracy ≥ 98%", "comparison accuracy
≥ 95%", and "candidate/JD contamination = 0". None of these can be
meaningfully verified against a same-domain pair (e.g. a data-analyst
résumé against a data-analyst JD would pass even a broken model on most
categories). The cross-domain mismatch is what makes each gate
discriminating.
