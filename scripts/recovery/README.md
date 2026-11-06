# Local premium recovery

Run from the repository root:

```sh
node scripts/recovery/recover-premium.cjs /path/to/Natively-Recovered-Source
npm run build:electron
npm run typecheck:ts7
npm run typecheck:electron
npm run typecheck:premium
```

The importer reads the supplied recovery directory and writes only into this checkout's `premium/` directory. It extracts all 47 premium backend module bodies and eight missing renderer components from Natively 3.1.0. It preserves recovered JavaScript rather than inventing lost TypeScript types or replacing algorithms with mocks. Existing `premium/src/ModesSettings.tsx` is preserved.

Backend module boundaries come from the esbuild source markers and export tables. Imports reconnect to this checkout's shared services and installed packages, removing embedded copies of settings, credentials, database, document extraction and native loading. Renderer extraction follows lexical references across chunks, retaining the eight components and their dependency declarations, excluding application mounting. It uses the host React instance. Component entrypoints are `.tsx` re-exports; the original compiled implementations and images live under `premium/src/recovered/`.

`premium/RECOVERY.json` records each input's SHA-256 and output path. Run the importer again after changing extraction logic. It overwrites its generated outputs; it does not edit the recovered reference directory. Review generated files before rerunning if you edited them by hand. Runtime code contains no developer-specific source paths.

`premium/` is tracked as a regular directory in this repository so the recovered implementations are included in commits and fresh checkouts. Its former private submodule entry was removed; `natively-api` remains a separate submodule. The recovery script can regenerate the imported files from the same recovered source.

## Validation

```sh
node --test scripts/recovery/recovery.test.cjs
```

For original-versus-recovered comparisons, set `NATIVELY_RECOVERED_SOURCE` to the reference directory. For the SQLite/orchestrator round trip, run the same test in Electron's Node runtime (`ELECTRON_RUN_AS_NODE=1`); the installed SQLite binary targets Electron's ABI, not the system Node ABI. Use `cross-env` when setting environment variables from Windows shells.

Tests compare enums, license-verification decisions, skill normalization, JD normalization, role coverage and ontology functions against the recovered originals. They also bundle every backend module, check unresolved lexical names, check renderer dependencies and exports, and initialize/persist/delete profile data using an in-memory SQLite database. These cover selected deterministic behavior, not every AI generation path. `typecheck:premium` parses the recovered JavaScript; original strict TypeScript contracts cannot be recovered from compiled output.

## Platform and service boundaries

The recovered LicenseManager uses the existing shared native loader (macOS arm64/x64 and Windows x64/ia32/arm64 mappings) and Electron safeStorage. Document extraction uses the existing shared safe extractor. No native binaries, platform branches, installer targets or shared IPC contracts are replaced. Existing macOS ZIP/DMG and Windows NSIS/portable resource rules already include `dist-electron`; the build now emits premium `.js` entries as well as `.ts` entries.

The isolated macOS dev app initialized KnowledgeOrchestrator and attached Role Insight. Agent-browser over CDP confirmed the Role Insight panel renders and expands requirement details, both development license checks return true, the loader reports PREMIUM_ADS_AVAILABLE=true, and the Modes Manager lists all nine built-ins and activates Lecture through the UI. The test app was shut down through its launcher API. Windows execution, installers/signing, live provider generation, paid subscription verification and every UI state still need separate validation. A provider key is required for live AI generation; the development entitlement flag does not provide a remote API subscription.
