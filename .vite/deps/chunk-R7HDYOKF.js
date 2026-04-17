import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/parser.js
var require_parser = __commonJS({
  "node_modules/refractor/lang/parser.js"(exports, module) {
    module.exports = parser;
    parser.displayName = "parser";
    parser.aliases = [];
    function parser(Prism) {
      ;
      (function(Prism2) {
        var parser2 = Prism2.languages.parser = Prism2.languages.extend("markup", {
          keyword: {
            pattern: /(^|[^^])(?:\^(?:case|eval|for|if|switch|throw)\b|@(?:BASE|CLASS|GET(?:_DEFAULT)?|OPTIONS|SET_DEFAULT|USE)\b)/,
            lookbehind: true
          },
          variable: {
            pattern: /(^|[^^])\B\$(?:\w+|(?=[.{]))(?:(?:\.|::?)\w+)*(?:\.|::?)?/,
            lookbehind: true,
            inside: {
              punctuation: /\.|:+/
            }
          },
          function: {
            pattern: /(^|[^^])\B[@^]\w+(?:(?:\.|::?)\w+)*(?:\.|::?)?/,
            lookbehind: true,
            inside: {
              keyword: {
                pattern: /(^@)(?:GET_|SET_)/,
                lookbehind: true
              },
              punctuation: /\.|:+/
            }
          },
          escape: {
            pattern: /\^(?:[$^;@()\[\]{}"':]|#[a-f\d]*)/i,
            alias: "builtin"
          },
          punctuation: /[\[\](){};]/
        });
        parser2 = Prism2.languages.insertBefore("parser", "keyword", {
          "parser-comment": {
            pattern: /(\s)#.*/,
            lookbehind: true,
            alias: "comment"
          },
          expression: {
            // Allow for 3 levels of depth
            pattern: /(^|[^^])\((?:[^()]|\((?:[^()]|\((?:[^()])*\))*\))*\)/,
            greedy: true,
            lookbehind: true,
            inside: {
              string: {
                pattern: /(^|[^^])(["'])(?:(?!\2)[^^]|\^[\s\S])*\2/,
                lookbehind: true
              },
              keyword: parser2.keyword,
              variable: parser2.variable,
              function: parser2.function,
              boolean: /\b(?:false|true)\b/,
              number: /\b(?:0x[a-f\d]+|\d+(?:\.\d*)?(?:e[+-]?\d+)?)\b/i,
              escape: parser2.escape,
              operator: /[~+*\/\\%]|!(?:\|\|?|=)?|&&?|\|\|?|==|<[<=]?|>[>=]?|-[fd]?|\b(?:def|eq|ge|gt|in|is|le|lt|ne)\b/,
              punctuation: parser2.punctuation
            }
          }
        });
        Prism2.languages.insertBefore(
          "inside",
          "punctuation",
          {
            expression: parser2.expression,
            keyword: parser2.keyword,
            variable: parser2.variable,
            function: parser2.function,
            escape: parser2.escape,
            "parser-punctuation": {
              pattern: parser2.punctuation,
              alias: "punctuation"
            }
          },
          parser2["tag"].inside["attr-value"]
        );
      })(Prism);
    }
  }
});

export {
  require_parser
};
//# sourceMappingURL=chunk-R7HDYOKF.js.map
