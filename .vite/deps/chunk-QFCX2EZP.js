import {
  require_bash
} from "./chunk-TN52UIDT.js";
import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/shell-session.js
var require_shell_session = __commonJS({
  "node_modules/refractor/lang/shell-session.js"(exports, module) {
    var refractorBash = require_bash();
    module.exports = shellSession;
    shellSession.displayName = "shellSession";
    shellSession.aliases = [];
    function shellSession(Prism) {
      Prism.register(refractorBash);
      (function(Prism2) {
        var strings = [
          // normal string
          /"(?:\\[\s\S]|\$\([^)]+\)|\$(?!\()|`[^`]+`|[^"\\`$])*"/.source,
          /'[^']*'/.source,
          /\$'(?:[^'\\]|\\[\s\S])*'/.source,
          // here doc
          // 2 capturing groups
          /<<-?\s*(["']?)(\w+)\1\s[\s\S]*?[\r\n]\2/.source
        ].join("|");
        Prism2.languages["shell-session"] = {
          command: {
            pattern: RegExp(
              // user info
              /^/.source + "(?:" + // <user> ":" ( <path> )?
              (/[^\s@:$#%*!/\\]+@[^\r\n@:$#%*!/\\]+(?::[^\0-\x1F$#%*?"<>:;|]+)?/.source + "|" + // <path>
              // Since the path pattern is quite general, we will require it to start with a special character to
              // prevent false positives.
              /[/~.][^\0-\x1F$#%*?"<>@:;|]*/.source) + ")?" + // shell symbol
              /[$#%](?=\s)/.source + // bash command
              /(?:[^\\\r\n \t'"<$]|[ \t](?:(?!#)|#.*$)|\\(?:[^\r]|\r\n?)|\$(?!')|<(?!<)|<<str>>)+/.source.replace(
                /<<str>>/g,
                function() {
                  return strings;
                }
              ),
              "m"
            ),
            greedy: true,
            inside: {
              info: {
                // foo@bar:~/files$ exit
                // foo@bar$ exit
                // ~/files$ exit
                pattern: /^[^#$%]+/,
                alias: "punctuation",
                inside: {
                  user: /^[^\s@:$#%*!/\\]+@[^\r\n@:$#%*!/\\]+/,
                  punctuation: /:/,
                  path: /[\s\S]+/
                }
              },
              bash: {
                pattern: /(^[$#%]\s*)\S[\s\S]*/,
                lookbehind: true,
                alias: "language-bash",
                inside: Prism2.languages.bash
              },
              "shell-symbol": {
                pattern: /^[$#%]/,
                alias: "important"
              }
            }
          },
          output: /.(?:.*(?:[\r\n]|.$))*/
        };
        Prism2.languages["sh-session"] = Prism2.languages["shellsession"] = Prism2.languages["shell-session"];
      })(Prism);
    }
  }
});

export {
  require_shell_session
};
//# sourceMappingURL=chunk-QFCX2EZP.js.map
