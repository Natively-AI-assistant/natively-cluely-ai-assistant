<!-- code-review-graph MCP tools -->

# Natively Development Instructions

Natively is a production Electron application supporting both macOS and Windows.

Every implementation, bug fix, refactor, dependency update, configuration change, build change, and architectural decision must preserve correct behavior on both operating systems.

---

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the `code-review-graph` MCP tools BEFORE using Grep, Glob, Read, or broad filesystem exploration.**

The graph is faster, cheaper, and provides structural context such as callers, dependents, affected flows, and test coverage that direct file scanning cannot provide.

### When to use graph tools first

* **Exploring code:** Use `semantic_search_nodes` or `query_graph` instead of Grep.
* **Understanding impact:** Use `get_impact_radius` instead of manually tracing imports.
* **Reviewing changes:** Use `detect_changes` and `get_review_context` instead of reading entire files.
* **Finding relationships:** Use `query_graph` with `callers_of`, `callees_of`, `imports_of`, and `tests_for`.
* **Architecture questions:** Use `get_architecture_overview` and `list_communities`.
* **Cross-platform investigation:** Use graph tools to locate macOS implementations, Windows implementations, shared abstractions, native helpers, and affected tests.

Fall back to Grep, Glob, and Read only when the graph does not contain the required information or when exact implementation details must be inspected after graph-based discovery.

### Key tools

| Tool                        | Use when                                                   |
| --------------------------- | ---------------------------------------------------------- |
| `detect_changes`            | Reviewing code changes and obtaining risk-scored analysis  |
| `get_review_context`        | Retrieving source snippets efficiently                     |
| `get_impact_radius`         | Understanding the blast radius of a change                 |
| `get_affected_flows`        | Finding affected execution paths                           |
| `query_graph`               | Tracing callers, callees, imports, tests, and dependencies |
| `semantic_search_nodes`     | Finding functions, classes, modules, or concepts           |
| `get_architecture_overview` | Understanding high-level architecture                      |
| `list_communities`          | Finding related architectural areas                        |
| `refactor_tool`             | Planning renames and detecting dead code                   |

### Required graph workflow

Before modifying code:

1. Use `semantic_search_nodes` or `query_graph` to locate the implementation.
2. Use `get_impact_radius` to identify affected modules and platform-specific dependents.
3. Use `get_affected_flows` to identify affected user and system flows.
4. Search for both macOS and Windows implementations of the same behavior.
5. Use `query_graph` with `tests_for` to inspect existing coverage.
6. Read only the relevant files and source regions discovered through the graph.
7. After editing, use `detect_changes` to review the resulting change set.
8. Re-run impact and affected-flow analysis if the implementation changed materially.

The graph auto-updates when files change through repository hooks.

---

# Cross-Platform Development Contract

## Non-negotiable requirement

Never design, implement, or approve a solution based solely on the operating system currently running Claude Code.

The fact that Claude Code is running on macOS does not mean the implementation may ignore Windows.

The fact that Claude Code is running on Windows does not mean the implementation may ignore macOS.

A change is incomplete until its impact on both platforms has been investigated.

Never claim that functionality works on both platforms unless it was:

* Executed on both platforms, or
* Covered by reliable automated tests that exercise both platform branches.

Clearly distinguish between code review, automated testing, simulated platform testing, and physical execution.

---

## Required platform investigation

Before editing cross-platform-sensitive code, search the graph and codebase for:

* `process.platform`
* `darwin`
* `win32`
* `isMac`
* `isMacOS`
* `isWindows`
* Platform adapters
* Native helpers
* Windows executable files
* macOS helper applications
* Platform-specific package scripts
* Electron Builder configuration
* Signing and packaging configuration
* Platform-specific tests
* Existing feature implementations for the other operating system

Do not create a new implementation until the corresponding implementation on the other platform has been located and reviewed.

When one platform has no implementation, explicitly state that it is missing rather than silently applying the current platform's behavior.

---

## Cross-platform-sensitive areas

Treat a change as cross-platform-sensitive when it affects any of the following:

