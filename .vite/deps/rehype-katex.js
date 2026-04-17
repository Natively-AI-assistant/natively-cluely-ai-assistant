import {
  find,
  html,
  normalize,
  parse,
  parse2,
  svg
} from "./chunk-PYPJJ63S.js";
import {
  SKIP,
  convert,
  visitParents
} from "./chunk-ZKYBQ2PW.js";
import {
  katex
} from "./chunk-5AU2BCZV.js";
import "./chunk-EWTE5DHJ.js";

// node_modules/hast-util-from-dom/node_modules/hast-util-parse-selector/lib/index.js
var search = /[#.]/g;
function parseSelector(selector, defaultTagName) {
  const value = selector || "";
  const props = {};
  let start = 0;
  let previous;
  let tagName;
  while (start < value.length) {
    search.lastIndex = start;
    const match = search.exec(value);
    const subvalue = value.slice(start, match ? match.index : value.length);
    if (subvalue) {
      if (!previous) {
        tagName = subvalue;
      } else if (previous === "#") {
        props.id = subvalue;
      } else if (Array.isArray(props.className)) {
        props.className.push(subvalue);
      } else {
        props.className = [subvalue];
      }
      start += subvalue.length;
    }
    if (match) {
      previous = match[0];
      start++;
    }
  }
  return {
    type: "element",
    // @ts-expect-error: tag name is parsed.
    tagName: tagName || defaultTagName || "div",
    properties: props,
    children: []
  };
}

// node_modules/hast-util-from-dom/node_modules/hastscript/lib/create-h.js
function createH(schema, defaultTagName, caseSensitive) {
  const adjust = caseSensitive ? createAdjustMap(caseSensitive) : void 0;
  function h2(selector, properties, ...children) {
    let node;
    if (selector === null || selector === void 0) {
      node = { type: "root", children: [] };
      const child = (
        /** @type {Child} */
        properties
      );
      children.unshift(child);
    } else {
      node = parseSelector(selector, defaultTagName);
      const lower = node.tagName.toLowerCase();
      const adjusted = adjust ? adjust.get(lower) : void 0;
      node.tagName = adjusted || lower;
      if (isChild(properties)) {
        children.unshift(properties);
      } else {
        for (const [key, value] of Object.entries(properties)) {
          addProperty(schema, node.properties, key, value);
        }
      }
    }
    for (const child of children) {
      addChild(node.children, child);
    }
    if (node.type === "element" && node.tagName === "template") {
      node.content = { type: "root", children: node.children };
      node.children = [];
    }
    return node;
  }
  return h2;
}
function isChild(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return true;
  }
  if (typeof value.type !== "string") return false;
  const record = (
    /** @type {Record<string, unknown>} */
    value
  );
  const keys = Object.keys(value);
  for (const key of keys) {
    const value2 = record[key];
    if (value2 && typeof value2 === "object") {
      if (!Array.isArray(value2)) return true;
      const list = (
        /** @type {ReadonlyArray<unknown>} */
        value2
      );
      for (const item of list) {
        if (typeof item !== "number" && typeof item !== "string") {
          return true;
        }
      }
    }
  }
  if ("children" in value && Array.isArray(value.children)) {
    return true;
  }
  return false;
}
function addProperty(schema, properties, key, value) {
  const info = find(schema, key);
  let result;
  if (value === null || value === void 0) return;
  if (typeof value === "number") {
    if (Number.isNaN(value)) return;
    result = value;
  } else if (typeof value === "boolean") {
    result = value;
  } else if (typeof value === "string") {
    if (info.spaceSeparated) {
      result = parse2(value);
    } else if (info.commaSeparated) {
      result = parse(value);
    } else if (info.commaOrSpaceSeparated) {
      result = parse2(parse(value).join(" "));
    } else {
      result = parsePrimitive(info, info.property, value);
    }
  } else if (Array.isArray(value)) {
    result = [...value];
  } else {
    result = info.property === "style" ? style(value) : String(value);
  }
  if (Array.isArray(result)) {
    const finalResult = [];
    for (const item of result) {
      finalResult.push(
        /** @type {number | string} */
        parsePrimitive(info, info.property, item)
      );
    }
    result = finalResult;
  }
  if (info.property === "className" && Array.isArray(properties.className)) {
    result = properties.className.concat(
      /** @type {Array<number | string> | number | string} */
      result
    );
  }
  properties[info.property] = result;
}
function addChild(nodes, value) {
  if (value === null || value === void 0) {
  } else if (typeof value === "number" || typeof value === "string") {
    nodes.push({ type: "text", value: String(value) });
  } else if (Array.isArray(value)) {
    for (const child of value) {
      addChild(nodes, child);
    }
  } else if (typeof value === "object" && "type" in value) {
    if (value.type === "root") {
      addChild(nodes, value.children);
    } else {
      nodes.push(value);
    }
  } else {
    throw new Error("Expected node, nodes, or string, got `" + value + "`");
  }
}
function parsePrimitive(info, name, value) {
  if (typeof value === "string") {
    if (info.number && value && !Number.isNaN(Number(value))) {
      return Number(value);
    }
    if ((info.boolean || info.overloadedBoolean) && (value === "" || normalize(value) === normalize(name))) {
      return true;
    }
  }
  return value;
}
function style(styles) {
  const result = [];
  for (const [key, value] of Object.entries(styles)) {
    result.push([key, value].join(": "));
  }
  return result.join("; ");
}
function createAdjustMap(values) {
  const result = /* @__PURE__ */ new Map();
  for (const value of values) {
    result.set(value.toLowerCase(), value);
  }
  return result;
}

