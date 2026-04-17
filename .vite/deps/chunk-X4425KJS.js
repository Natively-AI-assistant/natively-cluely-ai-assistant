import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/bnf.js
var require_bnf = __commonJS({
  "node_modules/highlight.js/lib/languages/bnf.js"(exports, module) {
    function bnf(hljs) {
      return {
        name: "Backus–Naur Form",
        contains: [
          // Attribute
          {
            className: "attribute",
            begin: /</,
            end: />/
          },
          // Specific
          {
            begin: /::=/,
            end: /$/,
            contains: [
              {
                begin: /</,
                end: />/
              },
              // Common
              hljs.C_LINE_COMMENT_MODE,
              hljs.C_BLOCK_COMMENT_MODE,
              hljs.APOS_STRING_MODE,
              hljs.QUOTE_STRING_MODE
            ]
          }
        ]
      };
    }
    module.exports = bnf;
  }
});

export {
  require_bnf
};
//# sourceMappingURL=chunk-X4425KJS.js.map
