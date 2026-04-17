import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/makefile.js
var require_makefile = __commonJS({
  "node_modules/refractor/lang/makefile.js"(exports, module) {
    module.exports = makefile;
    makefile.displayName = "makefile";
    makefile.aliases = [];
    function makefile(Prism) {
      Prism.languages.makefile = {
        comment: {
          pattern: /(^|[^\\])#(?:\\(?:\r\n|[\s\S])|[^\\\r\n])*/,
          lookbehind: true
        },
        string: {
          pattern: /(["'])(?:\\(?:\r\n|[\s\S])|(?!\1)[^\\\r\n])*\1/,
          greedy: true
        },
        "builtin-target": {
          pattern: /\.[A-Z][^:#=\s]+(?=\s*:(?!=))/,
          alias: "builtin"
        },
        target: {
          pattern: /^(?:[^:=\s]|[ \t]+(?![\s:]))+(?=\s*:(?!=))/m,
          alias: "symbol",
          inside: {
            variable: /\$+(?:(?!\$)[^(){}:#=\s]+|(?=[({]))/
          }
        },
        variable: /\$+(?:(?!\$)[^(){}:#=\s]+|\([@*%<^+?][DF]\)|(?=[({]))/,
        // Directives
        keyword: /-include\b|\b(?:define|else|endef|endif|export|ifn?def|ifn?eq|include|override|private|sinclude|undefine|unexport|vpath)\b/,
        function: {
          pattern: /(\()(?:abspath|addsuffix|and|basename|call|dir|error|eval|file|filter(?:-out)?|findstring|firstword|flavor|foreach|guile|if|info|join|lastword|load|notdir|or|origin|patsubst|realpath|shell|sort|strip|subst|suffix|value|warning|wildcard|word(?:list|s)?)(?=[ \t])/,
          lookbehind: true
        },
        operator: /(?:::|[?:+!])?=|[|@]/,
        punctuation: /[:;(){}]/
      };
    }
  }
});

export {
  require_makefile
};
//# sourceMappingURL=chunk-5WA7LTEZ.js.map
