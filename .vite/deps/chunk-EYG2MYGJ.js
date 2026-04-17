import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/yaml.js
var require_yaml = __commonJS({
  "node_modules/highlight.js/lib/languages/yaml.js"(exports, module) {
    function yaml(hljs) {
      var LITERALS = "true false yes no null";
      var URI_CHARACTERS = "[\\w#;/?:@&=+$,.~*'()[\\]]+";
      var KEY = {
        className: "attr",
        variants: [
          { begin: "\\w[\\w :\\/.-]*:(?=[ 	]|$)" },
          { begin: '"\\w[\\w :\\/.-]*":(?=[ 	]|$)' },
          // double quoted keys
          { begin: "'\\w[\\w :\\/.-]*':(?=[ 	]|$)" }
          // single quoted keys
        ]
      };
      var TEMPLATE_VARIABLES = {
        className: "template-variable",
        variants: [
          { begin: /\{\{/, end: /\}\}/ },
          // jinja templates Ansible
          { begin: /%\{/, end: /\}/ }
          // Ruby i18n
        ]
      };
      var STRING = {
        className: "string",
        relevance: 0,
        variants: [
          { begin: /'/, end: /'/ },
          { begin: /"/, end: /"/ },
          { begin: /\S+/ }
        ],
        contains: [
          hljs.BACKSLASH_ESCAPE,
          TEMPLATE_VARIABLES
        ]
      };
      var CONTAINER_STRING = hljs.inherit(STRING, {
        variants: [
          { begin: /'/, end: /'/ },
          { begin: /"/, end: /"/ },
          { begin: /[^\s,{}[\]]+/ }
        ]
      });
      var DATE_RE = "[0-9]{4}(-[0-9][0-9]){0,2}";
      var TIME_RE = "([Tt \\t][0-9][0-9]?(:[0-9][0-9]){2})?";
      var FRACTION_RE = "(\\.[0-9]*)?";
      var ZONE_RE = "([ \\t])*(Z|[-+][0-9][0-9]?(:[0-9][0-9])?)?";
      var TIMESTAMP = {
        className: "number",
        begin: "\\b" + DATE_RE + TIME_RE + FRACTION_RE + ZONE_RE + "\\b"
      };
      var VALUE_CONTAINER = {
        end: ",",
        endsWithParent: true,
        excludeEnd: true,
        keywords: LITERALS,
        relevance: 0
      };
      var OBJECT = {
        begin: /\{/,
        end: /\}/,
        contains: [VALUE_CONTAINER],
        illegal: "\\n",
        relevance: 0
      };
      var ARRAY = {
        begin: "\\[",
        end: "\\]",
        contains: [VALUE_CONTAINER],
        illegal: "\\n",
        relevance: 0
      };
      var MODES = [
        KEY,
        {
          className: "meta",
          begin: "^---\\s*$",
          relevance: 10
        },
        {
          // multi line string
          // Blocks start with a | or > followed by a newline
          //
          // Indentation of subsequent lines must be the same to
          // be considered part of the block
          className: "string",
          begin: "[\\|>]([1-9]?[+-])?[ ]*\\n( +)[^ ][^\\n]*\\n(\\2[^\\n]+\\n?)*"
        },
        {
          // Ruby/Rails erb
          begin: "<%[%=-]?",
          end: "[%-]?%>",
          subLanguage: "ruby",
          excludeBegin: true,
          excludeEnd: true,
          relevance: 0
        },
        {
          // named tags
          className: "type",
          begin: "!\\w+!" + URI_CHARACTERS
        },
        // https://yaml.org/spec/1.2/spec.html#id2784064
        {
          // verbatim tags
          className: "type",
          begin: "!<" + URI_CHARACTERS + ">"
        },
        {
          // primary tags
          className: "type",
          begin: "!" + URI_CHARACTERS
        },
        {
          // secondary tags
          className: "type",
          begin: "!!" + URI_CHARACTERS
        },
        {
          // fragment id &ref
          className: "meta",
          begin: "&" + hljs.UNDERSCORE_IDENT_RE + "$"
        },
        {
          // fragment reference *ref
          className: "meta",
          begin: "\\*" + hljs.UNDERSCORE_IDENT_RE + "$"
        },
        {
          // array listing
          className: "bullet",
          // TODO: remove |$ hack when we have proper look-ahead support
          begin: "-(?=[ ]|$)",
          relevance: 0
        },
        hljs.HASH_COMMENT_MODE,
        {
          beginKeywords: LITERALS,
          keywords: { literal: LITERALS }
        },
        TIMESTAMP,
        // numbers are any valid C-style number that
        // sit isolated from other words
        {
          className: "number",
          begin: hljs.C_NUMBER_RE + "\\b",
          relevance: 0
        },
        OBJECT,
        ARRAY,
        STRING
      ];
      var VALUE_MODES = [...MODES];
      VALUE_MODES.pop();
      VALUE_MODES.push(CONTAINER_STRING);
      VALUE_CONTAINER.contains = VALUE_MODES;
      return {
        name: "YAML",
        case_insensitive: true,
        aliases: ["yml"],
        contains: MODES
      };
    }
    module.exports = yaml;
  }
});

export {
  require_yaml
};
//# sourceMappingURL=chunk-EYG2MYGJ.js.map
