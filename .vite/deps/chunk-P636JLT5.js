import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/smalltalk.js
var require_smalltalk = __commonJS({
  "node_modules/refractor/lang/smalltalk.js"(exports, module) {
    module.exports = smalltalk;
    smalltalk.displayName = "smalltalk";
    smalltalk.aliases = [];
    function smalltalk(Prism) {
      Prism.languages.smalltalk = {
        comment: {
          pattern: /"(?:""|[^"])*"/,
          greedy: true
        },
        char: {
          pattern: /\$./,
          greedy: true
        },
        string: {
          pattern: /'(?:''|[^'])*'/,
          greedy: true
        },
        symbol: /#[\da-z]+|#(?:-|([+\/\\*~<>=@%|&?!])\1?)|#(?=\()/i,
        "block-arguments": {
          pattern: /(\[\s*):[^\[|]*\|/,
          lookbehind: true,
          inside: {
            variable: /:[\da-z]+/i,
            punctuation: /\|/
          }
        },
        "temporary-variables": {
          pattern: /\|[^|]+\|/,
          inside: {
            variable: /[\da-z]+/i,
            punctuation: /\|/
          }
        },
        keyword: /\b(?:new|nil|self|super)\b/,
        boolean: /\b(?:false|true)\b/,
        number: [
          /\d+r-?[\dA-Z]+(?:\.[\dA-Z]+)?(?:e-?\d+)?/,
          /\b\d+(?:\.\d+)?(?:e-?\d+)?/
        ],
        operator: /[<=]=?|:=|~[~=]|\/\/?|\\\\|>[>=]?|[!^+\-*&|,@]/,
        punctuation: /[.;:?\[\](){}]/
      };
    }
  }
});

export {
  require_smalltalk
};
//# sourceMappingURL=chunk-P636JLT5.js.map
