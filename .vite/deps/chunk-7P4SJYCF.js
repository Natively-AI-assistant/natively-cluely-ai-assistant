import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/subunit.js
var require_subunit = __commonJS({
  "node_modules/highlight.js/lib/languages/subunit.js"(exports, module) {
    function subunit(hljs) {
      const DETAILS = {
        className: "string",
        begin: "\\[\n(multipart)?",
        end: "\\]\n"
      };
      const TIME = {
        className: "string",
        begin: "\\d{4}-\\d{2}-\\d{2}(\\s+)\\d{2}:\\d{2}:\\d{2}.\\d+Z"
      };
      const PROGRESSVALUE = {
        className: "string",
        begin: "(\\+|-)\\d+"
      };
      const KEYWORDS = {
        className: "keyword",
        relevance: 10,
        variants: [
          {
            begin: "^(test|testing|success|successful|failure|error|skip|xfail|uxsuccess)(:?)\\s+(test)?"
          },
          {
            begin: "^progress(:?)(\\s+)?(pop|push)?"
          },
          {
            begin: "^tags:"
          },
          {
            begin: "^time:"
          }
        ]
      };
      return {
        name: "SubUnit",
        case_insensitive: true,
        contains: [
          DETAILS,
          TIME,
          PROGRESSVALUE,
          KEYWORDS
        ]
      };
    }
    module.exports = subunit;
  }
});

export {
  require_subunit
};
//# sourceMappingURL=chunk-7P4SJYCF.js.map
