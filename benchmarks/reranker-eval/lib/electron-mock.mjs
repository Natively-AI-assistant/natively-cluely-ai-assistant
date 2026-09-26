// benchmarks/reranker-eval/lib/electron-mock.mjs
//
// electron/rag/providers/LocalEmbeddingProvider.ts's constructor reads
// `app.isPackaged` unguarded (no optional chaining). Outside the real
// Electron main-process lifecycle (plain `node`, or `electron --test` under
// ELECTRON_RUN_AS_NODE=1), `require('electron')` does not provide a real
// `app` object, so that access throws
// "Cannot read properties of undefined (reading 'isPackaged')" — confirmed
// by direct testing in this repo. electron/rag/LocalReranker.ts's
// equivalent code uses optional chaining and doesn't need this, but the
// mock is harmless there too. This mirrors the exact pattern already used in
// electron/rag/__tests__/LocalEmbeddingProviderRealModel.test.mjs.
import Module from 'node:module';

let installed = false;

export function installElectronMock(repoRoot) {
  if (installed) return;
  installed = true;
  const origLoad = Module._load;
  Module._load = function patched(request, parentModule, isMain) {
    if (request === 'electron') {
      return {
        app: {
          isPackaged: false,
          getAppPath: () => repoRoot,
          getPath: () => repoRoot,
        },
      };
    }
    return origLoad.apply(this, arguments);
  };
}
