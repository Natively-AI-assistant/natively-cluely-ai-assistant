/**
 * Whether this Mac can load onnxruntime-node, which every local speech model
 * runs on. The 1.22.0 binaries (darwin arm64 and x64) are built with
 * minos 13.3 and import std::to_chars(double), which libc++ exports from macOS
 * 13.3 on: older, the dylib load fails with "Symbol not found:
 * __ZNSt3__18to_charsEPcS0_d". The gate used to stop at Darwin 22 (13.0), so
 * 13.0-13.2 were offered models that never loaded and then told to "upgrade to
 * macOS 13 Ventura", which they already ran. macOS 13.3 is Darwin 22.4.
 *
 * Always true off macOS: Windows has its own requirement (the Visual C++
 * runtime, see loadFailure.ts).
 */
import os from 'os';

export const ONNX_MAC_UNSUPPORTED_MESSAGE =
  'Local speech models need macOS 13.3 or later. Update macOS in System Settings › General › Software Update, or use a cloud STT provider.';

export function onnxRuntimeSupportedOnThisMac(
  platform: NodeJS.Platform = process.platform,
  release: string = os.release(),
): boolean {
  if (platform !== 'darwin') return true;
  const [major, minor] = release.split('.').map((n) => parseInt(n, 10));
  if (Number.isNaN(major)) return false;
  return major > 22 || (major === 22 && (minor || 0) >= 4);
}
