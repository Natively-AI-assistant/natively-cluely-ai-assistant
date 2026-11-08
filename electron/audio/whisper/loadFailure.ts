// electron/audio/whisper/loadFailure.ts
//
// Why did a local speech model fail to load, and what should the user be told?
//
// Every worker init failure arrives as one string prefixed "Failed to load
// model: ". That prefix used to be treated as proof the files were damaged,
// which did two wrong things at once: it DELETED a good 1 GB download because
// the machine was out of memory, behind a proxy, or missing a runtime DLL, and
// it told the user "model not found, please download" — sending them back to a
// download that could only fail the same way.
//
// This module sorts the failure by its actual cause. Only one kind
// ('corrupt-files') is ever a reason to delete anything.
//
// Platform handling is explicit and injectable: the macOS 12 symbol failure is
// only reported on darwin, the missing Visual C++ runtime only on win32, and a
// machine is never shown the other platform's remedy.
//
// Pure module: no electron imports, safe in a worker and under plain node.

import { VC_REDIST_DOWNLOAD_URL } from './windowsVcRuntime';
import { ONNX_MAC_UNSUPPORTED_MESSAGE } from './onnxMacSupport';

export type LocalModelLoadFailureKind =
    | 'unsupported-macos'        // libonnxruntime needs libc++ symbols macOS 12 lacks
    | 'missing-windows-runtime'  // Visual C++ runtime DLLs absent
    | 'out-of-memory'
    | 'download-failed'          // network, proxy, HTTP status, short read
    | 'corrupt-files'            // the bytes on disk are not a usable model
    | 'unknown';

export interface LoadFailureContext {
    platform?: NodeJS.Platform;
    /**
     * Result of listMissingVcRuntimeDlls() on this machine. When supplied and
     * empty, a binding load error is NOT blamed on the Visual C++ runtime.
     * Omitted = not probed; the error text alone decides.
     */
    missingWindowsRuntimeDlls?: readonly string[];
    /**
     * Set by the download path: installing again there fetches a fresh copy of
     * damaged files (LocalModelDownloadService marks the failure), so the
     * message points at installing, not at a Delete button the failed row
     * does not have.
     */
    reinstallReplacesDamaged?: boolean;
}

const WORKER_PREFIX = /^\s*failed to load model:\s*/i;

/** The underlying reason, without the worker's own "Failed to load model:" prefix. */
export function loadFailureCause(message: string): string {
    return String(message ?? '').replace(WORKER_PREFIX, '').trim();
}

