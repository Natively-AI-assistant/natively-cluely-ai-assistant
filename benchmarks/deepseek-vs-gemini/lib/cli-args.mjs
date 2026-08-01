// benchmarks/deepseek-vs-gemini/lib/cli-args.mjs
export function parseArgs(argv) {
  const flags = new Set(argv.filter((a) => !a.includes('=')));
  const kv = Object.fromEntries(
    argv.filter((a) => a.includes('=')).map((a) => {
      const [k, ...rest] = a.split('=');
      return [k, rest.join('=')];
    }),
  );
  return {
    confirm: flags.has('--confirm'),
    dryRun: flags.has('--dry-run'),
    sample: kv['--sample'] != null ? parseInt(kv['--sample'], 10) : null,
    concurrency: kv['--concurrency'] != null ? parseInt(kv['--concurrency'], 10) : 4,
    only: kv['--only'] != null ? kv['--only'].split(',').map((s) => s.trim()).filter(Boolean) : null,
  };
}
