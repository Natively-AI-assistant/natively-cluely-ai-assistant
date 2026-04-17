import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/csp.js
var require_csp = __commonJS({
  "node_modules/highlight.js/lib/languages/csp.js"(exports, module) {
    function csp(hljs) {
      return {
        name: "CSP",
        case_insensitive: false,
        keywords: {
          $pattern: "[a-zA-Z][a-zA-Z0-9_-]*",
          keyword: "base-uri child-src connect-src default-src font-src form-action frame-ancestors frame-src img-src media-src object-src plugin-types report-uri sandbox script-src style-src"
        },
        contains: [
          {
            className: "string",
            begin: "'",
            end: "'"
          },
          {
            className: "attribute",
            begin: "^Content",
            end: ":",
            excludeEnd: true
          }
        ]
      };
    }
    module.exports = csp;
  }
});

export {
  require_csp
};
//# sourceMappingURL=chunk-QL6MBWT5.js.map
