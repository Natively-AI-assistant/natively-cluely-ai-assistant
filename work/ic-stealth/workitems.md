# Work Items

| ID | title | role | targets | surface | status | evidence | notes |
|----|-------|------|---------|---------|--------|----------|-------|
| WI-001 | Establish scope and auth | lead | case | process | done | | offline-sample, auth granted |
| WI-002 | RE IC macOS bundle identity | lead | systemcontainer.app | process | done | E-001 | on-disk rename, no process.title |
| WI-003 | RE IC Windows version resource | lead | interviewcoder.exe | process | done | E-002 | FileDescription/ProductName=systemcontainer |
| WI-004 | Map Natively current disguise + gap | lead | Natively electron/ | process | done | E-003 | display-name only; on-disk exposes brand |
| WI-005 | Validate rename safety (helper path) | lead | Chromium/Electron | process | done | E-004 | path from exe basename; consistent rename safe |
| WI-006 | Implement fix (productName + userData pin + helper/perm names) | lead | Natively build+main | process | done | E-001..E-004 | typecheck pass |
| WI-007 | Report + field journal | lead | case | doc | done | E-001..E-004 | report.md, findings.md, journal |
| WI-008 | Round 2: propagate rename to CI/release + fix 8 review findings | lead | Natively scripts+CI | process | done | E-003, E-004 | 169/169 script tests; pinUserData early import; kill-recovery marker |
| WI-009 | Round 3: neutralize telemetry + window title + bundle id | lead | Natively electron+build | process | done | E-003 | telemetrySinks 11/11, windowTitleGuard 4/4, taskbar/meeting/keychain suites pass; full npm test 13419/0 |

## Coverage
- [x] Recon/analysis complete for in_scope assets
- [x] Critical/High candidates triaged (or N/A for pure RE) — N/A, pure RE
- [x] Validated findings have Evidence (E-*)
- [x] Path documented (attack/call/solve)
- [x] Timeline continuous across major phases
- [x] Report via docs-generator
- [x] field-journal anonymized

## Refs
- skills/ops/timeline-workitem.md
- skills/ops/evidence-finding-path.md
