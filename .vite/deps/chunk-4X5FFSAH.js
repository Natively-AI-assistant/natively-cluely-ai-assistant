import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/sass.js
var require_sass = __commonJS({
  "node_modules/refractor/lang/sass.js"(exports, module) {
    module.exports = sass;
    sass.displayName = "sass";
    sass.aliases = [];
    function sass(Prism) {
      ;
      (function(Prism2) {
        Prism2.languages.sass = Prism2.languages.extend("css", {
          // Sass comments don't need to be closed, only indented
          comment: {
            pattern: /^([ \t]*)\/[\/*].*(?:(?:\r?\n|\r)\1[ \t].+)*/m,
            lookbehind: true,
            greedy: true
          }
        });
        Prism2.languages.insertBefore("sass", "atrule", {
          // We want to consume the whole line
          "atrule-line": {
            // Includes support for = and + shortcuts
            pattern: /^(?:[ \t]*)[@+=].+/m,
            greedy: true,
            inside: {
              atrule: /(?:@[\w-]+|[+=])/
            }
          }
        });
        delete Prism2.languages.sass.atrule;
        var variable = /\$[-\w]+|#\{\$[-\w]+\}/;
        var operator = [
          /[+*\/%]|[=!]=|<=?|>=?|\b(?:and|not|or)\b/,
          {
            pattern: /(\s)-(?=\s)/,
            lookbehind: true
          }
        ];
        Prism2.languages.insertBefore("sass", "property", {
          // We want to consume the whole line
          "variable-line": {
            pattern: /^[ \t]*\$.+/m,
            greedy: true,
            inside: {
              punctuation: /:/,
              variable,
              operator
            }
          },
          // We want to consume the whole line
          "property-line": {
            pattern: /^[ \t]*(?:[^:\s]+ *:.*|:[^:\s].*)/m,
            greedy: true,
            inside: {
              property: [
                /[^:\s]+(?=\s*:)/,
                {
                  pattern: /(:)[^:\s]+/,
                  lookbehind: true
                }
              ],
              punctuation: /:/,
              variable,
              operator,
              important: Prism2.languages.sass.important
            }
          }
        });
        delete Prism2.languages.sass.property;
        delete Prism2.languages.sass.important;
        Prism2.languages.insertBefore("sass", "punctuation", {
          selector: {
            pattern: /^([ \t]*)\S(?:,[^,\r\n]+|[^,\r\n]*)(?:,[^,\r\n]+)*(?:,(?:\r?\n|\r)\1[ \t]+\S(?:,[^,\r\n]+|[^,\r\n]*)(?:,[^,\r\n]+)*)*/m,
            lookbehind: true,
            greedy: true
          }
        });
      })(Prism);
    }
  }
});

export {
  require_sass
};
//# sourceMappingURL=chunk-4X5FFSAH.js.map
