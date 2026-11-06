// Recovered declaration closure; runtime React and translations come from the host app.
import { r } from "./data-runtime.js";
const f = e => e.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(), v = (...e) => e.filter((t, y, h) => !!t && t.trim() !== "" && h.indexOf(t) === y).join(" ").trim();
var b = {
    xmlns: "http://www.w3.org/2000/svg",
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round"
};
const w = r.forwardRef(({ color: e = "currentColor", size: t = 24, strokeWidth: y = 2, absoluteStrokeWidth: h, className: c = "", children: k, iconNode: l, ...n }, d) => r.createElement("svg", {
    ref: d,
    ...b,
    width: t,
    height: t,
    stroke: e,
    strokeWidth: h ? Number(y) * 24 / Number(t) : y,
    className: v("lucide", c),
    ...n
}, [...l.map(([u, g]) => r.createElement(u, g)), ...(Array.isArray(k) ? k : [k])]));
const a = (e, t) => {
    const y = r.forwardRef(({ className: h, ...c }, k) => r.createElement(w, {
        ref: k,
        iconNode: t,
        className: v(`lucide-${f(e)}`, h),
        ...c
    }));
    return y.displayName = `${e}`, y;
};
const Z = a("ArrowRight", [["path", {
            d: "M5 12h14",
            key: "1ays0h"
        }], ["path", {
            d: "m12 5 7 7-7 7",
            key: "xquz4c"
        }]]);
const U = a("AudioLines", [["path", {
            d: "M2 10v3",
            key: "1fnikh"
        }], ["path", {
            d: "M6 6v11",
            key: "11sgs0"
        }], ["path", {
            d: "M10 3v18",
            key: "yhl04a"
        }], ["path", {
            d: "M14 8v7",
            key: "3a1oy3"
        }], ["path", {
            d: "M18 5v13",
            key: "123xd1"
        }], ["path", {
            d: "M22 10v3",
            key: "154ddg"
        }]]);
const _ = a("Briefcase", [["path", {
            d: "M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",
            key: "jecpp"
        }], ["rect", {
            width: "20",
            height: "14",
            x: "2",
            y: "6",
            rx: "2",
            key: "i6l2r4"
        }]]);
const Q = a("Building2", [["path", {
            d: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",
            key: "1b4qmf"
        }], ["path", {
            d: "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",
            key: "i71pzd"
        }], ["path", {
            d: "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",
            key: "10jefs"
        }], ["path", {
            d: "M10 6h4",
            key: "1itunk"
        }], ["path", {
            d: "M10 10h4",
            key: "tcdvrf"
        }], ["path", {
            d: "M10 14h4",
            key: "kelpxr"
        }], ["path", {
            d: "M10 18h4",
            key: "1ulq68"
        }]]);
const c1 = a("Check", [["path", {
            d: "M20 6 9 17l-5-5",
            key: "1gmf2c"
        }]]);
const d1 = a("ChevronDown", [["path", {
            d: "m6 9 6 6 6-6",
            key: "qrunsl"
        }]]);
const s1 = a("CircleAlert", [["circle", {
            cx: "12",
            cy: "12",
            r: "10",
            key: "1mglay"
        }], ["line", {
            x1: "12",
            x2: "12",
            y1: "8",
            y2: "12",
            key: "1pkeuh"
        }], ["line", {
            x1: "12",
            x2: "12.01",
            y1: "16",
            y2: "16",
            key: "4dfq90"
        }]]);
const l1 = a("CircleCheck", [["circle", {
            cx: "12",
            cy: "12",
            r: "10",
            key: "1mglay"
        }], ["path", {
            d: "m9 12 2 2 4-4",
            key: "dzmm74"
        }]]);
const i1 = a("CircleDashed", [["path", {
            d: "M10.1 2.182a10 10 0 0 1 3.8 0",
            key: "5ilxe3"
        }], ["path", {
            d: "M13.9 21.818a10 10 0 0 1-3.8 0",
            key: "11zvb9"
        }], ["path", {
            d: "M17.609 3.721a10 10 0 0 1 2.69 2.7",
            key: "1iw5b2"
        }], ["path", {
            d: "M2.182 13.9a10 10 0 0 1 0-3.8",
            key: "c0bmvh"
        }], ["path", {
            d: "M20.279 17.609a10 10 0 0 1-2.7 2.69",
            key: "1ruxm7"
        }], ["path", {
            d: "M21.818 10.1a10 10 0 0 1 0 3.8",
            key: "qkgqxc"
        }], ["path", {
            d: "M3.721 6.391a10 10 0 0 1 2.7-2.69",
            key: "1mcia2"
        }], ["path", {
            d: "M6.391 20.279a10 10 0 0 1-2.69-2.7",
            key: "1fvljs"
        }]]);
