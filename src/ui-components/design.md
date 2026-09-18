# Liquid Glass button

The macOS 27 pill button, rebuilt from a reference screenshot and measured to a
mean absolute error of **4.18/255 per channel**. This document is the design
guide: what the material actually is, how each value was derived, and which
details are load-bearing.

Code: [`LiquidGlassButton.tsx`](./LiquidGlassButton.tsx) ·
[`LiquidGlassButton.css`](./LiquidGlassButton.css)

---

## What Liquid Glass actually is

**A flat material with a thin, directional specular rim.** Not a glossy
gradient pill.

This is the whole thing, and it is easy to get backwards. The instinct is to
reach for a top-lit vertical gradient — light at the top, dark at the bottom —
because that is what a glossy button has looked like since Aqua. Liquid Glass
does the opposite: the body is uniform, and every bit of depth lives in a
3px rim.

Sampling a vertical slice down the middle of the reference makes it obvious.
Grey channel values, top edge to bottom edge:

| | edge | +1 | +2 | +3 | body … | −3 | −2 | −1 | edge |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Liquid Glass** | 150 | 132 | 116 | 96 | **flat 84–85** | 98 | 115 | 132 | 150 |
| A glossy gradient | 64 | 106 | 126 | 131 | *115 → 71 ramp* | 75 | 65 | 25 | *no bottom rim* |

Two things fall out of that. The body does not ramp at all. And the rim is
**symmetric** — the bottom edge is as bright as the top, because the material
catches a bounce from below as well as the key light from above.

The rim is also **directional around the perimeter**. It is full strength
across the flat top and bottom, and dies away over the caps, whose surface
normals turn away from the light. Sampling the top edge horizontally:

| x from left edge | 2 | 22 | 42 | 62 | 82 | 102 | 122 | 142+ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| brightness | 27 | 73 | 116 | 138 | 138 | 143 | 149 | **150** |

At `x = 22` the rim is *darker* than the body (73 vs 85) — the cap shadow has
already reached up to meet it. A uniform ring around the perimeter is what
makes a pill read as a plastic capsule instead of glass.

---

## Anatomy

Four layers, because no single one can be both flat and directional.

| Layer | Carries |
| --- | --- |
| `background` | the flat tint, plus a soft inner sheen that carries the rim inward |
| `::before` | three stacked inset rings (the 150/132/116 falloff), aimed by two mask layers |
| `::after` | a ring mask that drops the left and right caps into shadow |
| `.lg-lens` | the pointer-tracked highlight and its local rim pickup |

The `::before` masks are the interesting part. The rings themselves are
uniform; two mask layers composited with `mask-composite: intersect` aim them:

```css
mask-image:
  /* vertical: keep the light on the top and bottom faces */
  linear-gradient(180deg, #000 0%, #000 3%, transparent 15%,
                          transparent 85%, #000 97%, #000 100%),
  /* horizontal: let it die away across the caps */
  linear-gradient(90deg, transparent var(--lg-cap-0),
                         rgba(0,0,0,.82) var(--lg-cap-1),
                         #000 var(--lg-cap-2), … );
mask-composite: intersect;
```

`::after` uses the other trick — the padding-box ring mask — to confine a
vertical gradient to the perimeter, so the caps darken without touching the
lit faces:

```css
padding: 2px;
mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
mask-composite: exclude;
```

---

## How the values were derived

Nothing here was eyeballed. The method, which generalises to any
"match this screenshot" job:

1. **Render at the reference's exact size, 1:1.** The reference was 1206×410,
   so the harness captured at 1206×410. No scaling on either side.
2. **Capture at device scale 1.** A 2× capture downscaled with LANCZOS
   overshoots on high-contrast edges — early runs reported pure white `255`
   text that was actually `#fafafa`. Resampling artefacts read as real
   differences.
3. **Write a metric harness, not an eyeball loop.** ~24 measurements —
   pill bounds, margins, gap, body colours, rim profiles, cap darkness, glyph
   bounding boxes, glyph colours, icon size, label spans — printed as a
   target-vs-current table each iteration.
4. **Iterate until the table stops moving.** 16 of 24 metrics land exact. The
   other 8 sit within 1–3 levels or 1px, and four of those are the rim-profile
   arrays, where the residual is the reference's own JPEG noise (see below).
