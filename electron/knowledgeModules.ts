// electron/knowledgeModules.ts
//
// Resolver for the knowledge modules, with premium taking precedence.
//
// The free tree loads profile intelligence from the private `premium/`
// submodule (electron/main.ts:1288-1295 and ~15 `require(...knowledge/types)`
// sites in electron/ipcHandlers.ts). That submodule is absent from this
// checkout (.gitignore:41-42), so every one of those requires throws and the
// features silently disable themselves.
//
// This module keeps that exact precedence and adds a local fallback: premium
// first, local implementation only when premium is unavailable. If the private
// module is ever installed it wins again automatically, with no code change.
// Nothing here disables, replaces, or emulates a license check — the
// LicenseManager requires in ipcHandlers.ts are deliberately NOT routed through
// this resolver.
//
// BUILD NOTE: scripts/build-electron.js runs esbuild with `bundle: true`, which
// resolves literal `require()` specifiers at BUILD time. Empirically that splits
// two ways when premium/ is missing: a require wrapped in try/catch (as at
// electron/main.ts:1288-1295 and the DocType sites in ipcHandlers.ts) is left as
// a runtime call and the build succeeds, while an UNGUARDED one hard-fails the
// whole build — which is what electron/services/resolveCompanySearchProvider.ts
// did until it was routed through here.
//
// The paths below are assembled at runtime so esbuild cannot statically analyse
// them at all, making the outcome the same either way. The emitted runtime
// require resolves against dist-electron, where premium/electron/** is built
// alongside electron/** by the same script (scripts/build-electron.js:39-43) —
// the same resolution the existing call sites rely on today.

import type { DocType as LocalDocTypeEnum } from './localKnowledge/types';

/** Shape of the `types` module, whichever implementation provides it. */
export interface KnowledgeTypesModule {
  DocType: typeof LocalDocTypeEnum;
}

type UnknownModule = Record<string, unknown>;

const moduleCache = new Map<string, UnknownModule | null>();

/** Assembled at runtime so esbuild treats it as an opaque dynamic require. */
function requireDynamic(segments: string[]): UnknownModule {
  const specifier = segments.join('/');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require(specifier) as UnknownModule;
}

/**
 * Load a knowledge module by its path below the knowledge root, e.g. 'types'
 * or 'roleInsight/JdSourceResolver'. Premium wins; local is the fallback;
 * null means neither is present, which callers must treat exactly like the
 * pre-existing catch path (feature disabled, not an error).
 */
export function loadKnowledgeModule(name: string): UnknownModule | null {
  const cached = moduleCache.get(name);
  if (cached !== undefined) return cached;

  let resolved: UnknownModule | null = null;
  try {
    resolved = requireDynamic(['..', 'premium', 'electron', 'knowledge', ...name.split('/')]);
  } catch {
    try {
      resolved = requireDynamic(['.', 'localKnowledge', ...name.split('/')]);
    } catch {
      resolved = null;
    }
  }

  moduleCache.set(name, resolved);
  return resolved;
}

/** True when the resolved knowledge implementation came from the premium submodule. */
export function isPremiumKnowledgeInstalled(): boolean {
  try {
    requireDynamic(['..', 'premium', 'electron', 'knowledge', 'types']);
    return true;
  } catch {
    return false;
  }
}

/**
 * The `types` module. Never null in practice — the local implementation always
 * provides it — so call sites that only needed DocType lose their null check.
 */
export function loadKnowledgeTypes(): KnowledgeTypesModule {
  const mod = loadKnowledgeModule('types');
  if (mod && typeof (mod as unknown as KnowledgeTypesModule).DocType === 'object') {
    return mod as unknown as KnowledgeTypesModule;
  }
  // Static fallback: guarantees DocType exists even if both dynamic requires
  // fail (e.g. an unexpected packaging layout). Inlined by esbuild.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./localKnowledge/types') as KnowledgeTypesModule;
}

/** Reset the resolver cache. Test-only; mirrors resetFeatureGate() in electron/premium/featureGate.ts. */
export function resetKnowledgeModuleCache(): void {
  moduleCache.clear();
}
