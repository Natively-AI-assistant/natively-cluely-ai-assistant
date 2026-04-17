import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/dsconfig.js
var require_dsconfig = __commonJS({
  "node_modules/highlight.js/lib/languages/dsconfig.js"(exports, module) {
    function dsconfig(hljs) {
      const QUOTED_PROPERTY = {
        className: "string",
        begin: /"/,
        end: /"/
      };
      const APOS_PROPERTY = {
        className: "string",
        begin: /'/,
        end: /'/
      };
      const UNQUOTED_PROPERTY = {
        className: "string",
        begin: /[\w\-?]+:\w+/,
        end: /\W/,
        relevance: 0
      };
      const VALUELESS_PROPERTY = {
        className: "string",
        begin: /\w+(\-\w+)*/,
        end: /(?=\W)/,
        relevance: 0
      };
      return {
        keywords: "dsconfig",
        contains: [
          {
            className: "keyword",
            begin: "^dsconfig",
            end: /\s/,
            excludeEnd: true,
            relevance: 10
          },
          {
            className: "built_in",
            begin: /(list|create|get|set|delete)-(\w+)/,
            end: /\s/,
            excludeEnd: true,
            illegal: "!@#$%^&*()",
            relevance: 10
          },
          {
            className: "built_in",
            begin: /--(\w+)/,
            end: /\s/,
            excludeEnd: true
          },
          QUOTED_PROPERTY,
          APOS_PROPERTY,
          UNQUOTED_PROPERTY,
          VALUELESS_PROPERTY,
          hljs.HASH_COMMENT_MODE
        ]
      };
    }
    module.exports = dsconfig;
  }
});

export {
  require_dsconfig
};
//# sourceMappingURL=chunk-CPNSJA6D.js.map