5. **Score the whole frame** as a backstop, so a metric you forgot to measure
   still shows up: mean absolute error went **11.03 → 4.18** per channel, and
   pixels off by more than 8 went **28.4% → 3.8%**.

### Trust luma over chroma when the reference is a JPEG

The green rim's per-channel values never matched, and chasing them would have
been chasing compression. JPEG 4:2:0 subsamples chroma, which corrupts colour
precisely at 1–2px edges. Converting to luma settled it:

| | target | rebuilt | Δ |
| --- | --- | --- | --- |
| rim px 1 | 107.7 | 106.4 | 1.3 |
| rim px 2 | 90.8 | 89.2 | 1.6 |
| rim px 3 | 74.9 | 71.9 | 3.0 |

Within 3 on luma. The chroma difference was an artefact of the reference file,
not of the CSS.

### Type was measured as ink coverage, not by eye

Cap-height gives the size; total glyph span gives the tracking; **ink coverage
gives the weight**. Summing per-pixel coverage over a glyph box caught what
looking could not — the labels were rendering 15% too heavy and the title 9%
too light, in opposite directions at the same time.

| | before | after |
| --- | --- | --- |
| "Not now" | 1.151 | 1.033 |
| "Unmute" | 1.138 | 1.026 |
| bell icon | 1.215 | 1.035 |
| title | 0.907 | 1.001 |

*(ratio of rebuilt ink to target ink; 1.000 is exact)*

---

## Tunable variables

All scoped to `.lg-button`, so nothing leaks into the app's global scope.

| Variable | Default | Notes |
| --- | --- | --- |
| `--lg-pill-h` | `136px` | the box height |
| `--lg-radius` | `calc(h / 2)` | a pill by default; set it to square off the silhouette |
| `--lg-label-leading` | `1` | measured at hero size; small text needs a real leading |
| `--lg-label-size` | `51px` | measured; the obvious guess of 44px is 16% too small |
| `--lg-label-track` | `0.03137em` | 1.6px at 51px; em-relative so it scales with the label |
| `--lg-icon-gap` | `0.47059em` | 24px at 51px |
| `--lg-cap-0/1/2` | `4.486% / 11.589% / 26.542%` | how fast the rim dies across the caps |
| `--lg-hover-dur` | `300ms` | drives the tint **and** the lens together |
| `--lg-hover-ease` | `cubic-bezier(.37, 0, .63, 1)` | easeInOutSine |
| `--lg-tint-hover` | per variant | the vivid hover tint |
| `--lg-rim-1/2/3` | per variant | the three inset rings, outermost last |
| `--lg-lens-tint`, `--lg-lens-rim`, `--lg-lens-rim-soft` | per variant | lens bloom and its rim pickup |
| `--lg-mx`, `--lg-my` | `50%` | written by `useLensTracking`; never transition these |

The cap-fade values are percentages of pill width, not pixels. At the 535px
reference width they are pixel-identical to the measured 24/62/142px (verified:
zero differing pixels), but they scale with the button and, since every stop
stays under 50%, the mirrored halves can never cross however narrow it gets.

---

## Interaction

### The lens

Glass does not brighten uniformly when you point at it — it refracts toward
whatever is nearest. So the highlight tracks the pointer and the rim picks up
light only on the edge closest to it.

Both effects come from **one element**: a flat tint plus an inset ring, shaped
by a radial mask parked under the cursor. The mask does double duty, localising
the surface bloom and the rim pickup in a single pass.

```css
.lg-lens {
  background: var(--lg-lens-tint);
  box-shadow: inset 0 0 0 1px var(--lg-lens-rim),
              inset 0 0 0 2px var(--lg-lens-rim-soft);
  mask-image: radial-gradient(var(--lg-lens-w) var(--lg-lens-h)
                              at var(--lg-mx) var(--lg-my), …);
}
```

JS writes two custom properties and nothing else, once per animation frame.
`pointermove` outpaces the display, so a rAF gate collapses each burst into a
single style write.

### The press

`:active` fires on pointer-down, so the feedback lands on the press rather than
the release. The pill gives (`scale(.985)`) and the lens tightens from 200×150
to 148×112 — the material compressing.

### The hover tint

The tint gains saturation and luminance while **holding its hue**, so it reads
as the same colour lit better rather than a different colour:

| | resting | hover | change |
| --- | --- | --- | --- |
| Green | `#1b352a` — hsl(155, 32.5%, 15.7%) | `#12573a` — hsl(155, **65%**, 20.7%) | sat ×2.0, lum ×1.32 |
| Grey | `#555555` | `#707070` | luminance only |

