/**
 * What a model row says when a catalogue download, a file check or a repair
 * does not finish.
 *
 * The installers and the downloader report failures as developer text: "HTTP
 * 404 fetching https://...", "weights.gguf is the wrong size: expected N bytes,
 * got M", "ENOSPC: no space left on device, write", a pair of sha256 digests.
 * That text used to go to the row as it was. It stays in the log (ipcHandlers
 * writes it); the row gets a sentence that names the cause and what to do, and
 * no file names, addresses, digests or error codes.
 *
 * A cancelled transfer is not a failure and has no sentence: the user did it.
 *
 * Nothing here is OS-specific. "In use" is what Windows reports when a running
 * model still has the file open; macOS replaces an open file without
 * complaint, so that sentence is simply never reached there.
 */

export type ModelTransferFailureKind =
  | 'cancelled'
  | 'not-installed'
  | 'in-use'
  | 'no-space'
  | 'not-intact'
  | 'settings-not-written'
  | 'other';

export function classifyModelTransferFailure(raw: unknown): ModelTransferFailureKind {
  const reason = String(raw ?? '');
  if (/\bcancell?ed\b/i.test(reason)) return 'cancelled';
  if (/is not fully downloaded/i.test(reason)) return 'not-installed';
  if (/the existing file is in use|\bEBUSY\b/.test(reason)) return 'in-use';
  if (/\bENOSPC\b|no space left/i.test(reason)) return 'no-space';
  if (/is the wrong size|failed verification/i.test(reason)) return 'not-intact';
  // localModelInstaller's applyConfigPatch: the files arrived, the rewrite did
  // not. Its own two sentences only: a config.json in an address or a path is
  // an ordinary transfer failure.
  if (/^config\.json for |needs its config\.json adjusted/.test(reason)) return 'settings-not-written';
  return 'other';
}

/**
 * - 'download': the row's Download button.
 * - 'repair':   a check found damage and fetching it again did not finish.
 * - 'check':    the check itself could not run, so nothing is known about the files.
 */
export type ModelTransferAction = 'download' | 'repair' | 'check';

export function describeModelTransferFailure(
  modelName: string,
  raw: unknown,
  action: ModelTransferAction,
): { kind: ModelTransferFailureKind; message: string | null } {
  const kind = classifyModelTransferFailure(raw);
  if (kind === 'cancelled') return { kind, message: null };

  if (action === 'check') {
    return { kind, message: `${modelName}'s files could not be checked. Try again in a moment.` };
  }

  if (action === 'repair') {
    switch (kind) {
      case 'not-installed':
        return { kind, message: `${modelName} is not fully downloaded. Download it first.` };
      case 'in-use':
        return { kind, message: `Some of ${modelName}'s files are damaged and could not be replaced while the model is in use. Choose another model, then check its files again.` };
      case 'no-space':
        return { kind, message: `Some of ${modelName}'s files are damaged, and there is not enough free disk space to download them again.` };
      default:
        return { kind, message: `Some of ${modelName}'s files are damaged, and downloading them again did not work. Check your connection and try again.` };
    }
  }

  switch (kind) {
    case 'in-use':
      return { kind, message: `${modelName}'s files could not be replaced because the model is in use. Choose another model first, then download it again.` };
    case 'no-space':
      return { kind, message: `There is not enough free disk space to download ${modelName}.` };
    case 'not-intact':
      return { kind, message: `${modelName} did not arrive intact. Try the download again.` };
    case 'settings-not-written':
      return { kind, message: `${modelName} was downloaded, but the settings it needs could not be written. Download it again.` };
    default:
      return { kind, message: `${modelName} could not be downloaded. Check your connection and try again.` };
  }
}
