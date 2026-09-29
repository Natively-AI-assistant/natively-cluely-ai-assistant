# Classifier flush and local model verification, 2026-09-06

Question asked: are the reranker and the embedding model used in both the development build (`npm start`) and the production build, and is the intent classifier gone together with the models it needed. This records what was found, what was fixed, and how each claim was tested.

## The classifier was not fully flushed

The code left on 2026-09-05. Three things it depended on had stayed behind.

`package.json` still listed `Xenova/mobilebert-uncased-mnli/**` in the `extraResources` filter for `resources/models/`. That filter is shared by the macOS, Windows NSIS and Windows portable targets. With the 121 MB model directory still in the repository (three tracked JSON files, two ignored ONNX weights), every production build kept shipping a model nothing opened. The stowaway test did not catch it because its negative list named only `bge-reranker-large`.

This machine's userData cache still held a 94 MB copy under `whisper-models/Xenova/mobilebert-uncased-mnli`. Every machine that ever warmed the classifier carries the same copy, and nothing removed it.

Twenty comments across fifteen files still described the classifier as present, including the header of the macOS install script and both release workflows.

### Fixed

The filter line is removed. The model directory is deleted from the repository and from disk. The stowaway test now pins both MobileBERT files as must-not-ship. `purgeObsoleteModelCaches()` in `electron/audio/whisper/modelManager.ts` removes retired cache ids on every launch, wired into the local-fallback preflight timer in `main.ts` ahead of the preflight so it can never report a retired model. The list holds exact ids only, so it can never touch a Whisper or Nemotron download. Four tests cover removal, sibling safety, idempotence and the startup wiring. The comments are rewritten in the past tense. A dead `INTENT_PATH` constant left a test file.

What remains by design: `onnx-reset-family` still accepts `'intent'` and returns success as a no-op, because the renderer's retry surface predates the removal. History notes that say the classifier was removed stay.

## Which embedder and reranker actually run

The two local models are not the primary path. They are the on-device floor under a cloud chain, and whether they run depends on the user's settings and keys.

Embeddings resolve through `EmbeddingProviderResolver.buildCandidates`. The order is Natively API first when a key exists, then a custom endpoint, Voyage, OpenAI, Gemini, OpenRouter and Ollama. `LocalEmbeddingProvider` (`Xenova/all-MiniLM-L6-v2`, 384 dimensions) is the terminal fallback and is never probed. It runs when no cloud provider is configured or reachable, or when the provider data scope denies cloud embeddings.

Reranking is gated by `ragLocalRerank`, default on. `RerankerRegistry.resolvePort` picks a hosted reranker (OpenRouter or Jina) when the user selected one, then an enabled reranker extension, and otherwise the built-in `LocalReranker`, whose default is the bundled `Xenova/ms-marco-MiniLM-L-6-v2`. A hosted failure falls through to the local model when `fallbackToLocal` is set.

On this machine the settings select Voyage `voyage-4` for embeddings and OpenRouter `voyageai/rerank-2.5-lite` for reranking with local fallback on. The database agrees: 798 reference chunks carry `gemini:gemini-embedding-2:768`, 78 rows carry `voyage:voyage-4:2048`, none carry the local space. The debug log from today's `npm start` session at 17:52 UTC shows `[EmbeddingProviderResolver] Selected provider: voyage (2048d)`, `[EmbeddingPipeline] Local fallback provider registered for lazy load (384d)` and `[ProviderStatus] local-reranker ready Packaged ms-marco-MiniLM-L-6-v2 is ready for offline smart-retrieval`. It contains no classifier line.

So the truthful answer is: both local models are loaded and ready in the development build, the reranker as the fallback behind OpenRouter and the embedder as the floor behind Voyage. Neither is the model doing the work on this machine, because this machine chose cloud providers. A fresh install with no keys runs both locally.

## Production build, physically

An arm64 unpacked build was produced from this tree with `vite build`, `build:electron`, `build:native`, the three `ensure-*` scripts and `package-app.js --dir --arm64`. The `.app` ships exactly `Xenova/all-MiniLM-L6-v2`, `Xenova/ms-marco-MiniLM-L-6-v2` and `pipecat-ai/smart-turn-v3` under `Contents/Resources/models` (152 MB). No file in the bundle matches `mobilebert` or `intentClassifier`. `verify-packaged-local-assets.mjs --app` passes.

The packaged code was then exercised through the packaged binary: `ELECTRON_RUN_AS_NODE=1 Natively.app/Contents/MacOS/Natively probe.cjs`, which makes `process.resourcesPath` the `.app`'s own Resources and loads `LocalReranker` and `LocalEmbeddingProvider` from inside `app.asar`. Only `electron` itself is stubbed, with `app.isPackaged` true. With `HOME` pointed at an empty directory so no user-installed copy can shadow the bundle, both models resolved to `Natively.app/Contents/Resources/models`, the reranker scored three passages in 124 ms (the relevant passage first at 1.695, the two others below minus ten) and the embedder returned a 384-wide vector in 92 ms. Both workers spawn from `app.asar.unpacked`.

With the real `HOME`, the reranker resolved to `~/Library/Application Support/natively/local-models` instead. That is the documented precedence: a user-installed catalogue copy outranks the bundled one.

The packaged launch smoke (`smoke-packaged-local-fallback.mjs`) could not complete here. The ad-hoc signed build stalls at `credentials-init:start`, which is `CredentialsManager.init()` reaching the keychain from a binary the keychain has never seen. That is a signing and keychain limitation of a local unsigned build, unrelated to models, and CI does not run that smoke either.

## Validation

`Tested physically on macOS`: the arm64 packaged bundle, its models and both workers, through the packaged binary. `Covered by automated macOS branch tests`: the wide suite at 9804 tests with 24 failures, all of them main's pre-existing Antigravity stub failures in the four `*2026_08_01` files, plus 28 real-model and packaged-layout tests and the 4 new sweep tests. `Build validated on macOS`: arm64 `--dir`. `Reviewed but not executed on Windows`: the shared `extraResources` filter and the sweep, which uses `path.join` and `fs.rmSync` with `force` and logs rather than throws on a held handle. `Requires physical Windows verification`: the NSIS and portable packages no longer carrying the model, and the sweep on an NTFS cache.