const M1 = a("CircleDollarSign", [["circle", {
            cx: "12",
            cy: "12",
            r: "10",
            key: "1mglay"
        }], ["path", {
            d: "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8",
            key: "1h4pet"
        }], ["path", {
            d: "M12 18V6",
            key: "zqpxq5"
        }]]);
const b1 = a("Clock", [["circle", {
            cx: "12",
            cy: "12",
            r: "10",
            key: "1mglay"
        }], ["polyline", {
            points: "12 6 12 12 16 14",
            key: "68esgv"
        }]]);
const q1 = a("Code", [["polyline", {
            points: "16 18 22 12 16 6",
            key: "z7tu5w"
        }], ["polyline", {
            points: "8 6 2 12 8 18",
            key: "1eg1df"
        }]]);
const A1 = a("Copy", [["rect", {
            width: "14",
            height: "14",
            x: "8",
            y: "8",
            rx: "2",
            ry: "2",
            key: "17jyea"
        }], ["path", {
            d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
            key: "zix9uf"
        }]]);
const U1 = a("ExternalLink", [["path", {
            d: "M15 3h6v6",
            key: "1q9fwt"
        }], ["path", {
            d: "M10 14 21 3",
            key: "gplh6r"
        }], ["path", {
            d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
            key: "a6xqqp"
        }]]);
const N1 = a("FileText", [["path", {
            d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",
            key: "1rqfz7"
        }], ["path", {
            d: "M14 2v4a2 2 0 0 0 2 2h4",
            key: "tnqrlb"
        }], ["path", {
            d: "M10 9H8",
            key: "b1mrlr"
        }], ["path", {
            d: "M16 13H8",
            key: "t4e002"
        }], ["path", {
            d: "M16 17H8",
            key: "z1uh3a"
        }]]);
const h2 = a("GraduationCap", [["path", {
            d: "M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z",
            key: "j76jl0"
        }], ["path", {
            d: "M22 10v6",
            key: "1lu8f3"
        }], ["path", {
            d: "M6 12.5V16a6 3 0 0 0 12 0v-3.5",
            key: "1r8lef"
        }]]);
const x2 = a("Info", [["circle", {
            cx: "12",
            cy: "12",
            r: "10",
            key: "1mglay"
        }], ["path", {
            d: "M12 16v-4",
            key: "1dtifu"
        }], ["path", {
            d: "M12 8h.01",
            key: "e9boi3"
        }]]);
const r0 = a("PenLine", [["path", {
            d: "M12 20h9",
            key: "t2du7b"
        }], ["path", {
            d: "M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z",
            key: "1ykcvy"
        }]]);
const z0 = a("RefreshCw", [["path", {
            d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",
            key: "v9h5vc"
        }], ["path", {
            d: "M21 3v5h-5",
            key: "1q7to0"
        }], ["path", {
            d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",
            key: "3uifl3"
        }], ["path", {
            d: "M8 16H3v5",
            key: "1cv678"
        }]]);
const _0 = a("Sparkles", [["path", {
            d: "M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",
            key: "4pj2yx"
        }], ["path", {
            d: "M20 3v4",
            key: "1olli1"
        }], ["path", {
            d: "M22 5h-4",
            key: "1gvqau"
        }], ["path", {
            d: "M4 17v2",
            key: "vumght"
        }], ["path", {
            d: "M5 18H3",
            key: "zchphs"
        }]]);
const ta = a("Target", [["circle", {
            cx: "12",
            cy: "12",
            r: "10",
            key: "1mglay"
        }], ["circle", {
            cx: "12",
            cy: "12",
            r: "6",
            key: "1vlfrh"
        }], ["circle", {
            cx: "12",
            cy: "12",
            r: "2",
            key: "1c9p78"
        }]]);
const sa = a("TrendingUp", [["polyline", {
            points: "22 7 13.5 15.5 8.5 10.5 2 17",
            key: "126l90"
        }], ["polyline", {
            points: "16 7 22 7 22 13",
            key: "kwv8wd"
        }]]);
const oa = a("TriangleAlert", [["path", {
            d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
            key: "wmoenq"
        }], ["path", {
            d: "M12 9v4",
            key: "juzpu7"
        }], ["path", {
            d: "M12 17h.01",
            key: "p32p05"
        }]]);
const ja = a("X", [["path", {
            d: "M18 6 6 18",
            key: "1bl5f8"
        }], ["path", {
            d: "m6 6 12 12",
            key: "d8bk6v"
        }]]);
export { _ as o, q1 as V, U1 as a8, h2 as ar, oa as cf, z0 as bB, N1 as ae, ta as c5, l1 as J, i1 as L, d1 as D, sa as ce, b1 as R, c1 as z, A1 as $, U as h, M1 as M, Z as e, ja as cu, Q as q, r0 as bn, s1 as I, _0 as bZ, x2 as aE };
