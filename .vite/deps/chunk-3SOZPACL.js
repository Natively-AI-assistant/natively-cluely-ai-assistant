import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/sml.js
var require_sml = __commonJS({
  "node_modules/refractor/lang/sml.js"(exports, module) {
    module.exports = sml;
    sml.displayName = "sml";
    sml.aliases = ["smlnj"];
    function sml(Prism) {
      ;
      (function(Prism2) {
        var keywords = /\b(?:abstype|and|andalso|as|case|datatype|do|else|end|eqtype|exception|fn|fun|functor|handle|if|in|include|infix|infixr|let|local|nonfix|of|op|open|orelse|raise|rec|sharing|sig|signature|struct|structure|then|type|val|where|while|with|withtype)\b/i;
        Prism2.languages.sml = {
          // allow one level of nesting
          comment: /\(\*(?:[^*(]|\*(?!\))|\((?!\*)|\(\*(?:[^*(]|\*(?!\))|\((?!\*))*\*\))*\*\)/,
          string: {
            pattern: /#?"(?:[^"\\]|\\.)*"/,
            greedy: true
          },
          "class-name": [
            {
              // This is only an approximation since the real grammar is context-free
              //
              // Why the main loop so complex?
              // The main loop is approximately the same as /(?:\s*(?:[*,]|->)\s*<TERMINAL>)*/ which is, obviously, a lot
              // simpler. The difference is that if a comma is the last iteration of the loop, then the terminal must be
              // followed by a long identifier.
              pattern: RegExp(
                /((?:^|[^:]):\s*)<TERMINAL>(?:\s*(?:(?:\*|->)\s*<TERMINAL>|,\s*<TERMINAL>(?:(?=<NOT-LAST>)|(?!<NOT-LAST>)\s+<LONG-ID>)))*/.source.replace(/<NOT-LAST>/g, function() {
                  return /\s*(?:[*,]|->)/.source;
                }).replace(/<TERMINAL>/g, function() {
                  return /(?:'[\w']*|<LONG-ID>|\((?:[^()]|\([^()]*\))*\)|\{(?:[^{}]|\{[^{}]*\})*\})(?:\s+<LONG-ID>)*/.source;
                }).replace(/<LONG-ID>/g, function() {
                  return /(?!<KEYWORD>)[a-z\d_][\w'.]*/.source;
                }).replace(/<KEYWORD>/g, function() {
                  return keywords.source;
                }),
                "i"
              ),
              lookbehind: true,
              greedy: true,
              inside: null
              // see below
            },
            {
              pattern: /((?:^|[^\w'])(?:datatype|exception|functor|signature|structure|type)\s+)[a-z_][\w'.]*/i,
              lookbehind: true
            }
          ],
          function: {
            pattern: /((?:^|[^\w'])fun\s+)[a-z_][\w'.]*/i,
            lookbehind: true
          },
          keyword: keywords,
          variable: {
            pattern: /(^|[^\w'])'[\w']*/,
            lookbehind: true
          },
          number: /~?\b(?:\d+(?:\.\d+)?(?:e~?\d+)?|0x[\da-f]+)\b/i,
          word: {
            pattern: /\b0w(?:\d+|x[\da-f]+)\b/i,
            alias: "constant"
          },
          boolean: /\b(?:false|true)\b/i,
          operator: /\.\.\.|:[>=:]|=>?|->|[<>]=?|[!+\-*/^#|@~]/,
          punctuation: /[(){}\[\].:,;]/
        };
        Prism2.languages.sml["class-name"][0].inside = Prism2.languages.sml;
        Prism2.languages.smlnj = Prism2.languages.sml;
      })(Prism);
    }
  }
});

export {
  require_sml
};
//# sourceMappingURL=chunk-3SOZPACL.js.map
