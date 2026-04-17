import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/vbscript.js
var require_vbscript = __commonJS({
  "node_modules/highlight.js/lib/languages/vbscript.js"(exports, module) {
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
    function vbscript(hljs) {
      const BUILT_IN_FUNCTIONS = "lcase month vartype instrrev ubound setlocale getobject rgb getref string weekdayname rnd dateadd monthname now day minute isarray cbool round formatcurrency conversions csng timevalue second year space abs clng timeserial fixs len asc isempty maths dateserial atn timer isobject filter weekday datevalue ccur isdate instr datediff formatdatetime replace isnull right sgn array snumeric log cdbl hex chr lbound msgbox ucase getlocale cos cdate cbyte rtrim join hour oct typename trim strcomp int createobject loadpicture tan formatnumber mid split  cint sin datepart ltrim sqr time derived eval date formatpercent exp inputbox left ascw chrw regexp cstr err".split(" ");
      const BUILT_IN_OBJECTS = [
        "server",
        "response",
        "request",
        // take no arguments so can be called without ()
        "scriptengine",
        "scriptenginebuildversion",
        "scriptengineminorversion",
        "scriptenginemajorversion"
      ];
      const BUILT_IN_CALL = {
        begin: concat(either(...BUILT_IN_FUNCTIONS), "\\s*\\("),
        // relevance 0 because this is acting as a beginKeywords really
        relevance: 0,
        keywords: {
          built_in: BUILT_IN_FUNCTIONS
        }
      };
      return {
        name: "VBScript",
        aliases: ["vbs"],
        case_insensitive: true,
        keywords: {
          keyword: "call class const dim do loop erase execute executeglobal exit for each next function if then else on error option explicit new private property let get public randomize redim rem select case set stop sub while wend with end to elseif is or xor and not class_initialize class_terminate default preserve in me byval byref step resume goto",
          built_in: BUILT_IN_OBJECTS,
          literal: "true false null nothing empty"
        },
        illegal: "//",
        contains: [
          BUILT_IN_CALL,
          hljs.inherit(hljs.QUOTE_STRING_MODE, { contains: [{ begin: '""' }] }),
          hljs.COMMENT(
            /'/,
            /$/,
            {
              relevance: 0
            }
          ),
          hljs.C_NUMBER_MODE
        ]
      };
    }
    module.exports = vbscript;
  }
});

export {
  require_vbscript
};
//# sourceMappingURL=chunk-AWXCIAGW.js.map
