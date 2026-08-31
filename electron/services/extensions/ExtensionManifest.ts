/**
 * `extension.json` schema and validation.
 *
 * Validation NEVER throws and never returns a partially-trusted object: it
 * returns a discriminated result, and every caller must branch on `.ok`. A
 * manifest is attacker-influenced input — it arrives from a downloaded repo —
 * so nothing downstream may read a field that has not been through here.
 */

import { z } from 'zod';
import {
  EXTENSION_API_VERSION,
  EXTENSION_PERMISSIONS,
  EXTENSION_TYPES,
  type ExtensionPermission,
} from './types';
import { isSafeExtensionId } from './paths';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const semver = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'must be a semver version (x.y.z)');

/**
 * A model's licence terms, as declared by the extension author.
 *
 * Core does not interpret `spdx` beyond recording it. The load-bearing field is
 * `requiresAcknowledgement`: when true, `ModelStore` refuses to load the model
 * until `LicenseLedger` holds a matching entry. Core never redistributes
 * weights, so `redistributable` is recorded and surfaced to the user rather
 * than acted on.
 */
const modelLicenseSchema = z.object({
  spdx: z.string().min(1),
  url: z.string().url(),
  redistributable: z.boolean(),
  commercialUseRestricted: z.boolean(),
  requiresAcknowledgement: z.boolean(),
});

