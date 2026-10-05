# E-004 — Why a consistent helper rename is safe (Chromium mechanism)

## claim
The comment in `scripts/ad-hoc-sign.js` — *"We do NOT rename the .app folders or
the executable binaries … Chromium hardcodes the helper paths based on
productName"* — is **misleading**. Chromium derives each helper's launch path
from the **main executable's basename** at runtime, so a *consistent* rename
(main exe + all helpers sharing the same base name) is exactly what Electron
expects. Interview Coder ships a fully renamed bundle and works (E-001).

## source
- Chromium `content/browser/child_process_host_impl.cc` → `ChildProcessHost::GetChildPath(int flags)`
- Electron `shell/browser/electron_browser_client.cc` → `ElectronBrowserClient::GetChildProcessPath(int)` (Plugin helper)

## mechanism (renderer / GPU — Chromium)
```cpp
base::FilePath child_path;
base::PathService::Get(content::CHILD_PROCESS_EXE, &child_path);
// per-type suffix: kMacHelperSuffix_renderer = " Helper (Renderer)",
//                  kMacHelperSuffix_gpu      = " Helper (GPU)"
std::string child_base_name = child_path.BaseName().value() + child_suffix;
child_path = child_path.DirName().DirName().DirName().DirName()
                 .Append(child_base_name + ".app")
                 .Append("Contents").Append("MacOS").Append(child_base_name);
```
The helper app is `<base> Helper (Renderer).app`, located in `Contents/Frameworks/`
relative to the base executable. The name is **constructed from the basename**,
not a hardcoded literal (confirmed: no `"Helper ("` string literal exists in the
Electron 38 / 43 framework binaries).

## consequence
If the main executable is `systemcontainer` and the default helper is
`systemcontainer Helper`, then:
- renderer → `systemcontainer Helper (Renderer).app`
- gpu → `systemcontainer Helper (GPU).app`
- plugin → `systemcontainer Helper (Plugin).app`

…which is **exactly** Interview Coder's layout. electron-builder produces this
layout automatically when `productName` is set to the disguise name, so no
manual rename (and no re-signing of a hand-renamed tree) is required.