// node_modules/hast-util-from-dom/node_modules/hastscript/lib/svg-case-sensitive-tag-names.js
var svgCaseSensitiveTagNames = [
  "altGlyph",
  "altGlyphDef",
  "altGlyphItem",
  "animateColor",
  "animateMotion",
  "animateTransform",
  "clipPath",
  "feBlend",
  "feColorMatrix",
  "feComponentTransfer",
  "feComposite",
  "feConvolveMatrix",
  "feDiffuseLighting",
  "feDisplacementMap",
  "feDistantLight",
  "feDropShadow",
  "feFlood",
  "feFuncA",
  "feFuncB",
  "feFuncG",
  "feFuncR",
  "feGaussianBlur",
  "feImage",
  "feMerge",
  "feMergeNode",
  "feMorphology",
  "feOffset",
  "fePointLight",
  "feSpecularLighting",
  "feSpotLight",
  "feTile",
  "feTurbulence",
  "foreignObject",
  "glyphRef",
  "linearGradient",
  "radialGradient",
  "solidColor",
  "textArea",
  "textPath"
];

// node_modules/hast-util-from-dom/node_modules/hastscript/lib/index.js
var h = createH(html, "div");
var s = createH(svg, "g", svgCaseSensitiveTagNames);

// node_modules/web-namespaces/index.js
var webNamespaces = {
  html: "http://www.w3.org/1999/xhtml",
  mathml: "http://www.w3.org/1998/Math/MathML",
  svg: "http://www.w3.org/2000/svg",
  xlink: "http://www.w3.org/1999/xlink",
  xml: "http://www.w3.org/XML/1998/namespace",
  xmlns: "http://www.w3.org/2000/xmlns/"
};

