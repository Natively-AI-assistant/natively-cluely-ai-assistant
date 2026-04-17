import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/openqasm.js
var require_openqasm = __commonJS({
  "node_modules/refractor/lang/openqasm.js"(exports, module) {
    module.exports = openqasm;
    openqasm.displayName = "openqasm";
    openqasm.aliases = ["qasm"];
    function openqasm(Prism) {
      Prism.languages.openqasm = {
        comment: /\/\*[\s\S]*?\*\/|\/\/.*/,
        string: {
          pattern: /"[^"\r\n\t]*"|'[^'\r\n\t]*'/,
          greedy: true
        },
        keyword: /\b(?:CX|OPENQASM|U|barrier|boxas|boxto|break|const|continue|ctrl|def|defcal|defcalgrammar|delay|else|end|for|gate|gphase|if|in|include|inv|kernel|lengthof|let|measure|pow|reset|return|rotary|stretchinf|while)\b|#pragma\b/,
        "class-name": /\b(?:angle|bit|bool|creg|fixed|float|int|length|qreg|qubit|stretch|uint)\b/,
        function: /\b(?:cos|exp|ln|popcount|rotl|rotr|sin|sqrt|tan)\b(?=\s*\()/,
        constant: /\b(?:euler|pi|tau)\b|π|𝜏|ℇ/,
        number: {
          pattern: /(^|[^.\w$])(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:dt|ns|us|µs|ms|s)?/i,
          lookbehind: true
        },
        operator: /->|>>=?|<<=?|&&|\|\||\+\+|--|[!=<>&|~^+\-*/%]=?|@/,
        punctuation: /[(){}\[\];,:.]/
      };
      Prism.languages.qasm = Prism.languages.openqasm;
    }
  }
});

export {
  require_openqasm
};
//# sourceMappingURL=chunk-7M3B77QZ.js.map