Note the green's red channel goes *down* (27 → 18) while green climbs
(53 → 87). That is what makes it vivid rather than merely brighter — a pure
lightening raises all three channels and mutes the colour.

Grey is achromatic, so it has no chroma to amplify and brightness is its only
lever. Giving it a faint cool cast to compensate was tried and rejected: it
reads as a blue-grey button, not a lit one.

Label contrast survives the brighter bodies — mint on hover-green is 7.74:1,
white on hover-grey is 4.74:1, both clear of the 3.0:1 AA floor for text this
size. Push the tint much further and the grey is what runs out first.

### One clock for the whole state

The tint and the lens share `--lg-hover-dur` and `--lg-hover-ease`. They were
originally on 190ms and 240ms, which read as the material changing in two
overlapping stages. Verified in lockstep by driving the real transitions
through the Web Animations API and sampling both at 30ms intervals — max
divergence **0.009**, which is 8-bit quantisation (one step of the green
channel is 0.029).

`easeInOutSine` because velocity starts *and* ends at zero, which is what
"smooth" means for a cross-fade with no spatial motion. It is also symmetric,
so it is its own mirror: leaving traces the same path as arriving, with no
second curve to maintain.

Interpolation space was checked and does not matter here. CSS interpolates
`background-color` in sRGB, which muddies transitions between distant hues, but
both stops sit on hue 155° — the sRGB midpoint `rgb(22,70,50)` and the
perceptual oklab midpoint `rgb(25,70,50)` differ by 3/255 on one channel, and
by 0 on the grey. No reason to reach for `@property`-typed colour interpolation.

---

## Load-bearing details

Things that will silently break if changed without knowing why.

**The button must be its own flex centring context.** `.lg-button` is
`inline-flex` + `align-items: center` for a reason: without it the content span
is an `inline-flex` sitting on the button's *baseline*, so its vertical
position follows line-height and font metrics rather than the box. That put the
label 1.5px low at 12px while looking perfectly fine at 51px — the kind of bug
that only appears once the component is reused at another size.

**Variant classes must be declared above the hover block.** `.lg-button:hover`
and `.lg-button.lg-green` have identical specificity (0,2,0); the hover rule
wins only because it comes later in the file. A new variant added below it
will silently defeat the hover tint. This cost a debugging cycle when a test
harness used a lower-specificity class and reported the tint "not
transitioning" — the transition was fine, the rule was losing.

**Never transition `--lg-mx` / `--lg-my`.** Ease the position and the highlight
trails the cursor, which reads as a delayed glow rather than refraction.
Opacity and the press-tighten may ease; position may not.

**`::before` and `::after` are both taken.** The rim and the cap shadow need
them, which is why the lens is a real element rather than a third pseudo.

**Aspect-locked SVGs cannot always hit a measured box.** An icon's drawn glyph
is a sub-rectangle of its viewBox, and `preserveAspectRatio` (default
`xMidYMid meet`) scales uniformly to fit — so a target box with a different
aspect than the glyph is unreachable. The reference bell was 5.6% wider than
the viewBox allowed; `preserveAspectRatio="none"` with a box in the target's
own ratio (61:62) is what let it land exactly. Any resize must keep that ratio
or the skew changes.

**The font stack is pinned, not inherited — and it has to be.** Every tracking
and weight value was measured against SF Pro, so inheriting the surrounding
font silently invalidates them. Measured drift on the "Not now" label:

