import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/refractor/lang/uri.js
var require_uri = __commonJS({
  "node_modules/refractor/lang/uri.js"(exports, module) {
    module.exports = uri;
    uri.displayName = "uri";
    uri.aliases = ["url"];
    function uri(Prism) {
      Prism.languages.uri = {
        scheme: {
          pattern: /^[a-z][a-z0-9+.-]*:/im,
          greedy: true,
          inside: {
            "scheme-delimiter": /:$/
          }
        },
        fragment: {
          pattern: /#[\w\-.~!$&'()*+,;=%:@/?]*/,
          inside: {
            "fragment-delimiter": /^#/
          }
        },
        query: {
          pattern: /\?[\w\-.~!$&'()*+,;=%:@/?]*/,
          inside: {
            "query-delimiter": {
              pattern: /^\?/,
              greedy: true
            },
            "pair-delimiter": /[&;]/,
            pair: {
              pattern: /^[^=][\s\S]*/,
              inside: {
                key: /^[^=]+/,
                value: {
                  pattern: /(^=)[\s\S]+/,
                  lookbehind: true
                }
              }
            }
          }
        },
        authority: {
          pattern: RegExp(
            /^\/\//.source + // [ userinfo "@" ]
            /(?:[\w\-.~!$&'()*+,;=%:]*@)?/.source + // host
            ("(?:" + // IP-literal
            /\[(?:[0-9a-fA-F:.]{2,48}|v[0-9a-fA-F]+\.[\w\-.~!$&'()*+,;=]+)\]/.source + "|" + // IPv4address or registered name
            /[\w\-.~!$&'()*+,;=%]*/.source + ")") + // [ ":" port ]
            /(?::\d*)?/.source,
            "m"
          ),
          inside: {
            "authority-delimiter": /^\/\//,
            "user-info-segment": {
              pattern: /^[\w\-.~!$&'()*+,;=%:]*@/,
              inside: {
                "user-info-delimiter": /@$/,
                "user-info": /^[\w\-.~!$&'()*+,;=%:]+/
              }
            },
            "port-segment": {
              pattern: /:\d*$/,
              inside: {
                "port-delimiter": /^:/,
                port: /^\d+/
              }
            },
            host: {
              pattern: /[\s\S]+/,
              inside: {
                "ip-literal": {
                  pattern: /^\[[\s\S]+\]$/,
                  inside: {
                    "ip-literal-delimiter": /^\[|\]$/,
                    "ipv-future": /^v[\s\S]+/,
                    "ipv6-address": /^[\s\S]+/
                  }
                },
                "ipv4-address": /^(?:(?:[03-9]\d?|[12]\d{0,2})\.){3}(?:[03-9]\d?|[12]\d{0,2})$/
              }
            }
          }
        },
        path: {
          pattern: /^[\w\-.~!$&'()*+,;=%:@/]+/m,
          inside: {
            "path-separator": /\//
          }
        }
      };
      Prism.languages.url = Prism.languages.uri;
    }
  }
});

export {
  require_uri
};
//# sourceMappingURL=chunk-FX23L6EL.js.map
