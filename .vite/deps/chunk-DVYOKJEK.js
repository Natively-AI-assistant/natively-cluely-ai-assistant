import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/tap.js
var require_tap = __commonJS({
  "node_modules/highlight.js/lib/languages/tap.js"(exports, module) {
    function tap(hljs) {
      return {
        name: "Test Anything Protocol",
        case_insensitive: true,
        contains: [
          hljs.HASH_COMMENT_MODE,
          // version of format and total amount of testcases
          {
            className: "meta",
            variants: [
              {
                begin: "^TAP version (\\d+)$"
              },
              {
                begin: "^1\\.\\.(\\d+)$"
              }
            ]
          },
          // YAML block
          {
            begin: /---$/,
            end: "\\.\\.\\.$",
            subLanguage: "yaml",
            relevance: 0
          },
          // testcase number
          {
            className: "number",
            begin: " (\\d+) "
          },
          // testcase status and description
          {
            className: "symbol",
            variants: [
              {
                begin: "^ok"
              },
              {
                begin: "^not ok"
              }
            ]
          }
        ]
      };
    }
    module.exports = tap;
  }
});

export {
  require_tap
};
//# sourceMappingURL=chunk-DVYOKJEK.js.map
