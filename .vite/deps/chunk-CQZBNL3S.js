import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/r.js
var require_r = __commonJS({
  "node_modules/highlight.js/lib/languages/r.js"(exports, module) {
    function source(re) {
      if (!re) return null;
      if (typeof re === "string") return re;
      return re.source;
    }
    function lookahead(re) {
      return concat("(?=", re, ")");
    }
    function concat(...args) {
      const joined = args.map((x) => source(x)).join("");
      return joined;
    }
    function r(hljs) {
      const IDENT_RE = /(?:(?:[a-zA-Z]|\.[._a-zA-Z])[._a-zA-Z0-9]*)|\.(?!\d)/;
      const SIMPLE_IDENT = /[a-zA-Z][a-zA-Z_0-9]*/;
      return {
        name: "R",
        // only in Haskell, not R
        illegal: /->/,
        keywords: {
          $pattern: IDENT_RE,
          keyword: "function if in break next repeat else for while",
          literal: "NULL NA TRUE FALSE Inf NaN NA_integer_|10 NA_real_|10 NA_character_|10 NA_complex_|10",
          built_in: (
            // Builtin constants
            "LETTERS letters month.abb month.name pi T F abs acos acosh all any anyNA Arg as.call as.character as.complex as.double as.environment as.integer as.logical as.null.default as.numeric as.raw asin asinh atan atanh attr attributes baseenv browser c call ceiling class Conj cos cosh cospi cummax cummin cumprod cumsum digamma dim dimnames emptyenv exp expression floor forceAndCall gamma gc.time globalenv Im interactive invisible is.array is.atomic is.call is.character is.complex is.double is.environment is.expression is.finite is.function is.infinite is.integer is.language is.list is.logical is.matrix is.na is.name is.nan is.null is.numeric is.object is.pairlist is.raw is.recursive is.single is.symbol lazyLoadDBfetch length lgamma list log max min missing Mod names nargs nzchar oldClass on.exit pos.to.env proc.time prod quote range Re rep retracemem return round seq_along seq_len seq.int sign signif sin sinh sinpi sqrt standardGeneric substitute sum switch tan tanh tanpi tracemem trigamma trunc unclass untracemem UseMethod xtfrm"
          )
        },
        compilerExtensions: [
          // allow beforeMatch to act as a "qualifier" for the match
          // the full match begin must be [beforeMatch][begin]
          (mode, parent) => {
            if (!mode.beforeMatch) return;
            if (mode.starts) throw new Error("beforeMatch cannot be used with starts");
            const originalMode = Object.assign({}, mode);
            Object.keys(mode).forEach((key) => {
              delete mode[key];
            });
            mode.begin = concat(originalMode.beforeMatch, lookahead(originalMode.begin));
            mode.starts = {
              relevance: 0,
              contains: [
                Object.assign(originalMode, { endsParent: true })
              ]
            };
            mode.relevance = 0;
            delete originalMode.beforeMatch;
          }
        ],
        contains: [
          // Roxygen comments
          hljs.COMMENT(
            /#'/,
            /$/,
            {
              contains: [
                {
                  // Handle `@examples` separately to cause all subsequent code
                  // until the next `@`-tag on its own line to be kept as-is,
                  // preventing highlighting. This code is example R code, so nested
                  // doctags shouldn’t be treated as such. See
                  // `test/markup/r/roxygen.txt` for an example.
                  className: "doctag",
                  begin: "@examples",
                  starts: {
                    contains: [
                      { begin: /\n/ },
                      {
                        begin: /#'\s*(?=@[a-zA-Z]+)/,
                        endsParent: true
                      },
                      {
                        begin: /#'/,
                        end: /$/,
                        excludeBegin: true
                      }
                    ]
                  }
                },
                {
                  // Handle `@param` to highlight the parameter name following
                  // after.
                  className: "doctag",
                  begin: "@param",
                  end: /$/,
                  contains: [
                    {
                      className: "variable",
                      variants: [
                        { begin: IDENT_RE },
                        { begin: /`(?:\\.|[^`\\])+`/ }
                      ],
                      endsParent: true
                    }
                  ]
                },
                {
                  className: "doctag",
                  begin: /@[a-zA-Z]+/
                },
                {
                  className: "meta-keyword",
                  begin: /\\[a-zA-Z]+/
                }
              ]
            }
          ),
          hljs.HASH_COMMENT_MODE,
          {
            className: "string",
            contains: [hljs.BACKSLASH_ESCAPE],
            variants: [
              hljs.END_SAME_AS_BEGIN({ begin: /[rR]"(-*)\(/, end: /\)(-*)"/ }),
              hljs.END_SAME_AS_BEGIN({ begin: /[rR]"(-*)\{/, end: /\}(-*)"/ }),
              hljs.END_SAME_AS_BEGIN({ begin: /[rR]"(-*)\[/, end: /\](-*)"/ }),
              hljs.END_SAME_AS_BEGIN({ begin: /[rR]'(-*)\(/, end: /\)(-*)'/ }),
              hljs.END_SAME_AS_BEGIN({ begin: /[rR]'(-*)\{/, end: /\}(-*)'/ }),
              hljs.END_SAME_AS_BEGIN({ begin: /[rR]'(-*)\[/, end: /\](-*)'/ }),
              { begin: '"', end: '"', relevance: 0 },
              { begin: "'", end: "'", relevance: 0 }
            ]
          },
          {
            className: "number",
            relevance: 0,
            beforeMatch: /([^a-zA-Z0-9._])/,
            // not part of an identifier
            variants: [
              // TODO: replace with negative look-behind when available
              // { begin: /(?<![a-zA-Z0-9._])0[xX][0-9a-fA-F]+\.[0-9a-fA-F]*[pP][+-]?\d+i?/ },
              // { begin: /(?<![a-zA-Z0-9._])0[xX][0-9a-fA-F]+([pP][+-]?\d+)?[Li]?/ },
              // { begin: /(?<![a-zA-Z0-9._])(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[Li]?/ }
              {
                // Special case: only hexadecimal binary powers can contain fractions.
                match: /0[xX][0-9a-fA-F]+\.[0-9a-fA-F]*[pP][+-]?\d+i?/
              },
              {
                match: /0[xX][0-9a-fA-F]+([pP][+-]?\d+)?[Li]?/
              },
              {
                match: /(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[Li]?/
              }
            ]
          },
          {
            // infix operator
            begin: "%",
            end: "%"
          },
          // relevance boost for assignment
          {
            begin: concat(SIMPLE_IDENT, "\\s+<-\\s+")
          },
          {
            // escaped identifier
            begin: "`",
            end: "`",
            contains: [
              { begin: /\\./ }
            ]
          }
        ]
      };
    }
    module.exports = r;
  }
});

export {
  require_r
};
//# sourceMappingURL=chunk-CQZBNL3S.js.map
