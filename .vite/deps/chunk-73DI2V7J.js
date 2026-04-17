import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/roboconf.js
var require_roboconf = __commonJS({
  "node_modules/highlight.js/lib/languages/roboconf.js"(exports, module) {
    function roboconf(hljs) {
      const IDENTIFIER = "[a-zA-Z-_][^\\n{]+\\{";
      const PROPERTY = {
        className: "attribute",
        begin: /[a-zA-Z-_]+/,
        end: /\s*:/,
        excludeEnd: true,
        starts: {
          end: ";",
          relevance: 0,
          contains: [
            {
              className: "variable",
              begin: /\.[a-zA-Z-_]+/
            },
            {
              className: "keyword",
              begin: /\(optional\)/
            }
          ]
        }
      };
      return {
        name: "Roboconf",
        aliases: [
          "graph",
          "instances"
        ],
        case_insensitive: true,
        keywords: "import",
        contains: [
          // Facet sections
          {
            begin: "^facet " + IDENTIFIER,
            end: /\}/,
            keywords: "facet",
            contains: [
              PROPERTY,
              hljs.HASH_COMMENT_MODE
            ]
          },
          // Instance sections
          {
            begin: "^\\s*instance of " + IDENTIFIER,
            end: /\}/,
            keywords: "name count channels instance-data instance-state instance of",
            illegal: /\S/,
            contains: [
              "self",
              PROPERTY,
              hljs.HASH_COMMENT_MODE
            ]
          },
          // Component sections
          {
            begin: "^" + IDENTIFIER,
            end: /\}/,
            contains: [
              PROPERTY,
              hljs.HASH_COMMENT_MODE
            ]
          },
          // Comments
          hljs.HASH_COMMENT_MODE
        ]
      };
    }
    module.exports = roboconf;
  }
});

export {
  require_roboconf
};
//# sourceMappingURL=chunk-73DI2V7J.js.map
