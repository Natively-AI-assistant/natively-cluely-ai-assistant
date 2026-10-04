// Build the TelemetryService sink list for the current stealth state.
//
// Local JSONL always ships — it is written to the app's own userData folder and
// never leaves the machine, so it is invisible to an OS-level proctor. The
// remote sinks (PostHog / Axiom / Sentry) each open an outbound HTTPS
// connection to a third-party host (app.posthog.com, api.axiom.co,
// *.ingest.sentry.io). In undetectable mode the user is hiding from exactly
// that kind of proctor, so a network-level monitor would see the disguised
// process phoning home to analytics hosts — a dead giveaway. They are therefore
// dropped entirely when undetectable is on; only local-jsonl remains.
//
// Each remote sink is still added ONLY when its credential env var is present
// (unset = silently local-only), so a normal-mode build with no telemetry env
// configured is unchanged.
//
// The module is dependency-free (no electron / SettingsManager imports) so it
// can be unit-tested in bare `node --test`. The app version, settings accessors
// and env are injected by the caller — main.ts passes the real ones.

export interface TelemetrySinkDeps {
  /** App version, for the Sentry `release` tag. Omit → falls back to APP_VERSION. */
  getVersion?: () => string;
  /** Read a persisted setting (telemetryInstallId). */
  getSetting?: (key: string) => unknown;
  /** Persist a setting (telemetryInstallId). */
  setSetting?: (key: string, value: unknown) => void;
  /** Process env. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export function buildTelemetrySinks(
  isUndetectable: boolean,
  deps: TelemetrySinkDeps = {},
): Array<Record<string, unknown>> {
  const env = deps.env ?? process.env;
  const sinks: Array<Record<string, unknown>> = [{ name: 'local-jsonl', enabled: true }];
  if (isUndetectable) return sinks;

  const release = (deps.getVersion ? deps.getVersion() : undefined) || env.APP_VERSION || 'unknown';
  const environment = env.NODE_ENV === 'development' ? 'development' : 'production';

  // A stable, NON-PII install id (random, persisted in settings) lets PostHog
  // dedupe sessions without ever shipping a key/email.
  let distinctId: string | undefined;
  if (deps.getSetting && deps.setSetting) {
    try {
      distinctId = deps.getSetting('telemetryInstallId') as string | undefined;
      if (!distinctId) {
        distinctId = `nd_${Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
        deps.setSetting('telemetryInstallId', distinctId);
      }
    } catch { /* settings unavailable — distinctId stays undefined */ }
  }

  if (env.POSTHOG_API_KEY) {
    sinks.push({ name: 'posthog', enabled: true, apiKey: env.POSTHOG_API_KEY, endpoint: env.POSTHOG_HOST || 'https://app.posthog.com', distinctId });
  }
  if (env.SENTRY_DSN) {
    sinks.push({ name: 'sentry', enabled: true, dsn: env.SENTRY_DSN, release, environment });
  }
  if (env.AXIOM_TOKEN && env.AXIOM_DATASET) {
    sinks.push({ name: 'axiom', enabled: true, apiKey: env.AXIOM_TOKEN, dataset: env.AXIOM_DATASET });
  }
  return sinks;
}