// node_modules/hast-util-from-dom/lib/index.js
function fromDom(tree, options) {
  return transform(tree, options || {}) || { type: "root", children: [] };
}
function transform(node, options) {
  const transformed = one(node, options);
  if (transformed && options.afterTransform)
    options.afterTransform(node, transformed);
  return transformed;
}
function one(node, options) {
  switch (node.nodeType) {
    case 1: {
      const domNode = (
        /** @type {Element} */
        node
      );
      return element(domNode, options);
    }
    case 3: {
      const domNode = (
        /** @type {Text} */
        node
      );
      return text(domNode);
    }
    case 8: {
      const domNode = (
        /** @type {Comment} */
        node
      );
      return comment(domNode);
    }
    case 9: {
      const domNode = (
        /** @type {Document} */
        node
      );
      return root(domNode, options);
    }
    case 10: {
      return doctype();
    }
    case 11: {
      const domNode = (
        /** @type {DocumentFragment} */
        node
      );
      return root(domNode, options);
    }
    default: {
      return void 0;
    }
  }
}
function root(node, options) {
  return { type: "root", children: all(node, options) };
}
function doctype() {
  return { type: "doctype" };
}
function text(node) {
  return { type: "text", value: node.nodeValue || "" };
}
function comment(node) {
  return { type: "comment", value: node.nodeValue || "" };
}
function element(node, options) {
  const space = node.namespaceURI;
  const x = space === webNamespaces.svg ? s : h;
  const tagName = space === webNamespaces.html ? node.tagName.toLowerCase() : node.tagName;
  const content = (
    // @ts-expect-error: DOM types are wrong, content can exist.
    space === webNamespaces.html && tagName === "template" ? node.content : node
  );
  const attributes = node.getAttributeNames();
  const properties = {};
  let index = -1;
  while (++index < attributes.length) {
    properties[attributes[index]] = node.getAttribute(attributes[index]) || "";
  }
  return x(tagName, properties, all(content, options));
}
function all(node, options) {
  const nodes = node.childNodes;
  const children = [];
  let index = -1;
  while (++index < nodes.length) {
    const child = transform(nodes[index], options);
    if (child !== void 0) {
      children.push(child);
    }
  }
  return children;
}

// node_modules/hast-util-from-html-isomorphic/lib/browser.js
var parser = new DOMParser();
function fromHtmlIsomorphic(value, options) {
  const node = (options == null ? void 0 : options.fragment) ? parseFragment(value) : parser.parseFromString(value, "text/html");
  return (
    /** @type {Root} */
    fromDom(node)
  );
}
function parseFragment(value) {
  const template = document.createElement("template");
  template.innerHTML = value;
  return template.content;
}

// node_modules/unist-util-find-after/lib/index.js
var findAfter = (
  // Note: overloads like this are needed to support optional generics.
  /**
   * @type {(
   *   (<Kind extends UnistParent, Check extends Test>(parent: Kind, index: Child<Kind> | number, test: Check) => Matches<Child<Kind>, Check> | undefined) &
   *   (<Kind extends UnistParent>(parent: Kind, index: Child<Kind> | number, test?: null | undefined) => Child<Kind> | undefined)
   * )}
   */
  /**
   * @param {UnistParent} parent
   * @param {UnistNode | number} index
   * @param {Test} [test]
   * @returns {UnistNode | undefined}
   */
  function(parent, index, test) {
    const is = convert(test);
    if (!parent || !parent.type || !parent.children) {
      throw new Error("Expected parent node");
    }
    if (typeof index === "number") {
      if (index < 0 || index === Number.POSITIVE_INFINITY) {
        throw new Error("Expected positive finite number as index");
      }
    } else {
      index = parent.children.indexOf(index);
      if (index < 0) {
        throw new Error("Expected child node or index");
      }
    }
    while (++index < parent.children.length) {
      if (is(parent.children[index], index, parent)) {
        return parent.children[index];
      }
    }
    return void 0;
  }
);

