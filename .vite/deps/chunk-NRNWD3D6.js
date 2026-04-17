import {
  require_markup_templating
} from "./chunk-LJM3UDLO.js";
import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/smarty.js
var require_smarty = __commonJS({
  "node_modules/refractor/lang/smarty.js"(exports, module) {
    var refractorMarkupTemplating = require_markup_templating();
    module.exports = smarty;
    smarty.displayName = "smarty";
    smarty.aliases = [];
    function smarty(Prism) {
      Prism.register(refractorMarkupTemplating);
      (function(Prism2) {
        Prism2.languages.smarty = {
          comment: {
            pattern: /^\{\*[\s\S]*?\*\}/,
            greedy: true
          },
          "embedded-php": {
            pattern: /^\{php\}[\s\S]*?\{\/php\}/,
            greedy: true,
            inside: {
              smarty: {
                pattern: /^\{php\}|\{\/php\}$/,
                inside: null
                // see below
              },
              php: {
                pattern: /[\s\S]+/,
                alias: "language-php",
                inside: Prism2.languages.php
              }
            }
          },
          string: [
            {
              pattern: /"(?:\\.|[^"\\\r\n])*"/,
              greedy: true,
              inside: {
                interpolation: {
                  pattern: /\{[^{}]*\}|`[^`]*`/,
                  inside: {
                    "interpolation-punctuation": {
                      pattern: /^[{`]|[`}]$/,
                      alias: "punctuation"
                    },
                    expression: {
                      pattern: /[\s\S]+/,
                      inside: null
                      // see below
                    }
                  }
                },
                variable: /\$\w+/
              }
            },
            {
              pattern: /'(?:\\.|[^'\\\r\n])*'/,
              greedy: true
            }
          ],
          keyword: {
            pattern: /(^\{\/?)[a-z_]\w*\b(?!\()/i,
            lookbehind: true,
            greedy: true
          },
          delimiter: {
            pattern: /^\{\/?|\}$/,
            greedy: true,
            alias: "punctuation"
          },
          number: /\b0x[\dA-Fa-f]+|(?:\b\d+(?:\.\d*)?|\B\.\d+)(?:[Ee][-+]?\d+)?/,
          variable: [
            /\$(?!\d)\w+/,
            /#(?!\d)\w+#/,
            {
              pattern: /(\.|->|\w\s*=)(?!\d)\w+\b(?!\()/,
              lookbehind: true
            },
            {
              pattern: /(\[)(?!\d)\w+(?=\])/,
              lookbehind: true
            }
          ],
          function: {
            pattern: /(\|\s*)@?[a-z_]\w*|\b[a-z_]\w*(?=\()/i,
            lookbehind: true
          },
          "attr-name": /\b[a-z_]\w*(?=\s*=)/i,
          boolean: /\b(?:false|no|off|on|true|yes)\b/,
          punctuation: /[\[\](){}.,:`]|->/,
          operator: [
            /[+\-*\/%]|==?=?|[!<>]=?|&&|\|\|?/,
            /\bis\s+(?:not\s+)?(?:div|even|odd)(?:\s+by)?\b/,
            /\b(?:and|eq|gt?e|gt|lt?e|lt|mod|neq?|not|or)\b/
          ]
        };
        Prism2.languages.smarty["embedded-php"].inside.smarty.inside = Prism2.languages.smarty;
        Prism2.languages.smarty.string[0].inside.interpolation.inside.expression.inside = Prism2.languages.smarty;
        var string = /"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'/;
        var smartyPattern = RegExp(
          // comments
          /\{\*[\s\S]*?\*\}/.source + "|" + // php tags
          /\{php\}[\s\S]*?\{\/php\}/.source + "|" + // smarty blocks
          /\{(?:[^{}"']|<str>|\{(?:[^{}"']|<str>|\{(?:[^{}"']|<str>)*\})*\})*\}/.source.replace(
            /<str>/g,
            function() {
              return string.source;
            }
          ),
          "g"
        );
        Prism2.hooks.add("before-tokenize", function(env) {
          var smartyLiteralStart = "{literal}";
          var smartyLiteralEnd = "{/literal}";
          var smartyLiteralMode = false;
          Prism2.languages["markup-templating"].buildPlaceholders(
            env,
            "smarty",
            smartyPattern,
            function(match) {
              if (match === smartyLiteralEnd) {
                smartyLiteralMode = false;
              }
              if (!smartyLiteralMode) {
                if (match === smartyLiteralStart) {
                  smartyLiteralMode = true;
                }
                return true;
              }
              return false;
            }
          );
        });
        Prism2.hooks.add("after-tokenize", function(env) {
          Prism2.languages["markup-templating"].tokenizePlaceholders(env, "smarty");
        });
      })(Prism);
    }
  }
});

export {
  require_smarty
};
//# sourceMappingURL=chunk-NRNWD3D6.js.map
