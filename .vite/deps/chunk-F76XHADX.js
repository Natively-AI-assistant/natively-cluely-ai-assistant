import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/pug.js
var require_pug = __commonJS({
  "node_modules/refractor/lang/pug.js"(exports, module) {
    module.exports = pug;
    pug.displayName = "pug";
    pug.aliases = [];
    function pug(Prism) {
      ;
      (function(Prism2) {
        Prism2.languages.pug = {
          // Multiline stuff should appear before the rest
          // This handles both single-line and multi-line comments
          comment: {
            pattern: /(^([\t ]*))\/\/.*(?:(?:\r?\n|\r)\2[\t ].+)*/m,
            lookbehind: true
          },
          // All the tag-related part is in lookbehind
          // so that it can be highlighted by the "tag" pattern
          "multiline-script": {
            pattern: /(^([\t ]*)script\b.*\.[\t ]*)(?:(?:\r?\n|\r(?!\n))(?:\2[\t ].+|\s*?(?=\r?\n|\r)))+/m,
            lookbehind: true,
            inside: Prism2.languages.javascript
          },
          // See at the end of the file for known filters
          filter: {
            pattern: /(^([\t ]*)):.+(?:(?:\r?\n|\r(?!\n))(?:\2[\t ].+|\s*?(?=\r?\n|\r)))+/m,
            lookbehind: true,
            inside: {
              "filter-name": {
                pattern: /^:[\w-]+/,
                alias: "variable"
              },
              text: /\S[\s\S]*/
            }
          },
          "multiline-plain-text": {
            pattern: /(^([\t ]*)[\w\-#.]+\.[\t ]*)(?:(?:\r?\n|\r(?!\n))(?:\2[\t ].+|\s*?(?=\r?\n|\r)))+/m,
            lookbehind: true
          },
          markup: {
            pattern: /(^[\t ]*)<.+/m,
            lookbehind: true,
            inside: Prism2.languages.markup
          },
          doctype: {
            pattern: /((?:^|\n)[\t ]*)doctype(?: .+)?/,
            lookbehind: true
          },
          // This handle all conditional and loop keywords
          "flow-control": {
            pattern: /(^[\t ]*)(?:case|default|each|else|if|unless|when|while)\b(?: .+)?/m,
            lookbehind: true,
            inside: {
              each: {
                pattern: /^each .+? in\b/,
                inside: {
                  keyword: /\b(?:each|in)\b/,
                  punctuation: /,/
                }
              },
              branch: {
                pattern: /^(?:case|default|else|if|unless|when|while)\b/,
                alias: "keyword"
              },
              rest: Prism2.languages.javascript
            }
          },
          keyword: {
            pattern: /(^[\t ]*)(?:append|block|extends|include|prepend)\b.+/m,
            lookbehind: true
          },
          mixin: [
            // Declaration
            {
              pattern: /(^[\t ]*)mixin .+/m,
              lookbehind: true,
              inside: {
                keyword: /^mixin/,
                function: /\w+(?=\s*\(|\s*$)/,
                punctuation: /[(),.]/
              }
            },
            // Usage
            {
              pattern: /(^[\t ]*)\+.+/m,
              lookbehind: true,
              inside: {
                name: {
                  pattern: /^\+\w+/,
                  alias: "function"
                },
                rest: Prism2.languages.javascript
              }
            }
          ],
          script: {
            pattern: /(^[\t ]*script(?:(?:&[^(]+)?\([^)]+\))*[\t ]).+/m,
            lookbehind: true,
            inside: Prism2.languages.javascript
          },
          "plain-text": {
            pattern: /(^[\t ]*(?!-)[\w\-#.]*[\w\-](?:(?:&[^(]+)?\([^)]+\))*\/?[\t ]).+/m,
            lookbehind: true
          },
          tag: {
            pattern: /(^[\t ]*)(?!-)[\w\-#.]*[\w\-](?:(?:&[^(]+)?\([^)]+\))*\/?:?/m,
            lookbehind: true,
            inside: {
              attributes: [
                {
                  pattern: /&[^(]+\([^)]+\)/,
                  inside: Prism2.languages.javascript
                },
                {
                  pattern: /\([^)]+\)/,
                  inside: {
                    "attr-value": {
                      pattern: /(=\s*(?!\s))(?:\{[^}]*\}|[^,)\r\n]+)/,
                      lookbehind: true,
                      inside: Prism2.languages.javascript
                    },
                    "attr-name": /[\w-]+(?=\s*!?=|\s*[,)])/,
                    punctuation: /[!=(),]+/
                  }
                }
              ],
              punctuation: /:/,
              "attr-id": /#[\w\-]+/,
              "attr-class": /\.[\w\-]+/
            }
          },
          code: [
            {
              pattern: /(^[\t ]*(?:-|!?=)).+/m,
              lookbehind: true,
              inside: Prism2.languages.javascript
            }
          ],
          punctuation: /[.\-!=|]+/
        };
        var filter_pattern = /(^([\t ]*)):<filter_name>(?:(?:\r?\n|\r(?!\n))(?:\2[\t ].+|\s*?(?=\r?\n|\r)))+/.source;
        var filters = [
          {
            filter: "atpl",
            language: "twig"
          },
          {
            filter: "coffee",
            language: "coffeescript"
          },
          "ejs",
          "handlebars",
          "less",
          "livescript",
          "markdown",
          {
            filter: "sass",
            language: "scss"
          },
          "stylus"
        ];
        var all_filters = {};
        for (var i = 0, l = filters.length; i < l; i++) {
          var filter = filters[i];
          filter = typeof filter === "string" ? {
            filter,
            language: filter
          } : filter;
          if (Prism2.languages[filter.language]) {
            all_filters["filter-" + filter.filter] = {
              pattern: RegExp(
                filter_pattern.replace("<filter_name>", function() {
                  return filter.filter;
                }),
                "m"
              ),
              lookbehind: true,
              inside: {
                "filter-name": {
                  pattern: /^:[\w-]+/,
                  alias: "variable"
                },
                text: {
                  pattern: /\S[\s\S]*/,
                  alias: [filter.language, "language-" + filter.language],
                  inside: Prism2.languages[filter.language]
                }
              }
            };
          }
        }
        Prism2.languages.insertBefore("pug", "filter", all_filters);
      })(Prism);
    }
  }
});

export {
  require_pug
};
//# sourceMappingURL=chunk-F76XHADX.js.map
