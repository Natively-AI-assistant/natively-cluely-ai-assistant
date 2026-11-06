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
function extractJsonObject(raw) {
    const trimmed = raw.trim();
    let cleaned = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    try {
        return JSON.parse(cleaned);
    }
    catch {
    }
    const start = cleaned.indexOf("{");
    if (start === -1)
        throw new Error("no JSON object in response");
    let depth = 0, inString = false, escape = false;
    for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === "\\") {
            escape = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (ch === "{")
            depth++;
        else if (ch === "}") {
            depth--;
            if (depth === 0)
                return JSON.parse(cleaned.slice(start, i + 1));
        }
    }
    throw new Error("unbalanced JSON braces");
}
export { extractJsonObject };
