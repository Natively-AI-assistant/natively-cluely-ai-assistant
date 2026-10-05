# Homebrew Cask distribution

Resolves [#577](https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/issues/577)
— `brew install --cask natively` for macOS.

Everything that can live in this repo does: the cask itself
(`packaging/homebrew/Casks/natively.rb`), the renderer that produces it
(`scripts/render-homebrew-cask.mjs`), and the workflow that re-runs the renderer
on every published release (`.github/workflows/homebrew-cask-sync.yml`).

Two steps are **not** automatable from here and need a human once:
creating the tap repository, and adding the token the sync workflow pushes with.
Both are below.

---

## The tag-case trap — read this first

The cask's download URL is
`.../releases/download/<TAG>/Natively-<version>-arm64.dmg`, and that path is
**case-sensitive**. The repo's tags are not consistent:

| Tags | Case |
|---|---|
| `v1.1.1` … `v2.8.1` | lowercase `v` |
| `V2.8.7`, `V2.8.8` | **uppercase `V`** |
| `2.1.0` | no prefix |

Verified against the live release:

```
V2.8.8/Natively-2.8.8-arm64.dmg  ->  200
v2.8.8/Natively-2.8.8-arm64.dmg  ->  404
```

A cask carries exactly one URL template, so it cannot try both. The renderer
resolves the real tag from the GitHub API and bakes that literal case into the
URL, which means **the cask is only ever correct for the release it was
rendered from**. Re-render on every release rather than hand-editing the
version — `render-homebrew-cask.mjs` does this for you.

> **Related, and worth fixing separately:** `.github/workflows/release-macos.yml`
> triggers on `tags: ['v*']`. GitHub's tag globs are case-sensitive, so
> `V2.8.7` and `V2.8.8` never fired it — the last run was `v2.8.1`. Adding
> `'V*'` to that list (or standardising on lowercase `v` going forward) makes
> the release pipeline and the cask agree. Not changed here: turning the
> trigger on would start firing a ~3-hour signed-and-notarized build on tags
> that currently do nothing, which is a release-process decision.

---

## One-time setup

### 1. Create the tap repository

The repo must be named `homebrew-tap` for `brew tap` to find it:

```bash
gh repo create Natively-AI-assistant/homebrew-tap --public \
  --description "Homebrew tap for Natively"

git clone https://github.com/Natively-AI-assistant/homebrew-tap
cd homebrew-tap
mkdir -p Casks
cp ../natively-cluely-ai-assistant/packaging/homebrew/Casks/natively.rb Casks/
git add Casks/natively.rb
git commit -m "natively 2.8.8"
git push
```

Users can then install with:

```bash
brew install --cask Natively-AI-assistant/tap/natively
```

### 2. Add the sync token

`homebrew-cask-sync.yml` pushes the regenerated cask to that repo. The default
`GITHUB_TOKEN` cannot write to another repository, so it needs its own:

1. Create a fine-grained PAT scoped to `Natively-AI-assistant/homebrew-tap`
   with **Contents: read and write**.
2. Add it to this repo as the secret `HOMEBREW_TAP_TOKEN`
   (Settings → Secrets and variables → Actions).

Until that secret exists the workflow still runs and still renders the cask —
it just uploads it as a build artifact and prints a notice instead of pushing.
Nothing fails.

---

## Every release

Nothing, if the secret is set: publishing a GitHub Release fires the sync
workflow, which re-hashes the two DMGs and pushes the updated cask to the tap.

To do it by hand, or to check a release:

```bash
node scripts/render-homebrew-cask.mjs --tag V2.9.0   # rewrite the cask
node scripts/render-homebrew-cask.mjs --check        # verify vs. latest release
```

`--check` exits non-zero when the committed cask no longer matches its release,
which is the failure a user would otherwise hit as a checksum mismatch during
`brew install`.

---

## Verifying a change to the cask

Without installing a 1 GB app:

```bash
ruby -c packaging/homebrew/Casks/natively.rb        # syntax
brew style packaging/homebrew/Casks/natively.rb     # rubocop, Homebrew's rules

# Full audit + a real download that checks the sha256, but no install:
# Throwaway namespace: a plain `natively/...` tap can collide with one you have.
brew tap-new natively-casktest/local --no-git
cp packaging/homebrew/Casks/natively.rb "$(brew --repository)/Library/Taps/natively-casktest/homebrew-local/Casks/"
brew audit --cask --new natively-casktest/local/natively
brew livecheck --cask natively-casktest/local/natively
brew fetch --cask natively-casktest/local/natively      # downloads + verifies sha256
brew untap natively-casktest/local
```

`brew audit` is a developer command and refuses to run against outdated Xcode
Command Line Tools ("You should download the Command Line Tools for Xcode 27.0"),
which is an environment problem rather than a cask problem — `brew style` and
`brew livecheck` have no such requirement and cover the cask's own correctness.

Do **not** use `brew install --cask` to verify — it puts a 1 GB app in
`/Applications`. `brew fetch` proves the URL and the checksum, which is the
part that actually breaks.

---

## Why a tap and not `homebrew/cask` directly

The core `homebrew/cask` repo has a notability gate. Natively clears it
comfortably (2,564 stars, 588 forks against a 75-star / 30-fork threshold), and
the app is Developer ID signed, notarized and stapled, which is the other thing
core reviewers check. So a core submission is viable.

It is deliberately the second step, not the first:

- Core casks are updated by Homebrew's `BrewTestBot` from the `livecheck`
  stanza. That only works once the tag case is consistent — see the trap above.
- A tap ships today and needs no review. Core submission is a PR to
  `homebrew/homebrew-cask` and takes as long as it takes.
- Running the tap for a couple of releases proves the renderer and the
  `livecheck` block behave before a third party depends on them.

When you do submit to core, the same `natively.rb` is the PR — drop the
`verified:` line only if the homepage and download host ever come to match.

---

## What the `zap` stanza removes

`brew uninstall --cask natively` removes the app. `brew uninstall --zap` also
removes user data. The paths are derived from Electron's `app.getName()`, which
returns package.json's `name` (`natively`) — **not** the `Natively` product
name — plus the `com.apple.corespeechd` app ID for the preference domain.
The userData profile itself is pinned and migrated to the disguise name (see
`electron/utils/migrateUserData.ts`), so the historical `Natively` dir and the
post-migration `corespeechd` dir are both zapped. Verified against a real install:

```
~/Library/Application Support/corespeechd
~/Library/Application Support/Natively
~/Library/Application Support/natively
~/Library/Caches/natively
~/Library/Caches/natively-updater
~/Library/Logs/natively
~/Library/Preferences/com.apple.corespeechd.plist
~/Library/Saved Application State/com.apple.corespeechd.savedState
```

The cask also zaps the legacy `com.electron.meeting-notes` preference domain so
upgrades from pre-corespeechd releases clean up fully.

Deliberately **not** zapped: stealth mode calls `app.setName("Terminal ")` /
`"System Settings "` / `"Activity Monitor "` at runtime, so a disguised session
can leave a stray Application Support directory under one of those names. Those
strings collide with real Apple applications, and a cask that deleted
`~/Library/Application Support/Terminal` would destroy unrelated user data.
They stay.

---

## Auto-updates

The cask declares `auto_updates true` because signed builds carry
`nativelySigned` and take the real `autoUpdater.quitAndInstall()` path. Homebrew
therefore leaves the app alone on `brew upgrade` and lets Natively update
itself; `brew upgrade --cask --greedy natively` forces it through Homebrew if a
user prefers that. Without this stanza Homebrew and the in-app updater fight
over the bundle.