const modelSchema = z.object({
  key: z.string().min(1).max(128),
  format: z.enum(['gguf', 'onnx', 'safetensors']),
  source: z.enum(['huggingface', 'url', 'local']),
  /**
   * Nullable on purpose. The extension-repo setup step resolves the real
   * Hugging Face repo id and HEADs the resolve URL; if it cannot confirm one it
   * writes `null` and fails loudly at setup, rather than shipping a guess that
   * 404s on the user's first download.
   */
  repo: z.string().min(1).nullable(),
  /**
   * Local filename inside the extension's model directory. Always a bare
   * filename — `ModelStore.resolve` refuses anything with a separator, so a
   * manifest cannot place a file outside its own directory.
   */
  file: z.string().min(1),
  /**
   * Path to the file WITHIN the source repository, when it differs from the
   * local filename. Hugging Face repos routinely nest weights (`onnx/model.onnx`),
   * so the source path and the local name are genuinely two different things.
   * Defaults to `file`. Never used to build a local path.
   */
  repoPath: z.string().min(1).optional(),
  approxBytes: z.number().int().positive(),
  /** Recorded on first verified download when not known ahead of time. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
  license: modelLicenseSchema,
});

const permissionSchema = z.enum(EXTENSION_PERMISSIONS);

export const extensionManifestSchema = z.object({
  id: z.string().refine(isSafeExtensionId, {
    message:
      'id must be 1-64 chars of lowercase alphanumerics, "-" or "."; start and end alphanumeric',
  }),
  name: z.string().min(1).max(128),
  version: semver,
  apiVersion: z.string().min(1),
  type: z.enum(EXTENSION_TYPES),
  entrypoint: z.string().min(1),
  author: z.string().min(1).max(128),
  homepage: z.string().url(),
  engines: z.object({ natively: z.string().min(1) }),
  permissions: z.array(permissionSchema),
  models: z.array(modelSchema).default([]),
  /**
   * Required, and required to be non-empty, when `network.remote` is granted.
   * Enforced in `validateManifest` rather than the schema so the error names
   * the permission that made it mandatory.
   */
  allowedHosts: z.array(z.string().min(1)).optional(),
  /** Required, and required to be non-empty, when `process.spawn` is granted. */
  allowedBinaries: z.array(z.string().min(1)).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;
export type ExtensionModel = z.infer<typeof modelSchema>;
export type ExtensionModelLicense = z.infer<typeof modelLicenseSchema>;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ManifestValidation =
  | { ok: true; manifest: ExtensionManifest; warnings: string[] }
  | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Version compatibility
// ---------------------------------------------------------------------------

function parseSemver(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Supports exactly `*` and `>=x.y.z`, which is all the manifests need today.
 * An unrecognised range is REJECTED, not treated as satisfied — a range this
 * build cannot parse is a range it cannot honour.
 */
export function satisfiesEngineRange(range: string, appVersion: string): boolean {
  const trimmed = range.trim();
  if (trimmed === '*') return true;

  const app = parseSemver(appVersion);
  if (!app) return false;

  const m = /^>=\s*(\d+\.\d+\.\d+)$/.exec(trimmed);
  if (!m) return false;

  const min = parseSemver(m[1]);
  if (!min) return false;
  return compareSemver(app, min) >= 0;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidateManifestOptions {
  /** Running app version, checked against `engines.natively`. */
  appVersion: string;
  /** Defaults to this build's `EXTENSION_API_VERSION`. */
  apiVersion?: string;
}

/**
 * Parse and check a manifest. Returns `{ok:false, errors}` for anything wrong;
 * never throws, never returns a manifest that failed a check.
 */
export function validateManifest(
  input: unknown,
  options: ValidateManifestOptions,
): ManifestValidation {
  const parsed = extensionManifestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: formatZodError(parsed.error) };
  }

  const manifest = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];

  const expectedApi = options.apiVersion ?? EXTENSION_API_VERSION;
  if (manifest.apiVersion !== expectedApi) {
    errors.push(
      `apiVersion "${manifest.apiVersion}" is not supported by this build (expected "${expectedApi}")`,
    );
  }

  if (!satisfiesEngineRange(manifest.engines.natively, options.appVersion)) {
    errors.push(
      `engines.natively "${manifest.engines.natively}" is not satisfied by Natively ${options.appVersion}`,
    );
  }

  // A duplicate permission is not dangerous, but it usually means a hand-edited
  // manifest, and it makes the install prompt lie about what is being granted.
  const seen = new Set<ExtensionPermission>();
  for (const p of manifest.permissions) {
    if (seen.has(p)) errors.push(`duplicate permission "${p}"`);
    seen.add(p);
  }

  if (seen.has('network.remote') && !(manifest.allowedHosts?.length)) {
    errors.push('permission "network.remote" requires a non-empty "allowedHosts" list');
  }
  if (!seen.has('network.remote') && manifest.allowedHosts?.length) {
    warnings.push('"allowedHosts" is declared but "network.remote" was not requested; it will be ignored');
  }

  if (seen.has('process.spawn') && !(manifest.allowedBinaries?.length)) {
    errors.push('permission "process.spawn" requires a non-empty "allowedBinaries" list');
  }
  if (!seen.has('process.spawn') && manifest.allowedBinaries?.length) {
    warnings.push('"allowedBinaries" is declared but "process.spawn" was not requested; it will be ignored');
  }

  const modelKeys = new Set<string>();
  for (const model of manifest.models) {
    if (model.repoPath !== undefined) {
      const bad = model.repoPath.startsWith('/')
        || model.repoPath.includes('..')
        || model.repoPath.includes('\\')
        || /^[a-z][a-z0-9+.-]*:/i.test(model.repoPath);
      if (bad) {
        errors.push(
          `model "${model.key}" has an unsafe repoPath ${JSON.stringify(model.repoPath)}; ` +
          'it must be a relative, forward-slash path inside the source repository',
        );
      }
    }

    if (modelKeys.has(model.key)) errors.push(`duplicate model key "${model.key}"`);
    modelKeys.add(model.key);

    if (model.source === 'huggingface' && model.repo === null) {
      warnings.push(
        `model "${model.key}" has no resolved repo id; it cannot be downloaded until one is supplied`,
      );
    }
    if (manifest.models.length > 0 && !seen.has('filesystem.models')) {
      errors.push(
        `model "${model.key}" is declared but permission "filesystem.models" was not requested`,
      );
      break;
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, manifest, warnings };
}

function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const at = issue.path.length ? ` at ${issue.path.join('.')}` : '';
    return `${issue.message}${at}`;
  });
}
