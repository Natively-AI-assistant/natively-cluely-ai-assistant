// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { tavily } from "@tavily/core";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all3) => {
  for (var name in all3)
    __defProp(target, name, { get: all3[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
// premium/electron/knowledge/TavilySearchProvider.ts
var TavilySearchProvider = class {
    client;
    creditsUsed = 0;
    constructor(apiKey) {
        this.client = tavily({ apiKey });
    }
    get sessionCreditsUsed() {
        return this.creditsUsed;
    }
    async search(query, numResults = 5) {
        const maxResults = Math.min(Math.max(numResults, 1), 20);
        try {
            const response = await this.client.search(query, {
                searchDepth: "advanced",
                maxResults,
                includeRawContent: "markdown",
                includeUsage: true
            });
            if (response.usage?.credits != null) {
                this.creditsUsed += response.usage.credits;
                console.log(`[Tavily] Credits this call: ${response.usage.credits} | Instance total: ${this.creditsUsed}`);
            }
            if (!Array.isArray(response.results) || response.results.length === 0) {
                console.warn(`[Tavily] No results for: "${query}" (requestId: ${response.requestId})`);
                return [];
            }
            const results = response.results.map((item) => ({
                title: item.title || "",
                link: item.url || "",
                snippet: item.content || ""
            }));
            console.log(`[Tavily] Got ${results.length} results for: "${query}" (requestId: ${response.requestId})`);
            return results;
        }
        catch (error) {
            const status = error?.status ?? error?.statusCode ?? error?.response?.status;
            if (status === 401) {
                console.error("[Tavily] Invalid API key (401). Please update your Tavily API key.");
            }
            else if (status === 429) {
                console.error("[Tavily] Rate limited (429). Backing off.");
            }
            else if (status === 432 || status === 433) {
                console.error(`[Tavily] Credits exhausted (${status}). Search is unavailable until credits are renewed.`);
            }
            else if (status === 500) {
                console.error("[Tavily] Server error (500). Will not retry.");
            }
            else {
                console.error(`[Tavily] Request failed (status ${status ?? "unknown"}): ${error?.message ?? error}`);
            }
            return [];
        }
    }
    /**
     * Fetch the full readable content of a single page.
     *
     * Additive (Role Insight, 2026-08-04) and used ONLY to turn a user-supplied
     * job URL into job-description text, or to recover a posting whose supplied
     * text was truncated. `search()` returns a short `content` snippet, which is
     * not enough to extract requirements from — a JD analysed from a snippet
     * would silently produce a partial requirement list.
     *
     * Mirrors search()'s contract exactly: never throws, returns null on any
     * failure so the caller degrades instead of aborting.
     */
    async extractUrl(url2) {
        try {
            const response = await this.client.extract([url2], {
                extractDepth: "advanced",
                format: "markdown",
                includeUsage: true
            });
            if (response.usage?.credits != null) {
                this.creditsUsed += response.usage.credits;
                console.log(`[Tavily] Extract credits: ${response.usage.credits} | Instance total: ${this.creditsUsed}`);
            }
            const hit = response.results?.[0];
            if (!hit || !hit.rawContent) {
                const failure = response.failedResults?.[0]?.error;
                console.warn(`[Tavily] Extract returned no content for ${url2}${failure ? `: ${failure}` : ""}`);
                return null;
            }
            return { title: hit.title || "", content: hit.rawContent };
        }
        catch (error) {
            const status = error?.status ?? error?.statusCode ?? error?.response?.status;
            console.error(`[Tavily] Extract failed for ${url2} (status ${status ?? "unknown"}): ${error?.message ?? error}`);
            return null;
        }
    }
};
export { TavilySearchProvider };