// node_modules/hast-util-is-element/lib/index.js
var convertElement = (
  // Note: overloads in JSDoc can’t yet use different `@template`s.
  /**
   * @type {(
   *   (<Condition extends TestFunction>(test: Condition) => (element: unknown, index?: number | null | undefined, parent?: Parents | null | undefined, context?: unknown) => element is Element & Predicate<Condition, Element>) &
   *   (<Condition extends string>(test: Condition) => (element: unknown, index?: number | null | undefined, parent?: Parents | null | undefined, context?: unknown) => element is Element & {tagName: Condition}) &
   *   ((test?: null | undefined) => (element?: unknown, index?: number | null | undefined, parent?: Parents | null | undefined, context?: unknown) => element is Element) &
   *   ((test?: Test) => Check)
   * )}
   */
  /**
   * @param {Test | null | undefined} [test]
   * @returns {Check}
   */
  function(test) {
    if (test === null || test === void 0) {
      return element2;
    }
    if (typeof test === "string") {
      return tagNameFactory(test);
    }
    if (typeof test === "object") {
      return anyFactory(test);
    }
    if (typeof test === "function") {
      return castFactory(test);
    }
    throw new Error("Expected function, string, or array as `test`");
  }
);
function anyFactory(tests) {
  const checks = [];
  let index = -1;
  while (++index < tests.length) {
    checks[index] = convertElement(tests[index]);
  }
  return castFactory(any);
  function any(...parameters) {
    let index2 = -1;
    while (++index2 < checks.length) {
      if (checks[index2].apply(this, parameters)) return true;
    }
    return false;
  }
}
function tagNameFactory(check) {
  return castFactory(tagName);
  function tagName(element3) {
    return element3.tagName === check;
  }
}
function castFactory(testFunction) {
  return check;
  function check(value, index, parent) {
    return Boolean(
      looksLikeAnElement(value) && testFunction.call(
        this,
        value,
        typeof index === "number" ? index : void 0,
        parent || void 0
      )
    );
  }
}
function element2(element3) {
  return Boolean(
    element3 && typeof element3 === "object" && "type" in element3 && element3.type === "element" && "tagName" in element3 && typeof element3.tagName === "string"
  );
}
function looksLikeAnElement(value) {
  return value !== null && typeof value === "object" && "type" in value && "tagName" in value;
}

