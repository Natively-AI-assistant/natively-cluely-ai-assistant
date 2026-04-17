import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/flix.js
var require_flix = __commonJS({
  "node_modules/highlight.js/lib/languages/flix.js"(exports, module) {
    function flix(hljs) {
      const CHAR = {
        className: "string",
        begin: /'(.|\\[xXuU][a-zA-Z0-9]+)'/
      };
      const STRING = {
        className: "string",
        variants: [{
          begin: '"',
          end: '"'
        }]
      };
      const NAME = {
        className: "title",
        relevance: 0,
        begin: /[^0-9\n\t "'(),.`{}\[\]:;][^\n\t "'(),.`{}\[\]:;]+|[^0-9\n\t "'(),.`{}\[\]:;=]/
      };
      const METHOD = {
        className: "function",
        beginKeywords: "def",
        end: /[:={\[(\n;]/,
        excludeEnd: true,
        contains: [NAME]
      };
      return {
        name: "Flix",
        keywords: {
          literal: "true false",
          keyword: "case class def else enum if impl import in lat rel index let match namespace switch type yield with"
        },
        contains: [
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          CHAR,
          STRING,
          METHOD,
          hljs.C_NUMBER_MODE
        ]
      };
    }
    module.exports = flix;
  }
});

export {
  require_flix
};
//# sourceMappingURL=chunk-EL3EMTM3.js.map