* Electron windows
* Transparent overlays
* Window focus
* Click-through behavior
* Always-on-top behavior
* Fullscreen applications
* Virtual desktops or Spaces
* Taskbar or Dock behavior
* Tray or menu-bar behavior
* Global shortcuts
* Keyboard modifiers
* Clipboard access
* Screenshots
* Screen capture
* Display enumeration
* Microphone capture
* Speaker or system-audio capture
* Audio devices
* Native Node modules
* Native executables
* Child processes
* Process termination
* Filesystem paths
* Temporary directories
* User-data directories
* Cache directories
* Environment variables
* Secure storage
* Keychain
* Windows Credential Manager
* Permissions
* Privacy prompts
* Auto-updates
* Application lifecycle
* Installers
* Code signing
* Notarization
* Packaging
* IPC
* Startup behavior
* Shutdown behavior
* Deep linking
* Protocol registration

For these areas, assume platform behavior differs until verified otherwise.

---

## Shared and platform-specific architecture

Shared business logic should remain platform-independent.

Operating-system integrations should be isolated behind explicit platform interfaces or adapters.

Preferred structures include:

```text
feature/
  index.ts
  types.ts
  shared.ts
  macos.ts
  windows.ts
```

Or:

```text
feature.shared.ts
feature.darwin.ts
feature.win32.ts
```

Prefer:

```ts
interface PlatformFeatureAdapter {
  initialize(): Promise<void>;
  dispose(): Promise<void>;
}
```

Avoid scattering `process.platform` checks across unrelated files.

Do not duplicate entire features when only a small operating-system integration differs.

Do not force both platforms through one implementation merely to avoid platform-specific files.

Do not silently route an unsupported platform through another platform's implementation.

Use exhaustive platform handling when appropriate.

```ts
switch (process.platform) {
  case "darwin":
    return createMacOSAdapter();

  case "win32":
    return createWindowsAdapter();

  default:
    throw new Error(`Unsupported platform: ${process.platform}`);
}
```

---

## Preserve the other platform

When changing an existing platform-specific implementation:

1. Locate the corresponding implementation for the other platform.
2. Determine whether shared interfaces, contracts, or return values are changing.
3. Check all callers and dependents through the graph.
4. Update both platform implementations when the shared contract changes.
5. Preserve working behavior on the platform that cannot currently be executed.
6. Add tests that detect contract drift between platform implementations.

Never remove or rewrite Windows behavior simply because it cannot be executed from macOS.

Never remove or rewrite macOS behavior simply because it cannot be executed from Windows.

When uncertain, make the smallest isolated change and explicitly document what still requires physical verification.

---

## Filesystem and paths

Never hardcode operating-system-specific paths in shared code.

Avoid assumptions such as:

```text
/tmp
/Applications
~/Library
C:\Program Files
%APPDATA%
```

Use appropriate APIs:

* `node:path`
* `path.join`
* `path.resolve`
* `node:os`
* `os.tmpdir()`
* Electron `app.getPath()`
* Electron `process.resourcesPath`

Do not construct paths using manual string concatenation.

Account for:

* Windows drive letters
* Backslash and forward-slash differences
* Spaces in paths
* Unicode characters
* Case-sensitive and case-insensitive filesystems
* Windows file locking
* Long Windows paths
* Packaged versus development paths
* ASAR packaging
* Platform-specific executable extensions

Do not assume that a path valid during development remains valid in a packaged application.

---

## Shell commands and scripts

Do not add Unix-only commands to shared package scripts or runtime code.

Do not assume the availability of:

* Bash
* Zsh
* `/bin/sh`
* `rm`
* `cp`
* `mv`
* `grep`
* `sed`
* `chmod`
* `kill`
* `pkill`
* `which`

Do not assume PowerShell or Command Prompt syntax works on macOS.

Prefer Node.js APIs or cross-platform libraries for:

* Copying files
* Deleting files
* Creating directories
* Moving files
* Finding executables
* Running build tasks
* Terminating processes

When a platform command is unavoidable:

