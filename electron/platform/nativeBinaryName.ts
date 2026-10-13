/**
 * Maps platform+arch to the NAPI-RS compiled binary name.
 * Filenames are produced by `npx napi build` in native-module/.
 * Naming convention: index.<platform>-<arch>-<abi>.node
 */
export function getNativeBinaryName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  const map: Record<string, Record<string, string>> = {
    win32: {
      x64: 'index.win32-x64-msvc.node',
      ia32: 'index.win32-ia32-msvc.node',
      arm64: 'index.win32-arm64-msvc.node',
    },
    darwin: { x64: 'index.darwin-x64.node', arm64: 'index.darwin-arm64.node' },
    linux: { x64: 'index.linux-x64-gnu.node', arm64: 'index.linux-arm64-gnu.node' },
  };
  return map[platform]?.[arch] ?? `index.${platform}-${arch}.node`;
}

/** Candidate paths tried by nativeModuleLoader (relative segments only). */
export function getNativeModuleSearchPathSegments(): readonly string[] {
  return ['app.asar.unpacked', 'native-module'] as const;
}
