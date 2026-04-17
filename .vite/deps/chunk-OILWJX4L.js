import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/qml.js
var require_qml = __commonJS({
  "node_modules/highlight.js/lib/languages/qml.js"(exports, module) {
    function source(re) {
      if (!re) return null;
      if (typeof re === "string") return re;
      return re.source;
    }
    function concat(...args) {
      const joined = args.map((x) => source(x)).join("");
      return joined;
    }
    function qml(hljs) {
      const KEYWORDS = {
        keyword: "in of on if for while finally var new function do return void else break catch instanceof with throw case default try this switch continue typeof delete let yield const export super debugger as async await import",
        literal: "true false null undefined NaN Infinity",
        built_in: "eval isFinite isNaN parseFloat parseInt decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape Object Function Boolean Error EvalError InternalError RangeError ReferenceError StopIteration SyntaxError TypeError URIError Number Math Date String RegExp Array Float32Array Float64Array Int16Array Int32Array Int8Array Uint16Array Uint32Array Uint8Array Uint8ClampedArray ArrayBuffer DataView JSON Intl arguments require module console window document Symbol Set Map WeakSet WeakMap Proxy Reflect Behavior bool color coordinate date double enumeration font geocircle georectangle geoshape int list matrix4x4 parent point quaternion real rect size string url variant vector2d vector3d vector4d Promise"
      };
      const QML_IDENT_RE = "[a-zA-Z_][a-zA-Z0-9\\._]*";
      const PROPERTY = {
        className: "keyword",
        begin: "\\bproperty\\b",
        starts: {
          className: "string",
          end: "(:|=|;|,|//|/\\*|$)",
          returnEnd: true
        }
      };
      const SIGNAL = {
        className: "keyword",
        begin: "\\bsignal\\b",
        starts: {
          className: "string",
          end: "(\\(|:|=|;|,|//|/\\*|$)",
          returnEnd: true
        }
      };
      const ID_ID = {
        className: "attribute",
        begin: "\\bid\\s*:",
        starts: {
          className: "string",
          end: QML_IDENT_RE,
          returnEnd: false
        }
      };
      const QML_ATTRIBUTE = {
        begin: QML_IDENT_RE + "\\s*:",
        returnBegin: true,
        contains: [
          {
            className: "attribute",
            begin: QML_IDENT_RE,
            end: "\\s*:",
            excludeEnd: true,
            relevance: 0
          }
        ],
        relevance: 0
      };
      const QML_OBJECT = {
        begin: concat(QML_IDENT_RE, /\s*\{/),
        end: /\{/,
        returnBegin: true,
        relevance: 0,
        contains: [
          hljs.inherit(hljs.TITLE_MODE, {
            begin: QML_IDENT_RE
          })
        ]
      };
      return {
        name: "QML",
        aliases: ["qt"],
        case_insensitive: false,
        keywords: KEYWORDS,
        contains: [
          {
            className: "meta",
            begin: /^\s*['"]use (strict|asm)['"]/
          },
          hljs.APOS_STRING_MODE,
          hljs.QUOTE_STRING_MODE,
          {
            // template string
            className: "string",
            begin: "`",
            end: "`",
            contains: [
              hljs.BACKSLASH_ESCAPE,
              {
                className: "subst",
                begin: "\\$\\{",
                end: "\\}"
              }
            ]
          },
          hljs.C_LINE_COMMENT_MODE,
          hljs.C_BLOCK_COMMENT_MODE,
          {
            className: "number",
            variants: [
              {
                begin: "\\b(0[bB][01]+)"
              },
              {
                begin: "\\b(0[oO][0-7]+)"
              },
              {
                begin: hljs.C_NUMBER_RE
              }
            ],
            relevance: 0
          },
          {
            // "value" container
            begin: "(" + hljs.RE_STARTERS_RE + "|\\b(case|return|throw)\\b)\\s*",
            keywords: "return throw case",
            contains: [
              hljs.C_LINE_COMMENT_MODE,
              hljs.C_BLOCK_COMMENT_MODE,
              hljs.REGEXP_MODE,
              {
                // E4X / JSX
                begin: /</,
                end: />\s*[);\]]/,
                relevance: 0,
                subLanguage: "xml"
              }
            ],
            relevance: 0
          },
          SIGNAL,
          PROPERTY,
          {
            className: "function",
            beginKeywords: "function",
            end: /\{/,
            excludeEnd: true,
            contains: [
              hljs.inherit(hljs.TITLE_MODE, {
                begin: /[A-Za-z$_][0-9A-Za-z$_]*/
              }),
              {
                className: "params",
                begin: /\(/,
                end: /\)/,
                excludeBegin: true,
                excludeEnd: true,
                contains: [
                  hljs.C_LINE_COMMENT_MODE,
                  hljs.C_BLOCK_COMMENT_MODE
                ]
              }
            ],
            illegal: /\[|%/
          },
          {
            // hack: prevents detection of keywords after dots
            begin: "\\." + hljs.IDENT_RE,
            relevance: 0
          },
          ID_ID,
          QML_ATTRIBUTE,
          QML_OBJECT
        ],
        illegal: /#/
      };
    }
    module.exports = qml;
  }
});

export {
  require_qml
};
//# sourceMappingURL=chunk-OILWJX4L.js.map
