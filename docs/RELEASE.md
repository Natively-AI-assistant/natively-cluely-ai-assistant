# Release Process & Update Channels

## Update Channels

Natively supports two update channels:

| Channel | File | Description |
|---------|------|-------------|
| **stable** | `latest.yml` | Production releases for all users |
| **beta** | `beta.yml` | Pre-release testing for beta testers |

### How It Works

Users can select their preferred update channel in **Settings → Version** (pill toggle).

Alternatively, the channel is auto-detected based on the version suffix:

```typescript
// electron/main.ts - setupAutoUpdater()
const savedChannel = settingsManager.get('updateChannel')
if (savedChannel === 'beta') {
  autoUpdater.channel = 'beta'
} else {
  autoUpdater.channel = 'latest'  // stable
}
```

| Version | Channel | Updates to |
|---------|---------|------------|
| `2.0.7` (stable) | latest | `2.0.8`, `2.1.0` |
| `2.0.7-beta.1` (if using version-based) | beta | `2.0.7-beta.2`, `2.0.8-beta.1` |
| `2.0.8` (stable) | latest | `2.0.9`, `2.1.0` |

---

## Release Workflow

### 1. Beta Release (Testing)

```bash
# 1. Update version in package.json
"version": "2.0.8-beta.1"

# 2. Build
npm run dist

# 3. Upload to GitHub Release
# - Tag: v2.0.8-beta.1
# - Title: Natively v2.0.8-beta.1
# - Mark as "Pre-release"
# - Upload files from release/:
#   - Natively-Setup-2.0.8-beta.1.exe  <-- NSIS installer (dashes)
#   - Natively 2.0.8-beta.1.exe        <-- portable (space)
#   - beta.yml  <-- only this, NOT latest.yml!
#   - *.blockmap files

# IMPORTANT: Do NOT upload latest.yml for beta releases!
# Stable users must never see beta as an update.
```

### 2. Stable Release (Production)

```bash
# 1. Update version in package.json
"version": "2.0.8"

# 2. Build
npm run dist

# 3. Upload to GitHub Release
# - Tag: v2.0.8
# - Title: Natively v2.0.8
# - Upload files from release/:
#   - Natively-Setup-2.0.8.exe  <-- NSIS installer (dashes)
#   - Natively 2.0.8.exe        <-- portable (space)
#   - latest.yml  <-- for stable users
#   - beta.yml    <-- copy of latest.yml, so beta users also get stable updates
#   - *.blockmap files
```

---

## Platform Behavior

### Windows
- ✅ Full auto-update (check → download → install)
- Uses NSIS installer

### macOS
- ⚠️ Semi-automatic (check → download → manual install)
- Opens download folder in Finder for unsigned apps
- Requires Apple Developer ($99/year) for full auto-update

---

## Version Numbering

Follow [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH[-PRERELEASE]

Examples:
2.0.7           - Stable release
2.0.7-beta.1    - Beta pre-release
2.0.7-beta.2    - Beta iteration
2.1.0           - Minor feature release
3.0.0           - Major breaking change
```

---

## Files Created by Build

| File | Purpose |
|------|---------|
| `latest.yml` | Stable channel manifest |
| `beta.yml` | Beta channel manifest |
| `*.exe` | Windows installer |
| `*.dmg` | macOS installer |
| `*.blockmap` | Differential update support |
