// Recovered declaration closure; runtime React and translations come from the host app.
import { r as v } from "./data-runtime.js";
import { j as q } from "./data-runtime.js";
const Ut = v.createContext({});
function ut(t) {
  const e = v.useRef(null);
  return e.current === null && (e.current = t()), e.current;
}
const yr = typeof window < "u", we = yr ? v.useLayoutEffect : v.useEffect, _t = v.createContext(null);
function mn(t, e) {
  t.indexOf(e) === -1 && t.push(e);
}
function At(t, e) {
  const n = t.indexOf(e);
  n > -1 && t.splice(n, 1);
}
const st = (t, e, n) => n > e ? e : n < t ? t : n;
let gn = () => { };
const ct = {}, yi = t => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(t);
function vi(t) {
  return typeof t == "object" && t !== null;
}
const xi = t => /^0[^.\s]+$/u.test(t);
function Ti(t) {
  let e;
  return () => (e === void 0 && (e = t()), e);
}
const H = t => t, vr = (t, e) => n => e(t(n)), Xt = (...t) => t.reduce(vr), bt = (t, e, n) => {
    const s = e - t;
    return s === 0 ? 1 : (n - t) / s;
};
class yn {
  constructor() {
    this.subscriptions = [];
  }
  add(e) {
    return mn(this.subscriptions, e), () => At(this.subscriptions, e);
  }
  notify(e, n, s) {
    const i = this.subscriptions.length;
    if (i) if (i === 1) this.subscriptions[0](e, n, s);else for (let r = 0; r < i; r++) {
      const o = this.subscriptions[r];
      o && o(e, n, s);
    }
  }
  getSize() {
    return this.subscriptions.length;
  }
  clear() {
    this.subscriptions.length = 0;
  }
}
const G = t => t * 1e3, z = t => t / 1e3;
function Si(t, e) {
  return e ? t * (1e3 / e) : 0;
}
const xr = (t, e, n) => {
    const s = e - t;
    return ((n - t) % s + s) % s + t;
}, wi = (t, e, n) => (((1 - 3 * n + 3 * e) * t + (3 * n - 6 * e)) * t + 3 * e) * t, Tr = 1e-7, Sr = 12;
function wr(t, e, n, s, i) {
  let r,
    o,
    a = 0;
  do o = e + (n - e) / 2, r = wi(o, s, i) - t, r > 0 ? n = o : e = o; while (Math.abs(r) > Tr && ++a < Sr);
  return o;
}
function Yt(t, e, n, s) {
  if (t === e && n === s) return H;
  const i = r => wr(r, 0, 1, t, n);
  return r => r === 0 || r === 1 ? r : wi(i(r), e, s);
}
const Pi = t => e => e <= .5 ? t(2 * e) / 2 : (2 - t(2 * (1 - e))) / 2, Ai = t => e => 1 - t(1 - e), bi = Yt(.33, 1.53, .69, .99), vn = Ai(bi), Vi = Pi(vn), Ci = t => t >= 1 ? 1 : (t *= 2) < 1 ? .5 * vn(t) : .5 * (2 - Math.pow(2, -10 * (t - 1))), xn = t => 1 - Math.sin(Math.acos(t)), Mi = Ai(xn), Di = Pi(xn), Pr = Yt(.42, 0, 1, 1), Ar = Yt(0, 0, .58, 1), Ei = Yt(.42, 0, .58, 1), Ri = t => Array.isArray(t) && typeof t[0] != "number";
function Li(t, e) {
  return Ri(t) ? t[xr(0, t.length, e)] : t;
}
const ki = t => Array.isArray(t) && typeof t[0] == "number", br = {
    linear: H,
    easeIn: Pr,
    easeInOut: Ei,
    easeOut: Ar,
    circIn: xn,
    circInOut: Di,
    circOut: Mi,
    backIn: vn,
    backInOut: Vi,
    backOut: bi,
    anticipate: Ci
}, Vr = t => typeof t == "string", Xn = t => {
    if (ki(t)) {
        gn(t.length === 4);
        const [e, n, s, i] = t;
        return Yt(e, n, s, i);
    }
    else if (Vr(t))
        return br[t];
    return t;
}, ee = ["setup", "read", "resolveKeyframes", "preUpdate", "update", "preRender", "render", "postRender"];
function Cr(t, e) {
  let n = new Set(),
    s = new Set(),
    i = !1,
    r = !1;
  const o = new WeakSet();
  let a = {
    delta: 0,
    timestamp: 0,
    isProcessing: !1
  };
  function l(u) {
    o.has(u) && (c.schedule(u), t()), u(a);
  }
  const c = {
    schedule: (u, h = !1, f = !1) => {
      const p = f && i ? n : s;
      return h && o.add(u), p.add(u), u;
    },
    cancel: u => {
      s.delete(u), o.delete(u);
    },
    process: u => {
      if (a = u, i) {
        r = !0;
        return;
      }
      i = !0;
      const h = n;
      n = s, s = h, n.forEach(l), n.clear(), i = !1, r && (r = !1, c.process(u));
    }
  };
  return c;
}
const Mr = 40;
function Ii(t, e) {
  let n = !1,
    s = !0;
  const i = {
      delta: 0,
      timestamp: 0,
      isProcessing: !1
    },
    r = () => n = !0,
    o = ee.reduce((T, S) => (T[S] = Cr(r), T), {}),
    {
      setup: a,
      read: l,
      resolveKeyframes: c,
      preUpdate: u,
      update: h,
      preRender: f,
      render: d,
      postRender: p
    } = o,
    g = () => {
      const T = ct.useManualTiming,
        S = T ? i.timestamp : performance.now();
      n = !1, T || (i.delta = s ? 1e3 / 60 : Math.max(Math.min(S - i.timestamp, Mr), 1)), i.timestamp = S, i.isProcessing = !0, a.process(i), l.process(i), c.process(i), u.process(i), h.process(i), f.process(i), d.process(i), p.process(i), i.isProcessing = !1, n && e && (s = !1, t(g));
    },
    m = () => {
      n = !0, s = !0, i.isProcessing || t(g);
    };
  return {
    schedule: ee.reduce((T, S) => {
      const A = o[S];
      return T[S] = (M, R = !1, V = !1) => (n || m(), A.schedule(M, R, V)), T;
    }, {}),
    cancel: T => {
      for (let S = 0; S < ee.length; S++) o[ee[S]].cancel(T);
    },
    state: i,
    steps: o
  };
}
const { schedule: D, cancel: rt, state: O, steps: Me } = Ii(typeof requestAnimationFrame < "u" ? requestAnimationFrame : H, !0);
let re;
function Dr() {
  re = void 0;
}
const U = {
    now: () => (re === void 0 && U.set(O.isProcessing || ct.useManualTiming ? O.timestamp : performance.now()), re),
    set: t => {
        re = t, queueMicrotask(Dr);
    }
}, Fi = t => e => typeof e == "string" && e.startsWith(t), Bi = Fi("--"), Er = Fi("var(--"), Tn = t => Er(t) ? Rr.test(t.split("/*")[0].trim()) : !1, Rr = /var\(--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)$/iu;
function Yn(t) {
  return typeof t != "string" ? !1 : t.split("/*")[0].includes("var(--");
}
const Ct = {
    test: t => typeof t == "number",
    parse: parseFloat,
    transform: t => t
}, Wt = {
    ...Ct,
    transform: t => st(0, 1, t)
}, ne = {
    ...Ct,
    default: 1
}, Ft = t => Math.round(t * 1e5) / 1e5, Sn = /-?(?:\d+(?:\.\d+)?|\.\d+)/gu;
function Lr(t) {
  return t == null;
}
const kr = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))$/iu, wn = (t, e) => n => !!(typeof n == "string" && kr.test(n) && n.startsWith(t) || e && !Lr(n) && Object.prototype.hasOwnProperty.call(n, e)), ji = (t, e, n) => s => {
    if (typeof s != "string")
        return s;
    const [i, r, o, a] = s.match(Sn);
    return {
        [t]: parseFloat(i),
        [e]: parseFloat(r),
        [n]: parseFloat(o),
        alpha: a !== void 0 ? parseFloat(a) : 1
    };
}, Ir = t => st(0, 255, t), De = {
    ...Ct,
    transform: t => Math.round(Ir(t))
}, mt = {
    test: wn("rgb", "red"),
    parse: ji("red", "green", "blue"),
    transform: ({ red: t, green: e, blue: n, alpha: s = 1 }) => "rgba(" + De.transform(t) + ", " + De.transform(e) + ", " + De.transform(n) + ", " + Ft(Wt.transform(s)) + ")"
};
function Fr(t) {
  let e = "",
    n = "",
    s = "",
    i = "";
  return t.length > 5 ? (e = t.substring(1, 3), n = t.substring(3, 5), s = t.substring(5, 7), i = t.substring(7, 9)) : (e = t.substring(1, 2), n = t.substring(2, 3), s = t.substring(3, 4), i = t.substring(4, 5), e += e, n += n, s += s, i += i), {
    red: parseInt(e, 16),
    green: parseInt(n, 16),
    blue: parseInt(s, 16),
    alpha: i ? parseInt(i, 16) / 255 : 1
  };
}
const ze = {
    test: wn("#"),
    parse: Fr,
    transform: mt.transform
}, qt = t => ({
    test: e => typeof e == "string" && e.endsWith(t) && e.split(" ").length === 1,
    parse: parseFloat,
    transform: e => `${e}${t}`
}), at = qt("deg"), nt = qt("%"), w = qt("px"), Br = qt("vh"), jr = qt("vw"), qn = {
    ...nt,
    parse: t => nt.parse(t) / 100,
    transform: t => nt.transform(t * 100)
}, St = {
    test: wn("hsl", "hue"),
    parse: ji("hue", "saturation", "lightness"),
    transform: ({ hue: t, saturation: e, lightness: n, alpha: s = 1 }) => "hsla(" + Math.round(t) + ", " + nt.transform(Ft(e)) + ", " + nt.transform(Ft(n)) + ", " + Ft(Wt.transform(s)) + ")"
}, j = {
    test: t => mt.test(t) || ze.test(t) || St.test(t),
    parse: t => mt.test(t) ? mt.parse(t) : St.test(t) ? St.parse(t) : ze.parse(t),
    transform: t => typeof t == "string" ? t : t.hasOwnProperty("red") ? mt.transform(t) : St.transform(t),
    getAnimatableNone: t => {
        const e = j.parse(t);
        return e.alpha = 0, j.transform(e);
    }
}, Or = /(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))/giu;
function Nr(t) {
  return isNaN(t) && typeof t == "string" && (t.match(Sn)?.length || 0) + (t.match(Or)?.length || 0) > 0;
}
const Oi = "number", Ni = "color", Ur = "var", Wr = "var(", Zn = "${}", Kr = /var\s*\(\s*--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)|#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)|-?(?:\d+(?:\.\d+)?|\.\d+)/giu;
function Vt(t) {
  const e = t.toString(),
    n = [],
    s = {
      color: [],
      number: [],
      var: []
    },
    i = [];
  let r = 0;
  const a = e.replace(Kr, l => (j.test(l) ? (s.color.push(r), i.push(Ni), n.push(j.parse(l))) : l.startsWith(Wr) ? (s.var.push(r), i.push(Ur), n.push(l)) : (s.number.push(r), i.push(Oi), n.push(parseFloat(l))), ++r, Zn)).split(Zn);
  return {
    values: n,
    split: a,
    indexes: s,
    types: i
  };
}
function Gr(t) {
  return Vt(t).values;
}
function Ui({
  split: t,
  types: e
}) {
  const n = t.length;
  return s => {
    let i = "";
    for (let r = 0; r < n; r++) if (i += t[r], s[r] !== void 0) {
      const o = e[r];
      o === Oi ? i += Ft(s[r]) : o === Ni ? i += j.transform(s[r]) : i += s[r];
    }
    return i;
  };
}
function $r(t) {
  return Ui(Vt(t));
}
const zr = t => typeof t == "number" ? 0 : j.test(t) ? j.getAnimatableNone(t) : t, Hr = (t, e) => typeof t == "number" ? e?.trim().endsWith("/") ? t : 0 : zr(t);
function _r(t) {
  const e = Vt(t);
  return Ui(e)(e.values.map((s, i) => Hr(s, e.split[i])));
}
const Z = {
    test: Nr,
    parse: Gr,
    createTransformer: $r,
    getAnimatableNone: _r
};
function Ee(t, e, n) {
  return n < 0 && (n += 1), n > 1 && (n -= 1), n < 1 / 6 ? t + (e - t) * 6 * n : n < 1 / 2 ? e : n < 2 / 3 ? t + (e - t) * (2 / 3 - n) * 6 : t;
}
function Xr({
  hue: t,
  saturation: e,
  lightness: n,
  alpha: s
}) {
  t /= 360, e /= 100, n /= 100;
  let i = 0,
    r = 0,
    o = 0;
  if (!e) i = r = o = n;else {
    const a = n < .5 ? n * (1 + e) : n + e - n * e,
      l = 2 * n - a;
    i = Ee(l, a, t + 1 / 3), r = Ee(l, a, t), o = Ee(l, a, t - 1 / 3);
  }
  return {
    red: Math.round(i * 255),
    green: Math.round(r * 255),
    blue: Math.round(o * 255),
    alpha: s
  };
}
function me(t, e) {
  return n => n > 0 ? e : t;
}
const L = (t, e, n) => t + (e - t) * n, Re = (t, e, n) => {
    const s = t * t, i = n * (e * e - s) + s;
    return i < 0 ? 0 : Math.sqrt(i);
}, Yr = [ze, mt, St], qr = t => Yr.find(e => e.test(t));
function Jn(t) {
  const e = qr(t);
  if (!e) return !1;
  let n = e.parse(t);
  return e === St && (n = Xr(n)), n;
}
const Qn = (t, e) => {
    const n = Jn(t), s = Jn(e);
    if (!n || !s)
        return me(t, e);
    const i = {
        ...n
    };
    return r => (i.red = Re(n.red, s.red, r), i.green = Re(n.green, s.green, r), i.blue = Re(n.blue, s.blue, r), i.alpha = L(n.alpha, s.alpha, r), mt.transform(i));
}, He = new Set(["none", "hidden"]);
function Zr(t, e) {
  return He.has(t) ? n => n <= 0 ? t : e : n => n >= 1 ? e : t;
}
function Jr(t, e) {
  return n => L(t, e, n);
}
function Pn(t) {
  return typeof t == "number" ? Jr : typeof t == "string" ? Tn(t) ? me : j.test(t) ? Qn : ea : Array.isArray(t) ? Wi : typeof t == "object" ? j.test(t) ? Qn : Qr : me;
}
function Wi(t, e) {
  const n = [...t],
    s = n.length,
    i = t.map((r, o) => Pn(r)(r, e[o]));
  return r => {
    for (let o = 0; o < s; o++) n[o] = i[o](r);
    return n;
  };
}
function Qr(t, e) {
  const n = {
      ...t,
      ...e
    },
    s = {};
  for (const i in n) t[i] !== void 0 && e[i] !== void 0 && (s[i] = Pn(t[i])(t[i], e[i]));
  return i => {
    for (const r in s) n[r] = s[r](i);
    return n;
  };
}
function ta(t, e) {
  const n = [],
    s = {
      color: 0,
      var: 0,
      number: 0
    };
  for (let i = 0; i < e.values.length; i++) {
    const r = e.types[i],
      o = t.indexes[r][s[r]],
      a = t.values[o] ?? 0;
    n[i] = a, s[r]++;
  }
  return n;
}
const ea = (t, e) => {
    const n = Z.createTransformer(e), s = Vt(t), i = Vt(e);
    return s.indexes.var.length === i.indexes.var.length && s.indexes.color.length === i.indexes.color.length && s.indexes.number.length >= i.indexes.number.length ? He.has(t) && !i.values.length || He.has(e) && !s.values.length ? Zr(t, e) : Xt(Wi(ta(s, i), i.values), n) : me(t, e);
};
function Ki(t, e, n) {
  return typeof t == "number" && typeof e == "number" && typeof n == "number" ? L(t, e, n) : Pn(t)(t, e);
}
const na = t => {
    const e = ({ timestamp: n }) => t(n);
    return {
        start: (n = !0) => D.update(e, n),
        stop: () => rt(e),
        now: () => O.isProcessing ? O.timestamp : U.now()
    };
}, Gi = (t, e, n = 10) => {
    let s = "";
    const i = Math.max(Math.round(e / n), 2);
    for (let r = 0; r < i; r++)
        s += Math.round(t(r / (i - 1)) * 1e4) / 1e4 + ", ";
    return `linear(${s.substring(0, s.length - 2)})`;
}, ge = 2e4;
function An(t) {
  let e = 0;
  const n = 50;
  let s = t.next(e);
  for (; !s.done && e < ge;) e += n, s = t.next(e);
  return e >= ge ? 1 / 0 : e;
}
function $i(t, e = 100, n) {
  const s = n({
      ...t,
      keyframes: [0, e]
    }),
    i = Math.min(An(s), ge);
  return {
    type: "keyframes",
    ease: r => s.next(i * r).value / e,
    duration: z(i)
  };
}
const k = {
    stiffness: 100,
    damping: 10,
    mass: 1,
    velocity: 0,
    duration: 800,
    bounce: .3,
    visualDuration: .3,
    restSpeed: {
        granular: .01,
        default: 2
    },
    restDelta: {
        granular: .005,
        default: .5
    },
    minDuration: .01,
    maxDuration: 10,
    minDamping: .05,
    maxDamping: 1
};
function _e(t, e) {
  return t * Math.sqrt(1 - e * e);
}
const sa = 12;
function ia(t, e, n) {
  let s = n;
  for (let i = 1; i < sa; i++) s = s - t(s) / e(s);
  return s;
}
const Le = .001;
function oa({
  duration: t = k.duration,
  bounce: e = k.bounce,
  velocity: n = k.velocity,
  mass: s = k.mass
}) {
  let i,
    r,
    o = 1 - e;
  o = st(k.minDamping, k.maxDamping, o), t = st(k.minDuration, k.maxDuration, z(t)), o < 1 ? (i = c => {
    const u = c * o,
      h = u * t,
      f = u - n,
      d = _e(c, o),
      p = Math.exp(-h);
    return Le - f / d * p;
  }, r = c => {
    const h = c * o * t,
      f = h * n + n,
      d = Math.pow(o, 2) * Math.pow(c, 2) * t,
      p = Math.exp(-h),
      g = _e(Math.pow(c, 2), o);
    return (-i(c) + Le > 0 ? -1 : 1) * ((f - d) * p) / g;
  }) : (i = c => {
    const u = Math.exp(-c * t),
      h = (c - n) * t + 1;
    return -Le + u * h;
  }, r = c => {
    const u = Math.exp(-c * t),
      h = (n - c) * (t * t);
    return u * h;
  });
  const a = 5 / t,
    l = ia(i, r, a);
  if (t = G(t), isNaN(l)) return {
    stiffness: k.stiffness,
    damping: k.damping,
    duration: t
  };
  {
    const c = Math.pow(l, 2) * s;
    return {
      stiffness: c,
      damping: o * 2 * Math.sqrt(s * c),
      duration: t
    };
  }
}
const ra = ["duration", "bounce"], aa = ["stiffness", "damping", "mass"];
function ts(t, e) {
  return e.some(n => t[n] !== void 0);
}
function la(t) {
  let e = {
    velocity: k.velocity,
    stiffness: k.stiffness,
    damping: k.damping,
    mass: k.mass,
    isResolvedFromDuration: !1,
    ...t
  };
  if (!ts(t, aa) && ts(t, ra)) if (e.velocity = 0, t.visualDuration) {
    const n = t.visualDuration,
      s = 2 * Math.PI / (n * 1.2),
      i = s * s,
      r = 2 * st(.05, 1, 1 - (t.bounce || 0)) * Math.sqrt(i);
    e = {
      ...e,
      mass: k.mass,
      stiffness: i,
      damping: r
    };
  } else {
    const n = oa({
      ...t,
      velocity: 0
    });
    e = {
      ...e,
      ...n,
      mass: k.mass
    }, e.isResolvedFromDuration = !0;
  }
  return e;
}
function Kt(t = k.visualDuration, e = k.bounce) {
  const n = typeof t != "object" ? {
    visualDuration: t,
    keyframes: [0, 1],
    bounce: e
  } : t;
  let {
    restSpeed: s,
    restDelta: i
  } = n;
  const r = n.keyframes[0],
    o = n.keyframes[n.keyframes.length - 1],
    a = {
      done: !1,
      value: r
    },
    {
      stiffness: l,
      damping: c,
      mass: u,
      duration: h,
      velocity: f,
      isResolvedFromDuration: d
    } = la({
      ...n,
      velocity: -z(n.velocity || 0)
    }),
    p = f || 0,
    g = c / (2 * Math.sqrt(l * u)),
    m = o - r,
    y = z(Math.sqrt(l / u)),
    x = Math.abs(m) < 5;
  s || (s = x ? k.restSpeed.granular : k.restSpeed.default), i || (i = x ? k.restDelta.granular : k.restDelta.default);
  let T, S, A, M, R, V;
  if (g < 1) A = _e(y, g), M = (p + g * y * m) / A, T = P => {
    const C = Math.exp(-g * y * P);
    return o - C * (M * Math.sin(A * P) + m * Math.cos(A * P));
  }, R = g * y * M + m * A, V = g * y * m - M * A, S = P => Math.exp(-g * y * P) * (R * Math.sin(A * P) + V * Math.cos(A * P));else if (g === 1) {
    T = C => o - Math.exp(-y * C) * (m + (p + y * m) * C);
    const P = p + y * m;
    S = C => Math.exp(-y * C) * (y * P * C - p);
  } else {
    const P = y * Math.sqrt(g * g - 1);
    T = _ => {
      const J = Math.exp(-g * y * _),
        $ = Math.min(P * _, 300);
      return o - J * ((p + g * y * m) * Math.sinh($) + P * m * Math.cosh($)) / P;
    };
    const C = (p + g * y * m) / P,
      I = g * y * C - m * P,
      K = g * y * m - C * P;
    S = _ => {
      const J = Math.exp(-g * y * _),
        $ = Math.min(P * _, 300);
      return J * (I * Math.sinh($) + K * Math.cosh($));
    };
  }
  const b = {
    calculatedDuration: d && h || null,
    velocity: P => G(S(P)),
    next: P => {
      if (!d && g < 1) {
        const I = Math.exp(-g * y * P),
          K = Math.sin(A * P),
          _ = Math.cos(A * P),
          J = o - I * (M * K + m * _),
          $ = G(I * (R * K + V * _));
        return a.done = Math.abs($) <= s && Math.abs(o - J) <= i, a.value = a.done ? o : J, a;
      }
      const C = T(P);
      if (d) a.done = P >= h;else {
        const I = G(S(P));
        a.done = Math.abs(I) <= s && Math.abs(o - C) <= i;
      }
      return a.value = a.done ? o : C, a;
    },
    toString: () => {
      const P = Math.min(An(b), ge),
        C = Gi(I => b.next(P * I).value, P, 30);
      return P + "ms " + C;
    },
    toTransition: () => {}
  };
  return b;
}
const ua = 5;
function zi(t, e, n) {
  const s = Math.max(e - ua, 0);
  return Si(n - t(s), e - s);
}
function Xe({
  keyframes: t,
  velocity: e = 0,
  power: n = .8,
  timeConstant: s = 325,
  bounceDamping: i = 10,
  bounceStiffness: r = 500,
  modifyTarget: o,
  min: a,
  max: l,
  restDelta: c = .5,
  restSpeed: u
}) {
  const h = t[0],
    f = {
      done: !1,
      value: h
    },
    d = V => a !== void 0 && V < a || l !== void 0 && V > l,
    p = V => a === void 0 ? l : l === void 0 || Math.abs(a - V) < Math.abs(l - V) ? a : l;
  let g = n * e;
  const m = h + g,
    y = o === void 0 ? m : o(m);
  y !== m && (g = y - h);
  const x = V => -g * Math.exp(-V / s),
    T = V => y + x(V),
    S = V => {
      const b = x(V),
        P = T(V);
      f.done = Math.abs(b) <= c, f.value = f.done ? y : P;
    };
  let A, M;
  const R = V => {
    d(f.value) && (A = V, M = Kt({
      keyframes: [f.value, p(f.value)],
      velocity: zi(T, V, f.value),
      damping: i,
      stiffness: r,
      restDelta: c,
      restSpeed: u
    }));
  };
  return R(0), {
    calculatedDuration: null,
    next: V => {
      let b = !1;
      return !M && A === void 0 && (b = !0, S(V), R(V)), A !== void 0 && V >= A ? M.next(V - A) : (!b && S(V), f);
    }
  };
}
function ca(t, e, n) {
  const s = [],
    i = n || ct.mix || Ki,
    r = t.length - 1;
  for (let o = 0; o < r; o++) {
    let a = i(t[o], t[o + 1]);
    if (e) {
      const l = Array.isArray(e) ? e[o] || H : e;
      a = Xt(l, a);
    }
    s.push(a);
  }
  return s;
}
function Hi(t, e, {
  clamp: n = !0,
  ease: s,
  mixer: i
} = {}) {
  const r = t.length;
  if (gn(r === e.length), r === 1) return () => e[0];
  if (r === 2 && e[0] === e[1]) return () => e[1];
  const o = t[0] === t[1];
  t[0] > t[r - 1] && (t = [...t].reverse(), e = [...e].reverse());
  const a = ca(e, s, i),
    l = a.length,
    c = u => {
      if (o && u < t[0]) return e[0];
      let h = 0;
      if (l > 1) for (; h < t.length - 2 && !(u < t[h + 1]); h++);
      const f = bt(t[h], t[h + 1], u);
      return a[h](f);
    };
  return n ? u => c(st(t[0], t[r - 1], u)) : c;
}
function _i(t, e) {
  const n = t[t.length - 1];
  for (let s = 1; s <= e; s++) {
    const i = bt(0, e, s);
    t.push(L(n, 1, i));
  }
}
function Xi(t) {
  const e = [0];
  return _i(e, t.length - 1), e;
}
function ha(t, e) {
  return t.map(n => n * e);
}
function fa(t, e) {
  return t.map(() => e || Ei).splice(0, t.length - 1);
}
function Bt({
  duration: t = 300,
  keyframes: e,
  times: n,
  ease: s = "easeInOut"
}) {
  const i = Ri(s) ? s.map(Xn) : Xn(s),
    r = {
      done: !1,
      value: e[0]
    },
    o = ha(n && n.length === e.length ? n : Xi(e), t),
    a = Hi(o, e, {
      ease: Array.isArray(i) ? i : fa(e, i)
    });
  return {
    calculatedDuration: t,
    next: l => (r.value = a(l), r.done = l >= t, r)
  };
}
const da = t => t !== null;
function Pe(t, {
  repeat: e,
  repeatType: n = "loop"
}, s, i = 1) {
  const r = t.filter(da),
    a = i < 0 || e && n !== "loop" && e % 2 === 1 ? 0 : r.length - 1;
  return !a || s === void 0 ? r[a] : s;
}
const pa = {
    decay: Xe,
    inertia: Xe,
    tween: Bt,
    keyframes: Bt,
    spring: Kt
};
function Yi(t) {
  typeof t.type == "string" && (t.type = pa[t.type]);
}
class bn {
  constructor() {
    this.updateFinished();
  }
  get finished() {
    return this._finished;
  }
  updateFinished() {
    this._finished = new Promise(e => {
      this.resolve = e;
    });
  }
  notifyFinished() {
    this.resolve();
  }
  then(e, n) {
    return this.finished.then(e, n);
  }
}
const ma = t => t / 100;
class Gt extends bn {
  constructor(e) {
    super(), this.state = "idle", this.startTime = null, this.isStopped = !1, this.currentTime = 0, this.holdTime = null, this.playbackSpeed = 1, this.delayState = {
      done: !1,
      value: void 0
    }, this.stop = () => {
      const {
        motionValue: n
      } = this.options;
      n && n.updatedAt !== U.now() && this.tick(U.now()), this.isStopped = !0, this.state !== "idle" && (this.teardown(), this.options.onStop?.());
    }, this.options = e, this.initAnimation(), this.play(), e.autoplay === !1 && this.pause();
  }
  initAnimation() {
    const {
      options: e
    } = this;
    Yi(e);
    const {
      type: n = Bt,
      repeat: s = 0,
      repeatDelay: i = 0,
      repeatType: r,
      velocity: o = 0
    } = e;
    let {
      keyframes: a
    } = e;
    const l = n || Bt;
    l !== Bt && typeof a[0] != "number" && (this.mixKeyframes = Xt(ma, Ki(a[0], a[1])), a = [0, 100]);
    const c = l({
      ...e,
      keyframes: a
    });
    r === "mirror" && (this.mirroredGenerator = l({
      ...e,
      keyframes: [...a].reverse(),
      velocity: -o
    })), c.calculatedDuration === null && (c.calculatedDuration = An(c));
    const {
      calculatedDuration: u
    } = c;
    this.calculatedDuration = u, this.resolvedDuration = u + i, this.totalDuration = this.resolvedDuration * (s + 1) - i, this.generator = c;
  }
  updateTime(e) {
    const n = Math.round(e - this.startTime) * this.playbackSpeed;
    this.holdTime !== null ? this.currentTime = this.holdTime : this.currentTime = n;
  }
  tick(e, n = !1) {
    const {
      generator: s,
      totalDuration: i,
      mixKeyframes: r,
      mirroredGenerator: o,
      resolvedDuration: a,
      calculatedDuration: l
    } = this;
    if (this.startTime === null) return s.next(0);
    const {
      delay: c = 0,
      keyframes: u,
      repeat: h,
      repeatType: f,
      repeatDelay: d,
      type: p,
      onUpdate: g,
      finalKeyframe: m
    } = this.options;
    this.speed > 0 ? this.startTime = Math.min(this.startTime, e) : this.speed < 0 && (this.startTime = Math.min(e - i / this.speed, this.startTime)), n ? this.currentTime = e : this.updateTime(e);
    const y = this.currentTime - c * (this.playbackSpeed >= 0 ? 1 : -1),
      x = this.playbackSpeed >= 0 ? y < 0 : y > i;
    this.currentTime = Math.max(y, 0), this.state === "finished" && this.holdTime === null && (this.currentTime = i);
    let T = this.currentTime,
      S = s;
    if (h) {
      const V = Math.min(this.currentTime, i) / a;
      let b = Math.floor(V),
        P = V % 1;
      !P && V >= 1 && (P = 1), P === 1 && b--, b = Math.min(b, h + 1), b % 2 && (f === "reverse" ? (P = 1 - P, d && (P -= d / a)) : f === "mirror" && (S = o)), T = st(0, 1, P) * a;
    }
    let A;
    x ? (this.delayState.value = u[0], A = this.delayState) : A = S.next(T), r && !x && (A.value = r(A.value));
    let {
      done: M
    } = A;
    !x && l !== null && (M = this.playbackSpeed >= 0 ? this.currentTime >= i : this.currentTime <= 0);
    const R = this.holdTime === null && (this.state === "finished" || this.state === "running" && M);
    return R && p !== Xe && (A.value = Pe(u, this.options, m, this.speed)), g && g(A.value), R && this.finish(), A;
  }
  then(e, n) {
    return this.finished.then(e, n);
  }
  get duration() {
    return z(this.calculatedDuration);
  }
  get iterationDuration() {
    const {
      delay: e = 0
    } = this.options || {};
    return this.duration + z(e);
  }
  get time() {
    return z(this.currentTime);
  }
  set time(e) {
    e = G(e), this.currentTime = e, this.startTime === null || this.holdTime !== null || this.playbackSpeed === 0 ? this.holdTime = e : this.driver && (this.startTime = this.driver.now() - e / this.playbackSpeed), this.driver ? this.driver.start(!1) : (this.startTime = 0, this.state = "paused", this.holdTime = e, this.tick(e));
  }
  getGeneratorVelocity() {
    const e = this.currentTime;
    if (e <= 0) return this.options.velocity || 0;
    if (this.generator.velocity) return this.generator.velocity(e);
    const n = this.generator.next(e).value;
    return zi(s => this.generator.next(s).value, e, n);
  }
  get speed() {
    return this.playbackSpeed;
  }
  set speed(e) {
    const n = this.playbackSpeed !== e;
    n && this.driver && this.updateTime(U.now()), this.playbackSpeed = e, n && this.driver && (this.time = z(this.currentTime));
  }
  play() {
    if (this.isStopped) return;
    const {
      driver: e = na,
      startTime: n
    } = this.options;
    this.driver || (this.driver = e(i => this.tick(i))), this.options.onPlay?.();
    const s = this.driver.now();
    this.state === "finished" ? (this.updateFinished(), this.startTime = s) : this.holdTime !== null ? this.startTime = s - this.holdTime : this.startTime || (this.startTime = n ?? s), this.state === "finished" && this.speed < 0 && (this.startTime += this.calculatedDuration), this.holdTime = null, this.state = "running", this.driver.start();
  }
  pause() {
    this.state = "paused", this.updateTime(U.now()), this.holdTime = this.currentTime;
  }
  complete() {
    this.state !== "running" && this.play(), this.state = "finished", this.holdTime = null;
  }
  finish() {
    this.notifyFinished(), this.teardown(), this.state = "finished", this.options.onComplete?.();
  }
  cancel() {
    this.holdTime = null, this.startTime = 0, this.tick(0), this.teardown(), this.options.onCancel?.();
  }
  teardown() {
    this.state = "idle", this.stopDriver(), this.startTime = this.holdTime = null;
  }
  stopDriver() {
    this.driver && (this.driver.stop(), this.driver = void 0);
  }
  sample(e) {
    return this.startTime = 0, this.tick(e, !0);
  }
  attachTimeline(e) {
    return this.options.allowFlatten && (this.options.type = "keyframes", this.options.ease = "linear", this.initAnimation()), this.driver?.stop(), e.observe(this);
  }
}
function ga(t) {
  for (let e = 1; e < t.length; e++) t[e] ?? (t[e] = t[e - 1]);
}
const gt = t => t * 180 / Math.PI, Ye = t => {
    const e = gt(Math.atan2(t[1], t[0]));
    return qe(e);
}, ya = {
    x: 4,
    y: 5,
    translateX: 4,
    translateY: 5,
    scaleX: 0,
    scaleY: 3,
    scale: t => (Math.abs(t[0]) + Math.abs(t[3])) / 2,
    rotate: Ye,
    rotateZ: Ye,
    skewX: t => gt(Math.atan(t[1])),
    skewY: t => gt(Math.atan(t[2])),
    skew: t => (Math.abs(t[1]) + Math.abs(t[2])) / 2
}, qe = t => (t = t % 360, t < 0 && (t += 360), t), es = Ye, ns = t => Math.sqrt(t[0] * t[0] + t[1] * t[1]), ss = t => Math.sqrt(t[4] * t[4] + t[5] * t[5]), va = {
    x: 12,
    y: 13,
    z: 14,
    translateX: 12,
    translateY: 13,
    translateZ: 14,
    scaleX: ns,
    scaleY: ss,
    scale: t => (ns(t) + ss(t)) / 2,
    rotateX: t => qe(gt(Math.atan2(t[6], t[5]))),
    rotateY: t => qe(gt(Math.atan2(-t[2], t[0]))),
    rotateZ: es,
    rotate: es,
    skewX: t => gt(Math.atan(t[4])),
    skewY: t => gt(Math.atan(t[1])),
    skew: t => (Math.abs(t[1]) + Math.abs(t[4])) / 2
};
function Ze(t) {
  return t.includes("scale") ? 1 : 0;
}
function Je(t, e) {
  if (!t || t === "none") return Ze(e);
  const n = t.match(/^matrix3d\(([-\d.e\s,]+)\)$/u);
  let s, i;
  if (n) s = va, i = n;else {
    const a = t.match(/^matrix\(([-\d.e\s,]+)\)$/u);
    s = ya, i = a;
  }
  if (!i) return Ze(e);
  const r = s[e],
    o = i[1].split(",").map(Ta);
  return typeof r == "function" ? r(o) : o[r];
}
const xa = (t, e) => {
    const { transform: n = "none" } = getComputedStyle(t);
    return Je(n, e);
};
function Ta(t) {
  return parseFloat(t.trim());
}
const Mt = ["transformPerspective", "x", "y", "z", "translateX", "translateY", "translateZ", "scale", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "rotateZ", "skew", "skewX", "skewY"], Dt = new Set(Mt), is = t => t === Ct || t === w, Sa = new Set(["x", "y", "z"]), wa = Mt.filter(t => !Sa.has(t));
function Pa(t) {
  const e = [];
  return wa.forEach(n => {
    const s = t.getValue(n);
    s !== void 0 && (e.push([n, s.get()]), s.set(n.startsWith("scale") ? 1 : 0));
  }), e;
}
const lt = {
    width: ({ x: t }, { paddingLeft: e = "0", paddingRight: n = "0", boxSizing: s }) => {
        const i = t.max - t.min;
        return s === "border-box" ? i : i - parseFloat(e) - parseFloat(n);
    },
    height: ({ y: t }, { paddingTop: e = "0", paddingBottom: n = "0", boxSizing: s }) => {
        const i = t.max - t.min;
        return s === "border-box" ? i : i - parseFloat(e) - parseFloat(n);
    },
    top: (t, { top: e }) => parseFloat(e),
    left: (t, { left: e }) => parseFloat(e),
    bottom: ({ y: t }, { top: e }) => parseFloat(e) + (t.max - t.min),
    right: ({ x: t }, { left: e }) => parseFloat(e) + (t.max - t.min),
    x: (t, { transform: e }) => Je(e, "x"),
    y: (t, { transform: e }) => Je(e, "y")
};
const yt = new Set();
let Qe = !1, tn = !1, en = !1;
function qi() {
  if (tn) {
    const t = Array.from(yt).filter(s => s.needsMeasurement),
      e = new Set(t.map(s => s.element)),
      n = new Map();
    e.forEach(s => {
      const i = Pa(s);
      i.length && (n.set(s, i), s.render());
    }), t.forEach(s => s.measureInitialState()), e.forEach(s => {
      s.render();
      const i = n.get(s);
      i && i.forEach(([r, o]) => {
        s.getValue(r)?.set(o);
      });
    }), t.forEach(s => s.measureEndState()), t.forEach(s => {
      s.suspendedScrollY !== void 0 && window.scrollTo(0, s.suspendedScrollY);
    });
  }
  tn = !1, Qe = !1, yt.forEach(t => t.complete(en)), yt.clear();
}
function Zi() {
  yt.forEach(t => {
    t.readKeyframes(), t.needsMeasurement && (tn = !0);
  });
}
function Aa() {
  en = !0, Zi(), qi(), en = !1;
}
class Vn {
  constructor(e, n, s, i, r, o = !1) {
    this.state = "pending", this.isAsync = !1, this.needsMeasurement = !1, this.unresolvedKeyframes = [...e], this.onComplete = n, this.name = s, this.motionValue = i, this.element = r, this.isAsync = o;
  }
  scheduleResolve() {
    this.state = "scheduled", this.isAsync ? (yt.add(this), Qe || (Qe = !0, D.read(Zi), D.resolveKeyframes(qi))) : (this.readKeyframes(), this.complete());
  }
  readKeyframes() {
    const {
      unresolvedKeyframes: e,
      name: n,
      element: s,
      motionValue: i
    } = this;
    if (e[0] === null) {
      const r = i?.get(),
        o = e[e.length - 1];
      if (r !== void 0) e[0] = r;else if (s && n) {
        const a = s.readValue(n, o);
        a != null && (e[0] = a);
      }
      e[0] === void 0 && (e[0] = o), i && r === void 0 && i.set(e[0]);
    }
    ga(e);
  }
  setFinalKeyframe() {}
  measureInitialState() {}
  renderEndStyles() {}
  measureEndState() {}
  complete(e = !1) {
    this.state = "complete", this.onComplete(this.unresolvedKeyframes, this.finalKeyframe, e), yt.delete(this);
  }
  cancel() {
    this.state === "scheduled" && (yt.delete(this), this.state = "pending");
  }
  resume() {
    this.state === "pending" && this.scheduleResolve();
  }
}
const ba = t => t.startsWith("--");
function Ji(t, e, n) {
  ba(e) ? t.style.setProperty(e, n) : t.style[e] = n;
}
const Va = {};
function Qi(t, e) {
  const n = Ti(t);
  return () => Va[e] ?? n();
}
const Ca = Qi(() => window.ScrollTimeline !== void 0, "scrollTimeline"), to = Qi(() => {
    try {
        document.createElement("div").animate({
            opacity: 0
        }, {
            easing: "linear(0, 1)"
        });
    }
    catch {
        return !1;
    }
    return !0;
}, "linearEasing"), It = ([t, e, n, s]) => `cubic-bezier(${t}, ${e}, ${n}, ${s})`, os = {
    linear: "linear",
    ease: "ease",
    easeIn: "ease-in",
    easeOut: "ease-out",
    easeInOut: "ease-in-out",
    circIn: It([0, .65, .55, 1]),
    circOut: It([.55, 0, 1, .45]),
    backIn: It([.31, .01, .66, -.59]),
    backOut: It([.33, 1.53, .69, .99])
};
function eo(t, e) {
  if (t) return typeof t == "function" ? to() ? Gi(t, e) : "ease-out" : ki(t) ? It(t) : Array.isArray(t) ? t.map(n => eo(n, e) || os.easeOut) : os[t];
}
function Ma(t, e, n, {
  delay: s = 0,
  duration: i = 300,
  repeat: r = 0,
  repeatType: o = "loop",
  ease: a = "easeOut",
  times: l
} = {}, c = void 0) {
  const u = {
    [e]: n
  };
  l && (u.offset = l);
  const h = eo(a, i);
  Array.isArray(h) && (u.easing = h);
  const f = {
    delay: s,
    duration: i,
    easing: Array.isArray(h) ? "linear" : h,
    fill: "both",
    iterations: r + 1,
    direction: o === "reverse" ? "alternate" : "normal"
  };
  return c && (f.pseudoElement = c), t.animate(u, f);
}
function Cn(t) {
  return typeof t == "function" && "applyToOptions" in t;
}
function Da({
  type: t,
  ...e
}) {
  return Cn(t) && to() ? t.applyToOptions(e) : (e.duration ?? (e.duration = 300), e.ease ?? (e.ease = "easeOut"), e);
}
class no extends bn {
  constructor(e) {
    if (super(), this.finishedTime = null, this.isStopped = !1, this.manualStartTime = null, !e) return;
    const {
      element: n,
      name: s,
      keyframes: i,
      pseudoElement: r,
      allowFlatten: o = !1,
      finalKeyframe: a,
      onComplete: l
    } = e;
    this.isPseudoElement = !!r, this.allowFlatten = o, this.options = e, gn(typeof e.type != "string");
    const c = Da(e);
    this.animation = Ma(n, s, i, c, r), c.autoplay === !1 && this.animation.pause(), this.animation.onfinish = () => {
      if (this.finishedTime = this.time, !r) {
        const u = Pe(i, this.options, a, this.speed);
        this.updateMotionValue && this.updateMotionValue(u), Ji(n, s, u), this.animation.cancel();
      }
      l?.(), this.notifyFinished();
    };
  }
  play() {
    this.isStopped || (this.manualStartTime = null, this.animation.play(), this.state === "finished" && this.updateFinished());
  }
  pause() {
    this.animation.pause();
  }
  complete() {
    this.animation.finish?.();
  }
  cancel() {
    try {
      this.animation.cancel();
    } catch {}
  }
  stop() {
    if (this.isStopped) return;
    this.isStopped = !0;
    const {
      state: e
    } = this;
    e === "idle" || e === "finished" || (this.updateMotionValue ? this.updateMotionValue() : this.commitStyles(), this.isPseudoElement || this.cancel());
  }
  commitStyles() {
    const e = this.options?.element;
    !this.isPseudoElement && e?.isConnected && this.animation.commitStyles?.();
  }
  get duration() {
    const e = this.animation.effect?.getComputedTiming?.().duration || 0;
    return z(Number(e));
  }
  get iterationDuration() {
    const {
      delay: e = 0
    } = this.options || {};
    return this.duration + z(e);
  }
  get time() {
    return z(Number(this.animation.currentTime) || 0);
  }
  set time(e) {
    const n = this.finishedTime !== null;
    this.manualStartTime = null, this.finishedTime = null, this.animation.currentTime = G(e), n && this.animation.pause();
  }
  get speed() {
    return this.animation.playbackRate;
  }
  set speed(e) {
    e < 0 && (this.finishedTime = null), this.animation.playbackRate = e;
  }
  get state() {
    return this.finishedTime !== null ? "finished" : this.animation.playState;
  }
  get startTime() {
    return this.manualStartTime ?? Number(this.animation.startTime);
  }
  set startTime(e) {
    this.manualStartTime = this.animation.startTime = e;
  }
  attachTimeline({
    timeline: e,
    rangeStart: n,
    rangeEnd: s,
    observe: i
  }) {
    return this.allowFlatten && this.animation.effect?.updateTiming({
      easing: "linear"
    }), this.animation.onfinish = null, e && Ca() ? (this.animation.timeline = e, n && (this.animation.rangeStart = n), s && (this.animation.rangeEnd = s), H) : i(this);
  }
}
const so = {
    anticipate: Ci,
    backInOut: Vi,
    circInOut: Di
};
function Ea(t) {
  return t in so;
}
function Ra(t) {
  typeof t.ease == "string" && Ea(t.ease) && (t.ease = so[t.ease]);
}
const ke = 10;
class La extends no {
  constructor(e) {
    Ra(e), Yi(e), super(e), e.startTime !== void 0 && e.autoplay !== !1 && (this.startTime = e.startTime), this.options = e;
  }
  updateMotionValue(e) {
    const {
      motionValue: n,
      onUpdate: s,
      onComplete: i,
      element: r,
      ...o
    } = this.options;
    if (!n) return;
    if (e !== void 0) {
      n.set(e);
      return;
    }
    const a = new Gt({
        ...o,
        autoplay: !1
      }),
      l = Math.max(ke, U.now() - this.startTime),
      c = st(0, ke, l - ke),
      u = a.sample(l).value,
      {
        name: h
      } = this.options;
    r && h && Ji(r, h, u), n.setWithVelocity(a.sample(Math.max(0, l - c)).value, u, c), a.stop();
  }
}
const rs = (t, e) => e === "zIndex" ? !1 : !!(typeof t == "number" || Array.isArray(t) || typeof t == "string" && (Z.test(t) || t === "0") && !t.startsWith("url("));
function ka(t) {
  const e = t[0];
  if (t.length === 1) return !0;
  for (let n = 0; n < t.length; n++) if (t[n] !== e) return !0;
}
function Ia(t, e, n, s) {
  const i = t[0];
  if (i === null) return !1;
  if (e === "display" || e === "visibility") return !0;
  const r = t[t.length - 1],
    o = rs(i, e),
    a = rs(r, e);
  return !o || !a ? !1 : ka(t) || (n === "spring" || Cn(n)) && s;
}
function nn(t) {
  t.duration = 0, t.type = "keyframes";
}
const io = new Set(["opacity", "clipPath", "filter", "transform"]), Fa = /^(?:oklch|oklab|lab|lch|color|color-mix|light-dark)\(/;
function Ba(t) {
  for (let e = 0; e < t.length; e++) if (typeof t[e] == "string" && Fa.test(t[e])) return !0;
  return !1;
}
const ja = new Set(["color", "backgroundColor", "outlineColor", "fill", "stroke", "borderColor", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"]), Oa = Ti(() => Object.hasOwnProperty.call(Element.prototype, "animate"));
function Na(t) {
  const {
    motionValue: e,
    name: n,
    repeatDelay: s,
    repeatType: i,
    damping: r,
    type: o,
    keyframes: a
  } = t;
  if (!(e?.owner?.current instanceof HTMLElement)) return !1;
  const {
    onUpdate: c,
    transformTemplate: u
  } = e.owner.getProps();
  return Oa() && n && (io.has(n) || ja.has(n) && Ba(a)) && (n !== "transform" || !u) && !c && !s && i !== "mirror" && r !== 0 && o !== "inertia";
}
const Ua = 40;
class Wa extends bn {
  constructor({
    autoplay: e = !0,
    delay: n = 0,
    type: s = "keyframes",
    repeat: i = 0,
    repeatDelay: r = 0,
    repeatType: o = "loop",
    keyframes: a,
    name: l,
    motionValue: c,
    element: u,
    ...h
  }) {
    super(), this.stop = () => {
      this._animation && (this._animation.stop(), this.stopTimeline?.()), this.keyframeResolver?.cancel();
    }, this.createdAt = U.now();
    const f = {
        autoplay: e,
        delay: n,
        type: s,
        repeat: i,
        repeatDelay: r,
        repeatType: o,
        name: l,
        motionValue: c,
        element: u,
        ...h
      },
      d = u?.KeyframeResolver || Vn;
    this.keyframeResolver = new d(a, (p, g, m) => this.onKeyframesResolved(p, g, f, !m), l, c, u), this.keyframeResolver?.scheduleResolve();
  }
  onKeyframesResolved(e, n, s, i) {
    this.keyframeResolver = void 0;
    const {
      name: r,
      type: o,
      velocity: a,
      delay: l,
      isHandoff: c,
      onUpdate: u
    } = s;
    this.resolvedAt = U.now();
    let h = !0;
    Ia(e, r, o, a) || (h = !1, (ct.instantAnimations || !l) && u?.(Pe(e, s, n)), e[0] = e[e.length - 1], nn(s), s.repeat = 0);
    const d = {
        startTime: i ? this.resolvedAt ? this.resolvedAt - this.createdAt > Ua ? this.resolvedAt : this.createdAt : this.createdAt : void 0,
        finalKeyframe: n,
        ...s,
        keyframes: e
      },
      p = h && !c && Na(d),
      g = d.motionValue?.owner?.current;
    let m;
    if (p) try {
      m = new La({
        ...d,
        element: g
      });
    } catch {
      m = new Gt(d);
    } else m = new Gt(d);
    m.finished.then(() => {
      this.notifyFinished();
    }).catch(H), this.pendingTimeline && (this.stopTimeline = m.attachTimeline(this.pendingTimeline), this.pendingTimeline = void 0), this._animation = m;
  }
  get finished() {
    return this._animation ? this.animation.finished : this._finished;
  }
  then(e, n) {
    return this.finished.finally(e).then(() => {});
  }
  get animation() {
    return this._animation || (this.keyframeResolver?.resume(), Aa()), this._animation;
  }
  get duration() {
    return this.animation.duration;
  }
  get iterationDuration() {
    return this.animation.iterationDuration;
  }
  get time() {
    return this.animation.time;
  }
  set time(e) {
    this.animation.time = e;
  }
  get speed() {
    return this.animation.speed;
  }
  get state() {
    return this.animation.state;
  }
  set speed(e) {
    this.animation.speed = e;
  }
  get startTime() {
    return this.animation.startTime;
  }
  attachTimeline(e) {
    return this._animation ? this.stopTimeline = this.animation.attachTimeline(e) : this.pendingTimeline = e, () => this.stop();
  }
  play() {
    this.animation.play();
  }
  pause() {
    this.animation.pause();
  }
  complete() {
    this.animation.complete();
  }
  cancel() {
    this._animation && this.animation.cancel(), this.keyframeResolver?.cancel();
  }
}
class Ka {
  constructor(e) {
    this.stop = () => this.runAll("stop"), this.animations = e.filter(Boolean);
  }
  get finished() {
    return Promise.all(this.animations.map(e => e.finished));
  }
  getAll(e) {
    return this.animations[0][e];
  }
  setAll(e, n) {
    for (let s = 0; s < this.animations.length; s++) this.animations[s][e] = n;
  }
  attachTimeline(e) {
    const n = this.animations.map(s => s.attachTimeline(e));
    return () => {
      n.forEach((s, i) => {
        s && s(), this.animations[i].stop();
      });
    };
  }
  get time() {
    return this.getAll("time");
  }
  set time(e) {
    this.setAll("time", e);
  }
  get speed() {
    return this.getAll("speed");
  }
  set speed(e) {
    this.setAll("speed", e);
  }
  get state() {
    return this.getAll("state");
  }
  get startTime() {
    return this.getAll("startTime");
  }
  get duration() {
    return as(this.animations, "duration");
  }
  get iterationDuration() {
    return as(this.animations, "iterationDuration");
  }
  runAll(e) {
    this.animations.forEach(n => n[e]());
  }
  play() {
    this.runAll("play");
  }
  pause() {
    this.runAll("pause");
  }
  cancel() {
    this.runAll("cancel");
  }
  complete() {
    this.runAll("complete");
  }
}
function as(t, e) {
  let n = 0;
  for (let s = 0; s < t.length; s++) {
    const i = t[s][e];
    i !== null && i > n && (n = i);
  }
  return n;
}
class Ga extends Ka {
  then(e, n) {
    return this.finished.finally(e).then(() => {});
  }
}
function oo(t, e, n, s = 0, i = 1) {
  const r = Array.from(t).sort((c, u) => c.sortNodePosition(u)).indexOf(e),
    o = t.size,
    a = (o - 1) * s;
  return typeof n == "function" ? n(r, o) : i === 1 ? r * s : a - r * s;
}
const $a = /^var\(--(?:([\w-]+)|([\w-]+), ?([a-zA-Z\d ()%#.,-]+))\)/u;
function za(t) {
  const e = $a.exec(t);
  if (!e) return [,];
  const [, n, s, i] = e;
  return [`--${n ?? s}`, i];
}
function ro(t, e, n = 1) {
  const [s, i] = za(t);
  if (!s) return;
  const r = window.getComputedStyle(e).getPropertyValue(s);
  if (r) {
    const o = r.trim();
    return yi(o) ? parseFloat(o) : o;
  }
  return Tn(i) ? ro(i, e, n + 1) : i;
}
const Ha = {
    type: "spring",
    stiffness: 500,
    damping: 25,
    restSpeed: 10
}, _a = t => ({
    type: "spring",
    stiffness: 550,
    damping: t === 0 ? 2 * Math.sqrt(550) : 30,
    restSpeed: 10
}), Xa = {
    type: "keyframes",
    duration: .8
}, Ya = {
    type: "keyframes",
    ease: [.25, .1, .35, 1],
    duration: .3
}, qa = (t, { keyframes: e }) => e.length > 2 ? Xa : Dt.has(t) ? t.startsWith("scale") ? _a(e[1]) : Ha : Ya;
function Mn(t, e) {
  if (t?.inherit && e) {
    const {
      inherit: n,
      ...s
    } = t;
    return {
      ...e,
      ...s
    };
  }
  return t;
}
function Dn(t, e) {
  const n = t?.[e] ?? t?.default ?? t;
  return n !== t ? Mn(n, t) : n;
}
const Za = new Set(["when", "delay", "delayChildren", "staggerChildren", "staggerDirection", "repeat", "repeatType", "repeatDelay", "from", "elapsed"]);
function Ja(t) {
  for (const e in t) if (!Za.has(e)) return !0;
  return !1;
}
const En = (t, e, n, s = {}, i, r) => o => {
    const a = Dn(s, t) || {}, l = a.delay || s.delay || 0;
    let { elapsed: c = 0 } = s;
    c = c - G(l);
    const u = {
        keyframes: Array.isArray(n) ? n : [null, n],
        ease: "easeOut",
        velocity: e.getVelocity(),
        ...a,
        delay: -c,
        onUpdate: f => {
            e.set(f), a.onUpdate && a.onUpdate(f);
        },
        onComplete: () => {
            o(), a.onComplete && a.onComplete();
        },
        name: t,
        motionValue: e,
        element: r ? void 0 : i
    };
    Ja(a) || Object.assign(u, qa(t, u)), u.duration && (u.duration = G(u.duration)), u.repeatDelay && (u.repeatDelay = G(u.repeatDelay)), u.from !== void 0 && (u.keyframes[0] = u.from);
    let h = !1;
    if ((u.type === !1 || u.duration === 0 && !u.repeatDelay) && (nn(u), u.delay === 0 && (h = !0)), (ct.instantAnimations || ct.skipAnimations || i?.shouldSkipAnimations) && (h = !0, nn(u), u.delay = 0), u.allowFlatten = !a.type && !a.ease, h && !r && e.get() !== void 0) {
        const f = Pe(u.keyframes, a);
        if (f !== void 0) {
            D.update(() => {
                u.onUpdate(f), u.onComplete();
            });
            return;
        }
    }
    return a.isSync ? new Gt(u) : new Wa(u);
};
function ls(t) {
  const e = [{}, {}];
  return t?.values.forEach((n, s) => {
    e[0][s] = n.get(), e[1][s] = n.getVelocity();
  }), e;
}
function Rn(t, e, n, s) {
  if (typeof e == "function") {
    const [i, r] = ls(s);
    e = e(n !== void 0 ? n : t.custom, i, r);
  }
  if (typeof e == "string" && (e = t.variants && t.variants[e]), typeof e == "function") {
    const [i, r] = ls(s);
    e = e(n !== void 0 ? n : t.custom, i, r);
  }
  return e;
}
function vt(t, e, n) {
  const s = t.getProps();
  return Rn(s, e, n !== void 0 ? n : s.custom, t);
}
const ao = new Set(["width", "height", "top", "left", "right", "bottom", ...Mt]), us = 30, Qa = t => !isNaN(parseFloat(t)), jt = {
    current: void 0
};
class tl {
  constructor(e, n = {}) {
    this.canTrackVelocity = null, this.events = {}, this.updateAndNotify = s => {
      const i = U.now();
      if (this.updatedAt !== i && this.setPrevFrameValue(), this.prev = this.current, this.setCurrent(s), this.current !== this.prev && (this.events.change?.notify(this.current), this.dependents)) for (const r of this.dependents) r.dirty();
    }, this.hasAnimated = !1, this.setCurrent(e), this.owner = n.owner;
  }
  setCurrent(e) {
    this.current = e, this.updatedAt = U.now(), this.canTrackVelocity === null && e !== void 0 && (this.canTrackVelocity = Qa(this.current));
  }
  setPrevFrameValue(e = this.current) {
    this.prevFrameValue = e, this.prevUpdatedAt = this.updatedAt;
  }
  onChange(e) {
    return this.on("change", e);
  }
  on(e, n) {
    this.events[e] || (this.events[e] = new yn());
    const s = this.events[e].add(n);
    return e === "change" ? () => {
      s(), D.read(() => {
        this.events.change.getSize() || this.stop();
      });
    } : s;
  }
  clearListeners() {
    for (const e in this.events) this.events[e].clear();
  }
  attach(e, n) {
    this.passiveEffect = e, this.stopPassiveEffect = n;
  }
  set(e) {
    this.passiveEffect ? this.passiveEffect(e, this.updateAndNotify) : this.updateAndNotify(e);
  }
  setWithVelocity(e, n, s) {
    this.set(n), this.prev = void 0, this.prevFrameValue = e, this.prevUpdatedAt = this.updatedAt - s;
  }
  jump(e, n = !0) {
    this.updateAndNotify(e), this.prev = e, this.prevUpdatedAt = this.prevFrameValue = void 0, n && this.stop(), this.stopPassiveEffect && this.stopPassiveEffect();
  }
  dirty() {
    this.events.change?.notify(this.current);
  }
  addDependent(e) {
    this.dependents || (this.dependents = new Set()), this.dependents.add(e);
  }
  removeDependent(e) {
    this.dependents && this.dependents.delete(e);
  }
  get() {
    return jt.current && jt.current.push(this), this.current;
  }
  getPrevious() {
    return this.prev;
  }
  getVelocity() {
    const e = U.now();
    if (!this.canTrackVelocity || this.prevFrameValue === void 0 || e - this.updatedAt > us) return 0;
    const n = Math.min(this.updatedAt - this.prevUpdatedAt, us);
    return Si(parseFloat(this.current) - parseFloat(this.prevFrameValue), n);
  }
  start(e) {
    return this.stop(), new Promise(n => {
      this.hasAnimated = !0, this.animation = e(n), this.events.animationStart && this.events.animationStart.notify();
    }).then(() => {
      this.events.animationComplete && this.events.animationComplete.notify(), this.clearAnimation();
    });
  }
  stop() {
    this.animation && (this.animation.stop(), this.events.animationCancel && this.events.animationCancel.notify()), this.clearAnimation();
  }
  isAnimating() {
    return !!this.animation;
  }
  clearAnimation() {
    delete this.animation;
  }
  destroy() {
    this.dependents?.clear(), this.events.destroy?.notify(), this.clearListeners(), this.stop(), this.stopPassiveEffect && this.stopPassiveEffect();
  }
}
function ht(t, e) {
  return new tl(t, e);
}
const sn = t => Array.isArray(t);
function el(t, e, n) {
  t.hasValue(e) ? t.getValue(e).set(n) : t.addValue(e, ht(n));
}
function nl(t) {
  return sn(t) ? t[t.length - 1] || 0 : t;
}
function sl(t, e) {
  const n = vt(t, e);
  let {
    transitionEnd: s = {},
    transition: i = {},
    ...r
  } = n || {};
  r = {
    ...r,
    ...s
  };
  for (const o in r) {
    const a = nl(r[o]);
    el(t, o, a);
  }
}
const F = t => !!(t && t.getVelocity);
function il(t) {
  return !!(F(t) && t.add);
}
function on(t, e) {
  const n = t.getValue("willChange");
  if (il(n)) return n.add(e);
  if (!n && ct.WillChange) {
    const s = new ct.WillChange("auto");
    t.addValue("willChange", s), s.add(e);
  }
}
function Ln(t) {
  return t.replace(/([A-Z])/g, e => `-${e.toLowerCase()}`);
}
const ol = "framerAppearId", lo = "data-" + Ln(ol);
function uo(t) {
  return t.props[lo];
}
function rl({
  protectedKeys: t,
  needsAnimating: e
}, n) {
  const s = t.hasOwnProperty(n) && e[n] !== !0;
  return e[n] = !1, s;
}
function kn(t, e, {
  delay: n = 0,
  transitionOverride: s,
  type: i
} = {}) {
  let {
    transition: r,
    transitionEnd: o,
    ...a
  } = e;
  const l = t.getDefaultTransition();
  r = r ? Mn(r, l) : l;
  const c = r?.reduceMotion;
  s && (r = s);
  const u = [],
    h = i && t.animationState && t.animationState.getState()[i];
  for (const f in a) {
    const d = t.getValue(f, t.latestValues[f] ?? null),
      p = a[f];
    if (p === void 0 || h && rl(h, f)) continue;
    const g = {
        delay: n,
        ...Dn(r || {}, f)
      },
      m = d.get();
    if (m !== void 0 && !d.isAnimating() && !Array.isArray(p) && p === m && !g.velocity) {
      D.update(() => d.set(p));
      continue;
    }
    let y = !1;
    if (window.MotionHandoffAnimation) {
      const S = uo(t);
      if (S) {
        const A = window.MotionHandoffAnimation(S, f, D);
        A !== null && (g.startTime = A, y = !0);
      }
    }
    on(t, f);
    const x = c ?? t.shouldReduceMotion;
    d.start(En(f, d, p, x && ao.has(f) ? {
      type: !1
    } : g, t, y));
    const T = d.animation;
    T && u.push(T);
  }
  if (o) {
    const f = () => D.update(() => {
      o && sl(t, o);
    });
    u.length ? Promise.all(u).then(f) : f();
  }
  return u;
}
function rn(t, e, n = {}) {
  const s = vt(t, e, n.type === "exit" ? t.presenceContext?.custom : void 0);
  let {
    transition: i = t.getDefaultTransition() || {}
  } = s || {};
  n.transitionOverride && (i = n.transitionOverride);
  const r = s ? () => Promise.all(kn(t, s, n)) : () => Promise.resolve(),
    o = t.variantChildren && t.variantChildren.size ? (l = 0) => {
      const {
        delayChildren: c = 0,
        staggerChildren: u,
        staggerDirection: h
      } = i;
      return al(t, e, l, c, u, h, n);
    } : () => Promise.resolve(),
    {
      when: a
    } = i;
  if (a) {
    const [l, c] = a === "beforeChildren" ? [r, o] : [o, r];
    return l().then(() => c());
  } else return Promise.all([r(), o(n.delay)]);
}
function al(t, e, n = 0, s = 0, i = 0, r = 1, o) {
  const a = [];
  for (const l of t.variantChildren) l.notify("AnimationStart", e), a.push(rn(l, e, {
    ...o,
    delay: n + (typeof s == "function" ? 0 : s) + oo(t.variantChildren, l, s, i, r)
  }).then(() => l.notify("AnimationComplete", e)));
  return Promise.all(a);
}
function ll(t, e, n = {}) {
  t.notify("AnimationStart", e);
  let s;
  if (Array.isArray(e)) {
    const i = e.map(r => rn(t, r, n));
    s = Promise.all(i);
  } else if (typeof e == "string") s = rn(t, e, n);else {
    const i = typeof e == "function" ? vt(t, e, n.custom) : e;
    s = Promise.all(kn(t, i, n));
  }
  return s.then(() => {
    t.notify("AnimationComplete", e);
  });
}
const ul = {
    test: t => t === "auto",
    parse: t => t
}, co = t => e => e.test(t), ho = [Ct, w, nt, at, jr, Br, ul], cs = t => ho.find(co(t));
function cl(t) {
  return typeof t == "number" ? t === 0 : t !== null ? t === "none" || t === "0" || xi(t) : !0;
}
const hl = new Set(["brightness", "contrast", "saturate", "opacity"]);
function fl(t) {
  const [e, n] = t.slice(0, -1).split("(");
  if (e === "drop-shadow") return t;
  const [s] = n.match(Sn) || [];
  if (!s) return t;
  const i = n.replace(s, "");
  let r = hl.has(e) ? 1 : 0;
  return s !== n && (r *= 100), e + "(" + r + i + ")";
}
const dl = /\b([a-z-]*)\(.*?\)/gu, an = {
    ...Z,
    getAnimatableNone: t => {
        const e = t.match(dl);
        return e ? e.map(fl).join(" ") : t;
    }
}, ln = {
    ...Z,
    getAnimatableNone: t => {
        const e = Z.parse(t);
        return Z.createTransformer(t)(e.map(s => typeof s == "number" ? 0 : typeof s == "object" ? {
            ...s,
            alpha: 1
        } : s));
    }
}, hs = {
    ...Ct,
    transform: Math.round
}, pl = {
    rotate: at,
    rotateX: at,
    rotateY: at,
    rotateZ: at,
    scale: ne,
    scaleX: ne,
    scaleY: ne,
    scaleZ: ne,
    skew: at,
    skewX: at,
    skewY: at,
    distance: w,
    translateX: w,
    translateY: w,
    translateZ: w,
    x: w,
    y: w,
    z: w,
    perspective: w,
    transformPerspective: w,
    opacity: Wt,
    originX: qn,
    originY: qn,
    originZ: w
}, In = {
    borderWidth: w,
    borderTopWidth: w,
    borderRightWidth: w,
    borderBottomWidth: w,
    borderLeftWidth: w,
    borderRadius: w,
    borderTopLeftRadius: w,
    borderTopRightRadius: w,
    borderBottomRightRadius: w,
    borderBottomLeftRadius: w,
    width: w,
    maxWidth: w,
    height: w,
    maxHeight: w,
    top: w,
    right: w,
    bottom: w,
    left: w,
    inset: w,
    insetBlock: w,
    insetBlockStart: w,
    insetBlockEnd: w,
    insetInline: w,
    insetInlineStart: w,
    insetInlineEnd: w,
    padding: w,
    paddingTop: w,
    paddingRight: w,
    paddingBottom: w,
    paddingLeft: w,
    paddingBlock: w,
    paddingBlockStart: w,
    paddingBlockEnd: w,
    paddingInline: w,
    paddingInlineStart: w,
    paddingInlineEnd: w,
    margin: w,
    marginTop: w,
    marginRight: w,
    marginBottom: w,
    marginLeft: w,
    marginBlock: w,
    marginBlockStart: w,
    marginBlockEnd: w,
    marginInline: w,
    marginInlineStart: w,
    marginInlineEnd: w,
    fontSize: w,
    backgroundPositionX: w,
    backgroundPositionY: w,
    ...pl,
    zIndex: hs,
    fillOpacity: Wt,
    strokeOpacity: Wt,
    numOctaves: hs
}, ml = {
    ...In,
    color: j,
    backgroundColor: j,
    outlineColor: j,
    fill: j,
    stroke: j,
    borderColor: j,
    borderTopColor: j,
    borderRightColor: j,
    borderBottomColor: j,
    borderLeftColor: j,
    filter: an,
    WebkitFilter: an,
    mask: ln,
    WebkitMask: ln
}, fo = t => ml[t], gl = new Set([an, ln]);
function po(t, e) {
  let n = fo(t);
  return gl.has(n) || (n = Z), n.getAnimatableNone ? n.getAnimatableNone(e) : void 0;
}
const yl = new Set(["auto", "none", "0"]);
function vl(t, e, n) {
  let s = 0,
    i;
  for (; s < t.length && !i;) {
    const r = t[s];
    typeof r == "string" && !yl.has(r) && Vt(r).values.length && (i = t[s]), s++;
  }
  if (i && n) for (const r of e) t[r] = po(n, i);
}
class xl extends Vn {
  constructor(e, n, s, i, r) {
    super(e, n, s, i, r, !0);
  }
  readKeyframes() {
    const {
      unresolvedKeyframes: e,
      element: n,
      name: s
    } = this;
    if (!n || !n.current) return;
    super.readKeyframes();
    for (let u = 0; u < e.length; u++) {
      let h = e[u];
      if (typeof h == "string" && (h = h.trim(), Tn(h))) {
        const f = ro(h, n.current);
        f !== void 0 && (e[u] = f), u === e.length - 1 && (this.finalKeyframe = h);
      }
    }
    if (this.resolveNoneKeyframes(), !ao.has(s) || e.length !== 2) return;
    const [i, r] = e,
      o = cs(i),
      a = cs(r),
      l = Yn(i),
      c = Yn(r);
    if (l !== c && lt[s]) {
      this.needsMeasurement = !0;
      return;
    }
    if (o !== a) if (is(o) && is(a)) for (let u = 0; u < e.length; u++) {
      const h = e[u];
      typeof h == "string" && (e[u] = parseFloat(h));
    } else lt[s] && (this.needsMeasurement = !0);
  }
  resolveNoneKeyframes() {
    const {
        unresolvedKeyframes: e,
        name: n
      } = this,
      s = [];
    for (let i = 0; i < e.length; i++) (e[i] === null || cl(e[i])) && s.push(i);
    s.length && vl(e, s, n);
  }
  measureInitialState() {
    const {
      element: e,
      unresolvedKeyframes: n,
      name: s
    } = this;
    if (!e || !e.current) return;
    s === "height" && (this.suspendedScrollY = window.pageYOffset), this.measuredOrigin = lt[s](e.measureViewportBox(), window.getComputedStyle(e.current)), n[0] = this.measuredOrigin;
    const i = n[n.length - 1];
    i !== void 0 && e.getValue(s, i).jump(i, !1);
  }
  measureEndState() {
    const {
      element: e,
      name: n,
      unresolvedKeyframes: s
    } = this;
    if (!e || !e.current) return;
    const i = e.getValue(n);
    i && i.jump(this.measuredOrigin, !1);
    const r = s.length - 1,
      o = s[r];
    s[r] = lt[n](e.measureViewportBox(), window.getComputedStyle(e.current)), o !== null && this.finalKeyframe === void 0 && (this.finalKeyframe = o), this.removedTransforms?.length && this.removedTransforms.forEach(([a, l]) => {
      e.getValue(a).set(l);
    }), this.resolveNoneKeyframes();
  }
}
function Fn(t, e, n) {
  if (t == null) return [];
  if (t instanceof EventTarget) return [t];
  if (typeof t == "string") {
    let s = document;
    e && (s = e.current);
    const i = n?.[t] ?? s.querySelectorAll(t);
    return i ? Array.from(i) : [];
  }
  return Array.from(t).filter(s => s != null);
}
const mo = (t, e) => e && typeof t == "number" ? e.transform(t) : t;
function ae(t) {
  return vi(t) && "offsetHeight" in t && !("ownerSVGElement" in t);
}
const { schedule: Bn } = Ii(queueMicrotask, !1), Y = {
    x: !1,
    y: !1
};
function go() {
  return Y.x || Y.y;
}
function Tl(t) {
  return t === "x" || t === "y" ? Y[t] ? null : (Y[t] = !0, () => {
    Y[t] = !1;
  }) : Y.x || Y.y ? null : (Y.x = Y.y = !0, () => {
    Y.x = Y.y = !1;
  });
}
function yo(t, e) {
  const n = Fn(t),
    s = new AbortController(),
    i = {
      passive: !0,
      ...e,
      signal: s.signal
    };
  return [n, i, () => s.abort()];
}
function Sl(t) {
  return !(t.pointerType === "touch" || go());
}
function wl(t, e, n = {}) {
  const [s, i, r] = yo(t, n);
  return s.forEach(o => {
    let a = !1,
      l = !1,
      c;
    const u = () => {
        o.removeEventListener("pointerleave", p);
      },
      h = m => {
        c && (c(m), c = void 0), u();
      },
      f = m => {
        a = !1, window.removeEventListener("pointerup", f), window.removeEventListener("pointercancel", f), l && (l = !1, h(m));
      },
      d = () => {
        a = !0, window.addEventListener("pointerup", f, i), window.addEventListener("pointercancel", f, i);
      },
      p = m => {
        if (m.pointerType !== "touch") {
          if (a) {
            l = !0;
            return;
          }
          h(m);
        }
      },
      g = m => {
        if (!Sl(m)) return;
        l = !1;
        const y = e(o, m);
        typeof y == "function" && (c = y, o.addEventListener("pointerleave", p, i));
      };
    o.addEventListener("pointerenter", g, i), o.addEventListener("pointerdown", d, i);
  }), r;
}
const vo = (t, e) => e ? t === e ? !0 : vo(t, e.parentElement) : !1, jn = t => t.pointerType === "mouse" ? typeof t.button != "number" || t.button <= 0 : t.isPrimary !== !1, Pl = new Set(["BUTTON", "INPUT", "SELECT", "TEXTAREA", "A"]);
function Al(t) {
  return Pl.has(t.tagName) || t.isContentEditable === !0;
}
const bl = new Set(["INPUT", "SELECT", "TEXTAREA"]);
function Vl(t) {
  return bl.has(t.tagName) || t.isContentEditable === !0;
}
const le = new WeakSet();
function fs(t) {
  return e => {
    e.key === "Enter" && t(e);
  };
}
function Ie(t, e) {
  t.dispatchEvent(new PointerEvent("pointer" + e, {
    isPrimary: !0,
    bubbles: !0
  }));
}
const Cl = (t, e) => {
    const n = t.currentTarget;
    if (!n)
        return;
    const s = fs(() => {
        if (le.has(n))
            return;
        Ie(n, "down");
        const i = fs(() => {
            Ie(n, "up");
        }), r = () => Ie(n, "cancel");
        n.addEventListener("keyup", i, e), n.addEventListener("blur", r, e);
    });
    n.addEventListener("keydown", s, e), n.addEventListener("blur", () => n.removeEventListener("keydown", s), e);
};
function ds(t) {
  return jn(t) && !go();
}
const ps = new WeakSet();
function Ml(t, e, n = {}) {
  const [s, i, r] = yo(t, n),
    o = a => {
      const l = a.currentTarget;
      if (!ds(a) || ps.has(a)) return;
      le.add(l), n.stopPropagation && ps.add(a);
      const c = e(l, a),
        u = (d, p) => {
          window.removeEventListener("pointerup", h), window.removeEventListener("pointercancel", f), le.has(l) && le.delete(l), ds(d) && typeof c == "function" && c(d, {
            success: p
          });
        },
        h = d => {
          u(d, l === window || l === document || n.useGlobalTarget || vo(l, d.target));
        },
        f = d => {
          u(d, !1);
        };
      window.addEventListener("pointerup", h, i), window.addEventListener("pointercancel", f, i);
    };
  return s.forEach(a => {
    (n.useGlobalTarget ? window : a).addEventListener("pointerdown", o, i), ae(a) && (a.addEventListener("focus", c => Cl(c, i)), !Al(a) && !a.hasAttribute("tabindex") && (a.tabIndex = 0));
  }), r;
}
function Ae(t) {
  return vi(t) && "ownerSVGElement" in t;
}
const ue = new WeakMap();
let ce;
const xo = (t, e, n) => (s, i) => i && i[0] ? i[0][t + "Size"] : Ae(s) && "getBBox" in s ? s.getBBox()[e] : s[n], Dl = xo("inline", "width", "offsetWidth"), El = xo("block", "height", "offsetHeight");
function Rl({
  target: t,
  borderBoxSize: e
}) {
  ue.get(t)?.forEach(n => {
    n(t, {
      get width() {
        return Dl(t, e);
      },
      get height() {
        return El(t, e);
      }
    });
  });
}
function Ll(t) {
  t.forEach(Rl);
}
function kl() {
  typeof ResizeObserver > "u" || (ce = new ResizeObserver(Ll));
}
function Il(t, e) {
  ce || kl();
  const n = Fn(t);
  return n.forEach(s => {
    let i = ue.get(s);
    i || (i = new Set(), ue.set(s, i)), i.add(e), ce?.observe(s);
  }), () => {
    n.forEach(s => {
      const i = ue.get(s);
      i?.delete(e), i?.size || ce?.unobserve(s);
    });
  };
}
const he = new Set();
let wt;
function Fl() {
  wt = () => {
    const t = {
      get width() {
        return window.innerWidth;
      },
      get height() {
        return window.innerHeight;
      }
    };
    he.forEach(e => e(t));
  }, window.addEventListener("resize", wt);
}
function Bl(t) {
  return he.add(t), wt || Fl(), () => {
    he.delete(t), !he.size && typeof wt == "function" && (window.removeEventListener("resize", wt), wt = void 0);
  };
}
function ms(t, e) {
  return typeof t == "function" ? Bl(t) : Il(t, e);
}
function To(t) {
  return Ae(t) && t.tagName === "svg";
}
const Nl = [...ho, j, Z], Ul = t => Nl.find(co(t)), ys = () => ({
    translate: 0,
    scale: 1,
    origin: 0,
    originPoint: 0
}), Pt = () => ({
    x: ys(),
    y: ys()
}), vs = () => ({
    min: 0,
    max: 0
}), B = () => ({
    x: vs(),
    y: vs()
}), $t = new WeakMap();
function be(t) {
  return t !== null && typeof t == "object" && typeof t.start == "function";
}
function zt(t) {
  return typeof t == "string" || Array.isArray(t);
}
const On = ["animate", "whileInView", "whileFocus", "whileHover", "whileTap", "whileDrag", "exit"], Nn = ["initial", ...On];
function Ve(t) {
  return be(t.animate) || Nn.some(e => zt(t[e]));
}
function So(t) {
  return !!(Ve(t) || t.variants);
}
function Wl(t, e, n) {
  for (const s in e) {
    const i = e[s],
      r = n[s];
    if (F(i)) t.addValue(s, i);else if (F(r)) t.addValue(s, ht(i, {
      owner: t
    }));else if (r !== i) if (t.hasValue(s)) {
      const o = t.getValue(s);
      o.liveStyle === !0 ? o.jump(i) : o.hasAnimated || o.set(i);
    } else {
      const o = t.getStaticValue(s);
      t.addValue(s, ht(o !== void 0 ? o : i, {
        owner: t
      }));
    }
  }
  for (const s in n) e[s] === void 0 && t.removeValue(s);
  return e;
}
const ye = {
    current: null
}, Un = {
    current: !1
}, Kl = typeof window < "u";
function wo() {
  if (Un.current = !0, !!Kl) if (window.matchMedia) {
    const t = window.matchMedia("(prefers-reduced-motion)"),
      e = () => ye.current = t.matches;
    t.addEventListener("change", e), e();
  } else ye.current = !1;
}
const xs = ["AnimationStart", "AnimationComplete", "Update", "BeforeLayoutMeasure", "LayoutMeasure", "LayoutAnimationStart", "LayoutAnimationComplete"];
let ve = {};
function Po(t) {
  ve = t;
}
function Gl() {
  return ve;
}
class Ao {
  scrapeMotionValuesFromProps(e, n, s) {
    return {};
  }
  constructor({
    parent: e,
    props: n,
    presenceContext: s,
    reducedMotionConfig: i,
    skipAnimations: r,
    blockInitialAnimation: o,
    visualState: a
  }, l = {}) {
    this.current = null, this.children = new Set(), this.isVariantNode = !1, this.isControllingVariants = !1, this.shouldReduceMotion = null, this.shouldSkipAnimations = !1, this.values = new Map(), this.KeyframeResolver = Vn, this.features = {}, this.valueSubscriptions = new Map(), this.prevMotionValues = {}, this.hasBeenMounted = !1, this.events = {}, this.propEventSubscriptions = {}, this.notifyUpdate = () => this.notify("Update", this.latestValues), this.render = () => {
      this.current && (this.triggerBuild(), this.renderInstance(this.current, this.renderState, this.props.style, this.projection));
    }, this.renderScheduledAt = 0, this.scheduleRender = () => {
      const d = U.now();
      this.renderScheduledAt < d && (this.renderScheduledAt = d, D.render(this.render, !1, !0));
    };
    const {
      latestValues: c,
      renderState: u
    } = a;
    this.latestValues = c, this.baseTarget = {
      ...c
    }, this.initialValues = n.initial ? {
      ...c
    } : {}, this.renderState = u, this.parent = e, this.props = n, this.presenceContext = s, this.depth = e ? e.depth + 1 : 0, this.reducedMotionConfig = i, this.skipAnimationsConfig = r, this.options = l, this.blockInitialAnimation = !!o, this.isControllingVariants = Ve(n), this.isVariantNode = So(n), this.isVariantNode && (this.variantChildren = new Set()), this.manuallyAnimateOnMount = !!(e && e.current);
    const {
      willChange: h,
      ...f
    } = this.scrapeMotionValuesFromProps(n, {}, this);
    for (const d in f) {
      const p = f[d];
      c[d] !== void 0 && F(p) && p.set(c[d]);
    }
  }
  mount(e) {
    if (this.hasBeenMounted) for (const n in this.initialValues) this.values.get(n)?.jump(this.initialValues[n]), this.latestValues[n] = this.initialValues[n];
    this.current = e, $t.set(e, this), this.projection && !this.projection.instance && this.projection.mount(e), this.parent && this.isVariantNode && !this.isControllingVariants && (this.removeFromVariantTree = this.parent.addVariantChild(this)), this.values.forEach((n, s) => this.bindToMotionValue(s, n)), this.reducedMotionConfig === "never" ? this.shouldReduceMotion = !1 : this.reducedMotionConfig === "always" ? this.shouldReduceMotion = !0 : (Un.current || wo(), this.shouldReduceMotion = ye.current), this.shouldSkipAnimations = this.skipAnimationsConfig ?? !1, this.parent?.addChild(this), this.update(this.props, this.presenceContext), this.hasBeenMounted = !0;
  }
  unmount() {
    this.projection && this.projection.unmount(), rt(this.notifyUpdate), rt(this.render), this.valueSubscriptions.forEach(e => e()), this.valueSubscriptions.clear(), this.removeFromVariantTree && this.removeFromVariantTree(), this.parent?.removeChild(this);
    for (const e in this.events) this.events[e].clear();
    for (const e in this.features) {
      const n = this.features[e];
      n && (n.unmount(), n.isMounted = !1);
    }
    this.current = null;
  }
  addChild(e) {
    this.children.add(e), this.enteringChildren ?? (this.enteringChildren = new Set()), this.enteringChildren.add(e);
  }
  removeChild(e) {
    this.children.delete(e), this.enteringChildren && this.enteringChildren.delete(e);
  }
  bindToMotionValue(e, n) {
    if (this.valueSubscriptions.has(e) && this.valueSubscriptions.get(e)(), n.accelerate && io.has(e) && this.current instanceof HTMLElement) {
      const {
          factory: o,
          keyframes: a,
          times: l,
          ease: c,
          duration: u
        } = n.accelerate,
        h = new no({
          element: this.current,
          name: e,
          keyframes: a,
          times: l,
          ease: c,
          duration: G(u)
        }),
        f = o(h);
      this.valueSubscriptions.set(e, () => {
        f(), h.cancel();
      });
      return;
    }
    const s = Dt.has(e);
    s && this.onBindTransform && this.onBindTransform();
    const i = n.on("change", o => {
      this.latestValues[e] = o, this.props.onUpdate && D.preRender(this.notifyUpdate), s && this.projection && (this.projection.isTransformDirty = !0), this.scheduleRender();
    });
    let r;
    typeof window < "u" && window.MotionCheckAppearSync && (r = window.MotionCheckAppearSync(this, e, n)), this.valueSubscriptions.set(e, () => {
      i(), r && r(), n.owner && n.stop();
    });
  }
  sortNodePosition(e) {
    return !this.current || !this.sortInstanceNodePosition || this.type !== e.type ? 0 : this.sortInstanceNodePosition(this.current, e.current);
  }
  updateFeatures() {
    let e = "animation";
    for (e in ve) {
      const n = ve[e];
      if (!n) continue;
      const {
        isEnabled: s,
        Feature: i
      } = n;
      if (!this.features[e] && i && s(this.props) && (this.features[e] = new i(this)), this.features[e]) {
        const r = this.features[e];
        r.isMounted ? r.update() : (r.mount(), r.isMounted = !0);
      }
    }
  }
  triggerBuild() {
    this.build(this.renderState, this.latestValues, this.props);
  }
  measureViewportBox() {
    return this.current ? this.measureInstanceViewportBox(this.current, this.props) : B();
  }
  getStaticValue(e) {
    return this.latestValues[e];
  }
  setStaticValue(e, n) {
    this.latestValues[e] = n;
  }
  update(e, n) {
    (e.transformTemplate || this.props.transformTemplate) && this.scheduleRender(), this.prevProps = this.props, this.props = e, this.prevPresenceContext = this.presenceContext, this.presenceContext = n;
    for (let s = 0; s < xs.length; s++) {
      const i = xs[s];
      this.propEventSubscriptions[i] && (this.propEventSubscriptions[i](), delete this.propEventSubscriptions[i]);
      const r = "on" + i,
        o = e[r];
      o && (this.propEventSubscriptions[i] = this.on(i, o));
    }
    this.prevMotionValues = Wl(this, this.scrapeMotionValuesFromProps(e, this.prevProps || {}, this), this.prevMotionValues), this.handleChildMotionValue && this.handleChildMotionValue();
  }
  getProps() {
    return this.props;
  }
  getVariant(e) {
    return this.props.variants ? this.props.variants[e] : void 0;
  }
  getDefaultTransition() {
    return this.props.transition;
  }
  getTransformPagePoint() {
    return this.props.transformPagePoint;
  }
  getClosestVariantNode() {
    return this.isVariantNode ? this : this.parent ? this.parent.getClosestVariantNode() : void 0;
  }
  addVariantChild(e) {
    const n = this.getClosestVariantNode();
    if (n) return n.variantChildren && n.variantChildren.add(e), () => n.variantChildren.delete(e);
  }
  addValue(e, n) {
    const s = this.values.get(e);
    n !== s && (s && this.removeValue(e), this.bindToMotionValue(e, n), this.values.set(e, n), this.latestValues[e] = n.get());
  }
  removeValue(e) {
    this.values.delete(e);
    const n = this.valueSubscriptions.get(e);
    n && (n(), this.valueSubscriptions.delete(e)), delete this.latestValues[e], this.removeValueFromRenderState(e, this.renderState);
  }
  hasValue(e) {
    return this.values.has(e);
  }
  getValue(e, n) {
    if (this.props.values && this.props.values[e]) return this.props.values[e];
    let s = this.values.get(e);
    return s === void 0 && n !== void 0 && (s = ht(n === null ? void 0 : n, {
      owner: this
    }), this.addValue(e, s)), s;
  }
  readValue(e, n) {
    let s = this.latestValues[e] !== void 0 || !this.current ? this.latestValues[e] : this.getBaseTargetFromProps(this.props, e) ?? this.readValueFromInstance(this.current, e, this.options);
    return s != null && (typeof s == "string" && (yi(s) || xi(s)) ? s = parseFloat(s) : !Ul(s) && Z.test(n) && (s = po(e, n)), this.setBaseTarget(e, F(s) ? s.get() : s)), F(s) ? s.get() : s;
  }
  setBaseTarget(e, n) {
    this.baseTarget[e] = n;
  }
  getBaseTarget(e) {
    const {
      initial: n
    } = this.props;
    let s;
    if (typeof n == "string" || typeof n == "object") {
      const r = Rn(this.props, n, this.presenceContext?.custom);
      r && (s = r[e]);
    }
    if (n && s !== void 0) return s;
    const i = this.getBaseTargetFromProps(this.props, e);
    return i !== void 0 && !F(i) ? i : this.initialValues[e] !== void 0 && s === void 0 ? void 0 : this.baseTarget[e];
  }
  on(e, n) {
    return this.events[e] || (this.events[e] = new yn()), this.events[e].add(n);
  }
  notify(e, ...n) {
    this.events[e] && this.events[e].notify(...n);
  }
  scheduleRenderMicrotask() {
    Bn.render(this.render);
  }
}
class bo extends Ao {
  constructor() {
    super(...arguments), this.KeyframeResolver = xl;
  }
  sortInstanceNodePosition(e, n) {
    return e.compareDocumentPosition(n) & 2 ? 1 : -1;
  }
  getBaseTargetFromProps(e, n) {
    const s = e.style;
    return s ? s[n] : void 0;
  }
  removeValueFromRenderState(e, {
    vars: n,
    style: s
  }) {
    delete n[e], delete s[e];
  }
  handleChildMotionValue() {
    this.childSubscription && (this.childSubscription(), delete this.childSubscription);
    const {
      children: e
    } = this.props;
    F(e) && (this.childSubscription = e.on("change", n => {
      this.current && (this.current.textContent = `${n}`);
    }));
  }
}
class ft {
  constructor(e) {
    this.isMounted = !1, this.node = e;
  }
  update() {}
}
function Vo({
  top: t,
  left: e,
  right: n,
  bottom: s
}) {
  return {
    x: {
      min: e,
      max: n
    },
    y: {
      min: t,
      max: s
    }
  };
}
function $l({
  x: t,
  y: e
}) {
  return {
    top: e.min,
    right: t.max,
    bottom: e.max,
    left: t.min
  };
}
function zl(t, e) {
  if (!e) return t;
  const n = e({
      x: t.left,
      y: t.top
    }),
    s = e({
      x: t.right,
      y: t.bottom
    });
  return {
    top: n.y,
    left: n.x,
    bottom: s.y,
    right: s.x
  };
}
function Be(t) {
  return t === void 0 || t === 1;
}
function un({
  scale: t,
  scaleX: e,
  scaleY: n
}) {
  return !Be(t) || !Be(e) || !Be(n);
}
function pt(t) {
  return un(t) || Co(t) || t.z || t.rotate || t.rotateX || t.rotateY || t.skewX || t.skewY;
}
function Co(t) {
  return Ts(t.x) || Ts(t.y);
}
function Ts(t) {
  return t && t !== "0%";
}
function xe(t, e, n) {
  const s = t - n,
    i = e * s;
  return n + i;
}
function Ss(t, e, n, s, i) {
  return i !== void 0 && (t = xe(t, i, s)), xe(t, n, s) + e;
}
function cn(t, e = 0, n = 1, s, i) {
  t.min = Ss(t.min, e, n, s, i), t.max = Ss(t.max, e, n, s, i);
}
function Mo(t, {
  x: e,
  y: n
}) {
  cn(t.x, e.translate, e.scale, e.originPoint), cn(t.y, n.translate, n.scale, n.originPoint);
}
const ws = .999999999999, Ps = 1.0000000000001;
function Hl(t, e, n, s = !1) {
  const i = n.length;
  if (!i) return;
  e.x = e.y = 1;
  let r, o;
  for (let a = 0; a < i; a++) {
    r = n[a], o = r.projectionDelta;
    const {
      visualElement: l
    } = r.options;
    l && l.props.style && l.props.style.display === "contents" || (s && r.options.layoutScroll && r.scroll && r !== r.root && (et(t.x, -r.scroll.offset.x), et(t.y, -r.scroll.offset.y)), o && (e.x *= o.x.scale, e.y *= o.y.scale, Mo(t, o)), s && pt(r.latestValues) && fe(t, r.latestValues, r.layout?.layoutBox));
  }
  e.x < Ps && e.x > ws && (e.x = 1), e.y < Ps && e.y > ws && (e.y = 1);
}
function et(t, e) {
  t.min += e, t.max += e;
}
function As(t, e, n, s, i = .5) {
  const r = L(t.min, t.max, i);
  cn(t, e, n, r, s);
}
function bs(t, e) {
  return typeof t == "string" ? parseFloat(t) / 100 * (e.max - e.min) : t;
}
function fe(t, e, n) {
  const s = n ?? t;
  As(t.x, bs(e.x, s.x), e.scaleX, e.scale, e.originX), As(t.y, bs(e.y, s.y), e.scaleY, e.scale, e.originY);
}
function Do(t, e) {
  return Vo(zl(t.getBoundingClientRect(), e));
}
function _l(t, e, n) {
  const s = Do(t, n),
    {
      scroll: i
    } = e;
  return i && (et(s.x, i.offset.x), et(s.y, i.offset.y)), s;
}
const Xl = {
    x: "translateX",
    y: "translateY",
    z: "translateZ",
    transformPerspective: "perspective"
}, Yl = Mt.length;
function ql(t, e, n) {
  let s = "",
    i = !0;
  for (let r = 0; r < Yl; r++) {
    const o = Mt[r],
      a = t[o];
    if (a === void 0) continue;
    let l = !0;
    if (typeof a == "number") l = a === (o.startsWith("scale") ? 1 : 0);else {
      const c = parseFloat(a);
      l = o.startsWith("scale") ? c === 1 : c === 0;
    }
    if (!l || n) {
      const c = mo(a, In[o]);
      if (!l) {
        i = !1;
        const u = Xl[o] || o;
        s += `${u}(${c}) `;
      }
      n && (e[o] = c);
    }
  }
  return s = s.trim(), n ? s = n(e, i ? "" : s) : i && (s = "none"), s;
}
function Wn(t, e, n) {
  const {
    style: s,
    vars: i,
    transformOrigin: r
  } = t;
  let o = !1,
    a = !1;
  for (const l in e) {
    const c = e[l];
    if (Dt.has(l)) {
      o = !0;
      continue;
    } else if (Bi(l)) {
      i[l] = c;
      continue;
    } else {
      const u = mo(c, In[l]);
      l.startsWith("origin") ? (a = !0, r[l] = u) : s[l] = u;
    }
  }
  if (e.transform || (o || n ? s.transform = ql(e, t.transform, n) : s.transform && (s.transform = "none")), a) {
    const {
      originX: l = "50%",
      originY: c = "50%",
      originZ: u = 0
    } = r;
    s.transformOrigin = `${l} ${c} ${u}`;
  }
}
function Eo(t, {
  style: e,
  vars: n
}, s, i) {
  const r = t.style;
  let o;
  for (o in e) r[o] = e[o];
  i?.applyProjectionStyles(r, s);
  for (o in n) r.setProperty(o, n[o]);
}
function Vs(t, e) {
  return e.max === e.min ? 0 : t / (e.max - e.min) * 100;
}
const kt = {
    correct: (t, e) => {
        if (!e.target)
            return t;
        if (typeof t == "string")
            if (w.test(t))
                t = parseFloat(t);
            else
                return t;
        const n = Vs(t, e.target.x), s = Vs(t, e.target.y);
        return `${n}% ${s}%`;
    }
}, Zl = {
    correct: (t, { treeScale: e, projectionDelta: n }) => {
        const s = t, i = Z.parse(t);
        if (i.length > 5)
            return s;
        const r = Z.createTransformer(t), o = typeof i[0] != "number" ? 1 : 0, a = n.x.scale * e.x, l = n.y.scale * e.y;
        i[0 + o] /= a, i[1 + o] /= l;
        const c = L(a, l, .5);
        return typeof i[2 + o] == "number" && (i[2 + o] /= c), typeof i[3 + o] == "number" && (i[3 + o] /= c), r(i);
    }
}, hn = {
    borderRadius: {
        ...kt,
        applyTo: ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"]
    },
    borderTopLeftRadius: kt,
    borderTopRightRadius: kt,
    borderBottomLeftRadius: kt,
    borderBottomRightRadius: kt,
    boxShadow: Zl
};
function Ro(t, {
  layout: e,
  layoutId: n
}) {
  return Dt.has(t) || t.startsWith("origin") || (e || n !== void 0) && (!!hn[t] || t === "opacity");
}
function Kn(t, e, n) {
  const s = t.style,
    i = e?.style,
    r = {};
  if (!s) return r;
  for (const o in s) (F(s[o]) || i && F(i[o]) || Ro(o, t) || n?.getValue(o)?.liveStyle !== void 0) && (r[o] = s[o]);
  return r;
}
function Jl(t) {
  return window.getComputedStyle(t);
}
class Lo extends bo {
  constructor() {
    super(...arguments), this.type = "html", this.renderInstance = Eo;
  }
  readValueFromInstance(e, n) {
    if (Dt.has(n)) return this.projection?.isProjecting ? Ze(n) : xa(e, n);
    {
      const s = Jl(e),
        i = (Bi(n) ? s.getPropertyValue(n) : s[n]) || 0;
      return typeof i == "string" ? i.trim() : i;
    }
  }
  measureInstanceViewportBox(e, {
    transformPagePoint: n
  }) {
    return Do(e, n);
  }
  build(e, n, s) {
    Wn(e, n, s.transformTemplate);
  }
  scrapeMotionValuesFromProps(e, n, s) {
    return Kn(e, n, s);
  }
}
function Ql(t, e) {
  return t in e;
}
class tu extends Ao {
  constructor() {
    super(...arguments), this.type = "object";
  }
  readValueFromInstance(e, n) {
    if (Ql(n, e)) {
      const s = e[n];
      if (typeof s == "string" || typeof s == "number") return s;
    }
  }
  getBaseTargetFromProps() {}
  removeValueFromRenderState(e, n) {
    delete n.output[e];
  }
  measureInstanceViewportBox() {
    return B();
  }
  build(e, n) {
    Object.assign(e.output, n);
  }
  renderInstance(e, {
    output: n
  }) {
    Object.assign(e, n);
  }
  sortInstanceNodePosition() {
    return 0;
  }
}
const eu = {
    offset: "stroke-dashoffset",
    array: "stroke-dasharray"
}, nu = {
    offset: "strokeDashoffset",
    array: "strokeDasharray"
};
function su(t, e, n = 1, s = 0, i = !0) {
  t.pathLength = 1;
  const r = i ? eu : nu;
  t[r.offset] = `${-s}`, t[r.array] = `${e} ${n}`;
}
const iu = ["offsetDistance", "offsetPath", "offsetRotate", "offsetAnchor"];
function ko(t, {
  attrX: e,
  attrY: n,
  attrScale: s,
  pathLength: i,
  pathSpacing: r = 1,
  pathOffset: o = 0,
  ...a
}, l, c, u) {
  if (Wn(t, a, c), l) {
    t.style.viewBox && (t.attrs.viewBox = t.style.viewBox);
    return;
  }
  t.attrs = t.style, t.style = {};
  const {
    attrs: h,
    style: f
  } = t;
  h.transform && (f.transform = h.transform, delete h.transform), (f.transform || h.transformOrigin) && (f.transformOrigin = h.transformOrigin ?? "50% 50%", delete h.transformOrigin), f.transform && (f.transformBox = u?.transformBox ?? "fill-box", delete h.transformBox);
  for (const d of iu) h[d] !== void 0 && (f[d] = h[d], delete h[d]);
  e !== void 0 && (h.x = e), n !== void 0 && (h.y = n), s !== void 0 && (h.scale = s), i !== void 0 && su(h, i, r, o, !1);
}
const Io = new Set(["baseFrequency", "diffuseConstant", "kernelMatrix", "kernelUnitLength", "keySplines", "keyTimes", "limitingConeAngle", "markerHeight", "markerWidth", "numOctaves", "targetX", "targetY", "surfaceScale", "specularConstant", "specularExponent", "stdDeviation", "tableValues", "viewBox", "gradientTransform", "pathLength", "startOffset", "textLength", "lengthAdjust"]), Fo = t => typeof t == "string" && t.toLowerCase() === "svg";
function ou(t, e, n, s) {
  Eo(t, e, void 0, s);
  for (const i in e.attrs) t.setAttribute(Io.has(i) ? i : Ln(i), e.attrs[i]);
}
function Bo(t, e, n) {
  const s = Kn(t, e, n);
  for (const i in t) if (F(t[i]) || F(e[i])) {
    const r = Mt.indexOf(i) !== -1 ? "attr" + i.charAt(0).toUpperCase() + i.substring(1) : i;
    s[r] = t[i];
  }
  return s;
}
class jo extends bo {
  constructor() {
    super(...arguments), this.type = "svg", this.isSVGTag = !1, this.measureInstanceViewportBox = B;
  }
  getBaseTargetFromProps(e, n) {
    return e[n];
  }
  readValueFromInstance(e, n) {
    if (Dt.has(n)) {
      const s = fo(n);
      return s && s.default || 0;
    }
    return n = Io.has(n) ? n : Ln(n), e.getAttribute(n);
  }
  scrapeMotionValuesFromProps(e, n, s) {
    return Bo(e, n, s);
  }
  build(e, n, s) {
    ko(e, n, this.isSVGTag, s.transformTemplate, s.style);
  }
  renderInstance(e, n, s, i) {
    ou(e, n, s, i);
  }
  mount(e) {
    this.isSVGTag = Fo(e.tagName), super.mount(e);
  }
}
const ru = Nn.length;
function Oo(t) {
  if (!t) return;
  if (!t.isControllingVariants) {
    const n = t.parent ? Oo(t.parent) || {} : {};
    return t.props.initial !== void 0 && (n.initial = t.props.initial), n;
  }
  const e = {};
  for (let n = 0; n < ru; n++) {
    const s = Nn[n],
      i = t.props[s];
    (zt(i) || i === !1) && (e[s] = i);
  }
  return e;
}
function No(t, e) {
  if (!Array.isArray(e)) return !1;
  const n = e.length;
  if (n !== t.length) return !1;
  for (let s = 0; s < n; s++) if (e[s] !== t[s]) return !1;
  return !0;
}
const au = [...On].reverse(), lu = On.length;
function uu(t) {
  return e => Promise.all(e.map(({
    animation: n,
    options: s
  }) => ll(t, n, s)));
}
function cu(t) {
  let e = uu(t),
    n = Cs(),
    s = !0,
    i = !1;
  const r = c => (u, h) => {
    const f = vt(t, h, c === "exit" ? t.presenceContext?.custom : void 0);
    if (f) {
      const {
        transition: d,
        transitionEnd: p,
        ...g
      } = f;
      u = {
        ...u,
        ...g,
        ...p
      };
    }
    return u;
  };
  function o(c) {
    e = c(t);
  }
  function a(c) {
    const {
        props: u
      } = t,
      h = Oo(t.parent) || {},
      f = [],
      d = new Set();
    let p = {},
      g = 1 / 0;
    for (let y = 0; y < lu; y++) {
      const x = au[y],
        T = n[x],
        S = u[x] !== void 0 ? u[x] : h[x],
        A = zt(S),
        M = x === c ? T.isActive : null;
      M === !1 && (g = y);
      let R = S === h[x] && S !== u[x] && A;
      if (R && (s || i) && t.manuallyAnimateOnMount && (R = !1), T.protectedKeys = {
        ...p
      }, !T.isActive && M === null || !S && !T.prevProp || be(S) || typeof S == "boolean") continue;
      if (x === "exit" && T.isActive && M !== !0) {
        T.prevResolvedValues && (p = {
          ...p,
          ...T.prevResolvedValues
        });
        continue;
      }
      const V = hu(T.prevProp, S);
      let b = V || x === c && T.isActive && !R && A || y > g && A,
        P = !1;
      const C = Array.isArray(S) ? S : [S];
      let I = C.reduce(r(x), {});
      M === !1 && (I = {});
      const {
          prevResolvedValues: K = {}
        } = T,
        _ = {
          ...K,
          ...I
        },
        J = E => {
          b = !0, d.has(E) && (P = !0, d.delete(E)), T.needsAnimating[E] = !0;
          const N = t.getValue(E);
          N && (N.liveStyle = !1);
        };
      for (const E in _) {
        const N = I[E],
          Q = K[E];
        if (p.hasOwnProperty(E)) continue;
        let ot = !1;
        sn(N) && sn(Q) ? ot = !No(N, Q) : ot = N !== Q, ot ? N != null ? J(E) : d.add(E) : N !== void 0 && d.has(E) ? J(E) : T.protectedKeys[E] = !0;
      }
      T.prevProp = S, T.prevResolvedValues = I, T.isActive && (p = {
        ...p,
        ...I
      }), (s || i) && t.blockInitialAnimation && (b = !1);
      const $ = R && V;
      b && (!$ || P) && f.push(...C.map(E => {
        const N = {
          type: x
        };
        if (typeof E == "string" && (s || i) && !$ && t.manuallyAnimateOnMount && t.parent) {
          const {
              parent: Q
            } = t,
            ot = vt(Q, E);
          if (Q.enteringChildren && ot) {
            const {
              delayChildren: Jt
            } = ot.transition || {};
            N.delay = oo(Q.enteringChildren, t, Jt);
          }
        }
        return {
          animation: E,
          options: N
        };
      }));
    }
    if (d.size) {
      const y = {};
      if (typeof u.initial != "boolean") {
        const x = vt(t, Array.isArray(u.initial) ? u.initial[0] : u.initial);
        x && x.transition && (y.transition = x.transition);
      }
      d.forEach(x => {
        const T = t.getBaseTarget(x),
          S = t.getValue(x);
        S && (S.liveStyle = !0), y[x] = T ?? null;
      }), f.push({
        animation: y
      });
    }
    let m = !!f.length;
    return s && (u.initial === !1 || u.initial === u.animate) && !t.manuallyAnimateOnMount && (m = !1), s = !1, i = !1, m ? e(f) : Promise.resolve();
  }
  function l(c, u) {
    if (n[c].isActive === u) return Promise.resolve();
    t.variantChildren?.forEach(f => f.animationState?.setActive(c, u)), n[c].isActive = u;
    const h = a(c);
    for (const f in n) n[f].protectedKeys = {};
    return h;
  }
  return {
    animateChanges: a,
    setActive: l,
    setAnimateFunction: o,
    getState: () => n,
    reset: () => {
      n = Cs(), i = !0;
    }
  };
}
function hu(t, e) {
  return typeof e == "string" ? e !== t : Array.isArray(e) ? !No(e, t) : !1;
}
function dt(t = !1) {
  return {
    isActive: t,
    protectedKeys: {},
    needsAnimating: {},
    prevResolvedValues: {}
  };
}
function Cs() {
  return {
    animate: dt(!0),
    whileInView: dt(),
    whileHover: dt(),
    whileTap: dt(),
    whileDrag: dt(),
    whileFocus: dt(),
    exit: dt()
  };
}
function fn(t, e) {
  t.min = e.min, t.max = e.max;
}
function X(t, e) {
  fn(t.x, e.x), fn(t.y, e.y);
}
function Ms(t, e) {
  t.translate = e.translate, t.scale = e.scale, t.originPoint = e.originPoint, t.origin = e.origin;
}
const Uo = 1e-4, fu = 1 - Uo, du = 1 + Uo, Wo = .01, pu = 0 - Wo, mu = 0 + Wo;
function W(t) {
  return t.max - t.min;
}
function gu(t, e, n) {
  return Math.abs(t - e) <= n;
}
function Ds(t, e, n, s = .5) {
  t.origin = s, t.originPoint = L(e.min, e.max, t.origin), t.scale = W(n) / W(e), t.translate = L(n.min, n.max, t.origin) - t.originPoint, (t.scale >= fu && t.scale <= du || isNaN(t.scale)) && (t.scale = 1), (t.translate >= pu && t.translate <= mu || isNaN(t.translate)) && (t.translate = 0);
}
function Ot(t, e, n, s) {
  Ds(t.x, e.x, n.x, s ? s.originX : void 0), Ds(t.y, e.y, n.y, s ? s.originY : void 0);
}
function Es(t, e, n, s = 0) {
  const i = s ? L(n.min, n.max, s) : n.min;
  t.min = i + e.min, t.max = t.min + W(e);
}
function yu(t, e, n, s) {
  Es(t.x, e.x, n.x, s?.x), Es(t.y, e.y, n.y, s?.y);
}
function Rs(t, e, n, s = 0) {
  const i = s ? L(n.min, n.max, s) : n.min;
  t.min = e.min - i, t.max = t.min + W(e);
}
function Te(t, e, n, s) {
  Rs(t.x, e.x, n.x, s?.x), Rs(t.y, e.y, n.y, s?.y);
}
function Ls(t, e, n, s, i) {
  return t -= e, t = xe(t, 1 / n, s), i !== void 0 && (t = xe(t, 1 / i, s)), t;
}
function vu(t, e = 0, n = 1, s = .5, i, r = t, o = t) {
  if (nt.test(e) && (e = parseFloat(e), e = L(o.min, o.max, e / 100) - o.min), typeof e != "number") return;
  let a = L(r.min, r.max, s);
  t === r && (a -= e), t.min = Ls(t.min, e, n, a, i), t.max = Ls(t.max, e, n, a, i);
}
function ks(t, e, [n, s, i], r, o) {
  vu(t, e[n], e[s], e[i], e.scale, r, o);
}
const xu = ["x", "scaleX", "originX"], Tu = ["y", "scaleY", "originY"];
function Is(t, e, n, s) {
  ks(t.x, e, xu, n ? n.x : void 0, s ? s.x : void 0), ks(t.y, e, Tu, n ? n.y : void 0, s ? s.y : void 0);
}
function Fs(t) {
  return t.translate === 0 && t.scale === 1;
}
function Ko(t) {
  return Fs(t.x) && Fs(t.y);
}
function Bs(t, e) {
  return t.min === e.min && t.max === e.max;
}
function Su(t, e) {
  return Bs(t.x, e.x) && Bs(t.y, e.y);
}
function js(t, e) {
  return Math.round(t.min) === Math.round(e.min) && Math.round(t.max) === Math.round(e.max);
}
function Go(t, e) {
  return js(t.x, e.x) && js(t.y, e.y);
}
function Os(t) {
  return W(t.x) / W(t.y);
}
function Ns(t, e) {
  return t.translate === e.translate && t.scale === e.scale && t.originPoint === e.originPoint;
}
function tt(t) {
  return [t("x"), t("y")];
}
function wu(t, e, n) {
  let s = "";
  const i = t.x.translate / e.x,
    r = t.y.translate / e.y,
    o = n?.z || 0;
  if ((i || r || o) && (s = `translate3d(${i}px, ${r}px, ${o}px) `), (e.x !== 1 || e.y !== 1) && (s += `scale(${1 / e.x}, ${1 / e.y}) `), n) {
    const {
      transformPerspective: c,
      rotate: u,
      rotateX: h,
      rotateY: f,
      skewX: d,
      skewY: p
    } = n;
    c && (s = `perspective(${c}px) ${s}`), u && (s += `rotate(${u}deg) `), h && (s += `rotateX(${h}deg) `), f && (s += `rotateY(${f}deg) `), d && (s += `skewX(${d}deg) `), p && (s += `skewY(${p}deg) `);
  }
  const a = t.x.scale * e.x,
    l = t.y.scale * e.y;
  return (a !== 1 || l !== 1) && (s += `scale(${a}, ${l})`), s || "none";
}
const $o = ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"], Pu = $o.length, Us = t => typeof t == "string" ? parseFloat(t) : t, Ws = t => typeof t == "number" || w.test(t);
function Au(t, e, n, s, i, r) {
  i ? (t.opacity = L(0, n.opacity ?? 1, bu(s)), t.opacityExit = L(e.opacity ?? 1, 0, Vu(s))) : r && (t.opacity = L(e.opacity ?? 1, n.opacity ?? 1, s));
  for (let o = 0; o < Pu; o++) {
    const a = $o[o];
    let l = Ks(e, a),
      c = Ks(n, a);
    if (l === void 0 && c === void 0) continue;
    l || (l = 0), c || (c = 0), l === 0 || c === 0 || Ws(l) === Ws(c) ? (t[a] = Math.max(L(Us(l), Us(c), s), 0), (nt.test(c) || nt.test(l)) && (t[a] += "%")) : t[a] = c;
  }
  (e.rotate || n.rotate) && (t.rotate = L(e.rotate || 0, n.rotate || 0, s));
}
function Ks(t, e) {
  return t[e] !== void 0 ? t[e] : t.borderRadius;
}
const bu = zo(0, .5, Mi), Vu = zo(.5, .95, H);
function zo(t, e, n) {
  return s => s < t ? 0 : s > e ? 1 : n(bt(t, e, s));
}
function Ho(t, e, n) {
  const s = F(t) ? t : ht(t);
  return s.start(En("", s, e, n)), s.animation;
}
function Ht(t, e, n, s = {
  passive: !0
}) {
  return t.addEventListener(e, n, s), () => t.removeEventListener(e, n);
}
const Cu = (t, e) => t.depth - e.depth;
class Mu {
  constructor() {
    this.children = [], this.isDirty = !1;
  }
  add(e) {
    mn(this.children, e), this.isDirty = !0;
  }
  remove(e) {
    At(this.children, e), this.isDirty = !0;
  }
  forEach(e) {
    this.isDirty && this.children.sort(Cu), this.isDirty = !1, this.children.forEach(e);
  }
}
function Du(t, e) {
  const n = U.now(),
    s = ({
      timestamp: i
    }) => {
      const r = i - n;
      r >= e && (rt(s), t(r - e));
    };
  return D.setup(s, !0), () => rt(s);
}
function de(t) {
  return F(t) ? t.get() : t;
}
class Eu {
  constructor() {
    this.members = [];
  }
  add(e) {
    mn(this.members, e);
    for (let n = this.members.length - 1; n >= 0; n--) {
      const s = this.members[n];
      if (s === e || s === this.lead || s === this.prevLead) continue;
      const i = s.instance;
      (!i || i.isConnected === !1) && !s.snapshot && (At(this.members, s), s.unmount());
    }
    e.scheduleRender();
  }
  remove(e) {
    if (At(this.members, e), e === this.prevLead && (this.prevLead = void 0), e === this.lead) {
      const n = this.members[this.members.length - 1];
      n && this.promote(n);
    }
  }
  relegate(e) {
    for (let n = this.members.indexOf(e) - 1; n >= 0; n--) {
      const s = this.members[n];
      if (s.isPresent !== !1 && s.instance?.isConnected !== !1) return this.promote(s), !0;
    }
    return !1;
  }
  promote(e, n) {
    const s = this.lead;
    if (e !== s && (this.prevLead = s, this.lead = e, e.show(), s)) {
      s.updateSnapshot(), e.scheduleRender();
      const {
          layoutDependency: i
        } = s.options,
        {
          layoutDependency: r
        } = e.options;
      (i === void 0 || i !== r) && (e.resumeFrom = s, n && (s.preserveOpacity = !0), s.snapshot && (e.snapshot = s.snapshot, e.snapshot.latestValues = s.animationValues || s.latestValues), e.root?.isUpdating && (e.isLayoutDirty = !0)), e.options.crossfade === !1 && s.hide();
    }
  }
  exitAnimationComplete() {
    this.members.forEach(e => {
      e.options.onExitComplete?.(), e.resumingFrom?.options.onExitComplete?.();
    });
  }
  scheduleRender() {
    this.members.forEach(e => e.instance && e.scheduleRender(!1));
  }
  removeLeadSnapshot() {
    this.lead?.snapshot && (this.lead.snapshot = void 0);
  }
}
const pe = {
    hasAnimatedSinceResize: !0,
    hasEverUpdated: !1
}, je = ["", "X", "Y", "Z"], Ru = 1e3;
let Lu = 0;
function Oe(t, e, n, s) {
  const {
    latestValues: i
  } = e;
  i[t] && (n[t] = i[t], e.setStaticValue(t, 0), s && (s[t] = 0));
}
function _o(t) {
  if (t.hasCheckedOptimisedAppear = !0, t.root === t) return;
  const {
    visualElement: e
  } = t.options;
  if (!e) return;
  const n = uo(e);
  if (window.MotionHasOptimisedAnimation(n, "transform")) {
    const {
      layout: i,
      layoutId: r
    } = t.options;
    window.MotionCancelOptimisedAnimation(n, "transform", D, !(i || r));
  }
  const {
    parent: s
  } = t;
  s && !s.hasCheckedOptimisedAppear && _o(s);
}
function Xo({
  attachResizeListener: t,
  defaultParent: e,
  measureScroll: n,
  checkIsScrollRoot: s,
  resetTransform: i
}) {
  return class {
    constructor(o = {}, a = e?.()) {
      this.id = Lu++, this.animationId = 0, this.animationCommitId = 0, this.children = new Set(), this.options = {}, this.isTreeAnimating = !1, this.isAnimationBlocked = !1, this.isLayoutDirty = !1, this.isProjectionDirty = !1, this.isSharedProjectionDirty = !1, this.isTransformDirty = !1, this.updateManuallyBlocked = !1, this.updateBlockedByResize = !1, this.isUpdating = !1, this.isSVG = !1, this.needsReset = !1, this.shouldResetTransform = !1, this.hasCheckedOptimisedAppear = !1, this.treeScale = {
        x: 1,
        y: 1
      }, this.eventHandlers = new Map(), this.hasTreeAnimated = !1, this.layoutVersion = 0, this.updateScheduled = !1, this.scheduleUpdate = () => this.update(), this.projectionUpdateScheduled = !1, this.checkUpdateFailed = () => {
        this.isUpdating && (this.isUpdating = !1, this.clearAllSnapshots());
      }, this.updateProjection = () => {
        this.projectionUpdateScheduled = !1, this.nodes.forEach(Fu), this.nodes.forEach(Wu), this.nodes.forEach(Ku), this.nodes.forEach(Bu);
      }, this.resolvedRelativeTargetAt = 0, this.linkedParentVersion = 0, this.hasProjected = !1, this.isVisible = !0, this.animationProgress = 0, this.sharedNodes = new Map(), this.latestValues = o, this.root = a ? a.root || a : this, this.path = a ? [...a.path, a] : [], this.parent = a, this.depth = a ? a.depth + 1 : 0;
      for (let l = 0; l < this.path.length; l++) this.path[l].shouldResetTransform = !0;
      this.root === this && (this.nodes = new Mu());
    }
    addEventListener(o, a) {
      return this.eventHandlers.has(o) || this.eventHandlers.set(o, new yn()), this.eventHandlers.get(o).add(a);
    }
    notifyListeners(o, ...a) {
      const l = this.eventHandlers.get(o);
      l && l.notify(...a);
    }
    hasListeners(o) {
      return this.eventHandlers.has(o);
    }
    mount(o) {
      if (this.instance) return;
      this.isSVG = Ae(o) && !To(o), this.instance = o;
      const {
        layoutId: a,
        layout: l,
        visualElement: c
      } = this.options;
      if (c && !c.current && c.mount(o), this.root.nodes.add(this), this.parent && this.parent.children.add(this), this.root.hasTreeAnimated && (l || a) && (this.isLayoutDirty = !0), t) {
        let u,
          h = 0;
        const f = () => this.root.updateBlockedByResize = !1;
        D.read(() => {
          h = window.innerWidth;
        }), t(o, () => {
          const d = window.innerWidth;
          d !== h && (h = d, this.root.updateBlockedByResize = !0, u && u(), u = Du(f, 250), pe.hasAnimatedSinceResize && (pe.hasAnimatedSinceResize = !1, this.nodes.forEach(zs)));
        });
      }
      a && this.root.registerSharedNode(a, this), this.options.animate !== !1 && c && (a || l) && this.addEventListener("didUpdate", ({
        delta: u,
        hasLayoutChanged: h,
        hasRelativeLayoutChanged: f,
        layout: d
      }) => {
        if (this.isTreeAnimationBlocked()) {
          this.target = void 0, this.relativeTarget = void 0;
          return;
        }
        const p = this.options.transition || c.getDefaultTransition() || _u,
          {
            onLayoutAnimationStart: g,
            onLayoutAnimationComplete: m
          } = c.getProps(),
          y = !this.targetLayout || !Go(this.targetLayout, d),
          x = !h && f;
        if (this.options.layoutRoot || this.resumeFrom || x || h && (y || !this.currentAnimation)) {
          this.resumeFrom && (this.resumingFrom = this.resumeFrom, this.resumingFrom.resumingFrom = void 0);
          const T = {
            ...Dn(p, "layout"),
            onPlay: g,
            onComplete: m
          };
          (c.shouldReduceMotion || this.options.layoutRoot) && (T.delay = 0, T.type = !1), this.startAnimation(T), this.setAnimationOrigin(u, x);
        } else h || zs(this), this.isLead() && this.options.onExitComplete && this.options.onExitComplete();
        this.targetLayout = d;
      });
    }
    unmount() {
      this.options.layoutId && this.willUpdate(), this.root.nodes.remove(this);
      const o = this.getStack();
      o && o.remove(this), this.parent && this.parent.children.delete(this), this.instance = void 0, this.eventHandlers.clear(), rt(this.updateProjection);
    }
    blockUpdate() {
      this.updateManuallyBlocked = !0;
    }
    unblockUpdate() {
      this.updateManuallyBlocked = !1;
    }
    isUpdateBlocked() {
      return this.updateManuallyBlocked || this.updateBlockedByResize;
    }
    isTreeAnimationBlocked() {
      return this.isAnimationBlocked || this.parent && this.parent.isTreeAnimationBlocked() || !1;
    }
    startUpdate() {
      this.isUpdateBlocked() || (this.isUpdating = !0, this.nodes && this.nodes.forEach(Gu), this.animationId++);
    }
    getTransformTemplate() {
      const {
        visualElement: o
      } = this.options;
      return o && o.getProps().transformTemplate;
    }
    willUpdate(o = !0) {
      if (this.root.hasTreeAnimated = !0, this.root.isUpdateBlocked()) {
        this.options.onExitComplete && this.options.onExitComplete();
        return;
      }
      if (window.MotionCancelOptimisedAnimation && !this.hasCheckedOptimisedAppear && _o(this), !this.root.isUpdating && this.root.startUpdate(), this.isLayoutDirty) return;
      this.isLayoutDirty = !0;
      for (let u = 0; u < this.path.length; u++) {
        const h = this.path[u];
        h.shouldResetTransform = !0, (typeof h.latestValues.x == "string" || typeof h.latestValues.y == "string") && (h.isLayoutDirty = !0), h.updateScroll("snapshot"), h.options.layoutRoot && h.willUpdate(!1);
      }
      const {
        layoutId: a,
        layout: l
      } = this.options;
      if (a === void 0 && !l) return;
      const c = this.getTransformTemplate();
      this.prevTransformTemplateValue = c ? c(this.latestValues, "") : void 0, this.updateSnapshot(), o && this.notifyListeners("willUpdate");
    }
    update() {
      if (this.updateScheduled = !1, this.isUpdateBlocked()) {
        const l = this.updateBlockedByResize;
        this.unblockUpdate(), this.updateBlockedByResize = !1, this.clearAllSnapshots(), l && this.nodes.forEach(Ou), this.nodes.forEach(Gs);
        return;
      }
      if (this.animationId <= this.animationCommitId) {
        this.nodes.forEach($s);
        return;
      }
      this.animationCommitId = this.animationId, this.isUpdating ? (this.isUpdating = !1, this.nodes.forEach(Nu), this.nodes.forEach(Uu), this.nodes.forEach(ku), this.nodes.forEach(Iu)) : this.nodes.forEach($s), this.clearAllSnapshots();
      const a = U.now();
      O.delta = st(0, 1e3 / 60, a - O.timestamp), O.timestamp = a, O.isProcessing = !0, Me.update.process(O), Me.preRender.process(O), Me.render.process(O), O.isProcessing = !1;
    }
    didUpdate() {
      this.updateScheduled || (this.updateScheduled = !0, Bn.read(this.scheduleUpdate));
    }
    clearAllSnapshots() {
      this.nodes.forEach(ju), this.sharedNodes.forEach($u);
    }
    scheduleUpdateProjection() {
      this.projectionUpdateScheduled || (this.projectionUpdateScheduled = !0, D.preRender(this.updateProjection, !1, !0));
    }
    scheduleCheckAfterUnmount() {
      D.postRender(() => {
        this.isLayoutDirty ? this.root.didUpdate() : this.root.checkUpdateFailed();
      });
    }
    updateSnapshot() {
      this.snapshot || !this.instance || (this.snapshot = this.measure(), this.snapshot && !W(this.snapshot.measuredBox.x) && !W(this.snapshot.measuredBox.y) && (this.snapshot = void 0));
    }
    updateLayout() {
      if (!this.instance || (this.updateScroll(), !(this.options.alwaysMeasureLayout && this.isLead()) && !this.isLayoutDirty)) return;
      if (this.resumeFrom && !this.resumeFrom.instance) for (let l = 0; l < this.path.length; l++) this.path[l].updateScroll();
      const o = this.layout;
      this.layout = this.measure(!1), this.layoutVersion++, this.layoutCorrected || (this.layoutCorrected = B()), this.isLayoutDirty = !1, this.projectionDelta = void 0, this.notifyListeners("measure", this.layout.layoutBox);
      const {
        visualElement: a
      } = this.options;
      a && a.notify("LayoutMeasure", this.layout.layoutBox, o ? o.layoutBox : void 0);
    }
    updateScroll(o = "measure") {
      let a = !!(this.options.layoutScroll && this.instance);
      if (this.scroll && this.scroll.animationId === this.root.animationId && this.scroll.phase === o && (a = !1), a && this.instance) {
        const l = s(this.instance);
        this.scroll = {
          animationId: this.root.animationId,
          phase: o,
          isRoot: l,
          offset: n(this.instance),
          wasRoot: this.scroll ? this.scroll.isRoot : l
        };
      }
    }
    resetTransform() {
      if (!i) return;
      const o = this.isLayoutDirty || this.shouldResetTransform || this.options.alwaysMeasureLayout,
        a = this.projectionDelta && !Ko(this.projectionDelta),
        l = this.getTransformTemplate(),
        c = l ? l(this.latestValues, "") : void 0,
        u = c !== this.prevTransformTemplateValue;
      o && this.instance && (a || pt(this.latestValues) || u) && (i(this.instance, c), this.shouldResetTransform = !1, this.scheduleRender());
    }
    measure(o = !0) {
      const a = this.measurePageBox();
      let l = this.removeElementScroll(a);
      return o && (l = this.removeTransform(l)), Xu(l), {
        animationId: this.root.animationId,
        measuredBox: a,
        layoutBox: l,
        latestValues: {},
        source: this.id
      };
    }
    measurePageBox() {
      const {
        visualElement: o
      } = this.options;
      if (!o) return B();
      const a = o.measureViewportBox();
      if (!(this.scroll?.wasRoot || this.path.some(Yu))) {
        const {
          scroll: c
        } = this.root;
        c && (et(a.x, c.offset.x), et(a.y, c.offset.y));
      }
      return a;
    }
    removeElementScroll(o) {
      const a = B();
      if (X(a, o), this.scroll?.wasRoot) return a;
      for (let l = 0; l < this.path.length; l++) {
        const c = this.path[l],
          {
            scroll: u,
            options: h
          } = c;
        c !== this.root && u && h.layoutScroll && (u.wasRoot && X(a, o), et(a.x, u.offset.x), et(a.y, u.offset.y));
      }
      return a;
    }
    applyTransform(o, a = !1, l) {
      const c = l || B();
      X(c, o);
      for (let u = 0; u < this.path.length; u++) {
        const h = this.path[u];
        !a && h.options.layoutScroll && h.scroll && h !== h.root && (et(c.x, -h.scroll.offset.x), et(c.y, -h.scroll.offset.y)), pt(h.latestValues) && fe(c, h.latestValues, h.layout?.layoutBox);
      }
      return pt(this.latestValues) && fe(c, this.latestValues, this.layout?.layoutBox), c;
    }
    removeTransform(o) {
      const a = B();
      X(a, o);
      for (let l = 0; l < this.path.length; l++) {
        const c = this.path[l];
        if (!pt(c.latestValues)) continue;
        let u;
        c.instance && (un(c.latestValues) && c.updateSnapshot(), u = B(), X(u, c.measurePageBox())), Is(a, c.latestValues, c.snapshot?.layoutBox, u);
      }
      return pt(this.latestValues) && Is(a, this.latestValues), a;
    }
    setTargetDelta(o) {
      this.targetDelta = o, this.root.scheduleUpdateProjection(), this.isProjectionDirty = !0;
    }
    setOptions(o) {
      this.options = {
        ...this.options,
        ...o,
        crossfade: o.crossfade !== void 0 ? o.crossfade : !0
      };
    }
    clearMeasurements() {
      this.scroll = void 0, this.layout = void 0, this.snapshot = void 0, this.prevTransformTemplateValue = void 0, this.targetDelta = void 0, this.target = void 0, this.isLayoutDirty = !1;
    }
    forceRelativeParentToResolveTarget() {
      this.relativeParent && this.relativeParent.resolvedRelativeTargetAt !== O.timestamp && this.relativeParent.resolveTargetDelta(!0);
    }
    resolveTargetDelta(o = !1) {
      const a = this.getLead();
      this.isProjectionDirty || (this.isProjectionDirty = a.isProjectionDirty), this.isTransformDirty || (this.isTransformDirty = a.isTransformDirty), this.isSharedProjectionDirty || (this.isSharedProjectionDirty = a.isSharedProjectionDirty);
      const l = !!this.resumingFrom || this !== a;
      if (!(o || l && this.isSharedProjectionDirty || this.isProjectionDirty || this.parent?.isProjectionDirty || this.attemptToResolveRelativeTarget || this.root.updateBlockedByResize)) return;
      const {
        layout: u,
        layoutId: h
      } = this.options;
      if (!this.layout || !(u || h)) return;
      this.resolvedRelativeTargetAt = O.timestamp;
      const f = this.getClosestProjectingParent();
      f && this.linkedParentVersion !== f.layoutVersion && !f.options.layoutRoot && this.removeRelativeTarget(), !this.targetDelta && !this.relativeTarget && (this.options.layoutAnchor !== !1 && f && f.layout ? this.createRelativeTarget(f, this.layout.layoutBox, f.layout.layoutBox) : this.removeRelativeTarget()), !(!this.relativeTarget && !this.targetDelta) && (this.target || (this.target = B(), this.targetWithTransforms = B()), this.relativeTarget && this.relativeTargetOrigin && this.relativeParent && this.relativeParent.target ? (this.forceRelativeParentToResolveTarget(), yu(this.target, this.relativeTarget, this.relativeParent.target, this.options.layoutAnchor || void 0)) : this.targetDelta ? (this.resumingFrom ? this.applyTransform(this.layout.layoutBox, !1, this.target) : X(this.target, this.layout.layoutBox), Mo(this.target, this.targetDelta)) : X(this.target, this.layout.layoutBox), this.attemptToResolveRelativeTarget && (this.attemptToResolveRelativeTarget = !1, this.options.layoutAnchor !== !1 && f && !!f.resumingFrom == !!this.resumingFrom && !f.options.layoutScroll && f.target && this.animationProgress !== 1 ? this.createRelativeTarget(f, this.target, f.target) : this.relativeParent = this.relativeTarget = void 0));
    }
    getClosestProjectingParent() {
      if (!(!this.parent || un(this.parent.latestValues) || Co(this.parent.latestValues))) return this.parent.isProjecting() ? this.parent : this.parent.getClosestProjectingParent();
    }
    isProjecting() {
      return !!((this.relativeTarget || this.targetDelta || this.options.layoutRoot) && this.layout);
    }
    createRelativeTarget(o, a, l) {
      this.relativeParent = o, this.linkedParentVersion = o.layoutVersion, this.forceRelativeParentToResolveTarget(), this.relativeTarget = B(), this.relativeTargetOrigin = B(), Te(this.relativeTargetOrigin, a, l, this.options.layoutAnchor || void 0), X(this.relativeTarget, this.relativeTargetOrigin);
    }
    removeRelativeTarget() {
      this.relativeParent = this.relativeTarget = void 0;
    }
    calcProjection() {
      const o = this.getLead(),
        a = !!this.resumingFrom || this !== o;
      let l = !0;
      if ((this.isProjectionDirty || this.parent?.isProjectionDirty) && (l = !1), a && (this.isSharedProjectionDirty || this.isTransformDirty) && (l = !1), this.resolvedRelativeTargetAt === O.timestamp && (l = !1), l) return;
      const {
        layout: c,
        layoutId: u
      } = this.options;
      if (this.isTreeAnimating = !!(this.parent && this.parent.isTreeAnimating || this.currentAnimation || this.pendingAnimation), this.isTreeAnimating || (this.targetDelta = this.relativeTarget = void 0), !this.layout || !(c || u)) return;
      X(this.layoutCorrected, this.layout.layoutBox);
      const h = this.treeScale.x,
        f = this.treeScale.y;
      Hl(this.layoutCorrected, this.treeScale, this.path, a), o.layout && !o.target && (this.treeScale.x !== 1 || this.treeScale.y !== 1) && (o.target = o.layout.layoutBox, o.targetWithTransforms = B());
      const {
        target: d
      } = o;
      if (!d) {
        this.prevProjectionDelta && (this.createProjectionDeltas(), this.scheduleRender());
        return;
      }
      !this.projectionDelta || !this.prevProjectionDelta ? this.createProjectionDeltas() : (Ms(this.prevProjectionDelta.x, this.projectionDelta.x), Ms(this.prevProjectionDelta.y, this.projectionDelta.y)), Ot(this.projectionDelta, this.layoutCorrected, d, this.latestValues), (this.treeScale.x !== h || this.treeScale.y !== f || !Ns(this.projectionDelta.x, this.prevProjectionDelta.x) || !Ns(this.projectionDelta.y, this.prevProjectionDelta.y)) && (this.hasProjected = !0, this.scheduleRender(), this.notifyListeners("projectionUpdate", d));
    }
    hide() {
      this.isVisible = !1;
    }
    show() {
      this.isVisible = !0;
    }
    scheduleRender(o = !0) {
      if (this.options.visualElement?.scheduleRender(), o) {
        const a = this.getStack();
        a && a.scheduleRender();
      }
      this.resumingFrom && !this.resumingFrom.instance && (this.resumingFrom = void 0);
    }
    createProjectionDeltas() {
      this.prevProjectionDelta = Pt(), this.projectionDelta = Pt(), this.projectionDeltaWithTransform = Pt();
    }
    setAnimationOrigin(o, a = !1) {
      const l = this.snapshot,
        c = l ? l.latestValues : {},
        u = {
          ...this.latestValues
        },
        h = Pt();
      (!this.relativeParent || !this.relativeParent.options.layoutRoot) && (this.relativeTarget = this.relativeTargetOrigin = void 0), this.attemptToResolveRelativeTarget = !a;
      const f = B(),
        d = l ? l.source : void 0,
        p = this.layout ? this.layout.source : void 0,
        g = d !== p,
        m = this.getStack(),
        y = !m || m.members.length <= 1,
        x = !!(g && !y && this.options.crossfade === !0 && !this.path.some(Hu));
      this.animationProgress = 0;
      let T;
      this.mixTargetDelta = S => {
        const A = S / 1e3;
        Hs(h.x, o.x, A), Hs(h.y, o.y, A), this.setTargetDelta(h), this.relativeTarget && this.relativeTargetOrigin && this.layout && this.relativeParent && this.relativeParent.layout && (Te(f, this.layout.layoutBox, this.relativeParent.layout.layoutBox, this.options.layoutAnchor || void 0), zu(this.relativeTarget, this.relativeTargetOrigin, f, A), T && Su(this.relativeTarget, T) && (this.isProjectionDirty = !1), T || (T = B()), X(T, this.relativeTarget)), g && (this.animationValues = u, Au(u, c, this.latestValues, A, x, y)), this.root.scheduleUpdateProjection(), this.scheduleRender(), this.animationProgress = A;
      }, this.mixTargetDelta(this.options.layoutRoot ? 1e3 : 0);
    }
    startAnimation(o) {
      this.notifyListeners("animationStart"), this.currentAnimation?.stop(), this.resumingFrom?.currentAnimation?.stop(), this.pendingAnimation && (rt(this.pendingAnimation), this.pendingAnimation = void 0), this.pendingAnimation = D.update(() => {
        pe.hasAnimatedSinceResize = !0, this.motionValue || (this.motionValue = ht(0)), this.motionValue.jump(0, !1), this.currentAnimation = Ho(this.motionValue, [0, 1e3], {
          ...o,
          velocity: 0,
          isSync: !0,
          onUpdate: a => {
            this.mixTargetDelta(a), o.onUpdate && o.onUpdate(a);
          },
          onStop: () => {},
          onComplete: () => {
            o.onComplete && o.onComplete(), this.completeAnimation();
          }
        }), this.resumingFrom && (this.resumingFrom.currentAnimation = this.currentAnimation), this.pendingAnimation = void 0;
      });
    }
    completeAnimation() {
      this.resumingFrom && (this.resumingFrom.currentAnimation = void 0, this.resumingFrom.preserveOpacity = void 0);
      const o = this.getStack();
      o && o.exitAnimationComplete(), this.resumingFrom = this.currentAnimation = this.animationValues = void 0, this.notifyListeners("animationComplete");
    }
    finishAnimation() {
      this.currentAnimation && (this.mixTargetDelta && this.mixTargetDelta(Ru), this.currentAnimation.stop()), this.completeAnimation();
    }
    applyTransformsToTarget() {
      const o = this.getLead();
      let {
        targetWithTransforms: a,
        target: l,
        layout: c,
        latestValues: u
      } = o;
      if (!(!a || !l || !c)) {
        if (this !== o && this.layout && c && Yo(this.options.animationType, this.layout.layoutBox, c.layoutBox)) {
          l = this.target || B();
          const h = W(this.layout.layoutBox.x);
          l.x.min = o.target.x.min, l.x.max = l.x.min + h;
          const f = W(this.layout.layoutBox.y);
          l.y.min = o.target.y.min, l.y.max = l.y.min + f;
        }
        X(a, l), fe(a, u), Ot(this.projectionDeltaWithTransform, this.layoutCorrected, a, u);
      }
    }
    registerSharedNode(o, a) {
      this.sharedNodes.has(o) || this.sharedNodes.set(o, new Eu()), this.sharedNodes.get(o).add(a);
      const c = a.options.initialPromotionConfig;
      a.promote({
        transition: c ? c.transition : void 0,
        preserveFollowOpacity: c && c.shouldPreserveFollowOpacity ? c.shouldPreserveFollowOpacity(a) : void 0
      });
    }
    isLead() {
      const o = this.getStack();
      return o ? o.lead === this : !0;
    }
    getLead() {
      const {
        layoutId: o
      } = this.options;
      return o ? this.getStack()?.lead || this : this;
    }
    getPrevLead() {
      const {
        layoutId: o
      } = this.options;
      return o ? this.getStack()?.prevLead : void 0;
    }
    getStack() {
      const {
        layoutId: o
      } = this.options;
      if (o) return this.root.sharedNodes.get(o);
    }
    promote({
      needsReset: o,
      transition: a,
      preserveFollowOpacity: l
    } = {}) {
      const c = this.getStack();
      c && c.promote(this, l), o && (this.projectionDelta = void 0, this.needsReset = !0), a && this.setOptions({
        transition: a
      });
    }
    relegate() {
      const o = this.getStack();
      return o ? o.relegate(this) : !1;
    }
    resetSkewAndRotation() {
      const {
        visualElement: o
      } = this.options;
      if (!o) return;
      let a = !1;
      const {
        latestValues: l
      } = o;
      if ((l.z || l.rotate || l.rotateX || l.rotateY || l.rotateZ || l.skewX || l.skewY) && (a = !0), !a) return;
      const c = {};
      l.z && Oe("z", o, c, this.animationValues);
      for (let u = 0; u < je.length; u++) Oe(`rotate${je[u]}`, o, c, this.animationValues), Oe(`skew${je[u]}`, o, c, this.animationValues);
      o.render();
      for (const u in c) o.setStaticValue(u, c[u]), this.animationValues && (this.animationValues[u] = c[u]);
      o.scheduleRender();
    }
    applyProjectionStyles(o, a) {
      if (!this.instance || this.isSVG) return;
      if (!this.isVisible) {
        o.visibility = "hidden";
        return;
      }
      const l = this.getTransformTemplate();
      if (this.needsReset) {
        this.needsReset = !1, o.visibility = "", o.opacity = "", o.pointerEvents = de(a?.pointerEvents) || "", o.transform = l ? l(this.latestValues, "") : "none";
        return;
      }
      const c = this.getLead();
      if (!this.projectionDelta || !this.layout || !c.target) {
        this.options.layoutId && (o.opacity = this.latestValues.opacity !== void 0 ? this.latestValues.opacity : 1, o.pointerEvents = de(a?.pointerEvents) || ""), this.hasProjected && !pt(this.latestValues) && (o.transform = l ? l({}, "") : "none", this.hasProjected = !1);
        return;
      }
      o.visibility = "";
      const u = c.animationValues || c.latestValues;
      this.applyTransformsToTarget();
      let h = wu(this.projectionDeltaWithTransform, this.treeScale, u);
      l && (h = l(u, h)), o.transform = h;
      const {
        x: f,
        y: d
      } = this.projectionDelta;
      o.transformOrigin = `${f.origin * 100}% ${d.origin * 100}% 0`, c.animationValues ? o.opacity = c === this ? u.opacity ?? this.latestValues.opacity ?? 1 : this.preserveOpacity ? this.latestValues.opacity : u.opacityExit : o.opacity = c === this ? u.opacity !== void 0 ? u.opacity : "" : u.opacityExit !== void 0 ? u.opacityExit : 0;
      for (const p in hn) {
        if (u[p] === void 0) continue;
        const {
            correct: g,
            applyTo: m,
            isCSSVariable: y
          } = hn[p],
          x = h === "none" ? u[p] : g(u[p], c);
        if (m) {
          const T = m.length;
          for (let S = 0; S < T; S++) o[m[S]] = x;
        } else y ? this.options.visualElement.renderState.vars[p] = x : o[p] = x;
      }
      this.options.layoutId && (o.pointerEvents = c === this ? de(a?.pointerEvents) || "" : "none");
    }
    clearSnapshot() {
      this.resumeFrom = this.snapshot = void 0;
    }
    resetTree() {
      this.root.nodes.forEach(o => o.currentAnimation?.stop()), this.root.nodes.forEach(Gs), this.root.sharedNodes.clear();
    }
  };
}
function ku(t) {
  t.updateLayout();
}
function Iu(t) {
  const e = t.resumeFrom?.snapshot || t.snapshot;
  if (t.isLead() && t.layout && e && t.hasListeners("didUpdate")) {
    const {
        layoutBox: n,
        measuredBox: s
      } = t.layout,
      {
        animationType: i
      } = t.options,
      r = e.source !== t.layout.source;
    if (i === "size") tt(u => {
      const h = r ? e.measuredBox[u] : e.layoutBox[u],
        f = W(h);
      h.min = n[u].min, h.max = h.min + f;
    });else if (i === "x" || i === "y") {
      const u = i === "x" ? "y" : "x";
      fn(r ? e.measuredBox[u] : e.layoutBox[u], n[u]);
    } else Yo(i, e.layoutBox, n) && tt(u => {
      const h = r ? e.measuredBox[u] : e.layoutBox[u],
        f = W(n[u]);
      h.max = h.min + f, t.relativeTarget && !t.currentAnimation && (t.isProjectionDirty = !0, t.relativeTarget[u].max = t.relativeTarget[u].min + f);
    });
    const o = Pt();
    Ot(o, n, e.layoutBox);
    const a = Pt();
    r ? Ot(a, t.applyTransform(s, !0), e.measuredBox) : Ot(a, n, e.layoutBox);
    const l = !Ko(o);
    let c = !1;
    if (!t.resumeFrom) {
      const u = t.getClosestProjectingParent();
      if (u && !u.resumeFrom) {
        const {
          snapshot: h,
          layout: f
        } = u;
        if (h && f) {
          const d = t.options.layoutAnchor || void 0,
            p = B();
          Te(p, e.layoutBox, h.layoutBox, d);
          const g = B();
          Te(g, n, f.layoutBox, d), Go(p, g) || (c = !0), u.options.layoutRoot && (t.relativeTarget = g, t.relativeTargetOrigin = p, t.relativeParent = u);
        }
      }
    }
    t.notifyListeners("didUpdate", {
      layout: n,
      snapshot: e,
      delta: a,
      layoutDelta: o,
      hasLayoutChanged: l,
      hasRelativeLayoutChanged: c
    });
  } else if (t.isLead()) {
    const {
      onExitComplete: n
    } = t.options;
    n && n();
  }
  t.options.transition = void 0;
}
function Fu(t) {
  t.parent && (t.isProjecting() || (t.isProjectionDirty = t.parent.isProjectionDirty), t.isSharedProjectionDirty || (t.isSharedProjectionDirty = !!(t.isProjectionDirty || t.parent.isProjectionDirty || t.parent.isSharedProjectionDirty)), t.isTransformDirty || (t.isTransformDirty = t.parent.isTransformDirty));
}
function Bu(t) {
  t.isProjectionDirty = t.isSharedProjectionDirty = t.isTransformDirty = !1;
}
function ju(t) {
  t.clearSnapshot();
}
function Gs(t) {
  t.clearMeasurements();
}
function Ou(t) {
  t.isLayoutDirty = !0, t.updateLayout();
}
function $s(t) {
  t.isLayoutDirty = !1;
}
function Nu(t) {
  t.isAnimationBlocked && t.layout && !t.isLayoutDirty && (t.snapshot = t.layout, t.isLayoutDirty = !0);
}
function Uu(t) {
  const {
    visualElement: e
  } = t.options;
  e && e.getProps().onBeforeLayoutMeasure && e.notify("BeforeLayoutMeasure"), t.resetTransform();
}
function zs(t) {
  t.finishAnimation(), t.targetDelta = t.relativeTarget = t.target = void 0, t.isProjectionDirty = !0;
}
function Wu(t) {
  t.resolveTargetDelta();
}
function Ku(t) {
  t.calcProjection();
}
function Gu(t) {
  t.resetSkewAndRotation();
}
function $u(t) {
  t.removeLeadSnapshot();
}
function Hs(t, e, n) {
  t.translate = L(e.translate, 0, n), t.scale = L(e.scale, 1, n), t.origin = e.origin, t.originPoint = e.originPoint;
}
function _s(t, e, n, s) {
  t.min = L(e.min, n.min, s), t.max = L(e.max, n.max, s);
}
function zu(t, e, n, s) {
  _s(t.x, e.x, n.x, s), _s(t.y, e.y, n.y, s);
}
function Hu(t) {
  return t.animationValues && t.animationValues.opacityExit !== void 0;
}
const _u = {
    duration: .45,
    ease: [.4, 0, .1, 1]
}, Xs = t => typeof navigator < "u" && navigator.userAgent && navigator.userAgent.toLowerCase().includes(t), Ys = Xs("applewebkit/") && !Xs("chrome/") ? Math.round : H;
function qs(t) {
  t.min = Ys(t.min), t.max = Ys(t.max);
}
function Xu(t) {
  qs(t.x), qs(t.y);
}
function Yo(t, e, n) {
  return t === "position" || t === "preserve-aspect" && !gu(Os(e), Os(n), .2);
}
function Yu(t) {
  return t !== t.root && t.scroll?.wasRoot;
}
const qu = Xo({
    attachResizeListener: (t, e) => Ht(t, "resize", e),
    measureScroll: () => ({
        x: document.documentElement.scrollLeft || document.body?.scrollLeft || 0,
        y: document.documentElement.scrollTop || document.body?.scrollTop || 0
    }),
    checkIsScrollRoot: () => !0
});
const Ne = {
    current: void 0
}, qo = Xo({
    measureScroll: t => ({
        x: t.scrollLeft,
        y: t.scrollTop
    }),
    defaultParent: () => {
        if (!Ne.current) {
            const t = new qu({});
            t.mount(window), t.setOptions({
                layoutScroll: !0
            }), Ne.current = t;
        }
        return Ne.current;
    },
    resetTransform: (t, e) => {
        t.style.transform = e !== void 0 ? e : "none";
    },
    checkIsScrollRoot: t => window.getComputedStyle(t).position === "fixed"
}), xt = v.createContext({
    transformPagePoint: t => t,
    isStatic: !1,
    reducedMotion: "never"
});
function Js(t, e) {
  if (typeof t == "function") return t(e);
  t != null && (t.current = e);
}
function Ju(...t) {
  return e => {
    let n = !1;
    const s = t.map(i => {
      const r = Js(i, e);
      return !n && typeof r == "function" && (n = !0), r;
    });
    if (n) return () => {
      for (let i = 0; i < s.length; i++) {
        const r = s[i];
        typeof r == "function" ? r() : Js(t[i], null);
      }
    };
  };
}
function Qu(...t) {
  return v.useCallback(Ju(...t), t);
}
class tc extends v.Component {
  getSnapshotBeforeUpdate(e) {
    const n = this.props.childRef.current;
    if (ae(n) && e.isPresent && !this.props.isPresent && this.props.pop !== !1) {
      const s = n.offsetParent,
        i = ae(s) && s.offsetWidth || 0,
        r = ae(s) && s.offsetHeight || 0,
        o = getComputedStyle(n),
        a = this.props.sizeRef.current;
      a.height = parseFloat(o.height), a.width = parseFloat(o.width), a.top = n.offsetTop, a.left = n.offsetLeft, a.right = i - a.width - a.left, a.bottom = r - a.height - a.top;
    }
    return null;
  }
  componentDidUpdate() {}
  render() {
    return this.props.children;
  }
}
function ec({
  children: t,
  isPresent: e,
  anchorX: n,
  anchorY: s,
  root: i,
  pop: r
}) {
  const o = v.useId(),
    a = v.useRef(null),
    l = v.useRef({
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0
    }),
    {
      nonce: c
    } = v.useContext(xt),
    u = t.props?.ref ?? t?.ref,
    h = Qu(a, u);
  return v.useInsertionEffect(() => {
    const {
      width: f,
      height: d,
      top: p,
      left: g,
      right: m,
      bottom: y
    } = l.current;
    if (e || r === !1 || !a.current || !f || !d) return;
    const x = n === "left" ? `left: ${g}` : `right: ${m}`,
      T = s === "bottom" ? `bottom: ${y}` : `top: ${p}`;
    a.current.dataset.motionPopId = o;
    const S = document.createElement("style");
    c && (S.nonce = c);
    const A = i ?? document.head;
    return A.appendChild(S), S.sheet && S.sheet.insertRule(`
          [data-motion-pop-id="${o}"] {
            position: absolute !important;
            width: ${f}px !important;
            height: ${d}px !important;
            ${x}px !important;
            ${T}px !important;
          }
        `), () => {
      a.current?.removeAttribute("data-motion-pop-id"), A.contains(S) && A.removeChild(S);
    };
  }, [e]), q.jsx(tc, {
    isPresent: e,
    childRef: a,
    sizeRef: l,
    pop: r,
    children: r === !1 ? t : v.cloneElement(t, {
      ref: h
    })
  });
}
const nc = ({ children: t, initial: e, isPresent: n, onExitComplete: s, custom: i, presenceAffectsLayout: r, mode: o, anchorX: a, anchorY: l, root: c }) => {
    const u = ut(sc), h = v.useId();
    let f = !0, d = v.useMemo(() => (f = !1, {
        id: h,
        initial: e,
        isPresent: n,
        custom: i,
        onExitComplete: p => {
            u.set(p, !0);
            for (const g of u.values())
                if (!g)
                    return;
            s && s();
        },
        register: p => (u.set(p, !1), () => u.delete(p))
    }), [n, u, s]);
    return r && f && (d = {
        ...d
    }), v.useMemo(() => {
        u.forEach((p, g) => u.set(g, !1));
    }, [n]), v.useEffect(() => {
        !n && !u.size && s && s();
    }, [n]), t = q.jsx(ec, {
        pop: o === "popLayout",
        isPresent: n,
        anchorX: a,
        anchorY: l,
        root: c,
        children: t
    }), q.jsx(_t.Provider, {
        value: d,
        children: t
    });
};
function sc() {
  return new Map();
}
function Zo(t = !0) {
  const e = v.useContext(_t);
  if (e === null) return [!0, null];
  const {
      isPresent: n,
      onExitComplete: s,
      register: i
    } = e,
    r = v.useId();
  v.useEffect(() => {
    if (t) return i(r);
  }, [t]);
  const o = v.useCallback(() => t && s && s(r), [r, s, t]);
  return !n && s ? [!1, o] : [!0];
}
const se = t => t.key || "";
function Qs(t) {
  const e = [];
  return v.Children.forEach(t, n => {
    v.isValidElement(n) && e.push(n);
  }), e;
}
const Oh = ({ children: t, custom: e, initial: n = !0, onExitComplete: s, presenceAffectsLayout: i = !0, mode: r = "sync", propagate: o = !1, anchorX: a = "left", anchorY: l = "top", root: c }) => {
    const [u, h] = Zo(o), f = v.useMemo(() => Qs(t), [t]), d = o && !u ? [] : f.map(se), p = v.useRef(!0), g = v.useRef(f), m = ut(() => new Map()), y = v.useRef(new Set()), [x, T] = v.useState(f), [S, A] = v.useState(f);
    we(() => {
        p.current = !1, g.current = f;
        for (let V = 0; V < S.length; V++) {
            const b = se(S[V]);
            d.includes(b) ? (m.delete(b), y.current.delete(b)) : m.get(b) !== !0 && m.set(b, !1);
        }
    }, [S, d.length, d.join("-")]);
    const M = [];
    if (f !== x) {
        let V = [...f];
        for (let b = 0; b < S.length; b++) {
            const P = S[b], C = se(P);
            d.includes(C) || (V.splice(b, 0, P), M.push(P));
        }
        return r === "wait" && M.length && (V = M), A(Qs(V)), T(f), null;
    }
    const { forceRender: R } = v.useContext(Ut);
    return q.jsx(q.Fragment, {
        children: S.map(V => {
            const b = se(V), P = o && !u ? !1 : f === S || d.includes(b), C = () => {
                if (y.current.has(b))
                    return;
                if (m.has(b))
                    y.current.add(b), m.set(b, !0);
                else
                    return;
                let I = !0;
                m.forEach(K => {
                    K || (I = !1);
                }), I && (R?.(), A(g.current), o && h?.(), s && s());
            };
            return q.jsx(nc, {
                isPresent: P,
                initial: !p.current || n ? void 0 : !1,
                custom: e,
                presenceAffectsLayout: i,
                mode: r,
                root: c,
                onExitComplete: P ? void 0 : C,
                anchorX: a,
                anchorY: l,
                children: V
            }, b);
        })
    });
};
const Qo = v.createContext({
    strict: !1
}), ti = {
    animation: ["animate", "variants", "whileHover", "whileTap", "exit", "whileInView", "whileFocus", "whileDrag"],
    exit: ["exit"],
    drag: ["drag", "dragControls"],
    focus: ["whileFocus"],
    hover: ["whileHover", "onHoverStart", "onHoverEnd"],
    tap: ["whileTap", "onTap", "onTapStart", "onTapCancel"],
    pan: ["onPan", "onPanStart", "onPanSessionStart", "onPanEnd"],
    inView: ["whileInView", "onViewportEnter", "onViewportLeave"],
    layout: ["layout", "layoutId"]
};
let ei = !1;
function uc() {
  if (ei) return;
  const t = {};
  for (const e in ti) t[e] = {
    isEnabled: n => ti[e].some(s => !!n[s])
  };
  Po(t), ei = !0;
}
function tr() {
  return uc(), Gl();
}
function cc(t) {
  const e = tr();
  for (const n in t) e[n] = {
    ...e[n],
    ...t[n]
  };
  Po(e);
}
const hc = new Set(["animate", "exit", "variants", "initial", "style", "values", "variants", "transition", "transformTemplate", "custom", "inherit", "onBeforeLayoutMeasure", "onAnimationStart", "onAnimationComplete", "onUpdate", "onDragStart", "onDrag", "onDragEnd", "onMeasureDragConstraints", "onDirectionLock", "onDragTransitionEnd", "_dragX", "_dragY", "onHoverStart", "onHoverEnd", "onViewportEnter", "onViewportLeave", "globalTapTarget", "propagate", "ignoreStrict", "viewport"]);
function Se(t) {
  return t.startsWith("while") || t.startsWith("drag") && t !== "draggable" || t.startsWith("layout") || t.startsWith("onTap") || t.startsWith("onPan") || t.startsWith("onLayout") || hc.has(t);
}
let er = t => !Se(t);
function fc(t, e, n) {
  const s = {};
  for (const i in t) i === "values" && typeof t.values == "object" || F(t[i]) || (er(i) || n === !0 && Se(i) || !e && !Se(i) || t.draggable && i.startsWith("onDrag")) && (s[i] = t[i]);
  return s;
}
const Ce = v.createContext({});
function dc(t, e) {
  if (Ve(t)) {
    const {
      initial: n,
      animate: s
    } = t;
    return {
      initial: n === !1 || zt(n) ? n : void 0,
      animate: zt(s) ? s : void 0
    };
  }
  return t.inherit !== !1 ? e : {};
}
function pc(t) {
  const {
    initial: e,
    animate: n
  } = dc(t, v.useContext(Ce));
  return v.useMemo(() => ({
    initial: e,
    animate: n
  }), [ni(e), ni(n)]);
}
function ni(t) {
  return Array.isArray(t) ? t.join(" ") : t;
}
const Gn = () => ({
    style: {},
    transform: {},
    transformOrigin: {},
    vars: {}
});
function sr(t, e, n) {
  for (const s in e) !F(e[s]) && !Ro(s, n) && (t[s] = e[s]);
}
function mc({
  transformTemplate: t
}, e) {
  return v.useMemo(() => {
    const n = Gn();
    return Wn(n, e, t), Object.assign({}, n.vars, n.style);
  }, [e]);
}
function gc(t, e) {
  const n = t.style || {},
    s = {};
  return sr(s, n, t), Object.assign(s, mc(t, e)), s;
}
function yc(t, e) {
  const n = {},
    s = gc(t, e);
  return t.drag && t.dragListener !== !1 && (n.draggable = !1, s.userSelect = s.WebkitUserSelect = s.WebkitTouchCallout = "none", s.touchAction = t.drag === !0 ? "none" : `pan-${t.drag === "x" ? "y" : "x"}`), t.tabIndex === void 0 && (t.onTap || t.onTapStart || t.whileTap) && (n.tabIndex = 0), n.style = s, n;
}
const ir = () => ({
    ...Gn(),
    attrs: {}
});
function vc(t, e, n, s) {
  const i = v.useMemo(() => {
    const r = ir();
    return ko(r, e, Fo(s), t.transformTemplate, t.style), {
      ...r.attrs,
      style: {
        ...r.style
      }
    };
  }, [e]);
  if (t.style) {
    const r = {};
    sr(r, t.style, t), i.style = {
      ...r,
      ...i.style
    };
  }
  return i;
}
const xc = ["animate", "circle", "defs", "desc", "ellipse", "g", "image", "line", "filter", "marker", "mask", "metadata", "path", "pattern", "polygon", "polyline", "rect", "stop", "switch", "symbol", "svg", "text", "tspan", "use", "view"];
function $n(t) {
  return typeof t != "string" || t.includes("-") ? !1 : !!(xc.indexOf(t) > -1 || /[A-Z]/u.test(t));
}
function Tc(t, e, n, {
  latestValues: s
}, i, r = !1, o) {
  const l = (o ?? $n(t) ? vc : yc)(e, s, i, t),
    c = fc(e, typeof t == "string", r),
    u = t !== v.Fragment ? {
      ...c,
      ...l,
      ref: n
    } : {},
    {
      children: h
    } = e,
    f = v.useMemo(() => F(h) ? h.get() : h, [h]);
  return v.createElement(t, {
    ...u,
    children: f
  });
}
function Sc({
  scrapeMotionValuesFromProps: t,
  createRenderState: e
}, n, s, i) {
  return {
    latestValues: wc(n, s, i, t),
    renderState: e()
  };
}
function wc(t, e, n, s) {
  const i = {},
    r = s(t, {});
  for (const f in r) i[f] = de(r[f]);
  let {
    initial: o,
    animate: a
  } = t;
  const l = Ve(t),
    c = So(t);
  e && c && !l && t.inherit !== !1 && (o === void 0 && (o = e.initial), a === void 0 && (a = e.animate));
  let u = n ? n.initial === !1 : !1;
  u = u || o === !1;
  const h = u ? a : o;
  if (h && typeof h != "boolean" && !be(h)) {
    const f = Array.isArray(h) ? h : [h];
    for (let d = 0; d < f.length; d++) {
      const p = Rn(t, f[d]);
      if (p) {
        const {
          transitionEnd: g,
          transition: m,
          ...y
        } = p;
        for (const x in y) {
          let T = y[x];
          if (Array.isArray(T)) {
            const S = u ? T.length - 1 : 0;
            T = T[S];
          }
          T !== null && (i[x] = T);
        }
        for (const x in g) i[x] = g[x];
      }
    }
  }
  return i;
}
const or = t => (e, n) => {
    const s = v.useContext(Ce), i = v.useContext(_t), r = () => Sc(t, e, s, i);
    return n ? r() : ut(r);
}, Pc = or({
    scrapeMotionValuesFromProps: Kn,
    createRenderState: Gn
}), Ac = or({
    scrapeMotionValuesFromProps: Bo,
    createRenderState: ir
}), bc = Symbol.for("motionComponentSymbol");
function Vc(t, e, n) {
  const s = v.useRef(n);
  v.useInsertionEffect(() => {
    s.current = n;
  });
  const i = v.useRef(null);
  return v.useCallback(r => {
    r && t.onMount?.(r);
    const o = s.current;
    if (typeof o == "function") {
      if (r) {
        const a = o(r);
        typeof a == "function" && (i.current = a);
      } else i.current ? (i.current(), i.current = null) : o(r);
    } else o && (o.current = r);
    e && (r ? e.mount(r) : e.unmount());
  }, [e]);
}
const rr = v.createContext({});
function Tt(t) {
  return t && typeof t == "object" && Object.prototype.hasOwnProperty.call(t, "current");
}
function Cc(t, e, n, s, i, r) {
  const {
      visualElement: o
    } = v.useContext(Ce),
    a = v.useContext(Qo),
    l = v.useContext(_t),
    c = v.useContext(xt),
    u = c.reducedMotion,
    h = c.skipAnimations,
    f = v.useRef(null),
    d = v.useRef(!1);
  s = s || a.renderer, !f.current && s && (f.current = s(t, {
    visualState: e,
    parent: o,
    props: n,
    presenceContext: l,
    blockInitialAnimation: l ? l.initial === !1 : !1,
    reducedMotionConfig: u,
    skipAnimations: h,
    isSVG: r
  }), d.current && f.current && (f.current.manuallyAnimateOnMount = !0));
  const p = f.current,
    g = v.useContext(rr);
  p && !p.projection && i && (p.type === "html" || p.type === "svg") && Mc(f.current, n, i, g);
  const m = v.useRef(!1);
  v.useInsertionEffect(() => {
    p && m.current && p.update(n, l);
  });
  const y = n[lo],
    x = v.useRef(!!y && typeof window < "u" && !window.MotionHandoffIsComplete?.(y) && window.MotionHasOptimisedAnimation?.(y));
  return we(() => {
    d.current = !0, p && (m.current = !0, window.MotionIsMounted = !0, p.updateFeatures(), p.scheduleRenderMicrotask(), x.current && p.animationState && p.animationState.animateChanges());
  }), v.useEffect(() => {
    p && (!x.current && p.animationState && p.animationState.animateChanges(), x.current && (queueMicrotask(() => {
      window.MotionHandoffMarkAsComplete?.(y);
    }), x.current = !1), p.enteringChildren = void 0);
  }), p;
}
function Mc(t, e, n, s) {
  const {
    layoutId: i,
    layout: r,
    drag: o,
    dragConstraints: a,
    layoutScroll: l,
    layoutRoot: c,
    layoutAnchor: u,
    layoutCrossfade: h
  } = e;
  t.projection = new n(t.latestValues, e["data-framer-portal-id"] ? void 0 : ar(t.parent)), t.projection.setOptions({
    layoutId: i,
    layout: r,
    alwaysMeasureLayout: !!o || a && Tt(a),
    visualElement: t,
    animationType: typeof r == "string" ? r : "both",
    initialPromotionConfig: s,
    crossfade: h,
    layoutScroll: l,
    layoutRoot: c,
    layoutAnchor: u
  });
}
function ar(t) {
  if (t) return t.options.allowProjection !== !1 ? t.projection : ar(t.parent);
}
function Ue(t, {
  forwardMotionProps: e = !1,
  type: n
} = {}, s, i) {
  s && cc(s);
  const r = n ? n === "svg" : $n(t),
    o = r ? Ac : Pc;
  function a(c, u) {
    let h;
    const f = {
        ...v.useContext(xt),
        ...c,
        layoutId: Dc(c)
      },
      {
        isStatic: d
      } = f,
      p = pc(c),
      g = o(c, d);
    if (!d && typeof window < "u") {
      Ec();
      const m = Rc(f);
      h = m.MeasureLayout, p.visualElement = Cc(t, g, f, i, m.ProjectionNode, r);
    }
    return q.jsxs(Ce.Provider, {
      value: p,
      children: [h && p.visualElement ? q.jsx(h, {
        visualElement: p.visualElement,
        ...f
      }) : null, Tc(t, c, Vc(g, p.visualElement, u), g, d, e, r)]
    });
  }
  a.displayName = `motion.${typeof t == "string" ? t : `create(${t.displayName ?? t.name ?? ""})`}`;
  const l = v.forwardRef(a);
  return l[bc] = t, l;
}
function Dc({
  layoutId: t
}) {
  const e = v.useContext(Ut).id;
  return e && t !== void 0 ? e + "-" + t : t;
}
function Ec(t, e) {
  v.useContext(Qo).strict;
}
function Rc(t) {
  const e = tr(),
    {
      drag: n,
      layout: s
    } = e;
  if (!n && !s) return {};
  const i = {
    ...n,
    ...s
  };
  return {
    MeasureLayout: n?.isEnabled(t) || s?.isEnabled(t) ? i.MeasureLayout : void 0,
    ProjectionNode: i.ProjectionNode
  };
}
function Lc(t, e) {
  if (typeof Proxy > "u") return Ue;
  const n = new Map(),
    s = (r, o) => Ue(r, o, t, e),
    i = (r, o) => s(r, o);
  return new Proxy(i, {
    get: (r, o) => o === "create" ? s : (n.has(o) || n.set(o, Ue(o, void 0, t, e)), n.get(o))
  });
}
const kc = (t, e) => e.isSVG ?? $n(t) ? new jo(e) : new Lo(e, {
    allowProjection: t !== v.Fragment
});
class Ic extends ft {
  constructor(e) {
    super(e), e.animationState || (e.animationState = cu(e));
  }
  updateAnimationControlsSubscription() {
    const {
      animate: e
    } = this.node.getProps();
    be(e) && (this.unmountControls = e.subscribe(this.node));
  }
  mount() {
    this.updateAnimationControlsSubscription();
  }
  update() {
    const {
        animate: e
      } = this.node.getProps(),
      {
        animate: n
      } = this.node.prevProps || {};
    e !== n && this.updateAnimationControlsSubscription();
  }
  unmount() {
    this.node.animationState.reset(), this.unmountControls?.();
  }
}
let Fc = 0;
class Bc extends ft {
  constructor() {
    super(...arguments), this.id = Fc++, this.isExitComplete = !1;
  }
  update() {
    if (!this.node.presenceContext) return;
    const {
        isPresent: e,
        onExitComplete: n
      } = this.node.presenceContext,
      {
        isPresent: s
      } = this.node.prevPresenceContext || {};
    if (!this.node.animationState || e === s) return;
    if (e && s === !1) {
      if (this.isExitComplete) {
        const {
          initial: r,
          custom: o
        } = this.node.getProps();
        if (typeof r == "string") {
          const a = vt(this.node, r, o);
          if (a) {
            const {
              transition: l,
              transitionEnd: c,
              ...u
            } = a;
            for (const h in u) this.node.getValue(h)?.jump(u[h]);
          }
        }
        this.node.animationState.reset(), this.node.animationState.animateChanges();
      } else this.node.animationState.setActive("exit", !1);
      this.isExitComplete = !1;
      return;
    }
    const i = this.node.animationState.setActive("exit", !e);
    n && !e && i.then(() => {
      this.isExitComplete = !0, n(this.id);
    });
  }
  mount() {
    const {
      register: e,
      onExitComplete: n
    } = this.node.presenceContext || {};
    n && n(this.id), e && (this.unmount = e(this.id));
  }
  unmount() {}
}
const jc = {
    animation: {
        Feature: Ic
    },
    exit: {
        Feature: Bc
    }
};
function Zt(t) {
  return {
    point: {
      x: t.pageX,
      y: t.pageY
    }
  };
}
const Oc = t => e => jn(e) && t(e, Zt(e));
function Nt(t, e, n, s) {
  return Ht(t, e, Oc(n), s);
}
const lr = ({ current: t }) => t ? t.ownerDocument.defaultView : null, si = (t, e) => Math.abs(t - e);
function Nc(t, e) {
  const n = si(t.x, e.x),
    s = si(t.y, e.y);
  return Math.sqrt(n ** 2 + s ** 2);
}
const ii = new Set(["auto", "scroll"]);
class ur {
  constructor(e, n, {
    transformPagePoint: s,
    contextWindow: i = window,
    dragSnapToOrigin: r = !1,
    distanceThreshold: o = 3,
    element: a
  } = {}) {
    if (this.startEvent = null, this.lastMoveEvent = null, this.lastMoveEventInfo = null, this.lastRawMoveEventInfo = null, this.handlers = {}, this.contextWindow = window, this.scrollPositions = new Map(), this.removeScrollListeners = null, this.onElementScroll = d => {
      this.handleScroll(d.target);
    }, this.onWindowScroll = () => {
      this.handleScroll(window);
    }, this.updatePoint = () => {
      if (!(this.lastMoveEvent && this.lastMoveEventInfo)) return;
      this.lastRawMoveEventInfo && (this.lastMoveEventInfo = ie(this.lastRawMoveEventInfo, this.transformPagePoint));
      const d = We(this.lastMoveEventInfo, this.history),
        p = this.startEvent !== null,
        g = Nc(d.offset, {
          x: 0,
          y: 0
        }) >= this.distanceThreshold;
      if (!p && !g) return;
      const {
          point: m
        } = d,
        {
          timestamp: y
        } = O;
      this.history.push({
        ...m,
        timestamp: y
      });
      const {
        onStart: x,
        onMove: T
      } = this.handlers;
      p || (x && x(this.lastMoveEvent, d), this.startEvent = this.lastMoveEvent), T && T(this.lastMoveEvent, d);
    }, this.handlePointerMove = (d, p) => {
      this.lastMoveEvent = d, this.lastRawMoveEventInfo = p, this.lastMoveEventInfo = ie(p, this.transformPagePoint), D.update(this.updatePoint, !0);
    }, this.handlePointerUp = (d, p) => {
      this.end();
      const {
        onEnd: g,
        onSessionEnd: m,
        resumeAnimation: y
      } = this.handlers;
      if ((this.dragSnapToOrigin || !this.startEvent) && y && y(), !(this.lastMoveEvent && this.lastMoveEventInfo)) return;
      const x = We(d.type === "pointercancel" ? this.lastMoveEventInfo : ie(p, this.transformPagePoint), this.history);
      this.startEvent && g && g(d, x), m && m(d, x);
    }, !jn(e)) return;
    this.dragSnapToOrigin = r, this.handlers = n, this.transformPagePoint = s, this.distanceThreshold = o, this.contextWindow = i || window;
    const l = Zt(e),
      c = ie(l, this.transformPagePoint),
      {
        point: u
      } = c,
      {
        timestamp: h
      } = O;
    this.history = [{
      ...u,
      timestamp: h
    }];
    const {
      onSessionStart: f
    } = n;
    f && f(e, We(c, this.history)), this.removeListeners = Xt(Nt(this.contextWindow, "pointermove", this.handlePointerMove), Nt(this.contextWindow, "pointerup", this.handlePointerUp), Nt(this.contextWindow, "pointercancel", this.handlePointerUp)), a && this.startScrollTracking(a);
  }
  startScrollTracking(e) {
    let n = e.parentElement;
    for (; n;) {
      const s = getComputedStyle(n);
      (ii.has(s.overflowX) || ii.has(s.overflowY)) && this.scrollPositions.set(n, {
        x: n.scrollLeft,
        y: n.scrollTop
      }), n = n.parentElement;
    }
    this.scrollPositions.set(window, {
      x: window.scrollX,
      y: window.scrollY
    }), window.addEventListener("scroll", this.onElementScroll, {
      capture: !0
    }), window.addEventListener("scroll", this.onWindowScroll), this.removeScrollListeners = () => {
      window.removeEventListener("scroll", this.onElementScroll, {
        capture: !0
      }), window.removeEventListener("scroll", this.onWindowScroll);
    };
  }
  handleScroll(e) {
    const n = this.scrollPositions.get(e);
    if (!n) return;
    const s = e === window,
      i = s ? {
        x: window.scrollX,
        y: window.scrollY
      } : {
        x: e.scrollLeft,
        y: e.scrollTop
      },
      r = {
        x: i.x - n.x,
        y: i.y - n.y
      };
    r.x === 0 && r.y === 0 || (s ? this.lastMoveEventInfo && (this.lastMoveEventInfo.point.x += r.x, this.lastMoveEventInfo.point.y += r.y) : this.history.length > 0 && (this.history[0].x -= r.x, this.history[0].y -= r.y), this.scrollPositions.set(e, i), D.update(this.updatePoint, !0));
  }
  updateHandlers(e) {
    this.handlers = e;
  }
  end() {
    this.removeListeners && this.removeListeners(), this.removeScrollListeners && this.removeScrollListeners(), this.scrollPositions.clear(), rt(this.updatePoint);
  }
}
function ie(t, e) {
  return e ? {
    point: e(t.point)
  } : t;
}
function oi(t, e) {
  return {
    x: t.x - e.x,
    y: t.y - e.y
  };
}
function We({
  point: t
}, e) {
  return {
    point: t,
    delta: oi(t, cr(e)),
    offset: oi(t, Uc(e)),
    velocity: Wc(e, .1)
  };
}
function Uc(t) {
  return t[0];
}
function cr(t) {
  return t[t.length - 1];
}
function Wc(t, e) {
  if (t.length < 2) return {
    x: 0,
    y: 0
  };
  let n = t.length - 1,
    s = null;
  const i = cr(t);
  for (; n >= 0 && (s = t[n], !(i.timestamp - s.timestamp > G(e)));) n--;
  if (!s) return {
    x: 0,
    y: 0
  };
  s === t[0] && t.length > 2 && i.timestamp - s.timestamp > G(e) * 2 && (s = t[1]);
  const r = z(i.timestamp - s.timestamp);
  if (r === 0) return {
    x: 0,
    y: 0
  };
  const o = {
    x: (i.x - s.x) / r,
    y: (i.y - s.y) / r
  };
  return o.x === 1 / 0 && (o.x = 0), o.y === 1 / 0 && (o.y = 0), o;
}
function Kc(t, {
  min: e,
  max: n
}, s) {
  return e !== void 0 && t < e ? t = s ? L(e, t, s.min) : Math.max(t, e) : n !== void 0 && t > n && (t = s ? L(n, t, s.max) : Math.min(t, n)), t;
}
function ri(t, e, n) {
  return {
    min: e !== void 0 ? t.min + e : void 0,
    max: n !== void 0 ? t.max + n - (t.max - t.min) : void 0
  };
}
function Gc(t, {
  top: e,
  left: n,
  bottom: s,
  right: i
}) {
  return {
    x: ri(t.x, n, i),
    y: ri(t.y, e, s)
  };
}
function ai(t, e) {
  let n = e.min - t.min,
    s = e.max - t.max;
  return e.max - e.min < t.max - t.min && ([n, s] = [s, n]), {
    min: n,
    max: s
  };
}
function $c(t, e) {
  return {
    x: ai(t.x, e.x),
    y: ai(t.y, e.y)
  };
}
function zc(t, e) {
  let n = .5;
  const s = W(t),
    i = W(e);
  return i > s ? n = bt(e.min, e.max - s, t.min) : s > i && (n = bt(t.min, t.max - i, e.min)), st(0, 1, n);
}
function Hc(t, e) {
  const n = {};
  return e.min !== void 0 && (n.min = e.min - t.min), e.max !== void 0 && (n.max = e.max - t.min), n;
}
const dn = .35;
function _c(t = dn) {
  return t === !1 ? t = 0 : t === !0 && (t = dn), {
    x: li(t, "left", "right"),
    y: li(t, "top", "bottom")
  };
}
function li(t, e, n) {
  return {
    min: ui(t, e),
    max: ui(t, n)
  };
}
function ui(t, e) {
  return typeof t == "number" ? t : t[e] || 0;
}
const Xc = new WeakMap();
class Yc {
  constructor(e) {
    this.openDragLock = null, this.isDragging = !1, this.currentDirection = null, this.originPoint = {
      x: 0,
      y: 0
    }, this.constraints = !1, this.hasMutatedConstraints = !1, this.elastic = B(), this.latestPointerEvent = null, this.latestPanInfo = null, this.visualElement = e;
  }
  start(e, {
    snapToCursor: n = !1,
    distanceThreshold: s
  } = {}) {
    const {
      presenceContext: i
    } = this.visualElement;
    if (i && i.isPresent === !1) return;
    const r = h => {
        n && this.snapToCursor(Zt(h).point), this.stopAnimation();
      },
      o = (h, f) => {
        const {
          drag: d,
          dragPropagation: p,
          onDragStart: g
        } = this.getProps();
        if (d && !p && (this.openDragLock && this.openDragLock(), this.openDragLock = Tl(d), !this.openDragLock)) return;
        this.latestPointerEvent = h, this.latestPanInfo = f, this.isDragging = !0, this.currentDirection = null, this.resolveConstraints(), this.visualElement.projection && (this.visualElement.projection.isAnimationBlocked = !0, this.visualElement.projection.target = void 0), tt(y => {
          let x = this.getAxisMotionValue(y).get() || 0;
          if (nt.test(x)) {
            const {
              projection: T
            } = this.visualElement;
            if (T && T.layout) {
              const S = T.layout.layoutBox[y];
              S && (x = W(S) * (parseFloat(x) / 100));
            }
          }
          this.originPoint[y] = x;
        }), g && D.update(() => g(h, f), !1, !0), on(this.visualElement, "transform");
        const {
          animationState: m
        } = this.visualElement;
        m && m.setActive("whileDrag", !0);
      },
      a = (h, f) => {
        this.latestPointerEvent = h, this.latestPanInfo = f;
        const {
          dragPropagation: d,
          dragDirectionLock: p,
          onDirectionLock: g,
          onDrag: m
        } = this.getProps();
        if (!d && !this.openDragLock) return;
        const {
          offset: y
        } = f;
        if (p && this.currentDirection === null) {
          this.currentDirection = Zc(y), this.currentDirection !== null && g && g(this.currentDirection);
          return;
        }
        this.updateAxis("x", f.point, y), this.updateAxis("y", f.point, y), this.visualElement.render(), m && D.update(() => m(h, f), !1, !0);
      },
      l = (h, f) => {
        this.latestPointerEvent = h, this.latestPanInfo = f, this.stop(h, f), this.latestPointerEvent = null, this.latestPanInfo = null;
      },
      c = () => {
        const {
          dragSnapToOrigin: h
        } = this.getProps();
        (h || this.constraints) && this.startAnimation({
          x: 0,
          y: 0
        });
      },
      {
        dragSnapToOrigin: u
      } = this.getProps();
    this.panSession = new ur(e, {
      onSessionStart: r,
      onStart: o,
      onMove: a,
      onSessionEnd: l,
      resumeAnimation: c
    }, {
      transformPagePoint: this.visualElement.getTransformPagePoint(),
      dragSnapToOrigin: u,
      distanceThreshold: s,
      contextWindow: lr(this.visualElement),
      element: this.visualElement.current
    });
  }
  stop(e, n) {
    const s = e || this.latestPointerEvent,
      i = n || this.latestPanInfo,
      r = this.isDragging;
    if (this.cancel(), !r || !i || !s) return;
    const {
      velocity: o
    } = i;
    this.startAnimation(o);
    const {
      onDragEnd: a
    } = this.getProps();
    a && D.postRender(() => a(s, i));
  }
  cancel() {
    this.isDragging = !1;
    const {
      projection: e,
      animationState: n
    } = this.visualElement;
    e && (e.isAnimationBlocked = !1), this.endPanSession();
    const {
      dragPropagation: s
    } = this.getProps();
    !s && this.openDragLock && (this.openDragLock(), this.openDragLock = null), n && n.setActive("whileDrag", !1);
  }
  endPanSession() {
    this.panSession && this.panSession.end(), this.panSession = void 0;
  }
  updateAxis(e, n, s) {
    const {
      drag: i
    } = this.getProps();
    if (!s || !oe(e, i, this.currentDirection)) return;
    const r = this.getAxisMotionValue(e);
    let o = this.originPoint[e] + s[e];
    this.constraints && this.constraints[e] && (o = Kc(o, this.constraints[e], this.elastic[e])), r.set(o);
  }
  resolveConstraints() {
    const {
        dragConstraints: e,
        dragElastic: n
      } = this.getProps(),
      s = this.visualElement.projection && !this.visualElement.projection.layout ? this.visualElement.projection.measure(!1) : this.visualElement.projection?.layout,
      i = this.constraints;
    e && Tt(e) ? this.constraints || (this.constraints = this.resolveRefConstraints()) : e && s ? this.constraints = Gc(s.layoutBox, e) : this.constraints = !1, this.elastic = _c(n), i !== this.constraints && !Tt(e) && s && this.constraints && !this.hasMutatedConstraints && tt(r => {
      this.constraints !== !1 && this.getAxisMotionValue(r) && (this.constraints[r] = Hc(s.layoutBox[r], this.constraints[r]));
    });
  }
  resolveRefConstraints() {
    const {
      dragConstraints: e,
      onMeasureDragConstraints: n
    } = this.getProps();
    if (!e || !Tt(e)) return !1;
    const s = e.current,
      {
        projection: i
      } = this.visualElement;
    if (!i || !i.layout) return !1;
    const r = _l(s, i.root, this.visualElement.getTransformPagePoint());
    let o = $c(i.layout.layoutBox, r);
    if (n) {
      const a = n($l(o));
      this.hasMutatedConstraints = !!a, a && (o = Vo(a));
    }
    return o;
  }
  startAnimation(e) {
    const {
        drag: n,
        dragMomentum: s,
        dragElastic: i,
        dragTransition: r,
        dragSnapToOrigin: o,
        onDragTransitionEnd: a
      } = this.getProps(),
      l = this.constraints || {},
      c = tt(u => {
        if (!oe(u, n, this.currentDirection)) return;
        let h = l && l[u] || {};
        (o === !0 || o === u) && (h = {
          min: 0,
          max: 0
        });
        const f = i ? 200 : 1e6,
          d = i ? 40 : 1e7,
          p = {
            type: "inertia",
            velocity: s ? e[u] : 0,
            bounceStiffness: f,
            bounceDamping: d,
            timeConstant: 750,
            restDelta: 1,
            restSpeed: 10,
            ...r,
            ...h
          };
        return this.startAxisValueAnimation(u, p);
      });
    return Promise.all(c).then(a);
  }
  startAxisValueAnimation(e, n) {
    const s = this.getAxisMotionValue(e);
    return on(this.visualElement, e), s.start(En(e, s, 0, n, this.visualElement, !1));
  }
  stopAnimation() {
    tt(e => this.getAxisMotionValue(e).stop());
  }
  getAxisMotionValue(e) {
    const n = `_drag${e.toUpperCase()}`,
      s = this.visualElement.getProps(),
      i = s[n];
    return i || this.visualElement.getValue(e, (s.initial ? s.initial[e] : void 0) || 0);
  }
  snapToCursor(e) {
    tt(n => {
      const {
        drag: s
      } = this.getProps();
      if (!oe(n, s, this.currentDirection)) return;
      const {
          projection: i
        } = this.visualElement,
        r = this.getAxisMotionValue(n);
      if (i && i.layout) {
        const {
            min: o,
            max: a
          } = i.layout.layoutBox[n],
          l = r.get() || 0;
        r.set(e[n] - L(o, a, .5) + l);
      }
    });
  }
  scalePositionWithinConstraints() {
    if (!this.visualElement.current) return;
    const {
        drag: e,
        dragConstraints: n
      } = this.getProps(),
      {
        projection: s
      } = this.visualElement;
    if (!Tt(n) || !s || !this.constraints) return;
    this.stopAnimation();
    const i = {
      x: 0,
      y: 0
    };
    tt(o => {
      const a = this.getAxisMotionValue(o);
      if (a && this.constraints !== !1) {
        const l = a.get();
        i[o] = zc({
          min: l,
          max: l
        }, this.constraints[o]);
      }
    });
    const {
      transformTemplate: r
    } = this.visualElement.getProps();
    this.visualElement.current.style.transform = r ? r({}, "") : "none", s.root && s.root.updateScroll(), s.updateLayout(), this.constraints = !1, this.resolveConstraints(), tt(o => {
      if (!oe(o, e, null)) return;
      const a = this.getAxisMotionValue(o),
        {
          min: l,
          max: c
        } = this.constraints[o];
      a.set(L(l, c, i[o]));
    }), this.visualElement.render();
  }
  addListeners() {
    if (!this.visualElement.current) return;
    Xc.set(this.visualElement, this);
    const e = this.visualElement.current,
      n = Nt(e, "pointerdown", c => {
        const {
            drag: u,
            dragListener: h = !0
          } = this.getProps(),
          f = c.target,
          d = f !== e && Vl(f);
        u && h && !d && this.start(c);
      });
    let s;
    const i = () => {
        const {
          dragConstraints: c
        } = this.getProps();
        Tt(c) && c.current && (this.constraints = this.resolveRefConstraints(), s || (s = qc(e, c.current, () => this.scalePositionWithinConstraints())));
      },
      {
        projection: r
      } = this.visualElement,
      o = r.addEventListener("measure", i);
    r && !r.layout && (r.root && r.root.updateScroll(), r.updateLayout()), D.read(i);
    const a = Ht(window, "resize", () => this.scalePositionWithinConstraints()),
      l = r.addEventListener("didUpdate", ({
        delta: c,
        hasLayoutChanged: u
      }) => {
        this.isDragging && u && (tt(h => {
          const f = this.getAxisMotionValue(h);
          f && (this.originPoint[h] += c[h].translate, f.set(f.get() + c[h].translate));
        }), this.visualElement.render());
      });
    return () => {
      a(), n(), o(), l && l(), s && s();
    };
  }
  getProps() {
    const e = this.visualElement.getProps(),
      {
        drag: n = !1,
        dragDirectionLock: s = !1,
        dragPropagation: i = !1,
        dragConstraints: r = !1,
        dragElastic: o = dn,
        dragMomentum: a = !0
      } = e;
    return {
      ...e,
      drag: n,
      dragDirectionLock: s,
      dragPropagation: i,
      dragConstraints: r,
      dragElastic: o,
      dragMomentum: a
    };
  }
}
function ci(t) {
  let e = !0;
  return () => {
    if (e) {
      e = !1;
      return;
    }
    t();
  };
}
function qc(t, e, n) {
  const s = ms(t, ci(n)),
    i = ms(e, ci(n));
  return () => {
    s(), i();
  };
}
function oe(t, e, n) {
  return (e === !0 || e === t) && (n === null || n === t);
}
function Zc(t, e = 10) {
  let n = null;
  return Math.abs(t.y) > e ? n = "y" : Math.abs(t.x) > e && (n = "x"), n;
}
class Jc extends ft {
  constructor(e) {
    super(e), this.removeGroupControls = H, this.removeListeners = H, this.controls = new Yc(e);
  }
  mount() {
    const {
      dragControls: e
    } = this.node.getProps();
    e && (this.removeGroupControls = e.subscribe(this.controls)), this.removeListeners = this.controls.addListeners() || H;
  }
  update() {
    const {
        dragControls: e
      } = this.node.getProps(),
      {
        dragControls: n
      } = this.node.prevProps || {};
    e !== n && (this.removeGroupControls(), e && (this.removeGroupControls = e.subscribe(this.controls)));
  }
  unmount() {
    this.removeGroupControls(), this.removeListeners(), this.controls.isDragging || this.controls.endPanSession();
  }
}
const Ke = t => (e, n) => {
    t && D.update(() => t(e, n), !1, !0);
};
class Qc extends ft {
  constructor() {
    super(...arguments), this.removePointerDownListener = H;
  }
  onPointerDown(e) {
    this.session = new ur(e, this.createPanHandlers(), {
      transformPagePoint: this.node.getTransformPagePoint(),
      contextWindow: lr(this.node)
    });
  }
  createPanHandlers() {
    const {
      onPanSessionStart: e,
      onPanStart: n,
      onPan: s,
      onPanEnd: i
    } = this.node.getProps();
    return {
      onSessionStart: Ke(e),
      onStart: Ke(n),
      onMove: Ke(s),
      onEnd: (r, o) => {
        delete this.session, i && D.postRender(() => i(r, o));
      }
    };
  }
  mount() {
    this.removePointerDownListener = Nt(this.node.current, "pointerdown", e => this.onPointerDown(e));
  }
  update() {
    this.session && this.session.updateHandlers(this.createPanHandlers());
  }
  unmount() {
    this.removePointerDownListener(), this.session && this.session.end();
  }
}
let Ge = !1;
class th extends v.Component {
  componentDidMount() {
    const {
        visualElement: e,
        layoutGroup: n,
        switchLayoutGroup: s,
        layoutId: i
      } = this.props,
      {
        projection: r
      } = e;
    r && (n.group && n.group.add(r), s && s.register && i && s.register(r), Ge && r.root.didUpdate(), r.addEventListener("animationComplete", () => {
      this.safeToRemove();
    }), r.setOptions({
      ...r.options,
      layoutDependency: this.props.layoutDependency,
      onExitComplete: () => this.safeToRemove()
    })), pe.hasEverUpdated = !0;
  }
  getSnapshotBeforeUpdate(e) {
    const {
        layoutDependency: n,
        visualElement: s,
        drag: i,
        isPresent: r
      } = this.props,
      {
        projection: o
      } = s;
    return o && (o.isPresent = r, e.layoutDependency !== n && o.setOptions({
      ...o.options,
      layoutDependency: n
    }), Ge = !0, i || e.layoutDependency !== n || n === void 0 || e.isPresent !== r ? o.willUpdate() : this.safeToRemove(), e.isPresent !== r && (r ? o.promote() : o.relegate() || D.postRender(() => {
      const a = o.getStack();
      (!a || !a.members.length) && this.safeToRemove();
    }))), null;
  }
  componentDidUpdate() {
    const {
        visualElement: e,
        layoutAnchor: n
      } = this.props,
      {
        projection: s
      } = e;
    s && (s.options.layoutAnchor = n, s.root.didUpdate(), Bn.postRender(() => {
      !s.currentAnimation && s.isLead() && this.safeToRemove();
    }));
  }
  componentWillUnmount() {
    const {
        visualElement: e,
        layoutGroup: n,
        switchLayoutGroup: s
      } = this.props,
      {
        projection: i
      } = e;
    Ge = !0, i && (i.scheduleCheckAfterUnmount(), n && n.group && n.group.remove(i), s && s.deregister && s.deregister(i));
  }
  safeToRemove() {
    const {
      safeToRemove: e
    } = this.props;
    e && e();
  }
  render() {
    return null;
  }
}
function hr(t) {
  const [e, n] = Zo(),
    s = v.useContext(Ut);
  return q.jsx(th, {
    ...t,
    layoutGroup: s,
    switchLayoutGroup: v.useContext(rr),
    isPresent: e,
    safeToRemove: n
  });
}
const eh = {
    pan: {
        Feature: Qc
    },
    drag: {
        Feature: Jc,
        ProjectionNode: qo,
        MeasureLayout: hr
    }
};
function hi(t, e, n) {
  const {
    props: s
  } = t;
  t.animationState && s.whileHover && t.animationState.setActive("whileHover", n === "Start");
  const i = "onHover" + n,
    r = s[i];
  r && D.postRender(() => r(e, Zt(e)));
}
class nh extends ft {
  mount() {
    const {
      current: e
    } = this.node;
    e && (this.unmount = wl(e, (n, s) => (hi(this.node, s, "Start"), i => hi(this.node, i, "End"))));
  }
  unmount() {}
}
class sh extends ft {
  constructor() {
    super(...arguments), this.isActive = !1;
  }
  onFocus() {
    let e = !1;
    try {
      e = this.node.current.matches(":focus-visible");
    } catch {
      e = !0;
    }
    !e || !this.node.animationState || (this.node.animationState.setActive("whileFocus", !0), this.isActive = !0);
  }
  onBlur() {
    !this.isActive || !this.node.animationState || (this.node.animationState.setActive("whileFocus", !1), this.isActive = !1);
  }
  mount() {
    this.unmount = Xt(Ht(this.node.current, "focus", () => this.onFocus()), Ht(this.node.current, "blur", () => this.onBlur()));
  }
  unmount() {}
}
function fi(t, e, n) {
  const {
    props: s
  } = t;
  if (t.current instanceof HTMLButtonElement && t.current.disabled) return;
  t.animationState && s.whileTap && t.animationState.setActive("whileTap", n === "Start");
  const i = "onTap" + (n === "End" ? "" : n),
    r = s[i];
  r && D.postRender(() => r(e, Zt(e)));
}
class ih extends ft {
  mount() {
    const {
      current: e
    } = this.node;
    if (!e) return;
    const {
      globalTapTarget: n,
      propagate: s
    } = this.node.props;
    this.unmount = Ml(e, (i, r) => (fi(this.node, r, "Start"), (o, {
      success: a
    }) => fi(this.node, o, a ? "End" : "Cancel")), {
      useGlobalTarget: n,
      stopPropagation: s?.tap === !1
    });
  }
  unmount() {}
}
const pn = new WeakMap(), $e = new WeakMap(), oh = t => {
    const e = pn.get(t.target);
    e && e(t);
}, rh = t => {
    t.forEach(oh);
};
function ah({
  root: t,
  ...e
}) {
  const n = t || document;
  $e.has(n) || $e.set(n, {});
  const s = $e.get(n),
    i = JSON.stringify(e);
  return s[i] || (s[i] = new IntersectionObserver(rh, {
    root: t,
    ...e
  })), s[i];
}
function lh(t, e, n) {
  const s = ah(e);
  return pn.set(t, n), s.observe(t), () => {
    pn.delete(t), s.unobserve(t);
  };
}
const uh = {
    some: 0,
    all: 1
};
class ch extends ft {
  constructor() {
    super(...arguments), this.hasEnteredView = !1, this.isInView = !1;
  }
  startObserver() {
    this.stopObserver?.();
    const {
        viewport: e = {}
      } = this.node.getProps(),
      {
        root: n,
        margin: s,
        amount: i = "some",
        once: r
      } = e,
      o = {
        root: n ? n.current : void 0,
        rootMargin: s,
        threshold: typeof i == "number" ? i : uh[i]
      },
      a = l => {
        const {
          isIntersecting: c
        } = l;
        if (this.isInView === c || (this.isInView = c, r && !c && this.hasEnteredView)) return;
        c && (this.hasEnteredView = !0), this.node.animationState && this.node.animationState.setActive("whileInView", c);
        const {
            onViewportEnter: u,
            onViewportLeave: h
          } = this.node.getProps(),
          f = c ? u : h;
        f && f(l);
      };
    this.stopObserver = lh(this.node.current, o, a);
  }
  mount() {
    this.startObserver();
  }
  update() {
    if (typeof IntersectionObserver > "u") return;
    const {
      props: e,
      prevProps: n
    } = this.node;
    ["amount", "margin", "root"].some(hh(e, n)) && this.startObserver();
  }
  unmount() {
    this.stopObserver?.(), this.hasEnteredView = !1, this.isInView = !1;
  }
}
function hh({
  viewport: t = {}
}, {
  viewport: e = {}
} = {}) {
  return n => t[n] !== e[n];
}
const fh = {
    inView: {
        Feature: ch
    },
    tap: {
        Feature: ih
    },
    focus: {
        Feature: sh
    },
    hover: {
        Feature: nh
    }
}, dh = {
    layout: {
        ProjectionNode: qo,
        MeasureLayout: hr
    }
}, ph = {
    ...jc,
    ...fh,
    ...eh,
    ...dh
}, Wh = Lc(ph, kc);
function fr(t) {
  const e = ut(() => ht(t)),
    {
      isStatic: n
    } = v.useContext(xt);
  if (n) {
    const [, s] = v.useState(t);
    v.useEffect(() => e.on("change", s), []);
  }
  return e;
}
function Gh() {
  !Un.current && wo();
  const [t] = v.useState(ye.current);
  return t;
}
function zn(t) {
  return typeof t == "object" && !Array.isArray(t);
}
function mr(t, e, n, s) {
  return t == null ? [] : typeof t == "string" && zn(e) ? Fn(t, n, s) : t instanceof NodeList ? Array.from(t) : Array.isArray(t) ? t.filter(i => i != null) : [t];
}
function vh(t, e, n) {
  return t * (e + 1);
}
function pi(t, e, n, s) {
  return typeof e == "number" ? e : e.startsWith("-") || e.startsWith("+") ? Math.max(0, t + parseFloat(e)) : e === "<" ? n : e.startsWith("<") ? Math.max(0, n + parseFloat(e.slice(1))) : s.get(e) ?? t;
}
function xh(t, e, n) {
  for (let s = 0; s < t.length; s++) {
    const i = t[s];
    i.at > e && i.at < n && (At(t, i), s--);
  }
}
function Th(t, e, n, s, i, r) {
  xh(t, i, r);
  for (let o = 0; o < e.length; o++) t.push({
    value: e[o],
    at: L(i, r, s[o]),
    easing: Li(n, o)
  });
}
function Sh(t, e) {
  for (let n = 0; n < t.length; n++) t[n] = t[n] / (e + 1);
}
function wh(t, e) {
  return t.at === e.at ? t.value === null ? 1 : e.value === null ? -1 : 0 : t.at - e.at;
}
const Ph = "easeInOut";
function Ah(t, {
  defaultTransition: e = {},
  ...n
} = {}, s, i) {
  const r = e.duration || .3,
    o = new Map(),
    a = new Map(),
    l = {},
    c = new Map();
  let u = 0,
    h = 0,
    f = 0;
  for (let d = 0; d < t.length; d++) {
    const p = t[d];
    if (typeof p == "string") {
      c.set(p, h);
      continue;
    } else if (!Array.isArray(p)) {
      c.set(p.name, pi(h, p.at, u, c));
      continue;
    }
    let [g, m, y = {}] = p;
    y.at !== void 0 && (h = pi(h, y.at, u, c));
    let x = 0;
    const T = (S, A, M, R = 0, V = 0) => {
      const b = bh(S),
        {
          delay: P = 0,
          times: C = Xi(b),
          type: I = e.type || "keyframes",
          repeat: K,
          repeatType: _,
          repeatDelay: J = 0,
          ...$
        } = A;
      let {
        ease: it = e.ease || "easeOut",
        duration: E
      } = A;
      const N = typeof P == "function" ? P(R, V) : P,
        Q = b.length,
        ot = Cn(I) ? I : i?.[I || "keyframes"];
      if (Q <= 2 && ot) {
        let Et = 100;
        if (Q === 2 && Mh(b)) {
          const Rt = b[1] - b[0];
          Et = Math.abs(Rt);
        }
        const Qt = {
          ...e,
          ...$
        };
        E !== void 0 && (Qt.duration = G(E));
        const te = $i(Qt, Et, ot);
        it = te.ease, E = te.duration;
      }
      E ?? (E = r);
      const Jt = h + N;
      C.length === 1 && C[0] === 0 && (C[1] = 1);
      const Hn = C.length - b.length;
      if (Hn > 0 && _i(C, Hn), b.length === 1 && b.unshift(null), K) {
        E = vh(E, K);
        const Et = [...b],
          Qt = [...C];
        it = Array.isArray(it) ? [...it] : [it];
        const te = [...it];
        for (let Rt = 0; Rt < K; Rt++) {
          b.push(...Et);
          for (let Lt = 0; Lt < Et.length; Lt++) C.push(Qt[Lt] + (Rt + 1)), it.push(Lt === 0 ? "linear" : Li(te, Lt - 1));
        }
        Sh(C, K);
      }
      const _n = Jt + E;
      Th(M, b, it, C, Jt, _n), x = Math.max(N + E, x), f = Math.max(_n, f);
    };
    if (F(g)) {
      const S = mi(g, a);
      T(m, y, gi("default", S));
    } else {
      const S = mr(g, m, s, l),
        A = S.length;
      for (let M = 0; M < A; M++) {
        m = m, y = y;
        const R = S[M],
          V = mi(R, a);
        for (const b in m) T(m[b], Vh(y, b), gi(b, V), M, A);
      }
    }
    u = h, h += x;
  }
  return a.forEach((d, p) => {
    for (const g in d) {
      const m = d[g];
      m.sort(wh);
      const y = [],
        x = [],
        T = [];
      for (let R = 0; R < m.length; R++) {
        const {
          at: V,
          value: b,
          easing: P
        } = m[R];
        y.push(b), x.push(bt(0, f, V)), T.push(P || "easeOut");
      }
      x[0] !== 0 && (x.unshift(0), y.unshift(y[0]), T.unshift(Ph)), x[x.length - 1] !== 1 && (x.push(1), y.push(null)), o.has(p) || o.set(p, {
        keyframes: {},
        transition: {}
      });
      const S = o.get(p);
      S.keyframes[g] = y;
      const {
        type: A,
        ...M
      } = e;
      S.transition[g] = {
        ...M,
        duration: f,
        ease: T,
        times: x,
        ...n
      };
    }
  }), o;
}
function mi(t, e) {
  return !e.has(t) && e.set(t, {}), e.get(t);
}
function gi(t, e) {
  return e[t] || (e[t] = []), e[t];
}
function bh(t) {
  return Array.isArray(t) ? t : [t];
}
function Vh(t, e) {
  return t && t[e] ? {
    ...t,
    ...t[e]
  } : {
    ...t
  };
}
const Ch = t => typeof t == "number", Mh = t => t.every(Ch);
function Dh(t) {
  const e = {
      presenceContext: null,
      props: {},
      visualState: {
        renderState: {
          transform: {},
          transformOrigin: {},
          style: {},
          vars: {},
          attrs: {}
        },
        latestValues: {}
      }
    },
    n = Ae(t) && !To(t) ? new jo(e) : new Lo(e);
  n.mount(t), $t.set(t, n);
}
function Eh(t) {
  const e = {
      presenceContext: null,
      props: {},
      visualState: {
        renderState: {
          output: {}
        },
        latestValues: {}
      }
    },
    n = new tu(e);
  n.mount(t), $t.set(t, n);
}
function Rh(t, e) {
  return F(t) || typeof t == "number" || typeof t == "string" && !zn(e);
}
function gr(t, e, n, s) {
  const i = [];
  if (Rh(t, e)) i.push(Ho(t, zn(e) && e.default || e, n && (n.default || n)));else {
    if (t == null) return i;
    const r = mr(t, e, s),
      o = r.length;
    for (let a = 0; a < o; a++) {
      const l = r[a],
        c = l instanceof Element ? Dh : Eh;
      $t.has(l) || c(l);
      const u = $t.get(l),
        h = {
          ...n
        };
      "delay" in h && typeof h.delay == "function" && (h.delay = h.delay(a, o)), i.push(...kn(u, {
        ...e,
        transition: h
      }, {}));
    }
  }
  return i;
}
function Lh(t, e, n) {
  const s = [],
    i = t.map(o => {
      if (Array.isArray(o) && typeof o[0] == "function") {
        const a = o[0],
          l = ht(0);
        return l.on("change", a), o.length === 1 ? [l, [0, 1]] : o.length === 2 ? [l, [0, 1], o[1]] : [l, o[1], o[2]];
      }
      return o;
    });
  return Ah(i, e, n, {
    spring: Kt
  }).forEach(({
    keyframes: o,
    transition: a
  }, l) => {
    s.push(...gr(l, o, a));
  }), s;
}
function kh(t) {
  return Array.isArray(t) && t.some(Array.isArray);
}
function Ih(t = {}) {
  const {
    scope: e,
    reduceMotion: n
  } = t;
  function s(i, r, o) {
    let a = [],
      l;
    if (kh(i)) {
      const {
        onComplete: u,
        ...h
      } = r || {};
      typeof u == "function" && (l = u), a = Lh(i, n !== void 0 ? {
        reduceMotion: n,
        ...h
      } : h, e);
    } else {
      const {
        onComplete: u,
        ...h
      } = o || {};
      typeof u == "function" && (l = u), a = gr(i, r, n !== void 0 ? {
        reduceMotion: n,
        ...h
      } : h, e);
    }
    const c = new Ga(a);
    return l && c.finished.then(l), e && (e.animations.push(c), c.finished.then(() => {
      At(e.animations, c);
    })), c;
  }
  return s;
}
const $h = Ih();
export { Gh as e, fr as d, Yt as c, $h as a, Wh as m, Oh as A };
