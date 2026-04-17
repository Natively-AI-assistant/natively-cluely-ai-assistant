import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/step21.js
var require_step21 = __commonJS({
  "node_modules/highlight.js/lib/languages/step21.js"(exports, module) {
    function step21(hljs) {
      const STEP21_IDENT_RE = "[A-Z_][A-Z0-9_.]*";
      const STEP21_KEYWORDS = {
        $pattern: STEP21_IDENT_RE,
        keyword: "HEADER ENDSEC DATA"
      };
      const STEP21_START = {
        className: "meta",
        begin: "ISO-10303-21;",
        relevance: 10
      };
      const STEP21_CLOSE = {
        className: "meta",
        begin: "END-ISO-10303-21;",
        relevance: 10
      };
      return {
        name: "STEP Part 21",
        aliases: [
          "p21",
          "step",
          "stp"
        ],
        case_insensitive: true,
        // STEP 21 is case insensitive in theory, in practice all non-comments are capitalized.
        keywords: STEP21_KEYWORDS,
        contains: [
          STEP21_START,
          STEP21_CLOSE,
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          hljs.COMMENT("/\\*\\*!", "\\*/"),
          hljs.C_NUMBER_MODE,
          hljs.inherit(hljs.APOS_STRING_MODE, {
            illegal: null
          }),
          hljs.inherit(hljs.QUOTE_STRING_MODE, {
            illegal: null
          }),
          {
            className: "string",
            begin: "'",
            end: "'"
          },
          {
            className: "symbol",
            variants: [
              {
                begin: "#",
                end: "\\d+",
                illegal: "\\W"
              }
            ]
          }
        ]
      };
    }
    module.exports = step21;
  }
});

export {
  require_step21
};
//# sourceMappingURL=chunk-TYLTSA42.js.map
