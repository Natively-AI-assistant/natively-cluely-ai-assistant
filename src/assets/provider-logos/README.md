# Provider brand marks

Official brand marks for the AI providers listed in Settings → AI Providers.
Used nominatively — to identify the provider a card configures — not as
endorsement or affiliation.

## Provenance

Six SVGs are vendored from [`@lobehub/icons-static-svg`][pkg] v1.94.0
(MIT, © 2023 LobeHub — full text in `LICENSE` beside this file).

```
gemini.svg    ← gemini-color.svg
claude.svg    ← claude-color.svg
deepseek.svg  ← deepseek-color.svg
groq.svg      ← groq.svg
openai.svg    ← openai.svg
ollama.svg    ← ollama.svg
```

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

The six SVGs are imported with `?raw` and inlined, because three of them
(`groq`, `openai`, `ollama`) paint with `fill="currentColor"` — and `currentColor`
does not resolve inside an `<img>`, which is a separate document context. They
would render black and disappear against the dark theme.

`litellm.png` is raster, has no `currentColor`, and so is imported as a URL and
rendered with `<img>`. Two registries in `AIProvidersSettings.tsx` reflect this:
`AIP_PROVIDER_LOGOS` (inlined markup) and `AIP_PROVIDER_LOGO_IMAGES` (URLs).

## Colour vs monochrome

`gemini`, `claude` and `deepseek` carry their brands' own colours. `groq`,
`openai` and `ollama` use `fill="currentColor"` because those marks *are*
monochrome — they inherit the surrounding text colour and therefore adapt to the
light and dark themes for free. Do not "fix" this inconsistency by tinting the
monochrome three or flattening the colour three; each matches its brand.

## Not included, and why

- **Custom Providers** — user-defined endpoints have no brand. Renders a monogram
  from the provider's own name.
- **ChatGPT / Codex** — reuses `openai.svg`; it is the same brand.

## Adding a mark later

Drop the SVG here, add the key to `AIP_PROVIDER_LOGOS` in
`src/components/settings/AIProvidersSettings.tsx`, and record its source and
licence above. Anything without a clear, compatible licence stays a monogram —
AGPL-3.0 requires every shipped asset to be licence-compatible, and a
stock-vector-site download of a company's logo does not qualify.

[pkg]: https://github.com/lobehub/lobe-icons
[ll]: https://github.com/BerriAI/litellm
