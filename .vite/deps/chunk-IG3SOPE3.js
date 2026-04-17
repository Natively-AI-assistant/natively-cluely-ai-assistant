import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/velocity.js
var require_velocity = __commonJS({
  "node_modules/refractor/lang/velocity.js"(exports, module) {
    module.exports = velocity;
    velocity.displayName = "velocity";
    velocity.aliases = [];
    function velocity(Prism) {
      ;
      (function(Prism2) {
        Prism2.languages.velocity = Prism2.languages.extend("markup", {});
        var velocity2 = {
          variable: {
            pattern: /(^|[^\\](?:\\\\)*)\$!?(?:[a-z][\w-]*(?:\([^)]*\))?(?:\.[a-z][\w-]*(?:\([^)]*\))?|\[[^\]]+\])*|\{[^}]+\})/i,
            lookbehind: true,
            inside: {}
            // See below
          },
          string: {
            pattern: /"[^"]*"|'[^']*'/,
            greedy: true
          },
          number: /\b\d+\b/,
          boolean: /\b(?:false|true)\b/,
          operator: /[=!<>]=?|[+*/%-]|&&|\|\||\.\.|\b(?:eq|g[et]|l[et]|n(?:e|ot))\b/,
          punctuation: /[(){}[\]:,.]/
        };
        velocity2.variable.inside = {
          string: velocity2["string"],
          function: {
            pattern: /([^\w-])[a-z][\w-]*(?=\()/,
            lookbehind: true
          },
          number: velocity2["number"],
          boolean: velocity2["boolean"],
          punctuation: velocity2["punctuation"]
        };
        Prism2.languages.insertBefore("velocity", "comment", {
          unparsed: {
            pattern: /(^|[^\\])#\[\[[\s\S]*?\]\]#/,
            lookbehind: true,
            greedy: true,
            inside: {
              punctuation: /^#\[\[|\]\]#$/
            }
          },
          "velocity-comment": [
            {
              pattern: /(^|[^\\])#\*[\s\S]*?\*#/,
              lookbehind: true,
              greedy: true,
              alias: "comment"
            },
            {
              pattern: /(^|[^\\])##.*/,
              lookbehind: true,
              greedy: true,
              alias: "comment"
            }
          ],
          directive: {
            pattern: /(^|[^\\](?:\\\\)*)#@?(?:[a-z][\w-]*|\{[a-z][\w-]*\})(?:\s*\((?:[^()]|\([^()]*\))*\))?/i,
            lookbehind: true,
            inside: {
              keyword: {
                pattern: /^#@?(?:[a-z][\w-]*|\{[a-z][\w-]*\})|\bin\b/,
                inside: {
                  punctuation: /[{}]/
                }
              },
              rest: velocity2
            }
          },
          variable: velocity2["variable"]
        });
        Prism2.languages.velocity["tag"].inside["attr-value"].inside.rest = Prism2.languages.velocity;
      })(Prism);
    }
  }
});

export {
  require_velocity
};
//# sourceMappingURL=chunk-IG3SOPE3.js.map
