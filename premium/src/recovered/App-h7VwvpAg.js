// Recovered declaration closure; runtime React and translations come from the host app.
import { j as e } from "./data-runtime.js";
import { o as jc } from "./icon-vendor-B3WjWc6h.js";
import { V as Jv } from "./icon-vendor-B3WjWc6h.js";
import { a8 as Ka } from "./icon-vendor-B3WjWc6h.js";
import { ar as Qv } from "./icon-vendor-B3WjWc6h.js";
import { r as o } from "./data-runtime.js";
import { cf as ia } from "./icon-vendor-B3WjWc6h.js";
import { bB as on } from "./icon-vendor-B3WjWc6h.js";
import { ae as Xs } from "./icon-vendor-B3WjWc6h.js";
import { c5 as eu } from "./icon-vendor-B3WjWc6h.js";
import { J as YS } from "./icon-vendor-B3WjWc6h.js";
import { L as XS } from "./icon-vendor-B3WjWc6h.js";
import { D as Wn } from "./icon-vendor-B3WjWc6h.js";
import { ce as KS } from "./icon-vendor-B3WjWc6h.js";
import { R as qS } from "./icon-vendor-B3WjWc6h.js";
import { z as Bt } from "./icon-vendor-B3WjWc6h.js";
import { $ as or } from "./icon-vendor-B3WjWc6h.js";
import { e as Ft } from "./animation-vendor-BV2z4HNJ.js";
import { u as Gt } from "./useResolvedTheme-1s5qaJ9g.js";
import { R as yt } from "./data-runtime.js";
import { d as ac } from "./animation-vendor-BV2z4HNJ.js";
import { c as $S } from "./animation-vendor-BV2z4HNJ.js";
import { a as Vr } from "./animation-vendor-BV2z4HNJ.js";
import { m as q } from "./animation-vendor-BV2z4HNJ.js";
import { h as Qd } from "./icon-vendor-B3WjWc6h.js";
import { M as GS } from "./icon-vendor-B3WjWc6h.js";
import { e as Zn } from "./icon-vendor-B3WjWc6h.js";
import { cu as Kt } from "./icon-vendor-B3WjWc6h.js";
import { q as Lo } from "./icon-vendor-B3WjWc6h.js";
import { bn as ew } from "./icon-vendor-B3WjWc6h.js";
import { I as Wt } from "./icon-vendor-B3WjWc6h.js";
import { bZ as ei } from "./icon-vendor-B3WjWc6h.js";
import { aE as Os } from "./icon-vendor-B3WjWc6h.js";
import { A as St } from "./animation-vendor-BV2z4HNJ.js";
import { h as wx } from "./useResolvedTheme-1s5qaJ9g.js";
const H3 = 40, G3 = 6, _x = 20, Uo = t => Math.min(1, Math.max(0, t)), Iw = t => t * t * (3 - 2 * t);
function Xf(t) {
  return Iw(Uo(t / .45));
}
function K3(t) {
  return Iw(Uo((t - .3) / .7));
}
function Nc(t, n) {
  const s = Xf(t),
    a = K3(t),
    r = n.top + (n.slotY - n.top) * a,
    i = n.bottom + (n.slotY - n.bottom) * s;
  return {
    top: r,
    bottom: Math.max(i, r)
  };
}
function cu(t, n, s) {
  const a = n.width / 2,
    r = H3 / 2,
    i = Uo((s - n.top) / Math.max(1, n.slotY - n.top)),
    c = V3(Uo((i - .1) / .9)),
    l = a + (r - a) * c;
  return a + (l - a) * Xf(t);
}
const q3 = .55;
function V3(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const n = q3,
    s = c => 3 * (1 - c) * (1 - c) * c * n + 3 * (1 - c) * c * c * (1 - n) + c * c * c;
  let a = 0,
    r = 1;
  for (let c = 0; c < 24; c++) {
    const l = (a + r) / 2;
    s(l) < t ? a = l : r = l;
  }
  const i = (a + r) / 2;
  return 3 * (1 - i) * i * i + i * i * i;
}
function Zf(t) {
  return t < .9 ? 1 : Uo((1 - t) / .1);
}
const Y3 = 6;
function Mw(t, n) {
  const {
      bottom: s
    } = Nc(t, n),
    a = n.width / 2 - cu(t, n, s);
  return Math.min(1 - Xf(t), Uo(1 - a / Y3));
}
function X3(t, n) {
  if (t <= .001 || !n || n.width <= 0 || n.bottom <= n.top) return {
    transform: "none",
    clipPath: "none",
    opacity: 1
  };
  const s = n.bottom - n.top,
    {
      top: a,
      bottom: r
    } = Nc(t, n),
    i = Math.max(r - a, .5),
    c = i / s,
    l = [],
    d = [];
  for (let p = 0; p <= _x; p++) {
    const h = p / _x,
      m = cu(t, n, a + h * i) / n.width * 100,
      u = (h * 100).toFixed(2);
    l.push(`${(50 + m).toFixed(2)}% ${u}%`), d.unshift(`${(50 - m).toFixed(2)}% ${u}%`);
  }
  return {
    transform: `translateY(${(a - n.top).toFixed(2)}px) scaleY(${c.toFixed(4)})`,
    clipPath: `polygon(${l.concat(d).join(", ")})`,
    opacity: Zf(t)
  };
}
function Z3(t, n, s) {
  const [[a, r], [i, c], [l, d], [p, h]] = s,
    f = i - l,
    m = p - l,
    u = a - i + l - p,
    g = c - d,
    v = h - d,
    y = r - c + d - h;
  let b, k, x, j, w, C, S, A;
  if (Math.abs(u) < 1e-9 && Math.abs(y) < 1e-9) b = i - a, k = l - i, x = a, j = c - r, w = d - c, C = r, S = 0, A = 0;else {
    const E = f * v - m * g;
    S = (u * v - m * y) / E, A = (f * y - u * g) / E, b = i - a + S * i, k = p - a + A * p, x = a, j = c - r + S * c, w = h - r + A * h, C = r;
  }
  return `matrix3d(${[b / t, j / t, 0, S / t, k / n, w / n, 0, A / n, 0, 0, 1, 0, x, C, 0, 1].map(E => +E.toPrecision(10)).join(",")})`;
}
const Rx = 2;
function Px(t, n) {
  const s = Math.max(2, Math.round(t / n)),
    a = [];
  for (let r = 0; r < t; r += s) a.push([r, Math.min(t, r + s)]);
  return a;
}
function _w(t, n, s) {
  const a = n.width,
    r = n.bottom - n.top,
    {
      top: i,
      bottom: c
    } = Nc(t, n),
    l = Math.max(c - i, .5),
    d = a / 2;
  return s.map(([p, h]) => {
    const f = i + p / r * l,
      m = i + h / r * l,
      u = cu(t, n, f),
      g = cu(t, n, m),
      v = f - (n.top + p),
      y = m - (n.top + p);
    return Z3(a, h - p, [[d - u, v], [d + u, v], [d + g, y], [d - g, y]]);
  });
}
function J3(t, n, s, a, r, i, c = 120) {
  const l = Math.max(2, Math.ceil(a / 1e3 * c) + 1),
    d = [],
    p = i.map(() => []),
    h = [],
    f = [],
    m = [],
    u = r.bottom - r.top;
  for (let g = 0; g < l; g++) {
    const v = g / (l - 1),
      y = t + (n - t) * s(v);
    d.push(v), _w(y, r, i).forEach((j, w) => p[w].push(j)), h.push(Zf(y));
    const {
        top: b,
        bottom: k
      } = Nc(y, r),
      x = Math.max(k - b, .5) / u;
    f.push(`translateY(${(b - r.top).toFixed(2)}px) scaleY(${x.toFixed(4)})`), m.push(Mw(y, r));
  }
  return {
    offsets: d,
    bands: p,
    layerOpacity: h,
    shadowTransform: f,
    shadowOpacity: m
  };
}
const Q3 = "cubic-bezier(0.23, 1, 0.32, 1)", Ci = {
    hidden: {
        transform: "translateY(14px) scale(0.985)",
        opacity: "0",
        filter: "blur(6px)"
    },
    shown: {
        transform: "translateY(0px) scale(1)",
        opacity: "1",
        filter: "blur(0px)"
    },
    closed: {
        transform: "translateY(8px) scale(0.99)",
        opacity: "0",
        filter: "blur(4px)"
    },
    open: {
        transform: 640,
        opacity: 440,
        filter: 520,
        dim: 560
    },
    close: {
        transform: 360,
        opacity: 320,
        filter: 320,
        dim: 360
    }
}, Bl = ["transform", "opacity", "filter"];
function Rw(t) {
  return Math.max(...Bl.map(n => Ci[t][n]));
}
function Lx(t, n) {
  return Pw(t, n, {
    id: "lift",
    ease: Q3,
    hidden: Ci.hidden,
    shown: Ci.shown,
    closed: Ci.closed,
    ms: Ci[n]
  });
}
function Pw(t, n, {
  id: s,
  ease: a,
  hidden: r,
  shown: i,
  closed: c,
  ms: l
}) {
  const d = t.getAnimations().filter(u => u.id === s);
  let p;
  if (d.length) {
    for (const u of d) {
      try {
        u.commitStyles();
      } catch {}
      u.cancel();
    }
    p = {};
    for (const u of Bl) p[u] = t.style[u] || i[u];
  } else p = n === "open" ? r : i;
  const h = n === "open" ? i : c,
    f = Bl.map(u => {
      const g = t.animate([{
        [u]: p[u]
      }, {
        [u]: h[u]
      }], {
        duration: l[u],
        easing: typeof a == "string" ? a : a[u],
        fill: "both"
      });
      return g.id = s, g;
    });
  let m = !1;
  return n === "open" && Promise.all(f.map(u => u.finished)).then(() => {
    if (!m) {
      for (const u of f) u.cancel();
      for (const u of Bl) t.style[u] = "";
    }
  }, () => {}), () => {
    m = !0;
    for (const u of f) u.cancel();
  };
}
const xp = "cubic-bezier(0.33, 1, 0.68, 1)", e4 = "cubic-bezier(0.4, 0.2, 1, 0.8)", $x = "cubic-bezier(0.7, 0, 1, 1)", du = {
    away: {
        opacity: "0",
        filter: "blur(2px)"
    },
    shown: {
        transform: "translateX(0px)",
        opacity: "1",
        filter: "blur(0px)"
    },
    open: {
        transform: 500,
        opacity: 250,
        filter: 350
    },
    close: {
        transform: 400,
        opacity: 400,
        filter: 400
    }
}, t4 = {
    open: {
        transform: xp,
        opacity: xp,
        filter: xp
    },
    close: {
        transform: e4,
        opacity: $x,
        filter: $x
    }
};
function Lw(t) {
  return Math.max(...Bl.map(n => du[t][n]));
}
function n4(t) {
  return {
    ...du.away,
    transform: `translateX(${Math.max(0, Math.ceil(t))}px)`
  };
}
function Dx(t, n, s) {
  const a = n4(s);
  return Pw(t, n, {
    id: "slide",
    ease: t4[n],
    hidden: a,
    shown: du.shown,
    closed: a,
    ms: du[n]
  });
}
const Jf = "natively_genie_animation";
function $w() {
  try {
    return localStorage.getItem(Jf) !== "off";
  } catch {
    return !0;
  }
}
let hh = $w();
const fh = new Set();
function s4() {
  return hh;
}
function r4(t) {
  return fh.add(t), () => {
    fh.delete(t);
  };
}
function Qf() {
  return o.useSyncExternalStore(r4, s4, () => !0);
}
const uu = [.23, 1, .32, 1], Dw = [.33, 0, .67, 1], bp = {
    duration: .65,
    ease: Dw
}, Tl = {
    duration: .6,
    ease: Dw
}, o4 = 48, l4 = 8, c4 = 120, d4 = 160, u4 = 900, p4 = 150, m4 = 120, yp = {
    duration: .15,
    ease: "linear"
}, h4 = .25, Ox = .3, f4 = {
    duration: Rw("open") / 1e3,
    ease: "linear"
}, g4 = {
    duration: Rw("close") / 1e3,
    ease: "linear"
}, x4 = {
    duration: Ci.open.dim / 1e3,
    ease: uu
}, b4 = {
    duration: Ci.close.dim / 1e3,
    ease: uu
}, y4 = {
    duration: Lw("open") / 1e3,
    ease: "linear"
}, zx = {
    duration: Lw("close") / 1e3,
    ease: "linear"
}, v4 = 900, Fx = t => Array.isArray(t.ease) ? $S(...t.ease) : n => n, Bc = () => Number(document.timeline?.currentTime ?? performance.now());
function w4(t, n, s = {}) {
  const a = Qf(),
    i = Ft() ?? !1 ? "fade" : a ? "genie" : "lift",
    c = i !== "genie",
    l = s.motion === "slide" && i !== "fade" ? "slide" : i,
    d = o.useRef(l);
  d.current = l;
  const p = o.useRef(l),
    h = s.bands ?? o4,
    f = o.useRef(s.onOpened);
  f.current = s.onOpened;
  const m = o.useRef(s.snapshots);
  m.current = s.snapshots;
  const [u, g] = o.useState(!1),
    [v, y] = o.useState(!1),
    b = o.useRef(null),
    k = t && !v,
    x = ac(1),
    j = ac(0),
    w = o.useRef(null),
    C = o.useRef(null),
    S = o.useRef(null),
    A = o.useRef(null),
    M = o.useRef(null),
    E = o.useRef(null),
    T = o.useRef(!1),
    N = o.useRef(null),
    _ = o.useRef(null),
    P = o.useRef(null),
    z = o.useRef([]),
    O = o.useRef(new WeakMap()),
    B = () => {
      const G = w.current;
      return G ? window.innerWidth - G.getBoundingClientRect().left : 0;
    },
    V = () => {
      const G = w.current?.getBoundingClientRect();
      M.current = G && G.width > 0 ? {
        top: G.top,
        bottom: G.bottom,
        width: G.width,
        slotY: window.innerHeight - G3
      } : null;
    },
    pe = () => {
      const G = N.current;
      if (!G) return x.get();
      const ke = Math.min(1, Math.max(0, (Bc() - G.start) / G.durationMs));
      return G.from + (G.to - G.from) * G.ease(ke);
    },
    xe = () => {
      z.current.forEach(G => G.cancel()), z.current = [];
    },
    U = () => {
      xe();
      const G = N.current,
        ke = M.current,
        Re = E.current,
        re = S.current,
        Te = A.current;
      if (!(!G || !ke || !Re || !re || !Te || typeof re.animate != "function")) try {
        const be = J3(G.from, G.to, G.ease, G.durationMs, ke, Re),
          Y = {
            duration: G.durationMs,
            fill: "both"
          },
          X = (we, Se) => we.map((Ue, He) => ({
            ...Se(Ue),
            offset: be.offsets[He]
          })),
          Ne = [];
        be.bands.forEach((we, Se) => {
          const Ue = re.children[Se];
          Ue && Ne.push(Ue.animate(X(we, He => ({
            transform: He
          })), Y));
        }), Ne.push(re.animate(X(be.layerOpacity, we => ({
          opacity: String(we)
        })), Y)), Te.style.display = "block", Ne.push(Te.animate(X(be.shadowTransform.map((we, Se) => [we, be.shadowOpacity[Se]]), ([we, Se]) => ({
          transform: we,
          opacity: String(Se)
        })), Y)), G.anchored ? Ne.forEach(we => {
          we.startTime = G.start;
        }) : requestAnimationFrame(() => {
          N.current !== G || z.current !== Ne || (G.start = Bc(), G.anchored = !0, Ne.forEach(we => {
            we.startTime = G.start;
          }));
        }), z.current = Ne;
      } catch (be) {
        console.warn(`[${n}] genie compositor track unavailable:`, be), xe();
      }
    },
    H = G => {
      const ke = C.current,
        Re = S.current,
        re = M.current;
      if (!ke || !Re || !re) return !1;
      const Te = Math.round(re.bottom - re.top),
        be = Math.min(c4, Math.max(12, Math.ceil(Te / l4))),
        Y = Px(Te, be),
        X = parseFloat(getComputedStyle(ke).borderTopLeftRadius) || 0,
        Ne = document.createDocumentFragment();
      return Y.forEach(([we, Se], Ue) => {
        const He = document.createElement("div");
        He.className = "genie-band";
        const ft = Se - we + (Ue < Y.length - 1 ? Rx : 0);
        He.style.cssText = `position:absolute;left:0;width:100%;top:${we}px;height:${ft}px;overflow:hidden;transform-origin:0 0;will-change:transform;`, He.appendChild(Wx(G, we, ft, Te, X)), Ne.appendChild(He);
      }), Re.replaceChildren(Ne), E.current = Y, U(), !0;
    },
    Z = () => {
      const G = _.current;
      _.current = null, G?.transient && G.bitmap.close();
    },
    ie = () => {
      P.current?.cancel(), P.current = null;
    },
    ne = G => {
      const ke = S.current,
        Re = C.current;
      if (!ke || !Re) return;
      ie();
      const re = Re.getBoundingClientRect().height,
        Te = Wx(G, 0, re, re, parseFloat(getComputedStyle(Re).borderTopLeftRadius) || 0);
      Te.style.inset = "0", ke.style.opacity = "1", ke.replaceChildren(Te);
      const be = performance.now();
      let Y = be;
      const X = new MutationObserver(() => {
        Y = performance.now();
      });
      X.observe(Re, {
        subtree: !0,
        childList: !0,
        characterData: !0,
        attributes: !0,
        attributeFilter: ["class"]
      });
      let Ne = 0,
        we = null;
      const Se = () => {
          cancelAnimationFrame(Ne), X.disconnect(), we?.cancel(), Te.isConnected && Te.remove();
        },
        Ue = () => {
          const He = performance.now();
          if (!((m.current?.settled() ?? !0) && He - Y >= p4) && He - be < u4) {
            Ne = requestAnimationFrame(Ue);
            return;
          }
          X.disconnect(), we = Te.animate([{
            opacity: 1
          }, {
            opacity: 0
          }], {
            duration: m4,
            easing: "ease-out",
            fill: "forwards"
          }), we.finished.then(() => {
            P.current?.el === Te && (P.current = null), Te.remove();
          }).catch(() => {});
        };
      P.current = {
        el: Te,
        cancel: Se
      }, Ue();
    },
    D = () => {
      if (_.current) return H(_.current);
      const G = C.current,
        ke = S.current,
        Re = M.current;
      if (!G || !ke || !Re) return !1;
      try {
        const re = h,
          Te = Math.round(Re.bottom - Re.top),
          be = Px(Te, re),
          Y = j4(G),
          X = Array.from(G.querySelectorAll("canvas")),
          Ne = document.createDocumentFragment(),
          we = [];
        if (be.forEach(([Se, Ue], He) => {
          const ft = document.createElement("div");
          ft.style.cssText = `position:absolute;left:0;width:100%;top:${Se}px;height:${Ue - Se + (He < be.length - 1 ? Rx : 0)}px;overflow:hidden;transform-origin:0 0;will-change:transform;`;
          const it = G.cloneNode(!0);
          S4(it);
          const ze = `;position:absolute;left:0;top:${-Se}px;width:100%;height:${Te}px;visibility:visible;transform:none;clip-path:none;opacity:1;box-shadow:none;`;
          O.current.set(it, ze), it.style.cssText += ze, it.querySelectorAll("canvas").forEach((at, gt) => {
            try {
              at.getContext("2d")?.drawImage(X[gt], 0, 0);
            } catch {}
          }), ft.appendChild(it), Ne.appendChild(ft), we.push(it);
        }), ke.replaceChildren(Ne), Y.length) for (const Se of we) for (const {
          path: Ue,
          top: He,
          left: ft
        } of Y) {
          const it = k4(Se, Ue);
          it && (it.scrollTop = He, it.scrollLeft = ft);
        }
        return E.current = be, U(), !0;
      } catch (re) {
        return console.warn(`[${n}] genie bands unavailable, using the outline genie:`, re), ke.replaceChildren(), E.current = null, !1;
      }
    },
    ue = () => {
      xe(), S.current?.replaceChildren(), E.current = null;
    },
    me = o.useCallback(G => {
      const ke = C.current,
        Re = S.current,
        re = A.current;
      if (!ke || !Re || !re) return;
      const Te = M.current,
        be = p.current;
      if (be === "fade") {
        ke.style.opacity = String(1 - G);
        return;
      }
      if (be === "lift" || be === "slide") return;
      const Y = !N.current || N.current.to === 0;
      if (G <= .001 && Y || !Te) {
        const He = E.current && _.current;
        ue(), He && _.current && ne(_.current), ke.style.visibility = "", ke.style.transform = ke.style.clipPath = "", ke.style.opacity = "1", re.style.display = "none";
        return;
      }
      !E.current && !T.current && (T.current = !D());
      const X = E.current,
        Ne = X !== null && z.current.length > 0;
      if (X) {
        if (ke.style.visibility = "hidden", ke.style.opacity = "0", !Ne) {
          Re.style.opacity = String(Zf(G));
          const He = _w(G, Te, X),
            ft = Re.children;
          for (let it = 0; it < He.length; it++) ft[it].style.transform = He[it];
        }
      } else {
        const He = X3(G, Te);
        ke.style.transform = He.transform, ke.style.clipPath = He.clipPath, ke.style.opacity = String(He.opacity);
      }
      if (Ne) return;
      const {
          top: we,
          bottom: Se
        } = Nc(G, Te),
        Ue = Math.max(Se - we, .5) / (Te.bottom - Te.top);
      re.style.display = "block", re.style.transform = `translateY(${(we - Te.top).toFixed(2)}px) scaleY(${Ue.toFixed(4)})`, re.style.opacity = String(Mw(G, Te));
    }, [h]);
  o.useEffect(() => x.on("change", me), [x, me]), o.useLayoutEffect(() => {
    if (!k) return;
    const G = p.current = d.current,
      ke = G !== "genie";
    V(), T.current = !1, ie(), Z(), _.current = ke ? null : m.current?.forOpen() ?? null, m.current && !_.current && (T.current = !0), N.current = ke ? null : {
      from: 1,
      to: 0,
      durationMs: bp.duration * 1e3,
      ease: Fx(bp),
      start: Bc()
    }, x.set(1), me(1), j.set(0);
    const Re = C.current;
    G === "lift" && Re && Lx(Re, "open"), G === "slide" && Re && Dx(Re, "open", B());
    const re = G === "slide" ? Vr(x, 0, y4) : Vr(x, 0, G === "genie" ? bp : G === "fade" ? yp : f4),
      Te = Vr(j, 1, G === "lift" ? x4 : {
        duration: h4,
        ease: uu
      });
    let be = !0;
    return re.then(() => {
      be && f.current?.();
    }), () => {
      be = !1, re.stop(), Te.stop(), ue(), ie(), N.current = null;
    };
  }, [k, x, j, me]);
  const ye = o.useCallback(G => {
      b.current || (b.current = G, g(!0));
    }, []),
    Ae = o.useCallback(() => {
      const G = b.current;
      b.current = null, G?.();
    }, []);
  return o.useEffect(() => {
    if (!u) return;
    const G = p.current = x.get() <= .001 ? d.current : p.current,
      ke = G !== "genie";
    let Re = !1,
      re = null;
    const Te = X => {
      x.get() <= .001 && (V(), ue(), T.current = X);
      const Ne = pe();
      Math.abs(Ne - x.get()) > .001 && x.set(Ne), N.current = ke ? null : {
        from: Ne,
        to: 1,
        durationMs: Tl.duration * 1e3,
        ease: Fx(Tl),
        start: Bc()
      }, !ke && !E.current && !T.current ? T.current = !D() : E.current && U(), !ke && E.current && me(Ne);
      const we = C.current;
      G === "lift" && we && Lx(we, "close"), G === "slide" && we && Dx(we, "close", B());
      const Se = G === "slide" ? Vr(x, 1, zx) : Vr(x, 1, G === "genie" ? Tl : G === "fade" ? yp : g4),
        Ue = Vr(j, 0, G === "genie" ? {
          duration: Ox,
          delay: Tl.duration - Ox,
          ease: uu
        } : G === "slide" ? zx : G === "fade" ? yp : b4);
      let He = !0;
      Promise.all([Se, Ue]).then(() => {
        He && (y(!0), Ae());
      });
      const ft = setTimeout(Ae, v4);
      re = () => {
        He = !1, clearTimeout(ft), Se.stop(), Ue.stop(), xe(), N.current = null;
      };
    };
    ie();
    const be = m.current,
      Y = x.get() <= .001 && !E.current;
    if (be && Y && !ke) {
      const X = be.forClose().catch(() => null),
        Ne = new Promise(we => setTimeout(() => we(null), d4));
      Promise.race([X, Ne]).then(we => {
        Re || (Z(), _.current = we, Te(!we), we || X.then(Se => {
          Se?.transient && Se.bitmap.close();
        }));
      });
    } else Y && Z(), Te(!1);
    return () => {
      Re = !0, re?.();
    };
  }, [u, x, j, Ae, me]), o.useEffect(() => {
    t || (g(!1), y(!1), b.current = null, ie(), Z());
  }, [t]), {
    shown: k,
    closing: u,
    closeThen: ye,
    scrim: j,
    wrapRef: w,
    cardRef: C,
    bandsRef: S,
    shadowRef: A,
    reduced: c
  };
}
function Wx(t, n, s, a, r) {
  const {
      bitmap: i
    } = t,
    c = i.height / a,
    l = document.createElement("canvas");
  l.width = i.width, l.height = Math.max(1, Math.round(s * c)), l.style.cssText = `position:absolute;left:0;top:0;width:100%;height:${s}px;`;
  const d = l.getContext("2d");
  if (d) {
    const p = -Math.round(n * c);
    d.save(), d.beginPath(), typeof d.roundRect == "function" ? d.roundRect(0, p, i.width, i.height, r * c) : d.rect(0, p, i.width, i.height), d.clip(), d.drawImage(i, 0, p), d.restore();
  }
  return l;
}
function j4(t) {
  const n = [],
    s = (a, r) => {
      (a.scrollTop || a.scrollLeft) && n.push({
        path: r,
        top: a.scrollTop,
        left: a.scrollLeft
      });
      for (let i = 0; i < a.children.length; i++) s(a.children[i], [...r, i]);
    };
  return s(t, []), n;
}
function k4(t, n) {
  let s = t;
  for (const a of n) if (s = s?.children[a] ?? null, !s) return null;
  return s;
}
function S4(t) {
  t.removeAttribute("role"), t.removeAttribute("aria-modal"), t.removeAttribute("aria-labelledby"), t.removeAttribute("aria-describedby"), t.removeAttribute("id"), t.removeAttribute("data-testid"), t.removeAttribute("inert"), t.querySelectorAll("[id]").forEach(n => n.removeAttribute("id")), t.querySelectorAll("[data-testid]").forEach(n => n.removeAttribute("data-testid")), t.querySelectorAll("[name]").forEach(n => n.removeAttribute("name")), t.querySelectorAll("iframe, webview, video, audio").forEach(n => {
    const s = document.createElement("div");
    s.className = n.className, s.style.cssText = n.style.cssText, n.replaceWith(s);
  }), t.querySelectorAll("[style]").forEach(n => {
    n.style.willChange = "auto", n.style.filter === "blur(0px)" && (n.style.filter = "");
  });
}
const xh = () => typeof window < "u" ? window.electronAPI : void 0, Ow = 64 * 1024 * 1024, Ba = new Map();
let Il = null, Ai = 0;
const Bx = t => t.bitmap.width * t.bitmap.height * 4;
function N4(t) {
  const n = t.split("|"),
    s = /^(\d+)x(\d+)$/.exec(n[2] ?? ""),
    a = Number(n[n.length - 1]) || 1;
  return s ? Math.round(Number(s[1]) * a) * Math.round(Number(s[2]) * a) * 4 : 1 / 0;
}
function Uc(t) {
  const n = t.getAttribute("data-genie-view");
  return n || t.querySelector("[data-genie-view]")?.getAttribute("data-genie-view") || "default";
}
function zw() {
  const t = document.documentElement,
    n = t.getAttribute("data-theme") || (t.classList.contains("dark") ? "dark" : "light"),
    s = t.getAttribute("lang") || "en";
  return `${n}|${s}|${window.devicePixelRatio}`;
}
function C4(t, n, s, a) {
  return `${t}|${n}|${Math.round(s)}x${Math.round(a)}|${zw()}`;
}
async function Fw(t, n, s) {
  try {
    return {
      bitmap: await createImageBitmap(new Blob([t], {
        type: "image/png"
      })),
      width: n,
      height: s
    };
  } catch {
    return null;
  }
}
function Ww(t, n) {
  Ba.delete(t), Ba.set(t, n);
  let s = 0;
  for (const a of Ba.values()) s += Bx(a);
  for (const [a, r] of Ba) {
    if (s <= Ow || a === t) break;
    Ba.delete(a), s -= Bx(r);
  }
}
function A4() {
  if (Il) return Il;
  const t = Ai;
  return Il = new Promise(n => {
    const s = async () => {
        const r = xh();
        if (t !== Ai) {
          n();
          return;
        }
        try {
          const i = `|${zw()}`,
            c = ((await r?.genieSnapshotList?.()) ?? []).filter(p => p.endsWith(i)),
            l = [];
          let d = Ow;
          for (let p = c.length - 1; p >= 0; p--) {
            const h = N4(c[p]);
            if (h > d) break;
            d -= h, l.unshift(c[p]);
          }
          for (const p of l) {
            if (t !== Ai) break;
            if (Ba.has(p)) continue;
            const h = await r?.genieSnapshotLoad?.(p),
              f = /\|(\d+)x(\d+)\|/.exec(p);
            if (!h || !f) continue;
            const m = await Fw(h, Number(f[1]), Number(f[2]));
            m && t === Ai && !Ba.has(p) && Ww(p, m);
          }
        } catch {}
        n();
      },
      a = window.requestIdleCallback;
    a ? a(() => {
      s();
    }, {
      timeout: 2e3
    }) : setTimeout(() => {
      s();
    }, 300);
  }), Il;
}
function E4() {
  Ai++, Ba.clear(), Il = null;
}
function T4(t) {
  const n = Ba.get(t);
  return n ? (Ba.delete(t), Ba.set(t, n), n) : null;
}
const Ux = '[aria-busy="true"], [role="progressbar"], .animate-spin, .animate-pulse';
function vp(t) {
  return document.visibilityState !== "visible" || t.matches(Ux) || t.querySelector(Ux) || typeof t.getAnimations == "function" && t.getAnimations({
    subtree: !0
  }).some(s => s.playState === "running" && s.effect?.getTiming?.().iterations !== 1 / 0) ? !1 : M4(t);
}
const I4 = 'button, a[href], input, select, textarea, label, summary, [role="button"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"]';
function Hx(t) {
  if (t.querySelector(":focus-visible")) return !0;
  const n = t.querySelectorAll(":hover"),
    s = n[n.length - 1]?.closest(I4);
  return !!s && s !== t && t.contains(s);
}
function Gx(t) {
  const n = s => {
    if (s.scrollTop > 0 || s.scrollLeft > 0) return !0;
    for (let a = 0; a < s.children.length; a++) if (n(s.children[a])) return !0;
    return !1;
  };
  return n(t);
}
function M4(t) {
  const n = t.getBoundingClientRect();
  return n.width < 8 || n.height < 8 ? !1 : [[.5, .5], [.15, .15], [.85, .15], [.15, .85], [.85, .85]].every(([a, r]) => {
    const i = document.elementFromPoint(n.left + n.width * a, n.top + n.height * r);
    return !!i && (i === t || t.contains(i));
  });
}
async function Kx(t, n) {
  const s = xh()?.genieSnapshotCapture;
  if (!s || document.visibilityState !== "visible") return null;
  const a = Ai,
    r = t.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return null;
  let i;
  try {
    i = await s({
      x: r.left,
      y: r.top,
      width: r.width,
      height: r.height
    });
  } catch {
    return null;
  }
  if (!i?.png?.length) return null;
  const c = await Fw(i.png, r.width, r.height);
  return c ? n ? a !== Ai ? {
    ...c,
    transient: !0
  } : (Ww(n, c), xh()?.genieSnapshotSave?.(n, i.png)?.catch?.(() => {}), c) : {
    ...c,
    transient: !0
  } : null;
}
function _4(t) {
  return {
    mounted: t,
    closing: !1
  };
}
function R4(t, n) {
  switch (n) {
    case "open":
      return t.mounted ? t : {
        mounted: !0,
        closing: !1
      };
    case "close":
      return t.mounted && !t.closing ? {
        mounted: !0,
        closing: !0
      } : t;
    case "closed":
      return t.mounted ? {
        mounted: !1,
        closing: !1
      } : t;
    default:
      return t;
  }
}
function P4(t, n) {
  return n && !t.mounted ? "open" : !n && t.mounted && !t.closing ? "close" : null;
}
const qx = 350, L4 = 1200, Bw = "natively_genie_opening_views_v1", Uw = () => {
    try {
        return JSON.parse(localStorage.getItem(Bw) || "{}") || {};
    }
    catch {
        return {};
    }
}, $4 = t => Uw()[t], D4 = (t, n) => {
    try {
        localStorage.setItem(Bw, JSON.stringify({
            ...Uw(),
            [t]: n
        }));
    }
    catch { }
}, hs = ({ open: t, label: n, children: s, onBackdropClick: a, onOpened: r, onClosed: i, closeInstantly: c = !1, zIndex: l = 300, snapshotKey: d, openingView: p, snapshotPaused: h = !1, keepPictures: f = !0, modal: m = !0, placement: u = "center", backdropId: g, backdropClassName: v, backdropStyle: y, padding: b, wrapClassName: k, wrapStyle: x, cardRef: j, cardClassName: w, cardStyle: C, cardProps: S, shadow: A, radius: M }) => {
    const [E, T] = o.useReducer(R4, t, _4), N = d ?? n, _ = o.useRef(null), P = o.useRef(h);
    P.current = h;
    const z = o.useRef(f);
    z.current = f;
    const O = o.useRef(p);
    O.current = p;
    const B = o.useRef(!1), V = o.useRef(null), pe = o.useRef(null), xe = o.useRef(!0), U = o.useCallback(Y => {
        const X = _.current?.wrapRef.current;
        if (!X)
            return null;
        const Ne = X.getBoundingClientRect();
        return Ne.width > 0 ? C4(N, Y, Ne.width, Ne.height) : null;
    }, [N]), H = o.useMemo(() => ({
        forOpen: () => {
            const Y = _.current?.cardRef.current;
            if (!Y || !z.current)
                return null;
            const X = O.current ?? $4(N) ?? Uc(Y), Ne = U(X);
            return Ne ? T4(Ne) : null;
        },
        forClose: async () => {
            const Y = _.current?.cardRef.current;
            if (!Y || P.current)
                return null;
            const X = pe.current;
            return z.current && X && !xe.current && X.key === U(Uc(Y)) ? X.snap : Kx(Y, V.current);
        },
        settled: () => {
            const Y = _.current?.cardRef.current;
            return !Y || vp(Y);
        }
    }), [N, U]), Z = w4(E.mounted, n, {
        snapshots: H,
        onOpened: () => {
            B.current = !0, r?.();
        },
        motion: u === "bottom-right" ? "slide" : void 0
    });
    _.current = Z;
    const { shown: ie, closing: ne, closeThen: D, scrim: ue, wrapRef: me, bandsRef: ye, shadowRef: Ae } = Z, G = Z.reduced;
    o.useEffect(() => {
        G ? (pe.current = null, E4()) : A4();
    }, [G]);
    const ke = o.useRef(c);
    ke.current = c;
    const Re = o.useRef(i);
    Re.current = i, o.useEffect(() => {
        const Y = P4(E, t);
        if (Y && (T(Y), Y === "open" && (B.current = !1), Y === "close")) {
            const X = _.current?.cardRef.current;
            V.current = X && z.current && !P.current && B.current && vp(X) && !Gx(X) && !Hx(X) ? U(Uc(X)) : null;
            const Ne = () => {
                T("closed"), Re.current?.();
            };
            ke.current ? Ne() : D(Ne);
        }
    }, [t, E, D, U]), o.useEffect(() => {
        if (!t || !ie || !f || G)
            return;
        const Y = _.current?.cardRef.current;
        if (!Y)
            return;
        let X, Ne = 0, we = !1, Se = !1;
        const Ue = ze => {
            clearTimeout(X), X = setTimeout(He, ze);
        }, He = async () => {
            if (Se)
                return;
            const ze = (_.current?.bandsRef.current?.childElementCount ?? 0) > 0;
            if (!B.current || ze || P.current || !vp(Y) || Hx(Y)) {
                Ue(400);
                return;
            }
            if (Gx(Y))
                return;
            const at = L4 - (performance.now() - Ne);
            if (Ne && at > 0) {
                Ue(at);
                return;
            }
            Ne = performance.now();
            const gt = Uc(Y), vt = U(gt);
            if (!vt)
                return;
            !we && O.current === void 0 && D4(N, gt), we = !0, xe.current = !1;
            const Ie = await Kx(Y, vt);
            Ie && !Se && (pe.current = {
                key: vt,
                snap: Ie
            });
        }, ft = () => {
            xe.current = !0, Ue(qx);
        }, it = new MutationObserver(ze => {
            ze.some(at => at.type !== "attributes" || at.target !== Y && at.attributeName !== "style") && ft();
        });
        return it.observe(Y, {
            subtree: !0,
            childList: !0,
            attributes: !0,
            characterData: !0
        }), Y.addEventListener("scroll", ft, !0), Y.addEventListener("input", ft, !0), xe.current = !0, pe.current = null, Ue(qx), () => {
            Se = !0, clearTimeout(X), it.disconnect(), Y.removeEventListener("scroll", ft, !0), Y.removeEventListener("input", ft, !0);
        };
    }, [t, ie, N, U, f, G]);
    const re = o.useRef(s);
    t && (re.current = s);
    const Te = t ? s : re.current, be = o.useCallback(Y => {
        Z.cardRef.current = Y, typeof j == "function" ? j(Y) : j && (j.current = Y);
    }, [Z.cardRef, j]);
    return ie ? e.jsxs(e.Fragment, {
        children: [m && e.jsx(q.div, {
                id: g,
                className: v,
                style: {
                    position: "fixed",
                    inset: 0,
                    zIndex: l,
                    ...y,
                    opacity: ue,
                    ...(ne ? {
                        pointerEvents: "none"
                    } : null)
                },
                onClick: Y => {
                    Y.target === Y.currentTarget && !ne && a?.();
                }
            }), e.jsx("div", {
                style: {
                    position: "fixed",
                    inset: 0,
                    zIndex: l,
                    display: "flex",
                    alignItems: u === "bottom-right" ? "flex-end" : "center",
                    justifyContent: u === "bottom-right" ? "flex-end" : "center",
                    padding: b,
                    pointerEvents: "none"
                },
                children: e.jsxs("div", {
                    ref: me,
                    className: k,
                    style: {
                        position: "relative",
                        pointerEvents: ne ? "none" : "auto",
                        ...x
                    },
                    children: [e.jsx("div", {
                            ref: Ae,
                            "aria-hidden": !0,
                            style: {
                                display: "none",
                                position: "absolute",
                                inset: 0,
                                borderRadius: M,
                                transformOrigin: "50% 0",
                                pointerEvents: "none",
                                boxShadow: A
                            }
                        }), e.jsx("div", {
                            ...S,
                            ref: be,
                            className: w,
                            style: {
                                position: "relative",
                                width: "100%",
                                height: "100%",
                                borderRadius: M,
                                overflow: "hidden",
                                transformOrigin: "50% 0%",
                                outline: "none",
                                ...C
                            },
                            ...(ne ? {
                                inert: !0
                            } : null),
                            children: Te
                        }), e.jsx("div", {
                            ref: ye,
                            "aria-hidden": !0,
                            inert: !0,
                            style: {
                                position: "absolute",
                                inset: 0,
                                pointerEvents: "none"
                            }
                        })]
                })
            })]
    }) : null;
};
function tg() {
  const t = o.useRef(null),
    n = o.useRef(0);
  return o.useEffect(() => () => cancelAnimationFrame(n.current), []), {
    ref: t,
    onPointerMove: r => {
      const {
        clientX: i,
        clientY: c
      } = r;
      n.current || (n.current = requestAnimationFrame(() => {
        n.current = 0;
        const l = t.current;
        if (!l) return;
        const d = l.getBoundingClientRect();
        if (!d.width || !d.height) return;
        const p = h => `${(h * 100).toFixed(1)}%`;
        l.style.setProperty("--lg-mx", p((i - d.left) / d.width)), l.style.setProperty("--lg-my", p((c - d.top) / d.height));
      }));
    },
    onFocus: () => {
      const r = t.current;
      if (r) {
        try {
          if (!r.matches(":focus-visible")) return;
        } catch {
          return;
        }
        cancelAnimationFrame(n.current), n.current = 0, r.style.removeProperty("--lg-mx"), r.style.removeProperty("--lg-my");
      }
    }
  };
}
const yn = ({ children: t, variant: n = "neutral", icon: s, className: a = "", type: r = "button", onPointerMove: i, onFocus: c, ...l }) => {
    const { ref: d, onPointerMove: p, onFocus: h } = tg();
    return e.jsxs("button", {
        ...l,
        ref: d,
        type: r,
        className: `lg-button lg-${n} ${a}`.trim(),
        onPointerMove: f => {
            p(f), i?.(f);
        },
        onFocus: f => {
            h(), c?.(f);
        },
        children: [e.jsx("span", {
                className: "lg-lens",
                "aria-hidden": "true"
            }), e.jsxs("span", {
                className: "lg-content",
                children: [s ? e.jsx("span", {
                        className: "lg-icon",
                        "aria-hidden": "true",
                        children: s
                    }) : null, e.jsx("span", {
                        className: "lg-label",
                        children: t
                    })]
            })]
    });
};
const QR = ({ profileData: t }) => {
    if (!t)
        return null;
    const { experience: n, projects: s, education: a } = t, r = n && n.length > 0, i = s && s.length > 0, c = a && a.length > 0;
    return !r && !i && !c ? null : e.jsxs("div", {
        className: "flex flex-col gap-6 mt-6 animated fadeIn",
        children: [r && e.jsxs("div", {
                className: "bg-bg-item-surface rounded-xl p-5 border border-border-subtle",
                children: [e.jsxs("div", {
                        className: "flex items-center gap-3 mb-6",
                        children: [e.jsx("div", {
                                className: "w-8 h-8 rounded-lg bg-green-500/10 text-green-500 border border-green-500/20 flex items-center justify-center",
                                children: e.jsx(jc, {
                                    size: 14
                                })
                            }), e.jsx("h3", {
                                className: "text-sm font-bold text-text-primary",
                                children: "Professional Timeline"
                            })]
                    }), e.jsx("div", {
                        className: "relative pl-6 space-y-10 before:absolute before:inset-0 before:ml-[31px] before:-translate-x-px before:h-full before:w-px before:bg-gradient-to-b before:from-border-muted before:to-transparent",
                        children: n.map((l, d) => e.jsxs("div", {
                            className: "relative flex gap-6 group",
                            children: [e.jsx("div", {
                                    className: "absolute left-[-29px] top-1.5 h-2 w-2 rounded-full border-[1.5px] border-text-tertiary bg-bg-item-surface group-hover:border-accent-primary group-hover:bg-accent-primary transition-colors z-10"
                                }), e.jsxs("div", {
                                    className: "flex-1 flex flex-col",
                                    children: [e.jsxs("div", {
                                            className: "flex flex-col mb-1.5",
                                            children: [e.jsxs("div", {
                                                    className: "flex items-center justify-between gap-4",
                                                    children: [e.jsx("h4", {
                                                            className: "text-[13px] font-semibold text-text-primary tracking-tight leading-snug group-hover:text-accent-primary transition-colors",
                                                            children: l.role
                                                        }), e.jsxs("div", {
                                                            className: "flex items-center gap-1.5 text-[10px] font-medium text-text-tertiary uppercase tracking-wider shrink-0",
                                                            children: [e.jsx("span", {
                                                                    children: l.start_date
                                                                }), e.jsx("span", {
                                                                    className: "text-text-muted",
                                                                    children: "—"
                                                                }), e.jsx("span", {
                                                                    children: l.end_date || "Present"
                                                                })]
                                                        })]
                                                }), e.jsx("div", {
                                                    className: "flex items-center gap-2 mt-0.5",
                                                    children: e.jsx("span", {
                                                        className: "text-[11px] font-medium text-text-secondary",
                                                        children: l.company
                                                    })
                                                })]
                                        }), l.bullets && l.bullets.length > 0 && e.jsx("ul", {
                                            className: "space-y-2 mt-2",
                                            children: l.bullets.map((p, h) => e.jsx("li", {
                                                className: "text-[11px] text-text-secondary leading-relaxed pl-3.5 relative before:absolute before:left-0 before:top-[7px] before:w-[3px] before:h-[3px] before:bg-border-muted before:rounded-full group-hover:before:bg-text-tertiary transition-colors",
                                                children: p
                                            }, h))
                                        })]
                                })]
                        }, d))
                    })]
            }), i && e.jsxs("div", {
                className: "bg-bg-item-surface rounded-xl p-5",
                children: [e.jsxs("div", {
                        className: "flex items-center gap-3 mb-5",
                        children: [e.jsx("div", {
                                className: "w-7 h-7 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center",
                                children: e.jsx(Jv, {
                                    size: 13
                                })
                            }), e.jsx("h3", {
                                className: "text-[13px] font-semibold text-text-primary tracking-tight",
                                children: "Featured Projects"
                            })]
                    }), e.jsx("div", {
                        className: "grid grid-cols-1 md:grid-cols-2 gap-3",
                        children: s.map((l, d) => e.jsxs("div", {
                            className: "h-[140px] p-4 rounded-xl bg-bg-input flex flex-col group transition-colors duration-200",
                            children: [e.jsxs("div", {
                                    className: "flex items-center justify-between mb-2",
                                    children: [e.jsx("h4", {
                                            className: "text-[12px] font-semibold text-text-primary tracking-tight line-clamp-1 pr-3",
                                            children: l.name
                                        }), l.url && e.jsx("a", {
                                            href: l.url,
                                            target: "_blank",
                                            rel: "noreferrer",
                                            className: "text-text-tertiary hover:text-text-primary transition-colors shrink-0 opacity-0 group-hover:opacity-100",
                                            children: e.jsx(Ka, {
                                                size: 12
                                            })
                                        })]
                                }), e.jsx("p", {
                                    className: "text-[10px] text-text-secondary line-clamp-2 leading-relaxed mb-3 flex-1",
                                    children: l.description
                                }), e.jsxs("div", {
                                    className: "flex flex-wrap gap-1 mt-auto",
                                    children: [l.technologies?.slice(0, 4).map((p, h) => e.jsx("span", {
                                            className: "px-2 py-[2px] rounded-full bg-bg-item-surface text-[9px] font-medium text-text-tertiary",
                                            children: p
                                        }, h)), l.technologies?.length > 4 && e.jsxs("span", {
                                            className: "px-2 py-[2px] rounded-full bg-bg-item-surface text-[9px] font-medium text-text-tertiary",
                                            children: ["+", l.technologies.length - 4]
                                        })]
                                })]
                        }, d))
                    })]
            }), c && e.jsxs("div", {
                className: "bg-bg-item-surface rounded-xl p-5 border border-border-subtle",
                children: [e.jsxs("div", {
                        className: "flex items-center gap-3 mb-5",
                        children: [e.jsx("div", {
                                className: "w-8 h-8 rounded-lg bg-orange-500/10 text-orange-500 border border-orange-500/20 flex items-center justify-center",
                                children: e.jsx(Qv, {
                                    size: 14
                                })
                            }), e.jsx("h3", {
                                className: "text-sm font-bold text-text-primary",
                                children: "Academic Background"
                            })]
                    }), e.jsx("div", {
                        className: "space-y-4",
                        children: a.map((l, d) => e.jsxs("div", {
                            className: "flex justify-between items-start border-b border-border-subtle pb-4 last:border-0 last:pb-0",
                            children: [e.jsxs("div", {
                                    className: "flex flex-col gap-0.5",
                                    children: [e.jsxs("h4", {
                                            className: "text-sm font-bold text-text-primary tracking-tight",
                                            children: [l.degree, " in ", l.field]
                                        }), e.jsx("span", {
                                            className: "text-xs text-text-secondary",
                                            children: l.institution
                                        })]
                                }), e.jsxs("div", {
                                    className: "text-right flex flex-col gap-1 items-end",
                                    children: [e.jsxs("span", {
                                            className: "text-[10px] font-bold text-text-tertiary uppercase tracking-wide",
                                            children: [l.start_date, " — ", l.end_date || "Present"]
                                        }), l.gpa && e.jsxs("span", {
                                            className: "text-xs text-text-secondary font-medium",
                                            children: ["GPA: ", l.gpa]
                                        })]
                                })]
                        }, d))
                    })]
            })]
    });
}, tP = "" + new URL("profile-CPP-OHUZ.jpg", import.meta.url).href, py = "https://checkout.dodopayments.com/buy/pdt_0NcM4QBwy0CDcPV9CXaNP", nP = "INSIDER20", sP = [{
        icon: jc,
        label: "Real Experience",
        desc: "Projects and skills"
    }, {
        icon: Qd,
        label: "Your Voice",
        desc: "First person, no AI filler"
    }, {
        icon: GS,
        label: "Salary Coaching",
        desc: "Live help on pay talks"
    }], pm = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif', my = "0 30px 70px -28px rgba(16,24,40,0.40)", hy = "0 40px 90px -30px rgba(0,0,0,0.85)", aP = {
    strong: "#F2F2F4",
    body: "rgba(255,255,255,0.66)",
    quiet: "rgba(255,255,255,0.52)",
    faint: "rgba(255,255,255,0.48)"
}, rP = {
    strong: "#0B1020",
    body: "rgba(11,16,32,0.68)",
    quiet: "rgba(11,16,32,0.66)",
    faint: "rgba(11,16,32,0.58)"
}, yr = "cubic-bezier(0.23, 1, 0.32, 1)", iP = [.23, 1, .32, 1], oP = .05, lP = 1100, cP = 700, dP = 420, uP = 280, mm = {
    rest: "rgba(11,16,32,0.55)",
    hover: "rgba(11,16,32,0.92)"
}, pP = {
    hidden: {},
    show: {
        transition: {
            staggerChildren: .07,
            delayChildren: .14
        }
    }
}, mP = {
    hidden: {
        opacity: 0,
        y: 10,
        filter: "blur(4px)"
    },
    show: {
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
        transition: {
            duration: .6,
            ease: iP
        }
    }
}, hP = {
    hidden: {
        opacity: 0
    },
    show: {
        opacity: 1,
        transition: {
            duration: .3
        }
    }
}, fP = ({ className: t, isOpen: n, onDismiss: s, onSetupProfile: a }) => {
    const [r, i] = o.useState(!1), [c, l] = o.useState(!1), [d, p] = o.useState(!1), [h, f] = o.useState(!1);
    o.useEffect(() => {
        n && f(!1);
    }, [n]);
    const m = Ft() ?? !1, u = Gt() === "light", g = u ? rP : aP, [v, y] = o.useState(!1), b = yt.useRef(null);
    o.useEffect(() => {
        n && (y(!1), b.current = null);
    }, [n]);
    const k = A => {
        b.current || (b.current = A, y(!0));
    }, x = () => {
        const A = b.current;
        b.current = null, A?.();
    }, j = () => {
        k(() => s());
    }, w = () => {
        f(!0), s("acted"), window.electronAPI?.openExternal ? window.electronAPI.openExternal(py, {
            surface: "profile_toaster"
        }) : window.open(py, "_blank"), a();
    };
    o.useEffect(() => {
        if (!n)
            return;
        const A = M => {
            M.key === "Escape" && j();
        };
        return window.addEventListener("keydown", A), () => window.removeEventListener("keydown", A);
    }, [n, s]), o.useEffect(() => {
        n || (i(!1), l(!1), p(!1));
    }, [n]);
    const C = m ? hP : mP, S = c ? dP : uP;
    return e.jsx(hs, {
        open: n && !v,
        onClosed: () => {
            x();
        },
        label: "ProfileFeatureToaster",
        zIndex: 9998,
        closeInstantly: h,
        onBackdropClick: j,
        backdropStyle: {
            background: u ? "rgba(10,10,18,0.30)" : "rgba(0,0,0,0.80)"
        },
        padding: 16,
        wrapStyle: {
            width: "600px",
            maxWidth: "100%"
        },
        cardClassName: t,
        cardStyle: {
            background: u ? "#F7F8FC" : "#1C1C1E",
            boxShadow: u ? "inset 0 0 0 1px rgba(11,16,32,0.10), inset 0 1px 0 rgba(255,255,255,0.80), " + my : "inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), " + hy,
            fontFamily: pm,
            WebkitFontSmoothing: "antialiased"
        },
        cardProps: {
            role: "dialog",
            "aria-modal": !0,
            "aria-labelledby": "profile-toast-title",
            "aria-describedby": "profile-toast-desc",
            onPointerEnter: A => {
                !m && A.pointerType === "mouse" && i(!0);
            },
            onPointerLeave: () => i(!1)
        },
        shadow: u ? my : hy,
        radius: 20,
        children: e.jsxs("div", {
            style: {
                display: "flex",
                alignItems: "stretch",
                minHeight: "440px"
            },
            children: [e.jsxs(q.div, {
                    variants: pP,
                    initial: m ? "hidden" : !1,
                    animate: "show",
                    style: {
                        position: "relative",
                        zIndex: 2,
                        flex: "1 1 58%",
                        minWidth: 0,
                        padding: "40px 28px 34px 40px",
                        display: "flex",
                        flexDirection: "column"
                    },
                    children: [e.jsx(q.div, {
                            variants: C,
                            style: {
                                fontSize: "12px",
                                fontWeight: 500,
                                letterSpacing: "-0.005em",
                                color: g.quiet,
                                margin: "0 0 22px"
                            },
                            children: "Profile Intelligence"
                        }), e.jsxs(q.h2, {
                            variants: C,
                            id: "profile-toast-title",
                            style: {
                                fontSize: "34px",
                                fontWeight: 300,
                                letterSpacing: "-0.032em",
                                lineHeight: 1.08,
                                margin: "0 0 20px",
                                color: g.strong
                            },
                            children: ["Sound like you.", e.jsx("br", {}), "Not like AI."]
                        }), e.jsx(q.p, {
                            variants: C,
                            id: "profile-toast-desc",
                            style: {
                                fontSize: "13.5px",
                                lineHeight: 1.55,
                                letterSpacing: "-0.008em",
                                color: g.body,
                                margin: 0,
                                maxWidth: "300px",
                                textWrap: "pretty"
                            },
                            children: "Answers grounded in your résumé, your projects and the way you actually talk, so nothing reads like a template."
                        }), e.jsx(q.dl, {
                            variants: C,
                            style: {
                                display: "grid",
                                gridTemplateColumns: "14px auto minmax(0, 1fr)",
                                alignItems: "baseline",
                                columnGap: "10px",
                                rowGap: "11px",
                                margin: "28px 0 0",
                                padding: 0
                            },
                            children: sP.map(({ icon: A, label: M, desc: E }) => e.jsxs("div", {
                                style: {
                                    display: "contents"
                                },
                                children: [e.jsx(A, {
                                        "aria-hidden": !0,
                                        size: 14,
                                        strokeWidth: 1.9,
                                        color: g.quiet,
                                        style: {
                                            alignSelf: "center"
                                        }
                                    }), e.jsx("dt", {
                                        style: {
                                            fontSize: "13px",
                                            fontWeight: 600,
                                            letterSpacing: "-0.01em",
                                            lineHeight: 1.3,
                                            color: g.strong,
                                            whiteSpace: "nowrap"
                                        },
                                        children: M
                                    }), e.jsx("dd", {
                                        style: {
                                            margin: 0,
                                            fontSize: "12.5px",
                                            fontWeight: 500,
                                            letterSpacing: "-0.004em",
                                            lineHeight: 1.3,
                                            color: g.quiet
                                        },
                                        children: E
                                    })]
                            }, M))
                        }), e.jsxs(q.div, {
                            variants: C,
                            style: {
                                marginTop: "auto",
                                paddingTop: "34px",
                                display: "flex",
                                alignItems: "center",
                                gap: "22px",
                                flexWrap: "wrap"
                            },
                            children: [e.jsxs("button", {
                                    type: "button",
                                    onClick: w,
                                    onPointerEnter: A => {
                                        A.pointerType === "mouse" && l(!0);
                                    },
                                    onPointerLeave: () => {
                                        l(!1), p(!1);
                                    },
                                    onPointerDown: () => p(!0),
                                    onPointerUp: () => p(!1),
                                    onFocus: A => {
                                        A.currentTarget.matches(":focus-visible") && l(!0);
                                    },
                                    onBlur: () => l(!1),
                                    style: {
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "9px 14px",
                                        borderRadius: "9px",
                                        border: `1px solid ${u ? c ? "rgba(11,16,32,0.46)" : "rgba(11,16,32,0.22)" : c ? "rgba(255,255,255,0.44)" : "rgba(255,255,255,0.24)"}`,
                                        background: u ? c ? "rgba(11,16,32,0.04)" : "rgba(11,16,32,0)" : c ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0)",
                                        outline: "none",
                                        cursor: "pointer",
                                        fontFamily: pm,
                                        fontSize: "13px",
                                        fontWeight: 500,
                                        letterSpacing: "-0.01em",
                                        color: c ? g.strong : u ? "rgba(11,16,32,0.84)" : "rgba(255,255,255,0.88)",
                                        transform: d && !m ? "scale(0.97)" : "none",
                                        transition: `border-color ${S}ms ${yr}, background-color ${S}ms ${yr}, color ${S}ms ${yr}, transform 120ms ${yr}`
                                    },
                                    children: [e.jsx("span", {
                                            children: "Upgrade to Pro"
                                        }), e.jsx(Zn, {
                                            size: 14,
                                            strokeWidth: 1.9,
                                            "aria-hidden": !0,
                                            style: {
                                                flex: "none",
                                                transform: c && !m ? "translateX(3px)" : "translateX(0)",
                                                transition: `transform ${S}ms ${yr}`
                                            }
                                        })]
                                }), e.jsx("button", {
                                    type: "button",
                                    onClick: j,
                                    style: {
                                        background: "none",
                                        border: 0,
                                        padding: "9px 0",
                                        cursor: "pointer",
                                        fontFamily: pm,
                                        fontSize: "13px",
                                        fontWeight: 500,
                                        letterSpacing: "-0.008em",
                                        color: g.faint,
                                        transition: `color 200ms ${yr}`
                                    },
                                    onMouseEnter: A => A.currentTarget.style.color = g.body,
                                    onMouseLeave: A => A.currentTarget.style.color = g.faint,
                                    onFocus: A => A.currentTarget.style.color = g.body,
                                    onBlur: A => A.currentTarget.style.color = g.faint,
                                    children: "Maybe later"
                                })]
                        }), e.jsxs(q.p, {
                            variants: C,
                            style: {
                                margin: "14px 0 0",
                                fontSize: "11.5px",
                                fontWeight: 500,
                                letterSpacing: "-0.004em",
                                color: g.faint
                            },
                            children: ["Use code", " ", e.jsx("span", {
                                    style: {
                                        color: g.body,
                                        fontWeight: 600,
                                        letterSpacing: "0.02em",
                                        userSelect: "text"
                                    },
                                    children: nP
                                }), " ", "at checkout"]
                        })]
                }), e.jsx("div", {
                    style: {
                        flex: "0 0 40%",
                        padding: "8px 8px 8px 0",
                        display: "flex"
                    },
                    children: e.jsxs("div", {
                        style: {
                            position: "relative",
                            flex: 1,
                            borderRadius: "14px",
                            overflow: "hidden",
                            background: "#EDF0F5",
                            boxShadow: u ? "inset 0 0 0 1px rgba(11,16,32,0.07)" : "none"
                        },
                        children: [e.jsx("div", {
                                "aria-hidden": !0,
                                style: {
                                    position: "absolute",
                                    inset: 0,
                                    backgroundImage: `url(${tP})`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "88% 50%",
                                    transform: r ? `scale(${1 + oP})` : "scale(1)",
                                    transformOrigin: "70% 50%",
                                    transition: m ? void 0 : `transform ${r ? lP : cP}ms ${yr}`,
                                    willChange: m ? void 0 : "transform",
                                    pointerEvents: "none"
                                }
                            }), e.jsx("button", {
                                type: "button",
                                onClick: j,
                                "aria-label": "Close",
                                style: {
                                    position: "absolute",
                                    top: "8px",
                                    right: "8px",
                                    zIndex: 2,
                                    width: "30px",
                                    height: "30px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 0,
                                    cursor: "pointer",
                                    background: "none",
                                    border: 0,
                                    borderRadius: "8px",
                                    color: mm.rest,
                                    transition: `color 180ms ${yr}, transform 160ms ${yr}`
                                },
                                onMouseEnter: A => {
                                    A.currentTarget.style.color = mm.hover;
                                },
                                onMouseLeave: A => {
                                    A.currentTarget.style.color = mm.rest, A.currentTarget.style.transform = "scale(1)";
                                },
                                onMouseDown: A => {
                                    A.currentTarget.style.transform = "scale(0.92)";
                                },
                                onMouseUp: A => {
                                    A.currentTarget.style.transform = "scale(1)";
                                },
                                children: e.jsx(Kt, {
                                    size: 14,
                                    strokeWidth: 2,
                                    color: "currentColor"
                                })
                            })]
                    })
                })]
        })
    });
}, xP = "" + new URL("jd-DOFbpjQE.jpg", import.meta.url).href, bP = "#EDF0F5", fy = "https://checkout.dodopayments.com/buy/pdt_0NcM4QBwy0CDcPV9CXaNP", hm = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif', gy = "0 30px 70px -28px rgba(16,24,40,0.40)", xy = "0 40px 90px -30px rgba(0,0,0,0.85)", yP = {
    strong: "#F2F2F4",
    body: "rgba(255,255,255,0.66)",
    quiet: "rgba(255,255,255,0.52)",
    faint: "rgba(255,255,255,0.48)"
}, vP = {
    strong: "#0B1020",
    body: "rgba(11,16,32,0.68)",
    quiet: "rgba(11,16,32,0.66)",
    faint: "rgba(11,16,32,0.58)"
}, vr = "cubic-bezier(0.23, 1, 0.32, 1)", wP = [.23, 1, .32, 1], jP = .05, kP = 1100, SP = 700, NP = 420, CP = 280, fm = {
    rest: "rgba(11,16,32,0.55)",
    hover: "rgba(11,16,32,0.92)"
}, AP = {
    hidden: {},
    show: {
        transition: {
            staggerChildren: .07,
            delayChildren: .14
        }
    }
}, EP = {
    hidden: {
        opacity: 0,
        y: 10,
        filter: "blur(4px)"
    },
    show: {
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
        transition: {
            duration: .6,
            ease: wP
        }
    }
}, TP = {
    hidden: {
        opacity: 0
    },
    show: {
        opacity: 1,
        transition: {
            duration: .3
        }
    }
}, IP = [{
        icon: Lo,
        label: "Company Intel",
        desc: "Culture and pay research"
    }, {
        icon: eu,
        label: "Fit Analysis",
        desc: "Coverage and skill gaps"
    }, {
        icon: ew,
        label: "Cover Letter",
        desc: "Drafted for this role"
    }], MP = "INSIDER20", _P = ({ className: t, isOpen: n, onDismiss: s, onSetupJD: a }) => {
    const [r, i] = o.useState(!1), [c, l] = o.useState(!1), [d, p] = o.useState(!1), [h, f] = o.useState(!1);
    o.useEffect(() => {
        n && f(!1);
    }, [n]);
    const m = Ft() ?? !1, u = Gt() === "light", g = u ? vP : yP, [v, y] = o.useState(!1), b = yt.useRef(null);
    o.useEffect(() => {
        n && (y(!1), b.current = null);
    }, [n]);
    const k = A => {
        b.current || (b.current = A, y(!0));
    }, x = () => {
        const A = b.current;
        b.current = null, A?.();
    }, j = () => {
        k(() => s());
    }, w = () => {
        f(!0), s("acted"), window.electronAPI?.openExternal ? window.electronAPI.openExternal(fy, {
            surface: "jd_toaster"
        }) : window.open(fy, "_blank"), a();
    };
    o.useEffect(() => {
        if (!n) {
            i(!1), l(!1), p(!1);
            return;
        }
        const A = M => {
            if (M.key === "Escape") {
                j();
                return;
            }
        };
        return window.addEventListener("keydown", A), () => window.removeEventListener("keydown", A);
    }, [n, s]);
    const C = m ? TP : EP, S = c ? NP : CP;
    return e.jsx(hs, {
        open: n && !v,
        onClosed: () => {
            x();
        },
        label: "JDAwarenessToaster",
        zIndex: 9998,
        closeInstantly: h,
        onBackdropClick: j,
        backdropClassName: t,
        backdropStyle: {
            background: u ? "rgba(10,10,18,0.30)" : "rgba(0,0,0,0.80)"
        },
        padding: 16,
        wrapStyle: {
            width: "600px",
            maxWidth: "100%"
        },
        cardStyle: {
            background: u ? "#F7F8FC" : "#1C1C1E",
            boxShadow: u ? "inset 0 0 0 1px rgba(11,16,32,0.10), inset 0 1px 0 rgba(255,255,255,0.80), " + gy : "inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), " + xy,
            fontFamily: hm,
            WebkitFontSmoothing: "antialiased"
        },
        cardProps: {
            role: "dialog",
            "aria-modal": !0,
            "aria-labelledby": "jd-toast-title",
            "aria-describedby": "jd-toast-desc",
            onPointerEnter: A => {
                !m && A.pointerType === "mouse" && i(!0);
            },
            onPointerLeave: () => i(!1)
        },
        shadow: u ? gy : xy,
        radius: 20,
        children: e.jsxs("div", {
            style: {
                display: "flex",
                alignItems: "stretch",
                minHeight: "440px"
            },
            children: [e.jsxs(q.div, {
                    variants: AP,
                    initial: m ? "hidden" : !1,
                    animate: "show",
                    style: {
                        position: "relative",
                        zIndex: 2,
                        flex: "1 1 58%",
                        minWidth: 0,
                        padding: "40px 28px 34px 40px",
                        display: "flex",
                        flexDirection: "column"
                    },
                    children: [e.jsx(q.div, {
                            variants: C,
                            style: {
                                fontSize: "12px",
                                fontWeight: 500,
                                letterSpacing: "-0.005em",
                                color: g.quiet,
                                margin: "0 0 22px"
                            },
                            children: "JD awareness"
                        }), e.jsxs(q.h2, {
                            variants: C,
                            id: "jd-toast-title",
                            style: {
                                fontSize: "34px",
                                fontWeight: 300,
                                letterSpacing: "-0.032em",
                                lineHeight: 1.08,
                                margin: "0 0 20px",
                                color: g.strong
                            },
                            children: ["Know the role.", e.jsx("br", {}), "Nail the answer."]
                        }), e.jsx(q.p, {
                            variants: C,
                            id: "jd-toast-desc",
                            style: {
                                fontSize: "13.5px",
                                lineHeight: 1.55,
                                letterSpacing: "-0.008em",
                                color: g.body,
                                margin: 0,
                                maxWidth: "300px",
                                textWrap: "pretty"
                            },
                            children: 'Add the job description and every answer follows its requirements, skills and wording, "Why this role?" included.'
                        }), e.jsx(q.dl, {
                            variants: C,
                            style: {
                                display: "grid",
                                gridTemplateColumns: "14px auto minmax(0, 1fr)",
                                alignItems: "baseline",
                                columnGap: "10px",
                                rowGap: "11px",
                                margin: "28px 0 0",
                                padding: 0
                            },
                            children: IP.map(({ icon: A, label: M, desc: E }) => e.jsxs("div", {
                                style: {
                                    display: "contents"
                                },
                                children: [e.jsx(A, {
                                        "aria-hidden": !0,
                                        size: 14,
                                        strokeWidth: 1.9,
                                        color: g.quiet,
                                        style: {
                                            alignSelf: "center"
                                        }
                                    }), e.jsx("dt", {
                                        style: {
                                            fontSize: "13px",
                                            fontWeight: 600,
                                            letterSpacing: "-0.01em",
                                            lineHeight: 1.3,
                                            color: g.strong,
                                            whiteSpace: "nowrap"
                                        },
                                        children: M
                                    }), e.jsx("dd", {
                                        style: {
                                            margin: 0,
                                            fontSize: "12.5px",
                                            fontWeight: 500,
                                            letterSpacing: "-0.004em",
                                            lineHeight: 1.3,
                                            color: g.quiet
                                        },
                                        children: E
                                    })]
                            }, M))
                        }), e.jsxs(q.div, {
                            variants: C,
                            style: {
                                marginTop: "auto",
                                paddingTop: "32px",
                                display: "flex",
                                alignItems: "center",
                                gap: "22px",
                                flexWrap: "wrap"
                            },
                            children: [e.jsxs("button", {
                                    type: "button",
                                    onClick: w,
                                    onPointerEnter: A => {
                                        A.pointerType === "mouse" && l(!0);
                                    },
                                    onPointerLeave: () => {
                                        l(!1), p(!1);
                                    },
                                    onPointerDown: () => p(!0),
                                    onPointerUp: () => p(!1),
                                    onFocus: A => {
                                        A.currentTarget.matches(":focus-visible") && l(!0);
                                    },
                                    onBlur: () => l(!1),
                                    style: {
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "9px 14px",
                                        borderRadius: "9px",
                                        border: `1px solid ${u ? c ? "rgba(11,16,32,0.46)" : "rgba(11,16,32,0.22)" : c ? "rgba(255,255,255,0.44)" : "rgba(255,255,255,0.24)"}`,
                                        background: u ? c ? "rgba(11,16,32,0.04)" : "rgba(11,16,32,0)" : c ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0)",
                                        outline: "none",
                                        cursor: "pointer",
                                        fontFamily: hm,
                                        fontSize: "13px",
                                        fontWeight: 500,
                                        letterSpacing: "-0.01em",
                                        color: c ? g.strong : u ? "rgba(11,16,32,0.84)" : "rgba(255,255,255,0.88)",
                                        transform: d && !m ? "scale(0.97)" : "none",
                                        transition: `border-color ${S}ms ${vr}, background-color ${S}ms ${vr}, color ${S}ms ${vr}, transform 120ms ${vr}`
                                    },
                                    children: [e.jsx("span", {
                                            children: "Upgrade to Pro"
                                        }), e.jsx(Zn, {
                                            size: 14,
                                            strokeWidth: 1.9,
                                            "aria-hidden": !0,
                                            style: {
                                                flex: "none",
                                                transform: c && !m ? "translateX(3px)" : "translateX(0)",
                                                transition: `transform ${S}ms ${vr}`
                                            }
                                        })]
                                }), e.jsx("button", {
                                    type: "button",
                                    onClick: j,
                                    style: {
                                        background: "none",
                                        border: 0,
                                        padding: "9px 0",
                                        cursor: "pointer",
                                        fontFamily: hm,
                                        fontSize: "13px",
                                        fontWeight: 500,
                                        letterSpacing: "-0.008em",
                                        color: g.faint,
                                        transition: `color 200ms ${vr}`
                                    },
                                    onMouseEnter: A => A.currentTarget.style.color = g.body,
                                    onMouseLeave: A => A.currentTarget.style.color = g.faint,
                                    onFocus: A => A.currentTarget.style.color = g.body,
                                    onBlur: A => A.currentTarget.style.color = g.faint,
                                    children: "Maybe later"
                                })]
                        }), e.jsxs(q.p, {
                            variants: C,
                            style: {
                                margin: "14px 0 0",
                                fontSize: "11.5px",
                                fontWeight: 500,
                                letterSpacing: "-0.004em",
                                color: g.faint
                            },
                            children: ["Use code", " ", e.jsx("span", {
                                    style: {
                                        color: g.body,
                                        fontWeight: 600,
                                        letterSpacing: "0.02em",
                                        userSelect: "text"
                                    },
                                    children: MP
                                }), " ", "at checkout"]
                        })]
                }), e.jsx("div", {
                    style: {
                        flex: "0 0 40%",
                        padding: "8px 8px 8px 0",
                        display: "flex"
                    },
                    children: e.jsxs("div", {
                        style: {
                            position: "relative",
                            flex: 1,
                            borderRadius: "14px",
                            overflow: "hidden",
                            background: bP,
                            boxShadow: u ? "inset 0 0 0 1px rgba(11,16,32,0.07)" : "none"
                        },
                        children: [e.jsx("div", {
                                "aria-hidden": !0,
                                style: {
                                    position: "absolute",
                                    inset: 0,
                                    backgroundImage: `url(${xP})`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "88% 50%",
                                    transform: r ? `scale(${1 + jP})` : "scale(1)",
                                    transformOrigin: "70% 50%",
                                    transition: m ? void 0 : `transform ${r ? kP : SP}ms ${vr}`,
                                    willChange: m ? void 0 : "transform",
                                    pointerEvents: "none"
                                }
                            }), e.jsx("button", {
                                type: "button",
                                onClick: j,
                                "aria-label": "Close",
                                style: {
                                    position: "absolute",
                                    top: "8px",
                                    right: "8px",
                                    zIndex: 2,
                                    width: "30px",
                                    height: "30px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 0,
                                    cursor: "pointer",
                                    background: "none",
                                    border: 0,
                                    borderRadius: "8px",
                                    color: fm.rest,
                                    transition: `color 180ms ${vr}, transform 160ms ${vr}`
                                },
                                onMouseEnter: A => {
                                    A.currentTarget.style.color = fm.hover;
                                },
                                onMouseLeave: A => {
                                    A.currentTarget.style.color = fm.rest, A.currentTarget.style.transform = "scale(1)";
                                },
                                onMouseDown: A => {
                                    A.currentTarget.style.transform = "scale(0.92)";
                                },
                                onMouseUp: A => {
                                    A.currentTarget.style.transform = "scale(1)";
                                },
                                children: e.jsx(Kt, {
                                    size: 14,
                                    strokeWidth: 2,
                                    color: "currentColor"
                                })
                            })]
                    })
                })]
        })
    });
}, PP = ({ className: t, isOpen: n, campaign: s, onDismiss: a }) => {
    const r = Gt() === "light";
    Ft(), o.useEffect(() => {
        const f = m => { };
        return window.addEventListener("keydown", f), () => window.removeEventListener("keydown", f);
    }, [n, a]);
    const i = async () => {
        if (s) {
            if (s.url && window.electronAPI && window.electronAPI.openExternal)
                try {
                    await window.electronAPI.openExternal(s.url);
                }
                catch (f) {
                    console.error("Failed to open external url:", f);
                }
            else
                s.url && window.open(s.url, "_blank");
            a(s.id);
        }
    }, c = () => {
        if (!s)
            return null;
        const f = 24, m = r ? "text-[#1C1C1E] relative z-10" : "text-white relative z-10 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]";
        switch (s.icon) {
            case "alert":
                return e.jsx(Wt, {
                    size: f,
                    className: m,
                    fill: r ? "#1C1C1E" : "white"
                });
            case "sparkles":
                return e.jsx(ei, {
                    size: f,
                    className: m,
                    fill: r ? "#1C1C1E" : "white"
                });
            default:
                return e.jsx(Os, {
                    size: f,
                    className: m,
                    fill: r ? "#1C1C1E" : "white"
                });
        }
    };
    if (!s)
        return null;
    const l = r ? "#1C1C1E" : "#FFFFFF", d = r ? "rgba(0,0,0,0.72)" : "rgba(255,255,255,0.72)", p = r ? "rgba(0,0,0,0.52)" : "rgba(255,255,255,0.44)", h = r ? "rgba(0,0,0,0.32)" : "rgba(255,255,255,0.24)";
    return e.jsx(St, {
        children: n && e.jsxs("div", {
            className: `fixed inset-0 z-[9998] flex items-center justify-center ${r ? "bg-black/20" : "bg-black/60"}`,
            children: [e.jsx("style", {
                    children: `
                        @keyframes campaign-border-flow {
                            0%, 100% { background-position: 0% 50%; }
                            50%       { background-position: 100% 50%; }
                        }
                        .campaign-border {
                            background: linear-gradient(145deg,
                                rgba(59,130,246,0.8),
                                rgba(245,158,11,0.7),
                                rgba(236,72,153,0.8),
                                rgba(59,130,246,0.8)
                            );
                            background-size: 300% 300%;
                            animation: campaign-border-flow 6s ease infinite;
                        }
                        .campaign-border-reduced {
                            background: linear-gradient(145deg, rgba(59,130,246,0.65), rgba(236,72,153,0.58));
                        }
                    `
                }), e.jsx(q.div, {
                    initial: {
                        opacity: 0,
                        scale: .94,
                        y: 10
                    },
                    animate: {
                        opacity: 1,
                        scale: 1,
                        y: 0
                    },
                    exit: {
                        opacity: 0,
                        scale: .96,
                        transition: {
                            duration: .15,
                            ease: [.32, 0, .67, 0]
                        }
                    },
                    transition: {
                        type: "spring",
                        stiffness: 450,
                        damping: 35
                    },
                    className: wx("relative w-[482px] overflow-hidden", "rounded-[24px] p-0", r ? "shadow-[0_32px_64px_-16px_rgba(59,130,246,0.15),0_8px_32px_-8px_rgba(0,0,0,0.06)]" : "shadow-[0_48px_120px_-20px_rgba(0,0,0,0.95),0_0_80px_rgba(59,130,246,0.05)]", t),
                    children: e.jsxs("div", {
                        style: {
                            position: "relative",
                            width: "100%",
                            borderRadius: "22px",
                            overflow: "hidden",
                            background: r ? "linear-gradient(155deg, rgba(254, 252, 255, 0.98) 0%, rgba(248, 244, 255, 0.99) 100%)" : "linear-gradient(155deg, rgba(30,30,36,0.99) 0%, rgba(18,18,21,1) 100%)",
                            paddingBottom: "28px",
                            fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif'
                        },
                        children: [e.jsx("div", {
                                className: `absolute top-0 left-0 right-0 h-[300px] bg-gradient-to-b pointer-events-none ${r ? "from-blue-500/[0.04] to-transparent" : "from-blue-500/[0.08] to-transparent"}`
                            }), e.jsx("div", {
                                "aria-hidden": !0,
                                style: {
                                    position: "absolute",
                                    inset: 0,
                                    borderRadius: "22px",
                                    pointerEvents: "none",
                                    zIndex: 4,
                                    opacity: r ? .015 : .028,
                                    mixBlendMode: "overlay",
                                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)'/%3E%3C/svg%3E")`,
                                    backgroundSize: "180px 180px"
                                }
                            }), e.jsxs("div", {
                                className: "relative z-10 w-full flex justify-between items-center px-6 pt-5 pb-3",
                                children: [e.jsx("span", {
                                        style: {
                                            fontSize: "10.5px",
                                            fontWeight: 660,
                                            letterSpacing: "0.15em",
                                            textTransform: "uppercase",
                                            color: d
                                        },
                                        children: "Campaign Announcement"
                                    }), e.jsx("button", {
                                        onClick: () => a(s.id),
                                        "aria-label": "Dismiss",
                                        className: "w-7 h-7 flex items-center justify-center rounded-full opacity-45 transition-all",
                                        style: {
                                            background: "none",
                                            border: "none",
                                            cursor: "pointer"
                                        },
                                        onMouseEnter: f => {
                                            f.currentTarget.style.opacity = "0.8", f.currentTarget.style.background = r ? "rgba(0,0,0,0.05)" : "rgba(255,255,255,0.1)";
                                        },
                                        onMouseLeave: f => {
                                            f.currentTarget.style.opacity = "0.45", f.currentTarget.style.background = "transparent";
                                        },
                                        children: e.jsx(Kt, {
                                            size: 13,
                                            strokeWidth: 2.3,
                                            color: r ? "#000" : "#fff"
                                        })
                                    })]
                            }), e.jsxs("div", {
                                className: "relative z-10 w-full flex flex-col items-center pt-[32px]",
                                children: [e.jsxs("div", {
                                        className: "relative w-[64px] h-[64px] mb-[28px]",
                                        children: [e.jsxs(q.div, {
                                                animate: {
                                                    rotate: [0, 8, 0, -8, 0],
                                                    scale: [1, 1.04, 1]
                                                },
                                                transition: {
                                                    duration: 8,
                                                    repeat: 1 / 0,
                                                    ease: "easeInOut"
                                                },
                                                className: "absolute inset-0 flex items-center justify-center",
                                                children: [e.jsx("div", {
                                                        className: `absolute w-full h-full border rotate-45 rounded-[12px] backdrop-blur-sm ${r ? "border-blue-500/20 bg-blue-500/[0.03]" : "border-blue-500/30 bg-blue-500/[0.02]"}`
                                                    }), e.jsx("div", {
                                                        className: `absolute w-[80%] h-[80%] border -rotate-12 rounded-[8px] ${r ? "border-blue-500/10" : "border-blue-500/15"}`
                                                    }), c()]
                                            }), e.jsx("div", {
                                                className: "absolute inset-0 blur-[20px] rounded-full scale-150 bg-blue-500/10"
                                            })]
                                    }), e.jsxs("div", {
                                        className: "text-center px-[40px] mb-[28px]",
                                        children: [e.jsx("h3", {
                                                style: {
                                                    color: l
                                                },
                                                className: "text-[28px] font-[750] leading-[1.15] tracking-[-0.03em] mb-[10px] antialiased",
                                                children: s.title
                                            }), e.jsx("p", {
                                                style: {
                                                    color: p
                                                },
                                                className: "text-[13.5px] leading-[1.6] max-w-[340px] mx-auto font-medium antialiased",
                                                children: s.message
                                            })]
                                    }), s.type === "promo" && e.jsxs(q.div, {
                                        animate: {
                                            y: [0, -2, 0]
                                        },
                                        transition: {
                                            duration: 4.5,
                                            repeat: 1 / 0,
                                            ease: "easeInOut"
                                        },
                                        className: wx("w-[390px] rounded-[20px] border p-[20px] mb-[28px] relative overflow-hidden group", r ? "bg-gradient-to-b from-blue-500/[0.04] to-transparent border-blue-500/[0.12] shadow-[0_8px_24px_-8px_rgba(59,130,246,0.08)]" : "bg-gradient-to-b from-blue-500/[0.06] to-transparent border-blue-500/[0.15] shadow-[0_8px_32px_-8px_rgba(59,130,246,0.12)]"),
                                        children: [e.jsx("div", {
                                                className: "absolute top-0 right-[-10px] p-4 opacity-[0.05] group-hover:opacity-10 transition-opacity",
                                                children: e.jsx(ei, {
                                                    size: 80,
                                                    className: "text-[#3B82F6]"
                                                })
                                            }), e.jsxs("div", {
                                                className: "flex items-center justify-between mb-2 relative z-10",
                                                children: [e.jsxs("div", {
                                                        className: "flex flex-col",
                                                        children: [e.jsx("span", {
                                                                className: "text-[10px] font-bold uppercase tracking-[0.2em] text-blue-500",
                                                                children: "Special Promotion"
                                                            }), e.jsx("span", {
                                                                style: {
                                                                    color: l
                                                                },
                                                                className: "text-[14px] font-[900] tracking-widest font-mono mt-0.5",
                                                                children: "SAVE30"
                                                            })]
                                                    }), e.jsx("div", {
                                                        className: "px-2.5 py-0.5 rounded-full bg-blue-500 text-white text-[9.5px] font-black tracking-wider shadow-[0_0_12px_rgba(59,130,246,0.3)]",
                                                        children: "LIMITED TIME"
                                                    })]
                                            }), e.jsxs("div", {
                                                className: "flex items-end gap-3 leading-none relative z-10 mt-4",
                                                children: [e.jsxs("div", {
                                                        className: "flex items-baseline gap-1",
                                                        children: [e.jsx("span", {
                                                                style: {
                                                                    color: l
                                                                },
                                                                className: "text-[40px] font-[800] leading-none tracking-[-0.03em]",
                                                                children: "$10"
                                                            }), e.jsx("span", {
                                                                className: "text-[13px] font-bold text-blue-500 mb-1",
                                                                children: "$5 OFF"
                                                            })]
                                                    }), e.jsx("div", {
                                                        className: `h-[20px] w-px mx-1 mb-1.5 ${r ? "bg-black/10" : "bg-white/10"}`
                                                    }), e.jsxs("div", {
                                                        className: "mb-1",
                                                        children: [e.jsx("span", {
                                                                style: {
                                                                    color: d
                                                                },
                                                                className: "text-[13px] font-semibold block leading-tight",
                                                                children: "Lifetime Access"
                                                            }), e.jsx("span", {
                                                                style: {
                                                                    color: h
                                                                },
                                                                className: "text-[11px] font-medium line-through tracking-wide mt-0.5",
                                                                children: "Regularly $15.00"
                                                            })]
                                                    })]
                                            })]
                                    }), e.jsxs("div", {
                                        className: "w-full px-[46px] flex flex-col gap-4 relative",
                                        children: [e.jsxs(q.button, {
                                                onClick: i,
                                                whileHover: {
                                                    scale: 1.012,
                                                    filter: "brightness(1.04)"
                                                },
                                                whileTap: {
                                                    scale: .985
                                                },
                                                className: "relative w-full h-[52px] rounded-[15px] bg-gradient-to-r from-blue-500 to-blue-600 text-white font-bold text-[15.5px] tracking-wide transition-all shadow-[0_8px_24px_rgba(59,130,246,0.3)] overflow-hidden flex items-center justify-center border-none cursor-pointer",
                                                children: [e.jsx("span", {
                                                        className: "absolute top-[2px] left-[8px] right-[8px] h-[40%] rounded-full bg-gradient-to-b from-white/70 to-white/5 filter blur-[0.5px] pointer-events-none z-10"
                                                    }), e.jsx("div", {
                                                        className: "absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"
                                                    }), e.jsx("span", {
                                                        className: "relative z-20",
                                                        children: s.cta_text
                                                    })]
                                            }), e.jsxs("div", {
                                                className: "flex flex-col items-center gap-2.5 mt-1",
                                                children: [e.jsx("span", {
                                                        style: {
                                                            color: h
                                                        },
                                                        className: "text-[11.5px] font-medium",
                                                        children: "3,000+ people are already using Natively"
                                                    }), e.jsx("button", {
                                                        onClick: () => a(s.id),
                                                        className: `text-[11px] font-bold uppercase tracking-[0.2em] mt-1 transition-colors duration-200 border-none bg-none cursor-pointer ${r ? "text-black/30 hover:text-black/50" : "text-white/30 hover:text-white/50"}`,
                                                        children: "Maybe later"
                                                    })]
                                            })]
                                    })]
                            })]
                    })
                })]
        })
    });
}, by = {
    PROBE: "bg-gray-500/15 text-gray-400 border-gray-500/20",
    ANCHOR: "bg-blue-500/15 text-blue-400 border-blue-500/20",
    COUNTER: "bg-orange-500/15 text-orange-400 border-orange-500/20",
    HOLD: "bg-yellow-500/15 text-yellow-400 border-yellow-500/20",
    PIVOT_BENEFITS: "bg-purple-500/15 text-purple-400 border-purple-500/20",
    CLOSE: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
}, yy = {
    PROBE: "100, 116, 139",
    ANCHOR: "59, 130, 246",
    COUNTER: "249, 115, 22",
    HOLD: "234, 179, 8",
    PIVOT_BENEFITS: "168, 85, 247",
    CLOSE: "16, 185, 129"
}, vy = {
    PROBE: "#64748b",
    ANCHOR: "#3b82f6",
    COUNTER: "#f97316",
    HOLD: "#eab308",
    PIVOT_BENEFITS: "#a855f7",
    CLOSE: "#10b981"
}, $P = {
    PROBE: "Gathering Intel",
    ANCHOR: "First Offer",
    COUNTER: "Countering",
    HOLD: "Holding Position",
    PIVOT_BENEFITS: "Total Comp",
    CLOSE: "Closing"
}, DP = ({ tacticalNote: t, exactScript: n, showSilenceTimer: s, phase: a, theirOffer: r, yourTarget: i, currency: c, onSilenceTimerEnd: l, interfaceTheme: d = "default", isLightTheme: p = !1 }) => {
    const [h, f] = o.useState(!1), [m, u] = o.useState(5), g = o.useRef(!1), v = o.useRef(l);
    v.current = l;
    const y = () => {
        navigator.clipboard?.writeText(n), f(!0), setTimeout(() => f(!1), 2e3);
    };
    o.useEffect(() => {
        if (!s)
            return;
        g.current = !1, u(5);
        const be = setInterval(() => {
            u(X => X <= 1 ? 0 : X - 1);
        }, 1e3), Y = setTimeout(() => {
            g.current || (g.current = !0, v.current?.());
        }, 5e3);
        return () => {
            clearInterval(be), clearTimeout(Y);
        };
    }, [s]);
    const b = d === "modern", k = d === "liquid-glass";
    let x = {}, j = "rounded-xl border overflow-hidden my-2 transition-all duration-300 relative";
    b ? (j = "rounded-2xl overflow-hidden my-2 transition-all duration-300 relative border", x = {
        background: p ? "linear-gradient(165deg, rgba(254, 215, 170, 0.45) 0%, rgba(253, 186, 116, 0.25) 50%, rgba(251, 146, 60, 0.15) 100%)" : "linear-gradient(165deg, rgba(124, 45, 18, 0.22) 0%, rgba(120, 53, 4, 0.14) 50%, rgba(67, 20, 7, 0.08) 100%)",
        borderTop: p ? "1px solid rgba(255, 255, 255, 0.9)" : "1px solid rgba(255, 255, 255, 0.18)",
        borderLeft: p ? "1px solid rgba(255, 255, 255, 0.7)" : "1px solid rgba(255, 255, 255, 0.12)",
        borderRight: p ? "1px solid rgba(251, 146, 60, 0.12)" : "1px solid rgba(0, 0, 0, 0.2)",
        borderBottom: p ? "1px solid rgba(251, 146, 60, 0.35)" : "1px solid rgba(0, 0, 0, 0.45)",
        boxShadow: p ? "inset 0 2.5px 3px rgba(255, 255, 255, 0.95), inset 0 -6px 12px rgba(251, 146, 60, 0.06), 0 8px 24px rgba(251, 146, 60, 0.06), 0 2px 5px rgba(0, 0, 0, 0.02)" : "inset 0 2.5px 3px rgba(255, 255, 255, 0.18), inset 0 -6px 12px rgba(0, 0, 0, 0.25), 0 8px 24px rgba(0, 0, 0, 0.20), 0 2px 5px rgba(0, 0, 0, 0.1)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)"
    }) : k ? (j = "rounded-2xl overflow-hidden my-2 transition-all duration-300 relative border border-transparent", x = {
        background: "linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.04) 45%, rgba(255, 255, 255, 0.02) 65%, rgba(255, 255, 255, 0.08) 100%), rgba(251, 146, 60, 0.05)",
        boxShadow: "inset 0 1.5px 0 rgba(255, 255, 255, 0.4), inset 0 0 0 1px rgba(255, 255, 255, 0.12), 0 8px 24px rgba(0, 0, 0, 0.28)",
        backdropFilter: "blur(32px) saturate(160%)",
        WebkitBackdropFilter: "blur(32px) saturate(160%)"
    }) : (j = "rounded-xl border overflow-hidden my-2 transition-all duration-300 relative", x = {
        background: p ? "rgba(255, 247, 237, 0.75)" : "rgba(43, 20, 10, 0.45)",
        borderColor: p ? "rgba(251, 146, 60, 0.25)" : "rgba(249, 115, 22, 0.2)",
        boxShadow: p ? "0 1px 2px rgba(0, 0, 0, 0.04)" : "0 1px 2px rgba(0, 0, 0, 0.15)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)"
    });
    const w = b ? p ? "border-orange-200/50" : "border-white/5" : k ? "border-white/10" : p ? "border-orange-200/50" : "border-orange-500/10", C = b ? p ? "text-slate-600" : "text-zinc-400" : k ? "text-white/75" : p ? "text-slate-700" : "text-zinc-400", S = b ? p ? "text-slate-500" : "text-zinc-500" : k ? "text-white/60" : p ? "text-slate-500" : "text-zinc-500", A = k ? "text-red-300 font-semibold" : p ? "text-red-600 font-bold" : "text-red-400 font-semibold", M = k ? "text-emerald-300 font-semibold" : p ? "text-emerald-600 font-bold" : "text-emerald-400 font-semibold", E = "text-[9px] font-bold uppercase tracking-widest mb-1", T = b ? p ? "text-slate-500" : "text-zinc-400" : k ? "text-white/60" : "text-text-tertiary";
    let N = {}, _ = "", P = {}, z = "", O = "flex items-center gap-1 text-[9px] font-medium transition-colors px-2 py-0.5 rounded", B = "text-[9px] font-bold uppercase tracking-widest", V = {};
    b ? (_ = "mt-2 p-3 rounded-xl shadow-inner border", N = {
        background: p ? "rgba(255, 255, 255, 0.45)" : "rgba(0, 0, 0, 0.22)",
        borderColor: p ? "rgba(251, 146, 60, 0.2)" : "rgba(251, 146, 60, 0.08)"
    }, z = "text-[12.5px] leading-relaxed italic pl-3 border-l-[3px]", P = {
        borderLeftColor: "#f97316",
        color: p ? "#1e293b" : "#f8fafc"
    }, O += p ? " bg-orange-100/60 hover:bg-orange-200/60 text-orange-850" : " bg-orange-950/40 hover:bg-orange-900/40 text-orange-400", B += " text-orange-650 dark:text-orange-400") : k ? (_ = "mt-2 p-3 rounded-xl border border-white/5", N = {
        background: "linear-gradient(180deg, rgba(0, 0, 0, 0.25) 0%, rgba(0, 0, 0, 0.35) 100%), rgba(0, 0, 0, 0.15)",
        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.06), inset 0 -1px 0 rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255, 255, 255, 0.02)"
    }, z = "text-[12.5px] leading-relaxed italic pl-3 border-l-2", P = {
        borderLeftColor: "#f97316",
        color: "#ffffff"
    }, O += " bg-white/5 hover:bg-white/10 text-white/70 hover:text-white", B += " text-orange-400", V = {
        textShadow: "0 0 6px rgba(249, 115, 22, 0.3)"
    }) : (_ = "mt-1.5", z = "text-[12px] leading-relaxed italic pl-2.5 border-l-2", P = {
        borderLeftColor: p ? "#f97316" : "rgba(249, 115, 22, 0.5)",
        color: p ? "#1e293b" : "#f4f4f5"
    }, O += p ? " hover:bg-slate-200/50 text-slate-500 hover:text-slate-800" : " hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200", B += " text-orange-500 dark:text-orange-400");
    const xe = (be => {
        const Y = yy[be] || yy.ANCHOR, X = vy[be] || vy.ANCHOR;
        if (b) {
            const Ne = be === "HOLD";
            return {
                style: {
                    background: `linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 50%, rgba(0,0,0,0.15) 100%), ${X}`,
                    border: `1px solid rgba(${Y}, 0.8)`,
                    boxShadow: `inset 0 1.5px 0.5px rgba(255,255,255,0.7), inset 0 -1.5px 2px rgba(0,0,0,0.25), 0 3px 8px rgba(${Y}, 0.35)`,
                    color: Ne ? "#0f172a" : "#ffffff"
                },
                className: "text-[9px] font-extrabold px-2.5 py-0.5 rounded-full tracking-wider uppercase"
            };
        }
        else {
            if (k)
                return {
                    style: {
                        background: `rgba(${Y}, 0.12)`,
                        border: `1px solid rgba(${Y}, 0.45)`,
                        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.1), 0 0 8px rgba(${Y}, 0.25)`,
                        color: `rgb(${Y})`,
                        textShadow: `0 0 4px rgba(${Y}, 0.3)`
                    },
                    className: "text-[9px] font-bold px-2 py-0.5 rounded-full tracking-widest uppercase"
                };
            {
                const Ne = by[be] || by.ANCHOR;
                return {
                    style: {},
                    className: `text-[9px] font-bold px-2 py-0.5 rounded-full border tracking-widest uppercase ${Ne}`
                };
            }
        }
    })(a), U = r != null && i != null ? i - r : null, H = be => {
        try {
            return new Intl.NumberFormat(void 0, {
                style: "currency",
                currency: c,
                maximumFractionDigits: 0,
                notation: "compact"
            }).format(be);
        }
        catch {
            return `${c} ${be}`;
        }
    }, Z = b ? {
        background: p ? "rgba(251, 146, 60, 0.15)" : "rgba(249, 115, 22, 0.15)",
        color: p ? "#c2410c" : "#fdba74",
        border: p ? "1px solid rgba(251, 146, 60, 0.25)" : "1px solid rgba(249, 115, 22, 0.2)"
    } : k ? {
        background: "rgba(249, 115, 22, 0.12)",
        border: "1px solid rgba(249, 115, 22, 0.3)",
        color: "#fdba74"
    } : void 0, ie = b ? "text-[9.5px] font-extrabold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm" : k ? "text-[9.5px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1" : "text-[10px] text-text-tertiary flex items-center gap-1";
    let ne = "px-3.5 py-2 flex items-center gap-3 border-b", D = {}, ue = "text-[10px] font-semibold mb-1", me = {}, ye = "h-1 rounded-full overflow-hidden", Ae = {}, G = "h-full rounded-full transition-all duration-1000", ke = {}, Re = "text-[13px] font-bold tabular-nums w-4 text-right", re = {}, Te = "";
    return b ? (D = {
        background: p ? "rgba(245, 158, 11, 0.08)" : "rgba(245, 158, 11, 0.06)",
        borderColor: p ? "rgba(245, 158, 11, 0.15)" : "rgba(245, 158, 11, 0.08)"
    }, me = {
        color: p ? "#b45309" : "#fbbf24"
    }, Ae = {
        background: p ? "rgba(245, 158, 11, 0.18)" : "rgba(245, 158, 11, 0.12)"
    }, ke = {
        background: "linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.4), inset 0 -1px 1px rgba(0,0,0,0.15)"
    }, re = {
        color: p ? "#b45309" : "#fbbf24"
    }, Te = p ? "#b45309" : "#fbbf24") : k ? (D = {
        background: "rgba(234, 179, 8, 0.06)",
        borderColor: "rgba(255, 255, 255, 0.08)"
    }, me = {
        color: "#fbbf24",
        textShadow: "0 0 6px rgba(234, 179, 8, 0.3)"
    }, Ae = {
        background: "rgba(255, 255, 255, 0.08)"
    }, ke = {
        background: "#fbbf24",
        boxShadow: "0 0 8px rgba(234, 179, 8, 0.6)"
    }, re = {
        color: "#fbbf24"
    }, Te = "#fbbf24") : (ne += " bg-yellow-500/5 border-yellow-500/15", ue += " text-yellow-400", ye += " bg-yellow-500/15", G += " bg-yellow-400/60", Re += " text-yellow-400", Te = "#eab308"), e.jsxs("div", {
        className: j,
        style: x,
        children: [k && e.jsx("div", {
                className: "absolute inset-0 pointer-events-none z-0 opacity-[0.12] mix-blend-overlay",
                style: {
                    backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0 0.12 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>")`
                }
            }), e.jsxs("div", {
                className: "relative z-10 w-full",
                children: [e.jsxs("div", {
                        className: `flex items-center justify-between px-3.5 pt-3 pb-2 border-b ${w}`,
                        children: [e.jsxs("div", {
                                className: "flex items-center gap-2",
                                children: [e.jsx("span", {
                                        className: xe.className,
                                        style: xe.style,
                                        children: $P[a] || a
                                    }), U != null && U > 0 && e.jsxs("span", {
                                        className: ie,
                                        style: Z,
                                        children: [e.jsx(KS, {
                                                size: 9,
                                                className: "text-orange-400"
                                            }), "Gap: ", H(U)]
                                    })]
                            }), r != null && i != null && e.jsxs("div", {
                                className: `text-[10px] ${S}`,
                                children: [e.jsx("span", {
                                        className: A,
                                        children: H(r)
                                    }), e.jsx("span", {
                                        className: "mx-1.5 opacity-55",
                                        children: "→"
                                    }), e.jsx("span", {
                                        className: M,
                                        children: H(i)
                                    })]
                            })]
                    }), s && m > 0 && e.jsxs("div", {
                        className: ne,
                        style: D,
                        children: [e.jsx(qS, {
                                size: 11,
                                style: {
                                    color: Te
                                },
                                className: "shrink-0"
                            }), e.jsxs("div", {
                                className: "flex-1",
                                children: [e.jsx("div", {
                                        className: ue,
                                        style: me,
                                        children: "Hold the silence. Let them speak first."
                                    }), e.jsx("div", {
                                        className: ye,
                                        style: Ae,
                                        children: e.jsx("div", {
                                            className: G,
                                            style: {
                                                ...ke,
                                                width: `${m / 5 * 100}%`
                                            }
                                        })
                                    })]
                            }), e.jsx("span", {
                                className: Re,
                                style: re,
                                children: m
                            })]
                    }), e.jsxs("div", {
                        className: `px-3.5 py-2.5 border-b ${w}`,
                        children: [e.jsx("div", {
                                className: `${E} ${T}`,
                                children: "Tactical Note"
                            }), e.jsx("p", {
                                className: `text-[11px] leading-relaxed ${C}`,
                                children: t
                            })]
                    }), e.jsxs("div", {
                        className: "px-3.5 py-2.5",
                        children: [e.jsxs("div", {
                                className: "flex items-center justify-between",
                                children: [e.jsx("div", {
                                        className: B,
                                        style: V,
                                        children: "Say This"
                                    }), e.jsxs("button", {
                                        onClick: y,
                                        className: O,
                                        children: [h ? e.jsx(Bt, {
                                                size: 9,
                                                className: "text-emerald-400"
                                            }) : e.jsx(or, {
                                                size: 9
                                            }), h ? "Copied" : "Copy"]
                                    })]
                            }), e.jsx("div", {
                                className: _,
                                style: N,
                                children: e.jsxs("p", {
                                    className: z,
                                    style: P,
                                    children: ['"', n, '"']
                                })
                            })]
                    })]
            })]
    });
}, zP = "" + new URL("BE-black-DNx2EVZh.png", import.meta.url).href, gm = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif', wy = "0 30px 70px -28px rgba(16,24,40,0.40)", jy = "0 40px 90px -30px rgba(0,0,0,0.85)", FP = {
    strong: "#F2F2F4",
    body: "rgba(255,255,255,0.66)",
    quiet: "rgba(255,255,255,0.52)",
    faint: "rgba(255,255,255,0.48)"
}, WP = {
    strong: "#0B1020",
    body: "rgba(11,16,32,0.68)",
    quiet: "rgba(11,16,32,0.66)",
    faint: "rgba(11,16,32,0.58)"
}, wr = "cubic-bezier(0.23, 1, 0.32, 1)", BP = [.23, 1, .32, 1], UP = .05, HP = 1100, GP = 700, KP = 420, qP = 280, xm = {
    rest: "rgba(11,16,32,0.55)",
    hover: "rgba(11,16,32,0.92)"
}, VP = {
    hidden: {},
    show: {
        transition: {
            staggerChildren: .07,
            delayChildren: .14
        }
    }
}, YP = {
    hidden: {
        opacity: 0,
        y: 10,
        filter: "blur(4px)"
    },
    show: {
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
        transition: {
            duration: .6,
            ease: BP
        }
    }
}, XP = {
    hidden: {
        opacity: 0
    },
    show: {
        opacity: 1,
        transition: {
            duration: .3
        }
    }
}, ZP = {
    existing: {
        eyebrow: "Natively API",
        headline: ["Three services.", "One key."],
        standfirst: "An AI provider, a transcription service and a research API, each with its own key, quota and invoice. One Natively subscription covers all three.",
        stats: [{
                value: "1",
                label: "API key"
            }, {
                value: "1",
                label: "Flat bill"
            }, {
                value: "0",
                label: "Keys to rotate"
            }],
        cta: "Replace all three",
        decline: "Keep them separate"
    },
    new: {
        eyebrow: "Natively API",
        headline: ["Skip the setup.", "Start now."],
        standfirst: "Most people spend 20 minutes collecting their first keys. One Natively subscription gives you AI chat, transcription and web search, ready as soon as you paste the key.",
        stats: [{
                value: "30 sec",
                label: "Checkout"
            }, {
                value: "1",
                label: "Key to paste"
            }, {
                value: "0",
                label: "Configuration"
            }],
        cta: "Get a Natively key",
        decline: "I'll set up manually"
    }
}, JP = t => !!(t?.hasGeminiKey || t?.hasGroqKey || t?.hasOpenaiKey || t?.hasClaudeKey || t?.hasSttGroqKey || t?.hasSttOpenaiKey || t?.hasDeepgramKey || t?.hasElevenLabsKey || t?.hasAzureKey || t?.hasIbmWatsonKey || t?.hasSonioxKey || t?.hasTavilyKey), QP = ({ isOpen: t, onDismiss: n, onOpenSettings: s, variant: a }) => {
    const [r, i] = o.useState(null), [c, l] = o.useState(!1), [d, p] = o.useState(!1), [h, f] = o.useState(!1), [m, u] = o.useState(!1);
    o.useEffect(() => {
        t && u(!1);
    }, [t]);
    const g = Ft() ?? !1, v = Gt() === "light", y = v ? WP : FP, b = yt.useRef(t);
    b.current = t, o.useEffect(() => {
        if (!t) {
            l(!1), p(!1), f(!1);
            return;
        }
        let P = !1;
        return a ? (i(a), () => {
            P = !0;
        }) : ((async () => {
            let z = "new";
            try {
                const O = await window.electronAPI?.getStoredCredentials?.();
                JP(O) && (z = "existing");
            }
            catch { }
            P || i(z);
        })(), () => {
            P = !0;
        });
    }, [t, a]);
    const [k, x] = o.useState(!1), j = yt.useRef(null);
    o.useEffect(() => {
        t && (x(!1), j.current = null);
    }, [t]);
    const w = P => {
        j.current || (j.current = P, x(!0));
    }, C = () => {
        const P = j.current;
        j.current = null, P?.();
    }, S = () => {
        w(() => n());
    }, A = () => {
        w(() => n("never"));
    }, M = () => {
        u(!0), n("acted"), s("natively-api");
    }, E = t && r !== null && !k;
    o.useEffect(() => {
        if (!E)
            return;
        const P = z => {
            z.key === "Escape" && S();
        };
        return window.addEventListener("keydown", P), () => window.removeEventListener("keydown", P);
    }, [E]);
    const T = g ? XP : YP, N = d ? KP : qP, _ = r ? ZP[r] : null;
    return e.jsx(hs, {
        open: E,
        onClosed: () => {
            C(), b.current || i(null);
        },
        label: "NativelyApiPromoToaster",
        openingView: r ?? void 0,
        zIndex: 9998,
        closeInstantly: m,
        onBackdropClick: S,
        backdropStyle: {
            background: v ? "rgba(10,10,18,0.30)" : "rgba(0,0,0,0.80)"
        },
        padding: 16,
        wrapStyle: {
            width: "600px",
            maxWidth: "100%"
        },
        cardStyle: {
            background: v ? "#F7F8FC" : "#1C1C1E",
            boxShadow: v ? "inset 0 0 0 1px rgba(11,16,32,0.10), inset 0 1px 0 rgba(255,255,255,0.80), " + wy : "inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), " + jy,
            fontFamily: gm,
            WebkitFontSmoothing: "antialiased"
        },
        cardProps: {
            "data-genie-view": r ?? void 0,
            role: "dialog",
            "aria-modal": !0,
            "aria-labelledby": "nap-toast-title",
            "aria-describedby": "nap-toast-desc",
            onPointerEnter: P => {
                !g && P.pointerType === "mouse" && l(!0);
            },
            onPointerLeave: () => l(!1)
        },
        shadow: v ? wy : jy,
        radius: 20,
        children: _ && e.jsxs("div", {
            style: {
                display: "flex",
                alignItems: "stretch",
                minHeight: "440px"
            },
            children: [e.jsxs(q.div, {
                    variants: VP,
                    initial: g ? "hidden" : !1,
                    animate: "show",
                    style: {
                        position: "relative",
                        zIndex: 2,
                        flex: "1 1 58%",
                        minWidth: 0,
                        padding: "40px 28px 34px 40px",
                        display: "flex",
                        flexDirection: "column"
                    },
                    children: [e.jsx(q.div, {
                            variants: T,
                            style: {
                                fontSize: "12px",
                                fontWeight: 500,
                                letterSpacing: "-0.005em",
                                color: y.quiet,
                                margin: "0 0 22px"
                            },
                            children: _.eyebrow
                        }), e.jsxs(q.h2, {
                            variants: T,
                            id: "nap-toast-title",
                            style: {
                                fontSize: "34px",
                                fontWeight: 300,
                                letterSpacing: "-0.032em",
                                lineHeight: 1.08,
                                margin: "0 0 20px",
                                color: y.strong
                            },
                            children: [_.headline[0], e.jsx("br", {}), _.headline[1]]
                        }), e.jsx(q.p, {
                            variants: T,
                            id: "nap-toast-desc",
                            style: {
                                fontSize: "13.5px",
                                lineHeight: 1.55,
                                letterSpacing: "-0.008em",
                                color: y.body,
                                margin: 0,
                                maxWidth: "300px",
                                textWrap: "pretty"
                            },
                            children: _.standfirst
                        }), e.jsx(q.dl, {
                            variants: T,
                            style: {
                                display: "grid",
                                gridTemplateColumns: "repeat(3, auto)",
                                justifyContent: "start",
                                columnGap: "30px",
                                margin: "28px 0 0",
                                padding: 0
                            },
                            children: _.stats.map(({ value: P, label: z }) => e.jsxs("div", {
                                children: [e.jsx("dt", {
                                        style: {
                                            fontSize: "24px",
                                            fontWeight: 600,
                                            letterSpacing: "-0.03em",
                                            color: y.strong,
                                            lineHeight: 1,
                                            fontVariantNumeric: "tabular-nums"
                                        },
                                        children: P
                                    }), e.jsx("dd", {
                                        style: {
                                            margin: "7px 0 0",
                                            fontSize: "12px",
                                            fontWeight: 500,
                                            letterSpacing: "-0.004em",
                                            color: y.quiet,
                                            lineHeight: 1.2
                                        },
                                        children: z
                                    })]
                            }, z))
                        }), e.jsxs(q.div, {
                            variants: T,
                            style: {
                                marginTop: "auto",
                                paddingTop: "32px",
                                display: "flex",
                                alignItems: "center",
                                gap: "22px",
                                flexWrap: "wrap"
                            },
                            children: [e.jsxs("button", {
                                    type: "button",
                                    onClick: M,
                                    onPointerEnter: P => {
                                        P.pointerType === "mouse" && p(!0);
                                    },
                                    onPointerLeave: () => {
                                        p(!1), f(!1);
                                    },
                                    onPointerDown: () => f(!0),
                                    onPointerUp: () => f(!1),
                                    onFocus: P => {
                                        P.currentTarget.matches(":focus-visible") && p(!0);
                                    },
                                    onBlur: () => p(!1),
                                    style: {
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        padding: "9px 14px",
                                        borderRadius: "9px",
                                        border: `1px solid ${v ? d ? "rgba(11,16,32,0.46)" : "rgba(11,16,32,0.22)" : d ? "rgba(255,255,255,0.44)" : "rgba(255,255,255,0.24)"}`,
                                        background: v ? d ? "rgba(11,16,32,0.04)" : "rgba(11,16,32,0)" : d ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0)",
                                        outline: "none",
                                        cursor: "pointer",
                                        fontFamily: gm,
                                        fontSize: "13px",
                                        fontWeight: 500,
                                        letterSpacing: "-0.01em",
                                        color: d ? y.strong : v ? "rgba(11,16,32,0.84)" : "rgba(255,255,255,0.88)",
                                        transform: h && !g ? "scale(0.97)" : "none",
                                        transition: `border-color ${N}ms ${wr}, background-color ${N}ms ${wr}, color ${N}ms ${wr}, transform 120ms ${wr}`
                                    },
                                    children: [e.jsx("span", {
                                            children: _.cta
                                        }), e.jsx(Zn, {
                                            size: 14,
                                            strokeWidth: 1.9,
                                            "aria-hidden": !0,
                                            style: {
                                                flex: "none",
                                                transform: d && !g ? "translateX(3px)" : "translateX(0)",
                                                transition: `transform ${N}ms ${wr}`
                                            }
                                        })]
                                }), e.jsx("button", {
                                    type: "button",
                                    onClick: A,
                                    style: {
                                        background: "none",
                                        border: 0,
                                        padding: "9px 0",
                                        cursor: "pointer",
                                        fontFamily: gm,
                                        fontSize: "13px",
                                        fontWeight: 500,
                                        letterSpacing: "-0.008em",
                                        color: y.faint,
                                        transition: `color 200ms ${wr}`
                                    },
                                    onMouseEnter: P => P.currentTarget.style.color = y.body,
                                    onMouseLeave: P => P.currentTarget.style.color = y.faint,
                                    onFocus: P => P.currentTarget.style.color = y.body,
                                    onBlur: P => P.currentTarget.style.color = y.faint,
                                    children: _.decline
                                })]
                        })]
                }), e.jsx("div", {
                    style: {
                        flex: "0 0 40%",
                        padding: "8px 8px 8px 0",
                        display: "flex"
                    },
                    children: e.jsxs("div", {
                        style: {
                            position: "relative",
                            flex: 1,
                            borderRadius: "14px",
                            overflow: "hidden",
                            background: "#E5E9EF",
                            boxShadow: v ? "inset 0 0 0 1px rgba(11,16,32,0.07)" : "none"
                        },
                        children: [e.jsx("div", {
                                "aria-hidden": !0,
                                style: {
                                    position: "absolute",
                                    inset: 0,
                                    backgroundImage: `url(${zP})`,
                                    backgroundSize: "auto 100%",
                                    backgroundPosition: "92% 44px",
                                    backgroundRepeat: "no-repeat",
                                    transform: c ? `scale(${1 + UP})` : "scale(1)",
                                    transformOrigin: "70% 50%",
                                    transition: g ? void 0 : `transform ${c ? HP : GP}ms ${wr}`,
                                    willChange: g ? void 0 : "transform",
                                    pointerEvents: "none"
                                }
                            }), e.jsx("button", {
                                type: "button",
                                onClick: S,
                                "aria-label": "Close",
                                style: {
                                    position: "absolute",
                                    top: "8px",
                                    right: "8px",
                                    zIndex: 2,
                                    width: "30px",
                                    height: "30px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 0,
                                    cursor: "pointer",
                                    background: "none",
                                    border: 0,
                                    borderRadius: "8px",
                                    color: xm.rest,
                                    transition: `color 180ms ${wr}, transform 160ms ${wr}`
                                },
                                onMouseEnter: P => {
                                    P.currentTarget.style.color = xm.hover;
                                },
                                onMouseLeave: P => {
                                    P.currentTarget.style.color = xm.rest, P.currentTarget.style.transform = "scale(1)";
                                },
                                onMouseDown: P => {
                                    P.currentTarget.style.transform = "scale(0.92)";
                                },
                                onMouseUp: P => {
                                    P.currentTarget.style.transform = "scale(1)";
                                },
                                children: e.jsx(Kt, {
                                    size: 14,
                                    strokeWidth: 2,
                                    color: "currentColor"
                                })
                            })]
                    })
                })]
        })
    });
}, t7 = "" + new URL("pro-CcTqtgCy.jpg", import.meta.url).href, n7 = [{
        name: "Max",
        price: "$25/mo",
        gist: "3× Standard's AI and voice",
        url: "https://checkout.dodopayments.com/buy/pdt_0NcM7JElX4Af6LNVFS1Yf"
    }, {
        name: "Ultra",
        price: "$35/mo",
        gist: "4.5× Standard's AI and voice",
        url: "https://checkout.dodopayments.com/buy/pdt_0NcM7rC2kAb69TFKsZnUU"
    }], cd = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif', ky = "0 30px 70px -28px rgba(16,24,40,0.40)", Sy = "0 40px 90px -30px rgba(0,0,0,0.85)", s7 = {
    strong: "#F2F2F4",
    body: "rgba(255,255,255,0.66)",
    quiet: "rgba(255,255,255,0.52)",
    faint: "rgba(255,255,255,0.48)"
}, a7 = {
    strong: "#0B1020",
    body: "rgba(11,16,32,0.68)",
    quiet: "rgba(11,16,32,0.66)",
    faint: "rgba(11,16,32,0.58)"
}, ha = "cubic-bezier(0.23, 1, 0.32, 1)", r7 = [.23, 1, .32, 1], i7 = .05, o7 = 1100, l7 = 700, dd = 420, ud = 280, bm = {
    rest: "rgba(11,16,32,0.55)",
    hover: "rgba(11,16,32,0.92)"
}, c7 = {
    hidden: {},
    show: {
        transition: {
            staggerChildren: .07,
            delayChildren: .14
        }
    }
}, d7 = {
    hidden: {
        opacity: 0,
        y: 10,
        filter: "blur(4px)"
    },
    show: {
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
        transition: {
            duration: .6,
            ease: r7
        }
    }
}, u7 = {
    hidden: {
        opacity: 0
    },
    show: {
        opacity: 1,
        transition: {
            duration: .3
        }
    }
}, p7 = ({ isOpen: t, onDismiss: n, onUpgrade: s }) => {
    const [a, r] = o.useState(!1), [i, c] = o.useState(!1), [l, d] = o.useState(!1), [p, h] = o.useState(!1);
    o.useEffect(() => {
        t && h(!1);
    }, [t]);
    const [f, m] = o.useState(null), u = Ft() ?? !1, g = Gt() === "light", v = g ? a7 : s7, y = g ? "rgba(11,16,32,0.12)" : "rgba(255,255,255,0.10)", [b, k] = o.useState(!1), x = yt.useRef(null);
    o.useEffect(() => {
        t && (k(!1), x.current = null);
    }, [t]);
    const j = N => {
        x.current || (x.current = N, k(!0));
    }, w = () => {
        const N = x.current;
        x.current = null, N?.();
    }, C = () => {
        j(() => n());
    }, S = () => {
        j(() => n("never"));
    }, A = () => {
        h(!0), n("acted"), s();
    }, M = N => {
        window.electronAPI?.openExternal ? window.electronAPI.openExternal(N, {
            surface: "max_ultra_toaster"
        }) : window.open(N, "_blank"), j(() => n("acted"));
    };
    o.useEffect(() => {
        if (!t) {
            r(!1), c(!1), d(!1), m(null);
            return;
        }
        const N = _ => {
            _.key === "Escape" && C();
        };
        return window.addEventListener("keydown", N), () => window.removeEventListener("keydown", N);
    }, [t, n]);
    const E = u ? u7 : d7, T = i ? dd : ud;
    return e.jsx(hs, {
        open: t && !b,
        onClosed: () => {
            w();
        },
        label: "MaxUltraUpgradeToaster",
        zIndex: 9998,
        closeInstantly: p,
        onBackdropClick: C,
        backdropStyle: {
            background: g ? "rgba(10,10,18,0.30)" : "rgba(0,0,0,0.80)"
        },
        padding: 16,
        wrapStyle: {
            width: "600px",
            maxWidth: "100%"
        },
        cardStyle: {
            background: g ? "#F7F8FC" : "#1C1C1E",
            boxShadow: g ? "inset 0 0 0 1px rgba(11,16,32,0.10), inset 0 1px 0 rgba(255,255,255,0.80), " + ky : "inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06), " + Sy,
            fontFamily: cd,
            WebkitFontSmoothing: "antialiased"
        },
        cardProps: {
            role: "dialog",
            "aria-modal": !0,
            "aria-labelledby": "muu-toast-title",
            "aria-describedby": "muu-toast-desc",
            onPointerEnter: N => {
                !u && N.pointerType === "mouse" && r(!0);
            },
            onPointerLeave: () => r(!1)
        },
        shadow: g ? ky : Sy,
        radius: 20,
        children: e.jsxs("div", {
            style: {
                display: "flex",
                alignItems: "stretch",
                minHeight: "440px"
            },
            children: [e.jsxs(q.div, {
                    variants: c7,
                    initial: u ? "hidden" : !1,
                    animate: "show",
                    style: {
                        position: "relative",
                        zIndex: 2,
                        flex: "1 1 58%",
                        minWidth: 0,
                        padding: "40px 28px 34px 40px",
                        display: "flex",
                        flexDirection: "column"
                    },
                    children: [e.jsx(q.div, {
                            variants: E,
                            style: {
                                fontSize: "12px",
                                fontWeight: 500,
                                letterSpacing: "-0.005em",
                                color: v.quiet,
                                margin: "0 0 22px"
                            },
                            children: "Natively plans"
                        }), e.jsxs(q.h2, {
                            variants: E,
                            id: "muu-toast-title",
                            style: {
                                fontSize: "34px",
                                fontWeight: 300,
                                letterSpacing: "-0.032em",
                                lineHeight: 1.08,
                                margin: "0 0 20px",
                                color: v.strong
                            },
                            children: ["Outgrown Pro?", e.jsx("br", {}), "Go further."]
                        }), e.jsx(q.p, {
                            variants: E,
                            id: "muu-toast-desc",
                            style: {
                                fontSize: "13.5px",
                                lineHeight: 1.55,
                                letterSpacing: "-0.008em",
                                color: v.body,
                                margin: 0,
                                maxWidth: "300px",
                                textWrap: "pretty"
                            },
                            children: "More AI tokens, more transcription minutes and a bigger knowledge base, for the months you need more."
                        }), e.jsx(q.div, {
                            variants: E,
                            style: {
                                margin: "26px 0 0"
                            },
                            children: n7.map(({ name: N, price: _, gist: P, url: z }, O) => {
                                const B = f === N;
                                return e.jsxs("button", {
                                    type: "button",
                                    onClick: () => M(z),
                                    onPointerEnter: V => {
                                        V.pointerType === "mouse" && m(N);
                                    },
                                    onPointerLeave: () => m(null),
                                    onFocus: V => {
                                        V.currentTarget.matches(":focus-visible") && m(N);
                                    },
                                    onBlur: () => m(null),
                                    "aria-label": `${N}, ${_}: ${P}. Opens checkout`,
                                    style: {
                                        display: "grid",
                                        gridTemplateColumns: "1fr 14px",
                                        alignItems: "center",
                                        columnGap: "12px",
                                        width: "100%",
                                        padding: "12px 0",
                                        background: "none",
                                        border: 0,
                                        outline: "none",
                                        borderTop: O ? `1px solid ${y}` : "none",
                                        cursor: "pointer",
                                        textAlign: "left",
                                        fontFamily: cd
                                    },
                                    children: [e.jsxs("span", {
                                            children: [e.jsxs("span", {
                                                    style: {
                                                        display: "block",
                                                        fontSize: "15px",
                                                        fontWeight: 600,
                                                        letterSpacing: "-0.015em",
                                                        color: v.strong
                                                    },
                                                    children: [N, " ", e.jsx("span", {
                                                            style: {
                                                                fontWeight: 500,
                                                                color: B ? v.strong : v.body,
                                                                transition: `color ${B ? dd : ud}ms ${ha}`
                                                            },
                                                            children: _
                                                        })]
                                                }), e.jsx("span", {
                                                    style: {
                                                        display: "block",
                                                        marginTop: "3px",
                                                        fontSize: "12px",
                                                        fontWeight: 500,
                                                        letterSpacing: "-0.004em",
                                                        color: v.quiet
                                                    },
                                                    children: P
                                                })]
                                        }), e.jsx(Zn, {
                                            size: 14,
                                            strokeWidth: 1.9,
                                            "aria-hidden": !0,
                                            color: B ? v.strong : v.body,
                                            style: {
                                                transform: B && !u ? "translateX(3px)" : "translateX(0)",
                                                transition: `transform ${B ? dd : ud}ms ${ha}, color ${B ? dd : ud}ms ${ha}`
                                            }
                                        })]
                                }, N);
                            })
                        }), e.jsxs(q.div, {
                            variants: E,
                            style: {
                                marginTop: "auto",
                                paddingTop: "30px",
                                display: "flex",
                                alignItems: "center",
                                gap: "20px",
                                flexWrap: "nowrap"
                            },
                            children: [e.jsxs("button", {
                                    type: "button",
                                    onClick: A,
                                    onPointerEnter: N => {
                                        N.pointerType === "mouse" && c(!0);
                                    },
                                    onPointerLeave: () => {
                                        c(!1), d(!1);
                                    },
                                    onPointerDown: () => d(!0),
                                    onPointerUp: () => d(!1),
                                    onFocus: N => {
                                        N.currentTarget.matches(":focus-visible") && c(!0);
                                    },
                                    onBlur: () => c(!1),
                                    style: {
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        flex: "none",
                                        whiteSpace: "nowrap",
                                        padding: "9px 14px",
                                        borderRadius: "9px",
                                        border: `1px solid ${g ? i ? "rgba(11,16,32,0.46)" : "rgba(11,16,32,0.22)" : i ? "rgba(255,255,255,0.44)" : "rgba(255,255,255,0.24)"}`,
                                        background: g ? i ? "rgba(11,16,32,0.04)" : "rgba(11,16,32,0)" : i ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0)",
                                        outline: "none",
                                        cursor: "pointer",
                                        fontFamily: cd,
                                        fontSize: "13px",
                                        fontWeight: 500,
                                        letterSpacing: "-0.01em",
                                        color: i ? v.strong : g ? "rgba(11,16,32,0.84)" : "rgba(255,255,255,0.88)",
                                        transform: l && !u ? "scale(0.97)" : "none",
                                        transition: `border-color ${T}ms ${ha}, background-color ${T}ms ${ha}, color ${T}ms ${ha}, transform 120ms ${ha}`
                                    },
                                    children: [e.jsx("span", {
                                            children: "Compare plans"
                                        }), e.jsx(Zn, {
                                            size: 14,
                                            strokeWidth: 1.9,
                                            "aria-hidden": !0,
                                            style: {
                                                flex: "none",
                                                transform: i && !u ? "translateX(3px)" : "translateX(0)",
                                                transition: `transform ${T}ms ${ha}`
                                            }
                                        })]
                                }), e.jsx("button", {
                                    type: "button",
                                    onClick: S,
                                    style: {
                                        background: "none",
                                        border: 0,
                                        padding: "9px 0",
                                        flex: "none",
                                        whiteSpace: "nowrap",
                                        cursor: "pointer",
                                        fontFamily: cd,
                                        fontSize: "13px",
                                        fontWeight: 500,
                                        letterSpacing: "-0.008em",
                                        color: v.faint,
                                        transition: `color 200ms ${ha}`
                                    },
                                    onMouseEnter: N => N.currentTarget.style.color = v.body,
                                    onMouseLeave: N => N.currentTarget.style.color = v.faint,
                                    onFocus: N => N.currentTarget.style.color = v.body,
                                    onBlur: N => N.currentTarget.style.color = v.faint,
                                    children: "I'm happy with Pro"
                                })]
                        })]
                }), e.jsx("div", {
                    style: {
                        flex: "0 0 40%",
                        padding: "8px 8px 8px 0",
                        display: "flex"
                    },
                    children: e.jsxs("div", {
                        style: {
                            position: "relative",
                            flex: 1,
                            borderRadius: "14px",
                            overflow: "hidden",
                            background: "#EDF0F5",
                            boxShadow: g ? "inset 0 0 0 1px rgba(11,16,32,0.07)" : "none"
                        },
                        children: [e.jsx("div", {
                                "aria-hidden": !0,
                                style: {
                                    position: "absolute",
                                    inset: 0,
                                    backgroundImage: `url(${t7})`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "88% 50%",
                                    transform: a ? `scale(${1 + i7})` : "scale(1)",
                                    transformOrigin: "70% 50%",
                                    transition: u ? void 0 : `transform ${a ? o7 : l7}ms ${ha}`,
                                    willChange: u ? void 0 : "transform",
                                    pointerEvents: "none"
                                }
                            }), e.jsx("button", {
                                type: "button",
                                onClick: C,
                                "aria-label": "Close",
                                style: {
                                    position: "absolute",
                                    top: "8px",
                                    right: "8px",
                                    zIndex: 2,
                                    width: "30px",
                                    height: "30px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: 0,
                                    cursor: "pointer",
                                    background: "none",
                                    border: 0,
                                    borderRadius: "8px",
                                    color: bm.rest,
                                    transition: `color 180ms ${ha}, transform 160ms ${ha}`
                                },
                                onMouseEnter: N => {
                                    N.currentTarget.style.color = bm.hover;
                                },
                                onMouseLeave: N => {
                                    N.currentTarget.style.color = bm.rest, N.currentTarget.style.transform = "scale(1)";
                                },
                                onMouseDown: N => {
                                    N.currentTarget.style.transform = "scale(0.92)";
                                },
                                onMouseUp: N => {
                                    N.currentTarget.style.transform = "scale(1)";
                                },
                                children: e.jsx(Kt, {
                                    size: 14,
                                    strokeWidth: 2,
                                    color: "currentColor"
                                })
                            })]
                    })
                })]
        })
    });
};
const CL = `
.ri-root {
    /* The panel's --pi-tertiary composites to ~3.2:1 dark / ~2.6:1 light, below
       WCAG AA at the sizes used here. Pre-existing debt in the wider panel;
       redefined for this subtree so it is not propagated. */
    --pi-tertiary: rgba(255, 255, 255, 0.50);

    --ri-covered: #34d399;
    --ri-partial: var(--pi-accent);
    --ri-missing: rgba(255, 255, 255, 0.16);

    /* Quadratic ease-out, for the bar draw only. Deliberately gentler than
       --pi-ease-out; see the "Bar draw" block below. */
    --ri-ease-draw: cubic-bezier(0.25, 0.46, 0.45, 0.94);


    container-type: inline-size;
    container-name: roleinsight;
}
.pi-root[data-theme='light'] .ri-root {
    --pi-secondary: #4b5563;
    --pi-tertiary: #4b5563;
    --ri-covered: #10b981;
    --ri-partial: var(--periwinkle-500);
    --ri-missing: rgba(0, 0, 0, 0.13);
}

/* ── Entry ── */
@keyframes ri-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.ri-block { animation: ri-in 280ms var(--pi-ease-out) both; }
.ri-block:nth-of-type(1) { animation-delay: 0ms; }
.ri-block:nth-of-type(2) { animation-delay: 50ms; }
.ri-block:nth-of-type(3) { animation-delay: 100ms; }

/* ── Header ── */
.ri-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; margin-bottom: 26px;
}
.ri-title {
    font-size: 28px; font-weight: 700; color: var(--pi-hero);
    line-height: 1.1; margin: 0; letter-spacing: -0.02em;
}
.ri-sub { font-size: 12px; color: var(--pi-secondary); margin-top: 7px; }
.ri-sub-sep { color: var(--pi-tertiary); margin: 0 6px; }

/* ── Verdict ── */
.ri-verdict { display: flex; align-items: baseline; gap: 16px; margin-bottom: 18px; }
.ri-pct {
    font-size: 34px; font-weight: 700; color: var(--pi-hero);
    line-height: 1; letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums; flex-shrink: 0;
    min-width: 62px;
}
.ri-verdict-text {
    font-size: 15px; font-weight: 600; color: var(--pi-hero);
    line-height: 1.4; letter-spacing: -0.01em; margin: 0;
}

/* ── Bar draw ──
   The bars are the one piece of this screen that carries a quantity, so they
   are drawn rather than shown: the fill sweeps left to right, with nothing
   drawn ahead of it. Segment order is covered → partial → missing, so
   the sweep reveals what is supported before it reveals the gaps.

   The sweep is a clip, and nothing is painted behind it. An earlier version
   used an opaque cover sliding off to the right — transform is compositable and
   clip-path is not, so the cover held its framerate better under main-thread
   load. But a cover only disappears if its colour matches whatever is behind
   the bar, and when it does not, the user sees a full-width filled rectangle
   sitting there for the entire draw while the real fill sweeps across it. That
   is a correctness bug traded for a performance win, and it is the wrong trade:
   clip-path can drop frames under load, a mismatched cover is visibly wrong
   every single time. With the track background also gone there is now nothing
   behind the clip at all, so the undrawn part of the bar is simply absent.

   This is an entry animation, not a state animation: it runs once per mount and
   deliberately does not replay on re-analysis, where the flex-grow transitions
   below retarget from the previous values instead.

   The draw has its own easing rather than reusing --pi-ease-out. That curve is
   tuned for short UI transitions, where an aggressive front-load is what makes a
   dropdown feel instant — it puts half the distance into the first 13% of the
   time. Over a draw this long the same curve reads as a snap followed by a
   crawl. A quadratic ease-out is roughly half as front-loaded: it still starts
   immediately, with no dead frames, but the sweep travels at a near-even rate
   and settles instead of lunging. See --ri-ease-draw above. */
@keyframes ri-draw {
    from { clip-path: inset(0 100% 0 0); }
    to   { clip-path: inset(0 0 0 0); }
}

/* ── Match bar ── */
.ri-bar {
    display: flex; width: 100%; height: 8px; border-radius: 4px;
    overflow: hidden; gap: 2px;
    /* Starts after the block behind it has begun settling, so the two read as
       one motion rather than a queue. */
    animation: ri-draw 950ms var(--ri-ease-draw) 150ms both;
}
.ri-bar > span {
    /* Width animates from its previous value so a re-analysis visibly moves the
       bar rather than snapping. Transition, not keyframes, so a rapid re-run
       retargets instead of restarting. */
    transition: flex-grow 480ms var(--pi-ease-out);
}
.ri-legend {
    display: flex; flex-wrap: wrap; gap: 6px 20px; margin-top: 12px;
    font-size: 11.5px; color: var(--pi-secondary);
}
.ri-legend-item { display: flex; align-items: center; gap: 7px; }
.ri-dot { width: 7px; height: 7px; border-radius: 2px; flex-shrink: 0; }
.ri-legend-n { color: var(--pi-primary); font-weight: 600; font-variant-numeric: tabular-nums; }

/* ── Area rows ── */
.ri-areas { margin-top: 26px; display: flex; flex-direction: column; gap: 9px; }
.ri-area {
    display: grid;
    grid-template-columns: minmax(84px, 116px) minmax(90px, 220px) auto;
    align-items: center; gap: 14px;
}
.ri-area-label { font-size: 12px; color: var(--pi-secondary); }
.ri-area-track {
    /* No track background. The segments already span the full width — covered,
       partial and missing sum to the total, and a bar with nothing in it is
       never rendered — so the track only ever showed through the 2px gaps.
       Leaving it out means there is no empty groove to see while the bar
       draws. */
    height: 6px; border-radius: 3px;
    overflow: hidden; display: flex; gap: 2px;
    /* Only the fill staggers — the label and the n/total are legible from the
       first frame, so nothing the user came to read is withheld.

       The base delay is the LAST step, not the first: buildAreas filters on
       c.category and can emit more rows than the four enumerated below, and an
       unenumerated row inheriting the first step would draw ahead of rows above
       it. Falling through to the tail keeps the cascade monotonic. */
    animation: ri-draw 750ms var(--ri-ease-draw) 810ms both;
}
.ri-area:nth-child(1) .ri-area-track { animation-delay: 350ms; }
.ri-area:nth-child(2) .ri-area-track { animation-delay: 465ms; }
.ri-area:nth-child(3) .ri-area-track { animation-delay: 580ms; }
.ri-area:nth-child(4) .ri-area-track { animation-delay: 695ms; }
.ri-area-track > span { transition: flex-grow 480ms var(--pi-ease-out); }
.ri-area-n {
    font-size: 11.5px; color: var(--pi-tertiary);
    font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* ── Exposures ── */
.ri-exp-label {
    font-size: 15px; font-weight: 700; color: var(--pi-hero);
    letter-spacing: -0.02em; margin: 0 0 10px;
}
.ri-exp { border-bottom: 1px solid var(--pi-border); }
.ri-exp:first-of-type { border-top: 1px solid var(--pi-border); }
.ri-exp-head {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    width: 100%; padding: 13px 2px; background: none; border: none;
    text-align: left; cursor: pointer; font-family: inherit;
    font-size: 13px; color: var(--pi-primary);
    transition: color 160ms ease;
}
.ri-exp-title { min-width: 0; }
.ri-exp-right { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }

/* Says which of these the user actually lacks. Without it "Be ready for" reads
   as one undifferentiated worry list and a real gap looks like a near-miss. */
.ri-exp-state { font-size: 11px; color: var(--pi-tertiary); white-space: nowrap; }
.ri-exp-state[data-state='missing'] { color: var(--pi-secondary); }

.ri-exp-chev {
    color: var(--pi-tertiary); flex-shrink: 0;
    transition: transform 260ms var(--pi-ease-out), color 160ms ease;
}
.ri-exp[data-open='true'] .ri-exp-chev { transform: rotate(180deg); }

@media (hover: hover) and (pointer: fine) {
    .ri-exp-head:hover { color: var(--pi-hero); }
    .ri-exp-head:hover .ri-exp-chev { color: var(--pi-secondary); }
}

/* Height is measured in JS (see useCollapse) — the grid 0fr to 1fr trick
   collapses to 0 because overflow:hidden zeroes a grid item's automatic
   minimum size, so the panel never opens. */
.ri-exp-body-wrap { height: 0; overflow: hidden; transition: height 260ms var(--pi-ease-out); }
.ri-exp-body {
    padding: 0 2px 16px;
    opacity: 0;
    transition: opacity 200ms ease 60ms;
}
.ri-exp[data-open='true'] .ri-exp-body { opacity: 1; }
.ri-exp-line {
    font-size: 12.5px; line-height: 1.65; margin: 0 0 8px;
    color: var(--pi-secondary); max-width: 62ch;
}
.ri-exp-line strong { color: var(--pi-primary); font-weight: 500; }
.ri-exp-src { font-size: 11px; color: var(--pi-tertiary); margin: 0; }
.ri-confirm { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.ri-confirm-q { font-size: 12px; color: var(--pi-secondary); margin-right: 4px; }

/* ── Empty state: the panel's own dashed card ── */
.ri-empty {
    display: flex; flex-direction: column; align-items: center;
    text-align: center; gap: 12px; padding: 32px 24px;
    border: 1px dashed var(--pi-border); border-radius: 12px;
}
.ri-empty-badge {
    width: 40px; height: 40px; border-radius: 20px;
    background: var(--pi-accent-subtle); border: 1px solid var(--pi-badge-border);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.ri-empty-title { font-size: 13px; font-weight: 600; color: var(--pi-primary); margin-bottom: 4px; }
.ri-empty-desc { font-size: 12px; color: var(--pi-secondary); line-height: 1.6; max-width: 260px; }
.ri-empty-desc strong { color: var(--pi-primary); font-weight: 600; }

/* ── Progress ── */
.ri-stage {
    display: flex; align-items: center; gap: 10px;
    font-size: 12.5px; padding: 7px 0; color: var(--pi-tertiary);
    transition: color 260ms ease;
}
.ri-stage[data-state='active'] { color: var(--pi-primary); }
.ri-stage[data-state='done'] { color: var(--pi-secondary); }

/* ── Notice ── */
/* The panel's hairline card (.pi-toggle-card) with the empty state's accent
   badge. No tinted wash and no coloured border: an amber box was the only
   amber on the page. Tone is carried by the badge and the words. */
.ri-notice {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 14px 12px 12px; border-radius: var(--pi-r-md);
    border: 1px solid var(--pi-border); background: var(--pi-card-bg);
}
.ri-notice-badge {
    width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: var(--pi-accent-subtle); border: 1px solid var(--pi-badge-border);
    color: var(--pi-accent-icon);
}
.ri-notice[data-tone='error'] .ri-notice-badge {
    background: var(--pi-danger-bg); color: var(--pi-danger);
    border-color: color-mix(in srgb, var(--pi-danger) 22%, transparent);
}
.ri-notice-body { min-width: 0; flex: 1; }
.ri-notice-title { font-size: 13px; font-weight: 600; color: var(--pi-primary); margin: 0 0 2px; }
.ri-notice-text { font-size: 12px; color: var(--pi-secondary); line-height: 1.5; margin: 0; max-width: 62ch; }
.ri-notice-action { display: flex; gap: 6px; flex-shrink: 0; }

/* ── Responsive: measured against the panel column, not the window ── */
@container roleinsight (max-width: 560px) {
    .ri-area { grid-template-columns: 1fr auto; gap: 4px 10px; }
    .ri-area-track { grid-column: 1 / -1; order: 3; }
    .ri-pct { font-size: 28px; min-width: 52px; }
    .ri-verdict { gap: 12px; }
    /* The action drops under the words, in line with them (badge + gap). */
    .ri-notice { flex-wrap: wrap; }
    .ri-notice-body { flex-basis: calc(100% - 44px); }
    .ri-notice-action { margin-left: 44px; }
}

@media (prefers-reduced-motion: reduce) {
    .ri-block { animation: none; }
    /* Reduced motion still gets the values, just not the sweep: with no
       animation the clip is never applied and the bar renders in full. */
    .ri-bar, .ri-area-track { animation: none; }
    .ri-bar > span, .ri-area-track > span { transition: none; }
    .ri-exp-body-wrap, .ri-exp-body { transition: none; }
    .ri-exp-chev { transition: none; }
}
`, _y = [{
        key: "reading_job_description",
        label: "Reading job description"
    }, {
        key: "structuring_requirements",
        label: "Mapping role requirements"
    }, {
        key: "finding_profile_evidence",
        label: "Finding supporting experience"
    }, {
        key: "evaluating_transferable_experience",
        label: "Evaluating transferable experience"
    }, {
        key: "validating_conclusions",
        label: "Validating conclusions"
    }, {
        key: "preparing_role_insight",
        label: "Preparing Role Insight"
    }], Ry = {
    covered: "Covered",
    partial: "Partial",
    missing: "Missing"
};
function nj(t) {
  switch (t) {
    case "proven":
      return "covered";
    case "transferable":
      return "partial";
    case "needs_evidence":
    case "confirmed_gap":
    case "requirement_not_met":
      return "missing";
    case "preferred":
      return null;
    default:
      return null;
  }
}
const AL = {
    "Core responsibilities": "Responsibilities",
    "Technical skills": "Technical",
    "Experience and seniority": "Experience",
    "Domain knowledge": "Domain",
    "Leadership and communication": "Leadership",
    "Education and certifications": "Education",
    "Logistics and hard requirements": "Operations"
};
function EL(t) {
  return AL[t] ?? t;
}
const TL = {
    missing: "Not on your résumé",
    partial: "Only partly evidenced",
    unconfirmed: "Needs confirming"
};
function IL(t) {
  const n = t.filter(h => h.total > 0);
  if (n.length === 0) return "Not enough evidence to judge this role yet.";
  const s = n.reduce((h, f) => ({
      covered: h.covered + f.covered,
      partial: h.partial + f.partial,
      total: h.total + f.total
    }), {
      covered: 0,
      partial: 0,
      total: 0
    }),
    a = s.total - s.covered - s.partial,
    r = n.filter(h => h.total >= 2),
    c = [...(r.length >= 2 ? r : n)].sort((h, f) => f.fill - h.fill),
    l = c[0],
    d = c[c.length - 1];
  return l && d && l.key !== d.key && l.fill - d.fill >= .25 ? `Strong on ${l.label.toLowerCase()}, thin on ${d.label.toLowerCase()}.` : s.covered / s.total >= .6 ? "Well covered across the role." : a / s.total >= .5 ? "Limited overlap with this role." : s.partial / s.total >= .5 ? "Broadly relevant experience, little of it directly evidenced." : "Mixed coverage across the role.";
}
const ML = new Set(["location", "authorization", "clearance", "logistics"]);
function _L(t) {
  const n = [];
  for (const s of t ?? []) {
    if (ML.has(s.category)) continue;
    const a = Math.max(0, (s.total ?? 0) - (s.preferred ?? 0));
    if (a === 0) continue;
    const r = s.proven ?? 0,
      i = s.transferable ?? 0;
    n.push({
      key: s.category ?? s.label,
      label: EL(s.label ?? ""),
      covered: r,
      partial: i,
      supported: r + i,
      total: a,
      fill: Math.min(1, (r + i * .5) / a)
    });
  }
  return n.sort((s, a) => {
    if (s.fill !== a.fill) return s.fill - a.fill;
    const r = s.total - s.covered - s.partial,
      i = a.total - a.covered - a.partial;
    return r !== i ? i - r : s.covered !== a.covered ? s.covered - a.covered : a.total - s.total;
  });
}
function RL(t, n) {
  const s = {
    covered: 0,
    partial: 0,
    missing: 0
  };
  for (const a of t ?? []) {
    if (a.excluded || a.hardGate) continue;
    const r = nj(n.get(a.id)?.status ?? "");
    r && (s[r] += 1);
  }
  return s;
}
const PL = 4;
function LL(t, n, s, a) {
  const r = new Map((a ?? []).map(c => [c.requirementId, c.state])),
    i = [];
  for (const c of t ?? []) {
    if (c.excluded) continue;
    const l = n.get(c.id);
    if (!l) continue;
    const d = nj(l.status);
    if (d === null || d === "covered") continue;
    const p = r.get(c.id),
      h = p === "not_met" || p === "needs_confirmation",
      f = c.priority === "critical" || c.priority === "important";
    if (!h && !f) continue;
    const m = p === "not_met" ? "missing" : p === "needs_confirmation" ? "unconfirmed" : d === "missing" ? "missing" : "partial",
      g = (p === "not_met" ? 0 : m === "missing" ? 10 : m === "unconfirmed" ? 30 : 40) + (c.priority === "critical" ? 0 : 5),
      v = (l.evidenceIds ?? []).map(y => s.get(y)).find(Boolean)?.sourceLocation ?? null;
    i.push({
      id: c.id,
      title: c.normalizedText,
      state: m,
      confirmed: !!l.userCorrected,
      asks: c.originalText,
      shows: l.explanation,
      source: v,
      weight: g
    });
  }
  return i.sort((c, l) => c.weight - l.weight).slice(0, PL);
}
function $L(t, n) {
  const s = t?.analysis ?? {},
    a = s.sourceMeta ?? {},
    r = s.coverage ?? {},
    i = new Map((t?.assessments ?? []).map(d => [d.requirementId, d])),
    c = new Map((t?.evidence ?? []).map(d => [d.id, d])),
    l = _L(r.categories ?? []);
  return {
    title: a.jdTitle || n?.jdTitle || "This role",
    company: a.jdCompany || n?.jdCompany || "",
    analysedAt: s.createdAt ?? null,
    percent: r.weightedCoverage == null ? null : Math.round(r.weightedCoverage * 100),
    verdict: IL(l),
    counts: RL(t?.requirements ?? [], i),
    areas: l,
    exposures: LL(t?.requirements ?? [], i, c, s.hardGates ?? [])
  };
}
const Py = {
    covered: "var(--ri-covered)",
    partial: "var(--ri-partial)",
    missing: "var(--ri-missing)"
}, sj = o.memo(({ counts: t }) => {
    const n = ["covered", "partial", "missing"];
    return n.reduce((a, r) => a + t[r], 0) === 0 ? null : e.jsxs(e.Fragment, {
        children: [e.jsx("div", {
                className: "ri-bar",
                role: "img",
                "aria-label": n.map(a => `${Ry[a]} ${t[a]}`).join(", "),
                children: n.filter(a => t[a] > 0).map(a => e.jsx("span", {
                    style: {
                        flexGrow: t[a],
                        flexBasis: 0,
                        background: Py[a]
                    }
                }, a))
            }), e.jsx("div", {
                className: "ri-legend",
                children: n.map(a => e.jsxs("span", {
                    className: "ri-legend-item",
                    children: [e.jsx("span", {
                            className: "ri-dot",
                            style: {
                                background: Py[a]
                            },
                            "aria-hidden": "true"
                        }), Ry[a], " ", e.jsx("span", {
                            className: "ri-legend-n",
                            children: t[a]
                        })]
                }, a))
            })]
    });
});
const aj = o.memo(({ area: t }) => {
    const n = Math.max(0, t.total - t.covered - t.partial);
    return e.jsxs("div", {
        className: "ri-area",
        children: [e.jsx("span", {
                className: "ri-area-label",
                children: t.label
            }), e.jsxs("span", {
                className: "ri-area-track",
                role: "img",
                "aria-label": `${t.label}: ${t.supported} of ${t.total} supported`,
                children: [t.covered > 0 && e.jsx("span", {
                        style: {
                            flexGrow: t.covered,
                            flexBasis: 0,
                            background: "var(--ri-covered)"
                        }
                    }), t.partial > 0 && e.jsx("span", {
                        style: {
                            flexGrow: t.partial,
                            flexBasis: 0,
                            background: "var(--ri-partial)"
                        }
                    }), n > 0 && e.jsx("span", {
                        style: {
                            flexGrow: n,
                            flexBasis: 0,
                            background: "var(--ri-missing)"
                        }
                    })]
            }), e.jsxs("span", {
                className: "ri-area-n",
                children: [t.supported, "/", t.total]
            })]
    });
});
function DL(t) {
  const n = o.useRef(null),
    [s, a] = o.useState(t);
  return t && !s && a(!0), o.useLayoutEffect(() => {
    const r = n.current;
    if (!r) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      r.style.height = t ? "auto" : "0px", t || a(!1);
      return;
    }
    const i = r.getBoundingClientRect().height,
      c = t ? r.scrollHeight : 0;
    if (i === c) {
      t ? r.style.height = "auto" : a(!1);
      return;
    }
    r.style.height = `${i}px`, r.offsetHeight, r.style.height = `${c}px`;
    const l = d => {
      d.propertyName !== "height" || d.target !== r || (t ? r.style.height = "auto" : a(!1));
    };
    return r.addEventListener("transitionend", l), () => r.removeEventListener("transitionend", l);
  }, [t, s]), {
    ref: n,
    render: s
  };
}
const rj = o.memo(({ exposure: t, open: n, onToggle: s, onConfirm: a, confirmBusy: r }) => {
    const { ref: i, render: c } = DL(n);
    return e.jsxs("div", {
        className: "ri-exp",
        "data-open": n,
        children: [e.jsxs("button", {
                type: "button",
                className: "ri-exp-head",
                onClick: s,
                "aria-expanded": n,
                "aria-controls": `ri-exp-${t.id}`,
                children: [e.jsx("span", {
                        className: "ri-exp-title",
                        children: t.title
                    }), e.jsxs("span", {
                        className: "ri-exp-right",
                        children: [e.jsx("span", {
                                className: "ri-exp-state",
                                "data-state": t.state,
                                children: TL[t.state]
                            }), e.jsx(Wn, {
                                size: 15,
                                className: "ri-exp-chev",
                                "aria-hidden": "true"
                            })]
                    })]
            }), e.jsx("div", {
                className: "ri-exp-body-wrap",
                ref: i,
                children: e.jsx("div", {
                    className: "ri-exp-body",
                    id: `ri-exp-${t.id}`,
                    children: c && e.jsxs(e.Fragment, {
                        children: [e.jsxs("p", {
                                className: "ri-exp-line",
                                children: ["They ask for ", e.jsx("strong", {
                                        children: t.asks
                                    })]
                            }), e.jsx("p", {
                                className: "ri-exp-line",
                                children: t.shows
                            }), t.source && e.jsx("p", {
                                className: "ri-exp-src",
                                children: t.source
                            }), a && !t.confirmed && (t.state === "unconfirmed" || t.state === "missing") && e.jsxs("div", {
                                className: "ri-confirm",
                                children: [e.jsx("span", {
                                        className: "ri-confirm-q",
                                        children: t.state === "unconfirmed" ? "Can you confirm this?" : "Is this right?"
                                    }), e.jsx("button", {
                                        type: "button",
                                        className: "pi-pill-btn pi-press",
                                        disabled: r,
                                        onClick: () => a(t.state === "unconfirmed" ? "yes" : "no"),
                                        children: t.state === "unconfirmed" ? "Yes" : "That’s right"
                                    }), e.jsx("button", {
                                        type: "button",
                                        className: "pi-pill-btn pi-press",
                                        disabled: r,
                                        onClick: () => a(t.state === "unconfirmed" ? "no" : "yes"),
                                        children: t.state === "unconfirmed" ? "No" : "I have this"
                                    }), r && e.jsx(on, {
                                        size: 12,
                                        className: "pi-spinner",
                                        "aria-hidden": "true"
                                    })]
                            })]
                    })
                })
            })]
    });
});
const Ly = ({ Icon: t, title: n, children: s, cta: a }) => e.jsxs("div", {
    className: "ri-empty",
    children: [e.jsx("span", {
            className: "ri-empty-badge",
            children: e.jsx(t, {
                size: 18,
                "aria-hidden": "true",
                style: {
                    color: "var(--pi-accent-icon)"
                }
            })
        }), e.jsxs("div", {
            children: [e.jsx("div", {
                    className: "ri-empty-title",
                    children: n
                }), e.jsx("div", {
                    className: "ri-empty-desc",
                    children: s
                })]
        }), a && e.jsx(yn, {
            variant: "lavender",
            className: "lg-sm lg-wide pi-action-lg",
            disabled: a.busy,
            onClick: a.onClick,
            icon: a.busy ? e.jsx(on, {
                size: 12,
                className: "pi-spinner"
            }) : void 0,
            children: a.busy ? "Working…" : a.label
        })]
}), pd = ({ tone: t = "info", Icon: n = ia, title: s, children: a, action: r, busy: i }) => e.jsxs("div", {
    className: "ri-notice",
    "data-tone": t,
    role: t === "error" ? "alert" : void 0,
    children: [e.jsx("span", {
            className: "ri-notice-badge",
            children: e.jsx(n, {
                size: 15,
                "aria-hidden": "true",
                className: i ? "pi-spinner" : void 0
            })
        }), e.jsxs("div", {
            className: "ri-notice-body",
            children: [e.jsx("p", {
                    className: "ri-notice-title",
                    children: s
                }), e.jsx("p", {
                    className: "ri-notice-text",
                    children: a
                })]
        }), r && e.jsx("div", {
            className: "ri-notice-action",
            children: r
        })]
}), OL = () => e.jsx("div", {
    className: "ri-root",
    "aria-busy": "true",
    children: e.jsx("span", {
        role: "status",
        style: {
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0 0 0 0)"
        },
        children: "Loading Role Insight"
    })
}), $y = ({ hasAccess: t, onNeedUpgrade: n, onGoToProfile: s }) => {
    const a = () => window.electronAPI, [r, i] = o.useState(null), [c, l] = o.useState(null), [d, p] = o.useState(!0), [h, f] = o.useState(!1), [m, u] = o.useState(null), [g, v] = o.useState(null), [y, b] = o.useState(null), [k, x] = o.useState(null), j = o.useRef(!0);
    o.useEffect(() => (j.current = !0, () => {
        j.current = !1;
    }), []);
    const w = o.useCallback(async () => {
        try {
            const E = await a()?.roleInsightGetStatus?.();
            if (!j.current)
                return;
            if (i(E ?? null), f(!!E?.analysing), u(E?.stage ?? null), E?.hasAnalysis) {
                const T = await a()?.roleInsightGetReport?.();
                if (!j.current)
                    return;
                T?.success && T.report && l(T.report);
            }
        }
        catch (E) {
            j.current && v({
                message: E?.message ?? "Could not load Role Insight."
            });
        }
        finally {
            j.current && p(!1);
        }
    }, []);
    o.useEffect(() => {
        w();
    }, [w]), o.useEffect(() => {
        const E = a()?.onRoleInsightProgress?.(T => {
            j.current && (u(T?.stage ?? null), f(!!T?.analysing), T && T.analysing === !1 && w());
        });
        return () => {
            try {
                E?.();
            }
            catch { }
        };
    }, []);
    const C = o.useCallback(async () => {
        if (!t) {
            n();
            return;
        }
        v(null), f(!0), u("reading_job_description");
        try {
            const E = await a()?.roleInsightAnalyse?.({});
            if (!j.current)
                return;
            E?.success && E.report ? (l(E.report), b(null)) : E?.cancelled || v({
                message: E?.error ?? "The analysis could not be completed.",
                diagnosticId: E?.diagnosticId
            });
        }
        catch (E) {
            j.current && v({
                message: E?.message ?? "The analysis could not be completed."
            });
        }
        finally {
            j.current && (f(!1), u(null)), w();
        }
    }, [t, n, w]), S = o.useCallback(async (E, T) => {
        if (c?.analysis?.id) {
            x(E);
            try {
                const N = await a()?.roleInsightAnswerClarification?.({
                    analysisId: c.analysis.id,
                    requirementId: E,
                    answer: T
                });
                if (!j.current)
                    return;
                N?.success && N.report ? l(N.report) : N?.success || v({
                    message: N?.error ?? "That answer could not be saved."
                });
            }
            finally {
                j.current && x(null);
            }
        }
    }, [c?.analysis?.id]), A = o.useMemo(() => c ? $L(c, r) : null, [c, r]), M = E => e.jsxs("div", {
        className: "ri-root",
        children: [e.jsx("style", {
                children: CL
            }), E]
    });
    if (d)
        return M(e.jsx(OL, {}));
    if (r && r.available === !1)
        return M(e.jsx(pd, {
            tone: "error",
            title: "Role Insight could not start",
            children: "Something prevented Role Insight from initialising in this session. Restart Natively; if this keeps happening, contact support."
        }));
    if (!r?.hasResume || !r?.hasJobDescription) {
        const E = !r?.hasResume;
        return M(e.jsx(Ly, {
            Icon: E ? Xs : eu,
            title: E ? "No résumé yet" : "No job description yet",
            cta: s ? {
                label: "Open Identity",
                onClick: s
            } : void 0,
            children: E ? e.jsxs(e.Fragment, {
                children: ["Add your résumé in ", e.jsx("strong", {
                        children: "Identity"
                    }), " and Role Insight will match it against the role."]
            }) : e.jsxs(e.Fragment, {
                children: ["Add the job description in ", e.jsx("strong", {
                        children: "Identity"
                    }), " and Role Insight will show how you match."]
            })
        }));
    }
    if (h && !c) {
        const E = Math.max(0, _y.findIndex(T => T.key === m));
        return M(e.jsx("div", {
            role: "status",
            "aria-live": "polite",
            children: _y.map((T, N) => {
                const _ = N < E ? "done" : N === E ? "active" : "pending";
                return e.jsxs("div", {
                    className: "ri-stage",
                    "data-state": _,
                    children: [_ === "done" ? e.jsx(YS, {
                            size: 13,
                            "aria-hidden": "true"
                        }) : _ === "active" ? e.jsx(on, {
                            size: 13,
                            className: "pi-spinner",
                            "aria-hidden": "true"
                        }) : e.jsx(XS, {
                            size: 13,
                            "aria-hidden": "true"
                        }), T.label]
                }, T.key);
            })
        }));
    }
    return M(A ? e.jsxs(e.Fragment, {
        children: [g && e.jsx("div", {
                style: {
                    marginBottom: 20
                },
                children: e.jsx(pd, {
                    tone: "error",
                    title: "Role Insight could not complete",
                    action: e.jsxs("button", {
                        type: "button",
                        className: "pi-pill-btn pi-press",
                        onClick: C,
                        children: [e.jsx(on, {
                                size: 11,
                                "aria-hidden": "true"
                            }), " Try again"]
                    }),
                    children: g.message
                })
            }), c.outdated && e.jsx("div", {
                style: {
                    marginBottom: 20
                },
                children: e.jsx(pd, {
                    Icon: on,
                    title: h ? "Updating" : "Out of date",
                    busy: h,
                    action: h ? void 0 : e.jsx(yn, {
                        variant: "lavender",
                        className: "lg-sm lg-wide pi-action-lg",
                        icon: e.jsx(on, {
                            size: 12
                        }),
                        onClick: C,
                        children: "Re-analyse"
                    }),
                    children: h ? "Re-analysing with your latest changes…" : "Your résumé or the job description changed since this ran."
                })
            }), e.jsxs("div", {
                className: "ri-head ri-block",
                children: [e.jsxs("div", {
                        style: {
                            minWidth: 0
                        },
                        children: [e.jsx("h2", {
                                className: "ri-title",
                                children: A.title
                            }), e.jsxs("div", {
                                className: "ri-sub",
                                children: [A.company, A.company && e.jsx("span", {
                                        className: "ri-sub-sep",
                                        "aria-hidden": "true",
                                        children: "·"
                                    }), "analysed ", zL(A.analysedAt)]
                            })]
                    }), !c.outdated && e.jsxs("button", {
                        type: "button",
                        className: "pi-pill-btn pi-press",
                        onClick: C,
                        disabled: h,
                        style: {
                            flexShrink: 0
                        },
                        children: [e.jsx(on, {
                                size: 12,
                                className: h ? "pi-spinner" : "",
                                "aria-hidden": "true"
                            }), h ? "Updating…" : "Re-analyse"]
                    })]
            }), e.jsxs("div", {
                className: "ri-block",
                children: [e.jsxs("div", {
                        className: "ri-verdict",
                        children: [e.jsx("span", {
                                className: "ri-pct",
                                children: A.percent === null ? "—" : `${A.percent}%`
                            }), e.jsx("p", {
                                className: "ri-verdict-text",
                                children: A.verdict
                            })]
                    }), e.jsx(sj, {
                        counts: A.counts
                    }), A.areas.length > 0 && e.jsx("div", {
                        className: "ri-areas",
                        children: A.areas.map(E => e.jsx(aj, {
                            area: E
                        }, E.key))
                    })]
            }), A.exposures.length > 0 && e.jsxs("div", {
                className: "ri-block",
                style: {
                    marginTop: 32
                },
                children: [e.jsx("h3", {
                        className: "ri-exp-label",
                        children: "Be ready for"
                    }), A.exposures.map(E => e.jsx(rj, {
                        exposure: E,
                        open: y === E.id,
                        onToggle: () => b(y === E.id ? null : E.id),
                        onConfirm: T => {
                            S(E.id, T);
                        },
                        confirmBusy: k === E.id
                    }, E.id))]
            })]
    }) : e.jsxs(e.Fragment, {
        children: [g && e.jsx("div", {
                style: {
                    marginBottom: 20
                },
                children: e.jsx(pd, {
                    tone: "error",
                    title: "Role Insight could not complete",
                    action: e.jsxs("button", {
                        type: "button",
                        className: "pi-pill-btn pi-press",
                        onClick: C,
                        children: [e.jsx(on, {
                                size: 11,
                                "aria-hidden": "true"
                            }), " Try again"]
                    }),
                    children: g.message
                })
            }), e.jsxs(Ly, {
                Icon: eu,
                title: "Ready to analyse",
                cta: {
                    label: "Analyse Role",
                    onClick: C
                },
                children: ["How your experience matches", " ", e.jsx("strong", {
                        children: r?.jdTitle || "this role"
                    }), r?.jdCompany ? e.jsxs(e.Fragment, {
                        children: [" at ", e.jsx("strong", {
                                children: r.jdCompany
                            })]
                    }) : null, "."]
            })]
    }));
};
function zL(t) {
  if (!t) return "recently";
  const n = new Date(t).getTime();
  if (!Number.isFinite(n)) return "recently";
  const s = Math.max(0, Math.round((Date.now() - n) / 6e4));
  if (s < 1) return "just now";
  if (s < 60) return `${s}m ago`;
  const a = Math.round(s / 60);
  if (a < 24) return `${a}h ago`;
  const r = Math.round(a / 24);
  return r < 30 ? `${r}d ago` : new Date(n).toLocaleDateString();
}
export { QR as ProfileVisualizer, fP as ProfileFeatureToaster, _P as JDAwarenessToaster, PP as RemoteCampaignToaster, DP as NegotiationCoachingCard, QP as NativelyApiPromoToaster, p7 as MaxUltraUpgradeToaster, $y as RoleInsightPanel };
