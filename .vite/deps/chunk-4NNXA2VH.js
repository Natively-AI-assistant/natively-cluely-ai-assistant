import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/systemd.js
var require_systemd = __commonJS({
  "node_modules/refractor/lang/systemd.js"(exports, module) {
    module.exports = systemd;
    systemd.displayName = "systemd";
    systemd.aliases = [];
    function systemd(Prism) {
      ;
      (function(Prism2) {
        var comment = {
          pattern: /^[;#].*/m,
          greedy: true
        };
        var quotesSource = /"(?:[^\r\n"\\]|\\(?:[^\r]|\r\n?))*"(?!\S)/.source;
        Prism2.languages.systemd = {
          comment,
          section: {
            pattern: /^\[[^\n\r\[\]]*\](?=[ \t]*$)/m,
            greedy: true,
            inside: {
              punctuation: /^\[|\]$/,
              "section-name": {
                pattern: /[\s\S]+/,
                alias: "selector"
              }
            }
          },
          key: {
            pattern: /^[^\s=]+(?=[ \t]*=)/m,
            greedy: true,
            alias: "attr-name"
          },
          value: {
            // This pattern is quite complex because of two properties:
            //  1) Quotes (strings) must be preceded by a space. Since we can't use lookbehinds, we have to "resolve"
            //     the lookbehind. You will see this in the main loop where spaces are handled separately.
            //  2) Line continuations.
            //     After line continuations, empty lines and comments are ignored so we have to consume them.
            pattern: RegExp(
              /(=[ \t]*(?!\s))/.source + // the value either starts with quotes or not
              "(?:" + quotesSource + '|(?=[^"\r\n]))(?:' + (/[^\s\\]/.source + // handle spaces separately because of quotes
              '|[ 	]+(?:(?![ 	"])|' + quotesSource + ")|" + /\\[\r\n]+(?:[#;].*[\r\n]+)*(?![#;])/.source) + ")*"
            ),
            lookbehind: true,
            greedy: true,
            alias: "attr-value",
            inside: {
              comment,
              quoted: {
                pattern: RegExp(/(^|\s)/.source + quotesSource),
                lookbehind: true,
                greedy: true
              },
              punctuation: /\\$/m,
              boolean: {
                pattern: /^(?:false|no|off|on|true|yes)$/,
                greedy: true
              }
            }
          },
          punctuation: /=/
        };
      })(Prism);
    }
  }
});

export {
  require_systemd
};
//# sourceMappingURL=chunk-4NNXA2VH.js.map
