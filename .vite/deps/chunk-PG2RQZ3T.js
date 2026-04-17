import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/highlight.js/lib/languages/routeros.js
var require_routeros = __commonJS({
  "node_modules/highlight.js/lib/languages/routeros.js"(exports, module) {
    function routeros(hljs) {
      const STATEMENTS = "foreach do while for if from to step else on-error and or not in";
      const GLOBAL_COMMANDS = "global local beep delay put len typeof pick log time set find environment terminal error execute parse resolve toarray tobool toid toip toip6 tonum tostr totime";
      const COMMON_COMMANDS = "add remove enable disable set get print export edit find run debug error info warning";
      const LITERALS = "true false yes no nothing nil null";
      const OBJECTS = "traffic-flow traffic-generator firewall scheduler aaa accounting address-list address align area bandwidth-server bfd bgp bridge client clock community config connection console customer default dhcp-client dhcp-server discovery dns e-mail ethernet filter firmware gps graphing group hardware health hotspot identity igmp-proxy incoming instance interface ip ipsec ipv6 irq l2tp-server lcd ldp logging mac-server mac-winbox mangle manual mirror mme mpls nat nd neighbor network note ntp ospf ospf-v3 ovpn-server page peer pim ping policy pool port ppp pppoe-client pptp-server prefix profile proposal proxy queue radius resource rip ripng route routing screen script security-profiles server service service-port settings shares smb sms sniffer snmp snooper socks sstp-server system tool tracking type upgrade upnp user-manager users user vlan secret vrrp watchdog web-access wireless pptp pppoe lan wan layer7-protocol lease simple raw";
      const VAR = {
        className: "variable",
        variants: [
          {
            begin: /\$[\w\d#@][\w\d_]*/
          },
          {
            begin: /\$\{(.*?)\}/
          }
        ]
      };
      const QUOTE_STRING = {
        className: "string",
        begin: /"/,
        end: /"/,
        contains: [
          hljs.BACKSLASH_ESCAPE,
          VAR,
          {
            className: "variable",
            begin: /\$\(/,
            end: /\)/,
            contains: [hljs.BACKSLASH_ESCAPE]
          }
        ]
      };
      const APOS_STRING = {
        className: "string",
        begin: /'/,
        end: /'/
      };
      return {
        name: "Microtik RouterOS script",
        aliases: [
          "mikrotik"
        ],
        case_insensitive: true,
        keywords: {
          $pattern: /:?[\w-]+/,
          literal: LITERALS,
          keyword: STATEMENTS + " :" + STATEMENTS.split(" ").join(" :") + " :" + GLOBAL_COMMANDS.split(" ").join(" :")
        },
        contains: [
          {
            // illegal syntax
            variants: [
              {
                // -- comment
                begin: /\/\*/,
                end: /\*\//
              },
              {
                // Stan comment
                begin: /\/\//,
                end: /$/
              },
              {
                // HTML tags
                begin: /<\//,
                end: />/
              }
            ],
            illegal: /./
          },
          hljs.COMMENT("^#", "$"),
          QUOTE_STRING,
          APOS_STRING,
          VAR,
          // attribute=value
          {
            // > is to avoid matches with => in other grammars
            begin: /[\w-]+=([^\s{}[\]()>]+)/,
            relevance: 0,
            returnBegin: true,
            contains: [
              {
                className: "attribute",
                begin: /[^=]+/
              },
              {
                begin: /=/,
                endsWithParent: true,
                relevance: 0,
                contains: [
                  QUOTE_STRING,
                  APOS_STRING,
                  VAR,
                  {
                    className: "literal",
                    begin: "\\b(" + LITERALS.split(" ").join("|") + ")\\b"
                  },
                  {
                    // Do not format unclassified values. Needed to exclude highlighting of values as built_in.
                    begin: /("[^"]*"|[^\s{}[\]]+)/
                  }
                  /*
                  {
                    // IPv4 addresses and subnets
                    className: 'number',
                    variants: [
                      {begin: IPADDR_wBITMASK+'(,'+IPADDR_wBITMASK+')*'}, //192.168.0.0/24,1.2.3.0/24
                      {begin: IPADDR+'-'+IPADDR},       // 192.168.0.1-192.168.0.3
                      {begin: IPADDR+'(,'+IPADDR+')*'}, // 192.168.0.1,192.168.0.34,192.168.24.1,192.168.0.1
                    ]
                  },
                  {
                    // MAC addresses and DHCP Client IDs
                    className: 'number',
                    begin: /\b(1:)?([0-9A-Fa-f]{1,2}[:-]){5}([0-9A-Fa-f]){1,2}\b/,
                  },
                  */
                ]
              }
            ]
          },
          {
            // HEX values
            className: "number",
            begin: /\*[0-9a-fA-F]+/
          },
          {
            begin: "\\b(" + COMMON_COMMANDS.split(" ").join("|") + ")([\\s[(\\]|])",
            returnBegin: true,
            contains: [
              {
                className: "builtin-name",
                // 'function',
                begin: /\w+/
              }
            ]
          },
          {
            className: "built_in",
            variants: [
              {
                begin: "(\\.\\./|/|\\s)((" + OBJECTS.split(" ").join("|") + ");?\\s)+"
              },
              {
                begin: /\.\./,
                relevance: 0
              }
            ]
          }
        ]
      };
    }
    module.exports = routeros;
  }
});

export {
  require_routeros
};
//# sourceMappingURL=chunk-PG2RQZ3T.js.map
