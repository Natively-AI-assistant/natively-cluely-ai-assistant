import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/pascaligo.js
var require_pascaligo = __commonJS({
  "node_modules/refractor/lang/pascaligo.js"(exports, module) {
    module.exports = pascaligo;
    pascaligo.displayName = "pascaligo";
    pascaligo.aliases = [];
    function pascaligo(Prism) {
      ;
      (function(Prism2) {
        var braces = /\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)/.source;
        var type = /(?:\b\w+(?:<braces>)?|<braces>)/.source.replace(
          /<braces>/g,
          function() {
            return braces;
          }
        );
        var pascaligo2 = Prism2.languages.pascaligo = {
          comment: /\(\*[\s\S]+?\*\)|\/\/.*/,
          string: {
            pattern: /(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1|\^[a-z]/i,
            greedy: true
          },
          "class-name": [
            {
              pattern: RegExp(
                /(\btype\s+\w+\s+is\s+)<type>/.source.replace(
                  /<type>/g,
                  function() {
                    return type;
                  }
                ),
                "i"
              ),
              lookbehind: true,
              inside: null
              // see below
            },
            {
              pattern: RegExp(
                /<type>(?=\s+is\b)/.source.replace(/<type>/g, function() {
                  return type;
                }),
                "i"
              ),
              inside: null
              // see below
            },
            {
              pattern: RegExp(
                /(:\s*)<type>/.source.replace(/<type>/g, function() {
                  return type;
                })
              ),
              lookbehind: true,
              inside: null
              // see below
            }
          ],
          keyword: {
            pattern: /(^|[^&])\b(?:begin|block|case|const|else|end|fail|for|from|function|if|is|nil|of|remove|return|skip|then|type|var|while|with)\b/i,
            lookbehind: true
          },
          boolean: {
            pattern: /(^|[^&])\b(?:False|True)\b/i,
            lookbehind: true
          },
          builtin: {
            pattern: /(^|[^&])\b(?:bool|int|list|map|nat|record|string|unit)\b/i,
            lookbehind: true
          },
          function: /\b\w+(?=\s*\()/,
          number: [
            // Hexadecimal, octal and binary
            /%[01]+|&[0-7]+|\$[a-f\d]+/i,
            // Decimal
            /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?(?:mtz|n)?/i
          ],
          operator: /->|=\/=|\.\.|\*\*|:=|<[<=>]?|>[>=]?|[+\-*\/]=?|[@^=|]|\b(?:and|mod|or)\b/,
          punctuation: /\(\.|\.\)|[()\[\]:;,.{}]/
        };
        var classNameInside = [
          "comment",
          "keyword",
          "builtin",
          "operator",
          "punctuation"
        ].reduce(function(accum, key) {
          accum[key] = pascaligo2[key];
          return accum;
        }, {});
        pascaligo2["class-name"].forEach(function(p) {
          p.inside = classNameInside;
        });
      })(Prism);
    }
  }
});

export {
  require_pascaligo
};
//# sourceMappingURL=chunk-VCXWIDUG.js.map