export function classifyLocalModelLoadFailure(
    message: string,
    ctx: LoadFailureContext = {},
): LocalModelLoadFailureKind {
    const platform = ctx.platform ?? process.platform;
    const cause = loadFailureCause(message);
    const m = cause.toLowerCase();

    // macOS 12 and earlier: the dylib itself cannot be loaded. An environment
    // failure — every model fails the same way, and the files are fine.
    if (platform === 'darwin'
        && (m.includes('symbol not found') || m.includes('to_chars') || m.includes('libonnxruntime'))) {
        return 'unsupported-macos';
    }

    // Windows: the binding could not be loaded at all. The loader's sentence is
    // in the system language, so the reliable signal is the binding's own file
    // name in the error (Node appends the path it tried to open). When the
    // machine was probed and nothing is missing, it is some other failure.
    if (platform === 'win32' && m.includes('onnxruntime_binding')) {
        if (!ctx.missingWindowsRuntimeDlls || ctx.missingWindowsRuntimeDlls.length > 0) {
            return 'missing-windows-runtime';
        }
    }

    if (/bad[ _]alloc|out of memory|failed to allocate|allocation failed|not enough memory|err_worker_out_of_memory/.test(m)) {
        return 'out-of-memory';
    }

    // Checked BEFORE the corrupt-file markers: a short read is reported by the
    // downloader after it has already removed its own partial file, so the
    // rest of the model on disk is intact and must not be thrown away.
    if (/fetch failed|failed to download|truncated|http \d{3}|could not locate file|unable to connect|enotfound|econnreset|econnrefused|etimedout|eai_again|socket hang up|network/.test(m)) {
        return 'download-failed';
    }

    // The bytes are present and unreadable. ORT reports a truncated .onnx as a
    // protobuf failure (it walks the file and hits EOF mid-message); a
    // truncated tokenizer/config as a JSON error; a missing or short external
    // weight file as a file-system or bounds error.
    if (m.includes('protobuf parsing failed')
        || m.includes('invalid model')
        || m.includes('modelproto')
        || m.includes('no such file or directory')
        || m.includes('unexpected end of json input')
        || m.includes('is not valid json')
        || (m.includes('external') && m.includes('out of bounds'))) {
        return 'corrupt-files';
    }

    // macOS only: the Parakeet Neural Engine helper (parakeet/aneBackend.ts)
    // could not parse the vocabulary file it was given — FluidAudio's reading
    // of one JSON file on disk, nothing else. CoreML's own load errors ("failed
    // to build the model execution plan", "compile the model with Xcode") are
    // NOT matched: CoreML also raises them when the Neural Engine compiler
    // fails on intact files, and deleting those would only re-download the same
    // bytes. Damaged CoreML bundles are caught before any load instead, by
    // their exact pinned sizes (isParakeetCoreMlCached), and fetched again.
    if (platform === 'darwin' && m.includes('vocabulary parsing failed')) {
        return 'corrupt-files';
    }

    return 'unknown';
}

/**
 * True only when the model's own files are the problem, so deleting them and
 * fetching them again can fix it. Everything else — memory, network, a missing
 * runtime, an unsupported OS — leaves the download alone.
 */
export function isCorruptModelFailure(message: string, ctx: LoadFailureContext = {}): boolean {
    return classifyLocalModelLoadFailure(message, ctx) === 'corrupt-files';
}

/** First line of the cause, trimmed to something a notice can carry. */
function shortCause(message: string): string {
    const first = loadFailureCause(message).split(/\r?\n/)[0].trim();
    return first.length > 180 ? `${first.slice(0, 177)}...` : first;
}

/**
 * The sentence shown to the user. `purged` says whether the damaged files were
 * actually removed (it can fail on Windows while a file is still open).
 */
export function describeLocalModelLoadFailure(
    message: string,
    ctx: LoadFailureContext & { purged?: boolean } = {},
): string {
    switch (classifyLocalModelLoadFailure(message, ctx)) {
        case 'unsupported-macos':
            return ONNX_MAC_UNSUPPORTED_MESSAGE;
        case 'missing-windows-runtime':
            return 'Local speech models need the Microsoft Visual C++ runtime, and this PC does not have it. '
                + `Install the "Microsoft Visual C++ Redistributable (x64)" from ${VC_REDIST_DOWNLOAD_URL}, restart Natively, and try again. `
                + 'Until then, choose a cloud STT provider.';
        case 'out-of-memory':
            return 'The local model could not be loaded because this computer ran out of memory. '
                + 'Close other apps, choose a smaller local model in Settings → Audio, or use a cloud STT provider.';
        case 'download-failed':
            return 'The local model could not be downloaded. Check the internet connection, then install it again in Settings → Audio. '
                + `(${shortCause(message)})`;
        case 'corrupt-files':
            if (ctx.reinstallReplacesDamaged) {
                return 'The downloaded model files are damaged. Install the model again in Settings → Audio to download a fresh copy.';
            }
            return ctx.purged
                ? 'The local model files were incomplete and have been removed. Please reinstall the model in Settings → Audio.'
                : 'The local model files are damaged. Delete the model in Settings → Audio, then install it again.';
        default:
            return 'The local model could not be loaded. Reinstall it in Settings → Audio, choose another local model, or use a cloud STT provider. '
                + `(${shortCause(message)})`;
    }
}
