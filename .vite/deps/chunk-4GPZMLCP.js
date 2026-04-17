import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/taggerscript.js
var require_taggerscript = __commonJS({
  "node_modules/highlight.js/lib/languages/taggerscript.js"(exports, module) {
    function taggerscript(hljs) {
      const COMMENT = {
        className: "comment",
        begin: /\$noop\(/,
        end: /\)/,
        contains: [{
          begin: /\(/,
          end: /\)/,
          contains: [
            "self",
            {
              begin: /\\./
            }
          ]
        }],
        relevance: 10
      };
      const FUNCTION = {
        className: "keyword",
        begin: /\$(?!noop)[a-zA-Z][_a-zA-Z0-9]*/,
        end: /\(/,
        excludeEnd: true
      };
      const VARIABLE = {
        className: "variable",
        begin: /%[_a-zA-Z0-9:]*/,
        end: "%"
      };
      const ESCAPE_SEQUENCE = {
        className: "symbol",
        begin: /\\./
      };
      return {
        name: "Tagger Script",
        contains: [
          COMMENT,
          FUNCTION,
          VARIABLE,
          ESCAPE_SEQUENCE
        ]
      };
    }
    module.exports = taggerscript;
  }
});

export {
  require_taggerscript
};
//# sourceMappingURL=chunk-4GPZMLCP.js.map
