import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/less.js
var require_less = __commonJS({
  "node_modules/refractor/lang/less.js"(exports, module) {
    module.exports = less;
    less.displayName = "less";
    less.aliases = [];
    function less(Prism) {
      Prism.languages.less = Prism.languages.extend("css", {
        comment: [
          /\/\*[\s\S]*?\*\//,
          {
            pattern: /(^|[^\\])\/\/.*/,
            lookbehind: true
          }
        ],
        atrule: {
          pattern: /@[\w-](?:\((?:[^(){}]|\([^(){}]*\))*\)|[^(){};\s]|\s+(?!\s))*?(?=\s*\{)/,
          inside: {
            punctuation: /[:()]/
          }
        },
        // selectors and mixins are considered the same
        selector: {
          pattern: /(?:@\{[\w-]+\}|[^{};\s@])(?:@\{[\w-]+\}|\((?:[^(){}]|\([^(){}]*\))*\)|[^(){};@\s]|\s+(?!\s))*?(?=\s*\{)/,
          inside: {
            // mixin parameters
            variable: /@+[\w-]+/
          }
        },
        property: /(?:@\{[\w-]+\}|[\w-])+(?:\+_?)?(?=\s*:)/,
        operator: /[+\-*\/]/
      });
      Prism.languages.insertBefore("less", "property", {
        variable: [
          // Variable declaration (the colon must be consumed!)
          {
            pattern: /@[\w-]+\s*:/,
            inside: {
              punctuation: /:/
            }
          },
          // Variable usage
          /@@?[\w-]+/
        ],
        "mixin-usage": {
          pattern: /([{;]\s*)[.#](?!\d)[\w-].*?(?=[(;])/,
          lookbehind: true,
          alias: "function"
        }
      });
    }
  }
});

export {
  require_less
};
//# sourceMappingURL=chunk-I6YLGWD6.js.map
