import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/pcaxis.js
var require_pcaxis = __commonJS({
  "node_modules/refractor/lang/pcaxis.js"(exports, module) {
    module.exports = pcaxis;
    pcaxis.displayName = "pcaxis";
    pcaxis.aliases = ["px"];
    function pcaxis(Prism) {
      Prism.languages.pcaxis = {
        string: /"[^"]*"/,
        keyword: {
          pattern: /((?:^|;)\s*)[-A-Z\d]+(?:\s*\[[-\w]+\])?(?:\s*\("[^"]*"(?:,\s*"[^"]*")*\))?(?=\s*=)/,
          lookbehind: true,
          greedy: true,
          inside: {
            keyword: /^[-A-Z\d]+/,
            language: {
              pattern: /^(\s*)\[[-\w]+\]/,
              lookbehind: true,
              inside: {
                punctuation: /^\[|\]$/,
                property: /[-\w]+/
              }
            },
            "sub-key": {
              pattern: /^(\s*)\S[\s\S]*/,
              lookbehind: true,
              inside: {
                parameter: {
                  pattern: /"[^"]*"/,
                  alias: "property"
                },
                punctuation: /^\(|\)$|,/
              }
            }
          }
        },
        operator: /=/,
        tlist: {
          pattern: /TLIST\s*\(\s*\w+(?:(?:\s*,\s*"[^"]*")+|\s*,\s*"[^"]*"-"[^"]*")?\s*\)/,
          greedy: true,
          inside: {
            function: /^TLIST/,
            property: {
              pattern: /^(\s*\(\s*)\w+/,
              lookbehind: true
            },
            string: /"[^"]*"/,
            punctuation: /[(),]/,
            operator: /-/
          }
        },
        punctuation: /[;,]/,
        number: {
          pattern: /(^|\s)\d+(?:\.\d+)?(?!\S)/,
          lookbehind: true
        },
        boolean: /NO|YES/
      };
      Prism.languages.px = Prism.languages.pcaxis;
    }
  }
});

export {
  require_pcaxis
};
//# sourceMappingURL=chunk-C2TGMIWN.js.map