| face | span | vs SF Pro |
| --- | --- | --- |
| SF Pro | 197.3px | — |
| Inter *(Natively's default sans)* | 201.1px | +1.9% |
| Arial *(end of the Windows chain)* | 212.3px | **+7.6%, and bold** |

Arial is the sharp edge. `font-weight: 505` is a variable-font value; Arial
ships only 400 and 700, and CSS font matching rounds a request above 500
*upward*, so the label lands on Bold. The stack therefore runs SF Pro first
(macOS, exactly as measured), then Inter — which Natively bundles and which,
being variable, honours 505 properly on Windows — before any generic fallback.

Cross-platform note: this component has only been rendered on macOS. Windows
will pick up Inter and run ~1.9% wide at the same nominal size, which is
within tolerance but is not the measured build.

**`!important` on the reduced-motion pins is deliberate.** It is what makes the
inline `--lg-mx`/`--lg-my` writes inert, so the setting takes effect live
without tearing the listener down. Author `!important` beats inline
non-important by the cascade-origin rule.

**Hover is guarded with `:not(:disabled)`.** `:hover` matches disabled form
controls in Chrome, so an unguarded rule tints a dead button while the lens
correctly stays off — an inconsistent half-hover. The guard also raises the
selector to (0,3,0), which is why the cascade note above says the ordering
hazard is now closed.

**Reduced motion keeps the colour.** A hue shift is not vestibular, so the tint
still cross-fades; only the movement is dropped. Reduced motion means gentler,
not absent.

---

## Usage

```tsx
import { LiquidGlassButton } from '../ui-components/LiquidGlassButton';

<div className="lg-demo-actions">
    <LiquidGlassButton onClick={dismiss}>
        Not now
    </LiquidGlassButton>

    <LiquidGlassButton variant="green" icon={<MutedBell />} onClick={unmute}>
        Unmute
    </LiquidGlassButton>
</div>
```

The component forwards every native button attribute, so `disabled`,
`aria-label` and the rest pass straight through. `onPointerMove` and `onFocus`
are *composed* rather than forwarded — the lens needs both, so your handler is
pulled out of the rest-spread and called alongside it instead of silently
replacing it.

The reference layout that produced the measurements, if you need to reproduce
it — this is demo scaffolding, not part of the component:

Icons inherit `currentColor` from `.lg-content`, so a variant's label colour
carries to its icon automatically — draw the SVG with `stroke="currentColor"`
and set no `color` of your own.

```css
.lg-demo-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 44px;
    max-width: 1206px;
    padding: 43px 46px 0;
    background: #242424;
}
```

Icons are sized by the caller. The reference bell:

```css
.bell { width: 61px; height: 62px; }   /* colour comes from .lg-content */
```

---

## States

| State | Behaviour |
| --- | --- |
| hover | lens fades in under the pointer; tint gains saturation. Gated to `(hover: hover) and (pointer: fine)` so it cannot stick after a tap |
| active | `scale(.985)`, lens tightens to 148×112. Fires on pointer-down |
| focus-visible | 3px ring, plus the lens — keyboard users get the same affordance a pointer gets, bloomed from the centre |
| disabled | body desaturated, label and rim dimmed separately, lens off, hover and press guarded out |
| `prefers-reduced-motion` | tracking dropped, tint still cross-fades, no press movement |
| `prefers-contrast: more` | the subtle rim — the thing this material is built on — is replaced by a defined 2px border, bodies darken and labels go to full strength |

**Disabled dims the parts, not the whole element.** A blanket `opacity: .45`
takes the rim with it, so the button stops reading as glass at all, and it
drops the label to **3.74:1**. Desaturating the body and dimming the label and
rim separately keeps it legible as itself at **5.14:1**.

**A pill truncates; it never wraps.** The height is fixed, so a wrapped label
does not make the button taller — it overflows and is clipped through the
middle of the second line. Constrained to 300px, *"Unmute this channel
permanently"* wrapped to three lines and 153px inside a 136px pill. `.lg-label`
is `nowrap` + `ellipsis`, with `min-width: 0` on both it and `.lg-content` so
the ellipsis can actually engage inside the flex row.

That last one is worth stating plainly: a material whose depth reads as light
rather than as an edge is exactly what a high-contrast user has asked not to
depend on, so in that mode the design gives up its own premise.


---

## Adapting it to an existing UI

The hero pill and a 32px settings-row button are the same material at
different scales, but three things do **not** scale linearly with the pill.

**The rim doesn't.** At 136px a 3px rim is 2% of the height; at 32px it is 9%,
and three stacked rings plus a 2px cap ring swallow the button. `.lg-sm`
collapses the rim to a single hairline ring and the cap ring to 1px. Verified
by rendering 136 / 64 / 44 / 32px side by side — the 3px rim is visibly chunky
by 44px and the cap shadow eats the ends at 32px.

**The lens bloom doesn't.** A 200x150px radial on a 32px pill covers the whole
button and stops reading as a local highlight. `.lg-sm` takes it to 90x40.

**The font shouldn't.** At hero size the measured SF Pro metrics are the point.
At 12px the label sits beside ordinary UI text and should match it, so
`.lg-sm` sets `--lg-font: inherit`, weight 600 to match neighbouring controls,
and zero tracking — display tracking reads as loose, not crisp, at 12px.

**Nor should the leading.** `line-height: 1` is what the reference was measured
with and is correct at 51px, but at 12px it clips the line box below the font's
natural ascent + descent, so the ink stops sitting centred inside it. Hence
`--lg-label-leading`, which `.lg-sm` sets to the host's own 16/12.

**The silhouette stays a pill.** `.lg-sm` matches the *box* of the control it
replaces — 30px tall, 16px side padding, so the row's rhythm does not shift —
but keeps the reference's pill radius. Only the box is borrowed; the shape is
part of the design being adopted.

`--lg-radius` is nonetheless its own token, independent of height, if a host
ever does need to square one off. Be aware that changes the cap fade too: a
pill's caps are semicircles, giving the specular a proportional run to die away
across, whereas a small rounded rect has a top face running nearly the full
width and the percentage fade would eat the whole highlight — that case needs
px stops that track the corner instead.

The body colour does not change: with `.lg-action` the fill and hover tint are
read from the host's own tokens, so the button stays that app's primary action
rather than importing this reference's green. Measured in place: the rendered
body is *exactly* `--legacy-action-bg` in both themes, zero channel delta — the
sheen and rim sit at the edges and never touch the fill.

```tsx
<LiquidGlassButton variant="action" className="lg-sm" onClick={pick}>
    Upload
</LiquidGlassButton>
```

### A light body inverts the whole model

`.lg-sky` is the material with a *light* fill, and that changes more than the
colour. On a light body a white bottom rim has nothing to do — the fill is
already brighter than any bounce — so the specular stays on the top face, the
underside darkens, and a contact shadow does the rest. Same reasoning as the
light-theme treatment below, but baked in, because here it is the body that is
light rather than the surround.

The default `#3a9ff7` is the midpoint between the app's action blue (hue 217)
and sky-400 (hue 198). Both endpoints share a lightness and near-identical
saturation, so the blend is a straight hue walk — nothing but hue moves.

The label is white. On a fill this light that is **2.80:1**, under the 4.5:1
AA floor for 12px text — a deliberate choice, recorded here so it is not
mistaken for an oversight. The hue can be held and the fill dropped to L42
(`#0972ce`) for **4.87:1** if that ever needs to change; a dark navy label on
the current fill reaches 5.31:1 without touching the colour at all.

Tokens: `--lg-sky-bg`, `--lg-sky-hover`, `--lg-sky-fg`.

### A clear body removes the body from the model

`.lg-clear` is the material with **no fill of its own** — the host's surface
shows through and the rim is the only thing it contributes. It exists for the
case this material was already rejected on once: the modes manager sidebar
(`#0e0e0e` dark, `#f9f9f9` light), where a *tinted* chip read as out of place
on a flat panel and subtracting the rim, then the cap shadow, then the contact
shadow left nothing of the material behind. Letting the panel through is the
move that fits a flat surface.

The premise worth stating, because the instinct is that a near-black panel
starves the rim. It does the opposite — the rim is an inset shadow composited
over the button's **own** fill, and a transparent fill is a darker floor.
Measured in Electron at device scale 1, both buttons `.lg-sm .lg-wide` at
216px so the variant is the only difference (luma, 0–255):

| | surround | body | top rim | bottom rim |
| --- | --- | --- | --- | --- |
| `neutral` on `#242424` | 36 | 85 | 104 *(+19)* | 121 *(+36)* |
| `clear` on `#0e0e0e` | 14 | 28 | **62 *(+34)*** | **69 *(+41)*** |

Absolutely darker, relatively brighter — on both faces.

The cap shadow picks up a second job for free. `::after` is black, so on a
near-black panel it pulls the caps back down *to* the surround and the ends
dissolve into the sidebar rather than terminating against it — which is what a
clear material should do. On a white panel the same gradient is a smudge on
each end, so light mode takes it to `.20`.

**Light mode is the one place the layer structure changes.** Everywhere else
light mode moves the vertical mask and one box-shadow and leaves the layers
alone, because the body is opaque and brighter than its own rim can be. Here
two layers stop working and have to invert:

| Layer | Dark | Light |
| --- | --- | --- |
| rim | white specular, top and bottom faces | **dark** hairline; the underside carries more |
| lens | white bloom under the pointer | **darkening** under the pointer |
| `::after` | full weight — the caps dissolve into the panel | `.20` — enough to turn away from the light, not enough to blot |
| contact shadow | none | **still none** — see below |

**No contact shadow, and that is where `clear` parts company with `action` and
`sky`.** Both of those cast one on a light ground because there is a solid body
sitting *on* the card to cast it. A chip you can see the panel through is not
sitting on anything; a drop shadow under it claims a height the material does
not have. The underside inset is the whole of the depth.

**It is the only variant that must not pin a label colour — and the only one
that needs `color: inherit` to say so.** The other four own their body, so each
pins a colour against it. Here the body *is* the host's surface, so the label
has to be the host's text colour, and that does not arrive by itself: a
`<button>` gets `color: buttontext` from the UA stylesheet, which is an
*initial* value, not an inherited one. The other variants never notice, because
their `.lg-X .lg-content` rule overrides it. Measured without the line:
`rgb(0, 0, 0)` in **both** themes — black on `#0e0e0e`. `color: inherit` goes on
`.lg-button`, not on `.lg-content`, which would only inherit `buttontext` from
its parent. Replacing it with a fixed colour breaks the one thing that lets a
single class serve both themes.

Derived, not measured — the reference is a dark stage of opaque pills and has
nothing in it to sample for a fill that is mostly surround. Same standing as
light mode and `.lg-sky`; no mean-absolute-error figure is claimed.

Tokens: `--lg-clear-bg`, `--lg-clear-hover`, `--lg-clear-bg-light`,
`--lg-clear-hover-light`. The defaults are the modes sidebar's own
`--mm-btn-bg` / `--mm-btn-bg-hover` steps (`.06 → .10` dark, `.04 → .08`
light), so the button carries the weight the control it replaced had.

```tsx
<LiquidGlassButton variant="clear" className="lg-sm lg-wide" icon={<Plus size={13} />}>
    New Mode
</LiquidGlassButton>
```

### Width is its own axis: `.lg-wide`

`.lg-sm` is a *scale*. A button stretched to fill its container is a separate
problem, and the cap fade is where it shows up. The stops are percentages of
width, tuned on a 535x136 pill whose caps were 12.7% of it. A 30px-tall button
filling a 240px sidebar is 216px wide, so its caps are 15px — 6.9% — while
`--lg-cap-2` still says 26.5%:

| | ends at |
| --- | --- |
| the cap (where curvature stops) | 15px |
| the fade (`--lg-cap-2`) | **57px** |

Between them the top face is flat and the rim is still climbing, so the
specular never reaches full strength until well past the corner. Sampling the
top edge of that 216px button (luma, dark theme; the light theme inverts and
falls to its floor at the same distances):

| distance from the left edge | 2 | 6 | 10 | **15** | 20 | 30 | 45 | 60 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| with `.lg-wide` | 14 | 13 | 29 | **68** | 69 | 69 | 69 | 69 |
| without | 14 | 13 | 24 | 48 | 57 | 65 | 67 | **69** |

With the lengths the rim is at full strength by 15px, which is exactly where
the cap ends. Without them it is still climbing at 45px and arrives only at
60px — four times past the corner. This is the third appearance of the same bug — `LiquidGlassBadge` at 42px, the Profile
Intelligence CTA at 196px — so `.lg-wide` names it and applies the fix both of
those landed on independently: stops as **lengths** pinned to the cap radius,
which is width-invariant.

Add it whenever the width is set by the container rather than by the label.
It is deliberately *not* folded into `.lg-sm`, whose label-width buttons keep
proportions the percentages still serve.

### Tile scale is the rim's other failure: `.lg-tile`

`.lg-sm` collapses the rim to one hairline because at 32px a 3px rim is 9% of
the height and three rings plus the cap ring swallow the button. On a **58px
selectable tile** that same hairline is the opposite mistake: 1.7% of the
height, thinner in proportion than the 136px reference's own 2%, so there is no
specular to read and the tile lands as a flat card with a faint border. That is
what "doesn't look like glass" looks like from the inside.

`.lg-tile` puts two rings back (~3.4%) and is *additive* to `.lg-sm`, which is
still right about the font, the 12px label and its leading:

```tsx
<LiquidGlassButton variant="clear" className="lg-sm lg-tile" icon={<Terminal size={18} />}>
    Terminal
</LiquidGlassButton>
```

The lens moves for the same reason it had to shrink for `.lg-sm`, in the other
direction: 90x40 is a dot in a 253x58 box and the hero's 200x150 is taller than
the tile, so it goes to 150x70 resting / 110x52 pressed. The cap shadow drops to
2px at `.42` — a rect's side face is the full height, so it carries further than
a pill's semicircular cap while turning away from the light less sharply.

Derived, not measured, like light mode and the other two late variants. Verified
by rendering the Process Disguise picker (4 tiles at 253x58, `clear` resting and
`action` selected) in both themes at device scale 2.

**The body has to stay translucent for any of this to help.** That picker first
fed `--lg-clear-bg: var(--bg-input)`, an opaque fill *darker* than the card it
sits on, which reads as a plate in a hole no matter how good the rim is. The
variant's own defaults — a translucent step over whatever is behind — are what
let the card show through.

### A knob has no layers: `.lg-slider`

The material as a range input's thumb, and the one place it is built without
its own element structure. `::-webkit-slider-thumb` cannot carry
`::before`/`::after`, so the rim, the cap shadow and the contact shadow
collapse into a single `box-shadow` list, in the button's own layer order:
top specular, underside, hairline ring, contact.

Two consequences of the shape, both the opposite of the pill's:

**The ring is uniform.** On a pill the specular is masked to the top and bottom
faces because the caps turn away from the light. A circle is *all* cap — every
point on the perimeter curves away by the same amount — so there is nothing to
aim, and the mask would only thin the ring on the two sides that are no
different from the rest of it.

**The contact shadow is in both themes.** `.lg-clear` has none because a body
you can see through is not sitting on anything. A knob is sitting on the track,
in either theme, so it casts one in either theme; only its weight changes.

At 18px the three-ring falloff has nowhere to go, so it is one hairline — the
same collapse `.lg-sm` makes, one size further down. The body reads
`--accent-primary` the way `.lg-action` reads `--legacy-action-bg`, so the knob
stays the host's control colour rather than importing a tint from here.

```tsx
<input type="range" className="lg-slider w-full h-1.5 rounded-full appearance-none bg-bg-input" />
```

The host still owns the track. `accent-color` does nothing once the thumb is
styled, so drop it rather than leaving it to look load-bearing.

### Light mode is derived, not measured

Everything else in this document was sampled from a reference. Light mode was
not — the screenshot is dark only. It is the same lighting model reasoned
through: on a dark stage the pill catches a bounce from below, so the rim is
bright top *and* bottom; on a white card there is no bounce, the button sits
**on** the card, so the specular stays on the top face, the underside darkens,
and a real contact shadow does the work the bottom rim used to do. Only the
vertical mask and one box-shadow change; the layer structure is untouched.

---

## Known constraints

- **`neutral` and `green` are dark-surface tints** for `#242424`, and the focus
  ring is picked for contrast against it. Only `.lg-action` and `.lg-clear` have
  a light-mode treatment, and both are derived rather than measured.
- **`.lg-clear` has been rendered on the modes sidebar only.** Its defaults are
  that panel's control tokens; on a surface with a different resting weight,
  feed `--lg-clear-*` rather than assuming the defaults carry over.
- **Measured on macOS only.** Windows resolves to Inter and runs ~1.9% wide at
  the same nominal size. Rendered in Chrome only — `mask-composite: intersect`
  and `-webkit-mask-composite: source-in` are both declared, but Safari and
  Firefox are unverified.
- **A hidden browser tab freezes `requestAnimationFrame`**, so the lens will not
  track in one. Expected, and the reason tracking has to be verified in a
  foreground or headless render rather than a background tab.

---

## Verifying a change

If you touch the material, re-measure rather than eyeball it:

1. Render the component at 1206×410, device scale **1**, against `#242424`.
2. Sample a vertical slice through a pill's centre. The body must be flat; the
   rim must be symmetric top and bottom.
3. Sample the top edge horizontally. It must fall off across the caps, not hold
   full brightness to the corner.
4. Compare against the reference screenshot. Mean absolute error should stay at
   or below **4.18/255**.

A note on measuring transitions: under headless Chrome's virtual time,
`requestAnimationFrame` is fast-forwarded, so sampling a transition by rAF
returns its value at t≈0 and reads as "nothing happened". Drive it through the
Web Animations API instead — `element.getAnimations()`, then pause and set
`currentTime` — which is deterministic and immune to that.
