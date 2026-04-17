import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/qsharp.js
var require_qsharp = __commonJS({
  "node_modules/refractor/lang/qsharp.js"(exports, module) {
    module.exports = qsharp;
    qsharp.displayName = "qsharp";
    qsharp.aliases = ["qs"];
    function qsharp(Prism) {
      ;
      (function(Prism2) {
        function replace(pattern, replacements) {
          return pattern.replace(/<<(\d+)>>/g, function(m, index) {
            return "(?:" + replacements[+index] + ")";
          });
        }
        function re(pattern, replacements, flags) {
          return RegExp(replace(pattern, replacements), flags || "");
        }
        function nested(pattern, depthLog2) {
          for (var i = 0; i < depthLog2; i++) {
            pattern = pattern.replace(/<<self>>/g, function() {
              return "(?:" + pattern + ")";
            });
          }
          return pattern.replace(/<<self>>/g, "[^\\s\\S]");
        }
        var keywordKinds = {
          // keywords which represent a return or variable type
          type: "Adj BigInt Bool Ctl Double false Int One Pauli PauliI PauliX PauliY PauliZ Qubit Range Result String true Unit Zero",
          // all other keywords
          other: "Adjoint adjoint apply as auto body borrow borrowing Controlled controlled distribute elif else fail fixup for function if in internal intrinsic invert is let mutable namespace new newtype open operation repeat return self set until use using while within"
        };
        function keywordsToPattern(words) {
          return "\\b(?:" + words.trim().replace(/ /g, "|") + ")\\b";
        }
        var keywords = RegExp(
          keywordsToPattern(keywordKinds.type + " " + keywordKinds.other)
        );
        var identifier = /\b[A-Za-z_]\w*\b/.source;
        var qualifiedName = replace(/<<0>>(?:\s*\.\s*<<0>>)*/.source, [identifier]);
        var typeInside = {
          keyword: keywords,
          punctuation: /[<>()?,.:[\]]/
        };
        var regularString = /"(?:\\.|[^\\"])*"/.source;
        Prism2.languages.qsharp = Prism2.languages.extend("clike", {
          comment: /\/\/.*/,
          string: [
            {
              pattern: re(/(^|[^$\\])<<0>>/.source, [regularString]),
              lookbehind: true,
              greedy: true
            }
          ],
          "class-name": [
            {
              // open Microsoft.Quantum.Canon;
              // open Microsoft.Quantum.Canon as CN;
              pattern: re(/(\b(?:as|open)\s+)<<0>>(?=\s*(?:;|as\b))/.source, [
                qualifiedName
              ]),
              lookbehind: true,
              inside: typeInside
            },
            {
              // namespace Quantum.App1;
              pattern: re(/(\bnamespace\s+)<<0>>(?=\s*\{)/.source, [qualifiedName]),
              lookbehind: true,
              inside: typeInside
            }
          ],
          keyword: keywords,
          number: /(?:\b0(?:x[\da-f]+|b[01]+|o[0-7]+)|(?:\B\.\d+|\b\d+(?:\.\d*)?)(?:e[-+]?\d+)?)l?\b/i,
          operator: /\band=|\bor=|\band\b|\bnot\b|\bor\b|<[-=]|[-=]>|>>>=?|<<<=?|\^\^\^=?|\|\|\|=?|&&&=?|w\/=?|~~~|[*\/+\-^=!%]=?/,
          punctuation: /::|[{}[\];(),.:]/
        });
        Prism2.languages.insertBefore("qsharp", "number", {
          range: {
            pattern: /\.\./,
            alias: "operator"
          }
        });
        var interpolationExpr = nested(
          replace(/\{(?:[^"{}]|<<0>>|<<self>>)*\}/.source, [regularString]),
          2
        );
        Prism2.languages.insertBefore("qsharp", "string", {
          "interpolation-string": {
            pattern: re(/\$"(?:\\.|<<0>>|[^\\"{])*"/.source, [interpolationExpr]),
            greedy: true,
            inside: {
              interpolation: {
                pattern: re(/((?:^|[^\\])(?:\\\\)*)<<0>>/.source, [
                  interpolationExpr
                ]),
                lookbehind: true,
                inside: {
                  punctuation: /^\{|\}$/,
                  expression: {
                    pattern: /[\s\S]+/,
                    alias: "language-qsharp",
                    inside: Prism2.languages.qsharp
                  }
                }
              },
              string: /[\s\S]+/
            }
          }
        });
      })(Prism);
      Prism.languages.qs = Prism.languages.qsharp;
    }
  }
});

export {
  require_qsharp
};
//# sourceMappingURL=chunk-LFXEPDZU.js.map
