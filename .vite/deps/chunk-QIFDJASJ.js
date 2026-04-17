import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/dust.js
var require_dust = __commonJS({
  "node_modules/highlight.js/lib/languages/dust.js"(exports, module) {
    function dust(hljs) {
      const EXPRESSION_KEYWORDS = "if eq ne lt lte gt gte select default math sep";
      return {
        name: "Dust",
        aliases: ["dst"],
        case_insensitive: true,
        subLanguage: "xml",
        contains: [
          {
            className: "template-tag",
            begin: /\{[#\/]/,
            end: /\}/,
            illegal: /;/,
            contains: [{
              className: "name",
              begin: /[a-zA-Z\.-]+/,
              starts: {
                endsWithParent: true,
                relevance: 0,
                contains: [hljs.QUOTE_STRING_MODE]
              }
            }]
          },
          {
            className: "template-variable",
            begin: /\{/,
            end: /\}/,
            illegal: /;/,
            keywords: EXPRESSION_KEYWORDS
          }
        ]
      };
    }
    module.exports = dust;
  }
});

export {
  require_dust
};
//# sourceMappingURL=chunk-QIFDJASJ.js.map
