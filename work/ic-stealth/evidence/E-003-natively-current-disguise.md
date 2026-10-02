# E-003 — Natively current disguise (before fix)

## claim
Natively's disguise was **display-name only**: a runtime `process.title` plus a
helper `Info.plist` `CFBundleName` override. The **on-disk identity stayed
`Natively`** (bundle, main executable, helper folders + executables), so any
detector reading the process path / bundle / bundle-id saw the brand.

## source
- `electron/utils/disguiseAppName.ts`
- `electron/main.ts` `_applyDisguise()` (~L8393) and startup stealth path
- `scripts/ad-hoc-sign.js` `disguiseHelperPlists()` (`DISGUISE_BASE = 'CoreServices'`)
- `package.json` `build` block

## observations
| item | value (before) |
|------|----------------|
| `build.productName` | `Natively` → bundle `Natively.app`, exe `Natively`, helpers `Natively Helper (X).app` |
| `build.appId` | `com.electron.meeting-notes` |
| main runtime | `process.title = 'Terminal '` / `'System Settings '` / `'Activity Monitor '` (per mode, trailing space deliberate); `app.setName(appName)`; `process.env.CFBundleName = appName.trim()` |
| helper on-disk | folder + executable still `Natively Helper (X)` |
| helper plist | `CFBundleName`/`CFBundleDisplayName` → `CoreServices Helper (X)` (metadata only) |
| Windows exe | `Natively.exe` (no rename); `process.title = 'Command Prompt '` only sets the **console title**, not the image name |

## the gap (Evidence → Finding)
- **E:** macOS helper process name comes from the **executable basename**, not the plist `CFBundleName`. The plist override to `CoreServices` therefore did **not** change what Activity Monitor shows for the helper — it still showed `Natively Helper`.
- **E:** `process.title` changes `p_comm` (Name column) but **not** `proc_pidpath()`. The path stayed `…/Natively.app/Contents/MacOS/Natively`.
- **Finding:** a proctoring tool that enumerates processes **and** resolves the executable path (the thorough check) sees `Natively` regardless of the `process.title` / plist disguise. Interview Coder avoids this by renaming the on-disk identity (E-001).
