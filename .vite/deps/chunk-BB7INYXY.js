import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/node-repl.js
var require_node_repl = __commonJS({
  "node_modules/highlight.js/lib/languages/node-repl.js"(exports, module) {
    function nodeRepl(hljs) {
      return {
        name: "Node REPL",
        contains: [
          {
            className: "meta",
            starts: {
              // a space separates the REPL prefix from the actual code
              // this is purely for cleaner HTML output
              end: / |$/,
              starts: {
                end: "$",
                subLanguage: "javascript"
              }
            },
            variants: [
              {
                begin: /^>(?=[ ]|$)/
              },
              {
                begin: /^\.\.\.(?=[ ]|$)/
              }
            ]
          }
        ]
      };
    }
    module.exports = nodeRepl;
  }
});

export {
  require_node_repl
};
//# sourceMappingURL=chunk-BB7INYXY.js.map
