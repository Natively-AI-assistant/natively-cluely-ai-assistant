import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/nix.js
var require_nix = __commonJS({
  "node_modules/highlight.js/lib/languages/nix.js"(exports, module) {
    function nix(hljs) {
      const NIX_KEYWORDS = {
        keyword: "rec with let in inherit assert if else then",
        literal: "true false or and null",
        built_in: "import abort baseNameOf dirOf isNull builtins map removeAttrs throw toString derivation"
      };
      const ANTIQUOTE = {
        className: "subst",
        begin: /\$\{/,
        end: /\}/,
        keywords: NIX_KEYWORDS
      };
      const ATTRS = {
        begin: /[a-zA-Z0-9-_]+(\s*=)/,
        returnBegin: true,
        relevance: 0,
        contains: [
          {
            className: "attr",
            begin: /\S+/
          }
        ]
      };
      const STRING = {
        className: "string",
        contains: [ANTIQUOTE],
        variants: [
          {
            begin: "''",
            end: "''"
          },
          {
            begin: '"',
            end: '"'
          }
        ]
      };
      const EXPRESSIONS = [
        hljs.NUMBER_MODE,
        hljs.HASH_COMMENT_MODE,
        hljs.C_BLOCK_COMMENT_MODE,
        STRING,
        ATTRS
      ];
      ANTIQUOTE.contains = EXPRESSIONS;
      return {
        name: "Nix",
        aliases: ["nixos"],
        keywords: NIX_KEYWORDS,
        contains: EXPRESSIONS
      };
    }
    module.exports = nix;
  }
});

export {
  require_nix
};
//# sourceMappingURL=chunk-66J4HNW3.js.map
