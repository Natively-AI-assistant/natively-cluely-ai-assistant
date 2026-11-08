// electron/audio/whisper/windowsVcRuntime.ts
//
// Windows only: is the Microsoft Visual C++ runtime that onnxruntime-node
// links against present?
//
// The prebuilt win32/x64 `onnxruntime_binding.node` and `onnxruntime.dll`
// import MSVCP140.dll, MSVCP140_1.dll, VCRUNTIME140.dll and VCRUNTIME140_1.dll
// (read from the binaries' import tables, 2026-10-14). Windows does not
// guarantee those on a PC that has never had the Visual C++ Redistributable
// installed, and when one is missing the loader fails the whole binding with
// "The specified module could not be found" — worded in the system language,
// naming the .node file rather than the DLL that is actually absent.
//
// The packaged app carries the four DLLs next to the binding
// (scripts/bundle-vc-runtime.cjs). This module is the runtime half: it tells a
// load failure caused by a missing runtime apart from every other load failure,
// so the user is told what to install instead of being shown a path.
//
// macOS has no equivalent — its counterpart is the libc++ symbol check that
// gates macOS 12 (see loadFailure.ts). This module answers "nothing missing"
// on every platform except win32.
//
// Pure module: platform, directories and the file probe are all injectable, so
// both the Windows and the non-Windows branch are tested without Windows.

import fs from 'fs';
import path from 'path';

/** The Visual C++ runtime DLLs the bundled onnxruntime-node binaries import. */
export const VC_RUNTIME_DLLS: readonly string[] = Object.freeze([
    'MSVCP140.dll',
    'MSVCP140_1.dll',
    'VCRUNTIME140.dll',
    'VCRUNTIME140_1.dll',
]);

/** Microsoft's permanent link to the current x64 Visual C++ Redistributable. */
export const VC_REDIST_DOWNLOAD_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';

export interface VcRuntimeProbe {
    platform?: NodeJS.Platform;
    /** %SystemRoot% — where an installed redistributable puts the DLLs. */
    systemRoot?: string | undefined;
    /** Extra directories the loader searches first (the binding's own folder). */
    extraDirs?: readonly string[];
    exists?: (file: string) => boolean;
}

/**
 * The runtime DLLs found in none of the places the Windows loader looks first
 * for a native module's dependencies: the module's own directory, then
 * System32. Empty on every non-Windows platform.
 */
export function listMissingVcRuntimeDlls(probe: VcRuntimeProbe = {}): string[] {
    const platform = probe.platform ?? process.platform;
    if (platform !== 'win32') return [];
    const exists = probe.exists ?? ((file: string) => {
        try { return fs.statSync(file).isFile(); } catch { return false; }
    });
    const systemRoot = probe.systemRoot ?? process.env.SystemRoot ?? process.env.windir;
    const dirs: string[] = [...(probe.extraDirs ?? [])];
    if (systemRoot) dirs.push(path.win32.join(systemRoot, 'System32'));
    // No directory to look in means no evidence either way — never claim a
    // runtime is missing on a guess.
    if (dirs.length === 0) return [];
    return VC_RUNTIME_DLLS.filter((dll) => !dirs.some((dir) => exists(path.win32.join(dir, dll))));
}

/**
 * The folder the packaged onnxruntime-node binding lives in, when it can be
 * resolved. Best-effort: a failure just means only System32 is probed.
 */
export function resolveOnnxBindingDir(): string | null {
    try {
        let pkgDir = path.dirname(require.resolve('onnxruntime-node/package.json'));
        // The binaries are asarUnpack'd, and the runtime DLLs are copied in
        // after packing, so they exist ONLY in the unpacked tree — the asar
        // index has never heard of them.
        if (pkgDir.includes('app.asar') && !pkgDir.includes('app.asar.unpacked')) {
            pkgDir = pkgDir.replace('app.asar', 'app.asar.unpacked');
        }
        return path.join(pkgDir, 'bin', 'napi-v6', process.platform, process.arch);
    } catch {
        return null;
    }
}
