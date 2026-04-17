import {
  require_c
} from "./chunk-KVPV6VR4.js";
import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/bison.js
var require_bison = __commonJS({
  "node_modules/refractor/lang/bison.js"(exports, module) {
    var refractorC = require_c();
    module.exports = bison;
    bison.displayName = "bison";
    bison.aliases = [];
    function bison(Prism) {
      Prism.register(refractorC);
      Prism.languages.bison = Prism.languages.extend("c", {});
      Prism.languages.insertBefore("bison", "comment", {
        bison: {
          // This should match all the beginning of the file
          // including the prologue(s), the bison declarations and
          // the grammar rules.
          pattern: /^(?:[^%]|%(?!%))*%%[\s\S]*?%%/,
          inside: {
            c: {
              // Allow for one level of nested braces
              pattern: /%\{[\s\S]*?%\}|\{(?:\{[^}]*\}|[^{}])*\}/,
              inside: {
                delimiter: {
                  pattern: /^%?\{|%?\}$/,
                  alias: "punctuation"
                },
                "bison-variable": {
                  pattern: /[$@](?:<[^\s>]+>)?[\w$]+/,
                  alias: "variable",
                  inside: {
                    punctuation: /<|>/
                  }
                },
                rest: Prism.languages.c
              }
            },
            comment: Prism.languages.c.comment,
            string: Prism.languages.c.string,
            property: /\S+(?=:)/,
            keyword: /%\w+/,
            number: {
              pattern: /(^|[^@])\b(?:0x[\da-f]+|\d+)/i,
              lookbehind: true
            },
            punctuation: /%[%?]|[|:;\[\]<>]/
          }
        }
      });
    }
  }
});

export {
  require_bison
};
//# sourceMappingURL=chunk-YLWGWBQB.js.map
