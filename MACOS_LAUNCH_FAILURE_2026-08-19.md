# 2.8.6 macOS build: signed + notarized correctly, but the app cannot launch

**Status:** root cause CONFIRMED by A/B experiment. Not a signing, certificate, or Apple-account problem.
**Do NOT ship `release/Natively-2.8.6*.dmg` / `*.zip` — every one of them is unlaunchable.**

## Symptom

`open -a /Applications/Natively.app` →

```
Error Domain=RBSRequestErrorDomain Code=5 "Launch failed."
NSUnderlyingError=... NSPOSIXErrorDomain Code=163 "Launchd job spawn failed"
```

No crash report is written, because the process is killed by the kernel before dyld runs.

## Root cause

`build/entitlements.mac.plist` declares `keychain-access-groups`
(`BJM29W3UQ6.com.electron.meeting-notes`), added 2026-08-16 in `0a1fd18e`
("fix(macos): declare the keychain access group, and make it field-verifiable").

`keychain-access-groups` is a **restricted (profile-requiring) entitlement**. It is only
honoured when the signed bundle embeds a matching provisioning profile. This build signs with
`provisioningProfile=none`, so AMFI rejects the binary at exec:

```
amfid: /Applications/Natively.app/Contents/MacOS/Natively not valid:
  AppleMobileFileIntegrityError Code=-413 "No matching profile found"
kernel AMFI: Code has restricted entitlements, but the validation of its code
  signature failed.  Unsatisfied Entitlements:
kernel: proc NNNN: load code signature error 4 for file "Natively"
kernel (AppleSystemPolicy): Security policy would not allow process
```

Apple did not change anything. The entitlement has always required a profile; 2.8.6 is simply
the first *signed* build that carries it. 2.8.5 and earlier shipped without it and launched fine.

## Proof (A/B, same cert, same machine, one variable)

Two copies of an identical trivial C binary, signed with the same Developer ID identity,
hardened runtime, timestamped; entitlements differ only by `keychain-access-groups`:

| binary | entitlements | result |
|---|---|---|
| `hello_a` | jit + disable-library-validation + **keychain-access-groups** | SIGKILL, exit 137 |
| `hello_b` | jit + disable-library-validation | prints `HELLO_OK`, exit 0 |

## What is NOT wrong (all verified)

* Developer ID cert `9F5304EA...` valid 2026-05-29 → 2031-05-30; `security verify-cert` passes.
* Both DMGs: `spctl -a -t open` → `accepted / source=Notarized Developer ID`; stapled; `hdiutil verify` OK.
* Installed bundle: `codesign --verify --deep --strict` OK, `stapler validate` OK,
  `spctl -a -t exec` → `accepted`, arm64, no quarantine xattr, 2.3 GB and complete.
* `latest-mac.yml` sha512 values match both ZIPs byte-for-byte (the `[dmg-notarize] WARNING:
  ... not found in any latest*.yml` line is expected — mac updates use the ZIPs, not the DMGs).
* The earlier 05:42 `2.8.5` crash reports (`Library not loaded: @rpath/Electron Framework...`)
  are a separate, older partial-copy install — unrelated to this failure.

## Fix options

### A. Drop the entitlement (no Apple portal work)
Remove `keychain-access-groups` from `build/entitlements.mac.plist`; update
`electron/services/__tests__/KeychainEntitlement.test.mjs`,
`electron/services/__tests__/Issue322KeychainPersistence.test.mjs`, and
`keychainGroupEntitled` in `electron-builder.signed.cjs`. Rebuild.

Cannot regress any shipped behaviour: the entitlement has never been in a launchable build, so
removing it leaves issue #322 exactly as (un)fixed as it was in 2.8.5. The #322 recovery path
(3 failed cold starts → `needsCredentialReentry`) stays in place and is untouched. This does NOT
resolve #322 — it restores the status quo ante and defers the fix to the profile route below.

### B. Embed a Developer ID provisioning profile (keeps the entitlement)
Requires an App ID for `com.electron.meeting-notes` with **Keychain Sharing** enabled, then a
**Developer ID** provisioning profile, saved as `build/embedded.provisionprofile` and wired up via
`mac.provisioningProfile` in `electron-builder.signed.cjs`.

UNVERIFIED: no provisioning profile exists on this machine (neither `~/Library/MobileDevice/
Provisioning Profiles/` nor the Xcode path exists at all), and whether the App ID
`com.electron.meeting-notes` is registered in the developer portal has not been checked — it is an
Electron template default, so it may need creating from scratch, which is a larger job than
downloading a profile.

Known risk: electron/electron#47341 reports that embedding a provisioning profile in a
Developer ID Electron app can make macOS prompt for **login-keychain access on every launch**
(arm64, closed "not planned"). Would need verification on a signed build before shipping.

## Commands actually run

`spctl -a -t open|exec`, `codesign -dv --verbose=2`, `codesign --verify --deep --strict`,
`xcrun stapler validate`, `security find-identity/find-certificate/verify-cert`,
`hdiutil verify/imageinfo`, `shasum -a 512`, `open -a`,
`/usr/bin/log show --predicate 'eventMessage CONTAINS "Natively"' --info --debug`,
`codesign --force --sign ... --entitlements <A|B>` on the minimal A/B binaries.

## Fix applied (Option A) and verified

* `build/entitlements.mac.plist` — `keychain-access-groups` removed; a comment records why it
  cannot come back without an embedded provisioning profile.
* `electron-builder.signed.cjs` — `keychainGroupEntitled` extraMetadata dropped (it existed only
  to advertise the entitlement). `nativelySigned` is untouched.
* `electron/services/__tests__/KeychainEntitlement.test.mjs` — inverted: it now pins the
  entitlement's ABSENCE and asserts `mac.provisioningProfile` stays unset, so the two can only
  move together.
* `Issue322KeychainPersistence.test.mjs` — unchanged, still 10/10 green.

**TRAP hit while fixing this — worth knowing.** AMFI parses the entitlements XML with a stricter
parser than `plutil`. A `--` sequence inside an XML comment is illegal XML; `plutil -lint` accepts
it, but `codesign` fails with `Failed to parse entitlements: AMFIUnserializeXML: syntax error near
line N` **and silently leaves the previous signature in place**. The first version of the new
comment contained a `codesign` flag list and did exactly this. Two new tests now guard it, and both
were mutation-probed (reintroducing each defect turns them red).

### Verification performed

| check | result |
|---|---|
| trivial binary signed with the NEW `entitlements.mac.plist` | runs, exit 0 |
| trivial binary signed with `entitlements.mac.inherit.plist` | runs, exit 0 |
| **the real 2.8.6 `Natively.app`, re-signed with the new entitlements** | **launches — main process + 9 helpers, no crash report** |
| `KeychainEntitlement.test.mjs` | 6/6 pass, both new guards mutation-probed red |
| `Issue322KeychainPersistence.test.mjs` | 10/10 pass |

`Tested physically on macOS` (Apple M4, macOS 26.4.1). `Reviewed but not executed on Windows` —
the changed files are macOS-signing-only; Windows packaging and signing are untouched.

**Still required:** a full `npm run dist:signed` rebuild. The artifacts currently in `release/`
were all built with the broken entitlement and must not be shipped.

## Unrelated observation (noted, not investigated)

`Contents/Resources/app.asar` is **1.275 GB**. That is abnormally large for an Electron bundle and
is why the DMGs are ~950 MB. It has nothing to do with this launch failure.

## Cross-platform note

`build/entitlements.mac.plist` is macOS-only; Windows packaging and signing are untouched by
either fix. `Reviewed but not executed on Windows`.
