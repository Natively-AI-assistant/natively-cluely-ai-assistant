// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var DEFAULT_LLM_TIMEOUT_MS = 3e4;
function extractJSONArray(raw) {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
        return JSON.parse(match[0]);
    }
    throw new Error(`No JSON array found in LLM response (${raw.length} chars)`);
}
function extractJSONObject(raw) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
        return JSON.parse(match[0]);
    }
    throw new Error(`No JSON object found in LLM response (${raw.length} chars)`);
}
async function callWithTimeout(fn, timeoutMs = DEFAULT_LLM_TIMEOUT_MS) {
    return Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`LLM call timed out after ${timeoutMs}ms`)), timeoutMs))
    ]);
}
async function callWithRetry(fn, timeoutMs = DEFAULT_LLM_TIMEOUT_MS) {
    try {
        return await callWithTimeout(fn, timeoutMs);
    }
    catch (firstError) {
        console.warn(`[llmUtils] First attempt failed: ${firstError.message}. Retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 1e3));
        return await callWithTimeout(fn, timeoutMs);
    }
}
export { callWithRetry, callWithTimeout, extractJSONArray, extractJSONObject };
