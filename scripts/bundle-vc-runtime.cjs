/**
 * electron-builder afterPack step, Windows targets only: put the Microsoft
 * Visual C++ runtime next to onnxruntime-node's binaries.
 *
 * WHY
 * ---
 * (node-llama-cpp's Windows runtimes import the same DLLs and get the same
 * copies; see llamaRuntimeBinDirs.)
 *
 * The prebuilt `onnxruntime_binding.node` and `onnxruntime.dll` import
 * MSVCP140.dll, MSVCP140_1.dll, VCRUNTIME140.dll and VCRUNTIME140_1.dll.
 * Nothing in the package provided them and the installer does not install the
 * redistributable, so on a PC that has never had it, every local speech model
 * (and the local embedding and reranking models, which use the same binding)
 * failed at load with "The specified module could not be found".
 *
 * App-local deployment is the supported fix that needs no installer step and
 * no administrator rights: Windows resolves a native module's dependencies in
 * the module's own directory first, so four DLLs in that folder are enough.
 * Microsoft lists these files as redistributable.
 *
 * WHERE THE DLLS COME FROM
 * ------------------------
 * In this order:
 *   1. NATIVELY_VC_RUNTIME_DIR, if set — any folder holding the four DLLs.
 *      This is also how a non-Windows build host can supply them.
 *   2. Visual Studio's redistributable folder (%VCToolsRedistDir%\<arch>\
 *      Microsoft.VC14x.CRT), present inside a VS developer shell.
 *   3. %SystemRoot%\System32, where an installed redistributable puts them.
 *
 * Each DLL's PE header is read and must match the target architecture, so a
 * 32-bit host process (whose System32 is silently redirected to the 32-bit
 * copies) can never ship the wrong ones.
 *
 * WHAT HAPPENS WHEN THEY CANNOT BE FOUND
 * --------------------------------------
 * On a Windows host that is a broken build, and it fails. On macOS or Linux
 * cross-building a Windows target there is nowhere to copy them from unless
 * NATIVELY_VC_RUNTIME_DIR is set: the build continues with a loud warning, and
 * the app reports the missing runtime to the user at load time (see
 * electron/audio/whisper/loadFailure.ts) instead of a bare module error.
 *
 * macOS targets: nothing to do — this returns immediately.
 *
 * UNVERIFIED on a real Windows build host as of 2026-10-14. The Windows leg of
 * build-smoke.yml packages the app and then runs
 * verify-packaged-local-assets.mjs, which now requires these four files.
 */
const fs = require('fs');
const path = require('path');

const VC_RUNTIME_DLLS = Object.freeze([
  'msvcp140.dll',
  'msvcp140_1.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
]);

// electron-builder's Arch enum, as it reaches hooks (context.arch).
const ARCH_NAMES = Object.freeze({ 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' });

// IMAGE_FILE_MACHINE_* values from the PE header.
const PE_MACHINE = Object.freeze({ ia32: 0x014c, x64: 0x8664, arm64: 0xaa64 });

function archName(arch) {
  if (typeof arch === 'string') return arch;
  return ARCH_NAMES[arch] ?? null;
}

/** The machine type in a PE file's header, or null when it is not a PE file. */
function readPeMachine(file, fsImpl = fs) {
  let fd;
  try {
    fd = fsImpl.openSync(file, 'r');
    const dos = Buffer.alloc(64);
    if (fsImpl.readSync(fd, dos, 0, 64, 0) < 64 || dos.readUInt16LE(0) !== 0x5a4d) return null; // "MZ"
    const peOffset = dos.readUInt32LE(0x3c);
    const pe = Buffer.alloc(6);
    if (fsImpl.readSync(fd, pe, 0, 6, peOffset) < 6 || pe.readUInt32LE(0) !== 0x00004550) return null; // "PE\0\0"
    return pe.readUInt16LE(4);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fsImpl.closeSync(fd); } catch { /* ignore */ } }
  }
}

function candidateSourceDirs({ env, arch, pathImpl }) {
  const dirs = [];
  if (env.NATIVELY_VC_RUNTIME_DIR) dirs.push(env.NATIVELY_VC_RUNTIME_DIR);
  if (env.VCToolsRedistDir) {
    for (const crt of ['Microsoft.VC143.CRT', 'Microsoft.VC142.CRT', 'Microsoft.VC141.CRT']) {
      dirs.push(pathImpl.join(env.VCToolsRedistDir, arch, crt));
    }
  }
  const systemRoot = env.SystemRoot || env.windir;
  if (systemRoot) dirs.push(pathImpl.join(systemRoot, 'System32'));
  return dirs;
}

/**
 * For each runtime DLL, the first source file of the right architecture.
 * Returns { found: Map<dll, sourcePath>, missing: string[] }.
 */
function locateVcRuntime({ env, arch, fsImpl = fs, pathImpl = path }) {
  const wantMachine = PE_MACHINE[arch];
  const found = new Map();
  const missing = [];
  const dirs = candidateSourceDirs({ env, arch, pathImpl });
  for (const dll of VC_RUNTIME_DLLS) {
    const source = dirs
      .map((dir) => pathImpl.join(dir, dll))
      .find((file) => fsImpl.existsSync(file) && readPeMachine(file, fsImpl) === wantMachine);
    if (source) found.set(dll, source);
    else missing.push(dll);
  }
  return { found, missing, searched: dirs };
}

