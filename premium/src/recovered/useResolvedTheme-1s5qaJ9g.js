// Recovered declaration closure; runtime React and translations come from the host app.
import { r as l } from "./data-runtime.js";
import { a as ae } from "./index-byU9h2Oi.js";
function b(...e) {
  return e.filter(Boolean).join(" ");
}
const R = () => document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark", C = new Set();
let A = null, v = null;
const Ne = e => {
    C.forEach(o => o(e));
}, Me = () => {
    v || (v = new MutationObserver(() => {
        Ne(R());
    }), v.observe(document.documentElement, {
        attributes: !0,
        attributeFilter: ["data-theme"]
    })), A || (A = window.electronAPI?.onThemeChanged?.(({ resolved: e }) => {
        ae(e);
    }) ?? null);
}, Re = () => {
    v?.disconnect(), v = null, A?.(), A = null;
}, Xe = () => {
    const [e, o] = l.useState(() => R());
    return l.useEffect(() => (Me(), C.add(o), o(R()), () => {
        C.delete(o), C.size === 0 && Re();
    }), []), e;
};
export { Xe as u, b as h };
