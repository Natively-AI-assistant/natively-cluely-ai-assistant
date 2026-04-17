import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/abnf.js
var require_abnf = __commonJS({
  "node_modules/refractor/lang/abnf.js"(exports, module) {
    module.exports = abnf;
    abnf.displayName = "abnf";
    abnf.aliases = [];
    function abnf(Prism) {
      ;
      (function(Prism2) {
        var coreRules = "(?:ALPHA|BIT|CHAR|CR|CRLF|CTL|DIGIT|DQUOTE|HEXDIG|HTAB|LF|LWSP|OCTET|SP|VCHAR|WSP)";
        Prism2.languages.abnf = {
          comment: /;.*/,
          string: {
            pattern: /(?:%[is])?"[^"\n\r]*"/,
            greedy: true,
            inside: {
              punctuation: /^%[is]/
            }
          },
          range: {
            pattern: /%(?:b[01]+-[01]+|d\d+-\d+|x[A-F\d]+-[A-F\d]+)/i,
            alias: "number"
          },
          terminal: {
            pattern: /%(?:b[01]+(?:\.[01]+)*|d\d+(?:\.\d+)*|x[A-F\d]+(?:\.[A-F\d]+)*)/i,
            alias: "number"
          },
          repetition: {
            pattern: /(^|[^\w-])(?:\d*\*\d*|\d+)/,
            lookbehind: true,
            alias: "operator"
          },
          definition: {
            pattern: /(^[ \t]*)(?:[a-z][\w-]*|<[^<>\r\n]*>)(?=\s*=)/m,
            lookbehind: true,
            alias: "keyword",
            inside: {
              punctuation: /<|>/
            }
          },
          "core-rule": {
            pattern: RegExp(
              "(?:(^|[^<\\w-])" + coreRules + "|<" + coreRules + ">)(?![\\w-])",
              "i"
            ),
            lookbehind: true,
            alias: ["rule", "constant"],
            inside: {
              punctuation: /<|>/
            }
          },
          rule: {
            pattern: /(^|[^<\w-])[a-z][\w-]*|<[^<>\r\n]*>/i,
            lookbehind: true,
            inside: {
              punctuation: /<|>/
            }
          },
          operator: /=\/?|\//,
          punctuation: /[()\[\]]/
        };
      })(Prism);
    }
  }
});

export {
  require_abnf
};
//# sourceMappingURL=chunk-JW6Q7SMI.js.map
