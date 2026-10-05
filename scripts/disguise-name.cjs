// ────────────────────────────────────────────────────────────────────────────
// Single source of truth for the on-disk app identity name, PER PLATFORM.
//
// This is the name the bundle / main executable / helper bundles+executables
// (macOS) and the exe + PE version resource + install dir (Windows) present to
// the OS. It is what Activity Monitor, `proc_pidpath()`, and Task Manager show.
//
// WHY per-platform: a name that is a REAL system process on macOS is usually NOT
// a real process on Windows (and vice-versa), so each platform gets its own
// believable alias:
//
//   darwin  →  corespeechd
//     A REAL, always-present macOS system daemon (Core Speech — the on-device
//     speech-recognition service). Passes a "is this a known system process?"
//     check, is not used by any known third-party app as a disguise, and is
//     plausible for THIS app (a meeting-transcription tool doing on-device
//     speech recognition is exactly what corespeechd is for).
//     ("systemcontainer", our previous value, is NOT a real process and is also
//     the exact alias Interview Coder ships — hiding behind someone else's name.)
//
//   win32   →  audiodg
//     A REAL Windows process (the Audio Engine, %SystemRoot%\System32\audiodg.exe)
//     that renders audio per session. Plausible for an audio/transcription app,
//     and not a known third-party disguise. (A macOS-style name like "corespeechd"
//     would look out of place in a Windows Task Manager.)
//
// HOW THIS IS APPLIED:
//   - scripts/package-app.js sets package.json "build" → "productName" to the
//     value for the target platform before running electron-builder (and restores
//     it afterwards). productName drives the bundle/exe/helpers (macOS) and the
//     exe name + PE version resource + install dir (Windows) consistently.
//   - scripts/ad-hoc-sign.js reads `.darwin` to re-assert the helper plist names.
//
// KEEP IN SYNC (static JSON that cannot require this file):
//   - package.json  →  "build" → "mac" → "extendInfo":
//       CFBundleDisplayName = "Natively" (brand). Dock, Finder, Spotlight,
//       permission-prompt titles and notifications render the display name, so
//       they show the brand. This is stealth-safe: Activity Monitor /
//       proc_pidpath / Task Manager key off the executable basename
//       (CFBundleExecutable stays the alias), and undetectable mode hides the
//       Dock tile entirely. Do NOT add CFBundleName here — the fallback must
//       stay the alias. Residual: NSWorkspace localizedName enumeration reads
//       the display name (see findings.md).
//     NS*UsageDescription strings use the brand ("Natively needs …") to match
//     the displayed app name in the prompt. The on-disk identity (productName,
//     CFBundleName, executable, helpers, bundle id) ALWAYS stays the alias.
//
// HOW TO ROTATE: change the value(s) below, update the two package.json fields
// above, then rebuild. Pick another real system process for the platform if one
// ever gets flagged (darwin: coreaudiod, cfprefsd; win32: svchost, SearchIndexer).
// ────────────────────────────────────────────────────────────────────────────
module.exports = {
  darwin: 'corespeechd',
  win32: 'audiodg',
};