1. Implement explicit macOS and Windows paths.
2. Pass command arguments as arrays when possible.
3. Avoid shell interpolation.
4. Quote paths safely.
5. Test paths containing spaces.
6. Handle executable extensions correctly.
7. Handle process termination separately where required.
8. Document why a cross-platform Node.js solution was unsuitable.

Do not use Unix signals as the only process-shutdown mechanism for Windows processes.

---

## Electron behavior

Treat Electron APIs as potentially platform-specific even when the same API exists on both systems.

Review both platforms when changing:

* `BrowserWindow`
* Window transparency
* Window focusability
* `setIgnoreMouseEvents`
* `setAlwaysOnTop`
* `setVisibleOnAllWorkspaces`
* `setContentProtection`
* `showInactive`
* Window bounds
* Display scaling
* DPI handling
* Fullscreen behavior
* Global shortcuts
* Tray behavior
* Application menus
* Dock behavior
* Taskbar behavior
* App lifecycle events
* Quit and close handling
* Single-instance locking
* Screen-capture sources
* Native themes
* Notifications

Do not assume macOS window levels map directly to Windows always-on-top behavior.

Do not assume macOS Spaces behavior maps directly to Windows virtual desktops.

Do not assume transparent-window behavior, focus behavior, or click-through behavior is identical.

Use `CommandOrControl` for shortcuts when the intended action is equivalent across platforms.

Use explicit `Command`, `Option`, `Control`, or `Alt` only when the behavior is intentionally platform-specific.

---

## Audio and capture behavior

Natively's audio and capture systems are platform-sensitive.

Before changing microphone, speaker, system-audio, screen-capture, or device-selection behavior:

1. Locate the complete macOS pipeline.
2. Locate the complete Windows pipeline.
3. Identify shared interfaces and state.
4. Inspect native helpers and child processes.
5. Inspect device and permission handling.
6. Inspect cleanup and reconnection behavior.
7. Inspect packaged resource paths.
8. Review tests and diagnostics for both platforms.

Do not assume macOS audio APIs, permissions, device IDs, loopback capture, or process behavior apply to Windows.

Do not assume Windows WASAPI, loopback capture, device IDs, or helper behavior apply to macOS.

Changes to shared audio state must be checked against both platform pipelines.

---

## Permissions and secure storage

Treat permissions and secure storage as separate implementations.

macOS may involve:

* Keychain
* Microphone permission
* Screen Recording permission
* Accessibility permission
* Apple Events
* Code-signing entitlements
* Hardened Runtime

Windows may involve:

* Credential Manager or DPAPI
* Microphone privacy settings
* Screen-capture restrictions
* Antivirus or SmartScreen
* Installer permissions
* UAC
* Executable signing

Do not display macOS-specific troubleshooting on Windows or Windows-specific troubleshooting on macOS.

Do not assume secure-storage errors have the same causes or remedies across platforms.

---

## Native dependencies and helpers

Before changing a native module, executable, or helper process, verify:

* macOS support
* Windows support
* CPU architecture support
* Electron ABI compatibility
* Rebuild requirements
* Development loading
* Packaged loading
* ASAR unpacking
* Executable file extension
* File permissions
* Code-signing requirements
* Notarization implications
* Windows signing implications
* Installer inclusion
* Process startup
* Process shutdown
* Crash handling
* Update compatibility

A dependency that installs successfully on the current operating system must not automatically be considered safe for the other platform.

Do not upgrade a native dependency without investigating platform support and packaged behavior.

---

## Dependencies

Before adding or replacing a package:

1. Verify that it supports both macOS and Windows.
2. Check whether it uses native bindings.
3. Check Electron compatibility.
4. Check bundler and packaging implications.
5. Check whether optional platform packages are required.
6. Check whether installation scripts are operating-system-specific.
7. Prefer existing project dependencies when they already solve the problem.

Do not replace an existing cross-platform solution with a platform-specific package without a justified architecture decision.

---

## Testing requirements

For every cross-platform-sensitive change:

