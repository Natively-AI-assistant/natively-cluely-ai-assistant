import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/promql.js
var require_promql = __commonJS({
  "node_modules/refractor/lang/promql.js"(exports, module) {
    module.exports = promql;
    promql.displayName = "promql";
    promql.aliases = [];
    function promql(Prism) {
      ;
      (function(Prism2) {
        var aggregations = [
          "sum",
          "min",
          "max",
          "avg",
          "group",
          "stddev",
          "stdvar",
          "count",
          "count_values",
          "bottomk",
          "topk",
          "quantile"
        ];
        var vectorMatching = [
          "on",
          "ignoring",
          "group_right",
          "group_left",
          "by",
          "without"
        ];
        var offsetModifier = ["offset"];
        var keywords = aggregations.concat(vectorMatching, offsetModifier);
        Prism2.languages.promql = {
          comment: {
            pattern: /(^[ \t]*)#.*/m,
            lookbehind: true
          },
          "vector-match": {
            // Match the comma-separated label lists inside vector matching:
            pattern: new RegExp(
              "((?:" + vectorMatching.join("|") + ")\\s*)\\([^)]*\\)"
            ),
            lookbehind: true,
            inside: {
              "label-key": {
                pattern: /\b[^,]+\b/,
                alias: "attr-name"
              },
              punctuation: /[(),]/
            }
          },
          "context-labels": {
            pattern: /\{[^{}]*\}/,
            inside: {
              "label-key": {
                pattern: /\b[a-z_]\w*(?=\s*(?:=|![=~]))/,
                alias: "attr-name"
              },
              "label-value": {
                pattern: /(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/,
                greedy: true,
                alias: "attr-value"
              },
              punctuation: /\{|\}|=~?|![=~]|,/
            }
          },
          "context-range": [
            {
              pattern: /\[[\w\s:]+\]/,
              // [1m]
              inside: {
                punctuation: /\[|\]|:/,
                "range-duration": {
                  pattern: /\b(?:\d+(?:[smhdwy]|ms))+\b/i,
                  alias: "number"
                }
              }
            },
            {
              pattern: /(\boffset\s+)\w+/,
              // offset 1m
              lookbehind: true,
              inside: {
                "range-duration": {
                  pattern: /\b(?:\d+(?:[smhdwy]|ms))+\b/i,
                  alias: "number"
                }
              }
            }
          ],
          keyword: new RegExp("\\b(?:" + keywords.join("|") + ")\\b", "i"),
          function: /\b[a-z_]\w*(?=\s*\()/i,
          number: /[-+]?(?:(?:\b\d+(?:\.\d+)?|\B\.\d+)(?:e[-+]?\d+)?\b|\b(?:0x[0-9a-f]+|nan|inf)\b)/i,
          operator: /[\^*/%+-]|==|!=|<=|<|>=|>|\b(?:and|or|unless)\b/i,
          punctuation: /[{};()`,.[\]]/
        };
      })(Prism);
    }
  }
});

export {
  require_promql
};
//# sourceMappingURL=chunk-BFMWROH7.js.map
