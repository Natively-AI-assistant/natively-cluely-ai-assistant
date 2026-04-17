import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/csp.js
var require_csp = __commonJS({
  "node_modules/refractor/lang/csp.js"(exports, module) {
    module.exports = csp;
    csp.displayName = "csp";
    csp.aliases = [];
    function csp(Prism) {
      ;
      (function(Prism2) {
        function value(source) {
          return RegExp(
            /([ \t])/.source + "(?:" + source + ")" + /(?=[\s;]|$)/.source,
            "i"
          );
        }
        Prism2.languages.csp = {
          directive: {
            pattern: /(^|[\s;])(?:base-uri|block-all-mixed-content|(?:child|connect|default|font|frame|img|manifest|media|object|prefetch|script|style|worker)-src|disown-opener|form-action|frame-(?:ancestors|options)|input-protection(?:-(?:clip|selectors))?|navigate-to|plugin-types|policy-uri|referrer|reflected-xss|report-(?:to|uri)|require-sri-for|sandbox|(?:script|style)-src-(?:attr|elem)|upgrade-insecure-requests)(?=[\s;]|$)/i,
            lookbehind: true,
            alias: "property"
          },
          scheme: {
            pattern: value(/[a-z][a-z0-9.+-]*:/.source),
            lookbehind: true
          },
          none: {
            pattern: value(/'none'/.source),
            lookbehind: true,
            alias: "keyword"
          },
          nonce: {
            pattern: value(/'nonce-[-+/\w=]+'/.source),
            lookbehind: true,
            alias: "number"
          },
          hash: {
            pattern: value(/'sha(?:256|384|512)-[-+/\w=]+'/.source),
            lookbehind: true,
            alias: "number"
          },
          host: {
            pattern: value(
              /[a-z][a-z0-9.+-]*:\/\/[^\s;,']*/.source + "|" + /\*[^\s;,']*/.source + "|" + /[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::[\d*]+)?(?:\/[^\s;,']*)?/.source
            ),
            lookbehind: true,
            alias: "url",
            inside: {
              important: /\*/
            }
          },
          keyword: [
            {
              pattern: value(/'unsafe-[a-z-]+'/.source),
              lookbehind: true,
              alias: "unsafe"
            },
            {
              pattern: value(/'[a-z-]+'/.source),
              lookbehind: true,
              alias: "safe"
            }
          ],
          punctuation: /;/
        };
      })(Prism);
    }
  }
});

export {
  require_csp
};
//# sourceMappingURL=chunk-D75M2XEM.js.map
