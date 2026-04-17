import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/javadoclike.js
var require_javadoclike = __commonJS({
  "node_modules/refractor/lang/javadoclike.js"(exports, module) {
    module.exports = javadoclike;
    javadoclike.displayName = "javadoclike";
    javadoclike.aliases = [];
    function javadoclike(Prism) {
      ;
      (function(Prism2) {
        var javaDocLike = Prism2.languages.javadoclike = {
          parameter: {
            pattern: /(^[\t ]*(?:\/{3}|\*|\/\*\*)\s*@(?:arg|arguments|param)\s+)\w+/m,
            lookbehind: true
          },
          keyword: {
            // keywords are the first word in a line preceded be an `@` or surrounded by curly braces.
            // @word, {@word}
            pattern: /(^[\t ]*(?:\/{3}|\*|\/\*\*)\s*|\{)@[a-z][a-zA-Z-]+\b/m,
            lookbehind: true
          },
          punctuation: /[{}]/
        };
        function docCommentSupport(lang, callback) {
          var tokenName = "doc-comment";
          var grammar = Prism2.languages[lang];
          if (!grammar) {
            return;
          }
          var token = grammar[tokenName];
          if (!token) {
            var definition = {};
            definition[tokenName] = {
              pattern: /(^|[^\\])\/\*\*[^/][\s\S]*?(?:\*\/|$)/,
              lookbehind: true,
              alias: "comment"
            };
            grammar = Prism2.languages.insertBefore(lang, "comment", definition);
            token = grammar[tokenName];
          }
          if (token instanceof RegExp) {
            token = grammar[tokenName] = {
              pattern: token
            };
          }
          if (Array.isArray(token)) {
            for (var i = 0, l = token.length; i < l; i++) {
              if (token[i] instanceof RegExp) {
                token[i] = {
                  pattern: token[i]
                };
              }
              callback(token[i]);
            }
          } else {
            callback(token);
          }
        }
        function addSupport(languages, docLanguage) {
          if (typeof languages === "string") {
            languages = [languages];
          }
          languages.forEach(function(lang) {
            docCommentSupport(lang, function(pattern) {
              if (!pattern.inside) {
                pattern.inside = {};
              }
              pattern.inside.rest = docLanguage;
            });
          });
        }
        Object.defineProperty(javaDocLike, "addSupport", {
          value: addSupport
        });
        javaDocLike.addSupport(["java", "javascript", "php"], javaDocLike);
      })(Prism);
    }
  }
});

export {
  require_javadoclike
};
//# sourceMappingURL=chunk-RQPJH5RL.js.map
