# Provider brand marks

Official brand marks for the AI providers listed in Settings → AI Providers,
and for the speech providers listed in Settings → Audio. Used nominatively — to
identify the provider a card or dropdown row configures — not as endorsement or
affiliation.

## Provenance

Thirteen SVGs are vendored from [`@lobehub/icons-static-svg`][pkg] v1.94.0
(MIT, © 2023 LobeHub — full text in `LICENSE` beside this file).

```
gemini.svg       ← gemini-color.svg
claude.svg       ← claude-color.svg
deepseek.svg     ← deepseek-color.svg
groq.svg         ← groq.svg
openai.svg       ← openai.svg
ollama.svg       ← ollama.svg
googlecloud.svg  ← googlecloud-color.svg
azure.svg        ← azure-color.svg
ibm.svg          ← ibm.svg
elevenlabs.svg   ← elevenlabs.svg
apple.svg        ← apple.svg
microsoft.svg    ← microsoft-color.svg   (title corrected, see below)
nvidia.svg       ← nvidia-color.svg
```

The last four were added for the speech provider selector, and the variant taken
differs per brand on purpose: `googlecloud` and `azure` are the upstream
`-color` files because those brands ARE multicolour, while `ibm` and
`elevenlabs` exist upstream only as monochrome, which is also how those brands
reproduce. See "Colour vs monochrome" below.

`nvidia.svg` serves BOTH surfaces — the Nvidia Nim card in AI Providers and the
Nvidia Nim row in the speech selector. The `-color` variant is taken (as for
`gemini`) because NVIDIA's mark is green, not monochrome: upstream ships the
fill hardcoded as `#74B71B`, so it needs no `BRAND_COLORS` entry and renders
identically in both themes. It arrives already `1em`-sized, so unlike
`deepgram.svg` it needed no local modification.

Before this file existed the provider rendered an `NI` monogram, which the
speech-selector coverage test flagged as an unrecorded fallback.

`deepgram.svg` comes from [simple-icons][si] v16.28.0, which licenses its icons
under **CC0-1.0** — a different licence from the lobehub set, so its full text
lives separately in `LICENSE.simple-icons`. Deepgram publishes no mark in the
lobehub package.

### The platform marks, and the Windows gap

`apple.svg` and `microsoft.svg` are the host-OS marks for the **Local Models**
row: those models run on the user's own machine, so the platform is the identity.
`isMac` picks between them at the call site in `SettingsOverlay.tsx`.

**There is no Windows logo here because none is available under a compatible
licence.** simple-icons carries no Windows or Microsoft entry at all — they were
removed on trademark request, and only unrelated projects like "Git for Windows"
remain — and lobehub ships no `windows.svg` either. What lobehub does ship is the
**Microsoft corporate four-square mark**, which is a *different mark* from the
Windows flag. That is what `microsoft.svg` is, and it is a deliberate
second-best: universally read as "Windows/Microsoft", but not literally the
Windows logo. If a licence-clean Windows mark ever appears, this is the file to
replace.

One local modification: upstream `microsoft-color.svg` has `<title>Azure</title>`
— a mislabel in the package, since the file is unmistakably the Microsoft
four-square. The title is corrected to `Microsoft` on vendoring. Nothing else
about the file changed.

### Local modifications to `deepgram.svg`

This is the one vendored asset that is **not** byte-identical to upstream. Two
attributes were added to the root `<svg>`:

```
fill="currentColor"      simple-icons ships no fill, so it defaults to black
                         and the mark vanishes against the dark theme
width="1em" height="1em" simple-icons ships it dimensionless; every lobehub mark
                         is 1em, and <BrandMark> sizes marks by setting
                         font-size, which a dimensionless SVG ignores
```

Re-vendoring this file without re-applying both attributes silently reintroduces
an invisible, mis-sized icon. CC0 imposes no attribution or no-derivatives
condition, so the edit is permitted; it is recorded here for maintenance, not
compliance.

`litellm.png` comes from [BerriAI/litellm][ll] — `litellm/proxy/swagger/favicon.png`,
a 160×160 RGBA PNG. MIT (© 2023 Berri AI), full text in `LICENSE.litellm`. Their
LICENSE opens "Portions of this software are licensed as follows" and carves out
only the `enterprise/` directory; this file sits outside it, so the MIT grant
applies. LiteLLM publishes no vector mark — this favicon is the highest-resolution
form they ship.

Vendored deliberately rather than imported from a CDN. An earlier attempt fetched
these from `unpkg.com/@lobehub/icons-static-svg@latest` at render time, which
(a) leaked the user's IP and their configured-provider set to a third-party host
on every settings render, (b) broke the panel's icons offline, and (c) pinned to
`@latest`, so the asset could change underneath a shipped build.

`@latest` is also why the version above is pinned here in writing: these are a
snapshot, not a live dependency. To refresh, re-run
`npm pack @lobehub/icons-static-svg@<version>` and update this file.

