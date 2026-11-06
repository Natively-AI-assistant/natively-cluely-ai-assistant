// Recovered declaration closure; runtime React and translations come from the host app.

const Wd = "natively_resolved_theme", Ld = "data-theme-switching", f0 = new WeakMap(), $d = /(^|-)color$|shadow|^fill$|^stroke|filter/;
function pd(z) {
  if (typeof z.getAnimations == "function") for (const A of z.getAnimations()) $d.test(A.transitionProperty ?? "") && A.finish();
}
function Kd(z) {
  if (!$d.test(z.propertyName ?? "")) return;
  const A = z.target;
  if (typeof A?.getAnimations != "function") return;
  const N = z.pseudoElement || null;
  for (const s of A.getAnimations()) s.transitionProperty === z.propertyName && (s.effect?.pseudoElement ?? null) === N && s.finish();
}
function vg(z, A) {
  try {
    z?.setItem(Wd, A);
  } catch {}
}
function Jd(z, A = {}) {
  const N = A.doc ?? (typeof document > "u" ? null : document);
  if (!N) return !1;
  const s = A.storage === void 0 ? typeof localStorage > "u" ? null : localStorage : A.storage,
    U = N.documentElement;
  vg(s, z);
  const X = f0.get(N);
  if (X) return X.target === z || (X.target = z, X.applied && U.setAttribute("data-theme", z)), !1;
  if (U.getAttribute("data-theme") === z) return !1;
  const cl = () => U.setAttribute("data-theme", z);
  if (!(A.animate !== !1 && typeof N.startViewTransition == "function" && N.visibilityState !== "hidden")) return cl(), !1;
  const Gt = {
      target: z,
      applied: !1
    },
    df = () => {
      Gt.applied = !0, U.setAttribute("data-theme", Gt.target);
    },
    Ca = () => new Promise(Re => setTimeout(Re, 0)),
    hl = () => {
      U.offsetHeight;
    },
    zt = async () => {
      df(), hl(), pd(N), await Ca(), await Ca(), hl(), pd(N);
    };
  let yu;
  U.setAttribute(Ld, ""), f0.set(N, Gt), N.addEventListener?.("transitionrun", Kd, !0);
  const Ra = () => {
    N.removeEventListener?.("transitionrun", Kd, !0), f0.delete(N), U.removeAttribute(Ld);
  };
  try {
    yu = N.startViewTransition(zt);
  } catch {
    return Ra(), cl(), !1;
  }
  return yu.ready?.catch?.(() => {}), yu.updateCallbackDone?.catch?.(() => {}), Promise.resolve(yu.finished).catch(() => {}).then(Ra), !0;
}
export { Jd as a };
