// Copied unchanged from natively-website src/components/glass/lenticular.ts (2026-11-07).
/**
 * Lenticular glass backdrops: eight abstract scenes seen through a sheet of
 * vertical glass ribs, drawn by one fragment shader.
 *
 * Each concept is a scene (ribbons, blobs, slabs: a few signed-distance
 * shapes lit like studio objects) and a palette. The glass is the same model
 * for all eight: every rib is a half-cylinder that bends the sample point toward
 * its own centre (so what is behind it is magnified in the middle and
 * compressed at the edges), a wider second sheet underneath bends it again a
 * little for depth, a soft frost blurs the sample, and the light catches a
 * broad band near one edge of each rib and falls off softly into the groove. The three
 * colour channels are bent by slightly different amounts, which is the
 * restrained spectral edge.
 *
 * In place of a scene the glass can bend a picture (`uImg`, cover-fitted).
 *
 * The scene is drawn in units where y runs -1 (bottom) to 1 (top) and x runs
 * -aspect to aspect (on a frame narrower than 3:4 the width is held at 0.75
 * and y grows instead); rib widths are in CSS px. Nothing here depends on the DOM.
 */

export type ConceptId = "chrome" | "mirage" | "obsidian" | "silk" | "monolith" | "horizon" | "mosaic" | "aurora";

export type GlassParams = {
  /** Rib width in CSS px. */
  rib: number;
  /** How far a rib bends what is behind it, 0 to 2. */
  distortion: number;
  /** Frost, 0 (clear) to 1 (milky). */
  blur: number;
  /** Strength of the rib highlights and groove shading, 0 to 2. */
  lighting: number;
  /** Spectral separation at the rib edges, 0 to 1. */
  dispersion: number;
};

export type Palette = [string, string, string, string, string];

export type Concept = {
  id: ConceptId;
  index: number;
  name: string;
  line: string;
  /** Whether UI laid over it should use light ink or dark ink. */
  surface: "light" | "dark";
  params: GlassParams;
  /** The default palette, then two alternatives: background top, background bottom, three object colours. */
  palettes: { name: string; colors: Palette }[];
};

