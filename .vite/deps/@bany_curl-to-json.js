import {
  __commonJS
} from "./chunk-EWTE5DHJ.js";

// node_modules/minimist/index.js
var require_minimist = __commonJS({
  "node_modules/minimist/index.js"(exports, module) {
    "use strict";
    function hasKey(obj, keys) {
      var o = obj;
      keys.slice(0, -1).forEach(function(key2) {
        o = o[key2] || {};
      });
      var key = keys[keys.length - 1];
      return key in o;
    }
    function isNumber(x) {
      if (typeof x === "number") {
        return true;
      }
      if (/^0x[0-9a-f]+$/i.test(x)) {
        return true;
      }
      return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(e[-+]?\d+)?$/.test(x);
    }
    function isConstructorOrProto(obj, key) {
      return key === "constructor" && typeof obj[key] === "function" || key === "__proto__";
    }
    module.exports = function(args, opts) {
      if (!opts) {
        opts = {};
      }
      var flags = {
        bools: {},
        strings: {},
        unknownFn: null
      };
      if (typeof opts.unknown === "function") {
        flags.unknownFn = opts.unknown;
      }
      if (typeof opts.boolean === "boolean" && opts.boolean) {
        flags.allBools = true;
      } else {
        [].concat(opts.boolean).filter(Boolean).forEach(function(key2) {
          flags.bools[key2] = true;
        });
      }
      var aliases = {};
      function aliasIsBoolean(key2) {
        return aliases[key2].some(function(x) {
          return flags.bools[x];
        });
      }
      Object.keys(opts.alias || {}).forEach(function(key2) {
        aliases[key2] = [].concat(opts.alias[key2]);
        aliases[key2].forEach(function(x) {
          aliases[x] = [key2].concat(aliases[key2].filter(function(y) {
            return x !== y;
          }));
        });
      });
      [].concat(opts.string).filter(Boolean).forEach(function(key2) {
        flags.strings[key2] = true;
        if (aliases[key2]) {
          [].concat(aliases[key2]).forEach(function(k) {
            flags.strings[k] = true;
          });
        }
      });
      var defaults = opts.default || {};
      var argv = { _: [] };
      function argDefined(key2, arg2) {
        return flags.allBools && /^--[^=]+$/.test(arg2) || flags.strings[key2] || flags.bools[key2] || aliases[key2];
      }
      function setKey(obj, keys, value2) {
        var o = obj;
        for (var i2 = 0; i2 < keys.length - 1; i2++) {
          var key2 = keys[i2];
          if (isConstructorOrProto(o, key2)) {
            return;
          }
          if (o[key2] === void 0) {
            o[key2] = {};
          }
          if (o[key2] === Object.prototype || o[key2] === Number.prototype || o[key2] === String.prototype) {
            o[key2] = {};
          }
          if (o[key2] === Array.prototype) {
            o[key2] = [];
          }
          o = o[key2];
        }
        var lastKey = keys[keys.length - 1];
        if (isConstructorOrProto(o, lastKey)) {
          return;
        }
        if (o === Object.prototype || o === Number.prototype || o === String.prototype) {
          o = {};
        }
        if (o === Array.prototype) {
          o = [];
        }
        if (o[lastKey] === void 0 || flags.bools[lastKey] || typeof o[lastKey] === "boolean") {
          o[lastKey] = value2;
        } else if (Array.isArray(o[lastKey])) {
          o[lastKey].push(value2);
        } else {
          o[lastKey] = [o[lastKey], value2];
        }
      }
      function setArg(key2, val, arg2) {
        if (arg2 && flags.unknownFn && !argDefined(key2, arg2)) {
          if (flags.unknownFn(arg2) === false) {
            return;
          }
        }
        var value2 = !flags.strings[key2] && isNumber(val) ? Number(val) : val;
        setKey(argv, key2.split("."), value2);
        (aliases[key2] || []).forEach(function(x) {
          setKey(argv, x.split("."), value2);
        });
      }
      Object.keys(flags.bools).forEach(function(key2) {
        setArg(key2, defaults[key2] === void 0 ? false : defaults[key2]);
      });
      var notFlags = [];
      if (args.indexOf("--") !== -1) {
        notFlags = args.slice(args.indexOf("--") + 1);
        args = args.slice(0, args.indexOf("--"));
      }
      for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        var key;
        var next;
        if (/^--.+=/.test(arg)) {
          var m = arg.match(/^--([^=]+)=([\s\S]*)$/);
          key = m[1];
          var value = m[2];
          if (flags.bools[key]) {
            value = value !== "false";
          }
          setArg(key, value, arg);
        } else if (/^--no-.+/.test(arg)) {
          key = arg.match(/^--no-(.+)/)[1];
          setArg(key, false, arg);
        } else if (/^--.+/.test(arg)) {
          key = arg.match(/^--(.+)/)[1];
          next = args[i + 1];
          if (next !== void 0 && !/^(-|--)[^-]/.test(next) && !flags.bools[key] && !flags.allBools && (aliases[key] ? !aliasIsBoolean(key) : true)) {
            setArg(key, next, arg);
            i += 1;
          } else if (/^(true|false)$/.test(next)) {
            setArg(key, next === "true", arg);
            i += 1;
          } else {
            setArg(key, flags.strings[key] ? "" : true, arg);
          }
        } else if (/^-[^-]+/.test(arg)) {
          var letters = arg.slice(1, -1).split("");
          var broken = false;
          for (var j = 0; j < letters.length; j++) {
            next = arg.slice(j + 2);
            if (next === "-") {
              setArg(letters[j], next, arg);
              continue;
            }
            if (/[A-Za-z]/.test(letters[j]) && next[0] === "=") {
              setArg(letters[j], next.slice(1), arg);
              broken = true;
              break;
            }
            if (/[A-Za-z]/.test(letters[j]) && /-?\d+(\.\d*)?(e-?\d+)?$/.test(next)) {
              setArg(letters[j], next, arg);
              broken = true;
              break;
            }
            if (letters[j + 1] && letters[j + 1].match(/\W/)) {
              setArg(letters[j], arg.slice(j + 2), arg);
              broken = true;
              break;
            } else {
              setArg(letters[j], flags.strings[letters[j]] ? "" : true, arg);
            }
          }
          key = arg.slice(-1)[0];
          if (!broken && key !== "-") {
            if (args[i + 1] && !/^(-|--)[^-]/.test(args[i + 1]) && !flags.bools[key] && (aliases[key] ? !aliasIsBoolean(key) : true)) {
              setArg(key, args[i + 1], arg);
              i += 1;
            } else if (args[i + 1] && /^(true|false)$/.test(args[i + 1])) {
              setArg(key, args[i + 1] === "true", arg);
              i += 1;
            } else {
              setArg(key, flags.strings[key] ? "" : true, arg);
            }
          }
        } else {
          if (!flags.unknownFn || flags.unknownFn(arg) !== false) {
            argv._.push(flags.strings._ || !isNumber(arg) ? arg : Number(arg));
          }
          if (opts.stopEarly) {
            argv._.push.apply(argv._, args.slice(i + 1));
            break;
          }
        }
      }
      Object.keys(defaults).forEach(function(k) {
        if (!hasKey(argv, k.split("."))) {
          setKey(argv, k.split("."), defaults[k]);
          (aliases[k] || []).forEach(function(x) {
            setKey(argv, x.split("."), defaults[k]);
          });
        }
      });
      if (opts["--"]) {
        argv["--"] = notFlags.slice();
      } else {
        notFlags.forEach(function(k) {
          argv._.push(k);
        });
      }
      return argv;
    };
  }
});