/** Where onnxruntime-node's Windows binaries sit inside a packaged app. */
function onnxBindingDir(appOutDir, arch, pathImpl = path) {
  return pathImpl.join(
    appOutDir, 'resources', 'app.asar.unpacked',
    'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', 'win32', arch,
  );
}

/**
 * The folders holding node-llama-cpp's Windows runtimes for `arch`
 * (@node-llama-cpp/win-x64, win-x64-vulkan, win-x64-cuda, ... /bins/<name>).
 * llama-addon.node, llama.dll, ggml*.dll and llama-common.dll import the
 * Visual C++ runtime like onnxruntime-node does, and node-llama-cpp tests each
 * runtime in a child process where onnxruntime's copies are not loaded.
 * node-llama-cpp 3.x ships msvcp140, vcruntime140 and vcruntime140_1 in each
 * of these folders (seen in the 2.9.2 installer, 2026-10-21); they are kept as
 * shipped, and only a DLL a folder lacks is added, so a future runtime that
 * stops shipping them still loads on a PC without the Redistributable.
 */
function llamaRuntimeBinDirs(appOutDir, arch, fsImpl = fs, pathImpl = path) {
  const scope = pathImpl.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', '@node-llama-cpp');
  const dirs = [];
  let packages = [];
  try { packages = fsImpl.readdirSync(scope); } catch { return dirs; }
  for (const pkg of packages) {
    if (pkg !== `win-${arch}` && !pkg.startsWith(`win-${arch}-`)) continue;
    const bins = pathImpl.join(scope, pkg, 'bins');
    let names = [];
    try { names = fsImpl.readdirSync(bins); } catch { continue; }
    for (const name of names) {
      const dir = pathImpl.join(bins, name);
      let files = [];
      try { files = fsImpl.readdirSync(dir); } catch { continue; }
      if (files.some((f) => /\.(node|dll)$/i.test(f))) dirs.push(dir);
    }
  }
  return dirs;
}

async function bundleVcRuntimeForAfterPack(
  context,
  {
    env = process.env,
    hostPlatform = process.platform,
    fsImpl = fs,
    pathImpl = path,
    log = console,
  } = {},
) {
  if (context?.electronPlatformName !== 'win32') return { skipped: 'not a Windows target' };

  const arch = archName(context.arch);
  if (!arch || !PE_MACHINE[arch]) {
    log.warn(`[bundle-vc-runtime] Unknown target arch ${String(context.arch)} — Visual C++ runtime not bundled.`);
    return { skipped: 'unknown arch' };
  }

  const targetDir = onnxBindingDir(context.appOutDir, arch, pathImpl);
  const targetDirs = [
    ...(fsImpl.existsSync(targetDir) ? [targetDir] : []),
    ...llamaRuntimeBinDirs(context.appOutDir, arch, fsImpl, pathImpl),
  ];
  if (targetDirs.length === 0) {
    // The asset verifier reports a missing binding directory on its own; this
    // step has nothing to put the DLLs next to.
    log.warn(`[bundle-vc-runtime] ${targetDir} does not exist — Visual C++ runtime not bundled.`);
    return { skipped: 'no binding directory' };
  }

  const { found, missing, searched } = locateVcRuntime({ env, arch, fsImpl, pathImpl });
  if (missing.length > 0) {
    const detail =
      `Visual C++ runtime DLLs not found for ${arch}: ${missing.join(', ')}. ` +
      `Searched: ${searched.length ? searched.join('; ') : '(nowhere — no source directory is known on this host)'}. ` +
      'Set NATIVELY_VC_RUNTIME_DIR to a folder containing them.';
    if (hostPlatform === 'win32') {
      throw new Error(`[bundle-vc-runtime] ${detail}`);
    }
    log.warn(
      `[bundle-vc-runtime] WARNING: ${detail} This Windows build will NOT run local models on a PC ` +
      'without the Visual C++ Redistributable installed.',
    );
    return { skipped: 'runtime not available on this host', missing };
  }

  for (const dir of targetDirs) {
    // onnxruntime's folder always gets this host's copies; a llama.cpp folder
    // keeps the ones its package shipped (see llamaRuntimeBinDirs).
    const keepShipped = dir !== targetDir;
    let copied = 0;
    for (const [dll, source] of found) {
      const dest = pathImpl.join(dir, dll);
      if (keepShipped && fsImpl.existsSync(dest)) continue;
      fsImpl.copyFileSync(source, dest);
      copied++;
    }
    log.log(`[bundle-vc-runtime] Bundled ${copied} Visual C++ runtime DLLs into ${dir}`);
  }
  return { bundled: [...found.keys()], targetDir, targetDirs };
}

module.exports = bundleVcRuntimeForAfterPack;
module.exports.bundleVcRuntimeForAfterPack = bundleVcRuntimeForAfterPack;
module.exports.locateVcRuntime = locateVcRuntime;
module.exports.readPeMachine = readPeMachine;
module.exports.onnxBindingDir = onnxBindingDir;
module.exports.llamaRuntimeBinDirs = llamaRuntimeBinDirs;
module.exports.VC_RUNTIME_DLLS = VC_RUNTIME_DLLS;