export const CONCEPTS: Concept[] = [
  {
    id: "chrome",
    index: 0,
    name: "Liquid Chrome",
    line: "Sculptural silver ribbons on ivory, refracted through ribbed glass.",
    surface: "light",
    params: { rib: 18, distortion: 0.75, blur: 0.4, lighting: 0.9, dispersion: 0.3 },
    palettes: [
      { name: "Studio", colors: ["#F2F0EB", "#DCDAD5", "#4A4A52", "#FAFAFB", "#A8A8B1"] },
      { name: "Warm", colors: ["#F5EFE6", "#E2D8CA", "#54463F", "#FFF9F2", "#B9A697"] },
      { name: "Cool", colors: ["#EEF0F5", "#D3D7E2", "#3E4457", "#F8FAFF", "#9AA1B8"] },
    ],
  },
  {
    id: "mirage",
    index: 1,
    name: "Lavender Mirage",
    line: "Translucent flowing shapes in lavender and ivory behind fine ridges.",
    surface: "light",
    params: { rib: 12, distortion: 0.9, blur: 0.35, lighting: 0.8, dispersion: 0.3 },
    palettes: [
      { name: "Natively", colors: ["#FAF7FE", "#DCCDF9", "#C2AAFA", "#E8BDEF", "#A9BBFF"] },
      { name: "Dawn", colors: ["#FDF7F4", "#F3D9E6", "#F0B7CF", "#D9C4F5", "#F6D8B8"] },
      { name: "Mist", colors: ["#F6F8FC", "#DCE3F2", "#C4D2F2", "#D8CCEF", "#E2E7F0"] },
    ],
  },
  {
    id: "obsidian",
    index: 2,
    name: "Obsidian Glass",
    line: "Smoky glass forms on charcoal, with held-back highlights.",
    surface: "dark",
    params: { rib: 16, distortion: 0.8, blur: 0.3, lighting: 0.7, dispersion: 0.25 },
    palettes: [
      { name: "Charcoal", colors: ["#1B1B21", "#0A0A0D", "#2C2C35", "#8F94A8", "#3D3D48"] },
      { name: "Ink", colors: ["#161A26", "#07090F", "#232A3A", "#8EA2C8", "#2E3647"] },
      { name: "Graphite", colors: ["#202022", "#0E0E10", "#333336", "#B8B8BD", "#47474B"] },
    ],
  },
  {
    id: "silk",
    index: 3,
    name: "Prismatic Silk",
    line: "Pearl ribbons with a faint spectrum caught along their folds.",
    surface: "light",
    params: { rib: 14, distortion: 0.9, blur: 0.25, lighting: 0.9, dispersion: 0.6 },
    palettes: [
      { name: "Pearl", colors: ["#F6F4F9", "#D7D0E0", "#FFFFFF", "#F0A6DA", "#A2C9F2"] },
      { name: "Opal", colors: ["#F4F7F8", "#CFDBE1", "#FFFFFF", "#9FDCCB", "#C3ABF0"] },
      { name: "Rose", colors: ["#FAF4F5", "#E6CDD4", "#FFFCFC", "#F3A9B6", "#BDB0F2"] },
    ],
  },
  {
    id: "monolith",
    index: 4,
    name: "Monolithic Forms",
    line: "A slab, an arc and a disc, seen through precision-cut flutes.",
    surface: "light",
    params: { rib: 24, distortion: 1.1, blur: 0.15, lighting: 1.1, dispersion: 0.2 },
    // Background top, background bottom, the disc, the slab, the arc.
    palettes: [
      { name: "Violet", colors: ["#F4EFFD", "#E2D6F9", "#9C6FF3", "#FFFFFF", "#CDBBFB"] },
      { name: "Lavender", colors: ["#F1EBFC", "#DBCCF8", "#3B2D6E", "#FBF9FF", "#B9A1F6"] },
      { name: "Mist", colors: ["#F6F3FC", "#E3D9F7", "#C2AAFA", "#FFFFFF", "#A9BBFF"] },
      { name: "Dusk", colors: ["#E4DBF5", "#C9B8EE", "#2E2A38", "#F7F3FF", "#9C6FF3"] },
      { name: "Periwinkle", colors: ["#EDF0FA", "#D3DBF4", "#4F5AA8", "#FFFFFF", "#C9B6FB"] },
      { name: "Ivory", colors: ["#F7F4EE", "#E9E3D8", "#4B2E8C", "#FFFDF8", "#C9BFE6"] },
      { name: "Charcoal", colors: ["#2A2534", "#15121D", "#B9A1F6", "#3D3649", "#E8BDEF"] },
      { name: "Stone", colors: ["#EBE7E1", "#D8D3CB", "#3A3A41", "#F5F1EA", "#C9BFE6"] },
    ],
  },
  {
    id: "horizon",
    index: 6,
    name: "Violet Horizon",
    line: "A violet sphere rising from the foot of the frame, broken into columns by wide flutes. The /enterprise hero's ground.",
    surface: "light",
    params: { rib: 22, distortion: 1.0, blur: 0.2, lighting: 0.9, dispersion: 0.35 },
    // Background top, background bottom, the sphere's shade, its halo, its lit side.
    palettes: [
      { name: "Violet", colors: ["#FAF8FE", "#EEE6FD", "#6D43DB", "#CDB8FB", "#F6F1FF"] },
      { name: "Dusk", colors: ["#F4EFFD", "#E4D9F8", "#4B2E8C", "#B9A1F6", "#EFE6FF"] },
      { name: "Rose", colors: ["#FCF7FB", "#F3E3F2", "#B35FC9", "#E8BDEF", "#FBF1FB"] },
    ],
  },
  {
    id: "mosaic",
    index: 7,
    name: "Frosted Mosaic",
    line: "Soft square tiles in lavender, periwinkle and veil pink, each fading in and out on its own clock, under the aurora's frost. The /pro hero's ground.",
    surface: "light",
    params: { rib: 12, distortion: 0.7, blur: 0.75, lighting: 0.6, dispersion: 0.3 },
    // Background top, background bottom, the three tile colours.
    palettes: [
      { name: "Violet", colors: ["#F3F0FB", "#EAE4F9", "#C8B4F3", "#B5C5F3", "#E3C9F1"] },
      { name: "Lilac", colors: ["#F6F2FC", "#ECE4FA", "#D3BFF6", "#C9B4F4", "#EBD3F3"] },
      { name: "Periwinkle", colors: ["#F1F2FB", "#E4E7F8", "#BFC9F4", "#B5BEF2", "#D8CCF5"] },
    ],
  },
  {
    id: "aurora",
    index: 5,
    name: "Frosted Aurora",
    line: "Pale blue, silver and violet waves under heavy frost, layered deep.",
    surface: "light",
    params: { rib: 10, distortion: 0.7, blur: 0.8, lighting: 0.6, dispersion: 0.3 },
    palettes: [
      { name: "Polar", colors: ["#EAF0F8", "#F5F3FA", "#C5D7F4", "#D5CAF1", "#E2E6EC"] },
      { name: "Violet", colors: ["#F1EEF9", "#E7E1F7", "#CDBDF3", "#B9C9F3", "#EBE4F8"] },
      { name: "Silver", colors: ["#F2F3F5", "#E6E8EC", "#CFD5DE", "#D9D3EA", "#F7F8FA"] },
    ],
  },
];

