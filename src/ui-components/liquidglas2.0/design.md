# Liquid Glass 2.0 — the refractive lens

A translucent, tinted pill that **bends what is behind it** and is lit from a
corner. It is a different material from the one in [`../design.md`](../design.md)
("1.0"), and it is deliberately not built on `.lg-button`.

Code: [`LiquidGlassCta.tsx`](./LiquidGlassCta.tsx) ·
[`LiquidGlassCta.css`](./LiquidGlassCta.css) · refraction from
[`../GlassSurface.tsx`](../GlassSurface.tsx)

Reference: Figma community **Liquid Glass Button** (Matt Medley,
`figma.com/community/file/1514717388207593443`) — "stacked background blurs and
directional lighting", a layered lens stack with edge highlights. Read from the
community page's preview images and description; the file's node values were not
extracted, so nothing here is measured. It was derived by eye and by screenshot.

---

## 1.0 vs 2.0

| | 1.0 — `LiquidGlassButton` | 2.0 — `LiquidGlassCta` |
| --- | --- | --- |
| Body | flat, opaque | tinted, **translucent** |
| Depth comes from | a thin symmetric specular rim | refraction of the backdrop + a directional edge |
| Needs something behind it | no | **yes** — see "The light behind it" |
| Measured | yes (MAE 4.18/255) | no |
| Use it for | controls, settings rows, every scale down to a 30px row | a hero call to action over a surface you control |

1.0 is the right answer for a control in a dense UI. 2.0 is the answer when the
brief is "it should look like glass", because a flat body with a hairline rim
reads as a plate however well the rim is measured.

### Two earlier cuts, kept so they are not repeated

| Cut | What it was | Why it failed |
| --- | --- | --- |
| translucent tint + 42% white ramp + backdrop blur | a glossy top-lit gradient | "matte purple plate with no rim". It is the exact thing 1.0's first section says the material is not |
| a flat opaque `#7C5CE6` on `.lg-action`'s structure | correct to the *measured* material | "too flat, doesn't feel like liquid glass" — 1.0 has no lens |

---

## Anatomy

Four ingredients, and it is the combination that reads as glass. Drop any one
and the pill collapses back into a plate or a smudge.

| Layer | Element | Carries |
| --- | --- | --- |
| aura | `.glass-cta-aura` | two blurred light pools (lavender, blue) **behind** the pill |
| lens | `GlassSurface` (`.glass-cta__glass`) | the tint, plus an SVG displacement map as `backdrop-filter` |
| bevel | `.glass-cta__bevel` | inner light pooled top-left and bottom-right, a hairline, a top-face sheen |
| sheen | `.glass-cta__sheen` | a specular bloom upper-left, a weaker one lower-right |
| edge | `.glass-cta__edge` | a 1.5px ring, brightest top-left and bottom-right |
| label | `.glass-cta__label` | white, 600, a soft drop shadow |

### 1. A tinted, translucent body

`rgba(124, 92, 230, 0.42)` in dark, hover `0.54`. The page shows through it.
Light theme is `rgba(104, 72, 220, 0.88)` — on a light page the lens is mostly
tint, because a white label needs a dense body (about 5.0:1). In dark the label
sits over a composite that gives roughly 11:1.

### 2. Real refraction

`GlassSurface`'s SVG displacement map, fed to `backdrop-filter`. The values that
matter, all set in `LiquidGlassCta.tsx`:

| Prop | Value | Why |
| --- | --- | --- |
| `borderWidth` | `0.3` | the refracting band is 30% of half the short side (about 7px on a 48px pill) |
| `blur` | `3` | a blur wider than the band washes its gradient flat |
| `distortionScale` | `-46` | how hard the edge pulls |
| `yChannel` | `'B'` | the vertical alpha ramp; the default `'G'` is a flat constant |
| `red/green/blueOffset` | `0` | achromatic; a chromatic fringe reads as a rendering fault at button scale |
| `saturation` | `1.7` | glass over a colour intensifies it |