// node_modules/@bany/curl-to-json/src/convertor.js
var require_convertor = __commonJS({
  "node_modules/@bany/curl-to-json/src/convertor.js"(exports, module) {
    function parseField(s) {
      return s.split(/:(.+)/).map((element) => element.trim());
    }
    function parseFieldWithEqual(s) {
      return s.split(/=(.+)/);
    }
    function pareString(s, pareCallBack = parseField) {
      let result = {};
      var field = pareCallBack(s);
      result[field[0]] = field[1];
      return result;
    }
    function parseParamsField(s) {
      if (s === "") return null;
      let object = {};
      const allParamsArr = s.split(/&/);
      allParamsArr.forEach((element) => {
        const field = element.split(/=/);
        object[field[0]] = field[1];
      });
      return object;
    }
    module.exports = {
      header: (data) => {
        let ouput = {};
        if (typeof data === "string") {
          ouput = pareString(data);
        } else {
          data.forEach((element) => {
            ouput = {
              ...ouput,
              ...pareString(element, parseField)
            };
          });
          return ouput;
        }
        return ouput;
      },
      /**
       * Normalize -F/--form output.
       * minimist returns string for a single occurrence and array for multiple.
       */
      form: (data) => {
        if (data == null) return data;
        if (typeof data === "string") return [data];
        return data;
      },
      body: (data) => {
        if (typeof data === "string") {
          try {
            return JSON.parse(data);
          } catch {
            try {
              return parseParamsField(data);
            } catch {
              return data;
            }
          }
        } else {
          let ouput = {};
          data.forEach((element) => {
            ouput = {
              ...ouput,
              ...pareString(element, parseFieldWithEqual)
            };
          });
          return ouput;
        }
      },
      parseParamsField
    };
  }
});

