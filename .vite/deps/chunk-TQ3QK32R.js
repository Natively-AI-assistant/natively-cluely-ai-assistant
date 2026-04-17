import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/rego.js
var require_rego = __commonJS({
  "node_modules/refractor/lang/rego.js"(exports, module) {
    module.exports = rego;
    rego.displayName = "rego";
    rego.aliases = [];
    function rego(Prism) {
      Prism.languages.rego = {
        comment: /#.*/,
        property: {
          pattern: /(^|[^\\.])(?:"(?:\\.|[^\\"\r\n])*"|`[^`]*`|\b[a-z_]\w*\b)(?=\s*:(?!=))/i,
          lookbehind: true,
          greedy: true
        },
        string: {
          pattern: /(^|[^\\])"(?:\\.|[^\\"\r\n])*"|`[^`]*`/,
          lookbehind: true,
          greedy: true
        },
        keyword: /\b(?:as|default|else|import|not|null|package|set(?=\s*\()|some|with)\b/,
        boolean: /\b(?:false|true)\b/,
        function: {
          pattern: /\b[a-z_]\w*\b(?:\s*\.\s*\b[a-z_]\w*\b)*(?=\s*\()/i,
          inside: {
            namespace: /\b\w+\b(?=\s*\.)/,
            punctuation: /\./
          }
        },
        number: /-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i,
        operator: /[-+*/%|&]|[<>:=]=?|!=|\b_\b/,
        punctuation: /[,;.\[\]{}()]/
      };
    }
  }
});

export {
  require_rego
};
//# sourceMappingURL=chunk-TQ3QK32R.js.map
