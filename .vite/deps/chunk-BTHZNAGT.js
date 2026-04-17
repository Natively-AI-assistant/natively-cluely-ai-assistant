import {
  require_javadoclike
} from "./chunk-RQPJH5RL.js";
import {
  require_java
} from "./chunk-XKH43KEL.js";
import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/javadoc.js
var require_javadoc = __commonJS({
  "node_modules/refractor/lang/javadoc.js"(exports, module) {
    var refractorJava = require_java();
    var refractorJavadoclike = require_javadoclike();
    module.exports = javadoc;
    javadoc.displayName = "javadoc";
    javadoc.aliases = [];
    function javadoc(Prism) {
      Prism.register(refractorJava);
      Prism.register(refractorJavadoclike);
      (function(Prism2) {
        var codeLinePattern = /(^(?:[\t ]*(?:\*\s*)*))[^*\s].*$/m;
        var memberReference = /#\s*\w+(?:\s*\([^()]*\))?/.source;
        var reference = /(?:\b[a-zA-Z]\w+\s*\.\s*)*\b[A-Z]\w*(?:\s*<mem>)?|<mem>/.source.replace(
          /<mem>/g,
          function() {
            return memberReference;
          }
        );
        Prism2.languages.javadoc = Prism2.languages.extend("javadoclike", {});
        Prism2.languages.insertBefore("javadoc", "keyword", {
          reference: {
            pattern: RegExp(
              /(@(?:exception|link|linkplain|see|throws|value)\s+(?:\*\s*)?)/.source + "(?:" + reference + ")"
            ),
            lookbehind: true,
            inside: {
              function: {
                pattern: /(#\s*)\w+(?=\s*\()/,
                lookbehind: true
              },
              field: {
                pattern: /(#\s*)\w+/,
                lookbehind: true
              },
              namespace: {
                pattern: /\b(?:[a-z]\w*\s*\.\s*)+/,
                inside: {
                  punctuation: /\./
                }
              },
              "class-name": /\b[A-Z]\w*/,
              keyword: Prism2.languages.java.keyword,
              punctuation: /[#()[\],.]/
            }
          },
          "class-name": {
            // @param <T> the first generic type parameter
            pattern: /(@param\s+)<[A-Z]\w*>/,
            lookbehind: true,
            inside: {
              punctuation: /[.<>]/
            }
          },
          "code-section": [
            {
              pattern: /(\{@code\s+(?!\s))(?:[^\s{}]|\s+(?![\s}])|\{(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*\})+(?=\s*\})/,
              lookbehind: true,
              inside: {
                code: {
                  // there can't be any HTML inside of {@code} tags
                  pattern: codeLinePattern,
                  lookbehind: true,
                  inside: Prism2.languages.java,
                  alias: "language-java"
                }
              }
            },
            {
              pattern: /(<(code|pre|tt)>(?!<code>)\s*)\S(?:\S|\s+\S)*?(?=\s*<\/\2>)/,
              lookbehind: true,
              inside: {
                line: {
                  pattern: codeLinePattern,
                  lookbehind: true,
                  inside: {
                    // highlight HTML tags and entities
                    tag: Prism2.languages.markup.tag,
                    entity: Prism2.languages.markup.entity,
                    code: {
                      // everything else is Java code
                      pattern: /.+/,
                      inside: Prism2.languages.java,
                      alias: "language-java"
                    }
                  }
                }
              }
            }
          ],
          tag: Prism2.languages.markup.tag,
          entity: Prism2.languages.markup.entity
        });
        Prism2.languages.javadoclike.addSupport("java", Prism2.languages.javadoc);
      })(Prism);
    }
  }
});

export {
  require_javadoc
};
//# sourceMappingURL=chunk-BTHZNAGT.js.map
