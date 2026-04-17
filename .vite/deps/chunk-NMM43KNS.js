import {
  require_ruby
} from "./chunk-AIELURRL.js";
import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/haml.js
var require_haml = __commonJS({
  "node_modules/refractor/lang/haml.js"(exports, module) {
    var refractorRuby = require_ruby();
    module.exports = haml;
    haml.displayName = "haml";
    haml.aliases = [];
    function haml(Prism) {
      Prism.register(refractorRuby);
      (function(Prism2) {
        Prism2.languages.haml = {
          // Multiline stuff should appear before the rest
          "multiline-comment": {
            pattern: /((?:^|\r?\n|\r)([\t ]*))(?:\/|-#).*(?:(?:\r?\n|\r)\2[\t ].+)*/,
            lookbehind: true,
            alias: "comment"
          },
          "multiline-code": [
            {
              pattern: /((?:^|\r?\n|\r)([\t ]*)(?:[~-]|[&!]?=)).*,[\t ]*(?:(?:\r?\n|\r)\2[\t ].*,[\t ]*)*(?:(?:\r?\n|\r)\2[\t ].+)/,
              lookbehind: true,
              inside: Prism2.languages.ruby
            },
            {
              pattern: /((?:^|\r?\n|\r)([\t ]*)(?:[~-]|[&!]?=)).*\|[\t ]*(?:(?:\r?\n|\r)\2[\t ].*\|[\t ]*)*/,
              lookbehind: true,
              inside: Prism2.languages.ruby
            }
          ],
          // See at the end of the file for known filters
          filter: {
            pattern: /((?:^|\r?\n|\r)([\t ]*)):[\w-]+(?:(?:\r?\n|\r)(?:\2[\t ].+|\s*?(?=\r?\n|\r)))+/,
            lookbehind: true,
            inside: {
              "filter-name": {
                pattern: /^:[\w-]+/,
                alias: "symbol"
              }
            }
          },
          markup: {
            pattern: /((?:^|\r?\n|\r)[\t ]*)<.+/,
            lookbehind: true,
            inside: Prism2.languages.markup
          },
          doctype: {
            pattern: /((?:^|\r?\n|\r)[\t ]*)!!!(?: .+)?/,
            lookbehind: true
          },
          tag: {
            // Allows for one nested group of braces
            pattern: /((?:^|\r?\n|\r)[\t ]*)[%.#][\w\-#.]*[\w\-](?:\([^)]+\)|\{(?:\{[^}]+\}|[^{}])+\}|\[[^\]]+\])*[\/<>]*/,
            lookbehind: true,
            inside: {
              attributes: [
                {
                  // Lookbehind tries to prevent interpolations from breaking it all
                  // Allows for one nested group of braces
                  pattern: /(^|[^#])\{(?:\{[^}]+\}|[^{}])+\}/,
                  lookbehind: true,
                  inside: Prism2.languages.ruby
                },
                {
                  pattern: /\([^)]+\)/,
                  inside: {
                    "attr-value": {
                      pattern: /(=\s*)(?:"(?:\\.|[^\\"\r\n])*"|[^)\s]+)/,
                      lookbehind: true
                    },
                    "attr-name": /[\w:-]+(?=\s*!?=|\s*[,)])/,
                    punctuation: /[=(),]/
                  }
                },
                {
                  pattern: /\[[^\]]+\]/,
                  inside: Prism2.languages.ruby
                }
              ],
              punctuation: /[<>]/
            }
          },
          code: {
            pattern: /((?:^|\r?\n|\r)[\t ]*(?:[~-]|[&!]?=)).+/,
            lookbehind: true,
            inside: Prism2.languages.ruby
          },
          // Interpolations in plain text
          interpolation: {
            pattern: /#\{[^}]+\}/,
            inside: {
              delimiter: {
                pattern: /^#\{|\}$/,
                alias: "punctuation"
              },
              ruby: {
                pattern: /[\s\S]+/,
                inside: Prism2.languages.ruby
              }
            }
          },
          punctuation: {
            pattern: /((?:^|\r?\n|\r)[\t ]*)[~=\-&!]+/,
            lookbehind: true
          }
        };
        var filter_pattern = "((?:^|\\r?\\n|\\r)([\\t ]*)):{{filter_name}}(?:(?:\\r?\\n|\\r)(?:\\2[\\t ].+|\\s*?(?=\\r?\\n|\\r)))+";
        var filters = [
          "css",
          {
            filter: "coffee",
            language: "coffeescript"
          },
          "erb",
          "javascript",
          "less",
          "markdown",
          "ruby",
          "scss",
          "textile"
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
                filter_pattern.replace("{{filter_name}}", function() {
                  return filter.filter;
                })
              ),
              lookbehind: true,
              inside: {
                "filter-name": {
                  pattern: /^:[\w-]+/,
                  alias: "symbol"
                },
                text: {
                  pattern: /[\s\S]+/,
                  alias: [filter.language, "language-" + filter.language],
                  inside: Prism2.languages[filter.language]
                }
              }
            };
          }
        }
        Prism2.languages.insertBefore("haml", "filter", all_filters);
      })(Prism);
    }
  }
});

export {
  require_haml
};
//# sourceMappingURL=chunk-NMM43KNS.js.map
