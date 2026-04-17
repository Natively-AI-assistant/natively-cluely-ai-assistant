import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/julia-repl.js
var require_julia_repl = __commonJS({
  "node_modules/highlight.js/lib/languages/julia-repl.js"(exports, module) {
    function juliaRepl(hljs) {
      return {
        name: "Julia REPL",
        contains: [
          {
            className: "meta",
            begin: /^julia>/,
            relevance: 10,
            starts: {
              // end the highlighting if we are on a new line and the line does not have at
              // least six spaces in the beginning
              end: /^(?![ ]{6})/,
              subLanguage: "julia"
            },
            // jldoctest Markdown blocks are used in the Julia manual and package docs indicate
            // code snippets that should be verified when the documentation is built. They can be
            // either REPL-like or script-like, but are usually REPL-like and therefore we apply
            // julia-repl highlighting to them. More information can be found in Documenter's
            // manual: https://juliadocs.github.io/Documenter.jl/latest/man/doctests.html
            aliases: ["jldoctest"]
          }
        ]
      };
    }
    module.exports = juliaRepl;
  }
});

export {
  require_julia_repl
};
//# sourceMappingURL=chunk-NBIQRDMB.js.map
