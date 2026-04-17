import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/maxscript.js
var require_maxscript = __commonJS({
  "node_modules/refractor/lang/maxscript.js"(exports, module) {
    module.exports = maxscript;
    maxscript.displayName = "maxscript";
    maxscript.aliases = [];
    function maxscript(Prism) {
      ;
      (function(Prism2) {
        var keywords = /\b(?:about|and|animate|as|at|attributes|by|case|catch|collect|continue|coordsys|do|else|exit|fn|for|from|function|global|if|in|local|macroscript|mapped|max|not|of|off|on|or|parameters|persistent|plugin|rcmenu|return|rollout|set|struct|then|throw|to|tool|try|undo|utility|when|where|while|with)\b/i;
        Prism2.languages.maxscript = {
          comment: {
            pattern: /\/\*[\s\S]*?(?:\*\/|$)|--.*/,
            greedy: true
          },
          string: {
            pattern: /(^|[^"\\@])(?:"(?:[^"\\]|\\[\s\S])*"|@"[^"]*")/,
            lookbehind: true,
            greedy: true
          },
          path: {
            pattern: /\$(?:[\w/\\.*?]|'[^']*')*/,
            greedy: true,
            alias: "string"
          },
          "function-call": {
            pattern: RegExp(
              "((?:" + // start of line
              (/^/.source + "|" + // operators and other language constructs
              /[;=<>+\-*/^({\[]/.source + "|" + // keywords as part of statements
              /\b(?:and|by|case|catch|collect|do|else|if|in|not|or|return|then|to|try|where|while|with)\b/.source) + ")[ 	]*)(?!" + keywords.source + ")" + /[a-z_]\w*\b/.source + "(?=[ 	]*(?:" + // variable
              ("(?!" + keywords.source + ")" + /[a-z_]/.source + "|" + // number
              /\d|-\.?\d/.source + "|" + // other expressions or literals
              /[({'"$@#?]/.source) + "))",
              "im"
            ),
            lookbehind: true,
            greedy: true,
            alias: "function"
          },
          "function-definition": {
            pattern: /(\b(?:fn|function)\s+)\w+\b/i,
            lookbehind: true,
            alias: "function"
          },
          argument: {
            pattern: /\b[a-z_]\w*(?=:)/i,
            alias: "attr-name"
          },
          keyword: keywords,
          boolean: /\b(?:false|true)\b/,
          time: {
            pattern: /(^|[^\w.])(?:(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]\d+|[LP])?[msft])+|\d+:\d+(?:\.\d*)?)(?![\w.:])/,
            lookbehind: true,
            alias: "number"
          },
          number: [
            {
              pattern: /(^|[^\w.])(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eEdD][+-]\d+|[LP])?|0x[a-fA-F0-9]+)(?![\w.:])/,
              lookbehind: true
            },
            /\b(?:e|pi)\b/
          ],
          constant: /\b(?:dontcollect|ok|silentValue|undefined|unsupplied)\b/,
          color: {
            pattern: /\b(?:black|blue|brown|gray|green|orange|red|white|yellow)\b/i,
            alias: "constant"
          },
          operator: /[-+*/<>=!]=?|[&^?]|#(?!\()/,
          punctuation: /[()\[\]{}.:,;]|#(?=\()|\\$/m
        };
      })(Prism);
    }
  }
});

export {
  require_maxscript
};
//# sourceMappingURL=chunk-5XNDLZEI.js.map
