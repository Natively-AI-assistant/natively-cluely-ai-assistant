import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/yaml.js
var require_yaml = __commonJS({
  "node_modules/refractor/lang/yaml.js"(exports, module) {
    module.exports = yaml;
    yaml.displayName = "yaml";
    yaml.aliases = ["yml"];
    function yaml(Prism) {
      ;
      (function(Prism2) {
        var anchorOrAlias = /[*&][^\s[\]{},]+/;
        var tag = /!(?:<[\w\-%#;/?:@&=+$,.!~*'()[\]]+>|(?:[a-zA-Z\d-]*!)?[\w\-%#;/?:@&=+$.~*'()]+)?/;
        var properties = "(?:" + tag.source + "(?:[ 	]+" + anchorOrAlias.source + ")?|" + anchorOrAlias.source + "(?:[ 	]+" + tag.source + ")?)";
        var plainKey = /(?:[^\s\x00-\x08\x0e-\x1f!"#%&'*,\-:>?@[\]`{|}\x7f-\x84\x86-\x9f\ud800-\udfff\ufffe\uffff]|[?:-]<PLAIN>)(?:[ \t]*(?:(?![#:])<PLAIN>|:<PLAIN>))*/.source.replace(
          /<PLAIN>/g,
          function() {
            return /[^\s\x00-\x08\x0e-\x1f,[\]{}\x7f-\x84\x86-\x9f\ud800-\udfff\ufffe\uffff]/.source;
          }
        );
        var string = /"(?:[^"\\\r\n]|\\.)*"|'(?:[^'\\\r\n]|\\.)*'/.source;
        function createValuePattern(value, flags) {
          flags = (flags || "").replace(/m/g, "") + "m";
          var pattern = /([:\-,[{]\s*(?:\s<<prop>>[ \t]+)?)(?:<<value>>)(?=[ \t]*(?:$|,|\]|\}|(?:[\r\n]\s*)?#))/.source.replace(/<<prop>>/g, function() {
            return properties;
          }).replace(/<<value>>/g, function() {
            return value;
          });
          return RegExp(pattern, flags);
        }
        Prism2.languages.yaml = {
          scalar: {
            pattern: RegExp(
              /([\-:]\s*(?:\s<<prop>>[ \t]+)?[|>])[ \t]*(?:((?:\r?\n|\r)[ \t]+)\S[^\r\n]*(?:\2[^\r\n]+)*)/.source.replace(
                /<<prop>>/g,
                function() {
                  return properties;
                }
              )
            ),
            lookbehind: true,
            alias: "string"
          },
          comment: /#.*/,
          key: {
            pattern: RegExp(
              /((?:^|[:\-,[{\r\n?])[ \t]*(?:<<prop>>[ \t]+)?)<<key>>(?=\s*:\s)/.source.replace(/<<prop>>/g, function() {
                return properties;
              }).replace(/<<key>>/g, function() {
                return "(?:" + plainKey + "|" + string + ")";
              })
            ),
            lookbehind: true,
            greedy: true,
            alias: "atrule"
          },
          directive: {
            pattern: /(^[ \t]*)%.+/m,
            lookbehind: true,
            alias: "important"
          },
          datetime: {
            pattern: createValuePattern(
              /\d{4}-\d\d?-\d\d?(?:[tT]|[ \t]+)\d\d?:\d{2}:\d{2}(?:\.\d*)?(?:[ \t]*(?:Z|[-+]\d\d?(?::\d{2})?))?|\d{4}-\d{2}-\d{2}|\d\d?:\d{2}(?::\d{2}(?:\.\d*)?)?/.source
            ),
            lookbehind: true,
            alias: "number"
          },
          boolean: {
            pattern: createValuePattern(/false|true/.source, "i"),
            lookbehind: true,
            alias: "important"
          },
          null: {
            pattern: createValuePattern(/null|~/.source, "i"),
            lookbehind: true,
            alias: "important"
          },
          string: {
            pattern: createValuePattern(string),
            lookbehind: true,
            greedy: true
          },
          number: {
            pattern: createValuePattern(
              /[+-]?(?:0x[\da-f]+|0o[0-7]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|\.inf|\.nan)/.source,
              "i"
            ),
            lookbehind: true
          },
          tag,
          important: anchorOrAlias,
          punctuation: /---|[:[\]{}\-,|>?]|\.\.\./
        };
        Prism2.languages.yml = Prism2.languages.yaml;
      })(Prism);
    }
  }
});

export {
  require_yaml
};
//# sourceMappingURL=chunk-7NMS2OYS.js.map