**Thin is the point.** At `borderWidth 0.5`, `blur 5`, `distortionScale -70` the
interior of the pill smeared into horizontal streaks. The reference is clean in
the middle and bends only at the rim.

### 3. A directional edge

Light comes from a corner, so the rim is not uniform.

- **Edge ring** — `linear-gradient(120deg, .95 → .38 → .07 → .07 → .38 → .95)`
  masked to a 1.5px ring. Bright at the top-left and bottom-right, nearly gone
  between.
- **Bevel** — `inset 3px 4px 7px -3px` (white .55) top-left, `inset -3px -4px 7px
  -3px` (.32) bottom-right, a 1px hairline, and a `0 14px 16px -12px` sheen down
  from the top face.
- **Sheen** — two radial blooms, upper-left and lower-right.

### 4. The light behind it

Glass over a flat page has nothing to bend. `GlassSurface`'s own notes say the
same ("at rest there is nothing behind the pill to refract; the effect is
invisible and looks broken"). The pill therefore carries its own **aura**: two
soft pools, `filter: blur(14px)`, lavender `rgba(150,112,255,.85)` and blue
`rgba(72,132,255,.70)`, extending 52px either side of the pill and 40px above
and below.

**Curved lines behind the pill were tried and removed.** Two thin arcs crossing
the pill kinked visibly at the rim and made the refraction obvious — and left
bright stray lines on the page around a button, and a busy swirl under the label.
Removed by request. The cost: see "Known limitation".

---

## Tokens

All on `.glass-cta-wrap`; the light theme re-keys them under `[data-theme='light']`.

| Token | Dark | Role |
| --- | --- | --- |
| `--cta-tint` / `--cta-tint-hover` | `rgba(124,92,230,.42)` / `.54` | the body |
| `--cta-glow` | `rgba(124,92,230,.55)` | the outer glow under the pill |
| `--cta-label` | `#fff` | label colour |
| `--cta-edge-hi/-mid/-lo` | `.95 / .38 / .07` white | the edge ring stops |
| `--cta-bevel-a/-b` | `.55 / .32` white | top-left / bottom-right bevel |
| `--cta-pool-a/-b` | lavender / blue | the aura pools |

## Interaction

- **hover** — the tint steps up (`.42 → .54`) and the glow lifts; gated to
  `(hover: hover) and (pointer: fine)`. 300ms `cubic-bezier(.37,0,.63,1)`, the
  same easeInOutSine 1.0 uses.
- **press** — `scale(.985)`, 160ms.
- **focus-visible** — a 2px white inset ring drawn on the bevel (the lens clips
  outlines, so the ring has to be inside the box).
- **reduced motion** — transitions and the press are dropped; the colour stays.
- **`prefers-contrast: more`** — the body goes to a near-opaque `rgba(78,52,190,.96)`
  and the edge ring to a flat white.

## Usage

```tsx
import { LiquidGlassCta } from './liquidglas2.0/LiquidGlassCta';

<LiquidGlassCta width={320} height={48} labelSize={15} onClick={next}>
    Get started <ArrowRight size={15} />
</LiquidGlassCta>
```

`width` and `height` are numbers because the displacement map is drawn in the
box's own pixels. The silhouette is a pill (`radius = height / 2`). The wrapper
is `inline-block` and its aura overflows it, so leave 52px either side and 40px
above and below clear of anything that should not be lit.

The CTA itself is **not currently used**. It was built for the first-launch welcome and shortcut
tour (`LavenderButton` in `src/components/onboarding/welcomeShared.tsx`, at
320x48, 132x40 and 210x40) and then taken out: the onboarding is back on PR 620's
own `.lg-lavender` button (`LiquidGlassButton.css`). Kept as a reference for the
refractive material.

**The material is used by the Launcher's calendar banners**
(`src/components/ui/UpcomingCalendarCard.tsx`, `BannerGlass`): each 44px meeting
pill is a `GlassSurface`, frostier and bending harder than this CTA (a 4px
`displace` blur, a 45% band, a 4px map blur, a -60 pull) under a thin 30% tint,
plus the CTA's own
`.glass-cta__bevel`, `.glass-cta__sheen` and `.glass-cta__edge`, fed the
`--cta-*` tokens on `.cal-banner`. No aura there: the card's indigo curtain is
the light the lens bends. Two things that host had to solve, both general:

- **Backdrop roots.** A lens goes blind under any ancestor with `filter`,
  `opacity < 1`, or `will-change` naming either. The banner stack put
  `filter: blur(0)` and `will-change: filter` on every card and faded and
  blurred the ones behind, so at rest every card drops the filter and the fade
  (`filter: none` still interpolates from an arriving card's blur in Chromium),
  the cards behind step back by a denser tint and a quieter rim instead, and
  `will-change` names `transform` only. **`will-change: opacity` is a backdrop root too:** left in, it blinded
  the lens silently. The computed `backdrop-filter` still read correctly, the
  tint still showed, and only the cards behind showing through crisp, whatever
  the frost, gave it away. Check a lens by what it does to something behind it.
- **Glass over glass.** Stacked translucent cards show each other's rims through
  their faces. The deck keeps every card whole and lets that show, by choice.
  To hide it instead, clip each card's glass LAYERS (`clip-path: inset()`) to
  the part not covered by the cards in front; a clip-path on the card itself
  would be a backdrop root and blind its lens.
- **Frost hides the glass behind.** With the lens working, a 2px `displace`
  already softens the stacked cards' edges behind the front one about 9x
  (sharpest luminance step .028 → .003); 4px also smooths the bend's streaks
  at the pill's end. (An earlier finding here, that frost "barely shows" over
  the smooth curtain, was measured with the lens blind; see backdrop roots.)

---

## Known limitation: it can read frosted

With nothing crisp behind it, the lens shows a smooth blurred gradient, and a
smooth blurred gradient is what frosted glass *is*. The white top sheen and the
42% tint add to the haze. Tried on screen (dark, 320x48), a less-hazy setting:

```css
.glass-cta .glass-cta__glass.glass-surface--svg { background: rgba(124, 92, 230, .26); }
.glass-cta__sheen { opacity: .35; }
.glass-cta__bevel { box-shadow:
    inset 3px 4px 7px -3px rgba(255,255,255,.5),
    inset -3px -4px 7px -3px rgba(255,255,255,.3),
    inset 0 0 0 1px rgba(255,255,255,.10); }
```

It is a little clearer and still smooth. **Not applied.** The open idea is a
crisp-edged light disc or two straddling the pill's ends, which would give the
lens a hard edge to bend without any lines; a first attempt was sized wrongly and
never rendered, so it is untested.

## Constraints

- **Chromium only.** `backdrop-filter: url(#svg-filter)` renders in Electron
  (Chromium 150); `GlassSurface` falls back to a blurred pane elsewhere, which
  looks like glass but does not refract.
- **Rendered on macOS only.** Windows resolves the font to Inter and the map
  renders in the same engine; not looked at.
- **Not measured.** No mean-absolute-error figure is claimed.
- **Needs an unfiltered ancestor chain.** An ancestor with `filter` or
  `opacity < 1` becomes a backdrop root and the lens stops seeing the aura. The
  welcome's own fade-in briefly does this.

## Verifying a change

1. Render at device scale 2 against the welcome page (`#161618` dark, `#F7F8FC`
   light), at 320x48 and 132x40.
2. The interior must be clean — no horizontal streaks — with the bend confined to
   about 7px at the rim.
3. The edge must be bright top-left and bottom-right and near-invisible between.
4. Label contrast: white on the light-theme body at least 4.5:1.
5. Compare against the reference's three previews (dark grey, green, orange).
