import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/typescript.js
var require_typescript = __commonJS({
  "node_modules/refractor/lang/typescript.js"(exports, module) {
    module.exports = typescript;
    typescript.displayName = "typescript";
    typescript.aliases = ["ts"];
    function typescript(Prism) {
      ;
      (function(Prism2) {
        Prism2.languages.typescript = Prism2.languages.extend("javascript", {
          "class-name": {
            pattern: /(\b(?:class|extends|implements|instanceof|interface|new|type)\s+)(?!keyof\b)(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*(?:\s*<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?/,
            lookbehind: true,
            greedy: true,
            inside: null
            // see below
          },
          builtin: /\b(?:Array|Function|Promise|any|boolean|console|never|number|string|symbol|unknown)\b/
        });
        Prism2.languages.typescript.keyword.push(
          /\b(?:abstract|declare|is|keyof|readonly|require)\b/,
          // keywords that have to be followed by an identifier
          /\b(?:asserts|infer|interface|module|namespace|type)\b(?=\s*(?:[{_$a-zA-Z\xA0-\uFFFF]|$))/,
          // This is for `import type *, {}`
          /\btype\b(?=\s*(?:[\{*]|$))/
        );
        delete Prism2.languages.typescript["parameter"];
        delete Prism2.languages.typescript["literal-property"];
        var typeInside = Prism2.languages.extend("typescript", {});
        delete typeInside["class-name"];
        Prism2.languages.typescript["class-name"].inside = typeInside;
        Prism2.languages.insertBefore("typescript", "function", {
          decorator: {
            pattern: /@[$\w\xA0-\uFFFF]+/,
            inside: {
              at: {
                pattern: /^@/,
                alias: "operator"
              },
              function: /^[\s\S]+/
            }
          },
          "generic-function": {
            // e.g. foo<T extends "bar" | "baz">( ...
            pattern: /#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*\s*<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>(?=\s*\()/,
            greedy: true,
            inside: {
              function: /^#?(?!\s)[_$a-zA-Z\xA0-\uFFFF](?:(?!\s)[$\w\xA0-\uFFFF])*/,
              generic: {
                pattern: /<[\s\S]+/,
                // everything after the first <
                alias: "class-name",
                inside: typeInside
              }
            }
          }
        });
        Prism2.languages.ts = Prism2.languages.typescript;
      })(Prism);
    }
  }
});

export {
  require_typescript
};
//# sourceMappingURL=chunk-KGSFBCT4.js.map