// node_modules/@bany/curl-to-json/src/option.js
var require_option = __commonJS({
  "node_modules/@bany/curl-to-json/src/option.js"(exports, module) {
    var convertor = require_convertor();
    module.exports = [
      {
        name: "url",
        alias: ["url", "curl"],
        description: "Url request",
        convertor: null
      },
      {
        name: "cookie",
        alias: ["b", "cookie"],
        description: "<name=data> Supply cookie with request. If no =, then specifies the cookie file to use (see -c).",
        convertor: null
      },
      {
        name: "cookie-jar",
        alias: ["c", "cookie-jar"],
        description: "<file name> File to save response cookies to.",
        convertor: null
      },
      {
        name: "data",
        alias: ["d", "data", "data-raw", "data-urlencode", "data-binary"],
        description: "<data> Send specified data in POST request. Details provided below.",
        convertor: convertor.body
      },
      /*-f, --fail Fail silently (don't output HTML error form if returned).*/
      {
        name: "fail",
        alias: ["f", "fail"],
        description: "Fail silently (don't output HTML error form if returned).",
        convertor: null
      },
      // -F, --form <name=content> Submit form data.
      {
        name: "form",
        alias: ["F", "form"],
        description: "<name=content> Submit form data.",
        convertor: convertor.form
      },
      // -H, --header <header> Headers to supply with request.
      {
        name: "header",
        alias: ["H", "header"],
        description: "<header> Headers to supply with request.",
        convertor: convertor.header
      },
      // -i, --include Include HTTP headers in the output.
      {
        name: "include",
        alias: ["i", "include"],
        description: "Include HTTP headers in the output.",
        convertor: null
      },
      // -I, --head Fetch headers only.
      {
        name: "head",
        alias: ["I", "head"],
        description: "Fetch headers only.",
        convertor: null
      },
      // -k, --insecure Allow insecure connections to succeed.
      {
        name: "insecure",
        alias: ["k", "insecure"],
        description: "Allow insecure connections to succeed.",
        convertor: null
      },
      // -L, --location Follow redirects.
      {
        name: "location",
        alias: ["L", "location"],
        description: "v",
        convertor: null
      },
      // -o, --output <file> Write output to . Can use --create-dirs in conjunction with this to create any directories specified in the -o path.
      {
        name: "output",
        alias: ["o", "output"],
        description: "<file> Write output to . Can use --create-dirs in conjunction with this to create any directories specified in the -o path.",
        convertor: null
      },
      // -O, --remote-name Write output to file named like the remote file (only writes to current directory).
      {
        name: "remote-name",
        alias: ["remote-name", "O"],
        description: "Write output to file named like the remote file (only writes to current directory).",
        convertor: null
      },
      // -s, --silent Silent (quiet) mode. Use with -S to force it to show errors.
      {
        name: "silent",
        alias: ["s", "silent"],
        description: "Silent (quiet) mode. Use with -S to force it to show errors.",
        convertor: null
      },
      // -v, --verbose Provide more information (useful for debugging).
      {
        name: "verbose",
        alias: ["v", "verbose"],
        description: "Provide more information (useful for debugging).",
        convertor: null
      },
      // -w, --write-out <format> Make curl display information on stdout after a completed transfer. See man page for more details on available variables. Convenient way to force curl to append a newline to output: -w "\n" (can add to ~/.curlrc).
      {
        name: "write-out",
        alias: ["write-out", "w"],
        description: '<format> Make curl display information on stdout after a completed transfer. See man page for more details on available variables. Convenient way to force curl to append a newline to output: -w "\n" (can add to ~/.curlrc).',
        convertor: null
      },
      // -X, --request The request method to use.
      {
        name: "method",
        alias: ["X", "request"],
        description: "The request method to use.",
        convertor: null
      },
      // -A, --user-agent <name>
      {
        name: "user-agent",
        alias: ["A", "user-agent"],
        description: "Specify the User-Agent send to the HTTP server.",
        convertor: null
      },
      // -e, --referer <URL>
      {
        name: "referer",
        alias: ["e", "referer"],
        description: 'Sends the "Referrer Page" information to the HTTP server.',
        convertor: null
      },
      // -u, --user username[:password]
      {
        name: "user",
        alias: ["u", "user"],
        description: 'Sends the "Authorization Basic" header to the HTTP server.',
        convertor: null
      }
    ];
  }
});

