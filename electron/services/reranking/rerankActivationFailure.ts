/**
 * What to tell the user when the post-selection self-test rerank returns
 * nothing.
 *
 * The seam fails closed, so the self-test only learns "no ranking". Saying the
 * model "loaded but did not return a usable ranking" for every cause sent a
 * Windows user hunting a model problem when the llama.cpp runtime itself could
 * not start (a dependency missing from the install).
 *
 * The wording names the cause and keeps raw module names, file paths and Node
 * error text out of the UI, including for causes it does not recognise; the
 * original message stays in the log (ipcHandlers writes it). Nothing here
 * is OS-specific, so it reads the same on macOS and Windows.
 */

const NOTHING_REPORTED = 'the model loaded but did not return a usable ranking';

export function describeRerankActivationFailure(lastFailure: string | null | undefined): string {
  const reason = String(lastFailure ?? '').trim();
  if (!reason) return NOTHING_REPORTED;

  // ERR_MODULE_NOT_FOUND / MODULE_NOT_FOUND: part of the local runtime is not in
  // this install. Not something the user's model file can cause or fix.
  if (/cannot find (package|module)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i.test(reason)) {
    return 'the local model runtime could not start because part of it is missing from this install. Reinstalling or updating Natively should fix it';
  }
  if (/timed out/i.test(reason)) {
    return 'the model did not answer in time. It may still be loading, so try again in a moment';
  }
  if (/model not found/i.test(reason)) {
    return 'the model file could not be found. Download it again from the model list';
  }
  if (/worker (error|exited)/i.test(reason)) {
    return 'the local model process stopped unexpectedly';
  }
  if (/different number of scores|not a number/i.test(reason)) {
    return 'the model loaded but did not return a usable ranking';
  }
  // Anything else is Node or llama.cpp text that may carry paths. It is logged
  // by the caller; the UI gets a plain sentence.
  return 'the model could not run. Details are in the app log';
}
