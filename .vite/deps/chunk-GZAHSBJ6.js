import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/qml.js
var require_qml = __commonJS({
  "node_modules/refractor/lang/qml.js"(exports, module) {
    module.exports = qml;
    qml.displayName = "qml";
    qml.aliases = [];
    function qml(Prism) {
      ;
      (function(Prism2) {
        var jsString = /"(?:\\.|[^\\"\r\n])*"|'(?:\\.|[^\\'\r\n])*'/.source;
        var jsComment = /\/\/.*(?!.)|\/\*(?:[^*]|\*(?!\/))*\*\//.source;
        var jsExpr = /(?:[^\\()[\]{}"'/]|<string>|\/(?![*/])|<comment>|\(<expr>*\)|\[<expr>*\]|\{<expr>*\}|\\[\s\S])/.source.replace(/<string>/g, function() {
          return jsString;
        }).replace(/<comment>/g, function() {
          return jsComment;
        });
        for (var i = 0; i < 2; i++) {
          jsExpr = jsExpr.replace(/<expr>/g, function() {
            return jsExpr;
          });
        }
        jsExpr = jsExpr.replace(/<expr>/g, "[^\\s\\S]");
        Prism2.languages.qml = {
          comment: {
            pattern: /\/\/.*|\/\*[\s\S]*?\*\//,
            greedy: true
          },
          "javascript-function": {
            pattern: RegExp(
              /((?:^|;)[ \t]*)function\s+(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*\s*\(<js>*\)\s*\{<js>*\}/.source.replace(
                /<js>/g,
                function() {
                  return jsExpr;
                }
              ),
              "m"
            ),
            lookbehind: true,
            greedy: true,
            alias: "language-javascript",
            inside: Prism2.languages.javascript
          },
          "class-name": {
            pattern: /((?:^|[:;])[ \t]*)(?!\d)\w+(?=[ \t]*\{|[ \t]+on\b)/m,
            lookbehind: true
          },
          property: [
            {
              pattern: /((?:^|[;{])[ \t]*)(?!\d)\w+(?:\.\w+)*(?=[ \t]*:)/m,
              lookbehind: true
            },
            {
              pattern: /((?:^|[;{])[ \t]*)property[ \t]+(?!\d)\w+(?:\.\w+)*[ \t]+(?!\d)\w+(?:\.\w+)*(?=[ \t]*:)/m,
              lookbehind: true,
              inside: {
                keyword: /^property/,
                property: /\w+(?:\.\w+)*/
              }
            }
          ],
          "javascript-expression": {
            pattern: RegExp(
              /(:[ \t]*)(?![\s;}[])(?:(?!$|[;}])<js>)+/.source.replace(
                /<js>/g,
                function() {
                  return jsExpr;
                }
              ),
              "m"
            ),
            lookbehind: true,
            greedy: true,
            alias: "language-javascript",
            inside: Prism2.languages.javascript
          },
          string: {
            pattern: /"(?:\\.|[^\\"\r\n])*"/,
            greedy: true
          },
          keyword: /\b(?:as|import|on)\b/,
          punctuation: /[{}[\]:;,]/
        };
      })(Prism);
    }
  }
});

export {
  require_qml
};
//# sourceMappingURL=chunk-GZAHSBJ6.js.map
