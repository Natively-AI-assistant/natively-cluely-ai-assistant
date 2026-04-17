import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/gap.js
var require_gap = __commonJS({
  "node_modules/refractor/lang/gap.js"(exports, module) {
    module.exports = gap;
    gap.displayName = "gap";
    gap.aliases = [];
    function gap(Prism) {
      Prism.languages.gap = {
        shell: {
          pattern: /^gap>[\s\S]*?(?=^gap>|$(?![\s\S]))/m,
          greedy: true,
          inside: {
            gap: {
              pattern: /^(gap>).+(?:(?:\r(?:\n|(?!\n))|\n)>.*)*/,
              lookbehind: true,
              inside: null
              // see below
            },
            punctuation: /^gap>/
          }
        },
        comment: {
          pattern: /#.*/,
          greedy: true
        },
        string: {
          pattern: /(^|[^\\'"])(?:'(?:[^\r\n\\']|\\.){1,10}'|"(?:[^\r\n\\"]|\\.)*"(?!")|"""[\s\S]*?""")/,
          lookbehind: true,
          greedy: true,
          inside: {
            continuation: {
              pattern: /([\r\n])>/,
              lookbehind: true,
              alias: "punctuation"
            }
          }
        },
        keyword: /\b(?:Assert|Info|IsBound|QUIT|TryNextMethod|Unbind|and|atomic|break|continue|do|elif|else|end|fi|for|function|if|in|local|mod|not|od|or|quit|readonly|readwrite|rec|repeat|return|then|until|while)\b/,
        boolean: /\b(?:false|true)\b/,
        function: /\b[a-z_]\w*(?=\s*\()/i,
        number: {
          pattern: /(^|[^\w.]|\.\.)(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:_[a-z]?)?(?=$|[^\w.]|\.\.)/,
          lookbehind: true
        },
        continuation: {
          pattern: /([\r\n])>/,
          lookbehind: true,
          alias: "punctuation"
        },
        operator: /->|[-+*/^~=!]|<>|[<>]=?|:=|\.\./,
        punctuation: /[()[\]{},;.:]/
      };
      Prism.languages.gap.shell.inside.gap.inside = Prism.languages.gap;
    }
  }
});

export {
  require_gap
};
//# sourceMappingURL=chunk-65IWPBPH.js.map
