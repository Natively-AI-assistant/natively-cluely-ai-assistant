// intelligence-eval-real-ui/global-teardown.ts
export default async function globalTeardown() {
  // Per-test apps are closed by the specs; nothing global to tear down.
  // (Placeholder kept so playwright.config's globalTeardown path resolves.)
}
