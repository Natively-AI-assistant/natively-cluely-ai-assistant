# Homebrew Cask Distribution & Release Guide

Natively is officially available on macOS via [Homebrew Cask](https://github.com/Homebrew/homebrew-cask).

## User Installation

Users on macOS can install Natively with a single command:

```bash
brew install --cask natively
```

To upgrade to the latest version:

```bash
brew upgrade --cask natively
```

---

## How It Works

The official Cask definition lives in the [Homebrew/homebrew-cask](https://github.com/Homebrew/homebrew-cask) repository under `Casks/n/natively.rb` ([PR #289291](https://github.com/Homebrew/homebrew-cask/pull/289291)).

The Cask downloads the signed and notarized `.dmg` packages directly from GitHub Releases:
* **Apple Silicon (arm64):** `https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/releases/download/V#{version}/Natively-#{version}-arm64.dmg`
* **Intel (x64):** `https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/releases/download/V#{version}/Natively-#{version}.dmg`

---

## How Updates Work for Future Releases

### 1. Automatic Update via Homebrew Autobump Bot (Zero-Touch)
The Cask formula contains a `livecheck` configuration:

```ruby
livecheck do
  url :url
  regex(/^V?(\d+(?:\.\d+)+)$/i)
end
```

* Homebrew's official background bot runs daily across all casks.
* When a new GitHub release is published with `.dmg` assets attached, Homebrew's bot automatically:
  1. Detects the new release version.
  2. Downloads the new `.dmg` files.
  3. Computes the new `sha256` checksums.
  4. Opens an automated Pull Request in `Homebrew/homebrew-cask`.
  5. Merges it once automated CI passes.

No manual action is strictly required from maintainers.

---

### 2. Immediate Manual Update via `brew bump-cask-pr`
If you publish a critical update or do not want to wait for the daily bot run, you or any contributor can trigger an immediate update in 10 seconds:

```bash
brew bump-cask-pr --version <NEW_VERSION> natively
```

Example for version `2.9.0`:
```bash
brew bump-cask-pr --version 2.9.0 natively
```

Homebrew will download the new DMGs, verify the SHA256 checksums, and submit the PR automatically with your GitHub credentials.

---

## Release Asset Naming Requirements

To ensure Homebrew continues to resolve releases cleanly:
1. Release tags should follow `V<version>` (e.g. `V2.8.8` or `V2.9.0`).
2. Release assets attached to the GitHub release must keep the established naming format:
   - `Natively-<version>-arm64.dmg` (for Apple Silicon)
   - `Natively-<version>.dmg` (for Intel x64)
3. Both DMGs must be code-signed and notarized (as handled by `.github/workflows/release-macos.yml`).