export const conceptById = (id: ConceptId): Concept => CONCEPTS.find((c) => c.id === id) ?? CONCEPTS[0];

/** The eight scenes behind the glass, then the glass. One program, `uConcept` picks the scene. */
export const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 uRes; uniform float uDpr; uniform float uTime; uniform vec2 uMouse;
uniform float uRib; uniform float uDist; uniform float uBlur; uniform float uLight; uniform float uDisp;
uniform int uConcept;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4;
uniform sampler2D uImg; uniform float uHasImg; uniform vec2 uImgSize;

float soft(float d, float e) { return 1.0 - smoothstep(0.0, e, d); }
float sdEllipse(vec2 p, vec2 c, vec2 r, float turn) {
  float s = sin(turn), co = cos(turn); vec2 d = p - c; d = vec2(co * d.x - s * d.y, s * d.x + co * d.y) / r;
  return (length(d) - 1.0) * min(r.x, r.y);
}
float sdBox(vec2 p, vec2 c, vec2 b, float r) { vec2 q = abs(p - c) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdCircle(vec2 p, vec2 c, float r) { return length(p - c) - r; }
/* A band around y = a sin(b x + c) + d, half width w; slope out for shading. */
float ribbon(vec2 p, float a, float b, float c, float d, float w, out float u, out float slope) {
  float y = a * sin(b * p.x + c) + d; slope = a * b * cos(b * p.x + c); u = (p.y - y) / w; return abs(p.y - y) - w;
}
float shadow(float d, float r) { return soft(d, r) * 0.22; }
float hash1(float n) { return fract(sin(n * 91.345) * 47453.5453); }
/* Shadows lean violet, toward the site's ink, instead of going grey. */
const vec3 SHADE = vec3(0.95, 1.08, 0.62);

/* 0 Liquid Chrome: three metal ribbons on an ivory studio ground. */
vec3 sceneChrome(vec2 p, float t) {
  vec3 col = mix(uC1, uC0, smoothstep(-1.1, 1.0, p.y + 0.25 * p.x));
  col *= 1.0 - 0.08 * smoothstep(0.9, 1.9, length(p * vec2(0.6, 1.0)));
  float u, s;
  float d3 = ribbon(p, 0.16, 2.2, 1.0 + t * 0.05, 0.72, 0.07, u, s);
  col *= 1.0 - SHADE * shadow(ribbon(p + vec2(0.03, 0.06), 0.16, 2.2, 1.0 + t * 0.05, 0.72, 0.07, u, s), 0.12);
  d3 = ribbon(p, 0.16, 2.2, 1.0 + t * 0.05, 0.72, 0.07, u, s);
  { float ny = 1.0 / sqrt(1.0 + s * s); vec3 m = mix(uC2, uC3, smoothstep(-1.4, 1.2, u * 0.9 + s * 0.35 + 0.1));
    m += uC3 * exp(-pow((u + 0.4) / 0.22, 2.0)) * 0.6 * ny; m = mix(m, uC2, exp(-pow((u - 0.3) / 0.2, 2.0)) * 0.45);
    col = mix(col, m, soft(d3, 0.006)); }
  float d1 = ribbon(p, 0.3, 1.1, 0.4 + t * 0.07, 0.18, 0.17, u, s);
  col *= 1.0 - SHADE * shadow(ribbon(p + vec2(0.04, 0.09), 0.3, 1.1, 0.4 + t * 0.07, 0.18, 0.17, u, s), 0.16);
  d1 = ribbon(p, 0.3, 1.1, 0.4 + t * 0.07, 0.18, 0.17, u, s);
  { float ny = 1.0 / sqrt(1.0 + s * s); vec3 m = mix(uC2, uC3, smoothstep(-1.4, 1.2, u * 0.9 + s * 0.35 + 0.1));
    m += uC3 * exp(-pow((u + 0.4) / 0.22, 2.0)) * 0.6 * ny; m = mix(m, uC2, exp(-pow((u - 0.3) / 0.2, 2.0)) * 0.45);
    m = mix(m, uC4, 0.15 * smoothstep(0.6, 1.0, abs(u)));
    col = mix(col, m, soft(d1, 0.006)); }
  float d2 = ribbon(p, 0.22, 1.6, 2.1 - t * 0.06, -0.4, 0.11, u, s);
  col *= 1.0 - SHADE * shadow(ribbon(p + vec2(0.04, 0.08), 0.22, 1.6, 2.1 - t * 0.06, -0.4, 0.11, u, s), 0.14);
  d2 = ribbon(p, 0.22, 1.6, 2.1 - t * 0.06, -0.4, 0.11, u, s);
  { float ny = 1.0 / sqrt(1.0 + s * s); vec3 m = mix(uC2, uC3, smoothstep(-1.4, 1.2, u * 0.9 - s * 0.35 + 0.1));
    m += uC3 * exp(-pow((u + 0.4) / 0.22, 2.0)) * 0.6 * ny; m = mix(m, uC2, exp(-pow((u - 0.3) / 0.2, 2.0)) * 0.45);
    col = mix(col, m, soft(d2, 0.006)); }
  return col;
}

/* 1 Lavender Mirage: translucent shapes drifting on an ivory-to-lavender ground. */
vec3 sceneMirage(vec2 p, float t) {
  vec3 col = mix(uC0, uC1, smoothstep(-1.0, 1.2, -p.y + 0.3 * p.x));
  float a = sdEllipse(p, vec2(-0.55 + 0.05 * sin(t * 0.3), 0.25), vec2(0.62, 0.34), -0.5);
  float b = sdEllipse(p, vec2(0.55, -0.1 + 0.04 * cos(t * 0.27)), vec2(0.58, 0.42), 0.35);
  float c = sdEllipse(p, vec2(0.05 + 0.05 * cos(t * 0.21), -0.62), vec2(0.9, 0.22), 0.12);
  col = mix(col, uC2, 0.6 * soft(a, 0.14));
  col = mix(col, uC3, 0.55 * soft(b, 0.16));
  col = mix(col, uC4, 0.5 * soft(c, 0.14));
  col = mix(col, vec3(1.0), 0.35 * soft(a, 0.02) * soft(b, 0.02));
  float u, s; float r = ribbon(p, 0.12, 2.4, 0.8 + t * 0.1, 0.55, 0.035, u, s);
  col = mix(col, vec3(1.0), 0.45 * soft(r, 0.01));
  return col;
}

/* 2 Obsidian Glass: smoky dark forms with a cool rim light, on charcoal. */
vec3 sceneObsidian(vec2 p, float t) {
  vec3 col = mix(uC1, uC0, smoothstep(-1.0, 1.0, p.y - 0.2 * p.x));
  col = mix(col, uC4, 0.5 * soft(sdCircle(p, vec2(0.2, 0.3), 0.3), 1.2));
  vec3 L = normalize(vec3(-0.5, 0.8, 0.5));
  float ds[3]; vec2 cs[3];
  ds[0] = sdEllipse(p, vec2(-0.5 + 0.03 * sin(t * 0.2), 0.15), vec2(0.5, 0.36), -0.35);
  ds[1] = sdEllipse(p, vec2(0.55, -0.2 + 0.03 * cos(t * 0.25)), vec2(0.46, 0.3), 0.25);
  ds[2] = sdEllipse(p, vec2(0.1, -0.7), vec2(0.8, 0.2), 0.08);
  for (int i = 0; i < 3; i++) {
    float d = ds[i];
    vec2 e = vec2(0.01, 0.0);
    float dx = (i == 0 ? sdEllipse(p + e.xy, vec2(-0.5 + 0.03 * sin(t * 0.2), 0.15), vec2(0.5, 0.36), -0.35)
             : i == 1 ? sdEllipse(p + e.xy, vec2(0.55, -0.2 + 0.03 * cos(t * 0.25)), vec2(0.46, 0.3), 0.25)
             : sdEllipse(p + e.xy, vec2(0.1, -0.7), vec2(0.8, 0.2), 0.08)) - d;
    float dy = (i == 0 ? sdEllipse(p + e.yx, vec2(-0.5 + 0.03 * sin(t * 0.2), 0.15), vec2(0.5, 0.36), -0.35)
             : i == 1 ? sdEllipse(p + e.yx, vec2(0.55, -0.2 + 0.03 * cos(t * 0.25)), vec2(0.46, 0.3), 0.25)
             : sdEllipse(p + e.yx, vec2(0.1, -0.7), vec2(0.8, 0.2), 0.08)) - d;
    vec3 n = normalize(vec3(dx, dy, 0.012));
    float inside = soft(d, 0.01);
    float rim = pow(1.0 - abs(n.z), 1.2);
    float lit = max(0.0, dot(n, L));
    vec3 body = mix(uC2, uC4, 0.5 + 0.5 * p.y) * (0.65 + 0.45 * lit);
    body += uC3 * rim * (0.35 + 0.65 * lit) * 0.9 * smoothstep(0.045, 0.0, abs(d));
    col = mix(col, body, inside * 0.92);
    col *= 1.0 - 0.18 * soft(d - 0.01, 0.1) * (1.0 - inside);
  }
  return col;
}

/* 3 Prismatic Silk: wide pearl ribbons, a faint spectrum along their folds. */
vec3 sceneSilk(vec2 p, float t) {
  vec3 col = mix(uC0, uC1, smoothstep(-1.0, 1.0, -p.y + 0.15 * p.x));
  float u, s;
  for (int i = 0; i < 3; i++) {
    float a = i == 0 ? 0.26 : i == 1 ? 0.2 : 0.14; float b = i == 0 ? 1.0 : i == 1 ? 1.5 : 2.1;
    float c = (i == 0 ? 0.3 : i == 1 ? 2.0 : 4.1) + t * (i == 0 ? 0.06 : -0.05);
    float off = i == 0 ? 0.3 : i == 1 ? -0.25 : -0.72; float w = i == 0 ? 0.2 : i == 1 ? 0.15 : 0.09;
    col *= 1.0 - SHADE * shadow(ribbon(p + vec2(0.03, 0.07), a, b, c, off, w, u, s), 0.14) * 0.6;
    float d = ribbon(p, a, b, c, off, w, u, s);
    float ny = 1.0 / sqrt(1.0 + s * s);
    vec3 m = mix(uC1, uC2, smoothstep(-1.0, 0.7, u * 0.9 + s * 0.3));
    m = mix(m, uC1, 0.35 * smoothstep(0.2, 1.0, u + s * 0.2));
    m += vec3(1.0) * exp(-pow((u + 0.35) / 0.2, 2.0)) * 0.3 * ny;
    float fold = smoothstep(0.3, 1.0, abs(u)) * (0.6 + 0.4 * abs(sin(p.x * 2.0 + float(i))));
    vec3 spec = mix(uC3, uC4, 0.5 + 0.5 * sin(p.x * 3.0 + u * 2.0 + float(i)));
    m = mix(m, spec, fold * 0.7);
    col = mix(col, m, soft(d, 0.008) * 0.96);
  }
  return col;
}

/* 4 Monolithic Forms: a disc, a slab and an arc, flat-lit, with soft contact shadows. The disc
   sits low on the right, out from behind words centred over the glass. */
vec3 sceneMonolith(vec2 p, float t) {
  vec3 col = mix(uC1, uC0, smoothstep(-1.0, 1.0, p.y + 0.1 * p.x));
  vec2 pd = p - vec2(0.03 * sin(t * 0.2), 0.0);
  float disc = sdCircle(pd, vec2(1.38, -0.5), 0.6);
  float slab = sdBox(p, vec2(-0.78, -0.05), vec2(0.15, 0.78), 0.14);
  float arc = abs(sdCircle(p, vec2(-0.2, -0.95), 0.75)) - 0.07;
  col *= 1.0 - SHADE * shadow(sdCircle(pd + vec2(-0.05, 0.1), vec2(1.38, -0.5), 0.6), 0.22);
  col *= 1.0 - SHADE * shadow(sdBox(p + vec2(-0.04, 0.08), vec2(-0.78, -0.05), vec2(0.15, 0.78), 0.14), 0.18);
  col *= 1.0 - SHADE * shadow(abs(sdCircle(p + vec2(-0.03, 0.06), vec2(-0.2, -0.95), 0.75)) - 0.07, 0.14) * 0.8;
  vec3 discCol = uC2 * (0.9 + 0.18 * smoothstep(-0.5, 0.65, pd.y)) ;
  discCol += uC3 * 0.08 * smoothstep(0.55, 0.6, length(pd - vec2(1.38, -0.5)));
  col = mix(col, discCol, soft(disc, 0.006));
  vec3 slabCol = mix(uC3, uC1, 0.35 * smoothstep(-0.9, 0.9, -p.y)) * (1.0 - 0.1 * smoothstep(-0.93, -0.63, p.x));
  col = mix(col, slabCol, soft(slab, 0.006));
  vec3 arcCol = uC4 * (0.92 + 0.12 * smoothstep(-1.0, 0.0, p.y));
  col = mix(col, arcCol, soft(arc, 0.006));
  return col;
}

/* 5 Frosted Aurora: layered translucent waves in pale blue, violet and silver. */
vec3 sceneAurora(vec2 p, float t) {
  vec3 col = mix(uC0, uC1, smoothstep(-1.0, 1.0, p.y));
  float u, s;
  for (int i = 0; i < 4; i++) {
    float a = i == 0 ? 0.3 : i == 1 ? 0.22 : i == 2 ? 0.18 : 0.26;
    float b = i == 0 ? 0.9 : i == 1 ? 1.4 : i == 2 ? 2.0 : 1.1;
    float c = (i == 0 ? 0.2 : i == 1 ? 1.6 : i == 2 ? 3.3 : 5.0) + t * (0.12 + 0.05 * float(i));
    float off = (i == 0 ? 0.45 : i == 1 ? 0.05 : i == 2 ? -0.4 : -0.8) + 0.06 * sin(t * 0.3 + float(i) * 1.7);
    a *= 1.0 + 0.15 * sin(t * 0.21 + float(i));
    float w = i == 0 ? 0.26 : i == 1 ? 0.2 : i == 2 ? 0.16 : 0.3;
    vec3 wc = i == 0 ? uC2 : i == 1 ? uC3 : i == 2 ? uC4 : uC2;
    float d = ribbon(p, a, b, c, off, w, u, s);
    float body = soft(d, 0.1) * 0.5;
    body += exp(-pow((u + 0.5) / 0.3, 2.0)) * 0.25 * soft(d, 0.02);
    col = mix(col, wc, body);
    col = mix(col, vec3(1.0), 0.12 * exp(-pow((u - 0.2) / 0.25, 2.0)) * soft(d, 0.02));
  }
  return col;
}

/* 6 Violet Horizon: a lit sphere rising out of the foot of the frame, its crest a thin
   bright line and its halo on a pale ground; a smaller one high on the left for depth. */
vec3 sceneHorizon(vec2 p, float t) {
  vec3 col = mix(uC1, uC0, smoothstep(-1.0, 0.8, p.y));
  vec2 c = vec2(0.02 * sin(t * 0.2), -1.95);
  float r = 1.66;
  vec2 q = (p - c) / r;
  float d = length(p - c) - r;
  col = mix(col, uC3, 0.75 * exp(-max(d, 0.0) * 2.2));
  col = mix(col, uC4, 0.35 * exp(-max(d, 0.0) * 9.0));
  float z = sqrt(max(0.0, 1.0 - dot(q, q)));
  vec3 n = vec3(q, z);
  vec3 L = normalize(vec3(-0.45, 0.75, 0.5));
  float lit = max(0.0, dot(n, L));
  vec3 body = mix(uC2, uC4, smoothstep(0.0, 1.0, 0.05 + 0.55 * lit));
  body += vec3(1.0) * pow(max(0.0, dot(reflect(-L, n), vec3(0.0, 0.0, 1.0))), 18.0) * 0.35;
  body = mix(body, uC3, pow(1.0 - z, 2.5) * 0.55);
  col = mix(col, body, soft(d, 0.006));
  col = mix(col, vec3(1.0), 0.7 * exp(-abs(d + 0.012) / 0.012));
  vec2 c2 = vec2(-1.05, 0.55); float r2 = 0.2;
  float d2 = length(p - c2) - r2; vec2 q2 = (p - c2) / r2;
  float z2 = sqrt(max(0.0, 1.0 - dot(q2, q2)));
  float lit2 = max(0.0, dot(vec3(q2, z2), L));
  col *= 1.0 - SHADE * shadow(length(p - c2 - vec2(0.03, -0.05)) - r2, 0.12) * 0.5;
  col = mix(col, mix(uC3, uC4, lit2), soft(d2, 0.006) * 0.9);
  return col;
}

/* 7 Frosted Mosaic: a grid of soft tiles, each breathing in and out on its own clock,
   fuller at the sides and the top so the words in the middle keep a clear ground. */
vec3 sceneMosaic(vec2 p, float t) {
  vec3 col = mix(uC1, uC0, smoothstep(-1.0, 1.0, p.y));
  vec2 g = p / 0.34;
  vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  float hs = hash1(id.x * 17.0 + id.y * 131.0);
  float k = 0.5 + 0.5 * sin(t * 0.45 + hs * 6.283);
  vec3 cc = hs < 0.33 ? uC2 : hs < 0.66 ? uC3 : uC4;
  float field = 0.35 + 0.65 * smoothstep(0.2, 1.6, abs(p.x)) + 0.4 * smoothstep(0.3, 1.0, p.y);
  float amt = (0.12 + 0.6 * k * hs) * min(field, 1.0);
  return mix(col, cc, amt * soft(sdBox(f, vec2(0.0), vec2(0.42), 0.14), 0.06));
}

vec3 scene(vec2 p, float t) {
  if (uConcept == 0) return sceneChrome(p, t);
  if (uConcept == 1) return sceneMirage(p, t);
  if (uConcept == 2) return sceneObsidian(p, t);
  if (uConcept == 3) return sceneSilk(p, t);
  if (uConcept == 4) return sceneMonolith(p, t);
  if (uConcept == 6) return sceneHorizon(p, t);
  if (uConcept == 7) return sceneMosaic(p, t);
  return sceneAurora(p, t);
}

/* A picture in place of the scene: the image cover-fitted to the frame, at a
   point in CSS px from the bottom left (the image's rows run top down). */
vec3 picture(vec2 q, vec2 res) {
  vec2 uv = q / res;
  float fr = res.x / res.y, ir = uImgSize.x / uImgSize.y;
  uv = (uv - 0.5) * (fr > ir ? vec2(1.0, ir / fr) : vec2(fr / ir, 1.0)) + 0.5;
  return texture2D(uImg, vec2(uv.x, 1.0 - uv.y)).rgb;
}

/* The glass. */
void main() {
  vec2 res = uRes / uDpr;
  vec2 px = gl_FragCoord.xy / uDpr;
  /* The scene keeps at least three quarters of its width on a tall, narrow
     frame (a phone), so its forms stay in the picture instead of off both sides. */
  float aspect = res.x / res.y;
  float ax = max(aspect, 0.75);
  float ay = ax / aspect;
  vec2 par = (uMouse - 0.5) * vec2(0.14, 0.07);
  float t = uTime;

  /* The wide sheet underneath, a light bend for depth. */
  float w2 = uRib * 3.1;
  float ph2 = fract(px.x / w2 + 0.31) - 0.5;
  float lens2 = sqrt(max(0.0, 1.0 - 4.0 * ph2 * ph2));
  float bend2 = -ph2 * w2 * 0.45 * uDist * (0.3 + 0.7 * lens2);

  /* The ribs. */
  float ph = fract(px.x / uRib) - 0.5;
  float lens = sqrt(max(0.0, 1.0 - 4.0 * ph * ph));
  float bend = -ph * uRib * 1.7 * uDist * (0.35 + 0.65 * lens);
  float dsp = uDisp * 0.09 * uRib * uDist;

  float bx = 1.0 + uBlur * 2.0, by = 1.0 + uBlur * 7.0;
  vec3 col = vec3(0.0);
  for (int i = -2; i <= 2; i++) {
    float fi = float(i);
    vec2 tap = vec2(fi * bx * 0.5, fi * by);
    vec2 qr = vec2(px.x + bend + bend2 - dsp, px.y) + tap;
    vec2 qg = vec2(px.x + bend + bend2, px.y) + tap;
    vec2 qb = vec2(px.x + bend + bend2 + dsp, px.y) + tap;
    vec2 sr = vec2((qr.x / res.x * 2.0 - 1.0) * ax, (qr.y / res.y * 2.0 - 1.0) * ay) + par;
    vec2 sg = vec2((qg.x / res.x * 2.0 - 1.0) * ax, (qg.y / res.y * 2.0 - 1.0) * ay) + par;
    vec2 sb = vec2((qb.x / res.x * 2.0 - 1.0) * ax, (qb.y / res.y * 2.0 - 1.0) * ay) + par;
    if (uHasImg > 0.5) {
      vec2 pp = par * res * 0.5;
      col += vec3(picture(qr + pp, res).r, picture(qg + pp, res).g, picture(qb + pp, res).b);
    } else {
      col += vec3(scene(sr, t).r, scene(sg, t).g, scene(sb, t).b);
    }
  }
  col /= 5.0;

  /* The light on the ribs: a soft roll-off into each groove (no hard line, which
     reads as a stripe overlay), a broad highlight near one edge, a thin specular
     line in it, and a sheen over the crown. */
  bool dark = uConcept == 2;
  float roll = pow(abs(ph) * 2.0, 4.0) * 0.065;
  float hi = exp(-pow((ph + 0.2) / 0.13, 2.0)) * 0.12;
  float spec = exp(-pow((ph + 0.3) / 0.04, 2.0)) * 0.1;
  float sheen = pow(lens, 3.0) * 0.035;
  vec3 lightCol = dark ? vec3(0.72, 0.76, 0.9) : vec3(1.0, 0.99, 1.0);
  col *= 1.0 - roll * uLight * vec3(1.0, 1.06, 0.8);
  col += lightCol * (hi + spec + sheen) * uLight * (dark ? 0.55 : 1.0) * (1.0 - 0.35 * dot(col, vec3(0.33)));
  col += spec * uLight * uDisp * vec3(0.05, 0.0, -0.04);
  gl_FragColor = vec4(col, 1.0);
}
`;

export const VERTEX_SHADER = "attribute vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}";

/** "#RRGGBB" to 0..1 floats. */
export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** The ribs in CSS, as a comb of light: the stand-ins' top layer. */
export const ribComb = (rib: number) =>
  `repeating-linear-gradient(90deg, rgba(255,255,255,0) 0px, rgba(255,255,255,0.35) ${rib * 0.22}px, rgba(255,255,255,0) ${rib * 0.3}px, rgba(0,0,0,0.05) ${rib * 0.9}px, rgba(255,255,255,0) ${rib}px)`;

/** A CSS stand-in for a concept when WebGL is not there: its ground, and the ribs as a comb of light. */
export const fallbackStyle = (concept: Concept, palette: Palette, rib: number): Record<string, string> => ({
  backgroundImage: [
    ribComb(rib),
    `radial-gradient(closest-side at 30% 40%, ${palette[2]}, transparent)`,
    `radial-gradient(closest-side at 75% 60%, ${palette[3]}, transparent)`,
    `linear-gradient(to bottom, ${palette[0]}, ${palette[1]})`,
  ].join(", "),
  backgroundColor: palette[1],
  color: concept.surface === "dark" ? "#fff" : "#000",
});
