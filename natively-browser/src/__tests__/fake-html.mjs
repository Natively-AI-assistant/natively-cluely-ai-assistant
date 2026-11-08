// natively-browser/src/__tests__/fake-html.mjs
//
// A small DOM for tests that need real markup (math-text.test.mjs): parses
// well-formed HTML/SVG into nodes with the surface extract.ts and
// math-text.ts touch: nodeType, nodeName, childNodes, parentNode,
// getAttribute, textContent, cloneNode, replaceChild, removeChild,
// querySelector / querySelectorAll (comma-separated `tag`, `.class` or `tag.class` only; any
// other selector matches nothing), createTextNode.

const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link']);

function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

class Node {
  constructor(doc) {
    this.ownerDocument = doc;
    this.parentNode = null;
    this.childNodes = [];
  }
  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  replaceChild(next, old) {
    const i = this.childNodes.indexOf(old);
    if (i < 0) throw new Error('not a child');
    next.parentNode = this;
    old.parentNode = null;
    this.childNodes[i] = next;
    return old;
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  querySelectorAll(sel) {
    const tests = sel.split(',').map((part) => {
      const m = /^([a-zA-Z][\w-]*)?(?:\.([\w-]+))?$/.exec(part.trim());
      if (!m || (!m[1] && !m[2])) return () => false;
      const name = m[1]?.toLowerCase();
      const cls = m[2];
      return (el) =>
        (!name || el.localName === name) &&
        (!cls || (el.getAttribute('class') || '').split(/\s+/).includes(cls));
    });
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 1 && tests.some((t) => t(c))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

class Text extends Node {
  constructor(doc, data) {
    super(doc);
    this.nodeType = 3;
    this.nodeName = '#text';
    this.data = data;
  }
  get textContent() {
    return this.data;
  }
  cloneNode() {
    return new Text(this.ownerDocument, this.data);
  }
}

class Element extends Node {
  constructor(doc, name, attrs) {
    super(doc);
    this.nodeType = 1;
    this.localName = name.toLowerCase();
    this.nodeName = this.localName.toUpperCase();
    this.tagName = this.nodeName;
    this.attrs = attrs;
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  get className() {
    return this.attrs.class || '';
  }
  cloneNode(deep) {
    const el = new Element(this.ownerDocument, this.localName, { ...this.attrs });
    if (deep) for (const c of this.childNodes) el.appendChild(c.cloneNode(true));
    return el;
  }
  closest() {
    return null;
  }
}

class Document extends Node {
  constructor() {
    super(null);
    this.ownerDocument = null;
    this.nodeType = 9;
    this.nodeName = '#document';
    this.title = '';
    this.location = { hostname: '' };
  }
  createTextNode(data) {
    return new Text(this, data);
  }
  get body() {
    return this.querySelectorAll('body')[0] || null;
  }
  get textContent() {
    return null;
  }
  cloneNode() {
    const d = new Document();
    d.title = this.title;
    d.location = this.location;
    for (const c of this.childNodes) d.appendChild(adopt(c.cloneNode(true), d));
    return d;
  }
}

function adopt(node, doc) {
  node.ownerDocument = doc;
  for (const c of node.childNodes) adopt(c, doc);
  return node;
}

/** Parse `<body>…</body>` markup into a Document. `title`/`url` optional. */
export function parseHtml(html, { title = '', url = '' } = {}) {
  const doc = new Document();
  doc.title = title;
  doc.location = url ? { hostname: new URL(url).hostname, href: url } : { hostname: '', href: '' };
  const stack = [doc];
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      const name = m[1].toLowerCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].localName === name) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (m[2]) {
      const attrs = {};
      const attrRe = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g;
      let a;
      while ((a = attrRe.exec(m[3] || ''))) attrs[a[1]] = decode(a[2] ?? a[3] ?? '');
      const el = top.appendChild(new Element(doc, m[2], attrs));
      if (!m[4] && !VOID.has(el.localName)) stack.push(el);
      continue;
    }
    if (m[5]) top.appendChild(new Text(doc, decode(m[5])));
  }
  return doc;
}
