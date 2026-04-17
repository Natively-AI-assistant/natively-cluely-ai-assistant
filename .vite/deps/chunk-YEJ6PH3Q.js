import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/axapta.js
var require_axapta = __commonJS({
  "node_modules/highlight.js/lib/languages/axapta.js"(exports, module) {
    function axapta(hljs) {
      const BUILT_IN_KEYWORDS = [
        "anytype",
        "boolean",
        "byte",
        "char",
        "container",
        "date",
        "double",
        "enum",
        "guid",
        "int",
        "int64",
        "long",
        "real",
        "short",
        "str",
        "utcdatetime",
        "var"
      ];
      const LITERAL_KEYWORDS = [
        "default",
        "false",
        "null",
        "true"
      ];
      const NORMAL_KEYWORDS = [
        "abstract",
        "as",
        "asc",
        "avg",
        "break",
        "breakpoint",
        "by",
        "byref",
        "case",
        "catch",
        "changecompany",
        "class",
        "client",
        "client",
        "common",
        "const",
        "continue",
        "count",
        "crosscompany",
        "delegate",
        "delete_from",
        "desc",
        "display",
        "div",
        "do",
        "edit",
        "else",
        "eventhandler",
        "exists",
        "extends",
        "final",
        "finally",
        "firstfast",
        "firstonly",
        "firstonly1",
        "firstonly10",
        "firstonly100",
        "firstonly1000",
        "flush",
        "for",
        "forceliterals",
        "forcenestedloop",
        "forceplaceholders",
        "forceselectorder",
        "forupdate",
        "from",
        "generateonly",
        "group",
        "hint",
        "if",
        "implements",
        "in",
        "index",
        "insert_recordset",
        "interface",
        "internal",
        "is",
        "join",
        "like",
        "maxof",
        "minof",
        "mod",
        "namespace",
        "new",
        "next",
        "nofetch",
        "notexists",
        "optimisticlock",
        "order",
        "outer",
        "pessimisticlock",
        "print",
        "private",
        "protected",
        "public",
        "readonly",
        "repeatableread",
        "retry",
        "return",
        "reverse",
        "select",
        "server",
        "setting",
        "static",
        "sum",
        "super",
        "switch",
        "this",
        "throw",
        "try",
        "ttsabort",
        "ttsbegin",
        "ttscommit",
        "unchecked",
        "update_recordset",
        "using",
        "validtimestate",
        "void",
        "where",
        "while"
      ];
      const KEYWORDS = {
        keyword: NORMAL_KEYWORDS,
        built_in: BUILT_IN_KEYWORDS,
        literal: LITERAL_KEYWORDS
      };
      return {
        name: "X++",
        aliases: ["x++"],
        keywords: KEYWORDS,
        contains: [
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          hljs.APOS_STRING_MODE,
          hljs.QUOTE_STRING_MODE,
          hljs.C_NUMBER_MODE,
          {
            className: "meta",
            begin: "#",
            end: "$"
          },
          {
            className: "class",
            beginKeywords: "class interface",
            end: /\{/,
            excludeEnd: true,
            illegal: ":",
            contains: [
              {
                beginKeywords: "extends implements"
              },
              hljs.UNDERSCORE_TITLE_MODE
            ]
          }
        ]
      };
    }
    module.exports = axapta;
  }
});

export {
  require_axapta
};
//# sourceMappingURL=chunk-YEJ6PH3Q.js.map
