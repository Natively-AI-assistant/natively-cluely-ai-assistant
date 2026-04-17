import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/vbnet.js
var require_vbnet = __commonJS({
  "node_modules/highlight.js/lib/languages/vbnet.js"(exports, module) {
    function source(re) {
      if (!re) return null;
      if (typeof re === "string") return re;
      return re.source;
    }
    function concat(...args) {
      const joined = args.map((x) => source(x)).join("");
      return joined;
    }
    function either(...args) {
      const joined = "(" + args.map((x) => source(x)).join("|") + ")";
      return joined;
    }
    function vbnet(hljs) {
      const CHARACTER = {
        className: "string",
        begin: /"(""|[^/n])"C\b/
      };
      const STRING = {
        className: "string",
        begin: /"/,
        end: /"/,
        illegal: /\n/,
        contains: [
          {
            // double quote escape
            begin: /""/
          }
        ]
      };
      const MM_DD_YYYY = /\d{1,2}\/\d{1,2}\/\d{4}/;
      const YYYY_MM_DD = /\d{4}-\d{1,2}-\d{1,2}/;
      const TIME_12H = /(\d|1[012])(:\d+){0,2} *(AM|PM)/;
      const TIME_24H = /\d{1,2}(:\d{1,2}){1,2}/;
      const DATE = {
        className: "literal",
        variants: [
          {
            // #YYYY-MM-DD# (ISO-Date) or #M/D/YYYY# (US-Date)
            begin: concat(/# */, either(YYYY_MM_DD, MM_DD_YYYY), / *#/)
          },
          {
            // #H:mm[:ss]# (24h Time)
            begin: concat(/# */, TIME_24H, / *#/)
          },
          {
            // #h[:mm[:ss]] A# (12h Time)
            begin: concat(/# */, TIME_12H, / *#/)
          },
          {
            // date plus time
            begin: concat(
              /# */,
              either(YYYY_MM_DD, MM_DD_YYYY),
              / +/,
              either(TIME_12H, TIME_24H),
              / *#/
            )
          }
        ]
      };
      const NUMBER = {
        className: "number",
        relevance: 0,
        variants: [
          {
            // Float
            begin: /\b\d[\d_]*((\.[\d_]+(E[+-]?[\d_]+)?)|(E[+-]?[\d_]+))[RFD@!#]?/
          },
          {
            // Integer (base 10)
            begin: /\b\d[\d_]*((U?[SIL])|[%&])?/
          },
          {
            // Integer (base 16)
            begin: /&H[\dA-F_]+((U?[SIL])|[%&])?/
          },
          {
            // Integer (base 8)
            begin: /&O[0-7_]+((U?[SIL])|[%&])?/
          },
          {
            // Integer (base 2)
            begin: /&B[01_]+((U?[SIL])|[%&])?/
          }
        ]
      };
      const LABEL = {
        className: "label",
        begin: /^\w+:/
      };
      const DOC_COMMENT = hljs.COMMENT(/'''/, /$/, {
        contains: [
          {
            className: "doctag",
            begin: /<\/?/,
            end: />/
          }
        ]
      });
      const COMMENT = hljs.COMMENT(null, /$/, {
        variants: [
          {
            begin: /'/
          },
          {
            // TODO: Use `beforeMatch:` for leading spaces
            begin: /([\t ]|^)REM(?=\s)/
          }
        ]
      });
      const DIRECTIVES = {
        className: "meta",
        // TODO: Use `beforeMatch:` for indentation once available
        begin: /[\t ]*#(const|disable|else|elseif|enable|end|externalsource|if|region)\b/,
        end: /$/,
        keywords: {
          "meta-keyword": "const disable else elseif enable end externalsource if region then"
        },
        contains: [COMMENT]
      };
      return {
        name: "Visual Basic .NET",
        aliases: ["vb"],
        case_insensitive: true,
        classNameAliases: {
          label: "symbol"
        },
        keywords: {
          keyword: "addhandler alias aggregate ansi as async assembly auto binary by byref byval call case catch class compare const continue custom declare default delegate dim distinct do each equals else elseif end enum erase error event exit explicit finally for friend from function get global goto group handles if implements imports in inherits interface into iterator join key let lib loop me mid module mustinherit mustoverride mybase myclass namespace narrowing new next notinheritable notoverridable of off on operator option optional order overloads overridable overrides paramarray partial preserve private property protected public raiseevent readonly redim removehandler resume return select set shadows shared skip static step stop structure strict sub synclock take text then throw to try unicode until using when where while widening with withevents writeonly yield",
          built_in: (
            // Operators https://docs.microsoft.com/dotnet/visual-basic/language-reference/operators
            "addressof and andalso await directcast gettype getxmlnamespace is isfalse isnot istrue like mod nameof new not or orelse trycast typeof xor cbool cbyte cchar cdate cdbl cdec cint clng cobj csbyte cshort csng cstr cuint culng cushort"
          ),
          type: (
            // Data types https://docs.microsoft.com/dotnet/visual-basic/language-reference/data-types
            "boolean byte char date decimal double integer long object sbyte short single string uinteger ulong ushort"
          ),
          literal: "true false nothing"
        },
        illegal: "//|\\{|\\}|endif|gosub|variant|wend|^\\$ ",
        contains: [
          CHARACTER,
          STRING,
          DATE,
          NUMBER,
          LABEL,
          DOC_COMMENT,
          COMMENT,
          DIRECTIVES
        ]
      };
    }
    module.exports = vbnet;
  }
});

export {
  require_vbnet
};
//# sourceMappingURL=chunk-ZXQ3EAKD.js.map