## Inlined SVG vs `<img>`

The SVGs are imported with `?raw` and inlined, because most of them paint with
`fill="currentColor"` — and `currentColor` does not resolve inside an `<img>`,
which is a separate document context. They would render black and disappear
against the dark theme.

Raster marks have no `currentColor` to resolve, so they are imported as URLs and
rendered with `<img>`. Both consumers split their registries along that line:
`AIP_PROVIDER_LOGOS` / `AIP_PROVIDER_LOGO_IMAGES` in `AIProvidersSettings.tsx`
(for `litellm.png`), and `BRAND_MARKS` / `BRAND_MARK_IMAGES` in `BrandMark.tsx`
(for the Natively app icon). `BrandMark` resolves the vector registry first, so
an id must not appear in both — the coverage test enforces that.

## Colour vs monochrome

The two consumers make opposite choices, for reasons specific to the surface
each one renders onto. Neither is an inconsistency to be tidied up.

**AI Providers** (`AIP_PROVIDER_LOGOS`) matches each brand: `gemini`, `claude`
and `deepseek` carry their own colours; `groq`, `openai` and `ollama` are
`currentColor` because those marks *are* monochrome, so they adapt to the light
and dark themes for free. Do not "fix" this by tinting the monochrome three or
flattening the colour three.

**Speech providers** (`BRAND_MARKS` in `src/components/ui/BrandMark.tsx`) shows
every mark in its own brand colour, and takes whichever upstream variant is
faithful to the brand: the `-color` files for `googlecloud` and `azure`, the
monochrome ones for `ibm` and `elevenlabs`.

Because those marks carry their own colour, rows that have one get a NEUTRAL
tile (`neutralTile: true` on the option, which routes `getIconStyle` past the
tint). The per-provider tint is reserved for rows whose icon has no colour of
its own — currently just the Soniox monogram, where the tint is the only colour
present. The two treatments are mutually exclusive, and the coverage test
enforces both directions.

For a monochrome mark, `currentColor` is the correct reproduction rather than a
compromise. `BRAND_COLORS` supplies a published brand hex where one is cited
(Deepgram `#13EF93`, from simple-icons); everything else inherits the tile's
text colour, so a black-and-white brand like OpenAI, Groq or ElevenLabs stays
legible in both themes instead of being pinned to a black that vanishes on dark.
IBM inherits because no authoritative hex is citable — simple-icons carries no
IBM entry and lobehub ships only the monochrome mark, so pinning one would mean
inventing a brand colour.

## Not included, and why

- **Custom Providers** — user-defined endpoints have no brand. Renders a monogram
  from the provider's own name.
- **ChatGPT / Codex** — reuses `openai.svg`; it is the same brand.
- **Soniox** — publishes no mark in either source package, and no other
  licence-compatible vector exists. Renders the `SO` monogram. Recorded in
  `BRAND_MARK_EXEMPT` so the coverage test can tell this apart from an oversight.
- **Natively** — our own brand, so nothing is vendored here. The speech selector
  uses the app icon at the repo root (`assets/icon-512.png`) via
  `BRAND_MARK_IMAGES`, the raster registry in `BrandMark.tsx`. There is also
  `src/components/NativelyLogoMark.tsx`, a `currentColor` vector logomark, if a
  surface needs one that tints.
- **Local Models** — not a brand. It is a set of on-device engines (Moonshine,
  Distil-Whisper, Whisper), so it renders the HOST OS mark instead: `apple` on
  macOS, `microsoft` on Windows. It previously carried `openai.svg`, which
  stopped being defensible once the row was renamed from "Local Whisper" to the
  generic "Local Models" — an OpenAI logo against models that are mostly not
  OpenAI's. Because the provider is a platform expression rather than a literal,
  the coverage test resolves BOTH branches; a Windows-only breakage would
  otherwise be invisible from a Mac.

## Adding a mark later

Drop the SVG here, add the key to the registry for the surface you are adding to
— `AIP_PROVIDER_LOGOS` in `src/components/settings/AIProvidersSettings.tsx` for
AI providers, `BRAND_MARKS` in `src/components/ui/BrandMark.tsx` for speech
providers — and record its source and licence above.

For a speech provider, also set `neutralTile: true` on its option in
`SettingsOverlay.tsx`, and normalise the asset to `width="1em" height="1em"`
(`<BrandMark>` sizes by font-size). `src/components/__tests__/SpeechProviderBrandMarkCoverage.test.mjs`
checks all of this and will tell you which step was missed.

Anything without a clear, compatible licence stays a monogram, listed in
`BRAND_MARK_EXEMPT` with the reason. AGPL-3.0 requires every shipped asset to be
licence-compatible, and a stock-vector-site download of a company's logo does not
qualify.

[pkg]: https://github.com/lobehub/lobe-icons
[ll]: https://github.com/BerriAI/litellm
[si]: https://github.com/simple-icons/simple-icons
