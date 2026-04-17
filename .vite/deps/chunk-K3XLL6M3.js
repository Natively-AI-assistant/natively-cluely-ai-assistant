import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/toml.js
var require_toml = __commonJS({
  "node_modules/refractor/lang/toml.js"(exports, module) {
    module.exports = toml;
    toml.displayName = "toml";
    toml.aliases = [];
    function toml(Prism) {
      ;
      (function(Prism2) {
        var key = /(?:[\w-]+|'[^'\n\r]*'|"(?:\\.|[^\\"\r\n])*")/.source;
        function insertKey(pattern) {
          return pattern.replace(/__/g, function() {
            return key;
          });
        }
        Prism2.languages.toml = {
          comment: {
            pattern: /#.*/,
            greedy: true
          },
          table: {
            pattern: RegExp(
              insertKey(
                /(^[\t ]*\[\s*(?:\[\s*)?)__(?:\s*\.\s*__)*(?=\s*\])/.source
              ),
              "m"
            ),
            lookbehind: true,
            greedy: true,
            alias: "class-name"
          },
          key: {
            pattern: RegExp(
              insertKey(/(^[\t ]*|[{,]\s*)__(?:\s*\.\s*__)*(?=\s*=)/.source),
              "m"
            ),
            lookbehind: true,
            greedy: true,
            alias: "property"
          },
          string: {
            pattern: /"""(?:\\[\s\S]|[^\\])*?"""|'''[\s\S]*?'''|'[^'\n\r]*'|"(?:\\.|[^\\"\r\n])*"/,
            greedy: true
          },
          date: [
            {
              // Offset Date-Time, Local Date-Time, Local Date
              pattern: /\b\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?\b/i,
              alias: "number"
            },
            {
              // Local Time
              pattern: /\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/,
              alias: "number"
            }
          ],
          number: /(?:\b0(?:x[\da-zA-Z]+(?:_[\da-zA-Z]+)*|o[0-7]+(?:_[0-7]+)*|b[10]+(?:_[10]+)*))\b|[-+]?\b\d+(?:_\d+)*(?:\.\d+(?:_\d+)*)?(?:[eE][+-]?\d+(?:_\d+)*)?\b|[-+]?\b(?:inf|nan)\b/,
          boolean: /\b(?:false|true)\b/,
          punctuation: /[.,=[\]{}]/
        };
      })(Prism);
    }
  }
});

export {
  require_toml
};
//# sourceMappingURL=chunk-K3XLL6M3.js.map
