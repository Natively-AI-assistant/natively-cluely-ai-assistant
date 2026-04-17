import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/lisp.js
var require_lisp = __commonJS({
  "node_modules/refractor/lang/lisp.js"(exports, module) {
    module.exports = lisp;
    lisp.displayName = "lisp";
    lisp.aliases = [];
    function lisp(Prism) {
      ;
      (function(Prism2) {
        function simple_form(name) {
          return RegExp(/(\()/.source + "(?:" + name + ")" + /(?=[\s\)])/.source);
        }
        function primitive(pattern) {
          return RegExp(
            /([\s([])/.source + "(?:" + pattern + ")" + /(?=[\s)])/.source
          );
        }
        var symbol = /(?!\d)[-+*/~!@$%^=<>{}\w]+/.source;
        var marker = "&" + symbol;
        var par = "(\\()";
        var endpar = "(?=\\))";
        var space = "(?=\\s)";
        var nestedPar = /(?:[^()]|\((?:[^()]|\((?:[^()]|\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\))*\))*\))*/.source;
        var language = {
          // Three or four semicolons are considered a heading.
          // See https://www.gnu.org/software/emacs/manual/html_node/elisp/Comment-Tips.html
          heading: {
            pattern: /;;;.*/,
            alias: ["comment", "title"]
          },
          comment: /;.*/,
          string: {
            pattern: /"(?:[^"\\]|\\.)*"/,
            greedy: true,
            inside: {
              argument: /[-A-Z]+(?=[.,\s])/,
              symbol: RegExp("`" + symbol + "'")
            }
          },
          "quoted-symbol": {
            pattern: RegExp("#?'" + symbol),
            alias: ["variable", "symbol"]
          },
          "lisp-property": {
            pattern: RegExp(":" + symbol),
            alias: "property"
          },
          splice: {
            pattern: RegExp(",@?" + symbol),
            alias: ["symbol", "variable"]
          },
          keyword: [
            {
              pattern: RegExp(
                par + "(?:and|(?:cl-)?letf|cl-loop|cond|cons|error|if|(?:lexical-)?let\\*?|message|not|null|or|provide|require|setq|unless|use-package|when|while)" + space
              ),
              lookbehind: true
            },
            {
              pattern: RegExp(
                par + "(?:append|by|collect|concat|do|finally|for|in|return)" + space
              ),
              lookbehind: true
            }
          ],
          declare: {
            pattern: simple_form(/declare/.source),
            lookbehind: true,
            alias: "keyword"
          },
          interactive: {
            pattern: simple_form(/interactive/.source),
            lookbehind: true,
            alias: "keyword"
          },
          boolean: {
            pattern: primitive(/nil|t/.source),
            lookbehind: true
          },
          number: {
            pattern: primitive(/[-+]?\d+(?:\.\d*)?/.source),
            lookbehind: true
          },
          defvar: {
            pattern: RegExp(par + "def(?:const|custom|group|var)\\s+" + symbol),
            lookbehind: true,
            inside: {
              keyword: /^def[a-z]+/,
              variable: RegExp(symbol)
            }
          },
          defun: {
            pattern: RegExp(
              par + /(?:cl-)?(?:defmacro|defun\*?)\s+/.source + symbol + /\s+\(/.source + nestedPar + /\)/.source
            ),
            lookbehind: true,
            greedy: true,
            inside: {
              keyword: /^(?:cl-)?def\S+/,
              // See below, this property needs to be defined later so that it can
              // reference the language object.
              arguments: null,
              function: {
                pattern: RegExp("(^\\s)" + symbol),
                lookbehind: true
              },
              punctuation: /[()]/
            }
          },
          lambda: {
            pattern: RegExp(
              par + "lambda\\s+\\(\\s*(?:&?" + symbol + "(?:\\s+&?" + symbol + ")*\\s*)?\\)"
            ),
            lookbehind: true,
            greedy: true,
            inside: {
              keyword: /^lambda/,
              // See below, this property needs to be defined later so that it can
              // reference the language object.
              arguments: null,
              punctuation: /[()]/
            }
          },
          car: {
            pattern: RegExp(par + symbol),
            lookbehind: true
          },
          punctuation: [
            // open paren, brackets, and close paren
            /(?:['`,]?\(|[)\[\]])/,
            // cons
            {
              pattern: /(\s)\.(?=\s)/,
              lookbehind: true
            }
          ]
        };
        var arg = {
          "lisp-marker": RegExp(marker),
          varform: {
            pattern: RegExp(
              /\(/.source + symbol + /\s+(?=\S)/.source + nestedPar + /\)/.source
            ),
            inside: language
          },
          argument: {
            pattern: RegExp(/(^|[\s(])/.source + symbol),
            lookbehind: true,
            alias: "variable"
          },
          rest: language
        };
        var forms = "\\S+(?:\\s+\\S+)*";
        var arglist = {
          pattern: RegExp(par + nestedPar + endpar),
          lookbehind: true,
          inside: {
            "rest-vars": {
              pattern: RegExp("&(?:body|rest)\\s+" + forms),
              inside: arg
            },
            "other-marker-vars": {
              pattern: RegExp("&(?:aux|optional)\\s+" + forms),
              inside: arg
            },
            keys: {
              pattern: RegExp("&key\\s+" + forms + "(?:\\s+&allow-other-keys)?"),
              inside: arg
            },
            argument: {
              pattern: RegExp(symbol),
              alias: "variable"
            },
            punctuation: /[()]/
          }
        };
        language["lambda"].inside.arguments = arglist;
        language["defun"].inside.arguments = Prism2.util.clone(arglist);
        language["defun"].inside.arguments.inside.sublist = arglist;
        Prism2.languages.lisp = language;
        Prism2.languages.elisp = language;
        Prism2.languages.emacs = language;
        Prism2.languages["emacs-lisp"] = language;
      })(Prism);
    }
  }
});

export {
  require_lisp
};
//# sourceMappingURL=chunk-3XAHUW5Y.js.map
