import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/graphql.js
var require_graphql = __commonJS({
  "node_modules/refractor/lang/graphql.js"(exports, module) {
    module.exports = graphql;
    graphql.displayName = "graphql";
    graphql.aliases = [];
    function graphql(Prism) {
      Prism.languages.graphql = {
        comment: /#.*/,
        description: {
          pattern: /(?:"""(?:[^"]|(?!""")")*"""|"(?:\\.|[^\\"\r\n])*")(?=\s*[a-z_])/i,
          greedy: true,
          alias: "string",
          inside: {
            "language-markdown": {
              pattern: /(^"(?:"")?)(?!\1)[\s\S]+(?=\1$)/,
              lookbehind: true,
              inside: Prism.languages.markdown
            }
          }
        },
        string: {
          pattern: /"""(?:[^"]|(?!""")")*"""|"(?:\\.|[^\\"\r\n])*"/,
          greedy: true
        },
        number: /(?:\B-|\b)\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/i,
        boolean: /\b(?:false|true)\b/,
        variable: /\$[a-z_]\w*/i,
        directive: {
          pattern: /@[a-z_]\w*/i,
          alias: "function"
        },
        "attr-name": {
          pattern: /\b[a-z_]\w*(?=\s*(?:\((?:[^()"]|"(?:\\.|[^\\"\r\n])*")*\))?:)/i,
          greedy: true
        },
        "atom-input": {
          pattern: /\b[A-Z]\w*Input\b/,
          alias: "class-name"
        },
        scalar: /\b(?:Boolean|Float|ID|Int|String)\b/,
        constant: /\b[A-Z][A-Z_\d]*\b/,
        "class-name": {
          pattern: /(\b(?:enum|implements|interface|on|scalar|type|union)\s+|&\s*|:\s*|\[)[A-Z_]\w*/,
          lookbehind: true
        },
        fragment: {
          pattern: /(\bfragment\s+|\.{3}\s*(?!on\b))[a-zA-Z_]\w*/,
          lookbehind: true,
          alias: "function"
        },
        "definition-mutation": {
          pattern: /(\bmutation\s+)[a-zA-Z_]\w*/,
          lookbehind: true,
          alias: "function"
        },
        "definition-query": {
          pattern: /(\bquery\s+)[a-zA-Z_]\w*/,
          lookbehind: true,
          alias: "function"
        },
        keyword: /\b(?:directive|enum|extend|fragment|implements|input|interface|mutation|on|query|repeatable|scalar|schema|subscription|type|union)\b/,
        operator: /[!=|&]|\.{3}/,
        "property-query": /\w+(?=\s*\()/,
        object: /\w+(?=\s*\{)/,
        punctuation: /[!(){}\[\]:=,]/,
        property: /\w+/
      };
      Prism.hooks.add("after-tokenize", function afterTokenizeGraphql(env) {
        if (env.language !== "graphql") {
          return;
        }
        var validTokens = env.tokens.filter(function(token) {
          return typeof token !== "string" && token.type !== "comment" && token.type !== "scalar";
        });
        var currentIndex = 0;
        function getToken(offset) {
          return validTokens[currentIndex + offset];
        }
        function isTokenType(types, offset) {
          offset = offset || 0;
          for (var i2 = 0; i2 < types.length; i2++) {
            var token = getToken(i2 + offset);
            if (!token || token.type !== types[i2]) {
              return false;
            }
          }
          return true;
        }
        function findClosingBracket(open, close) {
          var stackHeight = 1;
          for (var i2 = currentIndex; i2 < validTokens.length; i2++) {
            var token = validTokens[i2];
            var content = token.content;
            if (token.type === "punctuation" && typeof content === "string") {
              if (open.test(content)) {
                stackHeight++;
              } else if (close.test(content)) {
                stackHeight--;
                if (stackHeight === 0) {
                  return i2;
                }
              }
            }
          }
          return -1;
        }
        function addAlias(token, alias) {
          var aliases = token.alias;
          if (!aliases) {
            token.alias = aliases = [];
          } else if (!Array.isArray(aliases)) {
            token.alias = aliases = [aliases];
          }
          aliases.push(alias);
        }
        for (; currentIndex < validTokens.length; ) {
          var startToken = validTokens[currentIndex++];
          if (startToken.type === "keyword" && startToken.content === "mutation") {
            var inputVariables = [];
            if (isTokenType(["definition-mutation", "punctuation"]) && getToken(1).content === "(") {
              currentIndex += 2;
              var definitionEnd = findClosingBracket(/^\($/, /^\)$/);
              if (definitionEnd === -1) {
                continue;
              }
              for (; currentIndex < definitionEnd; currentIndex++) {
                var t = getToken(0);
                if (t.type === "variable") {
                  addAlias(t, "variable-input");
                  inputVariables.push(t.content);
                }
              }
              currentIndex = definitionEnd + 1;
            }
            if (isTokenType(["punctuation", "property-query"]) && getToken(0).content === "{") {
              currentIndex++;
              addAlias(getToken(0), "property-mutation");
              if (inputVariables.length > 0) {
                var mutationEnd = findClosingBracket(/^\{$/, /^\}$/);
                if (mutationEnd === -1) {
                  continue;
                }
                for (var i = currentIndex; i < mutationEnd; i++) {
                  var varToken = validTokens[i];
                  if (varToken.type === "variable" && inputVariables.indexOf(varToken.content) >= 0) {
                    addAlias(varToken, "variable-input");
                  }
                }
              }
            }
          }
        }
      });
    }
  }
});

export {
  require_graphql
};
//# sourceMappingURL=chunk-OO6GJHB4.js.map
