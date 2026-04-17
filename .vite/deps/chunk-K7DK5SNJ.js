import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/go-module.js
var require_go_module = __commonJS({
  "node_modules/refractor/lang/go-module.js"(exports, module) {
    module.exports = goModule;
    goModule.displayName = "goModule";
    goModule.aliases = [];
    function goModule(Prism) {
      Prism.languages["go-mod"] = Prism.languages["go-module"] = {
        comment: {
          pattern: /\/\/.*/,
          greedy: true
        },
        version: {
          pattern: /(^|[\s()[\],])v\d+\.\d+\.\d+(?:[+-][-+.\w]*)?(?![^\s()[\],])/,
          lookbehind: true,
          alias: "number"
        },
        "go-version": {
          pattern: /((?:^|\s)go\s+)\d+(?:\.\d+){1,2}/,
          lookbehind: true,
          alias: "number"
        },
        keyword: {
          pattern: /^([ \t]*)(?:exclude|go|module|replace|require|retract)\b/m,
          lookbehind: true
        },
        operator: /=>/,
        punctuation: /[()[\],]/
      };
    }
  }
});

export {
  require_go_module
};
//# sourceMappingURL=chunk-K7DK5SNJ.js.map