// node_modules/@bany/curl-to-json/src/matcher.js
var require_matcher = __commonJS({
  "node_modules/@bany/curl-to-json/src/matcher.js"(exports, module) {
    module.exports = {
      matchArgv: function(s) {
        return s.replace(/\\\n/g, " ").match(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g).map((s2) => {
          if (s2.startsWith(`'`) && s2.endsWith(`'`) || s2.startsWith(`"`) && s2.endsWith(`"`)) {
            return s2.substring(1, s2.length - 1);
          } else {
            return s2;
          }
        });
      }
    };
  }
});

// node_modules/@bany/curl-to-json/src/pare-json.js
var require_pare_json = __commonJS({
  "node_modules/@bany/curl-to-json/src/pare-json.js"(exports, module) {
    var minimistParser = require_minimist();
    var convertor = require_convertor();
    var options = require_option();
    var matcher = require_matcher();
    module.exports = exports.default = function(data) {
      if (typeof data === "string" || data instanceof String) {
        data = matcher.matchArgv(data);
      }
      const argv = minimistParser(data, {
        boolean: [
          "f",
          "fail",
          "i",
          "include",
          "I",
          "head",
          "k",
          "insecure",
          "L",
          "location",
          "O",
          "remote-name",
          "s",
          "silent",
          "v",
          "verbose"
        ]
      });
      let result = {};
      if (argv._[1]) {
        result.url = argv._[1].replace(/'/g, "");
      }
      options.forEach((element) => {
        let alias = element.alias;
        let value = alias.map((element2) => argv[element2]).filter((element2) => element2)[0];
        if (value) {
          if (element.convertor) {
            result[element.name] = element.convertor(value);
          } else {
            result[element.name] = value;
          }
        }
      });
      if (result.url) {
        let url = new URL(result.url);
        result.url = url.origin + url.pathname;
        let params = new URLSearchParams(url.search);
        if (Array.from(params).length) {
          result.params = convertor.parseParamsField(params.toString());
        }
      }
      if (!result.method) {
        result.method = result.data || result.form ? "POST" : "GET";
      }
      return result;
    };
  }
});
export default require_pare_json();
//# sourceMappingURL=@bany_curl-to-json.js.map
