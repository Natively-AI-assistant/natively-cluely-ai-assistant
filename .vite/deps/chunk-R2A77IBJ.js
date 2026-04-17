import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/hoon.js
var require_hoon = __commonJS({
  "node_modules/refractor/lang/hoon.js"(exports, module) {
    module.exports = hoon;
    hoon.displayName = "hoon";
    hoon.aliases = [];
    function hoon(Prism) {
      Prism.languages.hoon = {
        comment: {
          pattern: /::.*/,
          greedy: true
        },
        string: {
          pattern: /"[^"]*"|'[^']*'/,
          greedy: true
        },
        constant: /%(?:\.[ny]|[\w-]+)/,
        "class-name": /@(?:[a-z0-9-]*[a-z0-9])?|\*/i,
        function: /(?:\+[-+] {2})?(?:[a-z](?:[a-z0-9-]*[a-z0-9])?)/,
        keyword: /\.[\^\+\*=\?]|![><:\.=\?!]|=[>|:,\.\-\^<+;/~\*\?]|\?[>|:\.\-\^<\+&~=@!]|\|[\$_%:\.\-\^~\*=@\?]|\+[|\$\+\*]|:[_\-\^\+~\*]|%[_:\.\-\^\+~\*=]|\^[|:\.\-\+&~\*=\?]|\$[|_%:<>\-\^&~@=\?]|;[:<\+;\/~\*=]|~[>|\$_%<\+\/&=\?!]|--|==/
      };
    }
  }
});

export {
  require_hoon
};
//# sourceMappingURL=chunk-R2A77IBJ.js.map
