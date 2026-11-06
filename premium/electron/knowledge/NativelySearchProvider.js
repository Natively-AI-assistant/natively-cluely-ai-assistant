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
var import_crypto = require("crypto");
var NativelySearchProvider = class {
    apiKey;
    trialToken;
    endpoint = "https://api.natively.software/v1/search";
    // One UUID per instance = one UUID per company research button click.
    // The server bills 1 credit for the first query in a session; the rest are free.
    sessionId = (0, import_crypto.randomUUID)();
    /** True if any search call was rejected with search_quota_exceeded (429). */
    quotaExhausted = false;
    constructor(apiKey, trialToken) {
        this.apiKey = apiKey;
        this.trialToken = trialToken;
    }
    async search(query, numResults = 5) {
        const authHeaders = this.trialToken ? { "x-trial-token": this.trialToken } : { "x-natively-key": this.apiKey };
        try {
            const response = await fetch(this.endpoint, {
                method: "POST",
                headers: {
                    ...authHeaders,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ query, depth: "advanced", session_id: this.sessionId }),
                signal: AbortSignal.timeout(12e3)
            });
            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                if (response.status === 429) {
                    this.quotaExhausted = true;
                    console.warn("[NativelySearch] Search quota exceeded \u2014 falling back to LLM-only research.");
                }
                else {
                    console.error(`[NativelySearch] Error ${response.status}: ${err.error || "unknown"}`);
                }
                return [];
            }
            const data = await response.json();
            if (data.quota != null) {
                console.log(`[NativelySearch] Search quota remaining: ${data.quota.remaining}`);
            }
            const results = (data.results || []).slice(0, numResults).map((item) => ({
                title: item.title || "",
                link: item.url || "",
                snippet: item.content || ""
            }));
            console.log(`[NativelySearch] Got ${results.length} results for: "${query}"`);
            return results;
        }
        catch (error) {
            console.error(`[NativelySearch] Request failed: ${error.message}`);
            return [];
        }
    }
};
export { NativelySearchProvider };
