import {
  require_scheme
} from "./chunk-DWRIZ5CS.js";
import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/lilypond.js
var require_lilypond = __commonJS({
  "node_modules/refractor/lang/lilypond.js"(exports, module) {
    var refractorScheme = require_scheme();
    module.exports = lilypond;
    lilypond.displayName = "lilypond";
    lilypond.aliases = [];
    function lilypond(Prism) {
      Prism.register(refractorScheme);
      (function(Prism2) {
        var schemeExpression = /\((?:[^();"#\\]|\\[\s\S]|;.*(?!.)|"(?:[^"\\]|\\.)*"|#(?:\{(?:(?!#\})[\s\S])*#\}|[^{])|<expr>)*\)/.source;
        var recursivenessLog2 = 5;
        for (var i = 0; i < recursivenessLog2; i++) {
          schemeExpression = schemeExpression.replace(/<expr>/g, function() {
            return schemeExpression;
          });
        }
        schemeExpression = schemeExpression.replace(/<expr>/g, /[^\s\S]/.source);
        var lilypond2 = Prism2.languages.lilypond = {
          comment: /%(?:(?!\{).*|\{[\s\S]*?%\})/,
          "embedded-scheme": {
            pattern: RegExp(
              /(^|[=\s])#(?:"(?:[^"\\]|\\.)*"|[^\s()"]*(?:[^\s()]|<expr>))/.source.replace(
                /<expr>/g,
                function() {
                  return schemeExpression;
                }
              ),
              "m"
            ),
            lookbehind: true,
            greedy: true,
            inside: {
              scheme: {
                pattern: /^(#)[\s\S]+$/,
                lookbehind: true,
                alias: "language-scheme",
                inside: {
                  "embedded-lilypond": {
                    pattern: /#\{[\s\S]*?#\}/,
                    greedy: true,
                    inside: {
                      punctuation: /^#\{|#\}$/,
                      lilypond: {
                        pattern: /[\s\S]+/,
                        alias: "language-lilypond",
                        inside: null
                        // see below
                      }
                    }
                  },
                  rest: Prism2.languages.scheme
                }
              },
              punctuation: /#/
            }
          },
          string: {
            pattern: /"(?:[^"\\]|\\.)*"/,
            greedy: true
          },
          "class-name": {
            pattern: /(\\new\s+)[\w-]+/,
            lookbehind: true
          },
          keyword: {
            pattern: /\\[a-z][-\w]*/i,
            inside: {
              punctuation: /^\\/
            }
          },
          operator: /[=|]|<<|>>/,
          punctuation: {
            pattern: /(^|[a-z\d])(?:'+|,+|[_^]?-[_^]?(?:[-+^!>._]|(?=\d))|[_^]\.?|[.!])|[{}()[\]<>^~]|\\[()[\]<>\\!]|--|__/,
            lookbehind: true
          },
          number: /\b\d+(?:\/\d+)?\b/
        };
        lilypond2["embedded-scheme"].inside["scheme"].inside["embedded-lilypond"].inside["lilypond"].inside = lilypond2;
        Prism2.languages.ly = lilypond2;
      })(Prism);
    }
  }
});

export {
  require_lilypond
};
//# sourceMappingURL=chunk-M3G5LZ7U.js.map