1. Define expected macOS behavior.
2. Define expected Windows behavior.
3. Add or update tests for both platform branches.
4. Run type checking.
5. Run linting.
6. Run relevant unit tests.
7. Run relevant integration tests.
8. Run packaging or build validation where practical.
9. Validate the current operating system physically where practical.
10. Clearly state what was not physically tested.

Platform detection should be injectable where practical.

Prefer:

```ts
function createFeature(platform: NodeJS.Platform) {
  if (platform === "darwin") {
    return createMacOSFeature();
  }

  if (platform === "win32") {
    return createWindowsFeature();
  }

  throw new Error(`Unsupported platform: ${platform}`);
}
```

Instead of embedding untestable platform detection throughout the implementation:

```ts
if (process.platform === "darwin") {
  // ...
}
```

Tests should explicitly exercise:

```ts
createFeature("darwin");
createFeature("win32");
```

Do not mutate `process.platform` directly.

A test suite that only executes the current platform branch is insufficient for shared code containing platform-specific conditions.

---

## Build and packaging validation

When a change affects build or packaging configuration, inspect both:

* macOS build configuration
* Windows build configuration

Review, where applicable:

* Electron Builder targets
* Included files
* Extra resources
* ASAR unpack patterns
* Native modules
* Helper binaries
* Icons
* Entitlements
* Signing
* Notarization
* NSIS configuration
* Auto-update artifacts
* Publish configuration
* Architecture targets
* Environment variables
* CI workflows

Do not treat a successful development-mode run as proof that the packaged application works.

Do not treat a successful macOS package as proof that the Windows installer builds.

Do not treat a successful Windows package as proof that the macOS application signs or notarizes.

---

## CI expectations

Where practical, cross-platform-sensitive changes should be validated through a CI matrix containing both:

```yaml
strategy:
  matrix:
    os:
      - macos-latest
      - windows-latest
```

Do not add a macOS-only CI check for shared application behavior unless the limitation is intentional and documented.

Do not add a Windows-only CI check for shared application behavior unless the limitation is intentional and documented.

Platform-specific jobs may remain separate when signing secrets, notarization, installers, native helpers, or hardware requirements differ.

---

## Required completion report

Before declaring a task complete, report:

### Change summary

* Files changed
* Behavior changed
* Shared modules affected
* Platform-specific modules affected

### Cross-platform analysis

* Expected macOS behavior
* Expected Windows behavior
* Existing platform implementations reviewed
* Affected flows
* Impact radius
* Potential regressions

### Validation

Use these exact categories when applicable:

* `Tested physically on macOS`
* `Tested physically on Windows`
* `Covered by automated macOS branch tests`
* `Covered by automated Windows branch tests`
* `Build validated on macOS`
* `Build validated on Windows`
* `Reviewed but not executed on macOS`
* `Reviewed but not executed on Windows`
* `Requires physical macOS verification`
* `Requires physical Windows verification`

Never use “cross-platform verified” when only one platform was physically tested.

### Commands executed

List the important validation commands that were actually run.

Do not list commands that were merely recommended or considered.

### Remaining risks

State any platform behavior that could not be validated.

---

## Stop conditions

Do not declare the task complete when:

* Only the current operating system was considered.
* The corresponding implementation for the other platform was not reviewed.
* A shared interface changed without checking both implementations.
* A Unix-only command was added to a shared workflow.
* A Windows-only command was added to a shared workflow.
* A platform-sensitive change has no validation strategy.
* The current platform succeeds but the other platform branch is broken or missing.
* Platform-specific behavior is being guessed and presented as verified.
* Existing behavior on the other platform was removed without evidence that it is obsolete.
* A native dependency was changed without checking both platforms.
* Packaging changes were validated only in development mode.
* Tests cover only the currently running platform branch.

When physical verification on the other operating system is unavailable:

1. Preserve its existing implementation.
2. Review the affected code and contracts.
3. Add automated platform-branch tests where possible.
4. Avoid broad or speculative rewrites.
5. Explicitly mark the remaining physical verification requirement.

---

## Core principle

The operating system running Claude Code is an execution environment, not the scope of the product.

Every change must be designed for Natively's complete supported platform surface: macOS and Windows.
