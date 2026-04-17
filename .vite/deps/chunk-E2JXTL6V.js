import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/http.js
var require_http = __commonJS({
  "node_modules/refractor/lang/http.js"(exports, module) {
    module.exports = http;
    http.displayName = "http";
    http.aliases = [];
    function http(Prism) {
      ;
      (function(Prism2) {
        function headerValueOf(name) {
          return RegExp("(^(?:" + name + "):[ 	]*(?![ 	]))[^]+", "i");
        }
        Prism2.languages.http = {
          "request-line": {
            pattern: /^(?:CONNECT|DELETE|GET|HEAD|OPTIONS|PATCH|POST|PRI|PUT|SEARCH|TRACE)\s(?:https?:\/\/|\/)\S*\sHTTP\/[\d.]+/m,
            inside: {
              // HTTP Method
              method: {
                pattern: /^[A-Z]+\b/,
                alias: "property"
              },
              // Request Target e.g. http://example.com, /path/to/file
              "request-target": {
                pattern: /^(\s)(?:https?:\/\/|\/)\S*(?=\s)/,
                lookbehind: true,
                alias: "url",
                inside: Prism2.languages.uri
              },
              // HTTP Version
              "http-version": {
                pattern: /^(\s)HTTP\/[\d.]+/,
                lookbehind: true,
                alias: "property"
              }
            }
          },
          "response-status": {
            pattern: /^HTTP\/[\d.]+ \d+ .+/m,
            inside: {
              // HTTP Version
              "http-version": {
                pattern: /^HTTP\/[\d.]+/,
                alias: "property"
              },
              // Status Code
              "status-code": {
                pattern: /^(\s)\d+(?=\s)/,
                lookbehind: true,
                alias: "number"
              },
              // Reason Phrase
              "reason-phrase": {
                pattern: /^(\s).+/,
                lookbehind: true,
                alias: "string"
              }
            }
          },
          header: {
            pattern: /^[\w-]+:.+(?:(?:\r\n?|\n)[ \t].+)*/m,
            inside: {
              "header-value": [
                {
                  pattern: headerValueOf(/Content-Security-Policy/.source),
                  lookbehind: true,
                  alias: ["csp", "languages-csp"],
                  inside: Prism2.languages.csp
                },
                {
                  pattern: headerValueOf(/Public-Key-Pins(?:-Report-Only)?/.source),
                  lookbehind: true,
                  alias: ["hpkp", "languages-hpkp"],
                  inside: Prism2.languages.hpkp
                },
                {
                  pattern: headerValueOf(/Strict-Transport-Security/.source),
                  lookbehind: true,
                  alias: ["hsts", "languages-hsts"],
                  inside: Prism2.languages.hsts
                },
                {
                  pattern: headerValueOf(/[^:]+/.source),
                  lookbehind: true
                }
              ],
              "header-name": {
                pattern: /^[^:]+/,
                alias: "keyword"
              },
              punctuation: /^:/
            }
          }
        };
        var langs = Prism2.languages;
        var httpLanguages = {
          "application/javascript": langs.javascript,
          "application/json": langs.json || langs.javascript,
          "application/xml": langs.xml,
          "text/xml": langs.xml,
          "text/html": langs.html,
          "text/css": langs.css,
          "text/plain": langs.plain
        };
        var suffixTypes = {
          "application/json": true,
          "application/xml": true
        };
        function getSuffixPattern(contentType2) {
          var suffix = contentType2.replace(/^[a-z]+\//, "");
          var suffixPattern = "\\w+/(?:[\\w.-]+\\+)+" + suffix + "(?![+\\w.-])";
          return "(?:" + contentType2 + "|" + suffixPattern + ")";
        }
        var options;
        for (var contentType in httpLanguages) {
          if (httpLanguages[contentType]) {
            options = options || {};
            var pattern = suffixTypes[contentType] ? getSuffixPattern(contentType) : contentType;
            options[contentType.replace(/\//g, "-")] = {
              pattern: RegExp(
                "(" + /content-type:\s*/.source + pattern + /(?:(?:\r\n?|\n)[\w-].*)*(?:\r(?:\n|(?!\n))|\n)/.source + ")" + // This is a little interesting:
                // The HTTP format spec required 1 empty line before the body to make everything unambiguous.
                // However, when writing code by hand (e.g. to display on a website) people can forget about this,
                // so we want to be liberal here. We will allow the empty line to be omitted if the first line of
                // the body does not start with a [\w-] character (as headers do).
                /[^ \t\w-][\s\S]*/.source,
                "i"
              ),
              lookbehind: true,
              inside: httpLanguages[contentType]
            };
          }
        }
        if (options) {
          Prism2.languages.insertBefore("http", "header", options);
        }
      })(Prism);
    }
  }
});

export {
  require_http
};
//# sourceMappingURL=chunk-E2JXTL6V.js.map
