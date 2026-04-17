import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/js-templates.js
var require_js_templates = __commonJS({
  "node_modules/refractor/lang/js-templates.js"(exports, module) {
    module.exports = jsTemplates;
    jsTemplates.displayName = "jsTemplates";
    jsTemplates.aliases = [];
    function jsTemplates(Prism) {
      ;
      (function(Prism2) {
        var templateString = Prism2.languages.javascript["template-string"];
        var templateLiteralPattern = templateString.pattern.source;
        var interpolationObject = templateString.inside["interpolation"];
        var interpolationPunctuationObject = interpolationObject.inside["interpolation-punctuation"];
        var interpolationPattern = interpolationObject.pattern.source;
        function createTemplate(language, tag) {
          if (!Prism2.languages[language]) {
            return void 0;
          }
          return {
            pattern: RegExp("((?:" + tag + ")\\s*)" + templateLiteralPattern),
            lookbehind: true,
            greedy: true,
            inside: {
              "template-punctuation": {
                pattern: /^`|`$/,
                alias: "string"
              },
              "embedded-code": {
                pattern: /[\s\S]+/,
                alias: language
              }
            }
          };
        }
        Prism2.languages.javascript["template-string"] = [
          // styled-jsx:
          //   css`a { color: #25F; }`
          // styled-components:
          //   styled.h1`color: red;`
          createTemplate(
            "css",
            /\b(?:styled(?:\([^)]*\))?(?:\s*\.\s*\w+(?:\([^)]*\))*)*|css(?:\s*\.\s*(?:global|resolve))?|createGlobalStyle|keyframes)/.source
          ),
          // html`<p></p>`
          // div.innerHTML = `<p></p>`
          createTemplate("html", /\bhtml|\.\s*(?:inner|outer)HTML\s*\+?=/.source),
          // svg`<path fill="#fff" d="M55.37 ..."/>`
          createTemplate("svg", /\bsvg/.source),
          // md`# h1`, markdown`## h2`
          createTemplate("markdown", /\b(?:markdown|md)/.source),
          // gql`...`, graphql`...`, graphql.experimental`...`
          createTemplate(
            "graphql",
            /\b(?:gql|graphql(?:\s*\.\s*experimental)?)/.source
          ),
          // sql`...`
          createTemplate("sql", /\bsql/.source),
          // vanilla template string
          templateString
        ].filter(Boolean);
        function getPlaceholder(counter, language) {
          return "___" + language.toUpperCase() + "_" + counter + "___";
        }
        function tokenizeWithHooks(code, grammar, language) {
          var env = {
            code,
            grammar,
            language
          };
          Prism2.hooks.run("before-tokenize", env);
          env.tokens = Prism2.tokenize(env.code, env.grammar);
          Prism2.hooks.run("after-tokenize", env);
          return env.tokens;
        }
        function tokenizeInterpolationExpression(expression) {
          var tempGrammar = {};
          tempGrammar["interpolation-punctuation"] = interpolationPunctuationObject;
          var tokens = Prism2.tokenize(expression, tempGrammar);
          if (tokens.length === 3) {
            var args = [1, 1];
            args.push.apply(
              args,
              tokenizeWithHooks(tokens[1], Prism2.languages.javascript, "javascript")
            );
            tokens.splice.apply(tokens, args);
          }
          return new Prism2.Token(
            "interpolation",
            tokens,
            interpolationObject.alias,
            expression
          );
        }
        function tokenizeEmbedded(code, grammar, language) {
          var _tokens = Prism2.tokenize(code, {
            interpolation: {
              pattern: RegExp(interpolationPattern),
              lookbehind: true
            }
          });
          var placeholderCounter = 0;
          var placeholderMap = {};
          var embeddedCode = _tokens.map(function(token) {
            if (typeof token === "string") {
              return token;
            } else {
              var interpolationExpression = token.content;
              var placeholder;
              while (code.indexOf(
                placeholder = getPlaceholder(placeholderCounter++, language)
              ) !== -1) {
              }
              placeholderMap[placeholder] = interpolationExpression;
              return placeholder;
            }
          }).join("");
          var embeddedTokens = tokenizeWithHooks(embeddedCode, grammar, language);
          var placeholders = Object.keys(placeholderMap);
          placeholderCounter = 0;
          function walkTokens(tokens) {
            for (var i = 0; i < tokens.length; i++) {
              if (placeholderCounter >= placeholders.length) {
                return;
              }
              var token = tokens[i];
              if (typeof token === "string" || typeof token.content === "string") {
                var placeholder = placeholders[placeholderCounter];
                var s = typeof token === "string" ? token : (
                  /** @type {string} */
                  token.content
                );
                var index = s.indexOf(placeholder);
                if (index !== -1) {
                  ++placeholderCounter;
                  var before = s.substring(0, index);
                  var middle = tokenizeInterpolationExpression(
                    placeholderMap[placeholder]
                  );
                  var after = s.substring(index + placeholder.length);
                  var replacement = [];
                  if (before) {
                    replacement.push(before);
                  }
                  replacement.push(middle);
                  if (after) {
                    var afterTokens = [after];
                    walkTokens(afterTokens);
                    replacement.push.apply(replacement, afterTokens);
                  }
                  if (typeof token === "string") {
                    tokens.splice.apply(tokens, [i, 1].concat(replacement));
                    i += replacement.length - 1;
                  } else {
                    token.content = replacement;
                  }
                }
              } else {
                var content = token.content;
                if (Array.isArray(content)) {
                  walkTokens(content);
                } else {
                  walkTokens([content]);
                }
              }
            }
          }
          walkTokens(embeddedTokens);
          return new Prism2.Token(
            language,
            embeddedTokens,
            "language-" + language,
            code
          );
        }
        var supportedLanguages = {
          javascript: true,
          js: true,
          typescript: true,
          ts: true,
          jsx: true,
          tsx: true
        };
        Prism2.hooks.add("after-tokenize", function(env) {
          if (!(env.language in supportedLanguages)) {
            return;
          }
          function findTemplateStrings(tokens) {
            for (var i = 0, l = tokens.length; i < l; i++) {
              var token = tokens[i];
              if (typeof token === "string") {
                continue;
              }
              var content = token.content;
              if (!Array.isArray(content)) {
                if (typeof content !== "string") {
                  findTemplateStrings([content]);
                }
                continue;
              }
              if (token.type === "template-string") {
                var embedded = content[1];
                if (content.length === 3 && typeof embedded !== "string" && embedded.type === "embedded-code") {
                  var code = stringContent(embedded);
                  var alias = embedded.alias;
                  var language = Array.isArray(alias) ? alias[0] : alias;
                  var grammar = Prism2.languages[language];
                  if (!grammar) {
                    continue;
                  }
                  content[1] = tokenizeEmbedded(code, grammar, language);
                }
              } else {
                findTemplateStrings(content);
              }
            }
          }
          findTemplateStrings(env.tokens);
        });
        function stringContent(value) {
          if (typeof value === "string") {
            return value;
          } else if (Array.isArray(value)) {
            return value.map(stringContent).join("");
          } else {
            return stringContent(value.content);
          }
        }
      })(Prism);
    }
  }
});

export {
  require_js_templates
};
//# sourceMappingURL=chunk-CYG2Z46O.js.map
