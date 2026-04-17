import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/http.js
var require_http = __commonJS({
  "node_modules/highlight.js/lib/languages/http.js"(exports, module) {
    function source(re) {
      if (!re) return null;
      if (typeof re === "string") return re;
      return re.source;
    }
    function concat(...args) {
      const joined = args.map((x) => source(x)).join("");
      return joined;
    }
    function http(hljs) {
      const VERSION = "HTTP/(2|1\\.[01])";
      const HEADER_NAME = /[A-Za-z][A-Za-z0-9-]*/;
      const HEADER = {
        className: "attribute",
        begin: concat("^", HEADER_NAME, "(?=\\:\\s)"),
        starts: {
          contains: [
            {
              className: "punctuation",
              begin: /: /,
              relevance: 0,
              starts: {
                end: "$",
                relevance: 0
              }
            }
          ]
        }
      };
      const HEADERS_AND_BODY = [
        HEADER,
        {
          begin: "\\n\\n",
          starts: { subLanguage: [], endsWithParent: true }
        }
      ];
      return {
        name: "HTTP",
        aliases: ["https"],
        illegal: /\S/,
        contains: [
          // response
          {
            begin: "^(?=" + VERSION + " \\d{3})",
            end: /$/,
            contains: [
              {
                className: "meta",
                begin: VERSION
              },
              {
                className: "number",
                begin: "\\b\\d{3}\\b"
              }
            ],
            starts: {
              end: /\b\B/,
              illegal: /\S/,
              contains: HEADERS_AND_BODY
            }
          },
          // request
          {
            begin: "(?=^[A-Z]+ (.*?) " + VERSION + "$)",
            end: /$/,
            contains: [
              {
                className: "string",
                begin: " ",
                end: " ",
                excludeBegin: true,
                excludeEnd: true
              },
              {
                className: "meta",
                begin: VERSION
              },
              {
                className: "keyword",
                begin: "[A-Z]+"
              }
            ],
            starts: {
              end: /\b\B/,
              illegal: /\S/,
              contains: HEADERS_AND_BODY
            }
          },
          // to allow headers to work even without a preamble
          hljs.inherit(HEADER, {
            relevance: 0
          })
        ]
      };
    }
    module.exports = http;
  }
});

export {
  require_http
};
//# sourceMappingURL=chunk-7MFNHAPP.js.map
