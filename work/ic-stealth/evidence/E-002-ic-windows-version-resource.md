# E-002 — Interview Coder Windows exe version resource

## claim
On Windows the exe is **not** renamed (it is `interviewcoder.exe`), but the PE
**version resource** carries the disguise name `systemcontainer` in
`FileDescription` and `ProductName`. Task Manager's "Description" column and
File → Properties → Details therefore show `systemcontainer`.

## source
- `…/T/opencode/ic-setup.exe` (199 MB NSIS installer, `NSIS-3 Unicode`)
- app payload extracted to `…/T/opencode/ic-win-app/interviewcoder.exe` (211 MB, single exe — **no** separate helper exes; all Electron process types run as `interviewcoder.exe` via `--type=` flags)
- version resource parsed from the PE `VS_VERSION_INFO` block (UTF-16LE) at file offset ~210093566

## version resource (StringFileInfo, 040904b0)
| field | value |
|-------|-------|
| CompanyName | `ycaptain` |
| **FileDescription** | **`systemcontainer`** |
| FileVersion | `3.0.0` |
| InternalName | `interviewcoder` |
| LegalCopyright | `Copyright © 2026 ycaptain` |
| OriginalFilename | `interviewcoder.exe` |
| **ProductName** | **`systemcontainer`** |
| ProductVersion | `3.0.0.0` |
| SquirrelAwareVersion | `1` (Squirrel.Windows install) |

## what each Windows surface shows
| surface | value | reveals brand? |
|---------|-------|----------------|
| Task Manager **Name** (image name) | `interviewcoder.exe` | yes (brand) |
| Task Manager **Description** | `systemcontainer` | no |
| Properties → Details → Product name | `systemcontainer` | no |
| Properties → Details → File description | `systemcontainer` | no |
| Install dir | `%LOCALAPPDATA%\interviewcoder\app-3.0.0\` | yes (brand) |

## why it matters
The Windows image name (`interviewcoder.exe`) is **not** disguised — so the
Windows "not getting caught" is **not** primarily about the Task Manager Name
column. The disguise there is the version resource (Description/ProductName).
The differentiator vs Natively is mainly the **macOS** on-disk rename.
