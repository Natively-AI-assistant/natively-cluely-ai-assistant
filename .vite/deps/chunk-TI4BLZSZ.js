import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/java.js
var require_java = __commonJS({
  "node_modules/highlight.js/lib/languages/java.js"(exports, module) {
    var decimalDigits = "[0-9](_*[0-9])*";
    var frac = `\\.(${decimalDigits})`;
    var hexDigits = "[0-9a-fA-F](_*[0-9a-fA-F])*";
    var NUMERIC = {
      className: "number",
      variants: [
        // DecimalFloatingPointLiteral
        // including ExponentPart
        { begin: `(\\b(${decimalDigits})((${frac})|\\.)?|(${frac}))[eE][+-]?(${decimalDigits})[fFdD]?\\b` },
        // excluding ExponentPart
        { begin: `\\b(${decimalDigits})((${frac})[fFdD]?\\b|\\.([fFdD]\\b)?)` },
        { begin: `(${frac})[fFdD]?\\b` },
        { begin: `\\b(${decimalDigits})[fFdD]\\b` },
        // HexadecimalFloatingPointLiteral
        { begin: `\\b0[xX]((${hexDigits})\\.?|(${hexDigits})?\\.(${hexDigits}))[pP][+-]?(${decimalDigits})[fFdD]?\\b` },
        // DecimalIntegerLiteral
        { begin: "\\b(0|[1-9](_*[0-9])*)[lL]?\\b" },
        // HexIntegerLiteral
        { begin: `\\b0[xX](${hexDigits})[lL]?\\b` },
        // OctalIntegerLiteral
        { begin: "\\b0(_*[0-7])*[lL]?\\b" },
        // BinaryIntegerLiteral
        { begin: "\\b0[bB][01](_*[01])*[lL]?\\b" }
      ],
      relevance: 0
    };
    function java(hljs) {
      var JAVA_IDENT_RE = "[À-ʸa-zA-Z_$][À-ʸa-zA-Z_$0-9]*";
      var GENERIC_IDENT_RE = JAVA_IDENT_RE + "(<" + JAVA_IDENT_RE + "(\\s*,\\s*" + JAVA_IDENT_RE + ")*>)?";
      var KEYWORDS = "false synchronized int abstract float private char boolean var static null if const for true while long strictfp finally protected import native final void enum else break transient catch instanceof byte super volatile case assert short package default double public try this switch continue throws protected public private module requires exports do";
      var ANNOTATION = {
        className: "meta",
        begin: "@" + JAVA_IDENT_RE,
        contains: [
          {
            begin: /\(/,
            end: /\)/,
            contains: ["self"]
            // allow nested () inside our annotation
          }
        ]
      };
      const NUMBER = NUMERIC;
      return {
        name: "Java",
        aliases: ["jsp"],
        keywords: KEYWORDS,
        illegal: /<\/|#/,
        contains: [
          hljs.COMMENT(
            "/\\*\\*",
            "\\*/",
            {
              relevance: 0,
              contains: [
                {
                  // eat up @'s in emails to prevent them to be recognized as doctags
                  begin: /\w+@/,
                  relevance: 0
                },
                {
                  className: "doctag",
                  begin: "@[A-Za-z]+"
                }
              ]
            }
          ),
          // relevance boost
          {
            begin: /import java\.[a-z]+\./,
            keywords: "import",
            relevance: 2
          },
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          hljs.APOS_STRING_MODE,
          hljs.QUOTE_STRING_MODE,
          {
            className: "class",
            beginKeywords: "class interface enum",
            end: /[{;=]/,
            excludeEnd: true,
            // TODO: can this be removed somehow?
            // an extra boost because Java is more popular than other languages with
            // this same syntax feature (this is just to preserve our tests passing
            // for now)
            relevance: 1,
            keywords: "class interface enum",
            illegal: /[:"\[\]]/,
            contains: [
              { beginKeywords: "extends implements" },
              hljs.UNDERSCORE_TITLE_MODE
            ]
          },
          {
            // Expression keywords prevent 'keyword Name(...)' from being
            // recognized as a function definition
            beginKeywords: "new throw return else",
            relevance: 0
          },
          {
            className: "class",
            begin: "record\\s+" + hljs.UNDERSCORE_IDENT_RE + "\\s*\\(",
            returnBegin: true,
            excludeEnd: true,
            end: /[{;=]/,
            keywords: KEYWORDS,
            contains: [
              { beginKeywords: "record" },
              {
                begin: hljs.UNDERSCORE_IDENT_RE + "\\s*\\(",
                returnBegin: true,
                relevance: 0,
                contains: [hljs.UNDERSCORE_TITLE_MODE]
              },
              {
                className: "params",
                begin: /\(/,
                end: /\)/,
                keywords: KEYWORDS,
                relevance: 0,
                contains: [
                  hljs.C_BLOCK_COMMENT_MODE
                ]
              },
              hljs.C_LINE_COMMENT_MODE,
              hljs.C_BLOCK_COMMENT_MODE
            ]
          },
          {
            className: "function",
            begin: "(" + GENERIC_IDENT_RE + "\\s+)+" + hljs.UNDERSCORE_IDENT_RE + "\\s*\\(",
            returnBegin: true,
            end: /[{;=]/,
            excludeEnd: true,
            keywords: KEYWORDS,
            contains: [
              {
                begin: hljs.UNDERSCORE_IDENT_RE + "\\s*\\(",
                returnBegin: true,
                relevance: 0,
                contains: [hljs.UNDERSCORE_TITLE_MODE]
              },
              {
                className: "params",
                begin: /\(/,
                end: /\)/,
                keywords: KEYWORDS,
                relevance: 0,
                contains: [
                  ANNOTATION,
                  hljs.APOS_STRING_MODE,
                  hljs.QUOTE_STRING_MODE,
                  NUMBER,
                  hljs.C_BLOCK_COMMENT_MODE
                ]
              },
              hljs.C_LINE_COMMENT_MODE,
              hljs.C_BLOCK_COMMENT_MODE
            ]
          },
          NUMBER,
          ANNOTATION
        ]
      };
    }
    module.exports = java;
  }
});

export {
  require_java
};
//# sourceMappingURL=chunk-TI4BLZSZ.js.map
