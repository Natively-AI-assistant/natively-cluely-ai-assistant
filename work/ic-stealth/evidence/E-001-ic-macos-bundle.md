# E-001 — Interview Coder macOS bundle identity

## claim
Interview Coder's macOS stealth is a **whole-bundle on-disk rename** to
`systemcontainer` (main bundle, main executable, and every helper bundle +
executable). There is **no** `process.title` trick in the main process.

## source
- `/Volumes/systemcontainer-3.0.1--arm64/systemcontainer.app` (mounted DMG, v3.0.1 arm64)
- asar extracted to `…/T/opencode/ic-asar` (main JS at `out/main/index.js`, 86 KB)

## observations
| item | value |
|------|-------|
| bundle folder | `systemcontainer.app` |
| main executable | `Contents/MacOS/systemcontainer` |
| helper bundles | `Contents/Frameworks/systemcontainer Helper (Renderer).app`, `… (GPU).app`, `… (Plugin).app`, `systemcontainer Helper.app` |
| helper executables | same basename as the bundle (e.g. `systemcontainer Helper (Renderer)`) |
| main `CFBundleName` / `CFBundleDisplayName` | `systemcontainer` |
| main `CFBundleIdentifier` | `com.interviewcoder.app` |
| helper `CFBundleName` | `Electron Helper` (left as-is) |
| helper `CFBundleDisplayName` | `systemcontainer Helper` |
| helper `LSUIElement` | `true` |
| codesign | `Developer ID Application: Bounty Studio, Inc. (89PS65RKC6)` |
| `ElectronAsarIntegrity` | present → Electron 30+ (measured **Electron 38 / Chrome 140.0.7339.41**) |

## main-process JS (`out/main/index.js`)
- **No** occurrence of `process.title` anywhere in the file.
- macOS: `B && u.dock?.hide()` — the Dock tile is hidden.
- Windows: `setAppUserModelId('com.interviewcoder')`.
- Single-instance lock is applied **on Windows only**.

## why it matters
Activity Monitor's Name column and `proc_pidpath()` both reflect the
**executable basename / bundle path**, not a runtime `process.title`. Because
the on-disk identity is `systemcontainer`, a detector that reads the process
path (the thorough check) sees `…/systemcontainer.app/Contents/MacOS/systemcontainer`
— no `InterviewCoder` / brand string anywhere.
