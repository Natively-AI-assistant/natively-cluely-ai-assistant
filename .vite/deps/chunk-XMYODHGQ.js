import {
  require_php
} from "./chunk-ZHP4RCBL.js";
import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/php-extras.js
var require_php_extras = __commonJS({
  "node_modules/refractor/lang/php-extras.js"(exports, module) {
    var refractorPhp = require_php();
    module.exports = phpExtras;
    phpExtras.displayName = "phpExtras";
    phpExtras.aliases = [];
    function phpExtras(Prism) {
      Prism.register(refractorPhp);
      Prism.languages.insertBefore("php", "variable", {
        this: {
          pattern: /\$this\b/,
          alias: "keyword"
        },
        global: /\$(?:GLOBALS|HTTP_RAW_POST_DATA|_(?:COOKIE|ENV|FILES|GET|POST|REQUEST|SERVER|SESSION)|argc|argv|http_response_header|php_errormsg)\b/,
        scope: {
          pattern: /\b[\w\\]+::/,
          inside: {
            keyword: /\b(?:parent|self|static)\b/,
            punctuation: /::|\\/
          }
        }
      });
    }
  }
});

export {
  require_php_extras
};
//# sourceMappingURL=chunk-XMYODHGQ.js.map
