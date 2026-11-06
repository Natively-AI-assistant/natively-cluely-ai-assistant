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
var ENTITLEMENT_LOST_ERRORS = /* @__PURE__ */ new Set([
    "subscription_inactive",
    // subscription expired / cancelled
    "key_not_found",
    // key deleted server-side (e.g. refund)
    "invalid_key_format"
    // key is no longer a valid key
]);
var TRANSIENT_ERRORS = /* @__PURE__ */ new Set([
    "ip_blocked",
    // 429 rate-limit / DDoS edge throttle
    "account_suspended",
    // payment-method hold; "contact support" — recoverable, not a downgrade
    "rate_limited",
    "server_error"
]);
function classifyProVerify(status, data) {
    if (!status || status === 0)
        return "keep";
    if (data && data.ok === true && data.has_pro === true)
        return "active";
    if (status >= 500 || data == null)
        return "keep";
    const err = typeof data.error === "string" ? data.error : void 0;
    if (err && TRANSIENT_ERRORS.has(err))
        return "keep";
    if (data.has_pro === false || err && ENTITLEMENT_LOST_ERRORS.has(err))
        return "revoke";
    return "keep";
}
export { classifyProVerify };