// node_modules/hast-util-to-text/lib/index.js
var searchLineFeeds = /\n/g;
var searchTabOrSpaces = /[\t ]+/g;
var br = convertElement("br");
var cell = convertElement(isCell);
var p = convertElement("p");
var row = convertElement("tr");
var notRendered = convertElement([
  // List from: <https://html.spec.whatwg.org/multipage/rendering.html#hidden-elements>
  "datalist",
  "head",
  "noembed",
  "noframes",
  "noscript",
  // Act as if we support scripting.
  "rp",
  "script",
  "style",
  "template",
  "title",
  // Hidden attribute.
  hidden,
  // From: <https://html.spec.whatwg.org/multipage/rendering.html#flow-content-3>
  closedDialog
]);
var blockOrCaption = convertElement([
  "address",
  // Flow content
  "article",
  // Sections and headings
  "aside",
  // Sections and headings
  "blockquote",
  // Flow content
  "body",
  // Page
  "caption",
  // `table-caption`
  "center",
  // Flow content (legacy)
  "dd",
  // Lists
  "dialog",
  // Flow content
  "dir",
  // Lists (legacy)
  "dl",
  // Lists
  "dt",
  // Lists
  "div",
  // Flow content
  "figure",
  // Flow content
  "figcaption",
  // Flow content
  "footer",
  // Flow content
  "form,",
  // Flow content
  "h1",
  // Sections and headings
  "h2",
  // Sections and headings
  "h3",
  // Sections and headings
  "h4",
  // Sections and headings
  "h5",
  // Sections and headings
  "h6",
  // Sections and headings
  "header",
  // Flow content
  "hgroup",
  // Sections and headings
  "hr",
  // Flow content
  "html",
  // Page
  "legend",
  // Flow content
  "li",
  // Lists (as `display: list-item`)
  "listing",
  // Flow content (legacy)
  "main",
  // Flow content
  "menu",
  // Lists
  "nav",
  // Sections and headings
  "ol",
  // Lists
  "p",
  // Flow content
  "plaintext",
  // Flow content (legacy)
  "pre",
  // Flow content
  "section",
  // Sections and headings
  "ul",
  // Lists
  "xmp"
  // Flow content (legacy)
]);
function toText(tree, options) {
  const options_ = options || {};
  const children = "children" in tree ? tree.children : [];
  const block = blockOrCaption(tree);
  const whitespace = inferWhitespace(tree, {
    whitespace: options_.whitespace || "normal",
    breakBefore: false,
    breakAfter: false
  });
  const results = [];
  if (tree.type === "text" || tree.type === "comment") {
    results.push(
      ...collectText(tree, {
        whitespace,
        breakBefore: true,
        breakAfter: true
      })
    );
  }
  let index = -1;
  while (++index < children.length) {
    results.push(
      ...renderedTextCollection(
        children[index],
        // @ts-expect-error: `tree` is a parent if we’re here.
        tree,
        {
          whitespace,
          breakBefore: index ? void 0 : block,
          breakAfter: index < children.length - 1 ? br(children[index + 1]) : block
        }
      )
    );
  }
  const result = [];
  let count;
  index = -1;
  while (++index < results.length) {
    const value = results[index];
    if (typeof value === "number") {
      if (count !== void 0 && value > count) count = value;
    } else if (value) {
      if (count !== void 0 && count > -1) {
        result.push("\n".repeat(count) || " ");
      }
      count = -1;
      result.push(value);
    }
  }
  return result.join("");
}
function renderedTextCollection(node, parent, info) {
  if (node.type === "element") {
    return collectElement(node, parent, info);
  }
  if (node.type === "text") {
    return info.whitespace === "normal" ? collectText(node, info) : collectPreText(node);
  }
  return [];
}
function collectElement(node, parent, info) {
  const whitespace = inferWhitespace(node, info);
  const children = node.children || [];
  let index = -1;
  let items = [];
  if (notRendered(node)) {
    return items;
  }
  let prefix;
  let suffix;
  if (br(node)) {
    suffix = "\n";
  } else if (row(node) && // @ts-expect-error: something up with types of parents.
  findAfter(parent, node, row)) {
    suffix = "\n";
  } else if (p(node)) {
    prefix = 2;
    suffix = 2;
  } else if (blockOrCaption(node)) {
    prefix = 1;
    suffix = 1;
  }
  while (++index < children.length) {
    items = items.concat(
      renderedTextCollection(children[index], node, {
        whitespace,
        breakBefore: index ? void 0 : prefix,
        breakAfter: index < children.length - 1 ? br(children[index + 1]) : suffix
      })
    );
  }
  if (cell(node) && // @ts-expect-error: something up with types of parents.
  findAfter(parent, node, cell)) {
    items.push("	");
  }
  if (prefix) items.unshift(prefix);
  if (suffix) items.push(suffix);
  return items;
}
function collectText(node, info) {
  const value = String(node.value);
  const lines = [];
  const result = [];
  let start = 0;
  while (start <= value.length) {
    searchLineFeeds.lastIndex = start;
    const match = searchLineFeeds.exec(value);
    const end = match && "index" in match ? match.index : value.length;
    lines.push(
      // Any sequence of collapsible spaces and tabs immediately preceding or
      // following a segment break is removed.
      trimAndCollapseSpacesAndTabs(
        // […] ignoring bidi formatting characters (characters with the
        // Bidi_Control property [UAX9]: ALM, LTR, RTL, LRE-RLO, LRI-PDI) as if
        // they were not there.
        value.slice(start, end).replace(/[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, ""),
        start === 0 ? info.breakBefore : true,
        end === value.length ? info.breakAfter : true
      )
    );
    start = end + 1;
  }
  let index = -1;
  let join;
  while (++index < lines.length) {
    if (lines[index].charCodeAt(lines[index].length - 1) === 8203 || index < lines.length - 1 && lines[index + 1].charCodeAt(0) === 8203) {
      result.push(lines[index]);
      join = void 0;
    } else if (lines[index]) {
      if (typeof join === "number") result.push(join);
      result.push(lines[index]);
      join = 0;
    } else if (index === 0 || index === lines.length - 1) {
      result.push(0);
    }
  }
  return result;
}
function collectPreText(node) {
  return [String(node.value)];
}
function trimAndCollapseSpacesAndTabs(value, breakBefore, breakAfter) {
  const result = [];
  let start = 0;
  let end;
  while (start < value.length) {
    searchTabOrSpaces.lastIndex = start;
    const match = searchTabOrSpaces.exec(value);
    end = match ? match.index : value.length;
    if (!start && !end && match && !breakBefore) {
      result.push("");
    }
    if (start !== end) {
      result.push(value.slice(start, end));
    }
    start = match ? end + match[0].length : end;
  }
  if (start !== end && !breakAfter) {
    result.push("");
  }
  return result.join(" ");
}
function inferWhitespace(node, info) {
  if (node.type === "element") {
    const properties = node.properties || {};
    switch (node.tagName) {
      case "listing":
      case "plaintext":
      case "xmp": {
        return "pre";
      }
      case "nobr": {
        return "nowrap";
      }
      case "pre": {
        return properties.wrap ? "pre-wrap" : "pre";
      }
      case "td":
      case "th": {
        return properties.noWrap ? "nowrap" : info.whitespace;
      }
      case "textarea": {
        return "pre-wrap";
      }
      default:
    }
  }
  return info.whitespace;
}
function hidden(node) {
  return Boolean((node.properties || {}).hidden);
}
function isCell(node) {
  return node.tagName === "td" || node.tagName === "th";
}
function closedDialog(node) {
  return node.tagName === "dialog" && !(node.properties || {}).open;
}

// node_modules/rehype-katex/lib/index.js
var emptyOptions = {};
var emptyClasses = [];
function rehypeKatex(options) {
  const settings = options || emptyOptions;
  return function(tree, file) {
    visitParents(tree, "element", function(element3, parents) {
      const classes = Array.isArray(element3.properties.className) ? element3.properties.className : emptyClasses;
      const languageMath = classes.includes("language-math");
      const mathDisplay = classes.includes("math-display");
      const mathInline = classes.includes("math-inline");
      let displayMode = mathDisplay;
      if (!languageMath && !mathDisplay && !mathInline) {
        return;
      }
      let parent = parents[parents.length - 1];
      let scope = element3;
      if (element3.tagName === "code" && languageMath && parent && parent.type === "element" && parent.tagName === "pre") {
        scope = parent;
        parent = parents[parents.length - 2];
        displayMode = true;
      }
      if (!parent) return;
      const value = toText(scope, { whitespace: "pre" });
      let result;
      try {
        result = katex.renderToString(value, {
          ...settings,
          displayMode,
          throwOnError: true
        });
      } catch (error) {
        const cause = (
          /** @type {Error} */
          error
        );
        const ruleId = cause.name.toLowerCase();
        file.message("Could not render math with KaTeX", {
          ancestors: [...parents, element3],
          cause,
          place: element3.position,
          ruleId,
          source: "rehype-katex"
        });
        try {
          result = katex.renderToString(value, {
            ...settings,
            displayMode,
            strict: "ignore",
            throwOnError: false
          });
        } catch {
          result = [
            {
              type: "element",
              tagName: "span",
              properties: {
                className: ["katex-error"],
                style: "color:" + (settings.errorColor || "#cc0000"),
                title: String(error)
              },
              children: [{ type: "text", value }]
            }
          ];
        }
      }
      if (typeof result === "string") {
        const root2 = fromHtmlIsomorphic(result, { fragment: true });
        result = /** @type {Array<ElementContent>} */
        root2.children;
      }
      const index = parent.children.indexOf(scope);
      parent.children.splice(index, 1, ...result);
      return SKIP;
    });
  };
}
export {
  rehypeKatex as default
};
//# sourceMappingURL=rehype-katex.js.map
