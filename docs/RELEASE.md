# Release Process & Update Channels

## Update Channels

Natively supports two update channels:

| Channel | File | Description |
|---------|------|-------------|
| **stable** | `latest.yml` | Production releases for all users |
| **beta** | `beta-latest.yml` | Pre-release testing for beta testers |

### How It Works

The update channel is **auto-detected** based on the version suffix:

```typescript
// electron/main.ts - setupAutoUpdater()
const currentVersion = app.getVersion()
if (currentVersion.includes('beta')) {
  autoUpdater.channel = 'beta'
} else {
  autoUpdater.channel = 'stable'
}
```

| Version | Channel | Updates to |
|---------|---------|------------|
| `2.0.7` | stable | `2.0.8`, `2.1.0` |
| `2.0.7-beta.1` | beta | `2.0.7-beta.2`, `2.0.8-beta.1` |
| `2.0.8` | stable | `2.0.9`, `2.1.0` |

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
#   - Natively Setup 2.0.8-beta.1.exe
#   - Natively.2.0.8-beta.1.exe
#   - beta-latest.yml  <-- important!
#   - *.blockmap files
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
#   - Natively Setup 2.0.8.exe
#   - Natively.2.0.8.exe
#   - latest.yml  <-- important!
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
| `beta-latest.yml` | Beta channel manifest |
| `*.exe` | Windows installer |
| `*.dmg` | macOS installer |
| `*.blockmap` | Differential update support |
