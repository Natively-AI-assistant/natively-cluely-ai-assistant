// Recovered from Natively 3.1.0 compiled output; see ../RECOVERY.json for provenance.
import { extractSafeDocumentText } from "../../../electron/services/SafeDocumentTextExtractor";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var import_path = __toESM(require("path"));
// premium/electron/knowledge/DocumentReader.ts
var MIN_PROFILE_DOCUMENT_CHARS = 50;
var MAX_PROFILE_DOCUMENT_CHARS = 2e5;
async function extractDocumentText(filePath) {
    const extracted = await extractSafeDocumentText(filePath);
    const text = extracted.content.trim();
    const kind = extracted.extension === ".pdf" ? "PDF" : extracted.extension === ".docx" ? "DOCX" : "document";
    if (text.length < MIN_PROFILE_DOCUMENT_CHARS) {
        throw new Error(`${kind} appears to contain very little text. It may be a scanned or corrupt document.`);
    }
    if (text.length > MAX_PROFILE_DOCUMENT_CHARS) {
        throw new Error(`${kind} is too long (${text.length.toLocaleString()} characters) to be a resume or job description \u2014 the limit is ${MAX_PROFILE_DOCUMENT_CHARS.toLocaleString()}. Please upload a shorter document. If this is meant to be a reference document, add it as a reference file under Modes Manager instead: long documents have no such limit there and stay fully searchable.`);
    }
    console.log(`[DocumentReader] Extracted ${text.length} chars from ${import_path.default.basename(filePath)}`);
    return text;
}
export { extractDocumentText };
