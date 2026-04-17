import {
  require_typescript
} from "./chunk-KGSFBCT4.js";
import {
  require_javadoclike
} from "./chunk-RQPJH5RL.js";
import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/jsdoc.js
var require_jsdoc = __commonJS({
  "node_modules/refractor/lang/jsdoc.js"(exports, module) {
    var refractorJavadoclike = require_javadoclike();
    var refractorTypescript = require_typescript();
    module.exports = jsdoc;
    jsdoc.displayName = "jsdoc";
    jsdoc.aliases = [];
    function jsdoc(Prism) {
      Prism.register(refractorJavadoclike);
      Prism.register(refractorTypescript);
      (function(Prism2) {
        var javascript = Prism2.languages.javascript;
        var type = /\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})+\}/.source;
        var parameterPrefix = "(@(?:arg|argument|param|property)\\s+(?:" + type + "\\s+)?)";
        Prism2.languages.jsdoc = Prism2.languages.extend("javadoclike", {
          parameter: {
            // @param {string} foo - foo bar
            pattern: RegExp(
              parameterPrefix + /(?:(?!\s)[$\w\xA0-\uFFFF.])+(?=\s|$)/.source
            ),
            lookbehind: true,
            inside: {
              punctuation: /\./
            }
          }
        });
        Prism2.languages.insertBefore("jsdoc", "keyword", {
          "optional-parameter": {
            // @param {string} [baz.foo="bar"] foo bar
            pattern: RegExp(
              parameterPrefix + /\[(?:(?!\s)[$\w\xA0-\uFFFF.])+(?:=[^[\]]+)?\](?=\s|$)/.source
            ),
            lookbehind: true,
            inside: {
              parameter: {
                pattern: /(^\[)[$\w\xA0-\uFFFF\.]+/,
                lookbehind: true,
                inside: {
                  punctuation: /\./
                }
              },
              code: {
                pattern: /(=)[\s\S]*(?=\]$)/,
                lookbehind: true,
                inside: javascript,
                alias: "language-javascript"
              },
              punctuation: /[=[\]]/
            }
          },
          "class-name": [
            {
              pattern: RegExp(
                /(@(?:augments|class|extends|interface|memberof!?|template|this|typedef)\s+(?:<TYPE>\s+)?)[A-Z]\w*(?:\.[A-Z]\w*)*/.source.replace(
                  /<TYPE>/g,
                  function() {
                    return type;
                  }
                )
              ),
              lookbehind: true,
              inside: {
                punctuation: /\./
              }
            },
            {
              pattern: RegExp("(@[a-z]+\\s+)" + type),
              lookbehind: true,
              inside: {
                string: javascript.string,
                number: javascript.number,
                boolean: javascript.boolean,
                keyword: Prism2.languages.typescript.keyword,
                operator: /=>|\.\.\.|[&|?:*]/,
                punctuation: /[.,;=<>{}()[\]]/
              }
            }
          ],
          example: {
            pattern: /(@example\s+(?!\s))(?:[^@\s]|\s+(?!\s))+?(?=\s*(?:\*\s*)?(?:@\w|\*\/))/,
            lookbehind: true,
            inside: {
              code: {
                pattern: /^([\t ]*(?:\*\s*)?)\S.*$/m,
                lookbehind: true,
                inside: javascript,
                alias: "language-javascript"
              }
            }
          }
        });
        Prism2.languages.javadoclike.addSupport("javascript", Prism2.languages.jsdoc);
      })(Prism);
    }
  }
});

export {
  require_jsdoc
};
//# sourceMappingURL=chunk-TCPUZC6J.js.map
