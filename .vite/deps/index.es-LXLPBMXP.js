import {
  _asyncToGenerator,
  _defineProperty
} from "./chunk-O2PAOXRP.js";
import "./chunk-SITVF2AJ.js";
import {
  __commonJS,
  __toESM
} from "./chunk-EWTE5DHJ.js";

// node_modules/core-js/internals/global-this.js
var require_global_this = __commonJS({
  "node_modules/core-js/internals/global-this.js"(exports, module) {
    "use strict";
    var check = function(it) {
      return it && it.Math === Math && it;
    };
    module.exports = // eslint-disable-next-line es/no-global-this -- safe
    check(typeof globalThis == "object" && globalThis) || check(typeof window == "object" && window) || // eslint-disable-next-line no-restricted-globals -- safe
    check(typeof self == "object" && self) || check(typeof global == "object" && global) || check(typeof exports == "object" && exports) || // eslint-disable-next-line no-new-func -- fallback
    /* @__PURE__ */ function() {
      return this;
    }() || Function("return this")();
  }
});

// node_modules/core-js/internals/fails.js
var require_fails = __commonJS({
  "node_modules/core-js/internals/fails.js"(exports, module) {
    "use strict";
    module.exports = function(exec) {
      try {
        return !!exec();
      } catch (error) {
        return true;
      }
    };
  }
});

// node_modules/core-js/internals/descriptors.js
var require_descriptors = __commonJS({
  "node_modules/core-js/internals/descriptors.js"(exports, module) {
    "use strict";
    var fails4 = require_fails();
    module.exports = !fails4(function() {
      return Object.defineProperty({}, 1, { get: function() {
        return 7;
      } })[1] !== 7;
    });
  }
});

// node_modules/core-js/internals/function-bind-native.js
var require_function_bind_native = __commonJS({
  "node_modules/core-js/internals/function-bind-native.js"(exports, module) {
    "use strict";
    var fails4 = require_fails();
    module.exports = !fails4(function() {
      var test2 = (function() {
      }).bind();
      return typeof test2 != "function" || test2.hasOwnProperty("prototype");
    });
  }
});

// node_modules/core-js/internals/function-call.js
var require_function_call = __commonJS({
  "node_modules/core-js/internals/function-call.js"(exports, module) {
    "use strict";
    var NATIVE_BIND = require_function_bind_native();
    var call4 = Function.prototype.call;
    module.exports = NATIVE_BIND ? call4.bind(call4) : function() {
      return call4.apply(call4, arguments);
    };
  }
});

// node_modules/core-js/internals/object-property-is-enumerable.js
var require_object_property_is_enumerable = __commonJS({
  "node_modules/core-js/internals/object-property-is-enumerable.js"(exports) {
    "use strict";
    var $propertyIsEnumerable = {}.propertyIsEnumerable;
    var getOwnPropertyDescriptor3 = Object.getOwnPropertyDescriptor;
    var NASHORN_BUG = getOwnPropertyDescriptor3 && !$propertyIsEnumerable.call({ 1: 2 }, 1);
    exports.f = NASHORN_BUG ? function propertyIsEnumerable(V) {
      var descriptor = getOwnPropertyDescriptor3(this, V);
      return !!descriptor && descriptor.enumerable;
    } : $propertyIsEnumerable;
  }
});

// node_modules/core-js/internals/create-property-descriptor.js
var require_create_property_descriptor = __commonJS({
  "node_modules/core-js/internals/create-property-descriptor.js"(exports, module) {
    "use strict";
    module.exports = function(bitmap, value) {
      return {
        enumerable: !(bitmap & 1),
        configurable: !(bitmap & 2),
        writable: !(bitmap & 4),
        value
      };
    };
  }
});

// node_modules/core-js/internals/function-uncurry-this.js
var require_function_uncurry_this = __commonJS({
  "node_modules/core-js/internals/function-uncurry-this.js"(exports, module) {
    "use strict";
    var NATIVE_BIND = require_function_bind_native();
    var FunctionPrototype = Function.prototype;
    var call4 = FunctionPrototype.call;
    var uncurryThisWithBind = NATIVE_BIND && FunctionPrototype.bind.bind(call4, call4);
    module.exports = NATIVE_BIND ? uncurryThisWithBind : function(fn) {
      return function() {
        return call4.apply(fn, arguments);
      };
    };
  }
});

// node_modules/core-js/internals/classof-raw.js
var require_classof_raw = __commonJS({
  "node_modules/core-js/internals/classof-raw.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var toString7 = uncurryThis9({}.toString);
    var stringSlice4 = uncurryThis9("".slice);
    module.exports = function(it) {
      return stringSlice4(toString7(it), 8, -1);
    };
  }
});

// node_modules/core-js/internals/indexed-object.js
var require_indexed_object = __commonJS({
  "node_modules/core-js/internals/indexed-object.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var fails4 = require_fails();
    var classof = require_classof_raw();
    var $Object = Object;
    var split = uncurryThis9("".split);
    module.exports = fails4(function() {
      return !$Object("z").propertyIsEnumerable(0);
    }) ? function(it) {
      return classof(it) === "String" ? split(it, "") : $Object(it);
    } : $Object;
  }
});

// node_modules/core-js/internals/is-null-or-undefined.js
var require_is_null_or_undefined = __commonJS({
  "node_modules/core-js/internals/is-null-or-undefined.js"(exports, module) {
    "use strict";
    module.exports = function(it) {
      return it === null || it === void 0;
    };
  }
});

// node_modules/core-js/internals/require-object-coercible.js
var require_require_object_coercible = __commonJS({
  "node_modules/core-js/internals/require-object-coercible.js"(exports, module) {
    "use strict";
    var isNullOrUndefined = require_is_null_or_undefined();
    var $TypeError = TypeError;
    module.exports = function(it) {
      if (isNullOrUndefined(it)) throw new $TypeError("Can't call method on " + it);
      return it;
    };
  }
});

// node_modules/core-js/internals/to-indexed-object.js
var require_to_indexed_object = __commonJS({
  "node_modules/core-js/internals/to-indexed-object.js"(exports, module) {
    "use strict";
    var IndexedObject = require_indexed_object();
    var requireObjectCoercible7 = require_require_object_coercible();
    module.exports = function(it) {
      return IndexedObject(requireObjectCoercible7(it));
    };
  }
});

// node_modules/core-js/internals/is-callable.js
var require_is_callable = __commonJS({
  "node_modules/core-js/internals/is-callable.js"(exports, module) {
    "use strict";
    var documentAll = typeof document == "object" && document.all;
    module.exports = typeof documentAll == "undefined" && documentAll !== void 0 ? function(argument) {
      return typeof argument == "function" || argument === documentAll;
    } : function(argument) {
      return typeof argument == "function";
    };
  }
});

// node_modules/core-js/internals/is-object.js
var require_is_object = __commonJS({
  "node_modules/core-js/internals/is-object.js"(exports, module) {
    "use strict";
    var isCallable2 = require_is_callable();
    module.exports = function(it) {
      return typeof it == "object" ? it !== null : isCallable2(it);
    };
  }
});

// node_modules/core-js/internals/get-built-in.js
var require_get_built_in = __commonJS({
  "node_modules/core-js/internals/get-built-in.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var isCallable2 = require_is_callable();
    var aFunction = function(argument) {
      return isCallable2(argument) ? argument : void 0;
    };
    module.exports = function(namespace, method) {
      return arguments.length < 2 ? aFunction(globalThis3[namespace]) : globalThis3[namespace] && globalThis3[namespace][method];
    };
  }
});

// node_modules/core-js/internals/object-is-prototype-of.js
var require_object_is_prototype_of = __commonJS({
  "node_modules/core-js/internals/object-is-prototype-of.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    module.exports = uncurryThis9({}.isPrototypeOf);
  }
});

// node_modules/core-js/internals/environment-user-agent.js
var require_environment_user_agent = __commonJS({
  "node_modules/core-js/internals/environment-user-agent.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var navigator = globalThis3.navigator;
    var userAgent = navigator && navigator.userAgent;
    module.exports = userAgent ? String(userAgent) : "";
  }
});

// node_modules/core-js/internals/environment-v8-version.js
var require_environment_v8_version = __commonJS({
  "node_modules/core-js/internals/environment-v8-version.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var userAgent = require_environment_user_agent();
    var process2 = globalThis3.process;
    var Deno2 = globalThis3.Deno;
    var versions = process2 && process2.versions || Deno2 && Deno2.version;
    var v8 = versions && versions.v8;
    var match;
    var version;
    if (v8) {
      match = v8.split(".");
      version = match[0] > 0 && match[0] < 4 ? 1 : +(match[0] + match[1]);
    }
    if (!version && userAgent) {
      match = userAgent.match(/Edge\/(\d+)/);
      if (!match || match[1] >= 74) {
        match = userAgent.match(/Chrome\/(\d+)/);
        if (match) version = +match[1];
      }
    }
    module.exports = version;
  }
});

// node_modules/core-js/internals/symbol-constructor-detection.js
var require_symbol_constructor_detection = __commonJS({
  "node_modules/core-js/internals/symbol-constructor-detection.js"(exports, module) {
    "use strict";
    var V8_VERSION = require_environment_v8_version();
    var fails4 = require_fails();
    var globalThis3 = require_global_this();
    var $String = globalThis3.String;
    module.exports = !!Object.getOwnPropertySymbols && !fails4(function() {
      var symbol = Symbol("symbol detection");
      return !$String(symbol) || !(Object(symbol) instanceof Symbol) || // Chrome 38-40 symbols are not inherited from DOM collections prototypes to instances
      !Symbol.sham && V8_VERSION && V8_VERSION < 41;
    });
  }
});

// node_modules/core-js/internals/use-symbol-as-uid.js
var require_use_symbol_as_uid = __commonJS({
  "node_modules/core-js/internals/use-symbol-as-uid.js"(exports, module) {
    "use strict";
    var NATIVE_SYMBOL = require_symbol_constructor_detection();
    module.exports = NATIVE_SYMBOL && !Symbol.sham && typeof Symbol.iterator == "symbol";
  }
});

// node_modules/core-js/internals/is-symbol.js
var require_is_symbol = __commonJS({
  "node_modules/core-js/internals/is-symbol.js"(exports, module) {
    "use strict";
    var getBuiltIn = require_get_built_in();
    var isCallable2 = require_is_callable();
    var isPrototypeOf = require_object_is_prototype_of();
    var USE_SYMBOL_AS_UID = require_use_symbol_as_uid();
    var $Object = Object;
    module.exports = USE_SYMBOL_AS_UID ? function(it) {
      return typeof it == "symbol";
    } : function(it) {
      var $Symbol = getBuiltIn("Symbol");
      return isCallable2($Symbol) && isPrototypeOf($Symbol.prototype, $Object(it));
    };
  }
});

// node_modules/core-js/internals/try-to-string.js
var require_try_to_string = __commonJS({
  "node_modules/core-js/internals/try-to-string.js"(exports, module) {
    "use strict";
    var $String = String;
    module.exports = function(argument) {
      try {
        return $String(argument);
      } catch (error) {
        return "Object";
      }
    };
  }
});

// node_modules/core-js/internals/a-callable.js
var require_a_callable = __commonJS({
  "node_modules/core-js/internals/a-callable.js"(exports, module) {
    "use strict";
    var isCallable2 = require_is_callable();
    var tryToString = require_try_to_string();
    var $TypeError = TypeError;
    module.exports = function(argument) {
      if (isCallable2(argument)) return argument;
      throw new $TypeError(tryToString(argument) + " is not a function");
    };
  }
});

// node_modules/core-js/internals/get-method.js
var require_get_method = __commonJS({
  "node_modules/core-js/internals/get-method.js"(exports, module) {
    "use strict";
    var aCallable = require_a_callable();
    var isNullOrUndefined = require_is_null_or_undefined();
    module.exports = function(V, P) {
      var func = V[P];
      return isNullOrUndefined(func) ? void 0 : aCallable(func);
    };
  }
});

// node_modules/core-js/internals/ordinary-to-primitive.js
var require_ordinary_to_primitive = __commonJS({
  "node_modules/core-js/internals/ordinary-to-primitive.js"(exports, module) {
    "use strict";
    var call4 = require_function_call();
    var isCallable2 = require_is_callable();
    var isObject4 = require_is_object();
    var $TypeError = TypeError;
    module.exports = function(input, pref) {
      var fn, val;
      if (pref === "string" && isCallable2(fn = input.toString) && !isObject4(val = call4(fn, input))) return val;
      if (isCallable2(fn = input.valueOf) && !isObject4(val = call4(fn, input))) return val;
      if (pref !== "string" && isCallable2(fn = input.toString) && !isObject4(val = call4(fn, input))) return val;
      throw new $TypeError("Can't convert object to primitive value");
    };
  }
});

// node_modules/core-js/internals/is-pure.js
var require_is_pure = __commonJS({
  "node_modules/core-js/internals/is-pure.js"(exports, module) {
    "use strict";
    module.exports = false;
  }
});

// node_modules/core-js/internals/define-global-property.js
var require_define_global_property = __commonJS({
  "node_modules/core-js/internals/define-global-property.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var defineProperty = Object.defineProperty;
    module.exports = function(key, value) {
      try {
        defineProperty(globalThis3, key, { value, configurable: true, writable: true });
      } catch (error) {
        globalThis3[key] = value;
      }
      return value;
    };
  }
});

// node_modules/core-js/internals/shared-store.js
var require_shared_store = __commonJS({
  "node_modules/core-js/internals/shared-store.js"(exports, module) {
    "use strict";
    var IS_PURE3 = require_is_pure();
    var globalThis3 = require_global_this();
    var defineGlobalProperty = require_define_global_property();
    var SHARED = "__core-js_shared__";
    var store = module.exports = globalThis3[SHARED] || defineGlobalProperty(SHARED, {});
    (store.versions || (store.versions = [])).push({
      version: "3.48.0",
      mode: IS_PURE3 ? "pure" : "global",
      copyright: "© 2013–2025 Denis Pushkarev (zloirock.ru), 2025–2026 CoreJS Company (core-js.io). All rights reserved.",
      license: "https://github.com/zloirock/core-js/blob/v3.48.0/LICENSE",
      source: "https://github.com/zloirock/core-js"
    });
  }
});

// node_modules/core-js/internals/shared.js
var require_shared = __commonJS({
  "node_modules/core-js/internals/shared.js"(exports, module) {
    "use strict";
    var store = require_shared_store();
    module.exports = function(key, value) {
      return store[key] || (store[key] = value || {});
    };
  }
});

// node_modules/core-js/internals/to-object.js
var require_to_object = __commonJS({
  "node_modules/core-js/internals/to-object.js"(exports, module) {
    "use strict";
    var requireObjectCoercible7 = require_require_object_coercible();
    var $Object = Object;
    module.exports = function(argument) {
      return $Object(requireObjectCoercible7(argument));
    };
  }
});

// node_modules/core-js/internals/has-own-property.js
var require_has_own_property = __commonJS({
  "node_modules/core-js/internals/has-own-property.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var toObject = require_to_object();
    var hasOwnProperty = uncurryThis9({}.hasOwnProperty);
    module.exports = Object.hasOwn || function hasOwn(it, key) {
      return hasOwnProperty(toObject(it), key);
    };
  }
});

// node_modules/core-js/internals/uid.js
var require_uid = __commonJS({
  "node_modules/core-js/internals/uid.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var id = 0;
    var postfix = Math.random();
    var toString7 = uncurryThis9(1.1.toString);
    module.exports = function(key) {
      return "Symbol(" + (key === void 0 ? "" : key) + ")_" + toString7(++id + postfix, 36);
    };
  }
});

// node_modules/core-js/internals/well-known-symbol.js
var require_well_known_symbol = __commonJS({
  "node_modules/core-js/internals/well-known-symbol.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var shared = require_shared();
    var hasOwn = require_has_own_property();
    var uid = require_uid();
    var NATIVE_SYMBOL = require_symbol_constructor_detection();
    var USE_SYMBOL_AS_UID = require_use_symbol_as_uid();
    var Symbol2 = globalThis3.Symbol;
    var WellKnownSymbolsStore = shared("wks");
    var createWellKnownSymbol = USE_SYMBOL_AS_UID ? Symbol2["for"] || Symbol2 : Symbol2 && Symbol2.withoutSetter || uid;
    module.exports = function(name) {
      if (!hasOwn(WellKnownSymbolsStore, name)) {
        WellKnownSymbolsStore[name] = NATIVE_SYMBOL && hasOwn(Symbol2, name) ? Symbol2[name] : createWellKnownSymbol("Symbol." + name);
      }
      return WellKnownSymbolsStore[name];
    };
  }
});

// node_modules/core-js/internals/to-primitive.js
var require_to_primitive = __commonJS({
  "node_modules/core-js/internals/to-primitive.js"(exports, module) {
    "use strict";
    var call4 = require_function_call();
    var isObject4 = require_is_object();
    var isSymbol = require_is_symbol();
    var getMethod4 = require_get_method();
    var ordinaryToPrimitive = require_ordinary_to_primitive();
    var wellKnownSymbol3 = require_well_known_symbol();
    var $TypeError = TypeError;
    var TO_PRIMITIVE = wellKnownSymbol3("toPrimitive");
    module.exports = function(input, pref) {
      if (!isObject4(input) || isSymbol(input)) return input;
      var exoticToPrim = getMethod4(input, TO_PRIMITIVE);
      var result;
      if (exoticToPrim) {
        if (pref === void 0) pref = "default";
        result = call4(exoticToPrim, input, pref);
        if (!isObject4(result) || isSymbol(result)) return result;
        throw new $TypeError("Can't convert object to primitive value");
      }
      if (pref === void 0) pref = "number";
      return ordinaryToPrimitive(input, pref);
    };
  }
});

// node_modules/core-js/internals/to-property-key.js
var require_to_property_key = __commonJS({
  "node_modules/core-js/internals/to-property-key.js"(exports, module) {
    "use strict";
    var toPrimitive = require_to_primitive();
    var isSymbol = require_is_symbol();
    module.exports = function(argument) {
      var key = toPrimitive(argument, "string");
      return isSymbol(key) ? key : key + "";
    };
  }
});

// node_modules/core-js/internals/document-create-element.js
var require_document_create_element = __commonJS({
  "node_modules/core-js/internals/document-create-element.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var isObject4 = require_is_object();
    var document2 = globalThis3.document;
    var EXISTS = isObject4(document2) && isObject4(document2.createElement);
    module.exports = function(it) {
      return EXISTS ? document2.createElement(it) : {};
    };
  }
});

// node_modules/core-js/internals/ie8-dom-define.js
var require_ie8_dom_define = __commonJS({
  "node_modules/core-js/internals/ie8-dom-define.js"(exports, module) {
    "use strict";
    var DESCRIPTORS = require_descriptors();
    var fails4 = require_fails();
    var createElement = require_document_create_element();
    module.exports = !DESCRIPTORS && !fails4(function() {
      return Object.defineProperty(createElement("div"), "a", {
        get: function() {
          return 7;
        }
      }).a !== 7;
    });
  }
});

// node_modules/core-js/internals/object-get-own-property-descriptor.js
var require_object_get_own_property_descriptor = __commonJS({
  "node_modules/core-js/internals/object-get-own-property-descriptor.js"(exports) {
    "use strict";
    var DESCRIPTORS = require_descriptors();
    var call4 = require_function_call();
    var propertyIsEnumerableModule = require_object_property_is_enumerable();
    var createPropertyDescriptor = require_create_property_descriptor();
    var toIndexedObject = require_to_indexed_object();
    var toPropertyKey = require_to_property_key();
    var hasOwn = require_has_own_property();
    var IE8_DOM_DEFINE = require_ie8_dom_define();
    var $getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    exports.f = DESCRIPTORS ? $getOwnPropertyDescriptor : function getOwnPropertyDescriptor3(O2, P) {
      O2 = toIndexedObject(O2);
      P = toPropertyKey(P);
      if (IE8_DOM_DEFINE) try {
        return $getOwnPropertyDescriptor(O2, P);
      } catch (error) {
      }
      if (hasOwn(O2, P)) return createPropertyDescriptor(!call4(propertyIsEnumerableModule.f, O2, P), O2[P]);
    };
  }
});

// node_modules/core-js/internals/v8-prototype-define-bug.js
var require_v8_prototype_define_bug = __commonJS({
  "node_modules/core-js/internals/v8-prototype-define-bug.js"(exports, module) {
    "use strict";
    var DESCRIPTORS = require_descriptors();
    var fails4 = require_fails();
    module.exports = DESCRIPTORS && fails4(function() {
      return Object.defineProperty(function() {
      }, "prototype", {
        value: 42,
        writable: false
      }).prototype !== 42;
    });
  }
});

// node_modules/core-js/internals/an-object.js
var require_an_object = __commonJS({
  "node_modules/core-js/internals/an-object.js"(exports, module) {
    "use strict";
    var isObject4 = require_is_object();
    var $String = String;
    var $TypeError = TypeError;
    module.exports = function(argument) {
      if (isObject4(argument)) return argument;
      throw new $TypeError($String(argument) + " is not an object");
    };
  }
});

// node_modules/core-js/internals/object-define-property.js
var require_object_define_property = __commonJS({
  "node_modules/core-js/internals/object-define-property.js"(exports) {
    "use strict";
    var DESCRIPTORS = require_descriptors();
    var IE8_DOM_DEFINE = require_ie8_dom_define();
    var V8_PROTOTYPE_DEFINE_BUG = require_v8_prototype_define_bug();
    var anObject5 = require_an_object();
    var toPropertyKey = require_to_property_key();
    var $TypeError = TypeError;
    var $defineProperty = Object.defineProperty;
    var $getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    var ENUMERABLE = "enumerable";
    var CONFIGURABLE = "configurable";
    var WRITABLE = "writable";
    exports.f = DESCRIPTORS ? V8_PROTOTYPE_DEFINE_BUG ? function defineProperty(O2, P, Attributes) {
      anObject5(O2);
      P = toPropertyKey(P);
      anObject5(Attributes);
      if (typeof O2 === "function" && P === "prototype" && "value" in Attributes && WRITABLE in Attributes && !Attributes[WRITABLE]) {
        var current = $getOwnPropertyDescriptor(O2, P);
        if (current && current[WRITABLE]) {
          O2[P] = Attributes.value;
          Attributes = {
            configurable: CONFIGURABLE in Attributes ? Attributes[CONFIGURABLE] : current[CONFIGURABLE],
            enumerable: ENUMERABLE in Attributes ? Attributes[ENUMERABLE] : current[ENUMERABLE],
            writable: false
          };
        }
      }
      return $defineProperty(O2, P, Attributes);
    } : $defineProperty : function defineProperty(O2, P, Attributes) {
      anObject5(O2);
      P = toPropertyKey(P);
      anObject5(Attributes);
      if (IE8_DOM_DEFINE) try {
        return $defineProperty(O2, P, Attributes);
      } catch (error) {
      }
      if ("get" in Attributes || "set" in Attributes) throw new $TypeError("Accessors not supported");
      if ("value" in Attributes) O2[P] = Attributes.value;
      return O2;
    };
  }
});

// node_modules/core-js/internals/create-non-enumerable-property.js
var require_create_non_enumerable_property = __commonJS({
  "node_modules/core-js/internals/create-non-enumerable-property.js"(exports, module) {
    "use strict";
    var DESCRIPTORS = require_descriptors();
    var definePropertyModule = require_object_define_property();
    var createPropertyDescriptor = require_create_property_descriptor();
    module.exports = DESCRIPTORS ? function(object, key, value) {
      return definePropertyModule.f(object, key, createPropertyDescriptor(1, value));
    } : function(object, key, value) {
      object[key] = value;
      return object;
    };
  }
});

// node_modules/core-js/internals/function-name.js
var require_function_name = __commonJS({
  "node_modules/core-js/internals/function-name.js"(exports, module) {
    "use strict";
    var DESCRIPTORS = require_descriptors();
    var hasOwn = require_has_own_property();
    var FunctionPrototype = Function.prototype;
    var getDescriptor = DESCRIPTORS && Object.getOwnPropertyDescriptor;
    var EXISTS = hasOwn(FunctionPrototype, "name");
    var PROPER = EXISTS && (function something() {
    }).name === "something";
    var CONFIGURABLE = EXISTS && (!DESCRIPTORS || DESCRIPTORS && getDescriptor(FunctionPrototype, "name").configurable);
    module.exports = {
      EXISTS,
      PROPER,
      CONFIGURABLE
    };
  }
});

// node_modules/core-js/internals/inspect-source.js
var require_inspect_source = __commonJS({
  "node_modules/core-js/internals/inspect-source.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var isCallable2 = require_is_callable();
    var store = require_shared_store();
    var functionToString = uncurryThis9(Function.toString);
    if (!isCallable2(store.inspectSource)) {
      store.inspectSource = function(it) {
        return functionToString(it);
      };
    }
    module.exports = store.inspectSource;
  }
});

// node_modules/core-js/internals/weak-map-basic-detection.js
var require_weak_map_basic_detection = __commonJS({
  "node_modules/core-js/internals/weak-map-basic-detection.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var isCallable2 = require_is_callable();
    var WeakMap = globalThis3.WeakMap;
    module.exports = isCallable2(WeakMap) && /native code/.test(String(WeakMap));
  }
});

// node_modules/core-js/internals/shared-key.js
var require_shared_key = __commonJS({
  "node_modules/core-js/internals/shared-key.js"(exports, module) {
    "use strict";
    var shared = require_shared();
    var uid = require_uid();
    var keys = shared("keys");
    module.exports = function(key) {
      return keys[key] || (keys[key] = uid(key));
    };
  }
});

// node_modules/core-js/internals/hidden-keys.js
var require_hidden_keys = __commonJS({
  "node_modules/core-js/internals/hidden-keys.js"(exports, module) {
    "use strict";
    module.exports = {};
  }
});

// node_modules/core-js/internals/internal-state.js
var require_internal_state = __commonJS({
  "node_modules/core-js/internals/internal-state.js"(exports, module) {
    "use strict";
    var NATIVE_WEAK_MAP = require_weak_map_basic_detection();
    var globalThis3 = require_global_this();
    var isObject4 = require_is_object();
    var createNonEnumerableProperty2 = require_create_non_enumerable_property();
    var hasOwn = require_has_own_property();
    var shared = require_shared_store();
    var sharedKey = require_shared_key();
    var hiddenKeys = require_hidden_keys();
    var OBJECT_ALREADY_INITIALIZED = "Object already initialized";
    var TypeError2 = globalThis3.TypeError;
    var WeakMap = globalThis3.WeakMap;
    var set;
    var get;
    var has;
    var enforce = function(it) {
      return has(it) ? get(it) : set(it, {});
    };
    var getterFor = function(TYPE) {
      return function(it) {
        var state;
        if (!isObject4(it) || (state = get(it)).type !== TYPE) {
          throw new TypeError2("Incompatible receiver, " + TYPE + " required");
        }
        return state;
      };
    };
    if (NATIVE_WEAK_MAP || shared.state) {
      store = shared.state || (shared.state = new WeakMap());
      store.get = store.get;
      store.has = store.has;
      store.set = store.set;
      set = function(it, metadata) {
        if (store.has(it)) throw new TypeError2(OBJECT_ALREADY_INITIALIZED);
        metadata.facade = it;
        store.set(it, metadata);
        return metadata;
      };
      get = function(it) {
        return store.get(it) || {};
      };
      has = function(it) {
        return store.has(it);
      };
    } else {
      STATE = sharedKey("state");
      hiddenKeys[STATE] = true;
      set = function(it, metadata) {
        if (hasOwn(it, STATE)) throw new TypeError2(OBJECT_ALREADY_INITIALIZED);
        metadata.facade = it;
        createNonEnumerableProperty2(it, STATE, metadata);
        return metadata;
      };
      get = function(it) {
        return hasOwn(it, STATE) ? it[STATE] : {};
      };
      has = function(it) {
        return hasOwn(it, STATE);
      };
    }
    var store;
    var STATE;
    module.exports = {
      set,
      get,
      has,
      enforce,
      getterFor
    };
  }
});

// node_modules/core-js/internals/make-built-in.js
var require_make_built_in = __commonJS({
  "node_modules/core-js/internals/make-built-in.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var fails4 = require_fails();
    var isCallable2 = require_is_callable();
    var hasOwn = require_has_own_property();
    var DESCRIPTORS = require_descriptors();
    var CONFIGURABLE_FUNCTION_NAME = require_function_name().CONFIGURABLE;
    var inspectSource = require_inspect_source();
    var InternalStateModule = require_internal_state();
    var enforceInternalState = InternalStateModule.enforce;
    var getInternalState = InternalStateModule.get;
    var $String = String;
    var defineProperty = Object.defineProperty;
    var stringSlice4 = uncurryThis9("".slice);
    var replace = uncurryThis9("".replace);
    var join = uncurryThis9([].join);
    var CONFIGURABLE_LENGTH = DESCRIPTORS && !fails4(function() {
      return defineProperty(function() {
      }, "length", { value: 8 }).length !== 8;
    });
    var TEMPLATE = String(String).split("String");
    var makeBuiltIn = module.exports = function(value, name, options) {
      if (stringSlice4($String(name), 0, 7) === "Symbol(") {
        name = "[" + replace($String(name), /^Symbol\(([^)]*)\).*$/, "$1") + "]";
      }
      if (options && options.getter) name = "get " + name;
      if (options && options.setter) name = "set " + name;
      if (!hasOwn(value, "name") || CONFIGURABLE_FUNCTION_NAME && value.name !== name) {
        if (DESCRIPTORS) defineProperty(value, "name", { value: name, configurable: true });
        else value.name = name;
      }
      if (CONFIGURABLE_LENGTH && options && hasOwn(options, "arity") && value.length !== options.arity) {
        defineProperty(value, "length", { value: options.arity });
      }
      try {
        if (options && hasOwn(options, "constructor") && options.constructor) {
          if (DESCRIPTORS) defineProperty(value, "prototype", { writable: false });
        } else if (value.prototype) value.prototype = void 0;
      } catch (error) {
      }
      var state = enforceInternalState(value);
      if (!hasOwn(state, "source")) {
        state.source = join(TEMPLATE, typeof name == "string" ? name : "");
      }
      return value;
    };
    Function.prototype.toString = makeBuiltIn(function toString7() {
      return isCallable2(this) && getInternalState(this).source || inspectSource(this);
    }, "toString");
  }
});

// node_modules/core-js/internals/define-built-in.js
var require_define_built_in = __commonJS({
  "node_modules/core-js/internals/define-built-in.js"(exports, module) {
    "use strict";
    var isCallable2 = require_is_callable();
    var definePropertyModule = require_object_define_property();
    var makeBuiltIn = require_make_built_in();
    var defineGlobalProperty = require_define_global_property();
    module.exports = function(O2, key, value, options) {
      if (!options) options = {};
      var simple = options.enumerable;
      var name = options.name !== void 0 ? options.name : key;
      if (isCallable2(value)) makeBuiltIn(value, name, options);
      if (options.global) {
        if (simple) O2[key] = value;
        else defineGlobalProperty(key, value);
      } else {
        try {
          if (!options.unsafe) delete O2[key];
          else if (O2[key]) simple = true;
        } catch (error) {
        }
        if (simple) O2[key] = value;
        else definePropertyModule.f(O2, key, {
          value,
          enumerable: false,
          configurable: !options.nonConfigurable,
          writable: !options.nonWritable
        });
      }
      return O2;
    };
  }
});

// node_modules/core-js/internals/math-trunc.js
var require_math_trunc = __commonJS({
  "node_modules/core-js/internals/math-trunc.js"(exports, module) {
    "use strict";
    var ceil = Math.ceil;
    var floor = Math.floor;
    module.exports = Math.trunc || function trunc(x) {
      var n2 = +x;
      return (n2 > 0 ? floor : ceil)(n2);
    };
  }
});

// node_modules/core-js/internals/to-integer-or-infinity.js
var require_to_integer_or_infinity = __commonJS({
  "node_modules/core-js/internals/to-integer-or-infinity.js"(exports, module) {
    "use strict";
    var trunc = require_math_trunc();
    module.exports = function(argument) {
      var number = +argument;
      return number !== number || number === 0 ? 0 : trunc(number);
    };
  }
});

// node_modules/core-js/internals/to-absolute-index.js
var require_to_absolute_index = __commonJS({
  "node_modules/core-js/internals/to-absolute-index.js"(exports, module) {
    "use strict";
    var toIntegerOrInfinity2 = require_to_integer_or_infinity();
    var max2 = Math.max;
    var min5 = Math.min;
    module.exports = function(index2, length) {
      var integer = toIntegerOrInfinity2(index2);
      return integer < 0 ? max2(integer + length, 0) : min5(integer, length);
    };
  }
});

// node_modules/core-js/internals/to-length.js
var require_to_length = __commonJS({
  "node_modules/core-js/internals/to-length.js"(exports, module) {
    "use strict";
    var toIntegerOrInfinity2 = require_to_integer_or_infinity();
    var min5 = Math.min;
    module.exports = function(argument) {
      var len = toIntegerOrInfinity2(argument);
      return len > 0 ? min5(len, 9007199254740991) : 0;
    };
  }
});

// node_modules/core-js/internals/length-of-array-like.js
var require_length_of_array_like = __commonJS({
  "node_modules/core-js/internals/length-of-array-like.js"(exports, module) {
    "use strict";
    var toLength6 = require_to_length();
    module.exports = function(obj) {
      return toLength6(obj.length);
    };
  }
});

// node_modules/core-js/internals/array-includes.js
var require_array_includes = __commonJS({
  "node_modules/core-js/internals/array-includes.js"(exports, module) {
    "use strict";
    var toIndexedObject = require_to_indexed_object();
    var toAbsoluteIndex = require_to_absolute_index();
    var lengthOfArrayLike = require_length_of_array_like();
    var createMethod = function(IS_INCLUDES) {
      return function($this, el, fromIndex) {
        var O2 = toIndexedObject($this);
        var length = lengthOfArrayLike(O2);
        if (length === 0) return !IS_INCLUDES && -1;
        var index2 = toAbsoluteIndex(fromIndex, length);
        var value;
        if (IS_INCLUDES && el !== el) while (length > index2) {
          value = O2[index2++];
          if (value !== value) return true;
        }
        else for (; length > index2; index2++) {
          if ((IS_INCLUDES || index2 in O2) && O2[index2] === el) return IS_INCLUDES || index2 || 0;
        }
        return !IS_INCLUDES && -1;
      };
    };
    module.exports = {
      // `Array.prototype.includes` method
      // https://tc39.es/ecma262/#sec-array.prototype.includes
      includes: createMethod(true),
      // `Array.prototype.indexOf` method
      // https://tc39.es/ecma262/#sec-array.prototype.indexof
      indexOf: createMethod(false)
    };
  }
});

// node_modules/core-js/internals/object-keys-internal.js
var require_object_keys_internal = __commonJS({
  "node_modules/core-js/internals/object-keys-internal.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var hasOwn = require_has_own_property();
    var toIndexedObject = require_to_indexed_object();
    var indexOf2 = require_array_includes().indexOf;
    var hiddenKeys = require_hidden_keys();
    var push3 = uncurryThis9([].push);
    module.exports = function(object, names) {
      var O2 = toIndexedObject(object);
      var i2 = 0;
      var result = [];
      var key;
      for (key in O2) !hasOwn(hiddenKeys, key) && hasOwn(O2, key) && push3(result, key);
      while (names.length > i2) if (hasOwn(O2, key = names[i2++])) {
        ~indexOf2(result, key) || push3(result, key);
      }
      return result;
    };
  }
});

// node_modules/core-js/internals/enum-bug-keys.js
var require_enum_bug_keys = __commonJS({
  "node_modules/core-js/internals/enum-bug-keys.js"(exports, module) {
    "use strict";
    module.exports = [
      "constructor",
      "hasOwnProperty",
      "isPrototypeOf",
      "propertyIsEnumerable",
      "toLocaleString",
      "toString",
      "valueOf"
    ];
  }
});

// node_modules/core-js/internals/object-get-own-property-names.js
var require_object_get_own_property_names = __commonJS({
  "node_modules/core-js/internals/object-get-own-property-names.js"(exports) {
    "use strict";
    var internalObjectKeys = require_object_keys_internal();
    var enumBugKeys = require_enum_bug_keys();
    var hiddenKeys = enumBugKeys.concat("length", "prototype");
    exports.f = Object.getOwnPropertyNames || function getOwnPropertyNames(O2) {
      return internalObjectKeys(O2, hiddenKeys);
    };
  }
});

// node_modules/core-js/internals/object-get-own-property-symbols.js
var require_object_get_own_property_symbols = __commonJS({
  "node_modules/core-js/internals/object-get-own-property-symbols.js"(exports) {
    "use strict";
    exports.f = Object.getOwnPropertySymbols;
  }
});

// node_modules/core-js/internals/own-keys.js
var require_own_keys = __commonJS({
  "node_modules/core-js/internals/own-keys.js"(exports, module) {
    "use strict";
    var getBuiltIn = require_get_built_in();
    var uncurryThis9 = require_function_uncurry_this();
    var getOwnPropertyNamesModule = require_object_get_own_property_names();
    var getOwnPropertySymbolsModule = require_object_get_own_property_symbols();
    var anObject5 = require_an_object();
    var concat2 = uncurryThis9([].concat);
    module.exports = getBuiltIn("Reflect", "ownKeys") || function ownKeys2(it) {
      var keys = getOwnPropertyNamesModule.f(anObject5(it));
      var getOwnPropertySymbols = getOwnPropertySymbolsModule.f;
      return getOwnPropertySymbols ? concat2(keys, getOwnPropertySymbols(it)) : keys;
    };
  }
});

// node_modules/core-js/internals/copy-constructor-properties.js
var require_copy_constructor_properties = __commonJS({
  "node_modules/core-js/internals/copy-constructor-properties.js"(exports, module) {
    "use strict";
    var hasOwn = require_has_own_property();
    var ownKeys2 = require_own_keys();
    var getOwnPropertyDescriptorModule = require_object_get_own_property_descriptor();
    var definePropertyModule = require_object_define_property();
    module.exports = function(target, source, exceptions) {
      var keys = ownKeys2(source);
      var defineProperty = definePropertyModule.f;
      var getOwnPropertyDescriptor3 = getOwnPropertyDescriptorModule.f;
      for (var i2 = 0; i2 < keys.length; i2++) {
        var key = keys[i2];
        if (!hasOwn(target, key) && !(exceptions && hasOwn(exceptions, key))) {
          defineProperty(target, key, getOwnPropertyDescriptor3(source, key));
        }
      }
    };
  }
});

// node_modules/core-js/internals/is-forced.js
var require_is_forced = __commonJS({
  "node_modules/core-js/internals/is-forced.js"(exports, module) {
    "use strict";
    var fails4 = require_fails();
    var isCallable2 = require_is_callable();
    var replacement = /#|\.prototype\./;
    var isForced = function(feature, detection) {
      var value = data[normalize(feature)];
      return value === POLYFILL ? true : value === NATIVE ? false : isCallable2(detection) ? fails4(detection) : !!detection;
    };
    var normalize = isForced.normalize = function(string) {
      return String(string).replace(replacement, ".").toLowerCase();
    };
    var data = isForced.data = {};
    var NATIVE = isForced.NATIVE = "N";
    var POLYFILL = isForced.POLYFILL = "P";
    module.exports = isForced;
  }
});

// node_modules/core-js/internals/export.js
var require_export = __commonJS({
  "node_modules/core-js/internals/export.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var getOwnPropertyDescriptor3 = require_object_get_own_property_descriptor().f;
    var createNonEnumerableProperty2 = require_create_non_enumerable_property();
    var defineBuiltIn2 = require_define_built_in();
    var defineGlobalProperty = require_define_global_property();
    var copyConstructorProperties = require_copy_constructor_properties();
    var isForced = require_is_forced();
    module.exports = function(options, source) {
      var TARGET = options.target;
      var GLOBAL = options.global;
      var STATIC = options.stat;
      var FORCED3, target, key, targetProperty, sourceProperty, descriptor;
      if (GLOBAL) {
        target = globalThis3;
      } else if (STATIC) {
        target = globalThis3[TARGET] || defineGlobalProperty(TARGET, {});
      } else {
        target = globalThis3[TARGET] && globalThis3[TARGET].prototype;
      }
      if (target) for (key in source) {
        sourceProperty = source[key];
        if (options.dontCallGetSet) {
          descriptor = getOwnPropertyDescriptor3(target, key);
          targetProperty = descriptor && descriptor.value;
        } else targetProperty = target[key];
        FORCED3 = isForced(GLOBAL ? key : TARGET + (STATIC ? "." : "#") + key, options.forced);
        if (!FORCED3 && targetProperty !== void 0) {
          if (typeof sourceProperty == typeof targetProperty) continue;
          copyConstructorProperties(sourceProperty, targetProperty);
        }
        if (options.sham || targetProperty && targetProperty.sham) {
          createNonEnumerableProperty2(sourceProperty, "sham", true);
        }
        defineBuiltIn2(target, key, sourceProperty, options);
      }
    };
  }
});

// node_modules/core-js/internals/environment.js
var require_environment = __commonJS({
  "node_modules/core-js/internals/environment.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var userAgent = require_environment_user_agent();
    var classof = require_classof_raw();
    var userAgentStartsWith = function(string) {
      return userAgent.slice(0, string.length) === string;
    };
    module.exports = function() {
      if (userAgentStartsWith("Bun/")) return "BUN";
      if (userAgentStartsWith("Cloudflare-Workers")) return "CLOUDFLARE";
      if (userAgentStartsWith("Deno/")) return "DENO";
      if (userAgentStartsWith("Node.js/")) return "NODE";
      if (globalThis3.Bun && typeof Bun.version == "string") return "BUN";
      if (globalThis3.Deno && typeof Deno.version == "object") return "DENO";
      if (classof(globalThis3.process) === "process") return "NODE";
      if (globalThis3.window && globalThis3.document) return "BROWSER";
      return "REST";
    }();
  }
});

// node_modules/core-js/internals/environment-is-node.js
var require_environment_is_node = __commonJS({
  "node_modules/core-js/internals/environment-is-node.js"(exports, module) {
    "use strict";
    var ENVIRONMENT = require_environment();
    module.exports = ENVIRONMENT === "NODE";
  }
});

// node_modules/core-js/internals/path.js
var require_path = __commonJS({
  "node_modules/core-js/internals/path.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    module.exports = globalThis3;
  }
});

// node_modules/core-js/internals/function-uncurry-this-accessor.js
var require_function_uncurry_this_accessor = __commonJS({
  "node_modules/core-js/internals/function-uncurry-this-accessor.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var aCallable = require_a_callable();
    module.exports = function(object, key, method) {
      try {
        return uncurryThis9(aCallable(Object.getOwnPropertyDescriptor(object, key)[method]));
      } catch (error) {
      }
    };
  }
});

// node_modules/core-js/internals/is-possible-prototype.js
var require_is_possible_prototype = __commonJS({
  "node_modules/core-js/internals/is-possible-prototype.js"(exports, module) {
    "use strict";
    var isObject4 = require_is_object();
    module.exports = function(argument) {
      return isObject4(argument) || argument === null;
    };
  }
});

// node_modules/core-js/internals/a-possible-prototype.js
var require_a_possible_prototype = __commonJS({
  "node_modules/core-js/internals/a-possible-prototype.js"(exports, module) {
    "use strict";
    var isPossiblePrototype = require_is_possible_prototype();
    var $String = String;
    var $TypeError = TypeError;
    module.exports = function(argument) {
      if (isPossiblePrototype(argument)) return argument;
      throw new $TypeError("Can't set " + $String(argument) + " as a prototype");
    };
  }
});

// node_modules/core-js/internals/object-set-prototype-of.js
var require_object_set_prototype_of = __commonJS({
  "node_modules/core-js/internals/object-set-prototype-of.js"(exports, module) {
    "use strict";
    var uncurryThisAccessor = require_function_uncurry_this_accessor();
    var isObject4 = require_is_object();
    var requireObjectCoercible7 = require_require_object_coercible();
    var aPossiblePrototype = require_a_possible_prototype();
    module.exports = Object.setPrototypeOf || ("__proto__" in {} ? function() {
      var CORRECT_SETTER = false;
      var test2 = {};
      var setter;
      try {
        setter = uncurryThisAccessor(Object.prototype, "__proto__", "set");
        setter(test2, []);
        CORRECT_SETTER = test2 instanceof Array;
      } catch (error) {
      }
      return function setPrototypeOf(O2, proto) {
        requireObjectCoercible7(O2);
        aPossiblePrototype(proto);
        if (!isObject4(O2)) return O2;
        if (CORRECT_SETTER) setter(O2, proto);
        else O2.__proto__ = proto;
        return O2;
      };
    }() : void 0);
  }
});

// node_modules/core-js/internals/set-to-string-tag.js
var require_set_to_string_tag = __commonJS({
  "node_modules/core-js/internals/set-to-string-tag.js"(exports, module) {
    "use strict";
    var defineProperty = require_object_define_property().f;
    var hasOwn = require_has_own_property();
    var wellKnownSymbol3 = require_well_known_symbol();
    var TO_STRING_TAG = wellKnownSymbol3("toStringTag");
    module.exports = function(target, TAG, STATIC) {
      if (target && !STATIC) target = target.prototype;
      if (target && !hasOwn(target, TO_STRING_TAG)) {
        defineProperty(target, TO_STRING_TAG, { configurable: true, value: TAG });
      }
    };
  }
});

// node_modules/core-js/internals/define-built-in-accessor.js
var require_define_built_in_accessor = __commonJS({
  "node_modules/core-js/internals/define-built-in-accessor.js"(exports, module) {
    "use strict";
    var makeBuiltIn = require_make_built_in();
    var defineProperty = require_object_define_property();
    module.exports = function(target, name, descriptor) {
      if (descriptor.get) makeBuiltIn(descriptor.get, name, { getter: true });
      if (descriptor.set) makeBuiltIn(descriptor.set, name, { setter: true });
      return defineProperty.f(target, name, descriptor);
    };
  }
});

// node_modules/core-js/internals/set-species.js
var require_set_species = __commonJS({
  "node_modules/core-js/internals/set-species.js"(exports, module) {
    "use strict";
    var getBuiltIn = require_get_built_in();
    var defineBuiltInAccessor = require_define_built_in_accessor();
    var wellKnownSymbol3 = require_well_known_symbol();
    var DESCRIPTORS = require_descriptors();
    var SPECIES = wellKnownSymbol3("species");
    module.exports = function(CONSTRUCTOR_NAME) {
      var Constructor = getBuiltIn(CONSTRUCTOR_NAME);
      if (DESCRIPTORS && Constructor && !Constructor[SPECIES]) {
        defineBuiltInAccessor(Constructor, SPECIES, {
          configurable: true,
          get: function() {
            return this;
          }
        });
      }
    };
  }
});

// node_modules/core-js/internals/an-instance.js
var require_an_instance = __commonJS({
  "node_modules/core-js/internals/an-instance.js"(exports, module) {
    "use strict";
    var isPrototypeOf = require_object_is_prototype_of();
    var $TypeError = TypeError;
    module.exports = function(it, Prototype) {
      if (isPrototypeOf(Prototype, it)) return it;
      throw new $TypeError("Incorrect invocation");
    };
  }
});

// node_modules/core-js/internals/to-string-tag-support.js
var require_to_string_tag_support = __commonJS({
  "node_modules/core-js/internals/to-string-tag-support.js"(exports, module) {
    "use strict";
    var wellKnownSymbol3 = require_well_known_symbol();
    var TO_STRING_TAG = wellKnownSymbol3("toStringTag");
    var test2 = {};
    test2[TO_STRING_TAG] = "z";
    module.exports = String(test2) === "[object z]";
  }
});

// node_modules/core-js/internals/classof.js
var require_classof = __commonJS({
  "node_modules/core-js/internals/classof.js"(exports, module) {
    "use strict";
    var TO_STRING_TAG_SUPPORT = require_to_string_tag_support();
    var isCallable2 = require_is_callable();
    var classofRaw = require_classof_raw();
    var wellKnownSymbol3 = require_well_known_symbol();
    var TO_STRING_TAG = wellKnownSymbol3("toStringTag");
    var $Object = Object;
    var CORRECT_ARGUMENTS = classofRaw(/* @__PURE__ */ function() {
      return arguments;
    }()) === "Arguments";
    var tryGet = function(it, key) {
      try {
        return it[key];
      } catch (error) {
      }
    };
    module.exports = TO_STRING_TAG_SUPPORT ? classofRaw : function(it) {
      var O2, tag, result;
      return it === void 0 ? "Undefined" : it === null ? "Null" : typeof (tag = tryGet(O2 = $Object(it), TO_STRING_TAG)) == "string" ? tag : CORRECT_ARGUMENTS ? classofRaw(O2) : (result = classofRaw(O2)) === "Object" && isCallable2(O2.callee) ? "Arguments" : result;
    };
  }
});

// node_modules/core-js/internals/is-constructor.js
var require_is_constructor = __commonJS({
  "node_modules/core-js/internals/is-constructor.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var fails4 = require_fails();
    var isCallable2 = require_is_callable();
    var classof = require_classof();
    var getBuiltIn = require_get_built_in();
    var inspectSource = require_inspect_source();
    var noop2 = function() {
    };
    var construct = getBuiltIn("Reflect", "construct");
    var constructorRegExp = /^\s*(?:class|function)\b/;
    var exec = uncurryThis9(constructorRegExp.exec);
    var INCORRECT_TO_STRING = !constructorRegExp.test(noop2);
    var isConstructorModern = function isConstructor(argument) {
      if (!isCallable2(argument)) return false;
      try {
        construct(noop2, [], argument);
        return true;
      } catch (error) {
        return false;
      }
    };
    var isConstructorLegacy = function isConstructor(argument) {
      if (!isCallable2(argument)) return false;
      switch (classof(argument)) {
        case "AsyncFunction":
        case "GeneratorFunction":
        case "AsyncGeneratorFunction":
          return false;
      }
      try {
        return INCORRECT_TO_STRING || !!exec(constructorRegExp, inspectSource(argument));
      } catch (error) {
        return true;
      }
    };
    isConstructorLegacy.sham = true;
    module.exports = !construct || fails4(function() {
      var called;
      return isConstructorModern(isConstructorModern.call) || !isConstructorModern(Object) || !isConstructorModern(function() {
        called = true;
      }) || called;
    }) ? isConstructorLegacy : isConstructorModern;
  }
});

// node_modules/core-js/internals/a-constructor.js
var require_a_constructor = __commonJS({
  "node_modules/core-js/internals/a-constructor.js"(exports, module) {
    "use strict";
    var isConstructor = require_is_constructor();
    var tryToString = require_try_to_string();
    var $TypeError = TypeError;
    module.exports = function(argument) {
      if (isConstructor(argument)) return argument;
      throw new $TypeError(tryToString(argument) + " is not a constructor");
    };
  }
});

// node_modules/core-js/internals/species-constructor.js
var require_species_constructor = __commonJS({
  "node_modules/core-js/internals/species-constructor.js"(exports, module) {
    "use strict";
    var anObject5 = require_an_object();
    var aConstructor = require_a_constructor();
    var isNullOrUndefined = require_is_null_or_undefined();
    var wellKnownSymbol3 = require_well_known_symbol();
    var SPECIES = wellKnownSymbol3("species");
    module.exports = function(O2, defaultConstructor) {
      var C = anObject5(O2).constructor;
      var S;
      return C === void 0 || isNullOrUndefined(S = anObject5(C)[SPECIES]) ? defaultConstructor : aConstructor(S);
    };
  }
});

// node_modules/core-js/internals/function-apply.js
var require_function_apply = __commonJS({
  "node_modules/core-js/internals/function-apply.js"(exports, module) {
    "use strict";
    var NATIVE_BIND = require_function_bind_native();
    var FunctionPrototype = Function.prototype;
    var apply2 = FunctionPrototype.apply;
    var call4 = FunctionPrototype.call;
    module.exports = typeof Reflect == "object" && Reflect.apply || (NATIVE_BIND ? call4.bind(apply2) : function() {
      return call4.apply(apply2, arguments);
    });
  }
});

// node_modules/core-js/internals/function-uncurry-this-clause.js
var require_function_uncurry_this_clause = __commonJS({
  "node_modules/core-js/internals/function-uncurry-this-clause.js"(exports, module) {
    "use strict";
    var classofRaw = require_classof_raw();
    var uncurryThis9 = require_function_uncurry_this();
    module.exports = function(fn) {
      if (classofRaw(fn) === "Function") return uncurryThis9(fn);
    };
  }
});

// node_modules/core-js/internals/function-bind-context.js
var require_function_bind_context = __commonJS({
  "node_modules/core-js/internals/function-bind-context.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this_clause();
    var aCallable = require_a_callable();
    var NATIVE_BIND = require_function_bind_native();
    var bind = uncurryThis9(uncurryThis9.bind);
    module.exports = function(fn, that) {
      aCallable(fn);
      return that === void 0 ? fn : NATIVE_BIND ? bind(fn, that) : function() {
        return fn.apply(that, arguments);
      };
    };
  }
});

// node_modules/core-js/internals/html.js
var require_html = __commonJS({
  "node_modules/core-js/internals/html.js"(exports, module) {
    "use strict";
    var getBuiltIn = require_get_built_in();
    module.exports = getBuiltIn("document", "documentElement");
  }
});

// node_modules/core-js/internals/array-slice.js
var require_array_slice = __commonJS({
  "node_modules/core-js/internals/array-slice.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    module.exports = uncurryThis9([].slice);
  }
});

// node_modules/core-js/internals/validate-arguments-length.js
var require_validate_arguments_length = __commonJS({
  "node_modules/core-js/internals/validate-arguments-length.js"(exports, module) {
    "use strict";
    var $TypeError = TypeError;
    module.exports = function(passed, required) {
      if (passed < required) throw new $TypeError("Not enough arguments");
      return passed;
    };
  }
});

// node_modules/core-js/internals/environment-is-ios.js
var require_environment_is_ios = __commonJS({
  "node_modules/core-js/internals/environment-is-ios.js"(exports, module) {
    "use strict";
    var userAgent = require_environment_user_agent();
    module.exports = /(?:ipad|iphone|ipod).*applewebkit/i.test(userAgent);
  }
});

// node_modules/core-js/internals/task.js
var require_task = __commonJS({
  "node_modules/core-js/internals/task.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var apply2 = require_function_apply();
    var bind = require_function_bind_context();
    var isCallable2 = require_is_callable();
    var hasOwn = require_has_own_property();
    var fails4 = require_fails();
    var html = require_html();
    var arraySlice = require_array_slice();
    var createElement = require_document_create_element();
    var validateArgumentsLength = require_validate_arguments_length();
    var IS_IOS = require_environment_is_ios();
    var IS_NODE2 = require_environment_is_node();
    var set = globalThis3.setImmediate;
    var clear = globalThis3.clearImmediate;
    var process2 = globalThis3.process;
    var Dispatch = globalThis3.Dispatch;
    var Function2 = globalThis3.Function;
    var MessageChannel = globalThis3.MessageChannel;
    var String2 = globalThis3.String;
    var counter = 0;
    var queue = {};
    var ONREADYSTATECHANGE = "onreadystatechange";
    var $location;
    var defer;
    var channel;
    var port;
    fails4(function() {
      $location = globalThis3.location;
    });
    var run = function(id) {
      if (hasOwn(queue, id)) {
        var fn = queue[id];
        delete queue[id];
        fn();
      }
    };
    var runner = function(id) {
      return function() {
        run(id);
      };
    };
    var eventListener = function(event) {
      run(event.data);
    };
    var globalPostMessageDefer = function(id) {
      globalThis3.postMessage(String2(id), $location.protocol + "//" + $location.host);
    };
    if (!set || !clear) {
      set = function setImmediate(handler) {
        validateArgumentsLength(arguments.length, 1);
        var fn = isCallable2(handler) ? handler : Function2(handler);
        var args = arraySlice(arguments, 1);
        queue[++counter] = function() {
          apply2(fn, void 0, args);
        };
        defer(counter);
        return counter;
      };
      clear = function clearImmediate(id) {
        delete queue[id];
      };
      if (IS_NODE2) {
        defer = function(id) {
          process2.nextTick(runner(id));
        };
      } else if (Dispatch && Dispatch.now) {
        defer = function(id) {
          Dispatch.now(runner(id));
        };
      } else if (MessageChannel && !IS_IOS) {
        channel = new MessageChannel();
        port = channel.port2;
        channel.port1.onmessage = eventListener;
        defer = bind(port.postMessage, port);
      } else if (globalThis3.addEventListener && isCallable2(globalThis3.postMessage) && !globalThis3.importScripts && $location && $location.protocol !== "file:" && !fails4(globalPostMessageDefer)) {
        defer = globalPostMessageDefer;
        globalThis3.addEventListener("message", eventListener, false);
      } else if (ONREADYSTATECHANGE in createElement("script")) {
        defer = function(id) {
          html.appendChild(createElement("script"))[ONREADYSTATECHANGE] = function() {
            html.removeChild(this);
            run(id);
          };
        };
      } else {
        defer = function(id) {
          setTimeout(runner(id), 0);
        };
      }
    }
    module.exports = {
      set,
      clear
    };
  }
});

// node_modules/core-js/internals/safe-get-built-in.js
var require_safe_get_built_in = __commonJS({
  "node_modules/core-js/internals/safe-get-built-in.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var DESCRIPTORS = require_descriptors();
    var getOwnPropertyDescriptor3 = Object.getOwnPropertyDescriptor;
    module.exports = function(name) {
      if (!DESCRIPTORS) return globalThis3[name];
      var descriptor = getOwnPropertyDescriptor3(globalThis3, name);
      return descriptor && descriptor.value;
    };
  }
});

// node_modules/core-js/internals/queue.js
var require_queue = __commonJS({
  "node_modules/core-js/internals/queue.js"(exports, module) {
    "use strict";
    var Queue = function() {
      this.head = null;
      this.tail = null;
    };
    Queue.prototype = {
      add: function(item) {
        var entry = { item, next: null };
        var tail = this.tail;
        if (tail) tail.next = entry;
        else this.head = entry;
        this.tail = entry;
      },
      get: function() {
        var entry = this.head;
        if (entry) {
          var next = this.head = entry.next;
          if (next === null) this.tail = null;
          return entry.item;
        }
      }
    };
    module.exports = Queue;
  }
});

// node_modules/core-js/internals/environment-is-ios-pebble.js
var require_environment_is_ios_pebble = __commonJS({
  "node_modules/core-js/internals/environment-is-ios-pebble.js"(exports, module) {
    "use strict";
    var userAgent = require_environment_user_agent();
    module.exports = /ipad|iphone|ipod/i.test(userAgent) && typeof Pebble != "undefined";
  }
});

// node_modules/core-js/internals/environment-is-webos-webkit.js
var require_environment_is_webos_webkit = __commonJS({
  "node_modules/core-js/internals/environment-is-webos-webkit.js"(exports, module) {
    "use strict";
    var userAgent = require_environment_user_agent();
    module.exports = /web0s(?!.*chrome)/i.test(userAgent);
  }
});

// node_modules/core-js/internals/microtask.js
var require_microtask = __commonJS({
  "node_modules/core-js/internals/microtask.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var safeGetBuiltIn = require_safe_get_built_in();
    var bind = require_function_bind_context();
    var macrotask = require_task().set;
    var Queue = require_queue();
    var IS_IOS = require_environment_is_ios();
    var IS_IOS_PEBBLE = require_environment_is_ios_pebble();
    var IS_WEBOS_WEBKIT = require_environment_is_webos_webkit();
    var IS_NODE2 = require_environment_is_node();
    var MutationObserver = globalThis3.MutationObserver || globalThis3.WebKitMutationObserver;
    var document2 = globalThis3.document;
    var process2 = globalThis3.process;
    var Promise2 = globalThis3.Promise;
    var microtask = safeGetBuiltIn("queueMicrotask");
    var notify;
    var toggle;
    var node2;
    var promise;
    var then;
    if (!microtask) {
      queue = new Queue();
      flush = function() {
        var parent, fn;
        if (IS_NODE2 && (parent = process2.domain)) parent.exit();
        while (fn = queue.get()) try {
          fn();
        } catch (error) {
          if (queue.head) notify();
          throw error;
        }
        if (parent) parent.enter();
      };
      if (!IS_IOS && !IS_NODE2 && !IS_WEBOS_WEBKIT && MutationObserver && document2) {
        toggle = true;
        node2 = document2.createTextNode("");
        new MutationObserver(flush).observe(node2, { characterData: true });
        notify = function() {
          node2.data = toggle = !toggle;
        };
      } else if (!IS_IOS_PEBBLE && Promise2 && Promise2.resolve) {
        promise = Promise2.resolve(void 0);
        promise.constructor = Promise2;
        then = bind(promise.then, promise);
        notify = function() {
          then(flush);
        };
      } else if (IS_NODE2) {
        notify = function() {
          process2.nextTick(flush);
        };
      } else {
        macrotask = bind(macrotask, globalThis3);
        notify = function() {
          macrotask(flush);
        };
      }
      microtask = function(fn) {
        if (!queue.head) notify();
        queue.add(fn);
      };
    }
    var queue;
    var flush;
    module.exports = microtask;
  }
});

// node_modules/core-js/internals/host-report-errors.js
var require_host_report_errors = __commonJS({
  "node_modules/core-js/internals/host-report-errors.js"(exports, module) {
    "use strict";
    module.exports = function(a2, b) {
      try {
        arguments.length === 1 ? console.error(a2) : console.error(a2, b);
      } catch (error) {
      }
    };
  }
});

// node_modules/core-js/internals/perform.js
var require_perform = __commonJS({
  "node_modules/core-js/internals/perform.js"(exports, module) {
    "use strict";
    module.exports = function(exec) {
      try {
        return { error: false, value: exec() };
      } catch (error) {
        return { error: true, value: error };
      }
    };
  }
});

// node_modules/core-js/internals/promise-native-constructor.js
var require_promise_native_constructor = __commonJS({
  "node_modules/core-js/internals/promise-native-constructor.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    module.exports = globalThis3.Promise;
  }
});

// node_modules/core-js/internals/promise-constructor-detection.js
var require_promise_constructor_detection = __commonJS({
  "node_modules/core-js/internals/promise-constructor-detection.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var NativePromiseConstructor = require_promise_native_constructor();
    var isCallable2 = require_is_callable();
    var isForced = require_is_forced();
    var inspectSource = require_inspect_source();
    var wellKnownSymbol3 = require_well_known_symbol();
    var ENVIRONMENT = require_environment();
    var IS_PURE3 = require_is_pure();
    var V8_VERSION = require_environment_v8_version();
    var NativePromisePrototype = NativePromiseConstructor && NativePromiseConstructor.prototype;
    var SPECIES = wellKnownSymbol3("species");
    var SUBCLASSING = false;
    var NATIVE_PROMISE_REJECTION_EVENT = isCallable2(globalThis3.PromiseRejectionEvent);
    var FORCED_PROMISE_CONSTRUCTOR = isForced("Promise", function() {
      var PROMISE_CONSTRUCTOR_SOURCE = inspectSource(NativePromiseConstructor);
      var GLOBAL_CORE_JS_PROMISE = PROMISE_CONSTRUCTOR_SOURCE !== String(NativePromiseConstructor);
      if (!GLOBAL_CORE_JS_PROMISE && V8_VERSION === 66) return true;
      if (IS_PURE3 && !(NativePromisePrototype["catch"] && NativePromisePrototype["finally"])) return true;
      if (!V8_VERSION || V8_VERSION < 51 || !/native code/.test(PROMISE_CONSTRUCTOR_SOURCE)) {
        var promise = new NativePromiseConstructor(function(resolve) {
          resolve(1);
        });
        var FakePromise = function(exec) {
          exec(function() {
          }, function() {
          });
        };
        var constructor = promise.constructor = {};
        constructor[SPECIES] = FakePromise;
        SUBCLASSING = promise.then(function() {
        }) instanceof FakePromise;
        if (!SUBCLASSING) return true;
      }
      return !GLOBAL_CORE_JS_PROMISE && (ENVIRONMENT === "BROWSER" || ENVIRONMENT === "DENO") && !NATIVE_PROMISE_REJECTION_EVENT;
    });
    module.exports = {
      CONSTRUCTOR: FORCED_PROMISE_CONSTRUCTOR,
      REJECTION_EVENT: NATIVE_PROMISE_REJECTION_EVENT,
      SUBCLASSING
    };
  }
});

// node_modules/core-js/internals/new-promise-capability.js
var require_new_promise_capability = __commonJS({
  "node_modules/core-js/internals/new-promise-capability.js"(exports, module) {
    "use strict";
    var aCallable = require_a_callable();
    var $TypeError = TypeError;
    var PromiseCapability = function(C) {
      var resolve, reject;
      this.promise = new C(function($$resolve, $$reject) {
        if (resolve !== void 0 || reject !== void 0) throw new $TypeError("Bad Promise constructor");
        resolve = $$resolve;
        reject = $$reject;
      });
      this.resolve = aCallable(resolve);
      this.reject = aCallable(reject);
    };
    module.exports.f = function(C) {
      return new PromiseCapability(C);
    };
  }
});

// node_modules/core-js/modules/es.promise.constructor.js
var require_es_promise_constructor = __commonJS({
  "node_modules/core-js/modules/es.promise.constructor.js"() {
    "use strict";
    var $8 = require_export();
    var IS_PURE3 = require_is_pure();
    var IS_NODE2 = require_environment_is_node();
    var globalThis3 = require_global_this();
    var path = require_path();
    var call4 = require_function_call();
    var defineBuiltIn2 = require_define_built_in();
    var setPrototypeOf = require_object_set_prototype_of();
    var setToStringTag2 = require_set_to_string_tag();
    var setSpecies = require_set_species();
    var aCallable = require_a_callable();
    var isCallable2 = require_is_callable();
    var isObject4 = require_is_object();
    var anInstance = require_an_instance();
    var speciesConstructor2 = require_species_constructor();
    var task = require_task().set;
    var microtask = require_microtask();
    var hostReportErrors = require_host_report_errors();
    var perform = require_perform();
    var Queue = require_queue();
    var InternalStateModule = require_internal_state();
    var NativePromiseConstructor = require_promise_native_constructor();
    var PromiseConstructorDetection = require_promise_constructor_detection();
    var newPromiseCapabilityModule = require_new_promise_capability();
    var PROMISE = "Promise";
    var FORCED_PROMISE_CONSTRUCTOR = PromiseConstructorDetection.CONSTRUCTOR;
    var NATIVE_PROMISE_REJECTION_EVENT = PromiseConstructorDetection.REJECTION_EVENT;
    var NATIVE_PROMISE_SUBCLASSING = PromiseConstructorDetection.SUBCLASSING;
    var getInternalPromiseState = InternalStateModule.getterFor(PROMISE);
    var setInternalState = InternalStateModule.set;
    var NativePromisePrototype = NativePromiseConstructor && NativePromiseConstructor.prototype;
    var PromiseConstructor = NativePromiseConstructor;
    var PromisePrototype = NativePromisePrototype;
    var TypeError2 = globalThis3.TypeError;
    var document2 = globalThis3.document;
    var process2 = globalThis3.process;
    var newPromiseCapability = newPromiseCapabilityModule.f;
    var newGenericPromiseCapability = newPromiseCapability;
    var DISPATCH_EVENT = !!(document2 && document2.createEvent && globalThis3.dispatchEvent);
    var UNHANDLED_REJECTION = "unhandledrejection";
    var REJECTION_HANDLED = "rejectionhandled";
    var PENDING = 0;
    var FULFILLED = 1;
    var REJECTED = 2;
    var HANDLED = 1;
    var UNHANDLED = 2;
    var Internal;
    var OwnPromiseCapability;
    var PromiseWrapper;
    var nativeThen;
    var isThenable = function(it) {
      var then;
      return isObject4(it) && isCallable2(then = it.then) ? then : false;
    };
    var callReaction = function(reaction, state) {
      var value = state.value;
      var ok = state.state === FULFILLED;
      var handler = ok ? reaction.ok : reaction.fail;
      var resolve = reaction.resolve;
      var reject = reaction.reject;
      var domain = reaction.domain;
      var result, then, exited;
      try {
        if (handler) {
          if (!ok) {
            if (state.rejection === UNHANDLED) onHandleUnhandled(state);
            state.rejection = HANDLED;
          }
          if (handler === true) result = value;
          else {
            if (domain) domain.enter();
            result = handler(value);
            if (domain) {
              domain.exit();
              exited = true;
            }
          }
          if (result === reaction.promise) {
            reject(new TypeError2("Promise-chain cycle"));
          } else if (then = isThenable(result)) {
            call4(then, result, resolve, reject);
          } else resolve(result);
        } else reject(value);
      } catch (error) {
        if (domain && !exited) domain.exit();
        reject(error);
      }
    };
    var notify = function(state, isReject) {
      if (state.notified) return;
      state.notified = true;
      microtask(function() {
        var reactions = state.reactions;
        var reaction;
        while (reaction = reactions.get()) {
          callReaction(reaction, state);
        }
        state.notified = false;
        if (isReject && !state.rejection) onUnhandled(state);
      });
    };
    var dispatchEvent = function(name, promise, reason) {
      var event, handler;
      if (DISPATCH_EVENT) {
        event = document2.createEvent("Event");
        event.promise = promise;
        event.reason = reason;
        event.initEvent(name, false, true);
        globalThis3.dispatchEvent(event);
      } else event = { promise, reason };
      if (!NATIVE_PROMISE_REJECTION_EVENT && (handler = globalThis3["on" + name])) handler(event);
      else if (name === UNHANDLED_REJECTION) hostReportErrors("Unhandled promise rejection", reason);
    };
    var onUnhandled = function(state) {
      call4(task, globalThis3, function() {
        var promise = state.facade;
        var value = state.value;
        var IS_UNHANDLED = isUnhandled(state);
        var result;
        if (IS_UNHANDLED) {
          result = perform(function() {
            if (IS_NODE2) {
              process2.emit("unhandledRejection", value, promise);
            } else dispatchEvent(UNHANDLED_REJECTION, promise, value);
          });
          state.rejection = IS_NODE2 || isUnhandled(state) ? UNHANDLED : HANDLED;
          if (result.error) throw result.value;
        }
      });
    };
    var isUnhandled = function(state) {
      return state.rejection !== HANDLED && !state.parent;
    };
    var onHandleUnhandled = function(state) {
      call4(task, globalThis3, function() {
        var promise = state.facade;
        if (IS_NODE2) {
          process2.emit("rejectionHandled", promise);
        } else dispatchEvent(REJECTION_HANDLED, promise, state.value);
      });
    };
    var bind = function(fn, state, unwrap) {
      return function(value) {
        fn(state, value, unwrap);
      };
    };
    var internalReject = function(state, value, unwrap) {
      if (state.done) return;
      state.done = true;
      if (unwrap) state = unwrap;
      state.value = value;
      state.state = REJECTED;
      notify(state, true);
    };
    var internalResolve = function(state, value, unwrap) {
      if (state.done) return;
      state.done = true;
      if (unwrap) state = unwrap;
      try {
        if (state.facade === value) throw new TypeError2("Promise can't be resolved itself");
        var then = isThenable(value);
        if (then) {
          microtask(function() {
            var wrapper = { done: false };
            try {
              call4(
                then,
                value,
                bind(internalResolve, wrapper, state),
                bind(internalReject, wrapper, state)
              );
            } catch (error) {
              internalReject(wrapper, error, state);
            }
          });
        } else {
          state.value = value;
          state.state = FULFILLED;
          notify(state, false);
        }
      } catch (error) {
        internalReject({ done: false }, error, state);
      }
    };
    if (FORCED_PROMISE_CONSTRUCTOR) {
      PromiseConstructor = function Promise2(executor) {
        anInstance(this, PromisePrototype);
        aCallable(executor);
        call4(Internal, this);
        var state = getInternalPromiseState(this);
        try {
          executor(bind(internalResolve, state), bind(internalReject, state));
        } catch (error) {
          internalReject(state, error);
        }
      };
      PromisePrototype = PromiseConstructor.prototype;
      Internal = function Promise2(executor) {
        setInternalState(this, {
          type: PROMISE,
          done: false,
          notified: false,
          parent: false,
          reactions: new Queue(),
          rejection: false,
          state: PENDING,
          value: null
        });
      };
      Internal.prototype = defineBuiltIn2(PromisePrototype, "then", function then(onFulfilled, onRejected) {
        var state = getInternalPromiseState(this);
        var reaction = newPromiseCapability(speciesConstructor2(this, PromiseConstructor));
        state.parent = true;
        reaction.ok = isCallable2(onFulfilled) ? onFulfilled : true;
        reaction.fail = isCallable2(onRejected) && onRejected;
        reaction.domain = IS_NODE2 ? process2.domain : void 0;
        if (state.state === PENDING) state.reactions.add(reaction);
        else microtask(function() {
          callReaction(reaction, state);
        });
        return reaction.promise;
      });
      OwnPromiseCapability = function() {
        var promise = new Internal();
        var state = getInternalPromiseState(promise);
        this.promise = promise;
        this.resolve = bind(internalResolve, state);
        this.reject = bind(internalReject, state);
      };
      newPromiseCapabilityModule.f = newPromiseCapability = function(C) {
        return C === PromiseConstructor || C === PromiseWrapper ? new OwnPromiseCapability(C) : newGenericPromiseCapability(C);
      };
      if (!IS_PURE3 && isCallable2(NativePromiseConstructor) && NativePromisePrototype !== Object.prototype) {
        nativeThen = NativePromisePrototype.then;
        if (!NATIVE_PROMISE_SUBCLASSING) {
          defineBuiltIn2(NativePromisePrototype, "then", function then(onFulfilled, onRejected) {
            var that = this;
            return new PromiseConstructor(function(resolve, reject) {
              call4(nativeThen, that, resolve, reject);
            }).then(onFulfilled, onRejected);
          }, { unsafe: true });
        }
        try {
          delete NativePromisePrototype.constructor;
        } catch (error) {
        }
        if (setPrototypeOf) {
          setPrototypeOf(NativePromisePrototype, PromisePrototype);
        }
      }
    }
    $8({ global: true, constructor: true, wrap: true, forced: FORCED_PROMISE_CONSTRUCTOR }, {
      Promise: PromiseConstructor
    });
    PromiseWrapper = path.Promise;
    setToStringTag2(PromiseConstructor, PROMISE, false, true);
    setSpecies(PROMISE);
  }
});

// node_modules/core-js/internals/iterators.js
var require_iterators = __commonJS({
  "node_modules/core-js/internals/iterators.js"(exports, module) {
    "use strict";
    module.exports = {};
  }
});

// node_modules/core-js/internals/is-array-iterator-method.js
var require_is_array_iterator_method = __commonJS({
  "node_modules/core-js/internals/is-array-iterator-method.js"(exports, module) {
    "use strict";
    var wellKnownSymbol3 = require_well_known_symbol();
    var Iterators = require_iterators();
    var ITERATOR2 = wellKnownSymbol3("iterator");
    var ArrayPrototype = Array.prototype;
    module.exports = function(it) {
      return it !== void 0 && (Iterators.Array === it || ArrayPrototype[ITERATOR2] === it);
    };
  }
});

// node_modules/core-js/internals/get-iterator-method.js
var require_get_iterator_method = __commonJS({
  "node_modules/core-js/internals/get-iterator-method.js"(exports, module) {
    "use strict";
    var classof = require_classof();
    var getMethod4 = require_get_method();
    var isNullOrUndefined = require_is_null_or_undefined();
    var Iterators = require_iterators();
    var wellKnownSymbol3 = require_well_known_symbol();
    var ITERATOR2 = wellKnownSymbol3("iterator");
    module.exports = function(it) {
      if (!isNullOrUndefined(it)) return getMethod4(it, ITERATOR2) || getMethod4(it, "@@iterator") || Iterators[classof(it)];
    };
  }
});

// node_modules/core-js/internals/get-iterator.js
var require_get_iterator = __commonJS({
  "node_modules/core-js/internals/get-iterator.js"(exports, module) {
    "use strict";
    var call4 = require_function_call();
    var aCallable = require_a_callable();
    var anObject5 = require_an_object();
    var tryToString = require_try_to_string();
    var getIteratorMethod = require_get_iterator_method();
    var $TypeError = TypeError;
    module.exports = function(argument, usingIterator) {
      var iteratorMethod = arguments.length < 2 ? getIteratorMethod(argument) : usingIterator;
      if (aCallable(iteratorMethod)) return anObject5(call4(iteratorMethod, argument));
      throw new $TypeError(tryToString(argument) + " is not iterable");
    };
  }
});

// node_modules/core-js/internals/iterator-close.js
var require_iterator_close = __commonJS({
  "node_modules/core-js/internals/iterator-close.js"(exports, module) {
    "use strict";
    var call4 = require_function_call();
    var anObject5 = require_an_object();
    var getMethod4 = require_get_method();
    module.exports = function(iterator, kind, value) {
      var innerResult, innerError;
      anObject5(iterator);
      try {
        innerResult = getMethod4(iterator, "return");
        if (!innerResult) {
          if (kind === "throw") throw value;
          return value;
        }
        innerResult = call4(innerResult, iterator);
      } catch (error) {
        innerError = true;
        innerResult = error;
      }
      if (kind === "throw") throw value;
      if (innerError) throw innerResult;
      anObject5(innerResult);
      return value;
    };
  }
});

// node_modules/core-js/internals/iterate.js
var require_iterate = __commonJS({
  "node_modules/core-js/internals/iterate.js"(exports, module) {
    "use strict";
    var bind = require_function_bind_context();
    var call4 = require_function_call();
    var anObject5 = require_an_object();
    var tryToString = require_try_to_string();
    var isArrayIteratorMethod = require_is_array_iterator_method();
    var lengthOfArrayLike = require_length_of_array_like();
    var isPrototypeOf = require_object_is_prototype_of();
    var getIterator = require_get_iterator();
    var getIteratorMethod = require_get_iterator_method();
    var iteratorClose = require_iterator_close();
    var $TypeError = TypeError;
    var Result = function(stopped, result) {
      this.stopped = stopped;
      this.result = result;
    };
    var ResultPrototype = Result.prototype;
    module.exports = function(iterable, unboundFunction, options) {
      var that = options && options.that;
      var AS_ENTRIES = !!(options && options.AS_ENTRIES);
      var IS_RECORD = !!(options && options.IS_RECORD);
      var IS_ITERATOR = !!(options && options.IS_ITERATOR);
      var INTERRUPTED = !!(options && options.INTERRUPTED);
      var fn = bind(unboundFunction, that);
      var iterator, iterFn, index2, length, result, next, step;
      var stop = function(condition) {
        if (iterator) iteratorClose(iterator, "normal");
        return new Result(true, condition);
      };
      var callFn = function(value) {
        if (AS_ENTRIES) {
          anObject5(value);
          return INTERRUPTED ? fn(value[0], value[1], stop) : fn(value[0], value[1]);
        }
        return INTERRUPTED ? fn(value, stop) : fn(value);
      };
      if (IS_RECORD) {
        iterator = iterable.iterator;
      } else if (IS_ITERATOR) {
        iterator = iterable;
      } else {
        iterFn = getIteratorMethod(iterable);
        if (!iterFn) throw new $TypeError(tryToString(iterable) + " is not iterable");
        if (isArrayIteratorMethod(iterFn)) {
          for (index2 = 0, length = lengthOfArrayLike(iterable); length > index2; index2++) {
            result = callFn(iterable[index2]);
            if (result && isPrototypeOf(ResultPrototype, result)) return result;
          }
          return new Result(false);
        }
        iterator = getIterator(iterable, iterFn);
      }
      next = IS_RECORD ? iterable.next : iterator.next;
      while (!(step = call4(next, iterator)).done) {
        try {
          result = callFn(step.value);
        } catch (error) {
          iteratorClose(iterator, "throw", error);
        }
        if (typeof result == "object" && result && isPrototypeOf(ResultPrototype, result)) return result;
      }
      return new Result(false);
    };
  }
});

// node_modules/core-js/internals/check-correctness-of-iteration.js
var require_check_correctness_of_iteration = __commonJS({
  "node_modules/core-js/internals/check-correctness-of-iteration.js"(exports, module) {
    "use strict";
    var wellKnownSymbol3 = require_well_known_symbol();
    var ITERATOR2 = wellKnownSymbol3("iterator");
    var SAFE_CLOSING = false;
    try {
      called = 0;
      iteratorWithReturn = {
        next: function() {
          return { done: !!called++ };
        },
        "return": function() {
          SAFE_CLOSING = true;
        }
      };
      iteratorWithReturn[ITERATOR2] = function() {
        return this;
      };
      Array.from(iteratorWithReturn, function() {
        throw 2;
      });
    } catch (error) {
    }
    var called;
    var iteratorWithReturn;
    module.exports = function(exec, SKIP_CLOSING) {
      try {
        if (!SKIP_CLOSING && !SAFE_CLOSING) return false;
      } catch (error) {
        return false;
      }
      var ITERATION_SUPPORT = false;
      try {
        var object = {};
        object[ITERATOR2] = function() {
          return {
            next: function() {
              return { done: ITERATION_SUPPORT = true };
            }
          };
        };
        exec(object);
      } catch (error) {
      }
      return ITERATION_SUPPORT;
    };
  }
});

// node_modules/core-js/internals/promise-statics-incorrect-iteration.js
var require_promise_statics_incorrect_iteration = __commonJS({
  "node_modules/core-js/internals/promise-statics-incorrect-iteration.js"(exports, module) {
    "use strict";
    var NativePromiseConstructor = require_promise_native_constructor();
    var checkCorrectnessOfIteration = require_check_correctness_of_iteration();
    var FORCED_PROMISE_CONSTRUCTOR = require_promise_constructor_detection().CONSTRUCTOR;
    module.exports = FORCED_PROMISE_CONSTRUCTOR || !checkCorrectnessOfIteration(function(iterable) {
      NativePromiseConstructor.all(iterable).then(void 0, function() {
      });
    });
  }
});

// node_modules/core-js/modules/es.promise.all.js
var require_es_promise_all = __commonJS({
  "node_modules/core-js/modules/es.promise.all.js"() {
    "use strict";
    var $8 = require_export();
    var call4 = require_function_call();
    var aCallable = require_a_callable();
    var newPromiseCapabilityModule = require_new_promise_capability();
    var perform = require_perform();
    var iterate = require_iterate();
    var PROMISE_STATICS_INCORRECT_ITERATION = require_promise_statics_incorrect_iteration();
    $8({ target: "Promise", stat: true, forced: PROMISE_STATICS_INCORRECT_ITERATION }, {
      all: function all(iterable) {
        var C = this;
        var capability = newPromiseCapabilityModule.f(C);
        var resolve = capability.resolve;
        var reject = capability.reject;
        var result = perform(function() {
          var $promiseResolve = aCallable(C.resolve);
          var values = [];
          var counter = 0;
          var remaining = 1;
          iterate(iterable, function(promise) {
            var index2 = counter++;
            var alreadyCalled = false;
            remaining++;
            call4($promiseResolve, C, promise).then(function(value) {
              if (alreadyCalled) return;
              alreadyCalled = true;
              values[index2] = value;
              --remaining || resolve(values);
            }, reject);
          });
          --remaining || resolve(values);
        });
        if (result.error) reject(result.value);
        return capability.promise;
      }
    });
  }
});

// node_modules/core-js/modules/es.promise.catch.js
var require_es_promise_catch = __commonJS({
  "node_modules/core-js/modules/es.promise.catch.js"() {
    "use strict";
    var $8 = require_export();
    var IS_PURE3 = require_is_pure();
    var FORCED_PROMISE_CONSTRUCTOR = require_promise_constructor_detection().CONSTRUCTOR;
    var NativePromiseConstructor = require_promise_native_constructor();
    var getBuiltIn = require_get_built_in();
    var isCallable2 = require_is_callable();
    var defineBuiltIn2 = require_define_built_in();
    var NativePromisePrototype = NativePromiseConstructor && NativePromiseConstructor.prototype;
    $8({ target: "Promise", proto: true, forced: FORCED_PROMISE_CONSTRUCTOR, real: true }, {
      "catch": function(onRejected) {
        return this.then(void 0, onRejected);
      }
    });
    if (!IS_PURE3 && isCallable2(NativePromiseConstructor)) {
      method = getBuiltIn("Promise").prototype["catch"];
      if (NativePromisePrototype["catch"] !== method) {
        defineBuiltIn2(NativePromisePrototype, "catch", method, { unsafe: true });
      }
    }
    var method;
  }
});

// node_modules/core-js/modules/es.promise.race.js
var require_es_promise_race = __commonJS({
  "node_modules/core-js/modules/es.promise.race.js"() {
    "use strict";
    var $8 = require_export();
    var call4 = require_function_call();
    var aCallable = require_a_callable();
    var newPromiseCapabilityModule = require_new_promise_capability();
    var perform = require_perform();
    var iterate = require_iterate();
    var PROMISE_STATICS_INCORRECT_ITERATION = require_promise_statics_incorrect_iteration();
    $8({ target: "Promise", stat: true, forced: PROMISE_STATICS_INCORRECT_ITERATION }, {
      race: function race(iterable) {
        var C = this;
        var capability = newPromiseCapabilityModule.f(C);
        var reject = capability.reject;
        var result = perform(function() {
          var $promiseResolve = aCallable(C.resolve);
          iterate(iterable, function(promise) {
            call4($promiseResolve, C, promise).then(capability.resolve, reject);
          });
        });
        if (result.error) reject(result.value);
        return capability.promise;
      }
    });
  }
});

// node_modules/core-js/modules/es.promise.reject.js
var require_es_promise_reject = __commonJS({
  "node_modules/core-js/modules/es.promise.reject.js"() {
    "use strict";
    var $8 = require_export();
    var newPromiseCapabilityModule = require_new_promise_capability();
    var FORCED_PROMISE_CONSTRUCTOR = require_promise_constructor_detection().CONSTRUCTOR;
    $8({ target: "Promise", stat: true, forced: FORCED_PROMISE_CONSTRUCTOR }, {
      reject: function reject(r2) {
        var capability = newPromiseCapabilityModule.f(this);
        var capabilityReject = capability.reject;
        capabilityReject(r2);
        return capability.promise;
      }
    });
  }
});

// node_modules/core-js/internals/promise-resolve.js
var require_promise_resolve = __commonJS({
  "node_modules/core-js/internals/promise-resolve.js"(exports, module) {
    "use strict";
    var anObject5 = require_an_object();
    var isObject4 = require_is_object();
    var newPromiseCapability = require_new_promise_capability();
    module.exports = function(C, x) {
      anObject5(C);
      if (isObject4(x) && x.constructor === C) return x;
      var promiseCapability = newPromiseCapability.f(C);
      var resolve = promiseCapability.resolve;
      resolve(x);
      return promiseCapability.promise;
    };
  }
});

// node_modules/core-js/modules/es.promise.resolve.js
var require_es_promise_resolve = __commonJS({
  "node_modules/core-js/modules/es.promise.resolve.js"() {
    "use strict";
    var $8 = require_export();
    var getBuiltIn = require_get_built_in();
    var IS_PURE3 = require_is_pure();
    var NativePromiseConstructor = require_promise_native_constructor();
    var FORCED_PROMISE_CONSTRUCTOR = require_promise_constructor_detection().CONSTRUCTOR;
    var promiseResolve = require_promise_resolve();
    var PromiseConstructorWrapper = getBuiltIn("Promise");
    var CHECK_WRAPPER = IS_PURE3 && !FORCED_PROMISE_CONSTRUCTOR;
    $8({ target: "Promise", stat: true, forced: IS_PURE3 || FORCED_PROMISE_CONSTRUCTOR }, {
      resolve: function resolve(x) {
        return promiseResolve(CHECK_WRAPPER && this === PromiseConstructorWrapper ? NativePromiseConstructor : this, x);
      }
    });
  }
});

// node_modules/core-js/internals/to-string.js
var require_to_string = __commonJS({
  "node_modules/core-js/internals/to-string.js"(exports, module) {
    "use strict";
    var classof = require_classof();
    var $String = String;
    module.exports = function(argument) {
      if (classof(argument) === "Symbol") throw new TypeError("Cannot convert a Symbol value to a string");
      return $String(argument);
    };
  }
});

// node_modules/core-js/internals/regexp-flags.js
var require_regexp_flags = __commonJS({
  "node_modules/core-js/internals/regexp-flags.js"(exports, module) {
    "use strict";
    var anObject5 = require_an_object();
    module.exports = function() {
      var that = anObject5(this);
      var result = "";
      if (that.hasIndices) result += "d";
      if (that.global) result += "g";
      if (that.ignoreCase) result += "i";
      if (that.multiline) result += "m";
      if (that.dotAll) result += "s";
      if (that.unicode) result += "u";
      if (that.unicodeSets) result += "v";
      if (that.sticky) result += "y";
      return result;
    };
  }
});

// node_modules/core-js/internals/regexp-sticky-helpers.js
var require_regexp_sticky_helpers = __commonJS({
  "node_modules/core-js/internals/regexp-sticky-helpers.js"(exports, module) {
    "use strict";
    var fails4 = require_fails();
    var globalThis3 = require_global_this();
    var $RegExp = globalThis3.RegExp;
    var UNSUPPORTED_Y2 = fails4(function() {
      var re = $RegExp("a", "y");
      re.lastIndex = 2;
      return re.exec("abcd") !== null;
    });
    var MISSED_STICKY = UNSUPPORTED_Y2 || fails4(function() {
      return !$RegExp("a", "y").sticky;
    });
    var BROKEN_CARET = UNSUPPORTED_Y2 || fails4(function() {
      var re = $RegExp("^r", "gy");
      re.lastIndex = 2;
      return re.exec("str") !== null;
    });
    module.exports = {
      BROKEN_CARET,
      MISSED_STICKY,
      UNSUPPORTED_Y: UNSUPPORTED_Y2
    };
  }
});

// node_modules/core-js/internals/object-keys.js
var require_object_keys = __commonJS({
  "node_modules/core-js/internals/object-keys.js"(exports, module) {
    "use strict";
    var internalObjectKeys = require_object_keys_internal();
    var enumBugKeys = require_enum_bug_keys();
    module.exports = Object.keys || function keys(O2) {
      return internalObjectKeys(O2, enumBugKeys);
    };
  }
});

// node_modules/core-js/internals/object-define-properties.js
var require_object_define_properties = __commonJS({
  "node_modules/core-js/internals/object-define-properties.js"(exports) {
    "use strict";
    var DESCRIPTORS = require_descriptors();
    var V8_PROTOTYPE_DEFINE_BUG = require_v8_prototype_define_bug();
    var definePropertyModule = require_object_define_property();
    var anObject5 = require_an_object();
    var toIndexedObject = require_to_indexed_object();
    var objectKeys = require_object_keys();
    exports.f = DESCRIPTORS && !V8_PROTOTYPE_DEFINE_BUG ? Object.defineProperties : function defineProperties(O2, Properties) {
      anObject5(O2);
      var props = toIndexedObject(Properties);
      var keys = objectKeys(Properties);
      var length = keys.length;
      var index2 = 0;
      var key;
      while (length > index2) definePropertyModule.f(O2, key = keys[index2++], props[key]);
      return O2;
    };
  }
});

// node_modules/core-js/internals/object-create.js
var require_object_create = __commonJS({
  "node_modules/core-js/internals/object-create.js"(exports, module) {
    "use strict";
    var anObject5 = require_an_object();
    var definePropertiesModule = require_object_define_properties();
    var enumBugKeys = require_enum_bug_keys();
    var hiddenKeys = require_hidden_keys();
    var html = require_html();
    var documentCreateElement = require_document_create_element();
    var sharedKey = require_shared_key();
    var GT = ">";
    var LT = "<";
    var PROTOTYPE = "prototype";
    var SCRIPT = "script";
    var IE_PROTO = sharedKey("IE_PROTO");
    var EmptyConstructor = function() {
    };
    var scriptTag = function(content) {
      return LT + SCRIPT + GT + content + LT + "/" + SCRIPT + GT;
    };
    var NullProtoObjectViaActiveX = function(activeXDocument2) {
      activeXDocument2.write(scriptTag(""));
      activeXDocument2.close();
      var temp = activeXDocument2.parentWindow.Object;
      activeXDocument2 = null;
      return temp;
    };
    var NullProtoObjectViaIFrame = function() {
      var iframe = documentCreateElement("iframe");
      var JS = "java" + SCRIPT + ":";
      var iframeDocument;
      iframe.style.display = "none";
      html.appendChild(iframe);
      iframe.src = String(JS);
      iframeDocument = iframe.contentWindow.document;
      iframeDocument.open();
      iframeDocument.write(scriptTag("document.F=Object"));
      iframeDocument.close();
      return iframeDocument.F;
    };
    var activeXDocument;
    var NullProtoObject = function() {
      try {
        activeXDocument = new ActiveXObject("htmlfile");
      } catch (error) {
      }
      NullProtoObject = typeof document != "undefined" ? document.domain && activeXDocument ? NullProtoObjectViaActiveX(activeXDocument) : NullProtoObjectViaIFrame() : NullProtoObjectViaActiveX(activeXDocument);
      var length = enumBugKeys.length;
      while (length--) delete NullProtoObject[PROTOTYPE][enumBugKeys[length]];
      return NullProtoObject();
    };
    hiddenKeys[IE_PROTO] = true;
    module.exports = Object.create || function create(O2, Properties) {
      var result;
      if (O2 !== null) {
        EmptyConstructor[PROTOTYPE] = anObject5(O2);
        result = new EmptyConstructor();
        EmptyConstructor[PROTOTYPE] = null;
        result[IE_PROTO] = O2;
      } else result = NullProtoObject();
      return Properties === void 0 ? result : definePropertiesModule.f(result, Properties);
    };
  }
});

// node_modules/core-js/internals/regexp-unsupported-dot-all.js
var require_regexp_unsupported_dot_all = __commonJS({
  "node_modules/core-js/internals/regexp-unsupported-dot-all.js"(exports, module) {
    "use strict";
    var fails4 = require_fails();
    var globalThis3 = require_global_this();
    var $RegExp = globalThis3.RegExp;
    module.exports = fails4(function() {
      var re = $RegExp(".", "s");
      return !(re.dotAll && re.test("\n") && re.flags === "s");
    });
  }
});

// node_modules/core-js/internals/regexp-unsupported-ncg.js
var require_regexp_unsupported_ncg = __commonJS({
  "node_modules/core-js/internals/regexp-unsupported-ncg.js"(exports, module) {
    "use strict";
    var fails4 = require_fails();
    var globalThis3 = require_global_this();
    var $RegExp = globalThis3.RegExp;
    module.exports = fails4(function() {
      var re = $RegExp("(?<a>b)", "g");
      return re.exec("b").groups.a !== "b" || "b".replace(re, "$<a>c") !== "bc";
    });
  }
});

// node_modules/core-js/internals/regexp-exec.js
var require_regexp_exec = __commonJS({
  "node_modules/core-js/internals/regexp-exec.js"(exports, module) {
    "use strict";
    var call4 = require_function_call();
    var uncurryThis9 = require_function_uncurry_this();
    var toString7 = require_to_string();
    var regexpFlags = require_regexp_flags();
    var stickyHelpers2 = require_regexp_sticky_helpers();
    var shared = require_shared();
    var create = require_object_create();
    var getInternalState = require_internal_state().get;
    var UNSUPPORTED_DOT_ALL = require_regexp_unsupported_dot_all();
    var UNSUPPORTED_NCG = require_regexp_unsupported_ncg();
    var nativeReplace = shared("native-string-replace", String.prototype.replace);
    var nativeExec = RegExp.prototype.exec;
    var patchedExec = nativeExec;
    var charAt = uncurryThis9("".charAt);
    var indexOf2 = uncurryThis9("".indexOf);
    var replace = uncurryThis9("".replace);
    var stringSlice4 = uncurryThis9("".slice);
    var UPDATES_LAST_INDEX_WRONG = function() {
      var re1 = /a/;
      var re2 = /b*/g;
      call4(nativeExec, re1, "a");
      call4(nativeExec, re2, "a");
      return re1.lastIndex !== 0 || re2.lastIndex !== 0;
    }();
    var UNSUPPORTED_Y2 = stickyHelpers2.BROKEN_CARET;
    var NPCG_INCLUDED = /()??/.exec("")[1] !== void 0;
    var PATCH = UPDATES_LAST_INDEX_WRONG || NPCG_INCLUDED || UNSUPPORTED_Y2 || UNSUPPORTED_DOT_ALL || UNSUPPORTED_NCG;
    if (PATCH) {
      patchedExec = function exec(string) {
        var re = this;
        var state = getInternalState(re);
        var str = toString7(string);
        var raw = state.raw;
        var result, reCopy, lastIndex, match, i2, object, group;
        if (raw) {
          raw.lastIndex = re.lastIndex;
          result = call4(patchedExec, raw, str);
          re.lastIndex = raw.lastIndex;
          return result;
        }
        var groups = state.groups;
        var sticky = UNSUPPORTED_Y2 && re.sticky;
        var flags = call4(regexpFlags, re);
        var source = re.source;
        var charsAdded = 0;
        var strCopy = str;
        if (sticky) {
          flags = replace(flags, "y", "");
          if (indexOf2(flags, "g") === -1) {
            flags += "g";
          }
          strCopy = stringSlice4(str, re.lastIndex);
          if (re.lastIndex > 0 && (!re.multiline || re.multiline && charAt(str, re.lastIndex - 1) !== "\n")) {
            source = "(?: " + source + ")";
            strCopy = " " + strCopy;
            charsAdded++;
          }
          reCopy = new RegExp("^(?:" + source + ")", flags);
        }
        if (NPCG_INCLUDED) {
          reCopy = new RegExp("^" + source + "$(?!\\s)", flags);
        }
        if (UPDATES_LAST_INDEX_WRONG) lastIndex = re.lastIndex;
        match = call4(nativeExec, sticky ? reCopy : re, strCopy);
        if (sticky) {
          if (match) {
            match.input = stringSlice4(match.input, charsAdded);
            match[0] = stringSlice4(match[0], charsAdded);
            match.index = re.lastIndex;
            re.lastIndex += match[0].length;
          } else re.lastIndex = 0;
        } else if (UPDATES_LAST_INDEX_WRONG && match) {
          re.lastIndex = re.global ? match.index + match[0].length : lastIndex;
        }
        if (NPCG_INCLUDED && match && match.length > 1) {
          call4(nativeReplace, match[0], reCopy, function() {
            for (i2 = 1; i2 < arguments.length - 2; i2++) {
              if (arguments[i2] === void 0) match[i2] = void 0;
            }
          });
        }
        if (match && groups) {
          match.groups = object = create(null);
          for (i2 = 0; i2 < groups.length; i2++) {
            group = groups[i2];
            object[group[0]] = match[group[1]];
          }
        }
        return match;
      };
    }
    module.exports = patchedExec;
  }
});

// node_modules/core-js/modules/es.regexp.exec.js
var require_es_regexp_exec = __commonJS({
  "node_modules/core-js/modules/es.regexp.exec.js"() {
    "use strict";
    var $8 = require_export();
    var exec = require_regexp_exec();
    $8({ target: "RegExp", proto: true, forced: /./.exec !== exec }, {
      exec
    });
  }
});

// node_modules/core-js/internals/fix-regexp-well-known-symbol-logic.js
var require_fix_regexp_well_known_symbol_logic = __commonJS({
  "node_modules/core-js/internals/fix-regexp-well-known-symbol-logic.js"(exports, module) {
    "use strict";
    require_es_regexp_exec();
    var call4 = require_function_call();
    var defineBuiltIn2 = require_define_built_in();
    var regexpExec = require_regexp_exec();
    var fails4 = require_fails();
    var wellKnownSymbol3 = require_well_known_symbol();
    var createNonEnumerableProperty2 = require_create_non_enumerable_property();
    var SPECIES = wellKnownSymbol3("species");
    var RegExpPrototype2 = RegExp.prototype;
    module.exports = function(KEY, exec, FORCED3, SHAM) {
      var SYMBOL = wellKnownSymbol3(KEY);
      var DELEGATES_TO_SYMBOL = !fails4(function() {
        var O2 = {};
        O2[SYMBOL] = function() {
          return 7;
        };
        return ""[KEY](O2) !== 7;
      });
      var DELEGATES_TO_EXEC = DELEGATES_TO_SYMBOL && !fails4(function() {
        var execCalled = false;
        var re = /a/;
        if (KEY === "split") {
          var constructor = {};
          constructor[SPECIES] = function() {
            return re;
          };
          re = { constructor, flags: "" };
          re[SYMBOL] = /./[SYMBOL];
        }
        re.exec = function() {
          execCalled = true;
          return null;
        };
        re[SYMBOL]("");
        return !execCalled;
      });
      if (!DELEGATES_TO_SYMBOL || !DELEGATES_TO_EXEC || FORCED3) {
        var nativeRegExpMethod = /./[SYMBOL];
        var methods = exec(SYMBOL, ""[KEY], function(nativeMethod, regexp, str, arg2, forceStringMethod) {
          var $exec = regexp.exec;
          if ($exec === regexpExec || $exec === RegExpPrototype2.exec) {
            if (DELEGATES_TO_SYMBOL && !forceStringMethod) {
              return { done: true, value: call4(nativeRegExpMethod, regexp, str, arg2) };
            }
            return { done: true, value: call4(nativeMethod, str, regexp, arg2) };
          }
          return { done: false };
        });
        defineBuiltIn2(String.prototype, KEY, methods[0]);
        defineBuiltIn2(RegExpPrototype2, SYMBOL, methods[1]);
      }
      if (SHAM) createNonEnumerableProperty2(RegExpPrototype2[SYMBOL], "sham", true);
    };
  }
});

// node_modules/core-js/internals/string-multibyte.js
var require_string_multibyte = __commonJS({
  "node_modules/core-js/internals/string-multibyte.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var toIntegerOrInfinity2 = require_to_integer_or_infinity();
    var toString7 = require_to_string();
    var requireObjectCoercible7 = require_require_object_coercible();
    var charAt = uncurryThis9("".charAt);
    var charCodeAt = uncurryThis9("".charCodeAt);
    var stringSlice4 = uncurryThis9("".slice);
    var createMethod = function(CONVERT_TO_STRING) {
      return function($this, pos) {
        var S = toString7(requireObjectCoercible7($this));
        var position = toIntegerOrInfinity2(pos);
        var size = S.length;
        var first, second;
        if (position < 0 || position >= size) return CONVERT_TO_STRING ? "" : void 0;
        first = charCodeAt(S, position);
        return first < 55296 || first > 56319 || position + 1 === size || (second = charCodeAt(S, position + 1)) < 56320 || second > 57343 ? CONVERT_TO_STRING ? charAt(S, position) : first : CONVERT_TO_STRING ? stringSlice4(S, position, position + 2) : (first - 55296 << 10) + (second - 56320) + 65536;
      };
    };
    module.exports = {
      // `String.prototype.codePointAt` method
      // https://tc39.es/ecma262/#sec-string.prototype.codepointat
      codeAt: createMethod(false),
      // `String.prototype.at` method
      // https://github.com/mathiasbynens/String.prototype.at
      charAt: createMethod(true)
    };
  }
});

// node_modules/core-js/internals/advance-string-index.js
var require_advance_string_index = __commonJS({
  "node_modules/core-js/internals/advance-string-index.js"(exports, module) {
    "use strict";
    var charAt = require_string_multibyte().charAt;
    module.exports = function(S, index2, unicode) {
      return index2 + (unicode ? charAt(S, index2).length : 1);
    };
  }
});

// node_modules/core-js/internals/regexp-flags-detection.js
var require_regexp_flags_detection = __commonJS({
  "node_modules/core-js/internals/regexp-flags-detection.js"(exports, module) {
    "use strict";
    var globalThis3 = require_global_this();
    var fails4 = require_fails();
    var RegExp2 = globalThis3.RegExp;
    var FLAGS_GETTER_IS_CORRECT = !fails4(function() {
      var INDICES_SUPPORT = true;
      try {
        RegExp2(".", "d");
      } catch (error) {
        INDICES_SUPPORT = false;
      }
      var O2 = {};
      var calls = "";
      var expected = INDICES_SUPPORT ? "dgimsy" : "gimsy";
      var addGetter = function(key2, chr) {
        Object.defineProperty(O2, key2, { get: function() {
          calls += chr;
          return true;
        } });
      };
      var pairs = {
        dotAll: "s",
        global: "g",
        ignoreCase: "i",
        multiline: "m",
        sticky: "y"
      };
      if (INDICES_SUPPORT) pairs.hasIndices = "d";
      for (var key in pairs) addGetter(key, pairs[key]);
      var result = Object.getOwnPropertyDescriptor(RegExp2.prototype, "flags").get.call(O2);
      return result !== expected || calls !== expected;
    });
    module.exports = { correct: FLAGS_GETTER_IS_CORRECT };
  }
});

// node_modules/core-js/internals/regexp-get-flags.js
var require_regexp_get_flags = __commonJS({
  "node_modules/core-js/internals/regexp-get-flags.js"(exports, module) {
    "use strict";
    var call4 = require_function_call();
    var hasOwn = require_has_own_property();
    var isPrototypeOf = require_object_is_prototype_of();
    var regExpFlagsDetection = require_regexp_flags_detection();
    var regExpFlagsGetterImplementation = require_regexp_flags();
    var RegExpPrototype2 = RegExp.prototype;
    module.exports = regExpFlagsDetection.correct ? function(it) {
      return it.flags;
    } : function(it) {
      return !regExpFlagsDetection.correct && isPrototypeOf(RegExpPrototype2, it) && !hasOwn(it, "flags") ? call4(regExpFlagsGetterImplementation, it) : it.flags;
    };
  }
});

// node_modules/core-js/internals/regexp-exec-abstract.js
var require_regexp_exec_abstract = __commonJS({
  "node_modules/core-js/internals/regexp-exec-abstract.js"(exports, module) {
    "use strict";
    var call4 = require_function_call();
    var anObject5 = require_an_object();
    var isCallable2 = require_is_callable();
    var classof = require_classof_raw();
    var regexpExec = require_regexp_exec();
    var $TypeError = TypeError;
    module.exports = function(R, S) {
      var exec = R.exec;
      if (isCallable2(exec)) {
        var result = call4(exec, R, S);
        if (result !== null) anObject5(result);
        return result;
      }
      if (classof(R) === "RegExp") return call4(regexpExec, R, S);
      throw new $TypeError("RegExp#exec called on incompatible receiver");
    };
  }
});

// node_modules/core-js/internals/get-substitution.js
var require_get_substitution = __commonJS({
  "node_modules/core-js/internals/get-substitution.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var toObject = require_to_object();
    var floor = Math.floor;
    var charAt = uncurryThis9("".charAt);
    var replace = uncurryThis9("".replace);
    var stringSlice4 = uncurryThis9("".slice);
    var SUBSTITUTION_SYMBOLS = /\$([$&'`]|\d{1,2}|<[^>]*>)/g;
    var SUBSTITUTION_SYMBOLS_NO_NAMED = /\$([$&'`]|\d{1,2})/g;
    module.exports = function(matched, str, position, captures, namedCaptures, replacement) {
      var tailPos = position + matched.length;
      var m3 = captures.length;
      var symbols = SUBSTITUTION_SYMBOLS_NO_NAMED;
      if (namedCaptures !== void 0) {
        namedCaptures = toObject(namedCaptures);
        symbols = SUBSTITUTION_SYMBOLS;
      }
      return replace(replacement, symbols, function(match, ch) {
        var capture;
        switch (charAt(ch, 0)) {
          case "$":
            return "$";
          case "&":
            return matched;
          case "`":
            return stringSlice4(str, 0, position);
          case "'":
            return stringSlice4(str, tailPos);
          case "<":
            capture = namedCaptures[stringSlice4(ch, 1, -1)];
            break;
          default:
            var n2 = +ch;
            if (n2 === 0) return match;
            if (n2 > m3) {
              var f2 = floor(n2 / 10);
              if (f2 === 0) return match;
              if (f2 <= m3) return captures[f2 - 1] === void 0 ? charAt(ch, 1) : captures[f2 - 1] + charAt(ch, 1);
              return match;
            }
            capture = captures[n2 - 1];
        }
        return capture === void 0 ? "" : capture;
      });
    };
  }
});

// node_modules/core-js/internals/is-regexp.js
var require_is_regexp = __commonJS({
  "node_modules/core-js/internals/is-regexp.js"(exports, module) {
    "use strict";
    var isObject4 = require_is_object();
    var classof = require_classof_raw();
    var wellKnownSymbol3 = require_well_known_symbol();
    var MATCH = wellKnownSymbol3("match");
    module.exports = function(it) {
      var isRegExp;
      return isObject4(it) && ((isRegExp = it[MATCH]) !== void 0 ? !!isRegExp : classof(it) === "RegExp");
    };
  }
});

// node_modules/core-js/internals/not-a-regexp.js
var require_not_a_regexp = __commonJS({
  "node_modules/core-js/internals/not-a-regexp.js"(exports, module) {
    "use strict";
    var isRegExp = require_is_regexp();
    var $TypeError = TypeError;
    module.exports = function(it) {
      if (isRegExp(it)) {
        throw new $TypeError("The method doesn't accept regular expressions");
      }
      return it;
    };
  }
});

// node_modules/core-js/internals/correct-is-regexp-logic.js
var require_correct_is_regexp_logic = __commonJS({
  "node_modules/core-js/internals/correct-is-regexp-logic.js"(exports, module) {
    "use strict";
    var wellKnownSymbol3 = require_well_known_symbol();
    var MATCH = wellKnownSymbol3("match");
    module.exports = function(METHOD_NAME) {
      var regexp = /./;
      try {
        "/./"[METHOD_NAME](regexp);
      } catch (error1) {
        try {
          regexp[MATCH] = false;
          return "/./"[METHOD_NAME](regexp);
        } catch (error2) {
        }
      }
      return false;
    };
  }
});

// node_modules/core-js/internals/add-to-unscopables.js
var require_add_to_unscopables = __commonJS({
  "node_modules/core-js/internals/add-to-unscopables.js"(exports, module) {
    "use strict";
    var wellKnownSymbol3 = require_well_known_symbol();
    var create = require_object_create();
    var defineProperty = require_object_define_property().f;
    var UNSCOPABLES = wellKnownSymbol3("unscopables");
    var ArrayPrototype = Array.prototype;
    if (ArrayPrototype[UNSCOPABLES] === void 0) {
      defineProperty(ArrayPrototype, UNSCOPABLES, {
        configurable: true,
        value: create(null)
      });
    }
    module.exports = function(key) {
      ArrayPrototype[UNSCOPABLES][key] = true;
    };
  }
});

// node_modules/core-js/internals/correct-prototype-getter.js
var require_correct_prototype_getter = __commonJS({
  "node_modules/core-js/internals/correct-prototype-getter.js"(exports, module) {
    "use strict";
    var fails4 = require_fails();
    module.exports = !fails4(function() {
      function F() {
      }
      F.prototype.constructor = null;
      return Object.getPrototypeOf(new F()) !== F.prototype;
    });
  }
});

// node_modules/core-js/internals/object-get-prototype-of.js
var require_object_get_prototype_of = __commonJS({
  "node_modules/core-js/internals/object-get-prototype-of.js"(exports, module) {
    "use strict";
    var hasOwn = require_has_own_property();
    var isCallable2 = require_is_callable();
    var toObject = require_to_object();
    var sharedKey = require_shared_key();
    var CORRECT_PROTOTYPE_GETTER = require_correct_prototype_getter();
    var IE_PROTO = sharedKey("IE_PROTO");
    var $Object = Object;
    var ObjectPrototype = $Object.prototype;
    module.exports = CORRECT_PROTOTYPE_GETTER ? $Object.getPrototypeOf : function(O2) {
      var object = toObject(O2);
      if (hasOwn(object, IE_PROTO)) return object[IE_PROTO];
      var constructor = object.constructor;
      if (isCallable2(constructor) && object instanceof constructor) {
        return constructor.prototype;
      }
      return object instanceof $Object ? ObjectPrototype : null;
    };
  }
});

// node_modules/core-js/internals/iterators-core.js
var require_iterators_core = __commonJS({
  "node_modules/core-js/internals/iterators-core.js"(exports, module) {
    "use strict";
    var fails4 = require_fails();
    var isCallable2 = require_is_callable();
    var isObject4 = require_is_object();
    var create = require_object_create();
    var getPrototypeOf = require_object_get_prototype_of();
    var defineBuiltIn2 = require_define_built_in();
    var wellKnownSymbol3 = require_well_known_symbol();
    var IS_PURE3 = require_is_pure();
    var ITERATOR2 = wellKnownSymbol3("iterator");
    var BUGGY_SAFARI_ITERATORS = false;
    var IteratorPrototype;
    var PrototypeOfArrayIteratorPrototype;
    var arrayIterator;
    if ([].keys) {
      arrayIterator = [].keys();
      if (!("next" in arrayIterator)) BUGGY_SAFARI_ITERATORS = true;
      else {
        PrototypeOfArrayIteratorPrototype = getPrototypeOf(getPrototypeOf(arrayIterator));
        if (PrototypeOfArrayIteratorPrototype !== Object.prototype) IteratorPrototype = PrototypeOfArrayIteratorPrototype;
      }
    }
    var NEW_ITERATOR_PROTOTYPE = !isObject4(IteratorPrototype) || fails4(function() {
      var test2 = {};
      return IteratorPrototype[ITERATOR2].call(test2) !== test2;
    });
    if (NEW_ITERATOR_PROTOTYPE) IteratorPrototype = {};
    else if (IS_PURE3) IteratorPrototype = create(IteratorPrototype);
    if (!isCallable2(IteratorPrototype[ITERATOR2])) {
      defineBuiltIn2(IteratorPrototype, ITERATOR2, function() {
        return this;
      });
    }
    module.exports = {
      IteratorPrototype,
      BUGGY_SAFARI_ITERATORS
    };
  }
});

// node_modules/core-js/internals/iterator-create-constructor.js
var require_iterator_create_constructor = __commonJS({
  "node_modules/core-js/internals/iterator-create-constructor.js"(exports, module) {
    "use strict";
    var IteratorPrototype = require_iterators_core().IteratorPrototype;
    var create = require_object_create();
    var createPropertyDescriptor = require_create_property_descriptor();
    var setToStringTag2 = require_set_to_string_tag();
    var Iterators = require_iterators();
    var returnThis = function() {
      return this;
    };
    module.exports = function(IteratorConstructor, NAME, next, ENUMERABLE_NEXT) {
      var TO_STRING_TAG = NAME + " Iterator";
      IteratorConstructor.prototype = create(IteratorPrototype, { next: createPropertyDescriptor(+!ENUMERABLE_NEXT, next) });
      setToStringTag2(IteratorConstructor, TO_STRING_TAG, false, true);
      Iterators[TO_STRING_TAG] = returnThis;
      return IteratorConstructor;
    };
  }
});

// node_modules/core-js/internals/iterator-define.js
var require_iterator_define = __commonJS({
  "node_modules/core-js/internals/iterator-define.js"(exports, module) {
    "use strict";
    var $8 = require_export();
    var call4 = require_function_call();
    var IS_PURE3 = require_is_pure();
    var FunctionName = require_function_name();
    var isCallable2 = require_is_callable();
    var createIteratorConstructor = require_iterator_create_constructor();
    var getPrototypeOf = require_object_get_prototype_of();
    var setPrototypeOf = require_object_set_prototype_of();
    var setToStringTag2 = require_set_to_string_tag();
    var createNonEnumerableProperty2 = require_create_non_enumerable_property();
    var defineBuiltIn2 = require_define_built_in();
    var wellKnownSymbol3 = require_well_known_symbol();
    var Iterators = require_iterators();
    var IteratorsCore = require_iterators_core();
    var PROPER_FUNCTION_NAME2 = FunctionName.PROPER;
    var CONFIGURABLE_FUNCTION_NAME = FunctionName.CONFIGURABLE;
    var IteratorPrototype = IteratorsCore.IteratorPrototype;
    var BUGGY_SAFARI_ITERATORS = IteratorsCore.BUGGY_SAFARI_ITERATORS;
    var ITERATOR2 = wellKnownSymbol3("iterator");
    var KEYS = "keys";
    var VALUES = "values";
    var ENTRIES = "entries";
    var returnThis = function() {
      return this;
    };
    module.exports = function(Iterable, NAME, IteratorConstructor, next, DEFAULT, IS_SET, FORCED3) {
      createIteratorConstructor(IteratorConstructor, NAME, next);
      var getIterationMethod = function(KIND) {
        if (KIND === DEFAULT && defaultIterator) return defaultIterator;
        if (!BUGGY_SAFARI_ITERATORS && KIND && KIND in IterablePrototype) return IterablePrototype[KIND];
        switch (KIND) {
          case KEYS:
            return function keys() {
              return new IteratorConstructor(this, KIND);
            };
          case VALUES:
            return function values() {
              return new IteratorConstructor(this, KIND);
            };
          case ENTRIES:
            return function entries() {
              return new IteratorConstructor(this, KIND);
            };
        }
        return function() {
          return new IteratorConstructor(this);
        };
      };
      var TO_STRING_TAG = NAME + " Iterator";
      var INCORRECT_VALUES_NAME = false;
      var IterablePrototype = Iterable.prototype;
      var nativeIterator = IterablePrototype[ITERATOR2] || IterablePrototype["@@iterator"] || DEFAULT && IterablePrototype[DEFAULT];
      var defaultIterator = !BUGGY_SAFARI_ITERATORS && nativeIterator || getIterationMethod(DEFAULT);
      var anyNativeIterator = NAME === "Array" ? IterablePrototype.entries || nativeIterator : nativeIterator;
      var CurrentIteratorPrototype, methods, KEY;
      if (anyNativeIterator) {
        CurrentIteratorPrototype = getPrototypeOf(anyNativeIterator.call(new Iterable()));
        if (CurrentIteratorPrototype !== Object.prototype && CurrentIteratorPrototype.next) {
          if (!IS_PURE3 && getPrototypeOf(CurrentIteratorPrototype) !== IteratorPrototype) {
            if (setPrototypeOf) {
              setPrototypeOf(CurrentIteratorPrototype, IteratorPrototype);
            } else if (!isCallable2(CurrentIteratorPrototype[ITERATOR2])) {
              defineBuiltIn2(CurrentIteratorPrototype, ITERATOR2, returnThis);
            }
          }
          setToStringTag2(CurrentIteratorPrototype, TO_STRING_TAG, true, true);
          if (IS_PURE3) Iterators[TO_STRING_TAG] = returnThis;
        }
      }
      if (PROPER_FUNCTION_NAME2 && DEFAULT === VALUES && nativeIterator && nativeIterator.name !== VALUES) {
        if (!IS_PURE3 && CONFIGURABLE_FUNCTION_NAME) {
          createNonEnumerableProperty2(IterablePrototype, "name", VALUES);
        } else {
          INCORRECT_VALUES_NAME = true;
          defaultIterator = function values() {
            return call4(nativeIterator, this);
          };
        }
      }
      if (DEFAULT) {
        methods = {
          values: getIterationMethod(VALUES),
          keys: IS_SET ? defaultIterator : getIterationMethod(KEYS),
          entries: getIterationMethod(ENTRIES)
        };
        if (FORCED3) for (KEY in methods) {
          if (BUGGY_SAFARI_ITERATORS || INCORRECT_VALUES_NAME || !(KEY in IterablePrototype)) {
            defineBuiltIn2(IterablePrototype, KEY, methods[KEY]);
          }
        }
        else $8({ target: NAME, proto: true, forced: BUGGY_SAFARI_ITERATORS || INCORRECT_VALUES_NAME }, methods);
      }
      if ((!IS_PURE3 || FORCED3) && IterablePrototype[ITERATOR2] !== defaultIterator) {
        defineBuiltIn2(IterablePrototype, ITERATOR2, defaultIterator, { name: DEFAULT });
      }
      Iterators[NAME] = defaultIterator;
      return methods;
    };
  }
});

// node_modules/core-js/internals/create-iter-result-object.js
var require_create_iter_result_object = __commonJS({
  "node_modules/core-js/internals/create-iter-result-object.js"(exports, module) {
    "use strict";
    module.exports = function(value, done) {
      return { value, done };
    };
  }
});

// node_modules/core-js/modules/es.array.iterator.js
var require_es_array_iterator = __commonJS({
  "node_modules/core-js/modules/es.array.iterator.js"(exports, module) {
    "use strict";
    var toIndexedObject = require_to_indexed_object();
    var addToUnscopables = require_add_to_unscopables();
    var Iterators = require_iterators();
    var InternalStateModule = require_internal_state();
    var defineProperty = require_object_define_property().f;
    var defineIterator = require_iterator_define();
    var createIterResultObject = require_create_iter_result_object();
    var IS_PURE3 = require_is_pure();
    var DESCRIPTORS = require_descriptors();
    var ARRAY_ITERATOR = "Array Iterator";
    var setInternalState = InternalStateModule.set;
    var getInternalState = InternalStateModule.getterFor(ARRAY_ITERATOR);
    module.exports = defineIterator(Array, "Array", function(iterated, kind) {
      setInternalState(this, {
        type: ARRAY_ITERATOR,
        target: toIndexedObject(iterated),
        // target
        index: 0,
        // next index
        kind
        // kind
      });
    }, function() {
      var state = getInternalState(this);
      var target = state.target;
      var index2 = state.index++;
      if (!target || index2 >= target.length) {
        state.target = null;
        return createIterResultObject(void 0, true);
      }
      switch (state.kind) {
        case "keys":
          return createIterResultObject(index2, false);
        case "values":
          return createIterResultObject(target[index2], false);
      }
      return createIterResultObject([index2, target[index2]], false);
    }, "values");
    var values = Iterators.Arguments = Iterators.Array;
    addToUnscopables("keys");
    addToUnscopables("values");
    addToUnscopables("entries");
    if (!IS_PURE3 && DESCRIPTORS && values.name !== "values") try {
      defineProperty(values, "name", { value: "values" });
    } catch (error) {
    }
  }
});

// node_modules/core-js/internals/dom-iterables.js
var require_dom_iterables = __commonJS({
  "node_modules/core-js/internals/dom-iterables.js"(exports, module) {
    "use strict";
    module.exports = {
      CSSRuleList: 0,
      CSSStyleDeclaration: 0,
      CSSValueList: 0,
      ClientRectList: 0,
      DOMRectList: 0,
      DOMStringList: 0,
      DOMTokenList: 1,
      DataTransferItemList: 0,
      FileList: 0,
      HTMLAllCollection: 0,
      HTMLCollection: 0,
      HTMLFormElement: 0,
      HTMLSelectElement: 0,
      MediaList: 0,
      MimeTypeArray: 0,
      NamedNodeMap: 0,
      NodeList: 1,
      PaintRequestList: 0,
      Plugin: 0,
      PluginArray: 0,
      SVGLengthList: 0,
      SVGNumberList: 0,
      SVGPathSegList: 0,
      SVGPointList: 0,
      SVGStringList: 0,
      SVGTransformList: 0,
      SourceBufferList: 0,
      StyleSheetList: 0,
      TextTrackCueList: 0,
      TextTrackList: 0,
      TouchList: 0
    };
  }
});

// node_modules/core-js/internals/dom-token-list-prototype.js
var require_dom_token_list_prototype = __commonJS({
  "node_modules/core-js/internals/dom-token-list-prototype.js"(exports, module) {
    "use strict";
    var documentCreateElement = require_document_create_element();
    var classList = documentCreateElement("span").classList;
    var DOMTokenListPrototype2 = classList && classList.constructor && classList.constructor.prototype;
    module.exports = DOMTokenListPrototype2 === Object.prototype ? void 0 : DOMTokenListPrototype2;
  }
});

// node_modules/core-js/internals/array-reduce.js
var require_array_reduce = __commonJS({
  "node_modules/core-js/internals/array-reduce.js"(exports, module) {
    "use strict";
    var aCallable = require_a_callable();
    var toObject = require_to_object();
    var IndexedObject = require_indexed_object();
    var lengthOfArrayLike = require_length_of_array_like();
    var $TypeError = TypeError;
    var REDUCE_EMPTY = "Reduce of empty array with no initial value";
    var createMethod = function(IS_RIGHT) {
      return function(that, callbackfn, argumentsLength, memo) {
        var O2 = toObject(that);
        var self2 = IndexedObject(O2);
        var length = lengthOfArrayLike(O2);
        aCallable(callbackfn);
        if (length === 0 && argumentsLength < 2) throw new $TypeError(REDUCE_EMPTY);
        var index2 = IS_RIGHT ? length - 1 : 0;
        var i2 = IS_RIGHT ? -1 : 1;
        if (argumentsLength < 2) while (true) {
          if (index2 in self2) {
            memo = self2[index2];
            index2 += i2;
            break;
          }
          index2 += i2;
          if (IS_RIGHT ? index2 < 0 : length <= index2) {
            throw new $TypeError(REDUCE_EMPTY);
          }
        }
        for (; IS_RIGHT ? index2 >= 0 : length > index2; index2 += i2) if (index2 in self2) {
          memo = callbackfn(memo, self2[index2], index2, O2);
        }
        return memo;
      };
    };
    module.exports = {
      // `Array.prototype.reduce` method
      // https://tc39.es/ecma262/#sec-array.prototype.reduce
      left: createMethod(false),
      // `Array.prototype.reduceRight` method
      // https://tc39.es/ecma262/#sec-array.prototype.reduceright
      right: createMethod(true)
    };
  }
});

// node_modules/core-js/internals/array-method-is-strict.js
var require_array_method_is_strict = __commonJS({
  "node_modules/core-js/internals/array-method-is-strict.js"(exports, module) {
    "use strict";
    var fails4 = require_fails();
    module.exports = function(METHOD_NAME, argument) {
      var method = [][METHOD_NAME];
      return !!method && fails4(function() {
        method.call(null, argument || function() {
          return 1;
        }, 1);
      });
    };
  }
});

// node_modules/performance-now/lib/performance-now.js
var require_performance_now = __commonJS({
  "node_modules/performance-now/lib/performance-now.js"(exports, module) {
    (function() {
      var getNanoSeconds, hrtime, loadTime, moduleLoadTime, nodeLoadTime, upTime;
      if (typeof performance !== "undefined" && performance !== null && performance.now) {
        module.exports = function() {
          return performance.now();
        };
      } else if (typeof process !== "undefined" && process !== null && process.hrtime) {
        module.exports = function() {
          return (getNanoSeconds() - nodeLoadTime) / 1e6;
        };
        hrtime = process.hrtime;
        getNanoSeconds = function() {
          var hr;
          hr = hrtime();
          return hr[0] * 1e9 + hr[1];
        };
        moduleLoadTime = getNanoSeconds();
        upTime = process.uptime() * 1e9;
        nodeLoadTime = moduleLoadTime - upTime;
      } else if (Date.now) {
        module.exports = function() {
          return Date.now() - loadTime;
        };
        loadTime = Date.now();
      } else {
        module.exports = function() {
          return (/* @__PURE__ */ new Date()).getTime() - loadTime;
        };
        loadTime = (/* @__PURE__ */ new Date()).getTime();
      }
    }).call(exports);
  }
});

// node_modules/raf/index.js
var require_raf = __commonJS({
  "node_modules/raf/index.js"(exports, module) {
    var now = require_performance_now();
    var root = typeof window === "undefined" ? global : window;
    var vendors = ["moz", "webkit"];
    var suffix = "AnimationFrame";
    var raf = root["request" + suffix];
    var caf = root["cancel" + suffix] || root["cancelRequest" + suffix];
    for (i2 = 0; !raf && i2 < vendors.length; i2++) {
      raf = root[vendors[i2] + "Request" + suffix];
      caf = root[vendors[i2] + "Cancel" + suffix] || root[vendors[i2] + "CancelRequest" + suffix];
    }
    var i2;
    if (!raf || !caf) {
      last = 0, id = 0, queue = [], frameDuration = 1e3 / 60;
      raf = function(callback) {
        if (queue.length === 0) {
          var _now = now(), next = Math.max(0, frameDuration - (_now - last));
          last = next + _now;
          setTimeout(function() {
            var cp = queue.slice(0);
            queue.length = 0;
            for (var i3 = 0; i3 < cp.length; i3++) {
              if (!cp[i3].cancelled) {
                try {
                  cp[i3].callback(last);
                } catch (e2) {
                  setTimeout(function() {
                    throw e2;
                  }, 0);
                }
              }
            }
          }, Math.round(next));
        }
        queue.push({
          handle: ++id,
          callback,
          cancelled: false
        });
        return id;
      };
      caf = function(handle) {
        for (var i3 = 0; i3 < queue.length; i3++) {
          if (queue[i3].handle === handle) {
            queue[i3].cancelled = true;
          }
        }
      };
    }
    var last;
    var id;
    var queue;
    var frameDuration;
    module.exports = function(fn) {
      return raf.call(root, fn);
    };
    module.exports.cancel = function() {
      caf.apply(root, arguments);
    };
    module.exports.polyfill = function(object) {
      if (!object) {
        object = root;
      }
      object.requestAnimationFrame = raf;
      object.cancelAnimationFrame = caf;
    };
  }
});

// node_modules/core-js/internals/whitespaces.js
var require_whitespaces = __commonJS({
  "node_modules/core-js/internals/whitespaces.js"(exports, module) {
    "use strict";
    module.exports = "	\n\v\f\r                　\u2028\u2029\uFEFF";
  }
});

// node_modules/core-js/internals/string-trim.js
var require_string_trim = __commonJS({
  "node_modules/core-js/internals/string-trim.js"(exports, module) {
    "use strict";
    var uncurryThis9 = require_function_uncurry_this();
    var requireObjectCoercible7 = require_require_object_coercible();
    var toString7 = require_to_string();
    var whitespaces = require_whitespaces();
    var replace = uncurryThis9("".replace);
    var ltrim = RegExp("^[" + whitespaces + "]+");
    var rtrim = RegExp("(^|[^" + whitespaces + "])[" + whitespaces + "]+$");
    var createMethod = function(TYPE) {
      return function($this) {
        var string = toString7(requireObjectCoercible7($this));
        if (TYPE & 1) string = replace(string, ltrim, "");
        if (TYPE & 2) string = replace(string, rtrim, "$1");
        return string;
      };
    };
    module.exports = {
      // `String.prototype.{ trimLeft, trimStart }` methods
      // https://tc39.es/ecma262/#sec-string.prototype.trimstart
      start: createMethod(1),
      // `String.prototype.{ trimRight, trimEnd }` methods
      // https://tc39.es/ecma262/#sec-string.prototype.trimend
      end: createMethod(2),
      // `String.prototype.trim` method
      // https://tc39.es/ecma262/#sec-string.prototype.trim
      trim: createMethod(3)
    };
  }
});

// node_modules/core-js/internals/string-trim-forced.js
var require_string_trim_forced = __commonJS({
  "node_modules/core-js/internals/string-trim-forced.js"(exports, module) {
    "use strict";
    var PROPER_FUNCTION_NAME2 = require_function_name().PROPER;
    var fails4 = require_fails();
    var whitespaces = require_whitespaces();
    var non = "​᠎";
    module.exports = function(METHOD_NAME) {
      return fails4(function() {
        return !!whitespaces[METHOD_NAME]() || non[METHOD_NAME]() !== non || PROPER_FUNCTION_NAME2 && whitespaces[METHOD_NAME].name !== METHOD_NAME;
      });
    };
  }
});

// node_modules/rgbcolor/index.js
var require_rgbcolor = __commonJS({
  "node_modules/rgbcolor/index.js"(exports, module) {
    module.exports = function(color_string) {
      this.ok = false;
      this.alpha = 1;
      if (color_string.charAt(0) == "#") {
        color_string = color_string.substr(1, 6);
      }
      color_string = color_string.replace(/ /g, "");
      color_string = color_string.toLowerCase();
      var simple_colors = {
        aliceblue: "f0f8ff",
        antiquewhite: "faebd7",
        aqua: "00ffff",
        aquamarine: "7fffd4",
        azure: "f0ffff",
        beige: "f5f5dc",
        bisque: "ffe4c4",
        black: "000000",
        blanchedalmond: "ffebcd",
        blue: "0000ff",
        blueviolet: "8a2be2",
        brown: "a52a2a",
        burlywood: "deb887",
        cadetblue: "5f9ea0",
        chartreuse: "7fff00",
        chocolate: "d2691e",
        coral: "ff7f50",
        cornflowerblue: "6495ed",
        cornsilk: "fff8dc",
        crimson: "dc143c",
        cyan: "00ffff",
        darkblue: "00008b",
        darkcyan: "008b8b",
        darkgoldenrod: "b8860b",
        darkgray: "a9a9a9",
        darkgreen: "006400",
        darkkhaki: "bdb76b",
        darkmagenta: "8b008b",
        darkolivegreen: "556b2f",
        darkorange: "ff8c00",
        darkorchid: "9932cc",
        darkred: "8b0000",
        darksalmon: "e9967a",
        darkseagreen: "8fbc8f",
        darkslateblue: "483d8b",
        darkslategray: "2f4f4f",
        darkturquoise: "00ced1",
        darkviolet: "9400d3",
        deeppink: "ff1493",
        deepskyblue: "00bfff",
        dimgray: "696969",
        dodgerblue: "1e90ff",
        feldspar: "d19275",
        firebrick: "b22222",
        floralwhite: "fffaf0",
        forestgreen: "228b22",
        fuchsia: "ff00ff",
        gainsboro: "dcdcdc",
        ghostwhite: "f8f8ff",
        gold: "ffd700",
        goldenrod: "daa520",
        gray: "808080",
        green: "008000",
        greenyellow: "adff2f",
        honeydew: "f0fff0",
        hotpink: "ff69b4",
        indianred: "cd5c5c",
        indigo: "4b0082",
        ivory: "fffff0",
        khaki: "f0e68c",
        lavender: "e6e6fa",
        lavenderblush: "fff0f5",
        lawngreen: "7cfc00",
        lemonchiffon: "fffacd",
        lightblue: "add8e6",
        lightcoral: "f08080",
        lightcyan: "e0ffff",
        lightgoldenrodyellow: "fafad2",
        lightgrey: "d3d3d3",
        lightgreen: "90ee90",
        lightpink: "ffb6c1",
        lightsalmon: "ffa07a",
        lightseagreen: "20b2aa",
        lightskyblue: "87cefa",
        lightslateblue: "8470ff",
        lightslategray: "778899",
        lightsteelblue: "b0c4de",
        lightyellow: "ffffe0",
        lime: "00ff00",
        limegreen: "32cd32",
        linen: "faf0e6",
        magenta: "ff00ff",
        maroon: "800000",
        mediumaquamarine: "66cdaa",
        mediumblue: "0000cd",
        mediumorchid: "ba55d3",
        mediumpurple: "9370d8",
        mediumseagreen: "3cb371",
        mediumslateblue: "7b68ee",
        mediumspringgreen: "00fa9a",
        mediumturquoise: "48d1cc",
        mediumvioletred: "c71585",
        midnightblue: "191970",
        mintcream: "f5fffa",
        mistyrose: "ffe4e1",
        moccasin: "ffe4b5",
        navajowhite: "ffdead",
        navy: "000080",
        oldlace: "fdf5e6",
        olive: "808000",
        olivedrab: "6b8e23",
        orange: "ffa500",
        orangered: "ff4500",
        orchid: "da70d6",
        palegoldenrod: "eee8aa",
        palegreen: "98fb98",
        paleturquoise: "afeeee",
        palevioletred: "d87093",
        papayawhip: "ffefd5",
        peachpuff: "ffdab9",
        peru: "cd853f",
        pink: "ffc0cb",
        plum: "dda0dd",
        powderblue: "b0e0e6",
        purple: "800080",
        rebeccapurple: "663399",
        red: "ff0000",
        rosybrown: "bc8f8f",
        royalblue: "4169e1",
        saddlebrown: "8b4513",
        salmon: "fa8072",
        sandybrown: "f4a460",
        seagreen: "2e8b57",
        seashell: "fff5ee",
        sienna: "a0522d",
        silver: "c0c0c0",
        skyblue: "87ceeb",
        slateblue: "6a5acd",
        slategray: "708090",
        snow: "fffafa",
        springgreen: "00ff7f",
        steelblue: "4682b4",
        tan: "d2b48c",
        teal: "008080",
        thistle: "d8bfd8",
        tomato: "ff6347",
        turquoise: "40e0d0",
        violet: "ee82ee",
        violetred: "d02090",
        wheat: "f5deb3",
        white: "ffffff",
        whitesmoke: "f5f5f5",
        yellow: "ffff00",
        yellowgreen: "9acd32"
      };
      color_string = simple_colors[color_string] || color_string;
      var color_defs = [
        {
          re: /^rgba\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3}),\s*((?:\d?\.)?\d)\)$/,
          example: ["rgba(123, 234, 45, 0.8)", "rgba(255,234,245,1.0)"],
          process: function(bits2) {
            return [
              parseInt(bits2[1]),
              parseInt(bits2[2]),
              parseInt(bits2[3]),
              parseFloat(bits2[4])
            ];
          }
        },
        {
          re: /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/,
          example: ["rgb(123, 234, 45)", "rgb(255,234,245)"],
          process: function(bits2) {
            return [
              parseInt(bits2[1]),
              parseInt(bits2[2]),
              parseInt(bits2[3])
            ];
          }
        },
        {
          re: /^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/,
          example: ["#00ff00", "336699"],
          process: function(bits2) {
            return [
              parseInt(bits2[1], 16),
              parseInt(bits2[2], 16),
              parseInt(bits2[3], 16)
            ];
          }
        },
        {
          re: /^([0-9a-fA-F]{1})([0-9a-fA-F]{1})([0-9a-fA-F]{1})$/,
          example: ["#fb0", "f0f"],
          process: function(bits2) {
            return [
              parseInt(bits2[1] + bits2[1], 16),
              parseInt(bits2[2] + bits2[2], 16),
              parseInt(bits2[3] + bits2[3], 16)
            ];
          }
        }
      ];
      for (var i2 = 0; i2 < color_defs.length; i2++) {
        var re = color_defs[i2].re;
        var processor = color_defs[i2].process;
        var bits = re.exec(color_string);
        if (bits) {
          var channels = processor(bits);
          this.r = channels[0];
          this.g = channels[1];
          this.b = channels[2];
          if (channels.length > 3) {
            this.alpha = channels[3];
          }
          this.ok = true;
        }
      }
      this.r = this.r < 0 || isNaN(this.r) ? 0 : this.r > 255 ? 255 : this.r;
      this.g = this.g < 0 || isNaN(this.g) ? 0 : this.g > 255 ? 255 : this.g;
      this.b = this.b < 0 || isNaN(this.b) ? 0 : this.b > 255 ? 255 : this.b;
      this.alpha = this.alpha < 0 ? 0 : this.alpha > 1 || isNaN(this.alpha) ? 1 : this.alpha;
      this.toRGB = function() {
        return "rgb(" + this.r + ", " + this.g + ", " + this.b + ")";
      };
      this.toRGBA = function() {
        return "rgba(" + this.r + ", " + this.g + ", " + this.b + ", " + this.alpha + ")";
      };
      this.toHex = function() {
        var r2 = this.r.toString(16);
        var g = this.g.toString(16);
        var b = this.b.toString(16);
        if (r2.length == 1) r2 = "0" + r2;
        if (g.length == 1) g = "0" + g;
        if (b.length == 1) b = "0" + b;
        return "#" + r2 + g + b;
      };
      this.getHelpXML = function() {
        var examples = new Array();
        for (var i3 = 0; i3 < color_defs.length; i3++) {
          var example = color_defs[i3].example;
          for (var j = 0; j < example.length; j++) {
            examples[examples.length] = example[j];
          }
        }
        for (var sc in simple_colors) {
          examples[examples.length] = sc;
        }
        var xml = document.createElement("ul");
        xml.setAttribute("id", "rgbcolor-examples");
        for (var i3 = 0; i3 < examples.length; i3++) {
          try {
            var list_item = document.createElement("li");
            var list_color = new RGBColor(examples[i3]);
            var example_div = document.createElement("div");
            example_div.style.cssText = "margin: 3px; border: 1px solid black; background:" + list_color.toHex() + "; color:" + list_color.toHex();
            example_div.appendChild(document.createTextNode("test"));
            var list_item_value = document.createTextNode(
              " " + examples[i3] + " -> " + list_color.toRGB() + " -> " + list_color.toHex()
            );
            list_item.appendChild(example_div);
            list_item.appendChild(list_item_value);
            xml.appendChild(list_item);
          } catch (e2) {
          }
        }
        return xml;
      };
    };
  }
});

// node_modules/core-js/internals/is-array.js
var require_is_array = __commonJS({
  "node_modules/core-js/internals/is-array.js"(exports, module) {
    "use strict";
    var classof = require_classof_raw();
    module.exports = Array.isArray || function isArray2(argument) {
      return classof(argument) === "Array";
    };
  }
});

// node_modules/core-js/modules/es.promise.js
require_es_promise_constructor();
require_es_promise_all();
require_es_promise_catch();
require_es_promise_race();
require_es_promise_reject();
require_es_promise_resolve();

// node_modules/core-js/modules/es.string.match.js
var call = require_function_call();
var uncurryThis = require_function_uncurry_this();
var fixRegExpWellKnownSymbolLogic = require_fix_regexp_well_known_symbol_logic();
var anObject = require_an_object();
var isObject = require_is_object();
var toLength = require_to_length();
var toString = require_to_string();
var requireObjectCoercible = require_require_object_coercible();
var getMethod = require_get_method();
var advanceStringIndex = require_advance_string_index();
var getRegExpFlags = require_regexp_get_flags();
var regExpExec = require_regexp_exec_abstract();
var stringIndexOf = uncurryThis("".indexOf);
fixRegExpWellKnownSymbolLogic("match", function(MATCH, nativeMatch, maybeCallNative) {
  return [
    // `String.prototype.match` method
    // https://tc39.es/ecma262/#sec-string.prototype.match
    function match(regexp) {
      var O2 = requireObjectCoercible(this);
      var matcher = isObject(regexp) ? getMethod(regexp, MATCH) : void 0;
      return matcher ? call(matcher, regexp, O2) : new RegExp(regexp)[MATCH](toString(O2));
    },
    // `RegExp.prototype[@@match]` method
    // https://tc39.es/ecma262/#sec-regexp.prototype-@@match
    function(string) {
      var rx = anObject(this);
      var S = toString(string);
      var res = maybeCallNative(nativeMatch, rx, S);
      if (res.done) return res.value;
      var flags = toString(getRegExpFlags(rx));
      if (stringIndexOf(flags, "g") === -1) return regExpExec(rx, S);
      var fullUnicode = stringIndexOf(flags, "u") !== -1;
      rx.lastIndex = 0;
      var A = [];
      var n2 = 0;
      var result;
      while ((result = regExpExec(rx, S)) !== null) {
        var matchStr = toString(result[0]);
        A[n2] = matchStr;
        if (matchStr === "") rx.lastIndex = advanceStringIndex(S, toLength(rx.lastIndex), fullUnicode);
        n2++;
      }
      return n2 === 0 ? null : A;
    }
  ];
});

// node_modules/core-js/modules/es.string.replace.js
var apply = require_function_apply();
var call2 = require_function_call();
var uncurryThis2 = require_function_uncurry_this();
var fixRegExpWellKnownSymbolLogic2 = require_fix_regexp_well_known_symbol_logic();
var fails = require_fails();
var anObject2 = require_an_object();
var isCallable = require_is_callable();
var isObject2 = require_is_object();
var toIntegerOrInfinity = require_to_integer_or_infinity();
var toLength2 = require_to_length();
var toString2 = require_to_string();
var requireObjectCoercible2 = require_require_object_coercible();
var advanceStringIndex2 = require_advance_string_index();
var getMethod2 = require_get_method();
var getSubstitution = require_get_substitution();
var getRegExpFlags2 = require_regexp_get_flags();
var regExpExec2 = require_regexp_exec_abstract();
var wellKnownSymbol = require_well_known_symbol();
var REPLACE = wellKnownSymbol("replace");
var max = Math.max;
var min = Math.min;
var concat = uncurryThis2([].concat);
var push = uncurryThis2([].push);
var stringIndexOf2 = uncurryThis2("".indexOf);
var stringSlice = uncurryThis2("".slice);
var maybeToString = function(it) {
  return it === void 0 ? it : String(it);
};
var REPLACE_KEEPS_$0 = function() {
  return "a".replace(/./, "$0") === "$0";
}();
var REGEXP_REPLACE_SUBSTITUTES_UNDEFINED_CAPTURE = function() {
  if (/./[REPLACE]) {
    return /./[REPLACE]("a", "$0") === "";
  }
  return false;
}();
var REPLACE_SUPPORTS_NAMED_GROUPS = !fails(function() {
  var re = /./;
  re.exec = function() {
    var result = [];
    result.groups = { a: "7" };
    return result;
  };
  return "".replace(re, "$<a>") !== "7";
});
fixRegExpWellKnownSymbolLogic2("replace", function(_2, nativeReplace, maybeCallNative) {
  var UNSAFE_SUBSTITUTE = REGEXP_REPLACE_SUBSTITUTES_UNDEFINED_CAPTURE ? "$" : "$0";
  return [
    // `String.prototype.replace` method
    // https://tc39.es/ecma262/#sec-string.prototype.replace
    function replace(searchValue, replaceValue) {
      var O2 = requireObjectCoercible2(this);
      var replacer = isObject2(searchValue) ? getMethod2(searchValue, REPLACE) : void 0;
      return replacer ? call2(replacer, searchValue, O2, replaceValue) : call2(nativeReplace, toString2(O2), searchValue, replaceValue);
    },
    // `RegExp.prototype[@@replace]` method
    // https://tc39.es/ecma262/#sec-regexp.prototype-@@replace
    function(string, replaceValue) {
      var rx = anObject2(this);
      var S = toString2(string);
      if (typeof replaceValue == "string" && stringIndexOf2(replaceValue, UNSAFE_SUBSTITUTE) === -1 && stringIndexOf2(replaceValue, "$<") === -1) {
        var res = maybeCallNative(nativeReplace, rx, S, replaceValue);
        if (res.done) return res.value;
      }
      var functionalReplace = isCallable(replaceValue);
      if (!functionalReplace) replaceValue = toString2(replaceValue);
      var flags = toString2(getRegExpFlags2(rx));
      var global2 = stringIndexOf2(flags, "g") !== -1;
      var fullUnicode;
      if (global2) {
        fullUnicode = stringIndexOf2(flags, "u") !== -1;
        rx.lastIndex = 0;
      }
      var results = [];
      var result;
      while (true) {
        result = regExpExec2(rx, S);
        if (result === null) break;
        push(results, result);
        if (!global2) break;
        var matchStr = toString2(result[0]);
        if (matchStr === "") rx.lastIndex = advanceStringIndex2(S, toLength2(rx.lastIndex), fullUnicode);
      }
      var accumulatedResult = "";
      var nextSourcePosition = 0;
      for (var i2 = 0; i2 < results.length; i2++) {
        result = results[i2];
        var matched = toString2(result[0]);
        var position = max(min(toIntegerOrInfinity(result.index), S.length), 0);
        var captures = [];
        var replacement;
        for (var j = 1; j < result.length; j++) push(captures, maybeToString(result[j]));
        var namedCaptures = result.groups;
        if (functionalReplace) {
          var replacerArgs = concat([matched], captures, position, S);
          if (namedCaptures !== void 0) push(replacerArgs, namedCaptures);
          replacement = toString2(apply(replaceValue, void 0, replacerArgs));
        } else {
          replacement = getSubstitution(matched, S, position, captures, namedCaptures, replaceValue);
        }
        if (position >= nextSourcePosition) {
          accumulatedResult += stringSlice(S, nextSourcePosition, position) + replacement;
          nextSourcePosition = position + matched.length;
        }
      }
      return accumulatedResult + stringSlice(S, nextSourcePosition);
    }
  ];
}, !REPLACE_SUPPORTS_NAMED_GROUPS || !REPLACE_KEEPS_$0 || REGEXP_REPLACE_SUBSTITUTES_UNDEFINED_CAPTURE);

// node_modules/core-js/modules/es.string.starts-with.js
var $ = require_export();
var uncurryThis3 = require_function_uncurry_this_clause();
var getOwnPropertyDescriptor = require_object_get_own_property_descriptor().f;
var toLength3 = require_to_length();
var toString3 = require_to_string();
var notARegExp = require_not_a_regexp();
var requireObjectCoercible3 = require_require_object_coercible();
var correctIsRegExpLogic = require_correct_is_regexp_logic();
var IS_PURE = require_is_pure();
var stringSlice2 = uncurryThis3("".slice);
var min2 = Math.min;
var CORRECT_IS_REGEXP_LOGIC = correctIsRegExpLogic("startsWith");
var MDN_POLYFILL_BUG = !IS_PURE && !CORRECT_IS_REGEXP_LOGIC && !!function() {
  var descriptor = getOwnPropertyDescriptor(String.prototype, "startsWith");
  return descriptor && !descriptor.writable;
}();
$({ target: "String", proto: true, forced: !MDN_POLYFILL_BUG && !CORRECT_IS_REGEXP_LOGIC }, {
  startsWith: function startsWith(searchString) {
    var that = toString3(requireObjectCoercible3(this));
    notARegExp(searchString);
    var index2 = toLength3(min2(arguments.length > 1 ? arguments[1] : void 0, that.length));
    var search = toString3(searchString);
    return stringSlice2(that, index2, index2 + search.length) === search;
  }
});

// node_modules/canvg/lib/index.es.js
var import_es_array_iterator = __toESM(require_es_array_iterator());

// node_modules/core-js/modules/web.dom-collections.iterator.js
var globalThis2 = require_global_this();
var DOMIterables = require_dom_iterables();
var DOMTokenListPrototype = require_dom_token_list_prototype();
var ArrayIteratorMethods = require_es_array_iterator();
var createNonEnumerableProperty = require_create_non_enumerable_property();
var setToStringTag = require_set_to_string_tag();
var wellKnownSymbol2 = require_well_known_symbol();
var ITERATOR = wellKnownSymbol2("iterator");
var ArrayValues = ArrayIteratorMethods.values;
var handlePrototype = function(CollectionPrototype, COLLECTION_NAME) {
  if (CollectionPrototype) {
    if (CollectionPrototype[ITERATOR] !== ArrayValues) try {
      createNonEnumerableProperty(CollectionPrototype, ITERATOR, ArrayValues);
    } catch (error) {
      CollectionPrototype[ITERATOR] = ArrayValues;
    }
    setToStringTag(CollectionPrototype, COLLECTION_NAME, true);
    if (DOMIterables[COLLECTION_NAME]) for (var METHOD_NAME in ArrayIteratorMethods) {
      if (CollectionPrototype[METHOD_NAME] !== ArrayIteratorMethods[METHOD_NAME]) try {
        createNonEnumerableProperty(CollectionPrototype, METHOD_NAME, ArrayIteratorMethods[METHOD_NAME]);
      } catch (error) {
        CollectionPrototype[METHOD_NAME] = ArrayIteratorMethods[METHOD_NAME];
      }
    }
  }
};
for (COLLECTION_NAME in DOMIterables) {
  handlePrototype(globalThis2[COLLECTION_NAME] && globalThis2[COLLECTION_NAME].prototype, COLLECTION_NAME);
}
var COLLECTION_NAME;
handlePrototype(DOMTokenListPrototype, "DOMTokenList");

// node_modules/core-js/modules/es.array.reduce.js
var $2 = require_export();
var $reduce = require_array_reduce().left;
var arrayMethodIsStrict = require_array_method_is_strict();
var CHROME_VERSION = require_environment_v8_version();
var IS_NODE = require_environment_is_node();
var CHROME_BUG = !IS_NODE && CHROME_VERSION > 79 && CHROME_VERSION < 83;
var FORCED = CHROME_BUG || !arrayMethodIsStrict("reduce");
$2({ target: "Array", proto: true, forced: FORCED }, {
  reduce: function reduce(callbackfn) {
    var length = arguments.length;
    return $reduce(this, callbackfn, length, length > 1 ? arguments[1] : void 0);
  }
});

// node_modules/core-js/modules/es.string.ends-with.js
var $3 = require_export();
var uncurryThis4 = require_function_uncurry_this_clause();
var getOwnPropertyDescriptor2 = require_object_get_own_property_descriptor().f;
var toLength4 = require_to_length();
var toString4 = require_to_string();
var notARegExp2 = require_not_a_regexp();
var requireObjectCoercible4 = require_require_object_coercible();
var correctIsRegExpLogic2 = require_correct_is_regexp_logic();
var IS_PURE2 = require_is_pure();
var slice = uncurryThis4("".slice);
var min3 = Math.min;
var CORRECT_IS_REGEXP_LOGIC2 = correctIsRegExpLogic2("endsWith");
var MDN_POLYFILL_BUG2 = !IS_PURE2 && !CORRECT_IS_REGEXP_LOGIC2 && !!function() {
  var descriptor = getOwnPropertyDescriptor2(String.prototype, "endsWith");
  return descriptor && !descriptor.writable;
}();
$3({ target: "String", proto: true, forced: !MDN_POLYFILL_BUG2 && !CORRECT_IS_REGEXP_LOGIC2 }, {
  endsWith: function endsWith(searchString) {
    var that = toString4(requireObjectCoercible4(this));
    notARegExp2(searchString);
    var endPosition = arguments.length > 1 ? arguments[1] : void 0;
    var len = that.length;
    var end = endPosition === void 0 ? len : min3(toLength4(endPosition), len);
    var search = toString4(searchString);
    return slice(that, end - search.length, end) === search;
  }
});

// node_modules/core-js/modules/es.string.split.js
var call3 = require_function_call();
var uncurryThis5 = require_function_uncurry_this();
var fixRegExpWellKnownSymbolLogic3 = require_fix_regexp_well_known_symbol_logic();
var anObject3 = require_an_object();
var isObject3 = require_is_object();
var requireObjectCoercible5 = require_require_object_coercible();
var speciesConstructor = require_species_constructor();
var advanceStringIndex3 = require_advance_string_index();
var toLength5 = require_to_length();
var toString5 = require_to_string();
var getMethod3 = require_get_method();
var regExpExec3 = require_regexp_exec_abstract();
var stickyHelpers = require_regexp_sticky_helpers();
var fails2 = require_fails();
var UNSUPPORTED_Y = stickyHelpers.UNSUPPORTED_Y;
var MAX_UINT32 = 4294967295;
var min4 = Math.min;
var push2 = uncurryThis5([].push);
var stringSlice3 = uncurryThis5("".slice);
var SPLIT_WORKS_WITH_OVERWRITTEN_EXEC = !fails2(function() {
  var re = /(?:)/;
  var originalExec = re.exec;
  re.exec = function() {
    return originalExec.apply(this, arguments);
  };
  var result = "ab".split(re);
  return result.length !== 2 || result[0] !== "a" || result[1] !== "b";
});
var BUGGY = "abbc".split(/(b)*/)[1] === "c" || // eslint-disable-next-line regexp/no-empty-group -- required for testing
"test".split(/(?:)/, -1).length !== 4 || "ab".split(/(?:ab)*/).length !== 2 || ".".split(/(.?)(.?)/).length !== 4 || // eslint-disable-next-line regexp/no-empty-capturing-group, regexp/no-empty-group -- required for testing
".".split(/()()/).length > 1 || "".split(/.?/).length;
fixRegExpWellKnownSymbolLogic3("split", function(SPLIT, nativeSplit, maybeCallNative) {
  var internalSplit = "0".split(void 0, 0).length ? function(separator, limit) {
    return separator === void 0 && limit === 0 ? [] : call3(nativeSplit, this, separator, limit);
  } : nativeSplit;
  return [
    // `String.prototype.split` method
    // https://tc39.es/ecma262/#sec-string.prototype.split
    function split(separator, limit) {
      var O2 = requireObjectCoercible5(this);
      var splitter = isObject3(separator) ? getMethod3(separator, SPLIT) : void 0;
      return splitter ? call3(splitter, separator, O2, limit) : call3(internalSplit, toString5(O2), separator, limit);
    },
    // `RegExp.prototype[@@split]` method
    // https://tc39.es/ecma262/#sec-regexp.prototype-@@split
    //
    // NOTE: This cannot be properly polyfilled in engines that don't support
    // the 'y' flag.
    function(string, limit) {
      var rx = anObject3(this);
      var S = toString5(string);
      if (!BUGGY) {
        var res = maybeCallNative(internalSplit, rx, S, limit, internalSplit !== nativeSplit);
        if (res.done) return res.value;
      }
      var C = speciesConstructor(rx, RegExp);
      var unicodeMatching = rx.unicode;
      var flags = (rx.ignoreCase ? "i" : "") + (rx.multiline ? "m" : "") + (rx.unicode ? "u" : "") + (UNSUPPORTED_Y ? "g" : "y");
      var splitter = new C(UNSUPPORTED_Y ? "^(?:" + rx.source + ")" : rx, flags);
      var lim = limit === void 0 ? MAX_UINT32 : limit >>> 0;
      if (lim === 0) return [];
      if (S.length === 0) return regExpExec3(splitter, S) === null ? [S] : [];
      var p2 = 0;
      var q = 0;
      var A = [];
      while (q < S.length) {
        splitter.lastIndex = UNSUPPORTED_Y ? 0 : q;
        var z = regExpExec3(splitter, UNSUPPORTED_Y ? stringSlice3(S, q) : S);
        var e2;
        if (z === null || (e2 = min4(toLength5(splitter.lastIndex + (UNSUPPORTED_Y ? q : 0)), S.length)) === p2) {
          q = advanceStringIndex3(S, q, unicodeMatching);
        } else {
          push2(A, stringSlice3(S, p2, q));
          if (A.length === lim) return A;
          for (var i2 = 1; i2 <= z.length - 1; i2++) {
            push2(A, z[i2]);
            if (A.length === lim) return A;
          }
          q = p2 = e2;
        }
      }
      push2(A, stringSlice3(S, p2));
      return A;
    }
  ];
}, BUGGY || !SPLIT_WORKS_WITH_OVERWRITTEN_EXEC, UNSUPPORTED_Y);

// node_modules/canvg/lib/index.es.js
var import_raf = __toESM(require_raf());

// node_modules/core-js/modules/es.string.trim.js
var $4 = require_export();
var $trim = require_string_trim().trim;
var forcedStringTrimMethod = require_string_trim_forced();
$4({ target: "String", proto: true, forced: forcedStringTrimMethod("trim") }, {
  trim: function trim() {
    return $trim(this);
  }
});

// node_modules/canvg/lib/index.es.js
var import_rgbcolor = __toESM(require_rgbcolor());

// node_modules/core-js/modules/es.array.index-of.js
var $5 = require_export();
var uncurryThis6 = require_function_uncurry_this_clause();
var $indexOf = require_array_includes().indexOf;
var arrayMethodIsStrict2 = require_array_method_is_strict();
var nativeIndexOf = uncurryThis6([].indexOf);
var NEGATIVE_ZERO = !!nativeIndexOf && 1 / nativeIndexOf([1], 1, -0) < 0;
var FORCED2 = NEGATIVE_ZERO || !arrayMethodIsStrict2("indexOf");
$5({ target: "Array", proto: true, forced: FORCED2 }, {
  indexOf: function indexOf(searchElement) {
    var fromIndex = arguments.length > 1 ? arguments[1] : void 0;
    return NEGATIVE_ZERO ? nativeIndexOf(this, searchElement, fromIndex) || 0 : $indexOf(this, searchElement, fromIndex);
  }
});

// node_modules/core-js/modules/es.string.includes.js
var $6 = require_export();
var uncurryThis7 = require_function_uncurry_this();
var notARegExp3 = require_not_a_regexp();
var requireObjectCoercible6 = require_require_object_coercible();
var toString6 = require_to_string();
var correctIsRegExpLogic3 = require_correct_is_regexp_logic();
var stringIndexOf3 = uncurryThis7("".indexOf);
$6({ target: "String", proto: true, forced: !correctIsRegExpLogic3("includes") }, {
  includes: function includes(searchString) {
    return !!~stringIndexOf3(
      toString6(requireObjectCoercible6(this)),
      toString6(notARegExp3(searchString)),
      arguments.length > 1 ? arguments[1] : void 0
    );
  }
});

// node_modules/core-js/modules/es.array.reverse.js
var $7 = require_export();
var uncurryThis8 = require_function_uncurry_this();
var isArray = require_is_array();
var nativeReverse = uncurryThis8([].reverse);
var test = [1, 2];
$7({ target: "Array", proto: true, forced: String(test) === String(test.reverse()) }, {
  reverse: function reverse() {
    if (isArray(this)) this.length = this.length;
    return nativeReverse(this);
  }
});

// node_modules/svg-pathdata/lib/SVGPathData.module.js
var t = function(r2, e2) {
  return (t = Object.setPrototypeOf || { __proto__: [] } instanceof Array && function(t2, r3) {
    t2.__proto__ = r3;
  } || function(t2, r3) {
    for (var e3 in r3) Object.prototype.hasOwnProperty.call(r3, e3) && (t2[e3] = r3[e3]);
  })(r2, e2);
};
function r(r2, e2) {
  if ("function" != typeof e2 && null !== e2) throw new TypeError("Class extends value " + String(e2) + " is not a constructor or null");
  function i2() {
    this.constructor = r2;
  }
  t(r2, e2), r2.prototype = null === e2 ? Object.create(e2) : (i2.prototype = e2.prototype, new i2());
}
function e(t2) {
  var r2 = "";
  Array.isArray(t2) || (t2 = [t2]);
  for (var e2 = 0; e2 < t2.length; e2++) {
    var i2 = t2[e2];
    if (i2.type === _.CLOSE_PATH) r2 += "z";
    else if (i2.type === _.HORIZ_LINE_TO) r2 += (i2.relative ? "h" : "H") + i2.x;
    else if (i2.type === _.VERT_LINE_TO) r2 += (i2.relative ? "v" : "V") + i2.y;
    else if (i2.type === _.MOVE_TO) r2 += (i2.relative ? "m" : "M") + i2.x + " " + i2.y;
    else if (i2.type === _.LINE_TO) r2 += (i2.relative ? "l" : "L") + i2.x + " " + i2.y;
    else if (i2.type === _.CURVE_TO) r2 += (i2.relative ? "c" : "C") + i2.x1 + " " + i2.y1 + " " + i2.x2 + " " + i2.y2 + " " + i2.x + " " + i2.y;
    else if (i2.type === _.SMOOTH_CURVE_TO) r2 += (i2.relative ? "s" : "S") + i2.x2 + " " + i2.y2 + " " + i2.x + " " + i2.y;
    else if (i2.type === _.QUAD_TO) r2 += (i2.relative ? "q" : "Q") + i2.x1 + " " + i2.y1 + " " + i2.x + " " + i2.y;
    else if (i2.type === _.SMOOTH_QUAD_TO) r2 += (i2.relative ? "t" : "T") + i2.x + " " + i2.y;
    else {
      if (i2.type !== _.ARC) throw new Error('Unexpected command type "' + i2.type + '" at index ' + e2 + ".");
      r2 += (i2.relative ? "a" : "A") + i2.rX + " " + i2.rY + " " + i2.xRot + " " + +i2.lArcFlag + " " + +i2.sweepFlag + " " + i2.x + " " + i2.y;
    }
  }
  return r2;
}
function i(t2, r2) {
  var e2 = t2[0], i2 = t2[1];
  return [e2 * Math.cos(r2) - i2 * Math.sin(r2), e2 * Math.sin(r2) + i2 * Math.cos(r2)];
}
function a() {
  for (var t2 = [], r2 = 0; r2 < arguments.length; r2++) t2[r2] = arguments[r2];
  for (var e2 = 0; e2 < t2.length; e2++) if ("number" != typeof t2[e2]) throw new Error("assertNumbers arguments[" + e2 + "] is not a number. " + typeof t2[e2] + " == typeof " + t2[e2]);
  return true;
}
var n = Math.PI;
function o(t2, r2, e2) {
  t2.lArcFlag = 0 === t2.lArcFlag ? 0 : 1, t2.sweepFlag = 0 === t2.sweepFlag ? 0 : 1;
  var a2 = t2.rX, o2 = t2.rY, s2 = t2.x, u2 = t2.y;
  a2 = Math.abs(t2.rX), o2 = Math.abs(t2.rY);
  var h2 = i([(r2 - s2) / 2, (e2 - u2) / 2], -t2.xRot / 180 * n), c3 = h2[0], y2 = h2[1], p2 = Math.pow(c3, 2) / Math.pow(a2, 2) + Math.pow(y2, 2) / Math.pow(o2, 2);
  1 < p2 && (a2 *= Math.sqrt(p2), o2 *= Math.sqrt(p2)), t2.rX = a2, t2.rY = o2;
  var m3 = Math.pow(a2, 2) * Math.pow(y2, 2) + Math.pow(o2, 2) * Math.pow(c3, 2), O2 = (t2.lArcFlag !== t2.sweepFlag ? 1 : -1) * Math.sqrt(Math.max(0, (Math.pow(a2, 2) * Math.pow(o2, 2) - m3) / m3)), l2 = a2 * y2 / o2 * O2, T2 = -o2 * c3 / a2 * O2, v2 = i([l2, T2], t2.xRot / 180 * n);
  t2.cX = v2[0] + (r2 + s2) / 2, t2.cY = v2[1] + (e2 + u2) / 2, t2.phi1 = Math.atan2((y2 - T2) / o2, (c3 - l2) / a2), t2.phi2 = Math.atan2((-y2 - T2) / o2, (-c3 - l2) / a2), 0 === t2.sweepFlag && t2.phi2 > t2.phi1 && (t2.phi2 -= 2 * n), 1 === t2.sweepFlag && t2.phi2 < t2.phi1 && (t2.phi2 += 2 * n), t2.phi1 *= 180 / n, t2.phi2 *= 180 / n;
}
function s(t2, r2, e2) {
  a(t2, r2, e2);
  var i2 = t2 * t2 + r2 * r2 - e2 * e2;
  if (0 > i2) return [];
  if (0 === i2) return [[t2 * e2 / (t2 * t2 + r2 * r2), r2 * e2 / (t2 * t2 + r2 * r2)]];
  var n2 = Math.sqrt(i2);
  return [[(t2 * e2 + r2 * n2) / (t2 * t2 + r2 * r2), (r2 * e2 - t2 * n2) / (t2 * t2 + r2 * r2)], [(t2 * e2 - r2 * n2) / (t2 * t2 + r2 * r2), (r2 * e2 + t2 * n2) / (t2 * t2 + r2 * r2)]];
}
var u;
var h = Math.PI / 180;
function c(t2, r2, e2) {
  return (1 - e2) * t2 + e2 * r2;
}
function y(t2, r2, e2, i2) {
  return t2 + Math.cos(i2 / 180 * n) * r2 + Math.sin(i2 / 180 * n) * e2;
}
function p(t2, r2, e2, i2) {
  var a2 = 1e-6, n2 = r2 - t2, o2 = e2 - r2, s2 = 3 * n2 + 3 * (i2 - e2) - 6 * o2, u2 = 6 * (o2 - n2), h2 = 3 * n2;
  return Math.abs(s2) < a2 ? [-h2 / u2] : function(t3, r3, e3) {
    void 0 === e3 && (e3 = 1e-6);
    var i3 = t3 * t3 / 4 - r3;
    if (i3 < -e3) return [];
    if (i3 <= e3) return [-t3 / 2];
    var a3 = Math.sqrt(i3);
    return [-t3 / 2 - a3, -t3 / 2 + a3];
  }(u2 / s2, h2 / s2, a2);
}
function m(t2, r2, e2, i2, a2) {
  var n2 = 1 - a2;
  return t2 * (n2 * n2 * n2) + r2 * (3 * n2 * n2 * a2) + e2 * (3 * n2 * a2 * a2) + i2 * (a2 * a2 * a2);
}
!function(t2) {
  function r2() {
    return u2(function(t3, r3, e3) {
      return t3.relative && (void 0 !== t3.x1 && (t3.x1 += r3), void 0 !== t3.y1 && (t3.y1 += e3), void 0 !== t3.x2 && (t3.x2 += r3), void 0 !== t3.y2 && (t3.y2 += e3), void 0 !== t3.x && (t3.x += r3), void 0 !== t3.y && (t3.y += e3), t3.relative = false), t3;
    });
  }
  function e2() {
    var t3 = NaN, r3 = NaN, e3 = NaN, i2 = NaN;
    return u2(function(a2, n3, o2) {
      return a2.type & _.SMOOTH_CURVE_TO && (a2.type = _.CURVE_TO, t3 = isNaN(t3) ? n3 : t3, r3 = isNaN(r3) ? o2 : r3, a2.x1 = a2.relative ? n3 - t3 : 2 * n3 - t3, a2.y1 = a2.relative ? o2 - r3 : 2 * o2 - r3), a2.type & _.CURVE_TO ? (t3 = a2.relative ? n3 + a2.x2 : a2.x2, r3 = a2.relative ? o2 + a2.y2 : a2.y2) : (t3 = NaN, r3 = NaN), a2.type & _.SMOOTH_QUAD_TO && (a2.type = _.QUAD_TO, e3 = isNaN(e3) ? n3 : e3, i2 = isNaN(i2) ? o2 : i2, a2.x1 = a2.relative ? n3 - e3 : 2 * n3 - e3, a2.y1 = a2.relative ? o2 - i2 : 2 * o2 - i2), a2.type & _.QUAD_TO ? (e3 = a2.relative ? n3 + a2.x1 : a2.x1, i2 = a2.relative ? o2 + a2.y1 : a2.y1) : (e3 = NaN, i2 = NaN), a2;
    });
  }
  function n2() {
    var t3 = NaN, r3 = NaN;
    return u2(function(e3, i2, a2) {
      if (e3.type & _.SMOOTH_QUAD_TO && (e3.type = _.QUAD_TO, t3 = isNaN(t3) ? i2 : t3, r3 = isNaN(r3) ? a2 : r3, e3.x1 = e3.relative ? i2 - t3 : 2 * i2 - t3, e3.y1 = e3.relative ? a2 - r3 : 2 * a2 - r3), e3.type & _.QUAD_TO) {
        t3 = e3.relative ? i2 + e3.x1 : e3.x1, r3 = e3.relative ? a2 + e3.y1 : e3.y1;
        var n3 = e3.x1, o2 = e3.y1;
        e3.type = _.CURVE_TO, e3.x1 = ((e3.relative ? 0 : i2) + 2 * n3) / 3, e3.y1 = ((e3.relative ? 0 : a2) + 2 * o2) / 3, e3.x2 = (e3.x + 2 * n3) / 3, e3.y2 = (e3.y + 2 * o2) / 3;
      } else t3 = NaN, r3 = NaN;
      return e3;
    });
  }
  function u2(t3) {
    var r3 = 0, e3 = 0, i2 = NaN, a2 = NaN;
    return function(n3) {
      if (isNaN(i2) && !(n3.type & _.MOVE_TO)) throw new Error("path must start with moveto");
      var o2 = t3(n3, r3, e3, i2, a2);
      return n3.type & _.CLOSE_PATH && (r3 = i2, e3 = a2), void 0 !== n3.x && (r3 = n3.relative ? r3 + n3.x : n3.x), void 0 !== n3.y && (e3 = n3.relative ? e3 + n3.y : n3.y), n3.type & _.MOVE_TO && (i2 = r3, a2 = e3), o2;
    };
  }
  function O2(t3, r3, e3, i2, n3, o2) {
    return a(t3, r3, e3, i2, n3, o2), u2(function(a2, s2, u3, h2) {
      var c3 = a2.x1, y2 = a2.x2, p2 = a2.relative && !isNaN(h2), m3 = void 0 !== a2.x ? a2.x : p2 ? 0 : s2, O3 = void 0 !== a2.y ? a2.y : p2 ? 0 : u3;
      function l3(t4) {
        return t4 * t4;
      }
      a2.type & _.HORIZ_LINE_TO && 0 !== r3 && (a2.type = _.LINE_TO, a2.y = a2.relative ? 0 : u3), a2.type & _.VERT_LINE_TO && 0 !== e3 && (a2.type = _.LINE_TO, a2.x = a2.relative ? 0 : s2), void 0 !== a2.x && (a2.x = a2.x * t3 + O3 * e3 + (p2 ? 0 : n3)), void 0 !== a2.y && (a2.y = m3 * r3 + a2.y * i2 + (p2 ? 0 : o2)), void 0 !== a2.x1 && (a2.x1 = a2.x1 * t3 + a2.y1 * e3 + (p2 ? 0 : n3)), void 0 !== a2.y1 && (a2.y1 = c3 * r3 + a2.y1 * i2 + (p2 ? 0 : o2)), void 0 !== a2.x2 && (a2.x2 = a2.x2 * t3 + a2.y2 * e3 + (p2 ? 0 : n3)), void 0 !== a2.y2 && (a2.y2 = y2 * r3 + a2.y2 * i2 + (p2 ? 0 : o2));
      var T2 = t3 * i2 - r3 * e3;
      if (void 0 !== a2.xRot && (1 !== t3 || 0 !== r3 || 0 !== e3 || 1 !== i2)) if (0 === T2) delete a2.rX, delete a2.rY, delete a2.xRot, delete a2.lArcFlag, delete a2.sweepFlag, a2.type = _.LINE_TO;
      else {
        var v2 = a2.xRot * Math.PI / 180, f2 = Math.sin(v2), N2 = Math.cos(v2), x = 1 / l3(a2.rX), d = 1 / l3(a2.rY), E = l3(N2) * x + l3(f2) * d, A = 2 * f2 * N2 * (x - d), C = l3(f2) * x + l3(N2) * d, M = E * i2 * i2 - A * r3 * i2 + C * r3 * r3, R = A * (t3 * i2 + r3 * e3) - 2 * (E * e3 * i2 + C * t3 * r3), g = E * e3 * e3 - A * t3 * e3 + C * t3 * t3, I = (Math.atan2(R, M - g) + Math.PI) % Math.PI / 2, S = Math.sin(I), L = Math.cos(I);
        a2.rX = Math.abs(T2) / Math.sqrt(M * l3(L) + R * S * L + g * l3(S)), a2.rY = Math.abs(T2) / Math.sqrt(M * l3(S) - R * S * L + g * l3(L)), a2.xRot = 180 * I / Math.PI;
      }
      return void 0 !== a2.sweepFlag && 0 > T2 && (a2.sweepFlag = +!a2.sweepFlag), a2;
    });
  }
  function l2() {
    return function(t3) {
      var r3 = {};
      for (var e3 in t3) r3[e3] = t3[e3];
      return r3;
    };
  }
  t2.ROUND = function(t3) {
    function r3(r4) {
      return Math.round(r4 * t3) / t3;
    }
    return void 0 === t3 && (t3 = 1e13), a(t3), function(t4) {
      return void 0 !== t4.x1 && (t4.x1 = r3(t4.x1)), void 0 !== t4.y1 && (t4.y1 = r3(t4.y1)), void 0 !== t4.x2 && (t4.x2 = r3(t4.x2)), void 0 !== t4.y2 && (t4.y2 = r3(t4.y2)), void 0 !== t4.x && (t4.x = r3(t4.x)), void 0 !== t4.y && (t4.y = r3(t4.y)), void 0 !== t4.rX && (t4.rX = r3(t4.rX)), void 0 !== t4.rY && (t4.rY = r3(t4.rY)), t4;
    };
  }, t2.TO_ABS = r2, t2.TO_REL = function() {
    return u2(function(t3, r3, e3) {
      return t3.relative || (void 0 !== t3.x1 && (t3.x1 -= r3), void 0 !== t3.y1 && (t3.y1 -= e3), void 0 !== t3.x2 && (t3.x2 -= r3), void 0 !== t3.y2 && (t3.y2 -= e3), void 0 !== t3.x && (t3.x -= r3), void 0 !== t3.y && (t3.y -= e3), t3.relative = true), t3;
    });
  }, t2.NORMALIZE_HVZ = function(t3, r3, e3) {
    return void 0 === t3 && (t3 = true), void 0 === r3 && (r3 = true), void 0 === e3 && (e3 = true), u2(function(i2, a2, n3, o2, s2) {
      if (isNaN(o2) && !(i2.type & _.MOVE_TO)) throw new Error("path must start with moveto");
      return r3 && i2.type & _.HORIZ_LINE_TO && (i2.type = _.LINE_TO, i2.y = i2.relative ? 0 : n3), e3 && i2.type & _.VERT_LINE_TO && (i2.type = _.LINE_TO, i2.x = i2.relative ? 0 : a2), t3 && i2.type & _.CLOSE_PATH && (i2.type = _.LINE_TO, i2.x = i2.relative ? o2 - a2 : o2, i2.y = i2.relative ? s2 - n3 : s2), i2.type & _.ARC && (0 === i2.rX || 0 === i2.rY) && (i2.type = _.LINE_TO, delete i2.rX, delete i2.rY, delete i2.xRot, delete i2.lArcFlag, delete i2.sweepFlag), i2;
    });
  }, t2.NORMALIZE_ST = e2, t2.QT_TO_C = n2, t2.INFO = u2, t2.SANITIZE = function(t3) {
    void 0 === t3 && (t3 = 0), a(t3);
    var r3 = NaN, e3 = NaN, i2 = NaN, n3 = NaN;
    return u2(function(a2, o2, s2, u3, h2) {
      var c3 = Math.abs, y2 = false, p2 = 0, m3 = 0;
      if (a2.type & _.SMOOTH_CURVE_TO && (p2 = isNaN(r3) ? 0 : o2 - r3, m3 = isNaN(e3) ? 0 : s2 - e3), a2.type & (_.CURVE_TO | _.SMOOTH_CURVE_TO) ? (r3 = a2.relative ? o2 + a2.x2 : a2.x2, e3 = a2.relative ? s2 + a2.y2 : a2.y2) : (r3 = NaN, e3 = NaN), a2.type & _.SMOOTH_QUAD_TO ? (i2 = isNaN(i2) ? o2 : 2 * o2 - i2, n3 = isNaN(n3) ? s2 : 2 * s2 - n3) : a2.type & _.QUAD_TO ? (i2 = a2.relative ? o2 + a2.x1 : a2.x1, n3 = a2.relative ? s2 + a2.y1 : a2.y2) : (i2 = NaN, n3 = NaN), a2.type & _.LINE_COMMANDS || a2.type & _.ARC && (0 === a2.rX || 0 === a2.rY || !a2.lArcFlag) || a2.type & _.CURVE_TO || a2.type & _.SMOOTH_CURVE_TO || a2.type & _.QUAD_TO || a2.type & _.SMOOTH_QUAD_TO) {
        var O3 = void 0 === a2.x ? 0 : a2.relative ? a2.x : a2.x - o2, l3 = void 0 === a2.y ? 0 : a2.relative ? a2.y : a2.y - s2;
        p2 = isNaN(i2) ? void 0 === a2.x1 ? p2 : a2.relative ? a2.x : a2.x1 - o2 : i2 - o2, m3 = isNaN(n3) ? void 0 === a2.y1 ? m3 : a2.relative ? a2.y : a2.y1 - s2 : n3 - s2;
        var T2 = void 0 === a2.x2 ? 0 : a2.relative ? a2.x : a2.x2 - o2, v2 = void 0 === a2.y2 ? 0 : a2.relative ? a2.y : a2.y2 - s2;
        c3(O3) <= t3 && c3(l3) <= t3 && c3(p2) <= t3 && c3(m3) <= t3 && c3(T2) <= t3 && c3(v2) <= t3 && (y2 = true);
      }
      return a2.type & _.CLOSE_PATH && c3(o2 - u3) <= t3 && c3(s2 - h2) <= t3 && (y2 = true), y2 ? [] : a2;
    });
  }, t2.MATRIX = O2, t2.ROTATE = function(t3, r3, e3) {
    void 0 === r3 && (r3 = 0), void 0 === e3 && (e3 = 0), a(t3, r3, e3);
    var i2 = Math.sin(t3), n3 = Math.cos(t3);
    return O2(n3, i2, -i2, n3, r3 - r3 * n3 + e3 * i2, e3 - r3 * i2 - e3 * n3);
  }, t2.TRANSLATE = function(t3, r3) {
    return void 0 === r3 && (r3 = 0), a(t3, r3), O2(1, 0, 0, 1, t3, r3);
  }, t2.SCALE = function(t3, r3) {
    return void 0 === r3 && (r3 = t3), a(t3, r3), O2(t3, 0, 0, r3, 0, 0);
  }, t2.SKEW_X = function(t3) {
    return a(t3), O2(1, 0, Math.atan(t3), 1, 0, 0);
  }, t2.SKEW_Y = function(t3) {
    return a(t3), O2(1, Math.atan(t3), 0, 1, 0, 0);
  }, t2.X_AXIS_SYMMETRY = function(t3) {
    return void 0 === t3 && (t3 = 0), a(t3), O2(-1, 0, 0, 1, t3, 0);
  }, t2.Y_AXIS_SYMMETRY = function(t3) {
    return void 0 === t3 && (t3 = 0), a(t3), O2(1, 0, 0, -1, 0, t3);
  }, t2.A_TO_C = function() {
    return u2(function(t3, r3, e3) {
      return _.ARC === t3.type ? function(t4, r4, e4) {
        var a2, n3, s2, u3;
        t4.cX || o(t4, r4, e4);
        for (var y2 = Math.min(t4.phi1, t4.phi2), p2 = Math.max(t4.phi1, t4.phi2) - y2, m3 = Math.ceil(p2 / 90), O3 = new Array(m3), l3 = r4, T2 = e4, v2 = 0; v2 < m3; v2++) {
          var f2 = c(t4.phi1, t4.phi2, v2 / m3), N2 = c(t4.phi1, t4.phi2, (v2 + 1) / m3), x = N2 - f2, d = 4 / 3 * Math.tan(x * h / 4), E = [Math.cos(f2 * h) - d * Math.sin(f2 * h), Math.sin(f2 * h) + d * Math.cos(f2 * h)], A = E[0], C = E[1], M = [Math.cos(N2 * h), Math.sin(N2 * h)], R = M[0], g = M[1], I = [R + d * Math.sin(N2 * h), g - d * Math.cos(N2 * h)], S = I[0], L = I[1];
          O3[v2] = { relative: t4.relative, type: _.CURVE_TO };
          var H = function(r5, e5) {
            var a3 = i([r5 * t4.rX, e5 * t4.rY], t4.xRot), n4 = a3[0], o2 = a3[1];
            return [t4.cX + n4, t4.cY + o2];
          };
          a2 = H(A, C), O3[v2].x1 = a2[0], O3[v2].y1 = a2[1], n3 = H(S, L), O3[v2].x2 = n3[0], O3[v2].y2 = n3[1], s2 = H(R, g), O3[v2].x = s2[0], O3[v2].y = s2[1], t4.relative && (O3[v2].x1 -= l3, O3[v2].y1 -= T2, O3[v2].x2 -= l3, O3[v2].y2 -= T2, O3[v2].x -= l3, O3[v2].y -= T2), l3 = (u3 = [O3[v2].x, O3[v2].y])[0], T2 = u3[1];
        }
        return O3;
      }(t3, t3.relative ? 0 : r3, t3.relative ? 0 : e3) : t3;
    });
  }, t2.ANNOTATE_ARCS = function() {
    return u2(function(t3, r3, e3) {
      return t3.relative && (r3 = 0, e3 = 0), _.ARC === t3.type && o(t3, r3, e3), t3;
    });
  }, t2.CLONE = l2, t2.CALCULATE_BOUNDS = function() {
    var t3 = function(t4) {
      var r3 = {};
      for (var e3 in t4) r3[e3] = t4[e3];
      return r3;
    }, i2 = r2(), a2 = n2(), h2 = e2(), c3 = u2(function(r3, e3, n3) {
      var u3 = h2(a2(i2(t3(r3))));
      function O3(t4) {
        t4 > c3.maxX && (c3.maxX = t4), t4 < c3.minX && (c3.minX = t4);
      }
      function l3(t4) {
        t4 > c3.maxY && (c3.maxY = t4), t4 < c3.minY && (c3.minY = t4);
      }
      if (u3.type & _.DRAWING_COMMANDS && (O3(e3), l3(n3)), u3.type & _.HORIZ_LINE_TO && O3(u3.x), u3.type & _.VERT_LINE_TO && l3(u3.y), u3.type & _.LINE_TO && (O3(u3.x), l3(u3.y)), u3.type & _.CURVE_TO) {
        O3(u3.x), l3(u3.y);
        for (var T2 = 0, v2 = p(e3, u3.x1, u3.x2, u3.x); T2 < v2.length; T2++) {
          0 < (w = v2[T2]) && 1 > w && O3(m(e3, u3.x1, u3.x2, u3.x, w));
        }
        for (var f2 = 0, N2 = p(n3, u3.y1, u3.y2, u3.y); f2 < N2.length; f2++) {
          0 < (w = N2[f2]) && 1 > w && l3(m(n3, u3.y1, u3.y2, u3.y, w));
        }
      }
      if (u3.type & _.ARC) {
        O3(u3.x), l3(u3.y), o(u3, e3, n3);
        for (var x = u3.xRot / 180 * Math.PI, d = Math.cos(x) * u3.rX, E = Math.sin(x) * u3.rX, A = -Math.sin(x) * u3.rY, C = Math.cos(x) * u3.rY, M = u3.phi1 < u3.phi2 ? [u3.phi1, u3.phi2] : -180 > u3.phi2 ? [u3.phi2 + 360, u3.phi1 + 360] : [u3.phi2, u3.phi1], R = M[0], g = M[1], I = function(t4) {
          var r4 = t4[0], e4 = t4[1], i3 = 180 * Math.atan2(e4, r4) / Math.PI;
          return i3 < R ? i3 + 360 : i3;
        }, S = 0, L = s(A, -d, 0).map(I); S < L.length; S++) {
          (w = L[S]) > R && w < g && O3(y(u3.cX, d, A, w));
        }
        for (var H = 0, U = s(C, -E, 0).map(I); H < U.length; H++) {
          var w;
          (w = U[H]) > R && w < g && l3(y(u3.cY, E, C, w));
        }
      }
      return r3;
    });
    return c3.minX = 1 / 0, c3.maxX = -1 / 0, c3.minY = 1 / 0, c3.maxY = -1 / 0, c3;
  };
}(u || (u = {}));
var O;
var l = function() {
  function t2() {
  }
  return t2.prototype.round = function(t3) {
    return this.transform(u.ROUND(t3));
  }, t2.prototype.toAbs = function() {
    return this.transform(u.TO_ABS());
  }, t2.prototype.toRel = function() {
    return this.transform(u.TO_REL());
  }, t2.prototype.normalizeHVZ = function(t3, r2, e2) {
    return this.transform(u.NORMALIZE_HVZ(t3, r2, e2));
  }, t2.prototype.normalizeST = function() {
    return this.transform(u.NORMALIZE_ST());
  }, t2.prototype.qtToC = function() {
    return this.transform(u.QT_TO_C());
  }, t2.prototype.aToC = function() {
    return this.transform(u.A_TO_C());
  }, t2.prototype.sanitize = function(t3) {
    return this.transform(u.SANITIZE(t3));
  }, t2.prototype.translate = function(t3, r2) {
    return this.transform(u.TRANSLATE(t3, r2));
  }, t2.prototype.scale = function(t3, r2) {
    return this.transform(u.SCALE(t3, r2));
  }, t2.prototype.rotate = function(t3, r2, e2) {
    return this.transform(u.ROTATE(t3, r2, e2));
  }, t2.prototype.matrix = function(t3, r2, e2, i2, a2, n2) {
    return this.transform(u.MATRIX(t3, r2, e2, i2, a2, n2));
  }, t2.prototype.skewX = function(t3) {
    return this.transform(u.SKEW_X(t3));
  }, t2.prototype.skewY = function(t3) {
    return this.transform(u.SKEW_Y(t3));
  }, t2.prototype.xSymmetry = function(t3) {
    return this.transform(u.X_AXIS_SYMMETRY(t3));
  }, t2.prototype.ySymmetry = function(t3) {
    return this.transform(u.Y_AXIS_SYMMETRY(t3));
  }, t2.prototype.annotateArcs = function() {
    return this.transform(u.ANNOTATE_ARCS());
  }, t2;
}();
var T = function(t2) {
  return " " === t2 || "	" === t2 || "\r" === t2 || "\n" === t2;
};
var v = function(t2) {
  return "0".charCodeAt(0) <= t2.charCodeAt(0) && t2.charCodeAt(0) <= "9".charCodeAt(0);
};
var f = function(t2) {
  function e2() {
    var r2 = t2.call(this) || this;
    return r2.curNumber = "", r2.curCommandType = -1, r2.curCommandRelative = false, r2.canParseCommandOrComma = true, r2.curNumberHasExp = false, r2.curNumberHasExpDigits = false, r2.curNumberHasDecimal = false, r2.curArgs = [], r2;
  }
  return r(e2, t2), e2.prototype.finish = function(t3) {
    if (void 0 === t3 && (t3 = []), this.parse(" ", t3), 0 !== this.curArgs.length || !this.canParseCommandOrComma) throw new SyntaxError("Unterminated command at the path end.");
    return t3;
  }, e2.prototype.parse = function(t3, r2) {
    var e3 = this;
    void 0 === r2 && (r2 = []);
    for (var i2 = function(t4) {
      r2.push(t4), e3.curArgs.length = 0, e3.canParseCommandOrComma = true;
    }, a2 = 0; a2 < t3.length; a2++) {
      var n2 = t3[a2], o2 = !(this.curCommandType !== _.ARC || 3 !== this.curArgs.length && 4 !== this.curArgs.length || 1 !== this.curNumber.length || "0" !== this.curNumber && "1" !== this.curNumber), s2 = v(n2) && ("0" === this.curNumber && "0" === n2 || o2);
      if (!v(n2) || s2) if ("e" !== n2 && "E" !== n2) if ("-" !== n2 && "+" !== n2 || !this.curNumberHasExp || this.curNumberHasExpDigits) if ("." !== n2 || this.curNumberHasExp || this.curNumberHasDecimal || o2) {
        if (this.curNumber && -1 !== this.curCommandType) {
          var u2 = Number(this.curNumber);
          if (isNaN(u2)) throw new SyntaxError("Invalid number ending at " + a2);
          if (this.curCommandType === _.ARC) {
            if (0 === this.curArgs.length || 1 === this.curArgs.length) {
              if (0 > u2) throw new SyntaxError('Expected positive number, got "' + u2 + '" at index "' + a2 + '"');
            } else if ((3 === this.curArgs.length || 4 === this.curArgs.length) && "0" !== this.curNumber && "1" !== this.curNumber) throw new SyntaxError('Expected a flag, got "' + this.curNumber + '" at index "' + a2 + '"');
          }
          this.curArgs.push(u2), this.curArgs.length === N[this.curCommandType] && (_.HORIZ_LINE_TO === this.curCommandType ? i2({ type: _.HORIZ_LINE_TO, relative: this.curCommandRelative, x: u2 }) : _.VERT_LINE_TO === this.curCommandType ? i2({ type: _.VERT_LINE_TO, relative: this.curCommandRelative, y: u2 }) : this.curCommandType === _.MOVE_TO || this.curCommandType === _.LINE_TO || this.curCommandType === _.SMOOTH_QUAD_TO ? (i2({ type: this.curCommandType, relative: this.curCommandRelative, x: this.curArgs[0], y: this.curArgs[1] }), _.MOVE_TO === this.curCommandType && (this.curCommandType = _.LINE_TO)) : this.curCommandType === _.CURVE_TO ? i2({ type: _.CURVE_TO, relative: this.curCommandRelative, x1: this.curArgs[0], y1: this.curArgs[1], x2: this.curArgs[2], y2: this.curArgs[3], x: this.curArgs[4], y: this.curArgs[5] }) : this.curCommandType === _.SMOOTH_CURVE_TO ? i2({ type: _.SMOOTH_CURVE_TO, relative: this.curCommandRelative, x2: this.curArgs[0], y2: this.curArgs[1], x: this.curArgs[2], y: this.curArgs[3] }) : this.curCommandType === _.QUAD_TO ? i2({ type: _.QUAD_TO, relative: this.curCommandRelative, x1: this.curArgs[0], y1: this.curArgs[1], x: this.curArgs[2], y: this.curArgs[3] }) : this.curCommandType === _.ARC && i2({ type: _.ARC, relative: this.curCommandRelative, rX: this.curArgs[0], rY: this.curArgs[1], xRot: this.curArgs[2], lArcFlag: this.curArgs[3], sweepFlag: this.curArgs[4], x: this.curArgs[5], y: this.curArgs[6] })), this.curNumber = "", this.curNumberHasExpDigits = false, this.curNumberHasExp = false, this.curNumberHasDecimal = false, this.canParseCommandOrComma = true;
        }
        if (!T(n2)) if ("," === n2 && this.canParseCommandOrComma) this.canParseCommandOrComma = false;
        else if ("+" !== n2 && "-" !== n2 && "." !== n2) if (s2) this.curNumber = n2, this.curNumberHasDecimal = false;
        else {
          if (0 !== this.curArgs.length) throw new SyntaxError("Unterminated command at index " + a2 + ".");
          if (!this.canParseCommandOrComma) throw new SyntaxError('Unexpected character "' + n2 + '" at index ' + a2 + ". Command cannot follow comma");
          if (this.canParseCommandOrComma = false, "z" !== n2 && "Z" !== n2) if ("h" === n2 || "H" === n2) this.curCommandType = _.HORIZ_LINE_TO, this.curCommandRelative = "h" === n2;
          else if ("v" === n2 || "V" === n2) this.curCommandType = _.VERT_LINE_TO, this.curCommandRelative = "v" === n2;
          else if ("m" === n2 || "M" === n2) this.curCommandType = _.MOVE_TO, this.curCommandRelative = "m" === n2;
          else if ("l" === n2 || "L" === n2) this.curCommandType = _.LINE_TO, this.curCommandRelative = "l" === n2;
          else if ("c" === n2 || "C" === n2) this.curCommandType = _.CURVE_TO, this.curCommandRelative = "c" === n2;
          else if ("s" === n2 || "S" === n2) this.curCommandType = _.SMOOTH_CURVE_TO, this.curCommandRelative = "s" === n2;
          else if ("q" === n2 || "Q" === n2) this.curCommandType = _.QUAD_TO, this.curCommandRelative = "q" === n2;
          else if ("t" === n2 || "T" === n2) this.curCommandType = _.SMOOTH_QUAD_TO, this.curCommandRelative = "t" === n2;
          else {
            if ("a" !== n2 && "A" !== n2) throw new SyntaxError('Unexpected character "' + n2 + '" at index ' + a2 + ".");
            this.curCommandType = _.ARC, this.curCommandRelative = "a" === n2;
          }
          else r2.push({ type: _.CLOSE_PATH }), this.canParseCommandOrComma = true, this.curCommandType = -1;
        }
        else this.curNumber = n2, this.curNumberHasDecimal = "." === n2;
      } else this.curNumber += n2, this.curNumberHasDecimal = true;
      else this.curNumber += n2;
      else this.curNumber += n2, this.curNumberHasExp = true;
      else this.curNumber += n2, this.curNumberHasExpDigits = this.curNumberHasExp;
    }
    return r2;
  }, e2.prototype.transform = function(t3) {
    return Object.create(this, { parse: { value: function(r2, e3) {
      void 0 === e3 && (e3 = []);
      for (var i2 = 0, a2 = Object.getPrototypeOf(this).parse.call(this, r2); i2 < a2.length; i2++) {
        var n2 = a2[i2], o2 = t3(n2);
        Array.isArray(o2) ? e3.push.apply(e3, o2) : e3.push(o2);
      }
      return e3;
    } } });
  }, e2;
}(l);
var _ = function(t2) {
  function i2(r2) {
    var e2 = t2.call(this) || this;
    return e2.commands = "string" == typeof r2 ? i2.parse(r2) : r2, e2;
  }
  return r(i2, t2), i2.prototype.encode = function() {
    return i2.encode(this.commands);
  }, i2.prototype.getBounds = function() {
    var t3 = u.CALCULATE_BOUNDS();
    return this.transform(t3), t3;
  }, i2.prototype.transform = function(t3) {
    for (var r2 = [], e2 = 0, i3 = this.commands; e2 < i3.length; e2++) {
      var a2 = t3(i3[e2]);
      Array.isArray(a2) ? r2.push.apply(r2, a2) : r2.push(a2);
    }
    return this.commands = r2, this;
  }, i2.encode = function(t3) {
    return e(t3);
  }, i2.parse = function(t3) {
    var r2 = new f(), e2 = [];
    return r2.parse(t3, e2), r2.finish(e2), e2;
  }, i2.CLOSE_PATH = 1, i2.MOVE_TO = 2, i2.HORIZ_LINE_TO = 4, i2.VERT_LINE_TO = 8, i2.LINE_TO = 16, i2.CURVE_TO = 32, i2.SMOOTH_CURVE_TO = 64, i2.QUAD_TO = 128, i2.SMOOTH_QUAD_TO = 256, i2.ARC = 512, i2.LINE_COMMANDS = i2.LINE_TO | i2.HORIZ_LINE_TO | i2.VERT_LINE_TO, i2.DRAWING_COMMANDS = i2.HORIZ_LINE_TO | i2.VERT_LINE_TO | i2.LINE_TO | i2.CURVE_TO | i2.SMOOTH_CURVE_TO | i2.QUAD_TO | i2.SMOOTH_QUAD_TO | i2.ARC, i2;
}(l);
var N = ((O = {})[_.MOVE_TO] = 2, O[_.LINE_TO] = 2, O[_.HORIZ_LINE_TO] = 1, O[_.VERT_LINE_TO] = 1, O[_.CLOSE_PATH] = 0, O[_.QUAD_TO] = 4, O[_.SMOOTH_QUAD_TO] = 2, O[_.CURVE_TO] = 6, O[_.SMOOTH_CURVE_TO] = 4, O[_.ARC] = 7, O);

// node_modules/core-js/modules/es.regexp.to-string.js
var PROPER_FUNCTION_NAME = require_function_name().PROPER;
var defineBuiltIn = require_define_built_in();
var anObject4 = require_an_object();
var $toString = require_to_string();
var fails3 = require_fails();
var getRegExpFlags3 = require_regexp_get_flags();
var TO_STRING = "toString";
var RegExpPrototype = RegExp.prototype;
var nativeToString = RegExpPrototype[TO_STRING];
var NOT_GENERIC = fails3(function() {
  return nativeToString.call({ source: "a", flags: "b" }) !== "/a/b";
});
var INCORRECT_NAME = PROPER_FUNCTION_NAME && nativeToString.name !== TO_STRING;
if (NOT_GENERIC || INCORRECT_NAME) {
  defineBuiltIn(RegExpPrototype, TO_STRING, function toString7() {
    var R = anObject4(this);
    var pattern = $toString(R.source);
    var flags = $toString(getRegExpFlags3(R));
    return "/" + pattern + "/" + flags;
  }, { unsafe: true });
}

// node_modules/stackblur-canvas/dist/stackblur-es.js
function _typeof(obj) {
  "@babel/helpers - typeof";
  if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
    _typeof = function(obj2) {
      return typeof obj2;
    };
  } else {
    _typeof = function(obj2) {
      return obj2 && typeof Symbol === "function" && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
    };
  }
  return _typeof(obj);
}
function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}
var mulTable = [512, 512, 456, 512, 328, 456, 335, 512, 405, 328, 271, 456, 388, 335, 292, 512, 454, 405, 364, 328, 298, 271, 496, 456, 420, 388, 360, 335, 312, 292, 273, 512, 482, 454, 428, 405, 383, 364, 345, 328, 312, 298, 284, 271, 259, 496, 475, 456, 437, 420, 404, 388, 374, 360, 347, 335, 323, 312, 302, 292, 282, 273, 265, 512, 497, 482, 468, 454, 441, 428, 417, 405, 394, 383, 373, 364, 354, 345, 337, 328, 320, 312, 305, 298, 291, 284, 278, 271, 265, 259, 507, 496, 485, 475, 465, 456, 446, 437, 428, 420, 412, 404, 396, 388, 381, 374, 367, 360, 354, 347, 341, 335, 329, 323, 318, 312, 307, 302, 297, 292, 287, 282, 278, 273, 269, 265, 261, 512, 505, 497, 489, 482, 475, 468, 461, 454, 447, 441, 435, 428, 422, 417, 411, 405, 399, 394, 389, 383, 378, 373, 368, 364, 359, 354, 350, 345, 341, 337, 332, 328, 324, 320, 316, 312, 309, 305, 301, 298, 294, 291, 287, 284, 281, 278, 274, 271, 268, 265, 262, 259, 257, 507, 501, 496, 491, 485, 480, 475, 470, 465, 460, 456, 451, 446, 442, 437, 433, 428, 424, 420, 416, 412, 408, 404, 400, 396, 392, 388, 385, 381, 377, 374, 370, 367, 363, 360, 357, 354, 350, 347, 344, 341, 338, 335, 332, 329, 326, 323, 320, 318, 315, 312, 310, 307, 304, 302, 299, 297, 294, 292, 289, 287, 285, 282, 280, 278, 275, 273, 271, 269, 267, 265, 263, 261, 259];
var shgTable = [9, 11, 12, 13, 13, 14, 14, 15, 15, 15, 15, 16, 16, 16, 16, 17, 17, 17, 17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 22, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 23, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24, 24];
function getImageDataFromCanvas(canvas, topX, topY, width, height) {
  if (typeof canvas === "string") {
    canvas = document.getElementById(canvas);
  }
  if (!canvas || _typeof(canvas) !== "object" || !("getContext" in canvas)) {
    throw new TypeError("Expecting canvas with `getContext` method in processCanvasRGB(A) calls!");
  }
  var context = canvas.getContext("2d");
  try {
    return context.getImageData(topX, topY, width, height);
  } catch (e2) {
    throw new Error("unable to access image data: " + e2);
  }
}
function processCanvasRGBA(canvas, topX, topY, width, height, radius) {
  if (isNaN(radius) || radius < 1) {
    return;
  }
  radius |= 0;
  var imageData = getImageDataFromCanvas(canvas, topX, topY, width, height);
  imageData = processImageDataRGBA(imageData, topX, topY, width, height, radius);
  canvas.getContext("2d").putImageData(imageData, topX, topY);
}
function processImageDataRGBA(imageData, topX, topY, width, height, radius) {
  var pixels = imageData.data;
  var div = 2 * radius + 1;
  var widthMinus1 = width - 1;
  var heightMinus1 = height - 1;
  var radiusPlus1 = radius + 1;
  var sumFactor = radiusPlus1 * (radiusPlus1 + 1) / 2;
  var stackStart = new BlurStack();
  var stack = stackStart;
  var stackEnd;
  for (var i2 = 1; i2 < div; i2++) {
    stack = stack.next = new BlurStack();
    if (i2 === radiusPlus1) {
      stackEnd = stack;
    }
  }
  stack.next = stackStart;
  var stackIn = null, stackOut = null, yw = 0, yi = 0;
  var mulSum = mulTable[radius];
  var shgSum = shgTable[radius];
  for (var y2 = 0; y2 < height; y2++) {
    stack = stackStart;
    var pr = pixels[yi], pg = pixels[yi + 1], pb = pixels[yi + 2], pa = pixels[yi + 3];
    for (var _i = 0; _i < radiusPlus1; _i++) {
      stack.r = pr;
      stack.g = pg;
      stack.b = pb;
      stack.a = pa;
      stack = stack.next;
    }
    var rInSum = 0, gInSum = 0, bInSum = 0, aInSum = 0, rOutSum = radiusPlus1 * pr, gOutSum = radiusPlus1 * pg, bOutSum = radiusPlus1 * pb, aOutSum = radiusPlus1 * pa, rSum = sumFactor * pr, gSum = sumFactor * pg, bSum = sumFactor * pb, aSum = sumFactor * pa;
    for (var _i2 = 1; _i2 < radiusPlus1; _i2++) {
      var p2 = yi + ((widthMinus1 < _i2 ? widthMinus1 : _i2) << 2);
      var r2 = pixels[p2], g = pixels[p2 + 1], b = pixels[p2 + 2], a2 = pixels[p2 + 3];
      var rbs = radiusPlus1 - _i2;
      rSum += (stack.r = r2) * rbs;
      gSum += (stack.g = g) * rbs;
      bSum += (stack.b = b) * rbs;
      aSum += (stack.a = a2) * rbs;
      rInSum += r2;
      gInSum += g;
      bInSum += b;
      aInSum += a2;
      stack = stack.next;
    }
    stackIn = stackStart;
    stackOut = stackEnd;
    for (var x = 0; x < width; x++) {
      var paInitial = aSum * mulSum >>> shgSum;
      pixels[yi + 3] = paInitial;
      if (paInitial !== 0) {
        var _a2 = 255 / paInitial;
        pixels[yi] = (rSum * mulSum >>> shgSum) * _a2;
        pixels[yi + 1] = (gSum * mulSum >>> shgSum) * _a2;
        pixels[yi + 2] = (bSum * mulSum >>> shgSum) * _a2;
      } else {
        pixels[yi] = pixels[yi + 1] = pixels[yi + 2] = 0;
      }
      rSum -= rOutSum;
      gSum -= gOutSum;
      bSum -= bOutSum;
      aSum -= aOutSum;
      rOutSum -= stackIn.r;
      gOutSum -= stackIn.g;
      bOutSum -= stackIn.b;
      aOutSum -= stackIn.a;
      var _p = x + radius + 1;
      _p = yw + (_p < widthMinus1 ? _p : widthMinus1) << 2;
      rInSum += stackIn.r = pixels[_p];
      gInSum += stackIn.g = pixels[_p + 1];
      bInSum += stackIn.b = pixels[_p + 2];
      aInSum += stackIn.a = pixels[_p + 3];
      rSum += rInSum;
      gSum += gInSum;
      bSum += bInSum;
      aSum += aInSum;
      stackIn = stackIn.next;
      var _stackOut = stackOut, _r = _stackOut.r, _g = _stackOut.g, _b = _stackOut.b, _a = _stackOut.a;
      rOutSum += _r;
      gOutSum += _g;
      bOutSum += _b;
      aOutSum += _a;
      rInSum -= _r;
      gInSum -= _g;
      bInSum -= _b;
      aInSum -= _a;
      stackOut = stackOut.next;
      yi += 4;
    }
    yw += width;
  }
  for (var _x = 0; _x < width; _x++) {
    yi = _x << 2;
    var _pr = pixels[yi], _pg = pixels[yi + 1], _pb = pixels[yi + 2], _pa = pixels[yi + 3], _rOutSum = radiusPlus1 * _pr, _gOutSum = radiusPlus1 * _pg, _bOutSum = radiusPlus1 * _pb, _aOutSum = radiusPlus1 * _pa, _rSum = sumFactor * _pr, _gSum = sumFactor * _pg, _bSum = sumFactor * _pb, _aSum = sumFactor * _pa;
    stack = stackStart;
    for (var _i3 = 0; _i3 < radiusPlus1; _i3++) {
      stack.r = _pr;
      stack.g = _pg;
      stack.b = _pb;
      stack.a = _pa;
      stack = stack.next;
    }
    var yp = width;
    var _gInSum = 0, _bInSum = 0, _aInSum = 0, _rInSum = 0;
    for (var _i4 = 1; _i4 <= radius; _i4++) {
      yi = yp + _x << 2;
      var _rbs = radiusPlus1 - _i4;
      _rSum += (stack.r = _pr = pixels[yi]) * _rbs;
      _gSum += (stack.g = _pg = pixels[yi + 1]) * _rbs;
      _bSum += (stack.b = _pb = pixels[yi + 2]) * _rbs;
      _aSum += (stack.a = _pa = pixels[yi + 3]) * _rbs;
      _rInSum += _pr;
      _gInSum += _pg;
      _bInSum += _pb;
      _aInSum += _pa;
      stack = stack.next;
      if (_i4 < heightMinus1) {
        yp += width;
      }
    }
    yi = _x;
    stackIn = stackStart;
    stackOut = stackEnd;
    for (var _y = 0; _y < height; _y++) {
      var _p2 = yi << 2;
      pixels[_p2 + 3] = _pa = _aSum * mulSum >>> shgSum;
      if (_pa > 0) {
        _pa = 255 / _pa;
        pixels[_p2] = (_rSum * mulSum >>> shgSum) * _pa;
        pixels[_p2 + 1] = (_gSum * mulSum >>> shgSum) * _pa;
        pixels[_p2 + 2] = (_bSum * mulSum >>> shgSum) * _pa;
      } else {
        pixels[_p2] = pixels[_p2 + 1] = pixels[_p2 + 2] = 0;
      }
      _rSum -= _rOutSum;
      _gSum -= _gOutSum;
      _bSum -= _bOutSum;
      _aSum -= _aOutSum;
      _rOutSum -= stackIn.r;
      _gOutSum -= stackIn.g;
      _bOutSum -= stackIn.b;
      _aOutSum -= stackIn.a;
      _p2 = _x + ((_p2 = _y + radiusPlus1) < heightMinus1 ? _p2 : heightMinus1) * width << 2;
      _rSum += _rInSum += stackIn.r = pixels[_p2];
      _gSum += _gInSum += stackIn.g = pixels[_p2 + 1];
      _bSum += _bInSum += stackIn.b = pixels[_p2 + 2];
      _aSum += _aInSum += stackIn.a = pixels[_p2 + 3];
      stackIn = stackIn.next;
      _rOutSum += _pr = stackOut.r;
      _gOutSum += _pg = stackOut.g;
      _bOutSum += _pb = stackOut.b;
      _aOutSum += _pa = stackOut.a;
      _rInSum -= _pr;
      _gInSum -= _pg;
      _bInSum -= _pb;
      _aInSum -= _pa;
      stackOut = stackOut.next;
      yi += width;
    }
  }
  return imageData;
}
var BlurStack = (
  /**
   * Set properties.
   */
  function BlurStack2() {
    _classCallCheck(this, BlurStack2);
    this.r = 0;
    this.g = 0;
    this.b = 0;
    this.a = 0;
    this.next = null;
  }
);

// node_modules/canvg/lib/index.es.js
function offscreen() {
  var {
    DOMParser: DOMParserFallback
  } = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
  var preset = {
    window: null,
    ignoreAnimation: true,
    ignoreMouse: true,
    DOMParser: DOMParserFallback,
    createCanvas(width, height) {
      return new OffscreenCanvas(width, height);
    },
    createImage(url) {
      return _asyncToGenerator(function* () {
        var response = yield fetch(url);
        var blob = yield response.blob();
        var img = yield createImageBitmap(blob);
        return img;
      })();
    }
  };
  if (typeof DOMParser !== "undefined" || typeof DOMParserFallback === "undefined") {
    Reflect.deleteProperty(preset, "DOMParser");
  }
  return preset;
}
function node(_ref) {
  var {
    DOMParser: DOMParser2,
    canvas,
    fetch: fetch2
  } = _ref;
  return {
    window: null,
    ignoreAnimation: true,
    ignoreMouse: true,
    DOMParser: DOMParser2,
    fetch: fetch2,
    createCanvas: canvas.createCanvas,
    createImage: canvas.loadImage
  };
}
var index = Object.freeze({
  __proto__: null,
  offscreen,
  node
});
function compressSpaces(str) {
  return str.replace(/(?!\u3000)\s+/gm, " ");
}
function trimLeft(str) {
  return str.replace(/^[\n \t]+/, "");
}
function trimRight(str) {
  return str.replace(/[\n \t]+$/, "");
}
function toNumbers(str) {
  var matches = (str || "").match(/-?(\d+(?:\.\d*(?:[eE][+-]?\d+)?)?|\.\d+)(?=\D|$)/gm) || [];
  return matches.map(parseFloat);
}
var allUppercase = /^[A-Z-]+$/;
function normalizeAttributeName(name) {
  if (allUppercase.test(name)) {
    return name.toLowerCase();
  }
  return name;
}
function parseExternalUrl(url) {
  var urlMatch = /url\(('([^']+)'|"([^"]+)"|([^'")]+))\)/.exec(url) || [];
  return urlMatch[2] || urlMatch[3] || urlMatch[4];
}
function normalizeColor(color) {
  if (!color.startsWith("rgb")) {
    return color;
  }
  var rgbParts = 3;
  var normalizedColor = color.replace(/\d+(\.\d+)?/g, (num, isFloat) => rgbParts-- && isFloat ? String(Math.round(parseFloat(num))) : num);
  return normalizedColor;
}
var attributeRegex = /(\[[^\]]+\])/g;
var idRegex = /(#[^\s+>~.[:]+)/g;
var classRegex = /(\.[^\s+>~.[:]+)/g;
var pseudoElementRegex = /(::[^\s+>~.[:]+|:first-line|:first-letter|:before|:after)/gi;
var pseudoClassWithBracketsRegex = /(:[\w-]+\([^)]*\))/gi;
var pseudoClassRegex = /(:[^\s+>~.[:]+)/g;
var elementRegex = /([^\s+>~.[:]+)/g;
function findSelectorMatch(selector, regex) {
  var matches = regex.exec(selector);
  if (!matches) {
    return [selector, 0];
  }
  return [selector.replace(regex, " "), matches.length];
}
function getSelectorSpecificity(selector) {
  var specificity = [0, 0, 0];
  var currentSelector = selector.replace(/:not\(([^)]*)\)/g, "     $1 ").replace(/{[\s\S]*/gm, " ");
  var delta = 0;
  [currentSelector, delta] = findSelectorMatch(currentSelector, attributeRegex);
  specificity[1] += delta;
  [currentSelector, delta] = findSelectorMatch(currentSelector, idRegex);
  specificity[0] += delta;
  [currentSelector, delta] = findSelectorMatch(currentSelector, classRegex);
  specificity[1] += delta;
  [currentSelector, delta] = findSelectorMatch(currentSelector, pseudoElementRegex);
  specificity[2] += delta;
  [currentSelector, delta] = findSelectorMatch(currentSelector, pseudoClassWithBracketsRegex);
  specificity[1] += delta;
  [currentSelector, delta] = findSelectorMatch(currentSelector, pseudoClassRegex);
  specificity[1] += delta;
  currentSelector = currentSelector.replace(/[*\s+>~]/g, " ").replace(/[#.]/g, " ");
  [currentSelector, delta] = findSelectorMatch(currentSelector, elementRegex);
  specificity[2] += delta;
  return specificity.join("");
}
var PSEUDO_ZERO = 1e-8;
function vectorMagnitude(v2) {
  return Math.sqrt(Math.pow(v2[0], 2) + Math.pow(v2[1], 2));
}
function vectorsRatio(u2, v2) {
  return (u2[0] * v2[0] + u2[1] * v2[1]) / (vectorMagnitude(u2) * vectorMagnitude(v2));
}
function vectorsAngle(u2, v2) {
  return (u2[0] * v2[1] < u2[1] * v2[0] ? -1 : 1) * Math.acos(vectorsRatio(u2, v2));
}
function CB1(t2) {
  return t2 * t2 * t2;
}
function CB2(t2) {
  return 3 * t2 * t2 * (1 - t2);
}
function CB3(t2) {
  return 3 * t2 * (1 - t2) * (1 - t2);
}
function CB4(t2) {
  return (1 - t2) * (1 - t2) * (1 - t2);
}
function QB1(t2) {
  return t2 * t2;
}
function QB2(t2) {
  return 2 * t2 * (1 - t2);
}
function QB3(t2) {
  return (1 - t2) * (1 - t2);
}
var Property = class _Property {
  constructor(document2, name, value) {
    this.document = document2;
    this.name = name;
    this.value = value;
    this.isNormalizedColor = false;
  }
  static empty(document2) {
    return new _Property(document2, "EMPTY", "");
  }
  split() {
    var separator = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : " ";
    var {
      document: document2,
      name
    } = this;
    return compressSpaces(this.getString()).trim().split(separator).map((value) => new _Property(document2, name, value));
  }
  hasValue(zeroIsValue) {
    var {
      value
    } = this;
    return value !== null && value !== "" && (zeroIsValue || value !== 0) && typeof value !== "undefined";
  }
  isString(regexp) {
    var {
      value
    } = this;
    var result = typeof value === "string";
    if (!result || !regexp) {
      return result;
    }
    return regexp.test(value);
  }
  isUrlDefinition() {
    return this.isString(/^url\(/);
  }
  isPixels() {
    if (!this.hasValue()) {
      return false;
    }
    var asString = this.getString();
    switch (true) {
      case asString.endsWith("px"):
      case /^[0-9]+$/.test(asString):
        return true;
      default:
        return false;
    }
  }
  setValue(value) {
    this.value = value;
    return this;
  }
  getValue(def) {
    if (typeof def === "undefined" || this.hasValue()) {
      return this.value;
    }
    return def;
  }
  getNumber(def) {
    if (!this.hasValue()) {
      if (typeof def === "undefined") {
        return 0;
      }
      return parseFloat(def);
    }
    var {
      value
    } = this;
    var n2 = parseFloat(value);
    if (this.isString(/%$/)) {
      n2 /= 100;
    }
    return n2;
  }
  getString(def) {
    if (typeof def === "undefined" || this.hasValue()) {
      return typeof this.value === "undefined" ? "" : String(this.value);
    }
    return String(def);
  }
  getColor(def) {
    var color = this.getString(def);
    if (this.isNormalizedColor) {
      return color;
    }
    this.isNormalizedColor = true;
    color = normalizeColor(color);
    this.value = color;
    return color;
  }
  getDpi() {
    return 96;
  }
  getRem() {
    return this.document.rootEmSize;
  }
  getEm() {
    return this.document.emSize;
  }
  getUnits() {
    return this.getString().replace(/[0-9.-]/g, "");
  }
  getPixels(axisOrIsFontSize) {
    var processPercent = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;
    if (!this.hasValue()) {
      return 0;
    }
    var [axis, isFontSize] = typeof axisOrIsFontSize === "boolean" ? [void 0, axisOrIsFontSize] : [axisOrIsFontSize];
    var {
      viewPort
    } = this.document.screen;
    switch (true) {
      case this.isString(/vmin$/):
        return this.getNumber() / 100 * Math.min(viewPort.computeSize("x"), viewPort.computeSize("y"));
      case this.isString(/vmax$/):
        return this.getNumber() / 100 * Math.max(viewPort.computeSize("x"), viewPort.computeSize("y"));
      case this.isString(/vw$/):
        return this.getNumber() / 100 * viewPort.computeSize("x");
      case this.isString(/vh$/):
        return this.getNumber() / 100 * viewPort.computeSize("y");
      case this.isString(/rem$/):
        return this.getNumber() * this.getRem();
      case this.isString(/em$/):
        return this.getNumber() * this.getEm();
      case this.isString(/ex$/):
        return this.getNumber() * this.getEm() / 2;
      case this.isString(/px$/):
        return this.getNumber();
      case this.isString(/pt$/):
        return this.getNumber() * this.getDpi() * (1 / 72);
      case this.isString(/pc$/):
        return this.getNumber() * 15;
      case this.isString(/cm$/):
        return this.getNumber() * this.getDpi() / 2.54;
      case this.isString(/mm$/):
        return this.getNumber() * this.getDpi() / 25.4;
      case this.isString(/in$/):
        return this.getNumber() * this.getDpi();
      case (this.isString(/%$/) && isFontSize):
        return this.getNumber() * this.getEm();
      case this.isString(/%$/):
        return this.getNumber() * viewPort.computeSize(axis);
      default: {
        var n2 = this.getNumber();
        if (processPercent && n2 < 1) {
          return n2 * viewPort.computeSize(axis);
        }
        return n2;
      }
    }
  }
  getMilliseconds() {
    if (!this.hasValue()) {
      return 0;
    }
    if (this.isString(/ms$/)) {
      return this.getNumber();
    }
    return this.getNumber() * 1e3;
  }
  getRadians() {
    if (!this.hasValue()) {
      return 0;
    }
    switch (true) {
      case this.isString(/deg$/):
        return this.getNumber() * (Math.PI / 180);
      case this.isString(/grad$/):
        return this.getNumber() * (Math.PI / 200);
      case this.isString(/rad$/):
        return this.getNumber();
      default:
        return this.getNumber() * (Math.PI / 180);
    }
  }
  getDefinition() {
    var asString = this.getString();
    var name = /#([^)'"]+)/.exec(asString);
    if (name) {
      name = name[1];
    }
    if (!name) {
      name = asString;
    }
    return this.document.definitions[name];
  }
  getFillStyleDefinition(element, opacity) {
    var def = this.getDefinition();
    if (!def) {
      return null;
    }
    if (typeof def.createGradient === "function") {
      return def.createGradient(this.document.ctx, element, opacity);
    }
    if (typeof def.createPattern === "function") {
      if (def.getHrefAttribute().hasValue()) {
        var patternTransform = def.getAttribute("patternTransform");
        def = def.getHrefAttribute().getDefinition();
        if (patternTransform.hasValue()) {
          def.getAttribute("patternTransform", true).setValue(patternTransform.value);
        }
      }
      return def.createPattern(this.document.ctx, element, opacity);
    }
    return null;
  }
  getTextBaseline() {
    if (!this.hasValue()) {
      return null;
    }
    return _Property.textBaselineMapping[this.getString()];
  }
  addOpacity(opacity) {
    var value = this.getColor();
    var len = value.length;
    var commas = 0;
    for (var i2 = 0; i2 < len; i2++) {
      if (value[i2] === ",") {
        commas++;
      }
      if (commas === 3) {
        break;
      }
    }
    if (opacity.hasValue() && this.isString() && commas !== 3) {
      var color = new import_rgbcolor.default(value);
      if (color.ok) {
        color.alpha = opacity.getNumber();
        value = color.toRGBA();
      }
    }
    return new _Property(this.document, this.name, value);
  }
};
Property.textBaselineMapping = {
  "baseline": "alphabetic",
  "before-edge": "top",
  "text-before-edge": "top",
  "middle": "middle",
  "central": "middle",
  "after-edge": "bottom",
  "text-after-edge": "bottom",
  "ideographic": "ideographic",
  "alphabetic": "alphabetic",
  "hanging": "hanging",
  "mathematical": "alphabetic"
};
var ViewPort = class {
  constructor() {
    this.viewPorts = [];
  }
  clear() {
    this.viewPorts = [];
  }
  setCurrent(width, height) {
    this.viewPorts.push({
      width,
      height
    });
  }
  removeCurrent() {
    this.viewPorts.pop();
  }
  getCurrent() {
    var {
      viewPorts
    } = this;
    return viewPorts[viewPorts.length - 1];
  }
  get width() {
    return this.getCurrent().width;
  }
  get height() {
    return this.getCurrent().height;
  }
  computeSize(d) {
    if (typeof d === "number") {
      return d;
    }
    if (d === "x") {
      return this.width;
    }
    if (d === "y") {
      return this.height;
    }
    return Math.sqrt(Math.pow(this.width, 2) + Math.pow(this.height, 2)) / Math.sqrt(2);
  }
};
var Point = class _Point {
  constructor(x, y2) {
    this.x = x;
    this.y = y2;
  }
  static parse(point) {
    var defaultValue = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0;
    var [x = defaultValue, y2 = defaultValue] = toNumbers(point);
    return new _Point(x, y2);
  }
  static parseScale(scale) {
    var defaultValue = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 1;
    var [x = defaultValue, y2 = x] = toNumbers(scale);
    return new _Point(x, y2);
  }
  static parsePath(path) {
    var points = toNumbers(path);
    var len = points.length;
    var pathPoints = [];
    for (var i2 = 0; i2 < len; i2 += 2) {
      pathPoints.push(new _Point(points[i2], points[i2 + 1]));
    }
    return pathPoints;
  }
  angleTo(point) {
    return Math.atan2(point.y - this.y, point.x - this.x);
  }
  applyTransform(transform) {
    var {
      x,
      y: y2
    } = this;
    var xp = x * transform[0] + y2 * transform[2] + transform[4];
    var yp = x * transform[1] + y2 * transform[3] + transform[5];
    this.x = xp;
    this.y = yp;
  }
};
var Mouse = class {
  constructor(screen) {
    this.screen = screen;
    this.working = false;
    this.events = [];
    this.eventElements = [];
    this.onClick = this.onClick.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
  }
  isWorking() {
    return this.working;
  }
  start() {
    if (this.working) {
      return;
    }
    var {
      screen,
      onClick,
      onMouseMove
    } = this;
    var canvas = screen.ctx.canvas;
    canvas.onclick = onClick;
    canvas.onmousemove = onMouseMove;
    this.working = true;
  }
  stop() {
    if (!this.working) {
      return;
    }
    var canvas = this.screen.ctx.canvas;
    this.working = false;
    canvas.onclick = null;
    canvas.onmousemove = null;
  }
  hasEvents() {
    return this.working && this.events.length > 0;
  }
  runEvents() {
    if (!this.working) {
      return;
    }
    var {
      screen: document2,
      events,
      eventElements
    } = this;
    var {
      style
    } = document2.ctx.canvas;
    if (style) {
      style.cursor = "";
    }
    events.forEach((_ref, i2) => {
      var {
        run
      } = _ref;
      var element = eventElements[i2];
      while (element) {
        run(element);
        element = element.parent;
      }
    });
    this.events = [];
    this.eventElements = [];
  }
  checkPath(element, ctx) {
    if (!this.working || !ctx) {
      return;
    }
    var {
      events,
      eventElements
    } = this;
    events.forEach((_ref2, i2) => {
      var {
        x,
        y: y2
      } = _ref2;
      if (!eventElements[i2] && ctx.isPointInPath && ctx.isPointInPath(x, y2)) {
        eventElements[i2] = element;
      }
    });
  }
  checkBoundingBox(element, boundingBox) {
    if (!this.working || !boundingBox) {
      return;
    }
    var {
      events,
      eventElements
    } = this;
    events.forEach((_ref3, i2) => {
      var {
        x,
        y: y2
      } = _ref3;
      if (!eventElements[i2] && boundingBox.isPointInBox(x, y2)) {
        eventElements[i2] = element;
      }
    });
  }
  mapXY(x, y2) {
    var {
      window: window2,
      ctx
    } = this.screen;
    var point = new Point(x, y2);
    var element = ctx.canvas;
    while (element) {
      point.x -= element.offsetLeft;
      point.y -= element.offsetTop;
      element = element.offsetParent;
    }
    if (window2.scrollX) {
      point.x += window2.scrollX;
    }
    if (window2.scrollY) {
      point.y += window2.scrollY;
    }
    return point;
  }
  onClick(event) {
    var {
      x,
      y: y2
    } = this.mapXY(event.clientX, event.clientY);
    this.events.push({
      type: "onclick",
      x,
      y: y2,
      run(eventTarget) {
        if (eventTarget.onClick) {
          eventTarget.onClick();
        }
      }
    });
  }
  onMouseMove(event) {
    var {
      x,
      y: y2
    } = this.mapXY(event.clientX, event.clientY);
    this.events.push({
      type: "onmousemove",
      x,
      y: y2,
      run(eventTarget) {
        if (eventTarget.onMouseMove) {
          eventTarget.onMouseMove();
        }
      }
    });
  }
};
var defaultWindow = typeof window !== "undefined" ? window : null;
var defaultFetch$1 = typeof fetch !== "undefined" ? fetch.bind(void 0) : null;
var Screen = class {
  constructor(ctx) {
    var {
      fetch: fetch2 = defaultFetch$1,
      window: window2 = defaultWindow
    } = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    this.ctx = ctx;
    this.FRAMERATE = 30;
    this.MAX_VIRTUAL_PIXELS = 3e4;
    this.CLIENT_WIDTH = 800;
    this.CLIENT_HEIGHT = 600;
    this.viewPort = new ViewPort();
    this.mouse = new Mouse(this);
    this.animations = [];
    this.waits = [];
    this.frameDuration = 0;
    this.isReadyLock = false;
    this.isFirstRender = true;
    this.intervalId = null;
    this.window = window2;
    this.fetch = fetch2;
  }
  wait(checker) {
    this.waits.push(checker);
  }
  ready() {
    if (!this.readyPromise) {
      return Promise.resolve();
    }
    return this.readyPromise;
  }
  isReady() {
    if (this.isReadyLock) {
      return true;
    }
    var isReadyLock = this.waits.every((_2) => _2());
    if (isReadyLock) {
      this.waits = [];
      if (this.resolveReady) {
        this.resolveReady();
      }
    }
    this.isReadyLock = isReadyLock;
    return isReadyLock;
  }
  setDefaults(ctx) {
    ctx.strokeStyle = "rgba(0,0,0,0)";
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.miterLimit = 4;
  }
  setViewBox(_ref) {
    var {
      document: document2,
      ctx,
      aspectRatio,
      width,
      desiredWidth,
      height,
      desiredHeight,
      minX = 0,
      minY = 0,
      refX,
      refY,
      clip = false,
      clipX = 0,
      clipY = 0
    } = _ref;
    var cleanAspectRatio = compressSpaces(aspectRatio).replace(/^defer\s/, "");
    var [aspectRatioAlign, aspectRatioMeetOrSlice] = cleanAspectRatio.split(" ");
    var align = aspectRatioAlign || "xMidYMid";
    var meetOrSlice = aspectRatioMeetOrSlice || "meet";
    var scaleX = width / desiredWidth;
    var scaleY = height / desiredHeight;
    var scaleMin = Math.min(scaleX, scaleY);
    var scaleMax = Math.max(scaleX, scaleY);
    var finalDesiredWidth = desiredWidth;
    var finalDesiredHeight = desiredHeight;
    if (meetOrSlice === "meet") {
      finalDesiredWidth *= scaleMin;
      finalDesiredHeight *= scaleMin;
    }
    if (meetOrSlice === "slice") {
      finalDesiredWidth *= scaleMax;
      finalDesiredHeight *= scaleMax;
    }
    var refXProp = new Property(document2, "refX", refX);
    var refYProp = new Property(document2, "refY", refY);
    var hasRefs = refXProp.hasValue() && refYProp.hasValue();
    if (hasRefs) {
      ctx.translate(-scaleMin * refXProp.getPixels("x"), -scaleMin * refYProp.getPixels("y"));
    }
    if (clip) {
      var scaledClipX = scaleMin * clipX;
      var scaledClipY = scaleMin * clipY;
      ctx.beginPath();
      ctx.moveTo(scaledClipX, scaledClipY);
      ctx.lineTo(width, scaledClipY);
      ctx.lineTo(width, height);
      ctx.lineTo(scaledClipX, height);
      ctx.closePath();
      ctx.clip();
    }
    if (!hasRefs) {
      var isMeetMinY = meetOrSlice === "meet" && scaleMin === scaleY;
      var isSliceMaxY = meetOrSlice === "slice" && scaleMax === scaleY;
      var isMeetMinX = meetOrSlice === "meet" && scaleMin === scaleX;
      var isSliceMaxX = meetOrSlice === "slice" && scaleMax === scaleX;
      if (align.startsWith("xMid") && (isMeetMinY || isSliceMaxY)) {
        ctx.translate(width / 2 - finalDesiredWidth / 2, 0);
      }
      if (align.endsWith("YMid") && (isMeetMinX || isSliceMaxX)) {
        ctx.translate(0, height / 2 - finalDesiredHeight / 2);
      }
      if (align.startsWith("xMax") && (isMeetMinY || isSliceMaxY)) {
        ctx.translate(width - finalDesiredWidth, 0);
      }
      if (align.endsWith("YMax") && (isMeetMinX || isSliceMaxX)) {
        ctx.translate(0, height - finalDesiredHeight);
      }
    }
    switch (true) {
      case align === "none":
        ctx.scale(scaleX, scaleY);
        break;
      case meetOrSlice === "meet":
        ctx.scale(scaleMin, scaleMin);
        break;
      case meetOrSlice === "slice":
        ctx.scale(scaleMax, scaleMax);
        break;
    }
    ctx.translate(-minX, -minY);
  }
  start(element) {
    var {
      enableRedraw = false,
      ignoreMouse = false,
      ignoreAnimation = false,
      ignoreDimensions = false,
      ignoreClear = false,
      forceRedraw,
      scaleWidth,
      scaleHeight,
      offsetX,
      offsetY
    } = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    var {
      FRAMERATE,
      mouse
    } = this;
    var frameDuration = 1e3 / FRAMERATE;
    this.frameDuration = frameDuration;
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    if (this.isReady()) {
      this.render(element, ignoreDimensions, ignoreClear, scaleWidth, scaleHeight, offsetX, offsetY);
    }
    if (!enableRedraw) {
      return;
    }
    var now = Date.now();
    var then = now;
    var delta = 0;
    var tick = () => {
      now = Date.now();
      delta = now - then;
      if (delta >= frameDuration) {
        then = now - delta % frameDuration;
        if (this.shouldUpdate(ignoreAnimation, forceRedraw)) {
          this.render(element, ignoreDimensions, ignoreClear, scaleWidth, scaleHeight, offsetX, offsetY);
          mouse.runEvents();
        }
      }
      this.intervalId = (0, import_raf.default)(tick);
    };
    if (!ignoreMouse) {
      mouse.start();
    }
    this.intervalId = (0, import_raf.default)(tick);
  }
  stop() {
    if (this.intervalId) {
      import_raf.default.cancel(this.intervalId);
      this.intervalId = null;
    }
    this.mouse.stop();
  }
  shouldUpdate(ignoreAnimation, forceRedraw) {
    if (!ignoreAnimation) {
      var {
        frameDuration
      } = this;
      var shouldUpdate = this.animations.reduce((shouldUpdate2, animation) => animation.update(frameDuration) || shouldUpdate2, false);
      if (shouldUpdate) {
        return true;
      }
    }
    if (typeof forceRedraw === "function" && forceRedraw()) {
      return true;
    }
    if (!this.isReadyLock && this.isReady()) {
      return true;
    }
    if (this.mouse.hasEvents()) {
      return true;
    }
    return false;
  }
  render(element, ignoreDimensions, ignoreClear, scaleWidth, scaleHeight, offsetX, offsetY) {
    var {
      CLIENT_WIDTH,
      CLIENT_HEIGHT,
      viewPort,
      ctx,
      isFirstRender
    } = this;
    var canvas = ctx.canvas;
    viewPort.clear();
    if (canvas.width && canvas.height) {
      viewPort.setCurrent(canvas.width, canvas.height);
    } else {
      viewPort.setCurrent(CLIENT_WIDTH, CLIENT_HEIGHT);
    }
    var widthStyle = element.getStyle("width");
    var heightStyle = element.getStyle("height");
    if (!ignoreDimensions && (isFirstRender || typeof scaleWidth !== "number" && typeof scaleHeight !== "number")) {
      if (widthStyle.hasValue()) {
        canvas.width = widthStyle.getPixels("x");
        if (canvas.style) {
          canvas.style.width = "".concat(canvas.width, "px");
        }
      }
      if (heightStyle.hasValue()) {
        canvas.height = heightStyle.getPixels("y");
        if (canvas.style) {
          canvas.style.height = "".concat(canvas.height, "px");
        }
      }
    }
    var cWidth = canvas.clientWidth || canvas.width;
    var cHeight = canvas.clientHeight || canvas.height;
    if (ignoreDimensions && widthStyle.hasValue() && heightStyle.hasValue()) {
      cWidth = widthStyle.getPixels("x");
      cHeight = heightStyle.getPixels("y");
    }
    viewPort.setCurrent(cWidth, cHeight);
    if (typeof offsetX === "number") {
      element.getAttribute("x", true).setValue(offsetX);
    }
    if (typeof offsetY === "number") {
      element.getAttribute("y", true).setValue(offsetY);
    }
    if (typeof scaleWidth === "number" || typeof scaleHeight === "number") {
      var viewBox = toNumbers(element.getAttribute("viewBox").getString());
      var xRatio = 0;
      var yRatio = 0;
      if (typeof scaleWidth === "number") {
        var _widthStyle = element.getStyle("width");
        if (_widthStyle.hasValue()) {
          xRatio = _widthStyle.getPixels("x") / scaleWidth;
        } else if (!isNaN(viewBox[2])) {
          xRatio = viewBox[2] / scaleWidth;
        }
      }
      if (typeof scaleHeight === "number") {
        var _heightStyle = element.getStyle("height");
        if (_heightStyle.hasValue()) {
          yRatio = _heightStyle.getPixels("y") / scaleHeight;
        } else if (!isNaN(viewBox[3])) {
          yRatio = viewBox[3] / scaleHeight;
        }
      }
      if (!xRatio) {
        xRatio = yRatio;
      }
      if (!yRatio) {
        yRatio = xRatio;
      }
      element.getAttribute("width", true).setValue(scaleWidth);
      element.getAttribute("height", true).setValue(scaleHeight);
      var transformStyle = element.getStyle("transform", true, true);
      transformStyle.setValue("".concat(transformStyle.getString(), " scale(").concat(1 / xRatio, ", ").concat(1 / yRatio, ")"));
    }
    if (!ignoreClear) {
      ctx.clearRect(0, 0, cWidth, cHeight);
    }
    element.render(ctx);
    if (isFirstRender) {
      this.isFirstRender = false;
    }
  }
};
Screen.defaultWindow = defaultWindow;
Screen.defaultFetch = defaultFetch$1;
var {
  defaultFetch
} = Screen;
var DefaultDOMParser = typeof DOMParser !== "undefined" ? DOMParser : null;
var Parser = class {
  constructor() {
    var {
      fetch: fetch2 = defaultFetch,
      DOMParser: DOMParser2 = DefaultDOMParser
    } = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    this.fetch = fetch2;
    this.DOMParser = DOMParser2;
  }
  parse(resource) {
    var _this = this;
    return _asyncToGenerator(function* () {
      if (resource.startsWith("<")) {
        return _this.parseFromString(resource);
      }
      return _this.load(resource);
    })();
  }
  parseFromString(xml) {
    var parser = new this.DOMParser();
    try {
      return this.checkDocument(parser.parseFromString(xml, "image/svg+xml"));
    } catch (err) {
      return this.checkDocument(parser.parseFromString(xml, "text/xml"));
    }
  }
  checkDocument(document2) {
    var parserError = document2.getElementsByTagName("parsererror")[0];
    if (parserError) {
      throw new Error(parserError.textContent);
    }
    return document2;
  }
  load(url) {
    var _this2 = this;
    return _asyncToGenerator(function* () {
      var response = yield _this2.fetch(url);
      var xml = yield response.text();
      return _this2.parseFromString(xml);
    })();
  }
};
var Translate = class {
  constructor(_2, point) {
    this.type = "translate";
    this.point = null;
    this.point = Point.parse(point);
  }
  apply(ctx) {
    var {
      x,
      y: y2
    } = this.point;
    ctx.translate(x || 0, y2 || 0);
  }
  unapply(ctx) {
    var {
      x,
      y: y2
    } = this.point;
    ctx.translate(-1 * x || 0, -1 * y2 || 0);
  }
  applyToPoint(point) {
    var {
      x,
      y: y2
    } = this.point;
    point.applyTransform([1, 0, 0, 1, x || 0, y2 || 0]);
  }
};
var Rotate = class {
  constructor(document2, rotate, transformOrigin) {
    this.type = "rotate";
    this.angle = null;
    this.originX = null;
    this.originY = null;
    this.cx = 0;
    this.cy = 0;
    var numbers = toNumbers(rotate);
    this.angle = new Property(document2, "angle", numbers[0]);
    this.originX = transformOrigin[0];
    this.originY = transformOrigin[1];
    this.cx = numbers[1] || 0;
    this.cy = numbers[2] || 0;
  }
  apply(ctx) {
    var {
      cx,
      cy,
      originX,
      originY,
      angle
    } = this;
    var tx = cx + originX.getPixels("x");
    var ty = cy + originY.getPixels("y");
    ctx.translate(tx, ty);
    ctx.rotate(angle.getRadians());
    ctx.translate(-tx, -ty);
  }
  unapply(ctx) {
    var {
      cx,
      cy,
      originX,
      originY,
      angle
    } = this;
    var tx = cx + originX.getPixels("x");
    var ty = cy + originY.getPixels("y");
    ctx.translate(tx, ty);
    ctx.rotate(-1 * angle.getRadians());
    ctx.translate(-tx, -ty);
  }
  applyToPoint(point) {
    var {
      cx,
      cy,
      angle
    } = this;
    var rad = angle.getRadians();
    point.applyTransform([
      1,
      0,
      0,
      1,
      cx || 0,
      cy || 0
      // this.p.y
    ]);
    point.applyTransform([Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]);
    point.applyTransform([
      1,
      0,
      0,
      1,
      -cx || 0,
      -cy || 0
      // -this.p.y
    ]);
  }
};
var Scale = class {
  constructor(_2, scale, transformOrigin) {
    this.type = "scale";
    this.scale = null;
    this.originX = null;
    this.originY = null;
    var scaleSize = Point.parseScale(scale);
    if (scaleSize.x === 0 || scaleSize.y === 0) {
      scaleSize.x = PSEUDO_ZERO;
      scaleSize.y = PSEUDO_ZERO;
    }
    this.scale = scaleSize;
    this.originX = transformOrigin[0];
    this.originY = transformOrigin[1];
  }
  apply(ctx) {
    var {
      scale: {
        x,
        y: y2
      },
      originX,
      originY
    } = this;
    var tx = originX.getPixels("x");
    var ty = originY.getPixels("y");
    ctx.translate(tx, ty);
    ctx.scale(x, y2 || x);
    ctx.translate(-tx, -ty);
  }
  unapply(ctx) {
    var {
      scale: {
        x,
        y: y2
      },
      originX,
      originY
    } = this;
    var tx = originX.getPixels("x");
    var ty = originY.getPixels("y");
    ctx.translate(tx, ty);
    ctx.scale(1 / x, 1 / y2 || x);
    ctx.translate(-tx, -ty);
  }
  applyToPoint(point) {
    var {
      x,
      y: y2
    } = this.scale;
    point.applyTransform([x || 0, 0, 0, y2 || 0, 0, 0]);
  }
};
var Matrix = class {
  constructor(_2, matrix, transformOrigin) {
    this.type = "matrix";
    this.matrix = [];
    this.originX = null;
    this.originY = null;
    this.matrix = toNumbers(matrix);
    this.originX = transformOrigin[0];
    this.originY = transformOrigin[1];
  }
  apply(ctx) {
    var {
      originX,
      originY,
      matrix
    } = this;
    var tx = originX.getPixels("x");
    var ty = originY.getPixels("y");
    ctx.translate(tx, ty);
    ctx.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);
    ctx.translate(-tx, -ty);
  }
  unapply(ctx) {
    var {
      originX,
      originY,
      matrix
    } = this;
    var a2 = matrix[0];
    var b = matrix[2];
    var c3 = matrix[4];
    var d = matrix[1];
    var e2 = matrix[3];
    var f2 = matrix[5];
    var g = 0;
    var h2 = 0;
    var i2 = 1;
    var det = 1 / (a2 * (e2 * i2 - f2 * h2) - b * (d * i2 - f2 * g) + c3 * (d * h2 - e2 * g));
    var tx = originX.getPixels("x");
    var ty = originY.getPixels("y");
    ctx.translate(tx, ty);
    ctx.transform(det * (e2 * i2 - f2 * h2), det * (f2 * g - d * i2), det * (c3 * h2 - b * i2), det * (a2 * i2 - c3 * g), det * (b * f2 - c3 * e2), det * (c3 * d - a2 * f2));
    ctx.translate(-tx, -ty);
  }
  applyToPoint(point) {
    point.applyTransform(this.matrix);
  }
};
var Skew = class extends Matrix {
  constructor(document2, skew, transformOrigin) {
    super(document2, skew, transformOrigin);
    this.type = "skew";
    this.angle = null;
    this.angle = new Property(document2, "angle", skew);
  }
};
var SkewX = class extends Skew {
  constructor(document2, skew, transformOrigin) {
    super(document2, skew, transformOrigin);
    this.type = "skewX";
    this.matrix = [1, 0, Math.tan(this.angle.getRadians()), 1, 0, 0];
  }
};
var SkewY = class extends Skew {
  constructor(document2, skew, transformOrigin) {
    super(document2, skew, transformOrigin);
    this.type = "skewY";
    this.matrix = [1, Math.tan(this.angle.getRadians()), 0, 1, 0, 0];
  }
};
function parseTransforms(transform) {
  return compressSpaces(transform).trim().replace(/\)([a-zA-Z])/g, ") $1").replace(/\)(\s?,\s?)/g, ") ").split(/\s(?=[a-z])/);
}
function parseTransform(transform) {
  var [type, value] = transform.split("(");
  return [type.trim(), value.trim().replace(")", "")];
}
var Transform = class _Transform {
  constructor(document2, transform, transformOrigin) {
    this.document = document2;
    this.transforms = [];
    var data = parseTransforms(transform);
    data.forEach((transform2) => {
      if (transform2 === "none") {
        return;
      }
      var [type, value] = parseTransform(transform2);
      var TransformType = _Transform.transformTypes[type];
      if (typeof TransformType !== "undefined") {
        this.transforms.push(new TransformType(this.document, value, transformOrigin));
      }
    });
  }
  static fromElement(document2, element) {
    var transformStyle = element.getStyle("transform", false, true);
    var [transformOriginXProperty, transformOriginYProperty = transformOriginXProperty] = element.getStyle("transform-origin", false, true).split();
    var transformOrigin = [transformOriginXProperty, transformOriginYProperty];
    if (transformStyle.hasValue()) {
      return new _Transform(document2, transformStyle.getString(), transformOrigin);
    }
    return null;
  }
  apply(ctx) {
    var {
      transforms
    } = this;
    var len = transforms.length;
    for (var i2 = 0; i2 < len; i2++) {
      transforms[i2].apply(ctx);
    }
  }
  unapply(ctx) {
    var {
      transforms
    } = this;
    var len = transforms.length;
    for (var i2 = len - 1; i2 >= 0; i2--) {
      transforms[i2].unapply(ctx);
    }
  }
  // TODO: applyToPoint unused ... remove?
  applyToPoint(point) {
    var {
      transforms
    } = this;
    var len = transforms.length;
    for (var i2 = 0; i2 < len; i2++) {
      transforms[i2].applyToPoint(point);
    }
  }
};
Transform.transformTypes = {
  translate: Translate,
  rotate: Rotate,
  scale: Scale,
  matrix: Matrix,
  skewX: SkewX,
  skewY: SkewY
};
var Element = class _Element {
  constructor(document2, node2) {
    var captureTextNodes = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
    this.document = document2;
    this.node = node2;
    this.captureTextNodes = captureTextNodes;
    this.attributes = /* @__PURE__ */ Object.create(null);
    this.styles = /* @__PURE__ */ Object.create(null);
    this.stylesSpecificity = /* @__PURE__ */ Object.create(null);
    this.animationFrozen = false;
    this.animationFrozenValue = "";
    this.parent = null;
    this.children = [];
    if (!node2 || node2.nodeType !== 1) {
      return;
    }
    Array.from(node2.attributes).forEach((attribute) => {
      var nodeName = normalizeAttributeName(attribute.nodeName);
      this.attributes[nodeName] = new Property(document2, nodeName, attribute.value);
    });
    this.addStylesFromStyleDefinition();
    if (this.getAttribute("style").hasValue()) {
      var styles = this.getAttribute("style").getString().split(";").map((_2) => _2.trim());
      styles.forEach((style) => {
        if (!style) {
          return;
        }
        var [name, value] = style.split(":").map((_2) => _2.trim());
        this.styles[name] = new Property(document2, name, value);
      });
    }
    var {
      definitions
    } = document2;
    var id = this.getAttribute("id");
    if (id.hasValue()) {
      if (!definitions[id.getString()]) {
        definitions[id.getString()] = this;
      }
    }
    Array.from(node2.childNodes).forEach((childNode) => {
      if (childNode.nodeType === 1) {
        this.addChild(childNode);
      } else if (captureTextNodes && (childNode.nodeType === 3 || childNode.nodeType === 4)) {
        var textNode = document2.createTextNode(childNode);
        if (textNode.getText().length > 0) {
          this.addChild(textNode);
        }
      }
    });
  }
  getAttribute(name) {
    var createIfNotExists = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;
    var attr = this.attributes[name];
    if (!attr && createIfNotExists) {
      var _attr = new Property(this.document, name, "");
      this.attributes[name] = _attr;
      return _attr;
    }
    return attr || Property.empty(this.document);
  }
  getHrefAttribute() {
    for (var key in this.attributes) {
      if (key === "href" || key.endsWith(":href")) {
        return this.attributes[key];
      }
    }
    return Property.empty(this.document);
  }
  getStyle(name) {
    var createIfNotExists = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;
    var skipAncestors = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
    var style = this.styles[name];
    if (style) {
      return style;
    }
    var attr = this.getAttribute(name);
    if (attr !== null && attr !== void 0 && attr.hasValue()) {
      this.styles[name] = attr;
      return attr;
    }
    if (!skipAncestors) {
      var {
        parent
      } = this;
      if (parent) {
        var parentStyle = parent.getStyle(name);
        if (parentStyle !== null && parentStyle !== void 0 && parentStyle.hasValue()) {
          return parentStyle;
        }
      }
    }
    if (createIfNotExists) {
      var _style = new Property(this.document, name, "");
      this.styles[name] = _style;
      return _style;
    }
    return style || Property.empty(this.document);
  }
  render(ctx) {
    if (this.getStyle("display").getString() === "none" || this.getStyle("visibility").getString() === "hidden") {
      return;
    }
    ctx.save();
    if (this.getStyle("mask").hasValue()) {
      var mask = this.getStyle("mask").getDefinition();
      if (mask) {
        this.applyEffects(ctx);
        mask.apply(ctx, this);
      }
    } else if (this.getStyle("filter").getValue("none") !== "none") {
      var filter = this.getStyle("filter").getDefinition();
      if (filter) {
        this.applyEffects(ctx);
        filter.apply(ctx, this);
      }
    } else {
      this.setContext(ctx);
      this.renderChildren(ctx);
      this.clearContext(ctx);
    }
    ctx.restore();
  }
  setContext(_2) {
  }
  applyEffects(ctx) {
    var transform = Transform.fromElement(this.document, this);
    if (transform) {
      transform.apply(ctx);
    }
    var clipPathStyleProp = this.getStyle("clip-path", false, true);
    if (clipPathStyleProp.hasValue()) {
      var clip = clipPathStyleProp.getDefinition();
      if (clip) {
        clip.apply(ctx);
      }
    }
  }
  clearContext(_2) {
  }
  renderChildren(ctx) {
    this.children.forEach((child) => {
      child.render(ctx);
    });
  }
  addChild(childNode) {
    var child = childNode instanceof _Element ? childNode : this.document.createElement(childNode);
    child.parent = this;
    if (!_Element.ignoreChildTypes.includes(child.type)) {
      this.children.push(child);
    }
  }
  matchesSelector(selector) {
    var _node$getAttribute;
    var {
      node: node2
    } = this;
    if (typeof node2.matches === "function") {
      return node2.matches(selector);
    }
    var styleClasses = (_node$getAttribute = node2.getAttribute) === null || _node$getAttribute === void 0 ? void 0 : _node$getAttribute.call(node2, "class");
    if (!styleClasses || styleClasses === "") {
      return false;
    }
    return styleClasses.split(" ").some((styleClass) => ".".concat(styleClass) === selector);
  }
  addStylesFromStyleDefinition() {
    var {
      styles,
      stylesSpecificity
    } = this.document;
    for (var selector in styles) {
      if (!selector.startsWith("@") && this.matchesSelector(selector)) {
        var style = styles[selector];
        var specificity = stylesSpecificity[selector];
        if (style) {
          for (var name in style) {
            var existingSpecificity = this.stylesSpecificity[name];
            if (typeof existingSpecificity === "undefined") {
              existingSpecificity = "000";
            }
            if (specificity >= existingSpecificity) {
              this.styles[name] = style[name];
              this.stylesSpecificity[name] = specificity;
            }
          }
        }
      }
    }
  }
  removeStyles(element, ignoreStyles) {
    var toRestore = ignoreStyles.reduce((toRestore2, name) => {
      var styleProp = element.getStyle(name);
      if (!styleProp.hasValue()) {
        return toRestore2;
      }
      var value = styleProp.getString();
      styleProp.setValue("");
      return [...toRestore2, [name, value]];
    }, []);
    return toRestore;
  }
  restoreStyles(element, styles) {
    styles.forEach((_ref) => {
      var [name, value] = _ref;
      element.getStyle(name, true).setValue(value);
    });
  }
  isFirstChild() {
    var _this$parent;
    return ((_this$parent = this.parent) === null || _this$parent === void 0 ? void 0 : _this$parent.children.indexOf(this)) === 0;
  }
};
Element.ignoreChildTypes = ["title"];
var UnknownElement = class extends Element {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
  }
};
function wrapFontFamily(fontFamily) {
  var trimmed = fontFamily.trim();
  return /^('|")/.test(trimmed) ? trimmed : '"'.concat(trimmed, '"');
}
function prepareFontFamily(fontFamily) {
  return typeof process === "undefined" ? fontFamily : fontFamily.trim().split(",").map(wrapFontFamily).join(",");
}
function prepareFontStyle(fontStyle) {
  if (!fontStyle) {
    return "";
  }
  var targetFontStyle = fontStyle.trim().toLowerCase();
  switch (targetFontStyle) {
    case "normal":
    case "italic":
    case "oblique":
    case "inherit":
    case "initial":
    case "unset":
      return targetFontStyle;
    default:
      if (/^oblique\s+(-|)\d+deg$/.test(targetFontStyle)) {
        return targetFontStyle;
      }
      return "";
  }
}
function prepareFontWeight(fontWeight) {
  if (!fontWeight) {
    return "";
  }
  var targetFontWeight = fontWeight.trim().toLowerCase();
  switch (targetFontWeight) {
    case "normal":
    case "bold":
    case "lighter":
    case "bolder":
    case "inherit":
    case "initial":
    case "unset":
      return targetFontWeight;
    default:
      if (/^[\d.]+$/.test(targetFontWeight)) {
        return targetFontWeight;
      }
      return "";
  }
}
var Font = class _Font {
  constructor(fontStyle, fontVariant, fontWeight, fontSize, fontFamily, inherit) {
    var inheritFont = inherit ? typeof inherit === "string" ? _Font.parse(inherit) : inherit : {};
    this.fontFamily = fontFamily || inheritFont.fontFamily;
    this.fontSize = fontSize || inheritFont.fontSize;
    this.fontStyle = fontStyle || inheritFont.fontStyle;
    this.fontWeight = fontWeight || inheritFont.fontWeight;
    this.fontVariant = fontVariant || inheritFont.fontVariant;
  }
  static parse() {
    var font = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : "";
    var inherit = arguments.length > 1 ? arguments[1] : void 0;
    var fontStyle = "";
    var fontVariant = "";
    var fontWeight = "";
    var fontSize = "";
    var fontFamily = "";
    var parts = compressSpaces(font).trim().split(" ");
    var set = {
      fontSize: false,
      fontStyle: false,
      fontWeight: false,
      fontVariant: false
    };
    parts.forEach((part) => {
      switch (true) {
        case (!set.fontStyle && _Font.styles.includes(part)):
          if (part !== "inherit") {
            fontStyle = part;
          }
          set.fontStyle = true;
          break;
        case (!set.fontVariant && _Font.variants.includes(part)):
          if (part !== "inherit") {
            fontVariant = part;
          }
          set.fontStyle = true;
          set.fontVariant = true;
          break;
        case (!set.fontWeight && _Font.weights.includes(part)):
          if (part !== "inherit") {
            fontWeight = part;
          }
          set.fontStyle = true;
          set.fontVariant = true;
          set.fontWeight = true;
          break;
        case !set.fontSize:
          if (part !== "inherit") {
            [fontSize] = part.split("/");
          }
          set.fontStyle = true;
          set.fontVariant = true;
          set.fontWeight = true;
          set.fontSize = true;
          break;
        default:
          if (part !== "inherit") {
            fontFamily += part;
          }
      }
    });
    return new _Font(fontStyle, fontVariant, fontWeight, fontSize, fontFamily, inherit);
  }
  toString() {
    return [
      prepareFontStyle(this.fontStyle),
      this.fontVariant,
      prepareFontWeight(this.fontWeight),
      this.fontSize,
      // Wrap fontFamily only on nodejs and only for canvas.ctx
      prepareFontFamily(this.fontFamily)
    ].join(" ").trim();
  }
};
Font.styles = "normal|italic|oblique|inherit";
Font.variants = "normal|small-caps|inherit";
Font.weights = "normal|bold|bolder|lighter|100|200|300|400|500|600|700|800|900|inherit";
var BoundingBox = class {
  constructor() {
    var x1 = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : Number.NaN;
    var y1 = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : Number.NaN;
    var x2 = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : Number.NaN;
    var y2 = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : Number.NaN;
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.addPoint(x1, y1);
    this.addPoint(x2, y2);
  }
  get x() {
    return this.x1;
  }
  get y() {
    return this.y1;
  }
  get width() {
    return this.x2 - this.x1;
  }
  get height() {
    return this.y2 - this.y1;
  }
  addPoint(x, y2) {
    if (typeof x !== "undefined") {
      if (isNaN(this.x1) || isNaN(this.x2)) {
        this.x1 = x;
        this.x2 = x;
      }
      if (x < this.x1) {
        this.x1 = x;
      }
      if (x > this.x2) {
        this.x2 = x;
      }
    }
    if (typeof y2 !== "undefined") {
      if (isNaN(this.y1) || isNaN(this.y2)) {
        this.y1 = y2;
        this.y2 = y2;
      }
      if (y2 < this.y1) {
        this.y1 = y2;
      }
      if (y2 > this.y2) {
        this.y2 = y2;
      }
    }
  }
  addX(x) {
    this.addPoint(x, null);
  }
  addY(y2) {
    this.addPoint(null, y2);
  }
  addBoundingBox(boundingBox) {
    if (!boundingBox) {
      return;
    }
    var {
      x1,
      y1,
      x2,
      y2
    } = boundingBox;
    this.addPoint(x1, y1);
    this.addPoint(x2, y2);
  }
  sumCubic(t2, p0, p1, p2, p3) {
    return Math.pow(1 - t2, 3) * p0 + 3 * Math.pow(1 - t2, 2) * t2 * p1 + 3 * (1 - t2) * Math.pow(t2, 2) * p2 + Math.pow(t2, 3) * p3;
  }
  bezierCurveAdd(forX, p0, p1, p2, p3) {
    var b = 6 * p0 - 12 * p1 + 6 * p2;
    var a2 = -3 * p0 + 9 * p1 - 9 * p2 + 3 * p3;
    var c3 = 3 * p1 - 3 * p0;
    if (a2 === 0) {
      if (b === 0) {
        return;
      }
      var t2 = -c3 / b;
      if (0 < t2 && t2 < 1) {
        if (forX) {
          this.addX(this.sumCubic(t2, p0, p1, p2, p3));
        } else {
          this.addY(this.sumCubic(t2, p0, p1, p2, p3));
        }
      }
      return;
    }
    var b2ac = Math.pow(b, 2) - 4 * c3 * a2;
    if (b2ac < 0) {
      return;
    }
    var t1 = (-b + Math.sqrt(b2ac)) / (2 * a2);
    if (0 < t1 && t1 < 1) {
      if (forX) {
        this.addX(this.sumCubic(t1, p0, p1, p2, p3));
      } else {
        this.addY(this.sumCubic(t1, p0, p1, p2, p3));
      }
    }
    var t22 = (-b - Math.sqrt(b2ac)) / (2 * a2);
    if (0 < t22 && t22 < 1) {
      if (forX) {
        this.addX(this.sumCubic(t22, p0, p1, p2, p3));
      } else {
        this.addY(this.sumCubic(t22, p0, p1, p2, p3));
      }
    }
  }
  // from http://blog.hackers-cafe.net/2009/06/how-to-calculate-bezier-curves-bounding.html
  addBezierCurve(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y) {
    this.addPoint(p0x, p0y);
    this.addPoint(p3x, p3y);
    this.bezierCurveAdd(true, p0x, p1x, p2x, p3x);
    this.bezierCurveAdd(false, p0y, p1y, p2y, p3y);
  }
  addQuadraticCurve(p0x, p0y, p1x, p1y, p2x, p2y) {
    var cp1x = p0x + 2 / 3 * (p1x - p0x);
    var cp1y = p0y + 2 / 3 * (p1y - p0y);
    var cp2x = cp1x + 1 / 3 * (p2x - p0x);
    var cp2y = cp1y + 1 / 3 * (p2y - p0y);
    this.addBezierCurve(p0x, p0y, cp1x, cp2x, cp1y, cp2y, p2x, p2y);
  }
  isPointInBox(x, y2) {
    var {
      x1,
      y1,
      x2,
      y2: y22
    } = this;
    return x1 <= x && x <= x2 && y1 <= y2 && y2 <= y22;
  }
};
var PathParser = class extends _ {
  constructor(path) {
    super(path.replace(/([+\-.])\s+/gm, "$1").replace(/[^MmZzLlHhVvCcSsQqTtAae\d\s.,+-].*/g, ""));
    this.control = null;
    this.start = null;
    this.current = null;
    this.command = null;
    this.commands = this.commands;
    this.i = -1;
    this.previousCommand = null;
    this.points = [];
    this.angles = [];
  }
  reset() {
    this.i = -1;
    this.command = null;
    this.previousCommand = null;
    this.start = new Point(0, 0);
    this.control = new Point(0, 0);
    this.current = new Point(0, 0);
    this.points = [];
    this.angles = [];
  }
  isEnd() {
    var {
      i: i2,
      commands
    } = this;
    return i2 >= commands.length - 1;
  }
  next() {
    var command = this.commands[++this.i];
    this.previousCommand = this.command;
    this.command = command;
    return command;
  }
  getPoint() {
    var xProp = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : "x";
    var yProp = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : "y";
    var point = new Point(this.command[xProp], this.command[yProp]);
    return this.makeAbsolute(point);
  }
  getAsControlPoint(xProp, yProp) {
    var point = this.getPoint(xProp, yProp);
    this.control = point;
    return point;
  }
  getAsCurrentPoint(xProp, yProp) {
    var point = this.getPoint(xProp, yProp);
    this.current = point;
    return point;
  }
  getReflectedControlPoint() {
    var previousCommand = this.previousCommand.type;
    if (previousCommand !== _.CURVE_TO && previousCommand !== _.SMOOTH_CURVE_TO && previousCommand !== _.QUAD_TO && previousCommand !== _.SMOOTH_QUAD_TO) {
      return this.current;
    }
    var {
      current: {
        x: cx,
        y: cy
      },
      control: {
        x: ox,
        y: oy
      }
    } = this;
    var point = new Point(2 * cx - ox, 2 * cy - oy);
    return point;
  }
  makeAbsolute(point) {
    if (this.command.relative) {
      var {
        x,
        y: y2
      } = this.current;
      point.x += x;
      point.y += y2;
    }
    return point;
  }
  addMarker(point, from, priorTo) {
    var {
      points,
      angles
    } = this;
    if (priorTo && angles.length > 0 && !angles[angles.length - 1]) {
      angles[angles.length - 1] = points[points.length - 1].angleTo(priorTo);
    }
    this.addMarkerAngle(point, from ? from.angleTo(point) : null);
  }
  addMarkerAngle(point, angle) {
    this.points.push(point);
    this.angles.push(angle);
  }
  getMarkerPoints() {
    return this.points;
  }
  getMarkerAngles() {
    var {
      angles
    } = this;
    var len = angles.length;
    for (var i2 = 0; i2 < len; i2++) {
      if (!angles[i2]) {
        for (var j = i2 + 1; j < len; j++) {
          if (angles[j]) {
            angles[i2] = angles[j];
            break;
          }
        }
      }
    }
    return angles;
  }
};
var RenderedElement = class extends Element {
  constructor() {
    super(...arguments);
    this.modifiedEmSizeStack = false;
  }
  calculateOpacity() {
    var opacity = 1;
    var element = this;
    while (element) {
      var opacityStyle = element.getStyle("opacity", false, true);
      if (opacityStyle.hasValue(true)) {
        opacity *= opacityStyle.getNumber();
      }
      element = element.parent;
    }
    return opacity;
  }
  setContext(ctx) {
    var fromMeasure = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;
    if (!fromMeasure) {
      var fillStyleProp = this.getStyle("fill");
      var fillOpacityStyleProp = this.getStyle("fill-opacity");
      var strokeStyleProp = this.getStyle("stroke");
      var strokeOpacityProp = this.getStyle("stroke-opacity");
      if (fillStyleProp.isUrlDefinition()) {
        var fillStyle = fillStyleProp.getFillStyleDefinition(this, fillOpacityStyleProp);
        if (fillStyle) {
          ctx.fillStyle = fillStyle;
        }
      } else if (fillStyleProp.hasValue()) {
        if (fillStyleProp.getString() === "currentColor") {
          fillStyleProp.setValue(this.getStyle("color").getColor());
        }
        var _fillStyle = fillStyleProp.getColor();
        if (_fillStyle !== "inherit") {
          ctx.fillStyle = _fillStyle === "none" ? "rgba(0,0,0,0)" : _fillStyle;
        }
      }
      if (fillOpacityStyleProp.hasValue()) {
        var _fillStyle2 = new Property(this.document, "fill", ctx.fillStyle).addOpacity(fillOpacityStyleProp).getColor();
        ctx.fillStyle = _fillStyle2;
      }
      if (strokeStyleProp.isUrlDefinition()) {
        var strokeStyle = strokeStyleProp.getFillStyleDefinition(this, strokeOpacityProp);
        if (strokeStyle) {
          ctx.strokeStyle = strokeStyle;
        }
      } else if (strokeStyleProp.hasValue()) {
        if (strokeStyleProp.getString() === "currentColor") {
          strokeStyleProp.setValue(this.getStyle("color").getColor());
        }
        var _strokeStyle = strokeStyleProp.getString();
        if (_strokeStyle !== "inherit") {
          ctx.strokeStyle = _strokeStyle === "none" ? "rgba(0,0,0,0)" : _strokeStyle;
        }
      }
      if (strokeOpacityProp.hasValue()) {
        var _strokeStyle2 = new Property(this.document, "stroke", ctx.strokeStyle).addOpacity(strokeOpacityProp).getString();
        ctx.strokeStyle = _strokeStyle2;
      }
      var strokeWidthStyleProp = this.getStyle("stroke-width");
      if (strokeWidthStyleProp.hasValue()) {
        var newLineWidth = strokeWidthStyleProp.getPixels();
        ctx.lineWidth = !newLineWidth ? PSEUDO_ZERO : newLineWidth;
      }
      var strokeLinecapStyleProp = this.getStyle("stroke-linecap");
      var strokeLinejoinStyleProp = this.getStyle("stroke-linejoin");
      var strokeMiterlimitProp = this.getStyle("stroke-miterlimit");
      var strokeDasharrayStyleProp = this.getStyle("stroke-dasharray");
      var strokeDashoffsetProp = this.getStyle("stroke-dashoffset");
      if (strokeLinecapStyleProp.hasValue()) {
        ctx.lineCap = strokeLinecapStyleProp.getString();
      }
      if (strokeLinejoinStyleProp.hasValue()) {
        ctx.lineJoin = strokeLinejoinStyleProp.getString();
      }
      if (strokeMiterlimitProp.hasValue()) {
        ctx.miterLimit = strokeMiterlimitProp.getNumber();
      }
      if (strokeDasharrayStyleProp.hasValue() && strokeDasharrayStyleProp.getString() !== "none") {
        var gaps = toNumbers(strokeDasharrayStyleProp.getString());
        if (typeof ctx.setLineDash !== "undefined") {
          ctx.setLineDash(gaps);
        } else if (typeof ctx.webkitLineDash !== "undefined") {
          ctx.webkitLineDash = gaps;
        } else if (typeof ctx.mozDash !== "undefined" && !(gaps.length === 1 && gaps[0] === 0)) {
          ctx.mozDash = gaps;
        }
        var offset = strokeDashoffsetProp.getPixels();
        if (typeof ctx.lineDashOffset !== "undefined") {
          ctx.lineDashOffset = offset;
        } else if (typeof ctx.webkitLineDashOffset !== "undefined") {
          ctx.webkitLineDashOffset = offset;
        } else if (typeof ctx.mozDashOffset !== "undefined") {
          ctx.mozDashOffset = offset;
        }
      }
    }
    this.modifiedEmSizeStack = false;
    if (typeof ctx.font !== "undefined") {
      var fontStyleProp = this.getStyle("font");
      var fontStyleStyleProp = this.getStyle("font-style");
      var fontVariantStyleProp = this.getStyle("font-variant");
      var fontWeightStyleProp = this.getStyle("font-weight");
      var fontSizeStyleProp = this.getStyle("font-size");
      var fontFamilyStyleProp = this.getStyle("font-family");
      var font = new Font(fontStyleStyleProp.getString(), fontVariantStyleProp.getString(), fontWeightStyleProp.getString(), fontSizeStyleProp.hasValue() ? "".concat(fontSizeStyleProp.getPixels(true), "px") : "", fontFamilyStyleProp.getString(), Font.parse(fontStyleProp.getString(), ctx.font));
      fontStyleStyleProp.setValue(font.fontStyle);
      fontVariantStyleProp.setValue(font.fontVariant);
      fontWeightStyleProp.setValue(font.fontWeight);
      fontSizeStyleProp.setValue(font.fontSize);
      fontFamilyStyleProp.setValue(font.fontFamily);
      ctx.font = font.toString();
      if (fontSizeStyleProp.isPixels()) {
        this.document.emSize = fontSizeStyleProp.getPixels();
        this.modifiedEmSizeStack = true;
      }
    }
    if (!fromMeasure) {
      this.applyEffects(ctx);
      ctx.globalAlpha = this.calculateOpacity();
    }
  }
  clearContext(ctx) {
    super.clearContext(ctx);
    if (this.modifiedEmSizeStack) {
      this.document.popEmSize();
    }
  }
};
var PathElement = class _PathElement extends RenderedElement {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "path";
    this.pathParser = null;
    this.pathParser = new PathParser(this.getAttribute("d").getString());
  }
  path(ctx) {
    var {
      pathParser
    } = this;
    var boundingBox = new BoundingBox();
    pathParser.reset();
    if (ctx) {
      ctx.beginPath();
    }
    while (!pathParser.isEnd()) {
      switch (pathParser.next().type) {
        case PathParser.MOVE_TO:
          this.pathM(ctx, boundingBox);
          break;
        case PathParser.LINE_TO:
          this.pathL(ctx, boundingBox);
          break;
        case PathParser.HORIZ_LINE_TO:
          this.pathH(ctx, boundingBox);
          break;
        case PathParser.VERT_LINE_TO:
          this.pathV(ctx, boundingBox);
          break;
        case PathParser.CURVE_TO:
          this.pathC(ctx, boundingBox);
          break;
        case PathParser.SMOOTH_CURVE_TO:
          this.pathS(ctx, boundingBox);
          break;
        case PathParser.QUAD_TO:
          this.pathQ(ctx, boundingBox);
          break;
        case PathParser.SMOOTH_QUAD_TO:
          this.pathT(ctx, boundingBox);
          break;
        case PathParser.ARC:
          this.pathA(ctx, boundingBox);
          break;
        case PathParser.CLOSE_PATH:
          this.pathZ(ctx, boundingBox);
          break;
      }
    }
    return boundingBox;
  }
  getBoundingBox(_2) {
    return this.path();
  }
  getMarkers() {
    var {
      pathParser
    } = this;
    var points = pathParser.getMarkerPoints();
    var angles = pathParser.getMarkerAngles();
    var markers = points.map((point, i2) => [point, angles[i2]]);
    return markers;
  }
  renderChildren(ctx) {
    this.path(ctx);
    this.document.screen.mouse.checkPath(this, ctx);
    var fillRuleStyleProp = this.getStyle("fill-rule");
    if (ctx.fillStyle !== "") {
      if (fillRuleStyleProp.getString("inherit") !== "inherit") {
        ctx.fill(fillRuleStyleProp.getString());
      } else {
        ctx.fill();
      }
    }
    if (ctx.strokeStyle !== "") {
      if (this.getAttribute("vector-effect").getString() === "non-scaling-stroke") {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.stroke();
      }
    }
    var markers = this.getMarkers();
    if (markers) {
      var markersLastIndex = markers.length - 1;
      var markerStartStyleProp = this.getStyle("marker-start");
      var markerMidStyleProp = this.getStyle("marker-mid");
      var markerEndStyleProp = this.getStyle("marker-end");
      if (markerStartStyleProp.isUrlDefinition()) {
        var marker = markerStartStyleProp.getDefinition();
        var [point, angle] = markers[0];
        marker.render(ctx, point, angle);
      }
      if (markerMidStyleProp.isUrlDefinition()) {
        var _marker = markerMidStyleProp.getDefinition();
        for (var i2 = 1; i2 < markersLastIndex; i2++) {
          var [_point, _angle] = markers[i2];
          _marker.render(ctx, _point, _angle);
        }
      }
      if (markerEndStyleProp.isUrlDefinition()) {
        var _marker2 = markerEndStyleProp.getDefinition();
        var [_point2, _angle2] = markers[markersLastIndex];
        _marker2.render(ctx, _point2, _angle2);
      }
    }
  }
  static pathM(pathParser) {
    var point = pathParser.getAsCurrentPoint();
    pathParser.start = pathParser.current;
    return {
      point
    };
  }
  pathM(ctx, boundingBox) {
    var {
      pathParser
    } = this;
    var {
      point
    } = _PathElement.pathM(pathParser);
    var {
      x,
      y: y2
    } = point;
    pathParser.addMarker(point);
    boundingBox.addPoint(x, y2);
    if (ctx) {
      ctx.moveTo(x, y2);
    }
  }
  static pathL(pathParser) {
    var {
      current
    } = pathParser;
    var point = pathParser.getAsCurrentPoint();
    return {
      current,
      point
    };
  }
  pathL(ctx, boundingBox) {
    var {
      pathParser
    } = this;
    var {
      current,
      point
    } = _PathElement.pathL(pathParser);
    var {
      x,
      y: y2
    } = point;
    pathParser.addMarker(point, current);
    boundingBox.addPoint(x, y2);
    if (ctx) {
      ctx.lineTo(x, y2);
    }
  }
  static pathH(pathParser) {
    var {
      current,
      command
    } = pathParser;
    var point = new Point((command.relative ? current.x : 0) + command.x, current.y);
    pathParser.current = point;
    return {
      current,
      point
    };
  }
  pathH(ctx, boundingBox) {
    var {
      pathParser
    } = this;
    var {
      current,
      point
    } = _PathElement.pathH(pathParser);
    var {
      x,
      y: y2
    } = point;
    pathParser.addMarker(point, current);
    boundingBox.addPoint(x, y2);
    if (ctx) {
      ctx.lineTo(x, y2);
    }
  }
  static pathV(pathParser) {
    var {
      current,
      command
    } = pathParser;
    var point = new Point(current.x, (command.relative ? current.y : 0) + command.y);
    pathParser.current = point;
    return {
      current,
      point
    };
  }
  pathV(ctx, boundingBox) {
    var {
      pathParser
    } = this;
    var {
      current,
      point
    } = _PathElement.pathV(pathParser);
    var {
      x,
      y: y2
    } = point;
    pathParser.addMarker(point, current);
    boundingBox.addPoint(x, y2);
    if (ctx) {
      ctx.lineTo(x, y2);
    }
  }
  static pathC(pathParser) {
    var {
      current
    } = pathParser;
    var point = pathParser.getPoint("x1", "y1");
    var controlPoint = pathParser.getAsControlPoint("x2", "y2");
    var currentPoint = pathParser.getAsCurrentPoint();
    return {
      current,
      point,
      controlPoint,
      currentPoint
    };
  }
  pathC(ctx, boundingBox) {
    var {
      pathParser
    } = this;
    var {
      current,
      point,
      controlPoint,
      currentPoint
    } = _PathElement.pathC(pathParser);
    pathParser.addMarker(currentPoint, controlPoint, point);
    boundingBox.addBezierCurve(current.x, current.y, point.x, point.y, controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
    if (ctx) {
      ctx.bezierCurveTo(point.x, point.y, controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
    }
  }
  static pathS(pathParser) {
    var {
      current
    } = pathParser;
    var point = pathParser.getReflectedControlPoint();
    var controlPoint = pathParser.getAsControlPoint("x2", "y2");
    var currentPoint = pathParser.getAsCurrentPoint();
    return {
      current,
      point,
      controlPoint,
      currentPoint
    };
  }
  pathS(ctx, boundingBox) {
    var {
      pathParser
    } = this;
    var {
      current,
      point,
      controlPoint,
      currentPoint
    } = _PathElement.pathS(pathParser);
    pathParser.addMarker(currentPoint, controlPoint, point);
    boundingBox.addBezierCurve(current.x, current.y, point.x, point.y, controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
    if (ctx) {
      ctx.bezierCurveTo(point.x, point.y, controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
    }
  }
  static pathQ(pathParser) {
    var {
      current
    } = pathParser;
    var controlPoint = pathParser.getAsControlPoint("x1", "y1");
    var currentPoint = pathParser.getAsCurrentPoint();
    return {
      current,
      controlPoint,
      currentPoint
    };
  }
  pathQ(ctx, boundingBox) {
    var {
      pathParser
    } = this;
    var {
      current,
      controlPoint,
      currentPoint
    } = _PathElement.pathQ(pathParser);
    pathParser.addMarker(currentPoint, controlPoint, controlPoint);
    boundingBox.addQuadraticCurve(current.x, current.y, controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
    if (ctx) {
      ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
    }
  }
  static pathT(pathParser) {
    var {
      current
    } = pathParser;
    var controlPoint = pathParser.getReflectedControlPoint();
    pathParser.control = controlPoint;
    var currentPoint = pathParser.getAsCurrentPoint();
    return {
      current,
      controlPoint,
      currentPoint
    };
  }
  pathT(ctx, boundingBox) {
    var {
      pathParser
    } = this;
    var {
      current,
      controlPoint,
      currentPoint
    } = _PathElement.pathT(pathParser);
    pathParser.addMarker(currentPoint, controlPoint, controlPoint);
    boundingBox.addQuadraticCurve(current.x, current.y, controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
    if (ctx) {
      ctx.quadraticCurveTo(controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
    }
  }
  static pathA(pathParser) {
    var {
      current,
      command
    } = pathParser;
    var {
      rX,
      rY,
      xRot,
      lArcFlag,
      sweepFlag
    } = command;
    var xAxisRotation = xRot * (Math.PI / 180);
    var currentPoint = pathParser.getAsCurrentPoint();
    var currp = new Point(Math.cos(xAxisRotation) * (current.x - currentPoint.x) / 2 + Math.sin(xAxisRotation) * (current.y - currentPoint.y) / 2, -Math.sin(xAxisRotation) * (current.x - currentPoint.x) / 2 + Math.cos(xAxisRotation) * (current.y - currentPoint.y) / 2);
    var l2 = Math.pow(currp.x, 2) / Math.pow(rX, 2) + Math.pow(currp.y, 2) / Math.pow(rY, 2);
    if (l2 > 1) {
      rX *= Math.sqrt(l2);
      rY *= Math.sqrt(l2);
    }
    var s2 = (lArcFlag === sweepFlag ? -1 : 1) * Math.sqrt((Math.pow(rX, 2) * Math.pow(rY, 2) - Math.pow(rX, 2) * Math.pow(currp.y, 2) - Math.pow(rY, 2) * Math.pow(currp.x, 2)) / (Math.pow(rX, 2) * Math.pow(currp.y, 2) + Math.pow(rY, 2) * Math.pow(currp.x, 2)));
    if (isNaN(s2)) {
      s2 = 0;
    }
    var cpp = new Point(s2 * rX * currp.y / rY, s2 * -rY * currp.x / rX);
    var centp = new Point((current.x + currentPoint.x) / 2 + Math.cos(xAxisRotation) * cpp.x - Math.sin(xAxisRotation) * cpp.y, (current.y + currentPoint.y) / 2 + Math.sin(xAxisRotation) * cpp.x + Math.cos(xAxisRotation) * cpp.y);
    var a1 = vectorsAngle([1, 0], [(currp.x - cpp.x) / rX, (currp.y - cpp.y) / rY]);
    var u2 = [(currp.x - cpp.x) / rX, (currp.y - cpp.y) / rY];
    var v2 = [(-currp.x - cpp.x) / rX, (-currp.y - cpp.y) / rY];
    var ad = vectorsAngle(u2, v2);
    if (vectorsRatio(u2, v2) <= -1) {
      ad = Math.PI;
    }
    if (vectorsRatio(u2, v2) >= 1) {
      ad = 0;
    }
    return {
      currentPoint,
      rX,
      rY,
      sweepFlag,
      xAxisRotation,
      centp,
      a1,
      ad
    };
  }
  pathA(ctx, boundingBox) {
    var {
      pathParser
    } = this;
    var {
      currentPoint,
      rX,
      rY,
      sweepFlag,
      xAxisRotation,
      centp,
      a1,
      ad
    } = _PathElement.pathA(pathParser);
    var dir = 1 - sweepFlag ? 1 : -1;
    var ah = a1 + dir * (ad / 2);
    var halfWay = new Point(centp.x + rX * Math.cos(ah), centp.y + rY * Math.sin(ah));
    pathParser.addMarkerAngle(halfWay, ah - dir * Math.PI / 2);
    pathParser.addMarkerAngle(currentPoint, ah - dir * Math.PI);
    boundingBox.addPoint(currentPoint.x, currentPoint.y);
    if (ctx && !isNaN(a1) && !isNaN(ad)) {
      var r2 = rX > rY ? rX : rY;
      var sx = rX > rY ? 1 : rX / rY;
      var sy = rX > rY ? rY / rX : 1;
      ctx.translate(centp.x, centp.y);
      ctx.rotate(xAxisRotation);
      ctx.scale(sx, sy);
      ctx.arc(0, 0, r2, a1, a1 + ad, Boolean(1 - sweepFlag));
      ctx.scale(1 / sx, 1 / sy);
      ctx.rotate(-xAxisRotation);
      ctx.translate(-centp.x, -centp.y);
    }
  }
  static pathZ(pathParser) {
    pathParser.current = pathParser.start;
  }
  pathZ(ctx, boundingBox) {
    _PathElement.pathZ(this.pathParser);
    if (ctx) {
      if (boundingBox.x1 !== boundingBox.x2 && boundingBox.y1 !== boundingBox.y2) {
        ctx.closePath();
      }
    }
  }
};
var GlyphElement = class extends PathElement {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "glyph";
    this.horizAdvX = this.getAttribute("horiz-adv-x").getNumber();
    this.unicode = this.getAttribute("unicode").getString();
    this.arabicForm = this.getAttribute("arabic-form").getString();
  }
};
var TextElement = class _TextElement extends RenderedElement {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, new.target === _TextElement ? true : captureTextNodes);
    this.type = "text";
    this.x = 0;
    this.y = 0;
    this.measureCache = -1;
  }
  setContext(ctx) {
    var fromMeasure = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;
    super.setContext(ctx, fromMeasure);
    var textBaseline = this.getStyle("dominant-baseline").getTextBaseline() || this.getStyle("alignment-baseline").getTextBaseline();
    if (textBaseline) {
      ctx.textBaseline = textBaseline;
    }
  }
  initializeCoordinates() {
    this.x = 0;
    this.y = 0;
    this.leafTexts = [];
    this.textChunkStart = 0;
    this.minX = Number.POSITIVE_INFINITY;
    this.maxX = Number.NEGATIVE_INFINITY;
  }
  getBoundingBox(ctx) {
    if (this.type !== "text") {
      return this.getTElementBoundingBox(ctx);
    }
    this.initializeCoordinates();
    this.adjustChildCoordinatesRecursive(ctx);
    var boundingBox = null;
    this.children.forEach((_2, i2) => {
      var childBoundingBox = this.getChildBoundingBox(ctx, this, this, i2);
      if (!boundingBox) {
        boundingBox = childBoundingBox;
      } else {
        boundingBox.addBoundingBox(childBoundingBox);
      }
    });
    return boundingBox;
  }
  getFontSize() {
    var {
      document: document2,
      parent
    } = this;
    var inheritFontSize = Font.parse(document2.ctx.font).fontSize;
    var fontSize = parent.getStyle("font-size").getNumber(inheritFontSize);
    return fontSize;
  }
  getTElementBoundingBox(ctx) {
    var fontSize = this.getFontSize();
    return new BoundingBox(this.x, this.y - fontSize, this.x + this.measureText(ctx), this.y);
  }
  getGlyph(font, text, i2) {
    var char = text[i2];
    var glyph = null;
    if (font.isArabic) {
      var len = text.length;
      var prevChar = text[i2 - 1];
      var nextChar = text[i2 + 1];
      var arabicForm = "isolated";
      if ((i2 === 0 || prevChar === " ") && i2 < len - 1 && nextChar !== " ") {
        arabicForm = "terminal";
      }
      if (i2 > 0 && prevChar !== " " && i2 < len - 1 && nextChar !== " ") {
        arabicForm = "medial";
      }
      if (i2 > 0 && prevChar !== " " && (i2 === len - 1 || nextChar === " ")) {
        arabicForm = "initial";
      }
      if (typeof font.glyphs[char] !== "undefined") {
        var maybeGlyph = font.glyphs[char];
        glyph = maybeGlyph instanceof GlyphElement ? maybeGlyph : maybeGlyph[arabicForm];
      }
    } else {
      glyph = font.glyphs[char];
    }
    if (!glyph) {
      glyph = font.missingGlyph;
    }
    return glyph;
  }
  getText() {
    return "";
  }
  getTextFromNode(node2) {
    var textNode = node2 || this.node;
    var childNodes = Array.from(textNode.parentNode.childNodes);
    var index2 = childNodes.indexOf(textNode);
    var lastIndex = childNodes.length - 1;
    var text = compressSpaces(
      // textNode.value
      // || textNode.text
      textNode.textContent || ""
    );
    if (index2 === 0) {
      text = trimLeft(text);
    }
    if (index2 === lastIndex) {
      text = trimRight(text);
    }
    return text;
  }
  renderChildren(ctx) {
    if (this.type !== "text") {
      this.renderTElementChildren(ctx);
      return;
    }
    this.initializeCoordinates();
    this.adjustChildCoordinatesRecursive(ctx);
    this.children.forEach((_2, i2) => {
      this.renderChild(ctx, this, this, i2);
    });
    var {
      mouse
    } = this.document.screen;
    if (mouse.isWorking()) {
      mouse.checkBoundingBox(this, this.getBoundingBox(ctx));
    }
  }
  renderTElementChildren(ctx) {
    var {
      document: document2,
      parent
    } = this;
    var renderText = this.getText();
    var customFont = parent.getStyle("font-family").getDefinition();
    if (customFont) {
      var {
        unitsPerEm
      } = customFont.fontFace;
      var ctxFont = Font.parse(document2.ctx.font);
      var fontSize = parent.getStyle("font-size").getNumber(ctxFont.fontSize);
      var fontStyle = parent.getStyle("font-style").getString(ctxFont.fontStyle);
      var scale = fontSize / unitsPerEm;
      var text = customFont.isRTL ? renderText.split("").reverse().join("") : renderText;
      var dx = toNumbers(parent.getAttribute("dx").getString());
      var len = text.length;
      for (var i2 = 0; i2 < len; i2++) {
        var glyph = this.getGlyph(customFont, text, i2);
        ctx.translate(this.x, this.y);
        ctx.scale(scale, -scale);
        var lw = ctx.lineWidth;
        ctx.lineWidth = ctx.lineWidth * unitsPerEm / fontSize;
        if (fontStyle === "italic") {
          ctx.transform(1, 0, 0.4, 1, 0, 0);
        }
        glyph.render(ctx);
        if (fontStyle === "italic") {
          ctx.transform(1, 0, -0.4, 1, 0, 0);
        }
        ctx.lineWidth = lw;
        ctx.scale(1 / scale, -1 / scale);
        ctx.translate(-this.x, -this.y);
        this.x += fontSize * (glyph.horizAdvX || customFont.horizAdvX) / unitsPerEm;
        if (typeof dx[i2] !== "undefined" && !isNaN(dx[i2])) {
          this.x += dx[i2];
        }
      }
      return;
    }
    var {
      x,
      y: y2
    } = this;
    if (ctx.fillStyle) {
      ctx.fillText(renderText, x, y2);
    }
    if (ctx.strokeStyle) {
      ctx.strokeText(renderText, x, y2);
    }
  }
  applyAnchoring() {
    if (this.textChunkStart >= this.leafTexts.length) {
      return;
    }
    var firstElement = this.leafTexts[this.textChunkStart];
    var textAnchor = firstElement.getStyle("text-anchor").getString("start");
    var isRTL = false;
    var shift = 0;
    if (textAnchor === "start" && !isRTL || textAnchor === "end" && isRTL) {
      shift = firstElement.x - this.minX;
    } else if (textAnchor === "end" && !isRTL || textAnchor === "start" && isRTL) {
      shift = firstElement.x - this.maxX;
    } else {
      shift = firstElement.x - (this.minX + this.maxX) / 2;
    }
    for (var i2 = this.textChunkStart; i2 < this.leafTexts.length; i2++) {
      this.leafTexts[i2].x += shift;
    }
    this.minX = Number.POSITIVE_INFINITY;
    this.maxX = Number.NEGATIVE_INFINITY;
    this.textChunkStart = this.leafTexts.length;
  }
  adjustChildCoordinatesRecursive(ctx) {
    this.children.forEach((_2, i2) => {
      this.adjustChildCoordinatesRecursiveCore(ctx, this, this, i2);
    });
    this.applyAnchoring();
  }
  adjustChildCoordinatesRecursiveCore(ctx, textParent, parent, i2) {
    var child = parent.children[i2];
    if (child.children.length > 0) {
      child.children.forEach((_2, i3) => {
        textParent.adjustChildCoordinatesRecursiveCore(ctx, textParent, child, i3);
      });
    } else {
      this.adjustChildCoordinates(ctx, textParent, parent, i2);
    }
  }
  adjustChildCoordinates(ctx, textParent, parent, i2) {
    var child = parent.children[i2];
    if (typeof child.measureText !== "function") {
      return child;
    }
    ctx.save();
    child.setContext(ctx, true);
    var xAttr = child.getAttribute("x");
    var yAttr = child.getAttribute("y");
    var dxAttr = child.getAttribute("dx");
    var dyAttr = child.getAttribute("dy");
    var customFont = child.getStyle("font-family").getDefinition();
    var isRTL = Boolean(customFont) && customFont.isRTL;
    if (i2 === 0) {
      if (!xAttr.hasValue()) {
        xAttr.setValue(child.getInheritedAttribute("x"));
      }
      if (!yAttr.hasValue()) {
        yAttr.setValue(child.getInheritedAttribute("y"));
      }
      if (!dxAttr.hasValue()) {
        dxAttr.setValue(child.getInheritedAttribute("dx"));
      }
      if (!dyAttr.hasValue()) {
        dyAttr.setValue(child.getInheritedAttribute("dy"));
      }
    }
    var width = child.measureText(ctx);
    if (isRTL) {
      textParent.x -= width;
    }
    if (xAttr.hasValue()) {
      textParent.applyAnchoring();
      child.x = xAttr.getPixels("x");
      if (dxAttr.hasValue()) {
        child.x += dxAttr.getPixels("x");
      }
    } else {
      if (dxAttr.hasValue()) {
        textParent.x += dxAttr.getPixels("x");
      }
      child.x = textParent.x;
    }
    textParent.x = child.x;
    if (!isRTL) {
      textParent.x += width;
    }
    if (yAttr.hasValue()) {
      child.y = yAttr.getPixels("y");
      if (dyAttr.hasValue()) {
        child.y += dyAttr.getPixels("y");
      }
    } else {
      if (dyAttr.hasValue()) {
        textParent.y += dyAttr.getPixels("y");
      }
      child.y = textParent.y;
    }
    textParent.y = child.y;
    textParent.leafTexts.push(child);
    textParent.minX = Math.min(textParent.minX, child.x, child.x + width);
    textParent.maxX = Math.max(textParent.maxX, child.x, child.x + width);
    child.clearContext(ctx);
    ctx.restore();
    return child;
  }
  getChildBoundingBox(ctx, textParent, parent, i2) {
    var child = parent.children[i2];
    if (typeof child.getBoundingBox !== "function") {
      return null;
    }
    var boundingBox = child.getBoundingBox(ctx);
    if (!boundingBox) {
      return null;
    }
    child.children.forEach((_2, i3) => {
      var childBoundingBox = textParent.getChildBoundingBox(ctx, textParent, child, i3);
      boundingBox.addBoundingBox(childBoundingBox);
    });
    return boundingBox;
  }
  renderChild(ctx, textParent, parent, i2) {
    var child = parent.children[i2];
    child.render(ctx);
    child.children.forEach((_2, i3) => {
      textParent.renderChild(ctx, textParent, child, i3);
    });
  }
  measureText(ctx) {
    var {
      measureCache
    } = this;
    if (~measureCache) {
      return measureCache;
    }
    var renderText = this.getText();
    var measure = this.measureTargetText(ctx, renderText);
    this.measureCache = measure;
    return measure;
  }
  measureTargetText(ctx, targetText) {
    if (!targetText.length) {
      return 0;
    }
    var {
      parent
    } = this;
    var customFont = parent.getStyle("font-family").getDefinition();
    if (customFont) {
      var fontSize = this.getFontSize();
      var text = customFont.isRTL ? targetText.split("").reverse().join("") : targetText;
      var dx = toNumbers(parent.getAttribute("dx").getString());
      var len = text.length;
      var _measure = 0;
      for (var i2 = 0; i2 < len; i2++) {
        var glyph = this.getGlyph(customFont, text, i2);
        _measure += (glyph.horizAdvX || customFont.horizAdvX) * fontSize / customFont.fontFace.unitsPerEm;
        if (typeof dx[i2] !== "undefined" && !isNaN(dx[i2])) {
          _measure += dx[i2];
        }
      }
      return _measure;
    }
    if (!ctx.measureText) {
      return targetText.length * 10;
    }
    ctx.save();
    this.setContext(ctx, true);
    var {
      width: measure
    } = ctx.measureText(targetText);
    this.clearContext(ctx);
    ctx.restore();
    return measure;
  }
  /**
   * Inherits positional attributes from {@link TextElement} parent(s). Attributes
   * are only inherited from a parent to its first child.
   * @param name - The attribute name.
   * @returns The attribute value or null.
   */
  getInheritedAttribute(name) {
    var current = this;
    while (current instanceof _TextElement && current.isFirstChild()) {
      var parentAttr = current.parent.getAttribute(name);
      if (parentAttr.hasValue(true)) {
        return parentAttr.getValue("0");
      }
      current = current.parent;
    }
    return null;
  }
};
var TSpanElement = class _TSpanElement extends TextElement {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, new.target === _TSpanElement ? true : captureTextNodes);
    this.type = "tspan";
    this.text = this.children.length > 0 ? "" : this.getTextFromNode();
  }
  getText() {
    return this.text;
  }
};
var TextNode = class extends TSpanElement {
  constructor() {
    super(...arguments);
    this.type = "textNode";
  }
};
var SVGElement = class extends RenderedElement {
  constructor() {
    super(...arguments);
    this.type = "svg";
    this.root = false;
  }
  setContext(ctx) {
    var _this$node$parentNode;
    var {
      document: document2
    } = this;
    var {
      screen,
      window: window2
    } = document2;
    var canvas = ctx.canvas;
    screen.setDefaults(ctx);
    if (canvas.style && typeof ctx.font !== "undefined" && window2 && typeof window2.getComputedStyle !== "undefined") {
      ctx.font = window2.getComputedStyle(canvas).getPropertyValue("font");
      var fontSizeProp = new Property(document2, "fontSize", Font.parse(ctx.font).fontSize);
      if (fontSizeProp.hasValue()) {
        document2.rootEmSize = fontSizeProp.getPixels("y");
        document2.emSize = document2.rootEmSize;
      }
    }
    if (!this.getAttribute("x").hasValue()) {
      this.getAttribute("x", true).setValue(0);
    }
    if (!this.getAttribute("y").hasValue()) {
      this.getAttribute("y", true).setValue(0);
    }
    var {
      width,
      height
    } = screen.viewPort;
    if (!this.getStyle("width").hasValue()) {
      this.getStyle("width", true).setValue("100%");
    }
    if (!this.getStyle("height").hasValue()) {
      this.getStyle("height", true).setValue("100%");
    }
    if (!this.getStyle("color").hasValue()) {
      this.getStyle("color", true).setValue("black");
    }
    var refXAttr = this.getAttribute("refX");
    var refYAttr = this.getAttribute("refY");
    var viewBoxAttr = this.getAttribute("viewBox");
    var viewBox = viewBoxAttr.hasValue() ? toNumbers(viewBoxAttr.getString()) : null;
    var clip = !this.root && this.getStyle("overflow").getValue("hidden") !== "visible";
    var minX = 0;
    var minY = 0;
    var clipX = 0;
    var clipY = 0;
    if (viewBox) {
      minX = viewBox[0];
      minY = viewBox[1];
    }
    if (!this.root) {
      width = this.getStyle("width").getPixels("x");
      height = this.getStyle("height").getPixels("y");
      if (this.type === "marker") {
        clipX = minX;
        clipY = minY;
        minX = 0;
        minY = 0;
      }
    }
    screen.viewPort.setCurrent(width, height);
    if (this.node && (!this.parent || ((_this$node$parentNode = this.node.parentNode) === null || _this$node$parentNode === void 0 ? void 0 : _this$node$parentNode.nodeName) === "foreignObject") && this.getStyle("transform", false, true).hasValue() && !this.getStyle("transform-origin", false, true).hasValue()) {
      this.getStyle("transform-origin", true, true).setValue("50% 50%");
    }
    super.setContext(ctx);
    ctx.translate(this.getAttribute("x").getPixels("x"), this.getAttribute("y").getPixels("y"));
    if (viewBox) {
      width = viewBox[2];
      height = viewBox[3];
    }
    document2.setViewBox({
      ctx,
      aspectRatio: this.getAttribute("preserveAspectRatio").getString(),
      width: screen.viewPort.width,
      desiredWidth: width,
      height: screen.viewPort.height,
      desiredHeight: height,
      minX,
      minY,
      refX: refXAttr.getValue(),
      refY: refYAttr.getValue(),
      clip,
      clipX,
      clipY
    });
    if (viewBox) {
      screen.viewPort.removeCurrent();
      screen.viewPort.setCurrent(width, height);
    }
  }
  clearContext(ctx) {
    super.clearContext(ctx);
    this.document.screen.viewPort.removeCurrent();
  }
  /**
   * Resize SVG to fit in given size.
   * @param width
   * @param height
   * @param preserveAspectRatio
   */
  resize(width) {
    var height = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : width;
    var preserveAspectRatio = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
    var widthAttr = this.getAttribute("width", true);
    var heightAttr = this.getAttribute("height", true);
    var viewBoxAttr = this.getAttribute("viewBox");
    var styleAttr = this.getAttribute("style");
    var originWidth = widthAttr.getNumber(0);
    var originHeight = heightAttr.getNumber(0);
    if (preserveAspectRatio) {
      if (typeof preserveAspectRatio === "string") {
        this.getAttribute("preserveAspectRatio", true).setValue(preserveAspectRatio);
      } else {
        var preserveAspectRatioAttr = this.getAttribute("preserveAspectRatio");
        if (preserveAspectRatioAttr.hasValue()) {
          preserveAspectRatioAttr.setValue(preserveAspectRatioAttr.getString().replace(/^\s*(\S.*\S)\s*$/, "$1"));
        }
      }
    }
    widthAttr.setValue(width);
    heightAttr.setValue(height);
    if (!viewBoxAttr.hasValue()) {
      viewBoxAttr.setValue("0 0 ".concat(originWidth || width, " ").concat(originHeight || height));
    }
    if (styleAttr.hasValue()) {
      var widthStyle = this.getStyle("width");
      var heightStyle = this.getStyle("height");
      if (widthStyle.hasValue()) {
        widthStyle.setValue("".concat(width, "px"));
      }
      if (heightStyle.hasValue()) {
        heightStyle.setValue("".concat(height, "px"));
      }
    }
  }
};
var RectElement = class extends PathElement {
  constructor() {
    super(...arguments);
    this.type = "rect";
  }
  path(ctx) {
    var x = this.getAttribute("x").getPixels("x");
    var y2 = this.getAttribute("y").getPixels("y");
    var width = this.getStyle("width", false, true).getPixels("x");
    var height = this.getStyle("height", false, true).getPixels("y");
    var rxAttr = this.getAttribute("rx");
    var ryAttr = this.getAttribute("ry");
    var rx = rxAttr.getPixels("x");
    var ry = ryAttr.getPixels("y");
    if (rxAttr.hasValue() && !ryAttr.hasValue()) {
      ry = rx;
    }
    if (ryAttr.hasValue() && !rxAttr.hasValue()) {
      rx = ry;
    }
    rx = Math.min(rx, width / 2);
    ry = Math.min(ry, height / 2);
    if (ctx) {
      var KAPPA = 4 * ((Math.sqrt(2) - 1) / 3);
      ctx.beginPath();
      if (height > 0 && width > 0) {
        ctx.moveTo(x + rx, y2);
        ctx.lineTo(x + width - rx, y2);
        ctx.bezierCurveTo(x + width - rx + KAPPA * rx, y2, x + width, y2 + ry - KAPPA * ry, x + width, y2 + ry);
        ctx.lineTo(x + width, y2 + height - ry);
        ctx.bezierCurveTo(x + width, y2 + height - ry + KAPPA * ry, x + width - rx + KAPPA * rx, y2 + height, x + width - rx, y2 + height);
        ctx.lineTo(x + rx, y2 + height);
        ctx.bezierCurveTo(x + rx - KAPPA * rx, y2 + height, x, y2 + height - ry + KAPPA * ry, x, y2 + height - ry);
        ctx.lineTo(x, y2 + ry);
        ctx.bezierCurveTo(x, y2 + ry - KAPPA * ry, x + rx - KAPPA * rx, y2, x + rx, y2);
        ctx.closePath();
      }
    }
    return new BoundingBox(x, y2, x + width, y2 + height);
  }
  getMarkers() {
    return null;
  }
};
var CircleElement = class extends PathElement {
  constructor() {
    super(...arguments);
    this.type = "circle";
  }
  path(ctx) {
    var cx = this.getAttribute("cx").getPixels("x");
    var cy = this.getAttribute("cy").getPixels("y");
    var r2 = this.getAttribute("r").getPixels();
    if (ctx && r2 > 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r2, 0, Math.PI * 2, false);
      ctx.closePath();
    }
    return new BoundingBox(cx - r2, cy - r2, cx + r2, cy + r2);
  }
  getMarkers() {
    return null;
  }
};
var EllipseElement = class extends PathElement {
  constructor() {
    super(...arguments);
    this.type = "ellipse";
  }
  path(ctx) {
    var KAPPA = 4 * ((Math.sqrt(2) - 1) / 3);
    var rx = this.getAttribute("rx").getPixels("x");
    var ry = this.getAttribute("ry").getPixels("y");
    var cx = this.getAttribute("cx").getPixels("x");
    var cy = this.getAttribute("cy").getPixels("y");
    if (ctx && rx > 0 && ry > 0) {
      ctx.beginPath();
      ctx.moveTo(cx + rx, cy);
      ctx.bezierCurveTo(cx + rx, cy + KAPPA * ry, cx + KAPPA * rx, cy + ry, cx, cy + ry);
      ctx.bezierCurveTo(cx - KAPPA * rx, cy + ry, cx - rx, cy + KAPPA * ry, cx - rx, cy);
      ctx.bezierCurveTo(cx - rx, cy - KAPPA * ry, cx - KAPPA * rx, cy - ry, cx, cy - ry);
      ctx.bezierCurveTo(cx + KAPPA * rx, cy - ry, cx + rx, cy - KAPPA * ry, cx + rx, cy);
      ctx.closePath();
    }
    return new BoundingBox(cx - rx, cy - ry, cx + rx, cy + ry);
  }
  getMarkers() {
    return null;
  }
};
var LineElement = class extends PathElement {
  constructor() {
    super(...arguments);
    this.type = "line";
  }
  getPoints() {
    return [new Point(this.getAttribute("x1").getPixels("x"), this.getAttribute("y1").getPixels("y")), new Point(this.getAttribute("x2").getPixels("x"), this.getAttribute("y2").getPixels("y"))];
  }
  path(ctx) {
    var [{
      x: x0,
      y: y0
    }, {
      x: x1,
      y: y1
    }] = this.getPoints();
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
    return new BoundingBox(x0, y0, x1, y1);
  }
  getMarkers() {
    var [p0, p1] = this.getPoints();
    var a2 = p0.angleTo(p1);
    return [[p0, a2], [p1, a2]];
  }
};
var PolylineElement = class extends PathElement {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "polyline";
    this.points = [];
    this.points = Point.parsePath(this.getAttribute("points").getString());
  }
  path(ctx) {
    var {
      points
    } = this;
    var [{
      x: x0,
      y: y0
    }] = points;
    var boundingBox = new BoundingBox(x0, y0);
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
    }
    points.forEach((_ref) => {
      var {
        x,
        y: y2
      } = _ref;
      boundingBox.addPoint(x, y2);
      if (ctx) {
        ctx.lineTo(x, y2);
      }
    });
    return boundingBox;
  }
  getMarkers() {
    var {
      points
    } = this;
    var lastIndex = points.length - 1;
    var markers = [];
    points.forEach((point, i2) => {
      if (i2 === lastIndex) {
        return;
      }
      markers.push([point, point.angleTo(points[i2 + 1])]);
    });
    if (markers.length > 0) {
      markers.push([points[points.length - 1], markers[markers.length - 1][1]]);
    }
    return markers;
  }
};
var PolygonElement = class extends PolylineElement {
  constructor() {
    super(...arguments);
    this.type = "polygon";
  }
  path(ctx) {
    var boundingBox = super.path(ctx);
    var [{
      x,
      y: y2
    }] = this.points;
    if (ctx) {
      ctx.lineTo(x, y2);
      ctx.closePath();
    }
    return boundingBox;
  }
};
var PatternElement = class extends Element {
  constructor() {
    super(...arguments);
    this.type = "pattern";
  }
  createPattern(ctx, _2, parentOpacityProp) {
    var width = this.getStyle("width").getPixels("x", true);
    var height = this.getStyle("height").getPixels("y", true);
    var patternSvg = new SVGElement(this.document, null);
    patternSvg.attributes.viewBox = new Property(this.document, "viewBox", this.getAttribute("viewBox").getValue());
    patternSvg.attributes.width = new Property(this.document, "width", "".concat(width, "px"));
    patternSvg.attributes.height = new Property(this.document, "height", "".concat(height, "px"));
    patternSvg.attributes.transform = new Property(this.document, "transform", this.getAttribute("patternTransform").getValue());
    patternSvg.children = this.children;
    var patternCanvas = this.document.createCanvas(width, height);
    var patternCtx = patternCanvas.getContext("2d");
    var xAttr = this.getAttribute("x");
    var yAttr = this.getAttribute("y");
    if (xAttr.hasValue() && yAttr.hasValue()) {
      patternCtx.translate(xAttr.getPixels("x", true), yAttr.getPixels("y", true));
    }
    if (parentOpacityProp.hasValue()) {
      this.styles["fill-opacity"] = parentOpacityProp;
    } else {
      Reflect.deleteProperty(this.styles, "fill-opacity");
    }
    for (var x = -1; x <= 1; x++) {
      for (var y2 = -1; y2 <= 1; y2++) {
        patternCtx.save();
        patternSvg.attributes.x = new Property(this.document, "x", x * patternCanvas.width);
        patternSvg.attributes.y = new Property(this.document, "y", y2 * patternCanvas.height);
        patternSvg.render(patternCtx);
        patternCtx.restore();
      }
    }
    var pattern = ctx.createPattern(patternCanvas, "repeat");
    return pattern;
  }
};
var MarkerElement = class extends Element {
  constructor() {
    super(...arguments);
    this.type = "marker";
  }
  render(ctx, point, angle) {
    if (!point) {
      return;
    }
    var {
      x,
      y: y2
    } = point;
    var orient = this.getAttribute("orient").getString("auto");
    var markerUnits = this.getAttribute("markerUnits").getString("strokeWidth");
    ctx.translate(x, y2);
    if (orient === "auto") {
      ctx.rotate(angle);
    }
    if (markerUnits === "strokeWidth") {
      ctx.scale(ctx.lineWidth, ctx.lineWidth);
    }
    ctx.save();
    var markerSvg = new SVGElement(this.document, null);
    markerSvg.type = this.type;
    markerSvg.attributes.viewBox = new Property(this.document, "viewBox", this.getAttribute("viewBox").getValue());
    markerSvg.attributes.refX = new Property(this.document, "refX", this.getAttribute("refX").getValue());
    markerSvg.attributes.refY = new Property(this.document, "refY", this.getAttribute("refY").getValue());
    markerSvg.attributes.width = new Property(this.document, "width", this.getAttribute("markerWidth").getValue());
    markerSvg.attributes.height = new Property(this.document, "height", this.getAttribute("markerHeight").getValue());
    markerSvg.attributes.overflow = new Property(this.document, "overflow", this.getAttribute("overflow").getValue());
    markerSvg.attributes.fill = new Property(this.document, "fill", this.getAttribute("fill").getColor("black"));
    markerSvg.attributes.stroke = new Property(this.document, "stroke", this.getAttribute("stroke").getValue("none"));
    markerSvg.children = this.children;
    markerSvg.render(ctx);
    ctx.restore();
    if (markerUnits === "strokeWidth") {
      ctx.scale(1 / ctx.lineWidth, 1 / ctx.lineWidth);
    }
    if (orient === "auto") {
      ctx.rotate(-angle);
    }
    ctx.translate(-x, -y2);
  }
};
var DefsElement = class extends Element {
  constructor() {
    super(...arguments);
    this.type = "defs";
  }
  render() {
  }
};
var GElement = class extends RenderedElement {
  constructor() {
    super(...arguments);
    this.type = "g";
  }
  getBoundingBox(ctx) {
    var boundingBox = new BoundingBox();
    this.children.forEach((child) => {
      boundingBox.addBoundingBox(child.getBoundingBox(ctx));
    });
    return boundingBox;
  }
};
var GradientElement = class extends Element {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.attributesToInherit = ["gradientUnits"];
    this.stops = [];
    var {
      stops,
      children
    } = this;
    children.forEach((child) => {
      if (child.type === "stop") {
        stops.push(child);
      }
    });
  }
  getGradientUnits() {
    return this.getAttribute("gradientUnits").getString("objectBoundingBox");
  }
  createGradient(ctx, element, parentOpacityProp) {
    var stopsContainer = this;
    if (this.getHrefAttribute().hasValue()) {
      stopsContainer = this.getHrefAttribute().getDefinition();
      this.inheritStopContainer(stopsContainer);
    }
    var {
      stops
    } = stopsContainer;
    var gradient = this.getGradient(ctx, element);
    if (!gradient) {
      return this.addParentOpacity(parentOpacityProp, stops[stops.length - 1].color);
    }
    stops.forEach((stop) => {
      gradient.addColorStop(stop.offset, this.addParentOpacity(parentOpacityProp, stop.color));
    });
    if (this.getAttribute("gradientTransform").hasValue()) {
      var {
        document: document2
      } = this;
      var {
        MAX_VIRTUAL_PIXELS,
        viewPort
      } = document2.screen;
      var [rootView] = viewPort.viewPorts;
      var rect = new RectElement(document2, null);
      rect.attributes.x = new Property(document2, "x", -MAX_VIRTUAL_PIXELS / 3);
      rect.attributes.y = new Property(document2, "y", -MAX_VIRTUAL_PIXELS / 3);
      rect.attributes.width = new Property(document2, "width", MAX_VIRTUAL_PIXELS);
      rect.attributes.height = new Property(document2, "height", MAX_VIRTUAL_PIXELS);
      var group = new GElement(document2, null);
      group.attributes.transform = new Property(document2, "transform", this.getAttribute("gradientTransform").getValue());
      group.children = [rect];
      var patternSvg = new SVGElement(document2, null);
      patternSvg.attributes.x = new Property(document2, "x", 0);
      patternSvg.attributes.y = new Property(document2, "y", 0);
      patternSvg.attributes.width = new Property(document2, "width", rootView.width);
      patternSvg.attributes.height = new Property(document2, "height", rootView.height);
      patternSvg.children = [group];
      var patternCanvas = document2.createCanvas(rootView.width, rootView.height);
      var patternCtx = patternCanvas.getContext("2d");
      patternCtx.fillStyle = gradient;
      patternSvg.render(patternCtx);
      return patternCtx.createPattern(patternCanvas, "no-repeat");
    }
    return gradient;
  }
  inheritStopContainer(stopsContainer) {
    this.attributesToInherit.forEach((attributeToInherit) => {
      if (!this.getAttribute(attributeToInherit).hasValue() && stopsContainer.getAttribute(attributeToInherit).hasValue()) {
        this.getAttribute(attributeToInherit, true).setValue(stopsContainer.getAttribute(attributeToInherit).getValue());
      }
    });
  }
  addParentOpacity(parentOpacityProp, color) {
    if (parentOpacityProp.hasValue()) {
      var colorProp = new Property(this.document, "color", color);
      return colorProp.addOpacity(parentOpacityProp).getColor();
    }
    return color;
  }
};
var LinearGradientElement = class extends GradientElement {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "linearGradient";
    this.attributesToInherit.push("x1", "y1", "x2", "y2");
  }
  getGradient(ctx, element) {
    var isBoundingBoxUnits = this.getGradientUnits() === "objectBoundingBox";
    var boundingBox = isBoundingBoxUnits ? element.getBoundingBox(ctx) : null;
    if (isBoundingBoxUnits && !boundingBox) {
      return null;
    }
    if (!this.getAttribute("x1").hasValue() && !this.getAttribute("y1").hasValue() && !this.getAttribute("x2").hasValue() && !this.getAttribute("y2").hasValue()) {
      this.getAttribute("x1", true).setValue(0);
      this.getAttribute("y1", true).setValue(0);
      this.getAttribute("x2", true).setValue(1);
      this.getAttribute("y2", true).setValue(0);
    }
    var x1 = isBoundingBoxUnits ? boundingBox.x + boundingBox.width * this.getAttribute("x1").getNumber() : this.getAttribute("x1").getPixels("x");
    var y1 = isBoundingBoxUnits ? boundingBox.y + boundingBox.height * this.getAttribute("y1").getNumber() : this.getAttribute("y1").getPixels("y");
    var x2 = isBoundingBoxUnits ? boundingBox.x + boundingBox.width * this.getAttribute("x2").getNumber() : this.getAttribute("x2").getPixels("x");
    var y2 = isBoundingBoxUnits ? boundingBox.y + boundingBox.height * this.getAttribute("y2").getNumber() : this.getAttribute("y2").getPixels("y");
    if (x1 === x2 && y1 === y2) {
      return null;
    }
    return ctx.createLinearGradient(x1, y1, x2, y2);
  }
};
var RadialGradientElement = class extends GradientElement {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "radialGradient";
    this.attributesToInherit.push("cx", "cy", "r", "fx", "fy", "fr");
  }
  getGradient(ctx, element) {
    var isBoundingBoxUnits = this.getGradientUnits() === "objectBoundingBox";
    var boundingBox = element.getBoundingBox(ctx);
    if (isBoundingBoxUnits && !boundingBox) {
      return null;
    }
    if (!this.getAttribute("cx").hasValue()) {
      this.getAttribute("cx", true).setValue("50%");
    }
    if (!this.getAttribute("cy").hasValue()) {
      this.getAttribute("cy", true).setValue("50%");
    }
    if (!this.getAttribute("r").hasValue()) {
      this.getAttribute("r", true).setValue("50%");
    }
    var cx = isBoundingBoxUnits ? boundingBox.x + boundingBox.width * this.getAttribute("cx").getNumber() : this.getAttribute("cx").getPixels("x");
    var cy = isBoundingBoxUnits ? boundingBox.y + boundingBox.height * this.getAttribute("cy").getNumber() : this.getAttribute("cy").getPixels("y");
    var fx = cx;
    var fy = cy;
    if (this.getAttribute("fx").hasValue()) {
      fx = isBoundingBoxUnits ? boundingBox.x + boundingBox.width * this.getAttribute("fx").getNumber() : this.getAttribute("fx").getPixels("x");
    }
    if (this.getAttribute("fy").hasValue()) {
      fy = isBoundingBoxUnits ? boundingBox.y + boundingBox.height * this.getAttribute("fy").getNumber() : this.getAttribute("fy").getPixels("y");
    }
    var r2 = isBoundingBoxUnits ? (boundingBox.width + boundingBox.height) / 2 * this.getAttribute("r").getNumber() : this.getAttribute("r").getPixels();
    var fr = this.getAttribute("fr").getPixels();
    return ctx.createRadialGradient(fx, fy, fr, cx, cy, r2);
  }
};
var StopElement = class extends Element {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "stop";
    var offset = Math.max(0, Math.min(1, this.getAttribute("offset").getNumber()));
    var stopOpacity = this.getStyle("stop-opacity");
    var stopColor = this.getStyle("stop-color", true);
    if (stopColor.getString() === "") {
      stopColor.setValue("#000");
    }
    if (stopOpacity.hasValue()) {
      stopColor = stopColor.addOpacity(stopOpacity);
    }
    this.offset = offset;
    this.color = stopColor.getColor();
  }
};
var AnimateElement = class extends Element {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "animate";
    this.duration = 0;
    this.initialValue = null;
    this.initialUnits = "";
    this.removed = false;
    this.frozen = false;
    document2.screen.animations.push(this);
    this.begin = this.getAttribute("begin").getMilliseconds();
    this.maxDuration = this.begin + this.getAttribute("dur").getMilliseconds();
    this.from = this.getAttribute("from");
    this.to = this.getAttribute("to");
    this.values = new Property(document2, "values", null);
    var valuesAttr = this.getAttribute("values");
    if (valuesAttr.hasValue()) {
      this.values.setValue(valuesAttr.getString().split(";"));
    }
  }
  getProperty() {
    var attributeType = this.getAttribute("attributeType").getString();
    var attributeName = this.getAttribute("attributeName").getString();
    if (attributeType === "CSS") {
      return this.parent.getStyle(attributeName, true);
    }
    return this.parent.getAttribute(attributeName, true);
  }
  calcValue() {
    var {
      initialUnits
    } = this;
    var {
      progress,
      from,
      to
    } = this.getProgress();
    var newValue = from.getNumber() + (to.getNumber() - from.getNumber()) * progress;
    if (initialUnits === "%") {
      newValue *= 100;
    }
    return "".concat(newValue).concat(initialUnits);
  }
  update(delta) {
    var {
      parent
    } = this;
    var prop = this.getProperty();
    if (!this.initialValue) {
      this.initialValue = prop.getString();
      this.initialUnits = prop.getUnits();
    }
    if (this.duration > this.maxDuration) {
      var fill = this.getAttribute("fill").getString("remove");
      if (this.getAttribute("repeatCount").getString() === "indefinite" || this.getAttribute("repeatDur").getString() === "indefinite") {
        this.duration = 0;
      } else if (fill === "freeze" && !this.frozen) {
        this.frozen = true;
        parent.animationFrozen = true;
        parent.animationFrozenValue = prop.getString();
      } else if (fill === "remove" && !this.removed) {
        this.removed = true;
        prop.setValue(parent.animationFrozen ? parent.animationFrozenValue : this.initialValue);
        return true;
      }
      return false;
    }
    this.duration += delta;
    var updated = false;
    if (this.begin < this.duration) {
      var newValue = this.calcValue();
      var typeAttr = this.getAttribute("type");
      if (typeAttr.hasValue()) {
        var type = typeAttr.getString();
        newValue = "".concat(type, "(").concat(newValue, ")");
      }
      prop.setValue(newValue);
      updated = true;
    }
    return updated;
  }
  getProgress() {
    var {
      document: document2,
      values
    } = this;
    var result = {
      progress: (this.duration - this.begin) / (this.maxDuration - this.begin)
    };
    if (values.hasValue()) {
      var p2 = result.progress * (values.getValue().length - 1);
      var lb = Math.floor(p2);
      var ub = Math.ceil(p2);
      result.from = new Property(document2, "from", parseFloat(values.getValue()[lb]));
      result.to = new Property(document2, "to", parseFloat(values.getValue()[ub]));
      result.progress = (p2 - lb) / (ub - lb);
    } else {
      result.from = this.from;
      result.to = this.to;
    }
    return result;
  }
};
var AnimateColorElement = class extends AnimateElement {
  constructor() {
    super(...arguments);
    this.type = "animateColor";
  }
  calcValue() {
    var {
      progress,
      from,
      to
    } = this.getProgress();
    var colorFrom = new import_rgbcolor.default(from.getColor());
    var colorTo = new import_rgbcolor.default(to.getColor());
    if (colorFrom.ok && colorTo.ok) {
      var r2 = colorFrom.r + (colorTo.r - colorFrom.r) * progress;
      var g = colorFrom.g + (colorTo.g - colorFrom.g) * progress;
      var b = colorFrom.b + (colorTo.b - colorFrom.b) * progress;
      return "rgb(".concat(Math.floor(r2), ", ").concat(Math.floor(g), ", ").concat(Math.floor(b), ")");
    }
    return this.getAttribute("from").getColor();
  }
};
var AnimateTransformElement = class extends AnimateElement {
  constructor() {
    super(...arguments);
    this.type = "animateTransform";
  }
  calcValue() {
    var {
      progress,
      from,
      to
    } = this.getProgress();
    var transformFrom = toNumbers(from.getString());
    var transformTo = toNumbers(to.getString());
    var newValue = transformFrom.map((from2, i2) => {
      var to2 = transformTo[i2];
      return from2 + (to2 - from2) * progress;
    }).join(" ");
    return newValue;
  }
};
var FontElement = class extends Element {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "font";
    this.glyphs = /* @__PURE__ */ Object.create(null);
    this.horizAdvX = this.getAttribute("horiz-adv-x").getNumber();
    var {
      definitions
    } = document2;
    var {
      children
    } = this;
    for (var child of children) {
      switch (child.type) {
        case "font-face": {
          this.fontFace = child;
          var fontFamilyStyle = child.getStyle("font-family");
          if (fontFamilyStyle.hasValue()) {
            definitions[fontFamilyStyle.getString()] = this;
          }
          break;
        }
        case "missing-glyph":
          this.missingGlyph = child;
          break;
        case "glyph": {
          var glyph = child;
          if (glyph.arabicForm) {
            this.isRTL = true;
            this.isArabic = true;
            if (typeof this.glyphs[glyph.unicode] === "undefined") {
              this.glyphs[glyph.unicode] = /* @__PURE__ */ Object.create(null);
            }
            this.glyphs[glyph.unicode][glyph.arabicForm] = glyph;
          } else {
            this.glyphs[glyph.unicode] = glyph;
          }
          break;
        }
      }
    }
  }
  render() {
  }
};
var FontFaceElement = class extends Element {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "font-face";
    this.ascent = this.getAttribute("ascent").getNumber();
    this.descent = this.getAttribute("descent").getNumber();
    this.unitsPerEm = this.getAttribute("units-per-em").getNumber();
  }
};
var MissingGlyphElement = class extends PathElement {
  constructor() {
    super(...arguments);
    this.type = "missing-glyph";
    this.horizAdvX = 0;
  }
};
var TRefElement = class extends TextElement {
  constructor() {
    super(...arguments);
    this.type = "tref";
  }
  getText() {
    var element = this.getHrefAttribute().getDefinition();
    if (element) {
      var firstChild = element.children[0];
      if (firstChild) {
        return firstChild.getText();
      }
    }
    return "";
  }
};
var AElement = class extends TextElement {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "a";
    var {
      childNodes
    } = node2;
    var firstChild = childNodes[0];
    var hasText = childNodes.length > 0 && Array.from(childNodes).every((node3) => node3.nodeType === 3);
    this.hasText = hasText;
    this.text = hasText ? this.getTextFromNode(firstChild) : "";
  }
  getText() {
    return this.text;
  }
  renderChildren(ctx) {
    if (this.hasText) {
      super.renderChildren(ctx);
      var {
        document: document2,
        x,
        y: y2
      } = this;
      var {
        mouse
      } = document2.screen;
      var fontSize = new Property(document2, "fontSize", Font.parse(document2.ctx.font).fontSize);
      if (mouse.isWorking()) {
        mouse.checkBoundingBox(this, new BoundingBox(x, y2 - fontSize.getPixels("y"), x + this.measureText(ctx), y2));
      }
    } else if (this.children.length > 0) {
      var g = new GElement(this.document, null);
      g.children = this.children;
      g.parent = this;
      g.render(ctx);
    }
  }
  onClick() {
    var {
      window: window2
    } = this.document;
    if (window2) {
      window2.open(this.getHrefAttribute().getString());
    }
  }
  onMouseMove() {
    var ctx = this.document.ctx;
    ctx.canvas.style.cursor = "pointer";
  }
};
function ownKeys$2(object, enumerableOnly) {
  var keys = Object.keys(object);
  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) {
      symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      });
    }
    keys.push.apply(keys, symbols);
  }
  return keys;
}
function _objectSpread$2(target) {
  for (var i2 = 1; i2 < arguments.length; i2++) {
    var source = arguments[i2] != null ? arguments[i2] : {};
    if (i2 % 2) {
      ownKeys$2(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys$2(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
  }
  return target;
}
var TextPathElement = class extends TextElement {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "textPath";
    this.textWidth = 0;
    this.textHeight = 0;
    this.pathLength = -1;
    this.glyphInfo = null;
    this.letterSpacingCache = [];
    this.measuresCache = /* @__PURE__ */ new Map([["", 0]]);
    var pathElement = this.getHrefAttribute().getDefinition();
    this.text = this.getTextFromNode();
    this.dataArray = this.parsePathData(pathElement);
  }
  getText() {
    return this.text;
  }
  path(ctx) {
    var {
      dataArray
    } = this;
    if (ctx) {
      ctx.beginPath();
    }
    dataArray.forEach((_ref) => {
      var {
        type,
        points
      } = _ref;
      switch (type) {
        case PathParser.LINE_TO:
          if (ctx) {
            ctx.lineTo(points[0], points[1]);
          }
          break;
        case PathParser.MOVE_TO:
          if (ctx) {
            ctx.moveTo(points[0], points[1]);
          }
          break;
        case PathParser.CURVE_TO:
          if (ctx) {
            ctx.bezierCurveTo(points[0], points[1], points[2], points[3], points[4], points[5]);
          }
          break;
        case PathParser.QUAD_TO:
          if (ctx) {
            ctx.quadraticCurveTo(points[0], points[1], points[2], points[3]);
          }
          break;
        case PathParser.ARC: {
          var [cx, cy, rx, ry, theta, dTheta, psi, fs] = points;
          var r2 = rx > ry ? rx : ry;
          var scaleX = rx > ry ? 1 : rx / ry;
          var scaleY = rx > ry ? ry / rx : 1;
          if (ctx) {
            ctx.translate(cx, cy);
            ctx.rotate(psi);
            ctx.scale(scaleX, scaleY);
            ctx.arc(0, 0, r2, theta, theta + dTheta, Boolean(1 - fs));
            ctx.scale(1 / scaleX, 1 / scaleY);
            ctx.rotate(-psi);
            ctx.translate(-cx, -cy);
          }
          break;
        }
        case PathParser.CLOSE_PATH:
          if (ctx) {
            ctx.closePath();
          }
          break;
      }
    });
  }
  renderChildren(ctx) {
    this.setTextData(ctx);
    ctx.save();
    var textDecoration = this.parent.getStyle("text-decoration").getString();
    var fontSize = this.getFontSize();
    var {
      glyphInfo
    } = this;
    var fill = ctx.fillStyle;
    if (textDecoration === "underline") {
      ctx.beginPath();
    }
    glyphInfo.forEach((glyph, i2) => {
      var {
        p0,
        p1,
        rotation,
        text: partialText
      } = glyph;
      ctx.save();
      ctx.translate(p0.x, p0.y);
      ctx.rotate(rotation);
      if (ctx.fillStyle) {
        ctx.fillText(partialText, 0, 0);
      }
      if (ctx.strokeStyle) {
        ctx.strokeText(partialText, 0, 0);
      }
      ctx.restore();
      if (textDecoration === "underline") {
        if (i2 === 0) {
          ctx.moveTo(p0.x, p0.y + fontSize / 8);
        }
        ctx.lineTo(p1.x, p1.y + fontSize / 5);
      }
    });
    if (textDecoration === "underline") {
      ctx.lineWidth = fontSize / 20;
      ctx.strokeStyle = fill;
      ctx.stroke();
      ctx.closePath();
    }
    ctx.restore();
  }
  getLetterSpacingAt() {
    var idx = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : 0;
    return this.letterSpacingCache[idx] || 0;
  }
  findSegmentToFitChar(ctx, anchor, textFullWidth, fullPathWidth, spacesNumber, inputOffset, dy, c3, charI) {
    var offset = inputOffset;
    var glyphWidth = this.measureText(ctx, c3);
    if (c3 === " " && anchor === "justify" && textFullWidth < fullPathWidth) {
      glyphWidth += (fullPathWidth - textFullWidth) / spacesNumber;
    }
    if (charI > -1) {
      offset += this.getLetterSpacingAt(charI);
    }
    var splineStep = this.textHeight / 20;
    var p0 = this.getEquidistantPointOnPath(offset, splineStep, 0);
    var p1 = this.getEquidistantPointOnPath(offset + glyphWidth, splineStep, 0);
    var segment = {
      p0,
      p1
    };
    var rotation = p0 && p1 ? Math.atan2(p1.y - p0.y, p1.x - p0.x) : 0;
    if (dy) {
      var dyX = Math.cos(Math.PI / 2 + rotation) * dy;
      var dyY = Math.cos(-rotation) * dy;
      segment.p0 = _objectSpread$2(_objectSpread$2({}, p0), {}, {
        x: p0.x + dyX,
        y: p0.y + dyY
      });
      segment.p1 = _objectSpread$2(_objectSpread$2({}, p1), {}, {
        x: p1.x + dyX,
        y: p1.y + dyY
      });
    }
    offset += glyphWidth;
    return {
      offset,
      segment,
      rotation
    };
  }
  measureText(ctx, text) {
    var {
      measuresCache
    } = this;
    var targetText = text || this.getText();
    if (measuresCache.has(targetText)) {
      return measuresCache.get(targetText);
    }
    var measure = this.measureTargetText(ctx, targetText);
    measuresCache.set(targetText, measure);
    return measure;
  }
  // This method supposes what all custom fonts already loaded.
  // If some font will be loaded after this method call, <textPath> will not be rendered correctly.
  // You need to call this method manually to update glyphs cache.
  setTextData(ctx) {
    if (this.glyphInfo) {
      return;
    }
    var renderText = this.getText();
    var chars = renderText.split("");
    var spacesNumber = renderText.split(" ").length - 1;
    var dx = this.parent.getAttribute("dx").split().map((_2) => _2.getPixels("x"));
    var dy = this.parent.getAttribute("dy").getPixels("y");
    var anchor = this.parent.getStyle("text-anchor").getString("start");
    var thisSpacing = this.getStyle("letter-spacing");
    var parentSpacing = this.parent.getStyle("letter-spacing");
    var letterSpacing = 0;
    if (!thisSpacing.hasValue() || thisSpacing.getValue() === "inherit") {
      letterSpacing = parentSpacing.getPixels();
    } else if (thisSpacing.hasValue()) {
      if (thisSpacing.getValue() !== "initial" && thisSpacing.getValue() !== "unset") {
        letterSpacing = thisSpacing.getPixels();
      }
    }
    var letterSpacingCache = [];
    var textLen = renderText.length;
    this.letterSpacingCache = letterSpacingCache;
    for (var i2 = 0; i2 < textLen; i2++) {
      letterSpacingCache.push(typeof dx[i2] !== "undefined" ? dx[i2] : letterSpacing);
    }
    var dxSum = letterSpacingCache.reduce((acc, cur, i3) => i3 === 0 ? 0 : acc + cur || 0, 0);
    var textWidth = this.measureText(ctx);
    var textFullWidth = Math.max(textWidth + dxSum, 0);
    this.textWidth = textWidth;
    this.textHeight = this.getFontSize();
    this.glyphInfo = [];
    var fullPathWidth = this.getPathLength();
    var startOffset = this.getStyle("startOffset").getNumber(0) * fullPathWidth;
    var offset = 0;
    if (anchor === "middle" || anchor === "center") {
      offset = -textFullWidth / 2;
    }
    if (anchor === "end" || anchor === "right") {
      offset = -textFullWidth;
    }
    offset += startOffset;
    chars.forEach((char, i3) => {
      var {
        offset: nextOffset,
        segment,
        rotation
      } = this.findSegmentToFitChar(ctx, anchor, textFullWidth, fullPathWidth, spacesNumber, offset, dy, char, i3);
      offset = nextOffset;
      if (!segment.p0 || !segment.p1) {
        return;
      }
      this.glyphInfo.push({
        // transposeX: midpoint.x,
        // transposeY: midpoint.y,
        text: chars[i3],
        p0: segment.p0,
        p1: segment.p1,
        rotation
      });
    });
  }
  parsePathData(path) {
    this.pathLength = -1;
    if (!path) {
      return [];
    }
    var pathCommands = [];
    var {
      pathParser
    } = path;
    pathParser.reset();
    while (!pathParser.isEnd()) {
      var {
        current
      } = pathParser;
      var startX = current ? current.x : 0;
      var startY = current ? current.y : 0;
      var command = pathParser.next();
      var nextCommandType = command.type;
      var points = [];
      switch (command.type) {
        case PathParser.MOVE_TO:
          this.pathM(pathParser, points);
          break;
        case PathParser.LINE_TO:
          nextCommandType = this.pathL(pathParser, points);
          break;
        case PathParser.HORIZ_LINE_TO:
          nextCommandType = this.pathH(pathParser, points);
          break;
        case PathParser.VERT_LINE_TO:
          nextCommandType = this.pathV(pathParser, points);
          break;
        case PathParser.CURVE_TO:
          this.pathC(pathParser, points);
          break;
        case PathParser.SMOOTH_CURVE_TO:
          nextCommandType = this.pathS(pathParser, points);
          break;
        case PathParser.QUAD_TO:
          this.pathQ(pathParser, points);
          break;
        case PathParser.SMOOTH_QUAD_TO:
          nextCommandType = this.pathT(pathParser, points);
          break;
        case PathParser.ARC:
          points = this.pathA(pathParser);
          break;
        case PathParser.CLOSE_PATH:
          PathElement.pathZ(pathParser);
          break;
      }
      if (command.type !== PathParser.CLOSE_PATH) {
        pathCommands.push({
          type: nextCommandType,
          points,
          start: {
            x: startX,
            y: startY
          },
          pathLength: this.calcLength(startX, startY, nextCommandType, points)
        });
      } else {
        pathCommands.push({
          type: PathParser.CLOSE_PATH,
          points: [],
          pathLength: 0
        });
      }
    }
    return pathCommands;
  }
  pathM(pathParser, points) {
    var {
      x,
      y: y2
    } = PathElement.pathM(pathParser).point;
    points.push(x, y2);
  }
  pathL(pathParser, points) {
    var {
      x,
      y: y2
    } = PathElement.pathL(pathParser).point;
    points.push(x, y2);
    return PathParser.LINE_TO;
  }
  pathH(pathParser, points) {
    var {
      x,
      y: y2
    } = PathElement.pathH(pathParser).point;
    points.push(x, y2);
    return PathParser.LINE_TO;
  }
  pathV(pathParser, points) {
    var {
      x,
      y: y2
    } = PathElement.pathV(pathParser).point;
    points.push(x, y2);
    return PathParser.LINE_TO;
  }
  pathC(pathParser, points) {
    var {
      point,
      controlPoint,
      currentPoint
    } = PathElement.pathC(pathParser);
    points.push(point.x, point.y, controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
  }
  pathS(pathParser, points) {
    var {
      point,
      controlPoint,
      currentPoint
    } = PathElement.pathS(pathParser);
    points.push(point.x, point.y, controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
    return PathParser.CURVE_TO;
  }
  pathQ(pathParser, points) {
    var {
      controlPoint,
      currentPoint
    } = PathElement.pathQ(pathParser);
    points.push(controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
  }
  pathT(pathParser, points) {
    var {
      controlPoint,
      currentPoint
    } = PathElement.pathT(pathParser);
    points.push(controlPoint.x, controlPoint.y, currentPoint.x, currentPoint.y);
    return PathParser.QUAD_TO;
  }
  pathA(pathParser) {
    var {
      rX,
      rY,
      sweepFlag,
      xAxisRotation,
      centp,
      a1,
      ad
    } = PathElement.pathA(pathParser);
    if (sweepFlag === 0 && ad > 0) {
      ad -= 2 * Math.PI;
    }
    if (sweepFlag === 1 && ad < 0) {
      ad += 2 * Math.PI;
    }
    return [centp.x, centp.y, rX, rY, a1, ad, xAxisRotation, sweepFlag];
  }
  calcLength(x, y2, commandType, points) {
    var len = 0;
    var p1 = null;
    var p2 = null;
    var t2 = 0;
    switch (commandType) {
      case PathParser.LINE_TO:
        return this.getLineLength(x, y2, points[0], points[1]);
      case PathParser.CURVE_TO:
        len = 0;
        p1 = this.getPointOnCubicBezier(0, x, y2, points[0], points[1], points[2], points[3], points[4], points[5]);
        for (t2 = 0.01; t2 <= 1; t2 += 0.01) {
          p2 = this.getPointOnCubicBezier(t2, x, y2, points[0], points[1], points[2], points[3], points[4], points[5]);
          len += this.getLineLength(p1.x, p1.y, p2.x, p2.y);
          p1 = p2;
        }
        return len;
      case PathParser.QUAD_TO:
        len = 0;
        p1 = this.getPointOnQuadraticBezier(0, x, y2, points[0], points[1], points[2], points[3]);
        for (t2 = 0.01; t2 <= 1; t2 += 0.01) {
          p2 = this.getPointOnQuadraticBezier(t2, x, y2, points[0], points[1], points[2], points[3]);
          len += this.getLineLength(p1.x, p1.y, p2.x, p2.y);
          p1 = p2;
        }
        return len;
      case PathParser.ARC: {
        len = 0;
        var start = points[4];
        var dTheta = points[5];
        var end = points[4] + dTheta;
        var inc = Math.PI / 180;
        if (Math.abs(start - end) < inc) {
          inc = Math.abs(start - end);
        }
        p1 = this.getPointOnEllipticalArc(points[0], points[1], points[2], points[3], start, 0);
        if (dTheta < 0) {
          for (t2 = start - inc; t2 > end; t2 -= inc) {
            p2 = this.getPointOnEllipticalArc(points[0], points[1], points[2], points[3], t2, 0);
            len += this.getLineLength(p1.x, p1.y, p2.x, p2.y);
            p1 = p2;
          }
        } else {
          for (t2 = start + inc; t2 < end; t2 += inc) {
            p2 = this.getPointOnEllipticalArc(points[0], points[1], points[2], points[3], t2, 0);
            len += this.getLineLength(p1.x, p1.y, p2.x, p2.y);
            p1 = p2;
          }
        }
        p2 = this.getPointOnEllipticalArc(points[0], points[1], points[2], points[3], end, 0);
        len += this.getLineLength(p1.x, p1.y, p2.x, p2.y);
        return len;
      }
    }
    return 0;
  }
  getPointOnLine(dist, p1x, p1y, p2x, p2y) {
    var fromX = arguments.length > 5 && arguments[5] !== void 0 ? arguments[5] : p1x;
    var fromY = arguments.length > 6 && arguments[6] !== void 0 ? arguments[6] : p1y;
    var m3 = (p2y - p1y) / (p2x - p1x + PSEUDO_ZERO);
    var run = Math.sqrt(dist * dist / (1 + m3 * m3));
    if (p2x < p1x) {
      run *= -1;
    }
    var rise = m3 * run;
    var pt = null;
    if (p2x === p1x) {
      pt = {
        x: fromX,
        y: fromY + rise
      };
    } else if ((fromY - p1y) / (fromX - p1x + PSEUDO_ZERO) === m3) {
      pt = {
        x: fromX + run,
        y: fromY + rise
      };
    } else {
      var ix = 0;
      var iy = 0;
      var len = this.getLineLength(p1x, p1y, p2x, p2y);
      if (len < PSEUDO_ZERO) {
        return null;
      }
      var u2 = (fromX - p1x) * (p2x - p1x) + (fromY - p1y) * (p2y - p1y);
      u2 /= len * len;
      ix = p1x + u2 * (p2x - p1x);
      iy = p1y + u2 * (p2y - p1y);
      var pRise = this.getLineLength(fromX, fromY, ix, iy);
      var pRun = Math.sqrt(dist * dist - pRise * pRise);
      run = Math.sqrt(pRun * pRun / (1 + m3 * m3));
      if (p2x < p1x) {
        run *= -1;
      }
      rise = m3 * run;
      pt = {
        x: ix + run,
        y: iy + rise
      };
    }
    return pt;
  }
  getPointOnPath(distance) {
    var fullLen = this.getPathLength();
    var cumulativePathLength = 0;
    var p2 = null;
    if (distance < -5e-5 || distance - 5e-5 > fullLen) {
      return null;
    }
    var {
      dataArray
    } = this;
    for (var command of dataArray) {
      if (command && (command.pathLength < 5e-5 || cumulativePathLength + command.pathLength + 5e-5 < distance)) {
        cumulativePathLength += command.pathLength;
        continue;
      }
      var delta = distance - cumulativePathLength;
      var currentT = 0;
      switch (command.type) {
        case PathParser.LINE_TO:
          p2 = this.getPointOnLine(delta, command.start.x, command.start.y, command.points[0], command.points[1], command.start.x, command.start.y);
          break;
        case PathParser.ARC: {
          var start = command.points[4];
          var dTheta = command.points[5];
          var end = command.points[4] + dTheta;
          currentT = start + delta / command.pathLength * dTheta;
          if (dTheta < 0 && currentT < end || dTheta >= 0 && currentT > end) {
            break;
          }
          p2 = this.getPointOnEllipticalArc(command.points[0], command.points[1], command.points[2], command.points[3], currentT, command.points[6]);
          break;
        }
        case PathParser.CURVE_TO:
          currentT = delta / command.pathLength;
          if (currentT > 1) {
            currentT = 1;
          }
          p2 = this.getPointOnCubicBezier(currentT, command.start.x, command.start.y, command.points[0], command.points[1], command.points[2], command.points[3], command.points[4], command.points[5]);
          break;
        case PathParser.QUAD_TO:
          currentT = delta / command.pathLength;
          if (currentT > 1) {
            currentT = 1;
          }
          p2 = this.getPointOnQuadraticBezier(currentT, command.start.x, command.start.y, command.points[0], command.points[1], command.points[2], command.points[3]);
          break;
      }
      if (p2) {
        return p2;
      }
      break;
    }
    return null;
  }
  getLineLength(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
  }
  getPathLength() {
    if (this.pathLength === -1) {
      this.pathLength = this.dataArray.reduce((length, command) => command.pathLength > 0 ? length + command.pathLength : length, 0);
    }
    return this.pathLength;
  }
  getPointOnCubicBezier(pct, p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y) {
    var x = p4x * CB1(pct) + p3x * CB2(pct) + p2x * CB3(pct) + p1x * CB4(pct);
    var y2 = p4y * CB1(pct) + p3y * CB2(pct) + p2y * CB3(pct) + p1y * CB4(pct);
    return {
      x,
      y: y2
    };
  }
  getPointOnQuadraticBezier(pct, p1x, p1y, p2x, p2y, p3x, p3y) {
    var x = p3x * QB1(pct) + p2x * QB2(pct) + p1x * QB3(pct);
    var y2 = p3y * QB1(pct) + p2y * QB2(pct) + p1y * QB3(pct);
    return {
      x,
      y: y2
    };
  }
  getPointOnEllipticalArc(cx, cy, rx, ry, theta, psi) {
    var cosPsi = Math.cos(psi);
    var sinPsi = Math.sin(psi);
    var pt = {
      x: rx * Math.cos(theta),
      y: ry * Math.sin(theta)
    };
    return {
      x: cx + (pt.x * cosPsi - pt.y * sinPsi),
      y: cy + (pt.x * sinPsi + pt.y * cosPsi)
    };
  }
  // TODO need some optimisations. possibly build cache only for curved segments?
  buildEquidistantCache(inputStep, inputPrecision) {
    var fullLen = this.getPathLength();
    var precision = inputPrecision || 0.25;
    var step = inputStep || fullLen / 100;
    if (!this.equidistantCache || this.equidistantCache.step !== step || this.equidistantCache.precision !== precision) {
      this.equidistantCache = {
        step,
        precision,
        points: []
      };
      var s2 = 0;
      for (var l2 = 0; l2 <= fullLen; l2 += precision) {
        var p0 = this.getPointOnPath(l2);
        var p1 = this.getPointOnPath(l2 + precision);
        if (!p0 || !p1) {
          continue;
        }
        s2 += this.getLineLength(p0.x, p0.y, p1.x, p1.y);
        if (s2 >= step) {
          this.equidistantCache.points.push({
            x: p0.x,
            y: p0.y,
            distance: l2
          });
          s2 -= step;
        }
      }
    }
  }
  getEquidistantPointOnPath(targetDistance, step, precision) {
    this.buildEquidistantCache(step, precision);
    if (targetDistance < 0 || targetDistance - this.getPathLength() > 5e-5) {
      return null;
    }
    var idx = Math.round(targetDistance / this.getPathLength() * (this.equidistantCache.points.length - 1));
    return this.equidistantCache.points[idx] || null;
  }
};
var dataUriRegex = /^\s*data:(([^/,;]+\/[^/,;]+)(?:;([^,;=]+=[^,;=]+))?)?(?:;(base64))?,(.*)$/i;
var ImageElement = class extends RenderedElement {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "image";
    this.loaded = false;
    var href = this.getHrefAttribute().getString();
    if (!href) {
      return;
    }
    var isSvg = href.endsWith(".svg") || /^\s*data:image\/svg\+xml/i.test(href);
    document2.images.push(this);
    if (!isSvg) {
      void this.loadImage(href);
    } else {
      void this.loadSvg(href);
    }
    this.isSvg = isSvg;
  }
  loadImage(href) {
    var _this = this;
    return _asyncToGenerator(function* () {
      try {
        var image = yield _this.document.createImage(href);
        _this.image = image;
      } catch (err) {
        console.error('Error while loading image "'.concat(href, '":'), err);
      }
      _this.loaded = true;
    })();
  }
  loadSvg(href) {
    var _this2 = this;
    return _asyncToGenerator(function* () {
      var match = dataUriRegex.exec(href);
      if (match) {
        var data = match[5];
        if (match[4] === "base64") {
          _this2.image = atob(data);
        } else {
          _this2.image = decodeURIComponent(data);
        }
      } else {
        try {
          var response = yield _this2.document.fetch(href);
          var svg = yield response.text();
          _this2.image = svg;
        } catch (err) {
          console.error('Error while loading image "'.concat(href, '":'), err);
        }
      }
      _this2.loaded = true;
    })();
  }
  renderChildren(ctx) {
    var {
      document: document2,
      image,
      loaded
    } = this;
    var x = this.getAttribute("x").getPixels("x");
    var y2 = this.getAttribute("y").getPixels("y");
    var width = this.getStyle("width").getPixels("x");
    var height = this.getStyle("height").getPixels("y");
    if (!loaded || !image || !width || !height) {
      return;
    }
    ctx.save();
    ctx.translate(x, y2);
    if (this.isSvg) {
      var subDocument = document2.canvg.forkString(ctx, this.image, {
        ignoreMouse: true,
        ignoreAnimation: true,
        ignoreDimensions: true,
        ignoreClear: true,
        offsetX: 0,
        offsetY: 0,
        scaleWidth: width,
        scaleHeight: height
      });
      subDocument.document.documentElement.parent = this;
      void subDocument.render();
    } else {
      var _image = this.image;
      document2.setViewBox({
        ctx,
        aspectRatio: this.getAttribute("preserveAspectRatio").getString(),
        width,
        desiredWidth: _image.width,
        height,
        desiredHeight: _image.height
      });
      if (this.loaded) {
        if (typeof _image.complete === "undefined" || _image.complete) {
          ctx.drawImage(_image, 0, 0);
        }
      }
    }
    ctx.restore();
  }
  getBoundingBox() {
    var x = this.getAttribute("x").getPixels("x");
    var y2 = this.getAttribute("y").getPixels("y");
    var width = this.getStyle("width").getPixels("x");
    var height = this.getStyle("height").getPixels("y");
    return new BoundingBox(x, y2, x + width, y2 + height);
  }
};
var SymbolElement = class extends RenderedElement {
  constructor() {
    super(...arguments);
    this.type = "symbol";
  }
  render(_2) {
  }
};
var SVGFontLoader = class {
  constructor(document2) {
    this.document = document2;
    this.loaded = false;
    document2.fonts.push(this);
  }
  load(fontFamily, url) {
    var _this = this;
    return _asyncToGenerator(function* () {
      try {
        var {
          document: document2
        } = _this;
        var svgDocument = yield document2.canvg.parser.load(url);
        var fonts = svgDocument.getElementsByTagName("font");
        Array.from(fonts).forEach((fontNode) => {
          var font = document2.createElement(fontNode);
          document2.definitions[fontFamily] = font;
        });
      } catch (err) {
        console.error('Error while loading font "'.concat(url, '":'), err);
      }
      _this.loaded = true;
    })();
  }
};
var StyleElement = class extends Element {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "style";
    var css = compressSpaces(
      Array.from(node2.childNodes).map((_2) => _2.textContent).join("").replace(/(\/\*([^*]|[\r\n]|(\*+([^*/]|[\r\n])))*\*+\/)|(^[\s]*\/\/.*)/gm, "").replace(/@import.*;/g, "")
      // remove imports
    );
    var cssDefs = css.split("}");
    cssDefs.forEach((_2) => {
      var def = _2.trim();
      if (!def) {
        return;
      }
      var cssParts = def.split("{");
      var cssClasses = cssParts[0].split(",");
      var cssProps = cssParts[1].split(";");
      cssClasses.forEach((_3) => {
        var cssClass = _3.trim();
        if (!cssClass) {
          return;
        }
        var props = document2.styles[cssClass] || {};
        cssProps.forEach((cssProp) => {
          var prop = cssProp.indexOf(":");
          var name = cssProp.substr(0, prop).trim();
          var value = cssProp.substr(prop + 1, cssProp.length - prop).trim();
          if (name && value) {
            props[name] = new Property(document2, name, value);
          }
        });
        document2.styles[cssClass] = props;
        document2.stylesSpecificity[cssClass] = getSelectorSpecificity(cssClass);
        if (cssClass === "@font-face") {
          var fontFamily = props["font-family"].getString().replace(/"|'/g, "");
          var srcs = props.src.getString().split(",");
          srcs.forEach((src) => {
            if (src.indexOf('format("svg")') > 0) {
              var url = parseExternalUrl(src);
              if (url) {
                void new SVGFontLoader(document2).load(fontFamily, url);
              }
            }
          });
        }
      });
    });
  }
};
StyleElement.parseExternalUrl = parseExternalUrl;
var UseElement = class extends RenderedElement {
  constructor() {
    super(...arguments);
    this.type = "use";
  }
  setContext(ctx) {
    super.setContext(ctx);
    var xAttr = this.getAttribute("x");
    var yAttr = this.getAttribute("y");
    if (xAttr.hasValue()) {
      ctx.translate(xAttr.getPixels("x"), 0);
    }
    if (yAttr.hasValue()) {
      ctx.translate(0, yAttr.getPixels("y"));
    }
  }
  path(ctx) {
    var {
      element
    } = this;
    if (element) {
      element.path(ctx);
    }
  }
  renderChildren(ctx) {
    var {
      document: document2,
      element
    } = this;
    if (element) {
      var tempSvg = element;
      if (element.type === "symbol") {
        tempSvg = new SVGElement(document2, null);
        tempSvg.attributes.viewBox = new Property(document2, "viewBox", element.getAttribute("viewBox").getString());
        tempSvg.attributes.preserveAspectRatio = new Property(document2, "preserveAspectRatio", element.getAttribute("preserveAspectRatio").getString());
        tempSvg.attributes.overflow = new Property(document2, "overflow", element.getAttribute("overflow").getString());
        tempSvg.children = element.children;
        element.styles.opacity = new Property(document2, "opacity", this.calculateOpacity());
      }
      if (tempSvg.type === "svg") {
        var widthStyle = this.getStyle("width", false, true);
        var heightStyle = this.getStyle("height", false, true);
        if (widthStyle.hasValue()) {
          tempSvg.attributes.width = new Property(document2, "width", widthStyle.getString());
        }
        if (heightStyle.hasValue()) {
          tempSvg.attributes.height = new Property(document2, "height", heightStyle.getString());
        }
      }
      var oldParent = tempSvg.parent;
      tempSvg.parent = this;
      tempSvg.render(ctx);
      tempSvg.parent = oldParent;
    }
  }
  getBoundingBox(ctx) {
    var {
      element
    } = this;
    if (element) {
      return element.getBoundingBox(ctx);
    }
    return null;
  }
  elementTransform() {
    var {
      document: document2,
      element
    } = this;
    return Transform.fromElement(document2, element);
  }
  get element() {
    if (!this.cachedElement) {
      this.cachedElement = this.getHrefAttribute().getDefinition();
    }
    return this.cachedElement;
  }
};
function imGet(img, x, y2, width, _height, rgba) {
  return img[y2 * width * 4 + x * 4 + rgba];
}
function imSet(img, x, y2, width, _height, rgba, val) {
  img[y2 * width * 4 + x * 4 + rgba] = val;
}
function m2(matrix, i2, v2) {
  var mi = matrix[i2];
  return mi * v2;
}
function c2(a2, m1, m22, m3) {
  return m1 + Math.cos(a2) * m22 + Math.sin(a2) * m3;
}
var FeColorMatrixElement = class extends Element {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "feColorMatrix";
    var matrix = toNumbers(this.getAttribute("values").getString());
    switch (this.getAttribute("type").getString("matrix")) {
      case "saturate": {
        var s2 = matrix[0];
        matrix = [0.213 + 0.787 * s2, 0.715 - 0.715 * s2, 0.072 - 0.072 * s2, 0, 0, 0.213 - 0.213 * s2, 0.715 + 0.285 * s2, 0.072 - 0.072 * s2, 0, 0, 0.213 - 0.213 * s2, 0.715 - 0.715 * s2, 0.072 + 0.928 * s2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
        break;
      }
      case "hueRotate": {
        var a2 = matrix[0] * Math.PI / 180;
        matrix = [c2(a2, 0.213, 0.787, -0.213), c2(a2, 0.715, -0.715, -0.715), c2(a2, 0.072, -0.072, 0.928), 0, 0, c2(a2, 0.213, -0.213, 0.143), c2(a2, 0.715, 0.285, 0.14), c2(a2, 0.072, -0.072, -0.283), 0, 0, c2(a2, 0.213, -0.213, -0.787), c2(a2, 0.715, -0.715, 0.715), c2(a2, 0.072, 0.928, 0.072), 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
        break;
      }
      case "luminanceToAlpha":
        matrix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2125, 0.7154, 0.0721, 0, 0, 0, 0, 0, 0, 1];
        break;
    }
    this.matrix = matrix;
    this.includeOpacity = this.getAttribute("includeOpacity").hasValue();
  }
  apply(ctx, _x, _y, width, height) {
    var {
      includeOpacity,
      matrix
    } = this;
    var srcData = ctx.getImageData(0, 0, width, height);
    for (var y2 = 0; y2 < height; y2++) {
      for (var x = 0; x < width; x++) {
        var r2 = imGet(srcData.data, x, y2, width, height, 0);
        var g = imGet(srcData.data, x, y2, width, height, 1);
        var b = imGet(srcData.data, x, y2, width, height, 2);
        var a2 = imGet(srcData.data, x, y2, width, height, 3);
        var nr = m2(matrix, 0, r2) + m2(matrix, 1, g) + m2(matrix, 2, b) + m2(matrix, 3, a2) + m2(matrix, 4, 1);
        var ng = m2(matrix, 5, r2) + m2(matrix, 6, g) + m2(matrix, 7, b) + m2(matrix, 8, a2) + m2(matrix, 9, 1);
        var nb = m2(matrix, 10, r2) + m2(matrix, 11, g) + m2(matrix, 12, b) + m2(matrix, 13, a2) + m2(matrix, 14, 1);
        var na = m2(matrix, 15, r2) + m2(matrix, 16, g) + m2(matrix, 17, b) + m2(matrix, 18, a2) + m2(matrix, 19, 1);
        if (includeOpacity) {
          nr = 0;
          ng = 0;
          nb = 0;
          na *= a2 / 255;
        }
        imSet(srcData.data, x, y2, width, height, 0, nr);
        imSet(srcData.data, x, y2, width, height, 1, ng);
        imSet(srcData.data, x, y2, width, height, 2, nb);
        imSet(srcData.data, x, y2, width, height, 3, na);
      }
    }
    ctx.clearRect(0, 0, width, height);
    ctx.putImageData(srcData, 0, 0);
  }
};
var MaskElement = class _MaskElement extends Element {
  constructor() {
    super(...arguments);
    this.type = "mask";
  }
  apply(ctx, element) {
    var {
      document: document2
    } = this;
    var x = this.getAttribute("x").getPixels("x");
    var y2 = this.getAttribute("y").getPixels("y");
    var width = this.getStyle("width").getPixels("x");
    var height = this.getStyle("height").getPixels("y");
    if (!width && !height) {
      var boundingBox = new BoundingBox();
      this.children.forEach((child) => {
        boundingBox.addBoundingBox(child.getBoundingBox(ctx));
      });
      x = Math.floor(boundingBox.x1);
      y2 = Math.floor(boundingBox.y1);
      width = Math.floor(boundingBox.width);
      height = Math.floor(boundingBox.height);
    }
    var ignoredStyles = this.removeStyles(element, _MaskElement.ignoreStyles);
    var maskCanvas = document2.createCanvas(x + width, y2 + height);
    var maskCtx = maskCanvas.getContext("2d");
    document2.screen.setDefaults(maskCtx);
    this.renderChildren(maskCtx);
    new FeColorMatrixElement(document2, {
      nodeType: 1,
      childNodes: [],
      attributes: [{
        nodeName: "type",
        value: "luminanceToAlpha"
      }, {
        nodeName: "includeOpacity",
        value: "true"
      }]
    }).apply(maskCtx, 0, 0, x + width, y2 + height);
    var tmpCanvas = document2.createCanvas(x + width, y2 + height);
    var tmpCtx = tmpCanvas.getContext("2d");
    document2.screen.setDefaults(tmpCtx);
    element.render(tmpCtx);
    tmpCtx.globalCompositeOperation = "destination-in";
    tmpCtx.fillStyle = maskCtx.createPattern(maskCanvas, "no-repeat");
    tmpCtx.fillRect(0, 0, x + width, y2 + height);
    ctx.fillStyle = tmpCtx.createPattern(tmpCanvas, "no-repeat");
    ctx.fillRect(0, 0, x + width, y2 + height);
    this.restoreStyles(element, ignoredStyles);
  }
  render(_2) {
  }
};
MaskElement.ignoreStyles = ["mask", "transform", "clip-path"];
var noop = () => {
};
var ClipPathElement = class extends Element {
  constructor() {
    super(...arguments);
    this.type = "clipPath";
  }
  apply(ctx) {
    var {
      document: document2
    } = this;
    var contextProto = Reflect.getPrototypeOf(ctx);
    var {
      beginPath,
      closePath
    } = ctx;
    if (contextProto) {
      contextProto.beginPath = noop;
      contextProto.closePath = noop;
    }
    Reflect.apply(beginPath, ctx, []);
    this.children.forEach((child) => {
      if (typeof child.path === "undefined") {
        return;
      }
      var transform = typeof child.elementTransform !== "undefined" ? child.elementTransform() : null;
      if (!transform) {
        transform = Transform.fromElement(document2, child);
      }
      if (transform) {
        transform.apply(ctx);
      }
      child.path(ctx);
      if (contextProto) {
        contextProto.closePath = closePath;
      }
      if (transform) {
        transform.unapply(ctx);
      }
    });
    Reflect.apply(closePath, ctx, []);
    ctx.clip();
    if (contextProto) {
      contextProto.beginPath = beginPath;
      contextProto.closePath = closePath;
    }
  }
  render(_2) {
  }
};
var FilterElement = class _FilterElement extends Element {
  constructor() {
    super(...arguments);
    this.type = "filter";
  }
  apply(ctx, element) {
    var {
      document: document2,
      children
    } = this;
    var boundingBox = element.getBoundingBox(ctx);
    if (!boundingBox) {
      return;
    }
    var px = 0;
    var py = 0;
    children.forEach((child) => {
      var efd = child.extraFilterDistance || 0;
      px = Math.max(px, efd);
      py = Math.max(py, efd);
    });
    var width = Math.floor(boundingBox.width);
    var height = Math.floor(boundingBox.height);
    var tmpCanvasWidth = width + 2 * px;
    var tmpCanvasHeight = height + 2 * py;
    if (tmpCanvasWidth < 1 || tmpCanvasHeight < 1) {
      return;
    }
    var x = Math.floor(boundingBox.x);
    var y2 = Math.floor(boundingBox.y);
    var ignoredStyles = this.removeStyles(element, _FilterElement.ignoreStyles);
    var tmpCanvas = document2.createCanvas(tmpCanvasWidth, tmpCanvasHeight);
    var tmpCtx = tmpCanvas.getContext("2d");
    document2.screen.setDefaults(tmpCtx);
    tmpCtx.translate(-x + px, -y2 + py);
    element.render(tmpCtx);
    children.forEach((child) => {
      if (typeof child.apply === "function") {
        child.apply(tmpCtx, 0, 0, tmpCanvasWidth, tmpCanvasHeight);
      }
    });
    ctx.drawImage(tmpCanvas, 0, 0, tmpCanvasWidth, tmpCanvasHeight, x - px, y2 - py, tmpCanvasWidth, tmpCanvasHeight);
    this.restoreStyles(element, ignoredStyles);
  }
  render(_2) {
  }
};
FilterElement.ignoreStyles = ["filter", "transform", "clip-path"];
var FeDropShadowElement = class extends Element {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "feDropShadow";
    this.addStylesFromStyleDefinition();
  }
  apply(_2, _x, _y, _width, _height) {
  }
};
var FeMorphologyElement = class extends Element {
  constructor() {
    super(...arguments);
    this.type = "feMorphology";
  }
  apply(_2, _x, _y, _width, _height) {
  }
};
var FeCompositeElement = class extends Element {
  constructor() {
    super(...arguments);
    this.type = "feComposite";
  }
  apply(_2, _x, _y, _width, _height) {
  }
};
var FeGaussianBlurElement = class extends Element {
  constructor(document2, node2, captureTextNodes) {
    super(document2, node2, captureTextNodes);
    this.type = "feGaussianBlur";
    this.blurRadius = Math.floor(this.getAttribute("stdDeviation").getNumber());
    this.extraFilterDistance = this.blurRadius;
  }
  apply(ctx, x, y2, width, height) {
    var {
      document: document2,
      blurRadius
    } = this;
    var body = document2.window ? document2.window.document.body : null;
    var canvas = ctx.canvas;
    canvas.id = document2.getUniqueId();
    if (body) {
      canvas.style.display = "none";
      body.appendChild(canvas);
    }
    processCanvasRGBA(canvas, x, y2, width, height, blurRadius);
    if (body) {
      body.removeChild(canvas);
    }
  }
};
var TitleElement = class extends Element {
  constructor() {
    super(...arguments);
    this.type = "title";
  }
};
var DescElement = class extends Element {
  constructor() {
    super(...arguments);
    this.type = "desc";
  }
};
var elements = {
  "svg": SVGElement,
  "rect": RectElement,
  "circle": CircleElement,
  "ellipse": EllipseElement,
  "line": LineElement,
  "polyline": PolylineElement,
  "polygon": PolygonElement,
  "path": PathElement,
  "pattern": PatternElement,
  "marker": MarkerElement,
  "defs": DefsElement,
  "linearGradient": LinearGradientElement,
  "radialGradient": RadialGradientElement,
  "stop": StopElement,
  "animate": AnimateElement,
  "animateColor": AnimateColorElement,
  "animateTransform": AnimateTransformElement,
  "font": FontElement,
  "font-face": FontFaceElement,
  "missing-glyph": MissingGlyphElement,
  "glyph": GlyphElement,
  "text": TextElement,
  "tspan": TSpanElement,
  "tref": TRefElement,
  "a": AElement,
  "textPath": TextPathElement,
  "image": ImageElement,
  "g": GElement,
  "symbol": SymbolElement,
  "style": StyleElement,
  "use": UseElement,
  "mask": MaskElement,
  "clipPath": ClipPathElement,
  "filter": FilterElement,
  "feDropShadow": FeDropShadowElement,
  "feMorphology": FeMorphologyElement,
  "feComposite": FeCompositeElement,
  "feColorMatrix": FeColorMatrixElement,
  "feGaussianBlur": FeGaussianBlurElement,
  "title": TitleElement,
  "desc": DescElement
};
function ownKeys$1(object, enumerableOnly) {
  var keys = Object.keys(object);
  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) {
      symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      });
    }
    keys.push.apply(keys, symbols);
  }
  return keys;
}
function _objectSpread$1(target) {
  for (var i2 = 1; i2 < arguments.length; i2++) {
    var source = arguments[i2] != null ? arguments[i2] : {};
    if (i2 % 2) {
      ownKeys$1(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys$1(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
  }
  return target;
}
function createCanvas(width, height) {
  var canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
function createImage(_x) {
  return _createImage.apply(this, arguments);
}
function _createImage() {
  _createImage = _asyncToGenerator(function* (src) {
    var anonymousCrossOrigin = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : false;
    var image = document.createElement("img");
    if (anonymousCrossOrigin) {
      image.crossOrigin = "Anonymous";
    }
    return new Promise((resolve, reject) => {
      image.onload = () => {
        resolve(image);
      };
      image.onerror = (_event, _source, _lineno, _colno, error) => {
        reject(error);
      };
      image.src = src;
    });
  });
  return _createImage.apply(this, arguments);
}
var Document = class _Document {
  constructor(canvg) {
    var {
      rootEmSize = 12,
      emSize = 12,
      createCanvas: createCanvas2 = _Document.createCanvas,
      createImage: createImage2 = _Document.createImage,
      anonymousCrossOrigin
    } = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
    this.canvg = canvg;
    this.definitions = /* @__PURE__ */ Object.create(null);
    this.styles = /* @__PURE__ */ Object.create(null);
    this.stylesSpecificity = /* @__PURE__ */ Object.create(null);
    this.images = [];
    this.fonts = [];
    this.emSizeStack = [];
    this.uniqueId = 0;
    this.screen = canvg.screen;
    this.rootEmSize = rootEmSize;
    this.emSize = emSize;
    this.createCanvas = createCanvas2;
    this.createImage = this.bindCreateImage(createImage2, anonymousCrossOrigin);
    this.screen.wait(this.isImagesLoaded.bind(this));
    this.screen.wait(this.isFontsLoaded.bind(this));
  }
  bindCreateImage(createImage2, anonymousCrossOrigin) {
    if (typeof anonymousCrossOrigin === "boolean") {
      return (source, forceAnonymousCrossOrigin) => createImage2(source, typeof forceAnonymousCrossOrigin === "boolean" ? forceAnonymousCrossOrigin : anonymousCrossOrigin);
    }
    return createImage2;
  }
  get window() {
    return this.screen.window;
  }
  get fetch() {
    return this.screen.fetch;
  }
  get ctx() {
    return this.screen.ctx;
  }
  get emSize() {
    var {
      emSizeStack
    } = this;
    return emSizeStack[emSizeStack.length - 1];
  }
  set emSize(value) {
    var {
      emSizeStack
    } = this;
    emSizeStack.push(value);
  }
  popEmSize() {
    var {
      emSizeStack
    } = this;
    emSizeStack.pop();
  }
  getUniqueId() {
    return "canvg".concat(++this.uniqueId);
  }
  isImagesLoaded() {
    return this.images.every((_2) => _2.loaded);
  }
  isFontsLoaded() {
    return this.fonts.every((_2) => _2.loaded);
  }
  createDocumentElement(document2) {
    var documentElement = this.createElement(document2.documentElement);
    documentElement.root = true;
    documentElement.addStylesFromStyleDefinition();
    this.documentElement = documentElement;
    return documentElement;
  }
  createElement(node2) {
    var elementType = node2.nodeName.replace(/^[^:]+:/, "");
    var ElementType = _Document.elementTypes[elementType];
    if (typeof ElementType !== "undefined") {
      return new ElementType(this, node2);
    }
    return new UnknownElement(this, node2);
  }
  createTextNode(node2) {
    return new TextNode(this, node2);
  }
  setViewBox(config) {
    this.screen.setViewBox(_objectSpread$1({
      document: this
    }, config));
  }
};
Document.createCanvas = createCanvas;
Document.createImage = createImage;
Document.elementTypes = elements;
function ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);
  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly) {
      symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      });
    }
    keys.push.apply(keys, symbols);
  }
  return keys;
}
function _objectSpread(target) {
  for (var i2 = 1; i2 < arguments.length; i2++) {
    var source = arguments[i2] != null ? arguments[i2] : {};
    if (i2 % 2) {
      ownKeys(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
  }
  return target;
}
var Canvg = class _Canvg {
  /**
   * Main constructor.
   * @param ctx - Rendering context.
   * @param svg - SVG Document.
   * @param options - Rendering options.
   */
  constructor(ctx, svg) {
    var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
    this.parser = new Parser(options);
    this.screen = new Screen(ctx, options);
    this.options = options;
    var document2 = new Document(this, options);
    var documentElement = document2.createDocumentElement(svg);
    this.document = document2;
    this.documentElement = documentElement;
  }
  /**
   * Create Canvg instance from SVG source string or URL.
   * @param ctx - Rendering context.
   * @param svg - SVG source string or URL.
   * @param options - Rendering options.
   * @returns Canvg instance.
   */
  static from(ctx, svg) {
    var _arguments = arguments;
    return _asyncToGenerator(function* () {
      var options = _arguments.length > 2 && _arguments[2] !== void 0 ? _arguments[2] : {};
      var parser = new Parser(options);
      var svgDocument = yield parser.parse(svg);
      return new _Canvg(ctx, svgDocument, options);
    })();
  }
  /**
   * Create Canvg instance from SVG source string.
   * @param ctx - Rendering context.
   * @param svg - SVG source string.
   * @param options - Rendering options.
   * @returns Canvg instance.
   */
  static fromString(ctx, svg) {
    var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
    var parser = new Parser(options);
    var svgDocument = parser.parseFromString(svg);
    return new _Canvg(ctx, svgDocument, options);
  }
  /**
   * Create new Canvg instance with inherited options.
   * @param ctx - Rendering context.
   * @param svg - SVG source string or URL.
   * @param options - Rendering options.
   * @returns Canvg instance.
   */
  fork(ctx, svg) {
    var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
    return _Canvg.from(ctx, svg, _objectSpread(_objectSpread({}, this.options), options));
  }
  /**
   * Create new Canvg instance with inherited options.
   * @param ctx - Rendering context.
   * @param svg - SVG source string.
   * @param options - Rendering options.
   * @returns Canvg instance.
   */
  forkString(ctx, svg) {
    var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
    return _Canvg.fromString(ctx, svg, _objectSpread(_objectSpread({}, this.options), options));
  }
  /**
   * Document is ready promise.
   * @returns Ready promise.
   */
  ready() {
    return this.screen.ready();
  }
  /**
   * Document is ready value.
   * @returns Is ready or not.
   */
  isReady() {
    return this.screen.isReady();
  }
  /**
   * Render only first frame, ignoring animations and mouse.
   * @param options - Rendering options.
   */
  render() {
    var _arguments2 = arguments, _this = this;
    return _asyncToGenerator(function* () {
      var options = _arguments2.length > 0 && _arguments2[0] !== void 0 ? _arguments2[0] : {};
      _this.start(_objectSpread({
        enableRedraw: true,
        ignoreAnimation: true,
        ignoreMouse: true
      }, options));
      yield _this.ready();
      _this.stop();
    })();
  }
  /**
   * Start rendering.
   * @param options - Render options.
   */
  start() {
    var options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    var {
      documentElement,
      screen,
      options: baseOptions
    } = this;
    screen.start(documentElement, _objectSpread(_objectSpread({
      enableRedraw: true
    }, baseOptions), options));
  }
  /**
   * Stop rendering.
   */
  stop() {
    this.screen.stop();
  }
  /**
   * Resize SVG to fit in given size.
   * @param width
   * @param height
   * @param preserveAspectRatio
   */
  resize(width) {
    var height = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : width;
    var preserveAspectRatio = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : false;
    this.documentElement.resize(width, height, preserveAspectRatio);
  }
};
export {
  AElement,
  AnimateColorElement,
  AnimateElement,
  AnimateTransformElement,
  BoundingBox,
  CB1,
  CB2,
  CB3,
  CB4,
  Canvg,
  CircleElement,
  ClipPathElement,
  DefsElement,
  DescElement,
  Document,
  Element,
  EllipseElement,
  FeColorMatrixElement,
  FeCompositeElement,
  FeDropShadowElement,
  FeGaussianBlurElement,
  FeMorphologyElement,
  FilterElement,
  Font,
  FontElement,
  FontFaceElement,
  GElement,
  GlyphElement,
  GradientElement,
  ImageElement,
  LineElement,
  LinearGradientElement,
  MarkerElement,
  MaskElement,
  Matrix,
  MissingGlyphElement,
  Mouse,
  PSEUDO_ZERO,
  Parser,
  PathElement,
  PathParser,
  PatternElement,
  Point,
  PolygonElement,
  PolylineElement,
  Property,
  QB1,
  QB2,
  QB3,
  RadialGradientElement,
  RectElement,
  RenderedElement,
  Rotate,
  SVGElement,
  SVGFontLoader,
  Scale,
  Screen,
  Skew,
  SkewX,
  SkewY,
  StopElement,
  StyleElement,
  SymbolElement,
  TRefElement,
  TSpanElement,
  TextElement,
  TextPathElement,
  TitleElement,
  Transform,
  Translate,
  UnknownElement,
  UseElement,
  ViewPort,
  compressSpaces,
  Canvg as default,
  getSelectorSpecificity,
  normalizeAttributeName,
  normalizeColor,
  parseExternalUrl,
  index as presets,
  toNumbers,
  trimLeft,
  trimRight,
  vectorMagnitude,
  vectorsAngle,
  vectorsRatio
};
/*! Bundled license information:

svg-pathdata/lib/SVGPathData.module.js:
  (*! *****************************************************************************
  Copyright (c) Microsoft Corporation.
  
  Permission to use, copy, modify, and/or distribute this software for any
  purpose with or without fee is hereby granted.
  
  THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
  REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
  AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
  INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
  LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
  OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
  PERFORMANCE OF THIS SOFTWARE.
  ***************************************************************************** *)
*/
//# sourceMappingURL=index.es-LXLPBMXP.js.map
