import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/gcode.js
var require_gcode = __commonJS({
  "node_modules/refractor/lang/gcode.js"(exports, module) {
    module.exports = gcode;
    gcode.displayName = "gcode";
    gcode.aliases = [];
    function gcode(Prism) {
      Prism.languages.gcode = {
        comment: /;.*|\B\(.*?\)\B/,
        string: {
          pattern: /"(?:""|[^"])*"/,
          greedy: true
        },
        keyword: /\b[GM]\d+(?:\.\d+)?\b/,
        property: /\b[A-Z]/,
        checksum: {
          pattern: /(\*)\d+/,
          lookbehind: true,
          alias: "number"
        },
        // T0:0:0
        punctuation: /[:*]/
      };
    }
  }
});

export {
  require_gcode
};
//# sourceMappingURL=chunk-RLSB6HHV.js.map
