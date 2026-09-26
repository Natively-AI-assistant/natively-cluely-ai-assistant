# Windows verification checklist — retrieval-scale changes

Nothing in this change set has been executed on Windows. The code is platform-independent
TypeScript (no `process.platform` branch, no paths, no child processes, no native modules), and the
CRLF fix is covered by tests that feed CRLF input on macOS — but that is not a Windows run.
Report each item as pass / fail with the file used.

## 1. A reference file with Windows line endings keeps its headings
The defect: every chunker split on `\n`; a CRLF file kept `\r` on each line and the heading pattern
could not match, so a markdown file authored on Windows was chunked with NO headings.
1. In Notepad, write a markdown file with three `## Section` headings and a distinct fact under
   each. Save it (Notepad writes CRLF). Confirm CRLF in VS Code's status bar.
2. Attach it to a mode (General). Ask for the fact under the THIRD heading.
3. Pass: the answer is correct. With debug logging on, the retrieved chunk begins
   `[context: <that heading>]`. Fail: a wrong section's fact, or "not in the material".

## 2. An extracted (plain-text) PDF chunks on its entry titles
1. Attach a multi-page PDF résumé or handbook whose entries have titles on their own line
   (e.g. "Project X — Company (2020–2022)").
2. Ask a question answerable only from a line INSIDE a late entry ("Who did you work under on
   Project X?").
3. Pass: correct answer naming the right entry. Fail: an answer taken from a neighbouring entry.

## 3. The one-time re-index is lazy
The chunker version moved (2 → 3), so files indexed before the update are stale.
1. With at least two modes that already had reference files before updating, launch the app.
2. Pass: no burst of embedding activity at boot. Activating a mode re-indexes THAT mode's files
   (log: `re-indexing "<file>"`); the other mode's files are untouched until it is activated.
3. Ask a question immediately after activating a mode with a large file: the answer must still be
   sensible (stale vectors are ignored for that turn, never mixed with new chunks).

## 4. The bundled embedder outside a meeting
Only if no embedding provider key is configured (the app then uses the bundled local model).
1. With NO meeting running, ask a paraphrased question about an attached file (words that do not
   appear in the file, e.g. "how long do we keep the compliance trail" for "audit logs retained").
2. Pass: answered; the debug log shows `"usingLexicalForLocalManualQuery":false`.
3. Start a meeting, ask again. Pass: still answers or degrades gracefully; the log shows
   `"usingLexicalForLocalManualQuery":true` (lexical-only is kept during meetings by design).
4. Watch for a crash or a hang in step 1 — this path is new on Windows.

## 5. Profile Intelligence
1. Upload a résumé and a job description. Switch to a job-search mode with no files attached.
2. Ask a JD question that does not say "role", "position" or "interview"
   ("How much relocation do they cover?", "How often is the team on call?").
3. Pass: answered from the job description.

## 6. Unit suites
`npm run test:electron` on Windows; note that a green Windows CI leg alone is not evidence
(it is `continue-on-error`) — read the job log for the test totals.
