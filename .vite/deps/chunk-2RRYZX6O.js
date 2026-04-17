import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/cal.js
var require_cal = __commonJS({
  "node_modules/highlight.js/lib/languages/cal.js"(exports, module) {
    function cal(hljs) {
      const KEYWORDS = "div mod in and or not xor asserterror begin case do downto else end exit for if of repeat then to until while with var";
      const LITERALS = "false true";
      const COMMENT_MODES = [
        hljs.C_LINE_COMMENT_MODE,
        hljs.COMMENT(
          /\{/,
          /\}/,
          {
            relevance: 0
          }
        ),
        hljs.COMMENT(
          /\(\*/,
          /\*\)/,
          {
            relevance: 10
          }
        )
      ];
      const STRING = {
        className: "string",
        begin: /'/,
        end: /'/,
        contains: [{
          begin: /''/
        }]
      };
      const CHAR_STRING = {
        className: "string",
        begin: /(#\d+)+/
      };
      const DATE = {
        className: "number",
        begin: "\\b\\d+(\\.\\d+)?(DT|D|T)",
        relevance: 0
      };
      const DBL_QUOTED_VARIABLE = {
        className: "string",
        // not a string technically but makes sense to be highlighted in the same style
        begin: '"',
        end: '"'
      };
      const PROCEDURE = {
        className: "function",
        beginKeywords: "procedure",
        end: /[:;]/,
        keywords: "procedure|10",
        contains: [
          hljs.TITLE_MODE,
          {
            className: "params",
            begin: /\(/,
            end: /\)/,
            keywords: KEYWORDS,
            contains: [
              STRING,
              CHAR_STRING
            ]
          }
        ].concat(COMMENT_MODES)
      };
      const OBJECT = {
        className: "class",
        begin: "OBJECT (Table|Form|Report|Dataport|Codeunit|XMLport|MenuSuite|Page|Query) (\\d+) ([^\\r\\n]+)",
        returnBegin: true,
        contains: [
          hljs.TITLE_MODE,
          PROCEDURE
        ]
      };
      return {
        name: "C/AL",
        case_insensitive: true,
        keywords: {
          keyword: KEYWORDS,
          literal: LITERALS
        },
        illegal: /\/\*/,
        contains: [
          STRING,
          CHAR_STRING,
          DATE,
          DBL_QUOTED_VARIABLE,
          hljs.NUMBER_MODE,
          OBJECT,
          PROCEDURE
        ]
      };
    }
    module.exports = cal;
  }
});

export {
  require_cal
};
//# sourceMappingURL=chunk-2RRYZX6O.js.map
