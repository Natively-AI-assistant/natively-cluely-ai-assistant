// Mobile client served by PhoneMirrorService.
// Inlined here so it travels with the asar bundle without extra build steps.
// Edit the template below; whitespace is preserved as written.
//
// Template-literal rules for this file: no backticks and no dollar-brace in the
// page, and every backslash doubled (the markdown renderer and highlighter
// already follow this). New code avoids backslashes entirely.
// PhoneMirrorClientTemplate2026_09_26.test.mjs compiles the page script.
//
// Layout follows the device's shape, not just its width:
//   - phones (portrait and landscape): bar, the overlay's rolling transcript
//     line (tap or pull down for the full transcript), answer feed, dock
//   - tablets: transcript column beside the feed
// The shell is sized to the visual viewport so the on-screen keyboard never
// hides the composer, and the feed is the only scroller.

export const PHONE_MIRROR_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#09090b" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f2f2f7" />
    <meta name="color-scheme" content="dark light" />
    <meta name="referrer" content="no-referrer" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="format-detection" content="telephone=no" />
    <title>Natively</title>
    <link rel="icon" href="data:," />
    <style>
      :root {
        color-scheme: dark;

        /* Motion tokens (transitions.dev scale). */
        --duration-stagger: 40ms;
        --duration-micro: 80ms;
        --duration-quick: 150ms;
        --duration-fast: 250ms;
        --duration-medium: 350ms;
        --duration-slow: 400ms;
        --duration-very-slow: 500ms;
        --ease-smooth-out: cubic-bezier(0.22, 1, 0.36, 1);
        --ease-in-out: ease-in-out;
        --ease-out: ease-out;
        --ease-linear: linear;
        --ease-bounce: cubic-bezier(0.34, 1.36, 0.64, 1);
        --distance-micro: 4px;
        --distance-base: 8px;
        --distance-medium: 12px;
        --scale-medium: 0.97;
        --scale-tiny: 0.99;
        --blur-small: 2px;
        --blur-medium: 3px;

        /* Per-transition variables (transitions.dev names). */
        --toast-open: 350ms;
        --toast-close: 250ms;
        --toast-distance: 16px;
        --toast-blur: 2px;
        --toast-scale: 0.97;
        --toast-ease: cubic-bezier(0.22, 1, 0.36, 1);
        --stagger-dur: 500ms;
        --stagger-distance: 12px;
        --stagger-stagger: 40ms;
        --stagger-blur: 3px;
        --stagger-ease: cubic-bezier(0.22, 1, 0.36, 1);
        --icon-swap-dur: 250ms;
        --icon-swap-blur: 2px;
        --icon-swap-start-scale: 0.25;
        --icon-swap-ease: ease-in-out;
        --dropdown-open-dur: 250ms;
        --dropdown-close-dur: 150ms;
        --dropdown-pre-scale: 0.97;
        --dropdown-closing-scale: 0.99;
        --dropdown-ease: cubic-bezier(0.22, 1, 0.36, 1);
        --text-swap-dur: 150ms;
        --text-swap-translate-y: 4px;
        --text-swap-blur: 2px;
        --text-swap-ease: ease-in-out;
        --resize-dur: 300ms;
        --resize-ease: cubic-bezier(0.22, 1, 0.36, 1);
        --reveal-dur: 400ms;
        --reveal-blur: 2px;
        --reveal-ease: ease-in-out;
        --shake-distance: 6px;
        --shake-overshoot: 4px;
        --shake-dur-a: 80ms;
        --shake-dur-b: 60ms;
        --shake-ease: cubic-bezier(0.22, 1, 0.36, 1);
        --acc-chevron: 250ms;
        --acc-ease: cubic-bezier(0.22, 1, 0.36, 1);

        /* Space (8pt grid with 4pt half-steps) and shape. */
        --s1: 4px;
        --s2: 8px;
        --s3: 12px;
        --s4: 16px;
        --s5: 20px;
        --s6: 24px;
        --gl: max(16px, env(safe-area-inset-left));
        --gr: max(16px, env(safe-area-inset-right));
        --safe-top: env(safe-area-inset-top);
        --safe-bottom: env(safe-area-inset-bottom);
        /* Four corner shapes: capsule, large (bubbles, tray, cards), medium
           (code, gist, thumbnails in rows, menu items), small (thumbnails). */
        --r-pill: 999px;
        --r-lg: 18px;
        --r-md: 12px;
        --r-sm: 8px;
        /* Seven type steps (Apple's names) plus 16 px for the input, below
           which iOS zooms the page on focus. */
        --type-caption2: 11px;
        --type-caption: 12px;
        --type-footnote: 13px;
        --type-subhead: 15px;
        --type-callout: 16px;
        --type-body: 17px;
        --type-title3: 20px;
        --type-title2: 22px;
        --tx-collapsed: 40px;
        --tx-w: clamp(260px, 36vw, 400px);
        --main-left: 0px;
        --bar-h: 52px;
        --dock-h: 120px;
        /* Narrow: the top material spans the bar AND the collapsed island, so
           nothing scrolls past sharply in the gutters beside it. */
        --chrome-top-h: calc(var(--bar-h) + var(--tx-collapsed) + 8px);

        /* Colour: dark. Accent = the desktop's toggle blue (#6688F5) and its
           dark-mode text step (periwinkle-300). */
        --bg: #09090b;
        --bg-glow: rgba(102, 136, 245, 0.07);
        --card: #151518;
        --card-hair: rgba(255, 255, 255, 0.07);
        --fill-1: rgba(255, 255, 255, 0.06);
        --fill-2: rgba(255, 255, 255, 0.1);
        --fill-press: rgba(255, 255, 255, 0.15);
        --hair: rgba(255, 255, 255, 0.08);
        --label: #f5f5f7;
        --label-2: rgba(235, 235, 245, 0.68);
        --label-3: rgba(235, 235, 245, 0.52);
        --accent: #95aff6;
        --accent-fill: #6688f5;
        --hotword: #a9c0fb;            /* the overlay's bold words and gist (index.css --hotword-color) */
        --accent-tint: rgba(102, 136, 245, 0.16);
        --accent-tint-2: rgba(102, 136, 245, 0.26);
        --on-accent: #ffffff;
        --bubble: rgba(102, 136, 245, 0.22);
        --bubble-edge: rgba(102, 136, 245, 0.34);
        --bubble-ink: #eef2ff;
        --live: #30d158;
        --warn: #ff9f0a;
        --danger: #ff6961;
        --chrome: rgba(9, 9, 11, 0.86);
        --island: rgba(30, 30, 34, 0.9);
        --island-rim: rgba(255, 255, 255, 0.1);
        --menu-bg: rgba(40, 40, 44, 0.84);
        --scrim: rgba(0, 0, 0, 0.46);
        --shadow-float: 0 14px 34px rgba(0, 0, 0, 0.46), 0 2px 8px rgba(0, 0, 0, 0.3);
        --code-bg: #0d0e11;
        --logo-filter: none;
      }
      @media (prefers-color-scheme: light) {
        :root {
          color-scheme: light;
          --bg: #f2f2f7;
          --bg-glow: rgba(102, 136, 245, 0.09);
          --card: #ffffff;
          --card-hair: rgba(60, 60, 67, 0.1);
          --fill-1: rgba(118, 118, 128, 0.1);
          --fill-2: rgba(118, 118, 128, 0.16);
          --fill-press: rgba(118, 118, 128, 0.24);
          --hair: rgba(60, 60, 67, 0.12);
          --label: #1c1c1e;
          /* Solid greys: translucent ones can't hold 4.5:1 on both #fff and
             #f2f2f7 without collapsing into one step. */
          --label-2: #48484a;
          --label-3: #6e6e73;
          --accent: #4967d3;
          --hotword: #4b65be;
          --accent-tint: rgba(102, 136, 245, 0.13);
          --accent-tint-2: rgba(102, 136, 245, 0.22);
          --bubble: rgba(102, 136, 245, 0.16);
          --bubble-edge: rgba(102, 136, 245, 0.24);
          --bubble-ink: #1b2852;
          --live: #248a3d;
          --warn: #c93400;
          --danger: #d70015;
          --chrome: rgba(242, 242, 247, 0.88);
          --island: rgba(255, 255, 255, 0.9);
          --island-rim: rgba(255, 255, 255, 0.8);
          --menu-bg: rgba(252, 252, 253, 0.88);
          --scrim: rgba(0, 0, 0, 0.16);
          --shadow-float: 0 12px 30px rgba(0, 0, 0, 0.12), 0 1px 4px rgba(0, 0, 0, 0.08);
          --logo-filter: invert(1);
        }
      }

      /* ── Base ───────────────────────────────────────────── */
      * { box-sizing: border-box; }
      html, body { height: 100%; margin: 0; overflow: hidden; overscroll-behavior: none; }
      html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
      body {
        background: var(--bg);
        color: var(--label);
        font-family: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
        font-size: var(--type-callout);
        line-height: 1.5;
        letter-spacing: -0.01em;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        -webkit-tap-highlight-color: transparent;
      }
      button, textarea { font: inherit; color: inherit; letter-spacing: inherit; }
      button { border: 0; background: none; padding: 0; margin: 0; cursor: pointer; touch-action: manipulation; }
      button:disabled { cursor: default; }
      :focus { outline: none; }
      :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      svg { display: block; }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

      /* ── Shell: sized to the visual viewport (JS keeps --vv-* current) ── */
      .app {
        position: fixed;
        left: 0;
        right: 0;
        top: var(--vv-top, 0px);
        height: var(--vv-h, 100dvh);
        overflow: hidden;
        background:
          radial-gradient(120% 60% at 50% -12%, var(--bg-glow), transparent 62%),
          var(--bg);
      }

      /* ── Bar ────────────────────────────────────────────── */
      .bar {
        position: absolute;
        z-index: 30;
        top: 0;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        gap: var(--s3);
        padding: calc(var(--safe-top) + 6px) var(--gr) 6px var(--gl);
        min-height: calc(var(--safe-top) + 52px);
      }
      .brand { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1; }
      .brand img { width: 22px; height: 22px; filter: var(--logo-filter); opacity: 0.92; }
      .brand-name { font-size: var(--type-body); font-weight: 600; letter-spacing: -0.022em; }
      .conn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 30px;
        padding: 0 12px 0 10px;
        border-radius: var(--r-pill);
        background: var(--fill-1);
        color: var(--label-2);
        font-size: var(--type-footnote);
        font-weight: 590;
        letter-spacing: -0.005em;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        /* width: the pill resizes to its next label (transitions.dev card
           resize) while the label swaps; the script sets the pixel widths. */
        transition:
          width var(--resize-dur) var(--resize-ease),
          background-color var(--duration-fast) var(--ease-smooth-out),
          color var(--duration-fast) var(--ease-smooth-out),
          transform var(--duration-micro) var(--ease-out);
      }
      /* Reconnecting: the pill is a retry button. */
      .app[data-conn="reconnecting"] .conn { cursor: pointer; }
      .conn.is-pressed { transform: scale(0.96); }
      .conn-dot {
        flex: 0 0 auto;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--label-3);
        transition: background-color var(--duration-fast) var(--ease-smooth-out), box-shadow var(--duration-fast) var(--ease-smooth-out);
      }
      /* Measures the next label in the pill's own font; never seen. */
      .conn-measure { position: absolute; visibility: hidden; white-space: pre; pointer-events: none; }
      .app[data-conn="live"] .conn { color: var(--label); }
      .app[data-conn="live"] .conn-dot { background: var(--live); box-shadow: 0 0 0 3px color-mix(in srgb, var(--live) 22%, transparent); }
      .app[data-conn="reconnecting"] .conn-dot { background: var(--warn); }
      .app[data-conn="rejected"] .conn-dot, .app[data-conn="missing"] .conn-dot { background: var(--danger); }
      .icon-btn {
        position: relative;
        display: inline-grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border-radius: 50%;
        color: var(--label-2);
        transition: background-color var(--duration-quick) var(--ease-out), transform var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out);
      }
      .icon-btn::after { content: ""; position: absolute; inset: -4px; }
      .icon-btn:active, .icon-btn.is-pressed { background: var(--fill-2); transform: scale(0.94); transition-duration: var(--duration-micro); }
      .icon-btn[aria-expanded="true"] { background: var(--fill-2); color: var(--label); }

      /* Chrome material: content scrolls underneath, and instead of a hard
         rule the material fades out where the chrome ends (scroll-edge
         effect). Two layers, no mask-image: WebKit drops a layer that has
         both a mask and a backdrop-filter, background and all. The material
         is dense enough to stay legible where blur is unavailable. */
      .chrome-top, .chrome-bottom {
        position: absolute;
        z-index: 20;
        left: 0;
        right: 0;
        pointer-events: none;
      }
      .chrome-top::before, .chrome-bottom::before {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        background: var(--chrome);
        -webkit-backdrop-filter: blur(22px) saturate(170%);
        backdrop-filter: blur(22px) saturate(170%);
      }
      .chrome-top::after, .chrome-bottom::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        height: 18px;
      }
      .chrome-top { top: 0; height: calc(var(--chrome-top-h) + 18px); }
      .chrome-top::before { top: 0; height: var(--chrome-top-h); }
      .chrome-top::after { top: var(--chrome-top-h); background: linear-gradient(to bottom, var(--chrome), transparent); }
      .chrome-bottom { bottom: 0; left: var(--main-left); height: calc(var(--dock-h) + 18px); }
      .chrome-bottom::before { bottom: 0; height: var(--dock-h); }
      .chrome-bottom::after { bottom: var(--dock-h); background: linear-gradient(to top, var(--chrome), transparent); }

      /* ── Transcript ──────────────────────────────────────────
         Phones: the overlay's rolling line. One italic line under the bar,
         newest words on the right, older words sliding off the left as the
         line smooth-scrolls to its end. Tap or pull it down and the same
         element grows into the full transcript; flick it back up to close.
         Tablets: a column beside the answers.
         --txp (0 closed … 1 open) is written by the spring, so the line and
         the full view trade places continuously under the finger. */
      .tx {
        --txp: 0;
        position: absolute;
        z-index: 25;
        top: var(--bar-h);
        left: var(--gl);
        right: var(--gr);
        height: var(--tx-collapsed);
        border-radius: var(--r-lg);
        touch-action: pan-x;
      }
      .tx[data-open="true"] { touch-action: auto; }
      /* Closed, the line sits on the bar's material like the overlay's does;
         the card fades in as it opens. */
      .tx::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: var(--card);
        box-shadow: inset 0 0.5px 0 var(--island-rim), inset 0 0 0 0.5px var(--hair), var(--shadow-float);
        opacity: var(--txp);
        pointer-events: none;
      }
      .tx-ticker {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: var(--tx-collapsed);
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 0 0 2px;
        opacity: calc(1 - var(--txp) * 3);
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
      }
      .tx[data-open="true"] .tx-ticker { pointer-events: none; }
      .tk-line {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: pre;
        text-align: right;
        scroll-behavior: smooth;
        font-size: var(--type-subhead);
        line-height: 22px;
        font-style: italic;
        letter-spacing: -0.005em;
        color: var(--label-2);
        -webkit-mask-image: linear-gradient(to right, transparent 0, #000 18%, #000 97%, transparent 100%);
        mask-image: linear-gradient(to right, transparent 0, #000 18%, #000 97%, transparent 100%);
      }
      .tk-live { color: var(--label); }
      .tk-empty { color: var(--label-3); }
      /* A status in place of words ("Meeting ended") is not scrolled text:
         nothing to fade in from, and its last letters must read. */
      /* Centred in the bar: the left padding matches the dot + chevron beside
         it on the right (8 + 5 + 8 + 16, less the bar's own 2 px). */
      .tk-line.is-empty { -webkit-mask-image: none; mask-image: none; text-align: center; padding-left: 35px; }
      /* The overlay's speaking dot: steady while listening, pulsing while
         the other side is actually talking. */
      .tk-dot {
        flex: 0 0 auto;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--live);
        opacity: 0;
        transition: opacity var(--duration-fast) var(--ease-smooth-out);
      }
      .app[data-meeting="live"] .tk-dot { opacity: 0.5; }
      .app[data-meeting="live"][data-speaking="true"] .tk-dot { opacity: 1; animation: tk-pulse 1200ms var(--ease-in-out) infinite; }
      @keyframes tk-pulse { 50% { opacity: 0.3; } }
      .tk-chevron { flex: 0 0 auto; display: inline-flex; color: var(--label-3); }
      .tk-chevron path, .tx-chevron path { vector-effect: non-scaling-stroke; }
      .tx-full {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        border-radius: inherit;
        overflow: hidden;
        opacity: calc((var(--txp) - 0.3) * 1.6);
        pointer-events: none;
      }
      .tx[data-open="true"] .tx-full { pointer-events: auto; }
      .tx-head {
        display: flex;
        align-items: center;
        gap: var(--s2);
        flex: 0 0 auto;
        min-height: 40px;
        padding: 12px 12px 4px 16px;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
      }
      .tx-title { font-size: var(--type-caption); font-weight: 600; letter-spacing: 0.02em; color: var(--label-2); text-transform: uppercase; }
      .tx-state { display: inline-flex; align-items: center; gap: 6px; font-size: var(--type-caption); font-weight: 510; color: var(--label-3); }
      .app[data-meeting="live"] .tx-state { color: var(--live); }
      .tx-spacer { flex: 1; }
      .tx-chevron { color: var(--label-3); display: inline-flex; transform: scaleY(-1); }
      /* Speech level: three bars that only move while the other side is
         actually speaking — a status, not decoration. */
      .eq { display: none; align-items: flex-end; gap: 2px; height: 10px; }
      .app[data-meeting="live"][data-speaking="true"] .eq { display: inline-flex; }
      .tx-dot { display: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .app[data-meeting="live"][data-speaking="false"] .tx-dot { display: inline-block; }
      .eq i { display: block; width: 2px; height: 3px; border-radius: 1px; background: currentColor; opacity: 0.8; }
      .app[data-speaking="true"] .eq i { animation: eq 900ms var(--ease-in-out) infinite; }
      .app[data-speaking="true"] .eq i:nth-child(2) { animation-delay: -300ms; }
      .app[data-speaking="true"] .eq i:nth-child(3) { animation-delay: -600ms; }
      @keyframes eq { 0%, 100% { height: 3px; } 50% { height: 10px; } }
      .tx-body {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        padding: 2px 16px 22px;
        -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 14px);
        mask-image: linear-gradient(to bottom, transparent 0, #000 14px);
      }
      .tx-lines { font-size: var(--type-subhead); line-height: 21px; letter-spacing: -0.012em; color: var(--label-2); overflow-wrap: anywhere; }
      .tl { margin: 0; padding: 5px 0; transition: color var(--duration-slow) var(--ease-smooth-out); }
      .tl.is-recent, .tl.is-live { color: var(--label); }
      .tl-time { margin-right: 8px; font-size: var(--type-caption2); color: var(--label-3); font-variant-numeric: tabular-nums; letter-spacing: 0; }
      .tx-empty { margin: 0; padding: 5px 0; font-size: var(--type-subhead); line-height: 21px; color: var(--label-3); }
      .tx-grip {
        position: absolute;
        left: 50%;
        bottom: 5px;
        width: 36px;
        height: 4px;
        margin-left: -18px;
        border-radius: 2px;
        background: var(--label-3);
        opacity: calc(var(--txp) * 0.5);
      }
      .tx-grip-hit { position: absolute; left: 0; right: 0; bottom: 0; height: 22px; cursor: grab; touch-action: none; }
      .tx[data-open="false"] .tx-grip-hit { pointer-events: none; }
      .scrim {
        position: absolute;
        z-index: 15;
        inset: 0;
        background: var(--scrim);
        opacity: 0;
        pointer-events: none;
      }
      .scrim.is-active { pointer-events: auto; }
      /* Short screens: the open transcript also covers the dock, so the scrim
         rises over it (the dimmed strip below is the way back). */
      .app.tx-over-dock .scrim { z-index: 22; }

      /* ── Feed ───────────────────────────────────────────── */
      .feed {
        position: absolute;
        z-index: 10;
        top: 0;
        bottom: 0;
        left: var(--main-left);
        right: 0;
        overflow-y: auto;
        overflow-x: hidden;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        padding-top: calc(var(--chrome-top-h) + var(--s3));
        padding-bottom: calc(var(--dock-h) + var(--s3));
        scrollbar-width: none;
      }
      .feed::-webkit-scrollbar { display: none; }
      .feed-inner {
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: var(--s3);
        min-height: 100%;
        max-width: 720px;
        margin: 0 auto;
        padding: 0 var(--gr) 0 var(--gl);
      }
      .enter { animation: item-in var(--duration-slow) var(--ease-smooth-out) both; }
      @keyframes item-in {
        from { opacity: 0; transform: translateY(var(--distance-medium)); filter: blur(var(--blur-medium)); }
        to { opacity: 1; transform: none; filter: none; }
      }
      .leave {
        overflow: hidden;
        transition: height var(--duration-medium) var(--ease-smooth-out), opacity var(--duration-quick) var(--ease-out), margin var(--duration-medium) var(--ease-smooth-out);
      }

      /* Empty state */
      .empty { margin: auto 0; padding: var(--s6) var(--s2); text-align: center; }
      .empty-title { margin: 0 0 6px; font-size: var(--type-title3); line-height: 26px; font-weight: 650; letter-spacing: -0.024em; }
      .empty-sub { margin: 0 auto; max-width: 30ch; font-size: var(--type-subhead); line-height: 21px; color: var(--label-2); }
      .t-stagger-line {
        display: block;
        opacity: 0;
        transform: translateY(var(--stagger-distance));
        filter: blur(var(--stagger-blur));
        transition:
          opacity   var(--stagger-dur) var(--stagger-ease),
          transform var(--stagger-dur) var(--stagger-ease),
          filter    var(--stagger-dur) var(--stagger-ease);
        will-change: transform, opacity, filter;
      }
      .t-stagger-line--2 { transition-delay: var(--stagger-stagger); }
      .t-stagger.is-shown .t-stagger-line {
        opacity: 1;
        transform: translateY(0);
        filter: blur(0);
      }
      .t-stagger.is-hiding .t-stagger-line {
        opacity: 0;
        transform: translateY(0);
        filter: blur(0);
        transition:
          opacity 200ms ease,
          transform 0s linear,
          filter 0s linear;
        transition-delay: 0s;
      }

      /* Answer: as on the overlay, the text sits on the page. The overlay
         dropped its answer chrome on purpose (index.css: "only the user's
         question gets a card"); an action's answer is announced by the
         action's name on the question side, as the overlay labels it. */
      .answer { position: relative; display: flex; flex-direction: column; gap: 10px; }
      .answer + .row-user, .answer + .answer, .answer + .row-shots { margin-top: 10px; }
      .answer-body { transition: opacity var(--reveal-dur) var(--reveal-ease), filter var(--reveal-dur) var(--reveal-ease); }
      .answer.is-revealing .answer-body { opacity: 0; filter: blur(var(--reveal-blur)); transition: none; }
      .answer-foot {
        display: flex;
        align-items: center;
        gap: 2px;
        margin: -8px 0 0 -8px;
        color: var(--label-3);
        font-size: var(--type-caption);
        line-height: 16px;
        font-variant-numeric: tabular-nums;
      }
      .answer.is-streaming .answer-foot, .answer.is-pending .answer-foot { display: none; }
      .answer-note { margin: 8px 0 0; font-size: var(--type-footnote); line-height: 20px; color: var(--danger); }
      .answer.is-idle .answer-body { color: var(--label-3); font-size: var(--type-subhead); }
      .ask { display: flex; justify-content: flex-end; }
      .ask-label {
        max-width: min(82%, 520px);
        padding: 7px 13px;
        border-radius: var(--r-lg) 4px var(--r-lg) var(--r-lg);
        background: var(--bubble);
        box-shadow: inset 0 0 0 0.5px var(--bubble-edge);
        color: var(--bubble-ink);
        font-size: var(--type-subhead);
        line-height: 20px;
        font-weight: 560;
        letter-spacing: -0.01em;
      }

      /* Waiting: the overlay's "Thinking..." (index.css .natively-thinking-label),
         a highlight sweeping through the word where the answer will appear. */
      .thinking {
        display: inline-block;
        padding: 2px 0;
        font-size: var(--type-subhead);
        line-height: 22px;
        background-image: linear-gradient(90deg, var(--label-2) 0%, var(--label-2) 40%, var(--label) 50%, var(--label-2) 60%, var(--label-2) 100%);
        background-size: 250% 100%;
        background-repeat: no-repeat;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        -webkit-text-fill-color: transparent;
        animation: thinking-sweep 1.6s ease-in-out infinite;
      }
      .thinking.is-inline { padding: 0; font-size: inherit; line-height: inherit; }
      /* Left to right, matching index.css natively-thinking-sweep. */
      @keyframes thinking-sweep {
        0% { background-position: 100% 0; }
        100% { background-position: 0% 0; }
      }

      /* User message */
      .row-user { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
      .bubble {
        max-width: min(82%, 520px);
        padding: 10px 14px;
        border-radius: var(--r-lg) 4px var(--r-lg) var(--r-lg);
        background: var(--bubble);
        box-shadow: inset 0 0 0 0.5px var(--bubble-edge);
        color: var(--bubble-ink);
        font-size: var(--type-body);
        line-height: 23px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        transition: opacity var(--duration-fast) var(--ease-smooth-out);
      }
      .row-user.is-sending .bubble { opacity: 0.62; }
      .row-status { font-size: var(--type-caption); line-height: 16px; color: var(--label-3); padding-right: 4px; }
      .row-status button { color: var(--accent); font-weight: 600; font-size: var(--type-caption); }
      .row-user.is-failed .row-status { color: var(--danger); }

      /* System row (screen capture) */
      .sys {
        align-self: center;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 6px 12px;
        border-radius: var(--r-pill);
        background: var(--fill-1);
        color: var(--label-2);
        font-size: var(--type-footnote);
        line-height: 18px;
      }
      .sys.is-bad { color: var(--danger); }

      /* Markdown content */
      .content { font-size: var(--type-body); line-height: 1.5; letter-spacing: -0.014em; overflow-wrap: anywhere; word-break: break-word; }
      .content > :first-child { margin-top: 0; }
      .content > :last-child { margin-bottom: 0; }
      .content p { margin: 0 0 10px; }
      /* Bold words are the overlay's hot words: same colour, both themes. */
      .content strong { font-weight: 650; color: var(--hotword); }
      .content em { font-style: italic; }
      .content h1, .content h2, .content h3 { margin: 16px 0 6px; line-height: 1.3; letter-spacing: -0.018em; font-weight: 650; }
      .content h1 { font-size: 1.176em; }
      .content h2 { font-size: 1.059em; }
      .content h3 { font-size: 1em; }
      .content h4, .content h5, .content h6 { margin: 14px 0 4px; line-height: 1.3; font-size: 0.941em; font-weight: 650; }
      .content h5, .content h6 { font-size: 0.882em; color: var(--label-2); }
      .content del { color: var(--label-3); }
      .content ul ul, .content ul ol, .content ol ul, .content ol ol { margin: 2px 0 4px; }
      .content li > p { margin: 0 0 4px; }
      .content li > input[type="checkbox"] { margin: 0 8px 0 -20px; accent-color: var(--accent-fill); }
      .content .table-wrap {
        margin: 10px 0 12px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        border-radius: var(--r-md);
        box-shadow: inset 0 0 0 0.5px var(--hair);
      }
      .content table { width: 100%; border-collapse: collapse; font-size: 0.882em; line-height: 1.4; }
      .content th, .content td { padding: 8px 12px; text-align: left; vertical-align: top; border-bottom: 0.5px solid var(--hair); }
      .content th { font-size: 0.765em; font-weight: 600; color: var(--label-2); background: var(--fill-1); white-space: nowrap; }
      .content tr:last-child td { border-bottom: 0; }
      .content td { min-width: 4.5em; }
      /* Math: KaTeX's MathML half renders natively on phones. Its HTML half needs
         KaTeX's CSS and fonts, so it stays hidden. */
      .content .katex-html { display: none; }
      .content .katex { font-size: 1.05em; }
      .content .katex-display { display: block; margin: 10px 0 12px; overflow-x: auto; overflow-y: hidden; text-align: center; }
      /* The overlay's gist: the answer's one-line essence, under it. */
      .gist-chip {
        display: inline-flex;
        align-items: baseline;
        gap: 8px;
        max-width: 100%;
        margin-top: 12px;
        padding: 6px 12px;
        border-radius: var(--r-md);
        background: color-mix(in srgb, var(--hotword) 12%, transparent);
        box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--hotword) 32%, transparent);
        color: var(--label);
        font-size: 0.882em;
        line-height: 1.4;
      }
      .gist-label { flex: none; font-size: 0.647em; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--hotword); }
      .content ul, .content ol { margin: 6px 0 10px; padding-left: 22px; }
      .content li { margin: 4px 0; padding-left: 2px; }
      .content li::marker { color: var(--label-3); }
      .content blockquote { margin: 8px 0; padding: 2px 12px; border-left: 2px solid var(--accent-tint-2); color: var(--label-2); }
      .content a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
      .content code.inline, .content :not(pre) > code {
        padding: 1px 5px;
        border-radius: 5px;
        background: var(--fill-1);
        font: 0.9em ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        white-space: pre-wrap;
      }
      .content .math { font: 0.95em ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: var(--accent); }
      .content hr { border: 0; height: 0.5px; background: var(--hair); margin: 14px 0; }
      .content .caret {
        display: inline-block;
        width: 2px;
        height: 1.05em;
        margin-left: 2px;
        vertical-align: -3px;
        border-radius: 1px;
        background: var(--accent);
        animation: caret 1s steps(2, end) infinite;
      }
      @keyframes caret { 50% { opacity: 0; } }
      /* Code blocks stay dark in both themes; the syntax palette is tuned for it. */
      .content .codeblock { margin: 10px 0 12px; border-radius: var(--r-md); overflow: hidden; background: var(--code-bg); box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.08); }
      .content .codeblock-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 8px 6px 14px;
        color: rgba(235, 235, 245, 0.55);
        font-size: var(--type-caption);
        letter-spacing: 0.04em;
        text-transform: lowercase;
        border-bottom: 0.5px solid rgba(255, 255, 255, 0.06);
      }
      .content .codeblock-copy {
        padding: 4px 10px;
        border-radius: var(--r-pill);
        color: rgba(235, 235, 245, 0.7);
        font-size: var(--type-caption);
        letter-spacing: 0;
        text-transform: none;
        transition: background-color var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out);
      }
      .content .codeblock-copy:active { background: rgba(255, 255, 255, 0.1); }
      .content .codeblock-copy.copied { color: #30d158; }
      .content .codeblock pre {
        margin: 0;
        padding: 12px 14px 14px;
        overflow-x: auto;
        font: 13px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
        color: #e6edf3;
        white-space: pre;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .content .codeblock pre::-webkit-scrollbar { display: none; }
      .content .codeblock.streaming .codeblock-head { color: #95aff6; }
      /* A diagram: the desktop's drawing as an image, on a light card in both
         themes (it is drawn with a light palette), with its source underneath. */
      .content .diagram { margin: 10px 0 12px; }
      .content .diagram-view {
        border-radius: var(--r-md);
        background: #ffffff;
        box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.12);
        padding: 12px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        text-align: center;
      }
      .content .diagram-img { display: inline-block; max-width: 100%; height: auto; vertical-align: top; }
      .content .diagram.is-wide .diagram-img { max-width: none; }
      .content .diagram-note { color: #4b5563; font-size: var(--type-caption); padding: 10px 4px; }
      .content .diagram-source { margin-top: 6px; }
      .content .diagram-source > summary {
        color: var(--label-2);
        font-size: var(--type-caption);
        padding: 4px 2px;
        cursor: pointer;
        list-style: none;
      }
      .content .diagram-source > summary::-webkit-details-marker { display: none; }
      .content .diagram-source[open] > summary { margin-bottom: 2px; }
      /* What sits under a chart: its values, assumptions and sources. */
      .content .diagram-notes { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; opacity: 0.85; }
      .content .diagram-notes li { margin: 2px 0; }
      .content pre .hl-c { color: #6b7d99; font-style: italic; }
      .content pre .hl-s { color: #a3e9b6; }
      .content pre .hl-k { color: #c8a8ff; }
      .content pre .hl-n { color: #ffd58a; }
      .content pre .hl-f { color: #7ec8ff; }
      .content pre .hl-t { color: #ff9bb6; }
      .content pre .hl-a { color: #8fd8ff; }
      .content pre .hl-v { color: #ffb482; font-style: italic; }
      .content pre .hl-o { color: #c0d0e0; }

      /* ── Dock ───────────────────────────────────────────── */
      .dock {
        position: absolute;
        z-index: 21;
        bottom: 0;
        left: var(--main-left);
        right: 0;
        padding: 6px 0 max(10px, calc(var(--safe-bottom) + 2px));
      }
      .dock-inner { max-width: 720px; margin: 0 auto; }
      .chips {
        display: flex;
        gap: var(--s2);
        overflow-x: auto;
        padding: 4px var(--gr) 10px var(--gl);
        scrollbar-width: none;
        -webkit-mask-image: linear-gradient(to right, transparent 0, #000 var(--gl), #000 calc(100% - 28px), transparent 100%);
        mask-image: linear-gradient(to right, transparent 0, #000 var(--gl), #000 calc(100% - 28px), transparent 100%);
      }
      .chips::-webkit-scrollbar { display: none; }
      .chip {
        position: relative;
        flex: 0 0 auto;
        height: 34px;
        padding: 0 14px;
        border-radius: var(--r-pill);
        background: var(--fill-1);
        box-shadow: inset 0 0 0 0.5px var(--hair);
        color: var(--label);
        font-size: var(--type-subhead);
        font-weight: 560;
        letter-spacing: -0.01em;
        white-space: nowrap;
        transition: background-color var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out), transform var(--duration-quick) var(--ease-out), opacity var(--duration-fast) var(--ease-smooth-out);
      }
      .chip::after { content: ""; position: absolute; left: -4px; right: -4px; top: -5px; bottom: -5px; }
      .chip.is-primary { background: var(--accent-tint); color: var(--accent); box-shadow: none; }
      .chip:active, .chip.is-pressed { transform: scale(0.96); background: var(--fill-press); transition-duration: var(--duration-micro); }
      .chip.is-primary:active, .chip.is-primary.is-pressed { background: var(--accent-tint-2); }
      .chip.is-sent { background: var(--accent-tint-2); color: var(--accent); }
      .chip:disabled { opacity: 0.4; }
      /* Needs a meeting and none is running: still tappable, it says why. */
      .chip.needs-meeting { opacity: 0.45; }
      /* Tapped anyway: a short shake says no (transitions.dev error state
         shake; stops are cumulative 80 + 60 + 80 + 60 ms of 280). */
      .chip.is-shaking {
        animation: t-input-shake calc(var(--shake-dur-a) * 2 + var(--shake-dur-b) * 2) linear;
      }
      @keyframes t-input-shake {
        0%      { transform: translateX(0);                                 animation-timing-function: var(--shake-ease); }
        28.57%  { transform: translateX(var(--shake-distance));             animation-timing-function: var(--shake-ease); }
        57.14%  { transform: translateX(calc(var(--shake-distance) * -1)); animation-timing-function: var(--shake-ease); }
        78.57%  { transform: translateX(var(--shake-overshoot));            animation-timing-function: var(--shake-ease); }
        100%    { transform: translateX(0); }
      }
      .composer { display: flex; align-items: flex-end; gap: var(--s2); padding: 0 var(--gr) 0 var(--gl); }
      .composer .icon-btn { width: 44px; height: 44px; flex: 0 0 44px; background: var(--fill-1); color: var(--label-2); }
      .composer .icon-btn:disabled, .composer .icon-btn.is-disabled { opacity: 0.4; }
      .composer .icon-btn.is-disabled { pointer-events: none; }
      label.icon-btn { cursor: pointer; }
      /* A photo or screenshot sent from this phone, on the sender's side. */
      .shot {
        max-width: min(64%, 300px);
        border-radius: var(--r-lg) 4px var(--r-lg) var(--r-lg);
        overflow: hidden;
        background: var(--fill-1);
        box-shadow: inset 0 0 0 0.5px var(--hair);
        transition: opacity var(--duration-fast) var(--ease-smooth-out);
      }
      .shot img { display: block; width: 100%; height: auto; max-height: 280px; object-fit: cover; }
      .row-user.is-sending .shot { opacity: 0.62; }
      /* Screenshots a question was sent with, on the desktop. The hairline sits
         over the image, so a dark capture keeps its edge on a dark feed. */
      .shots { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; max-width: min(82%, 420px); }
      .shots .shot { position: relative; max-width: 100%; box-shadow: none; }
      .shots .shot::after, .tray-thumb::after { content: ""; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 0.5px var(--hair); pointer-events: none; }
      .shots.is-multi .shot { flex: 0 1 calc(50% - 3px); border-radius: var(--r-md); }
      .shots.is-many .shot { flex-basis: calc((100% - 12px) / 3); border-radius: var(--r-md); }
      .shots.is-multi .shot img { aspect-ratio: 16 / 10; max-height: 150px; }

      /* Screenshot tray: what the desktop's next answer goes out with, as the
         overlay lists it above its input. Opens by its row height. */
      .tray-wrap {
        display: grid;
        grid-template-rows: 0fr;
        opacity: 0;
        transition: grid-template-rows var(--resize-dur) var(--resize-ease), opacity var(--duration-fast) var(--ease-smooth-out);
      }
      .tray-wrap[data-open="true"] { grid-template-rows: 1fr; opacity: 1; }
      .tray-clip { min-height: 0; overflow: hidden; }
      .tray {
        display: flex;
        align-items: center;
        gap: var(--s3);
        margin: 2px var(--gr) 8px var(--gl);
        padding: 8px 14px 8px 8px;
        border-radius: var(--r-lg);
        background: var(--fill-1);
        box-shadow: inset 0 0 0 0.5px var(--hair);
      }
      /* Scrolls when it can't hold them all; the clipped edge fades, as the
         buttons below do, instead of cutting a thumbnail off. */
      .tray-thumbs {
        --fade-l: 0px;
        --fade-r: 0px;
        display: flex;
        gap: 6px;
        flex: 0 1 auto;
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
        -webkit-mask-image: linear-gradient(to right, transparent 0, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent 100%);
        mask-image: linear-gradient(to right, transparent 0, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent 100%);
      }
      .tray-thumbs::-webkit-scrollbar { display: none; }
      .tray-thumb { position: relative; flex: 0 0 auto; height: 44px; border-radius: var(--r-sm); overflow: hidden; background: var(--fill-2); }
      .tray-thumb img { display: block; height: 100%; width: auto; min-width: 44px; max-width: 96px; object-fit: cover; }
      .tray-thumb.is-new { animation: thumb-in var(--duration-fast) var(--ease-bounce) both; }
      @keyframes thumb-in { from { opacity: 0; transform: scale(0.9); } }
      .tray-thumb.is-leaving {
        width: 0 !important;
        margin-left: -6px;
        opacity: 0;
        transform: scale(0.9);
        pointer-events: none;
        transition: width var(--duration-fast) var(--ease-smooth-out), margin var(--duration-fast) var(--ease-smooth-out), opacity var(--duration-quick) var(--ease-out), transform var(--duration-fast) var(--ease-smooth-out);
      }
      /* Remove: a dark disc on the picture's corner (readable on any capture),
         its touch target the whole corner of the thumbnail. */
      .tray-remove {
        position: absolute;
        top: 3px;
        right: 3px;
        display: grid;
        place-items: center;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.62);
        box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.28);
        color: #fff;
        transition: transform var(--duration-micro) var(--ease-out), background-color var(--duration-quick) var(--ease-out);
      }
      .tray-remove::after { content: ""; position: absolute; top: -3px; right: -3px; width: 34px; height: 34px; }
      .tray-remove:active { transform: scale(0.88); background: rgba(0, 0, 0, 0.8); }
      .tray-text { display: flex; flex-direction: column; flex: 1 0 auto; min-width: 0; }
      .tray-title { font-size: var(--type-subhead); line-height: 18px; font-weight: 600; letter-spacing: -0.01em; color: var(--label); white-space: nowrap; }
      .tray-sub { font-size: var(--type-caption); line-height: 16px; color: var(--label-3); white-space: nowrap; }
      .field {
        position: relative;
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: flex-end;
        border-radius: var(--r-pill);
        background: var(--fill-1);
        box-shadow: inset 0 0 0 0.5px var(--hair);
        transition: box-shadow var(--duration-fast) var(--ease-smooth-out), background-color var(--duration-fast) var(--ease-smooth-out);
      }
      .field:focus-within { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent); }
      .field textarea {
        display: block;
        flex: 1;
        min-width: 0;
        height: 44px;
        max-height: 132px;
        padding: 11px 6px 11px 16px;
        border: 0;
        background: transparent;
        resize: none;
        font-size: var(--type-callout);
        line-height: 22px;
        color: var(--label);
        caret-color: var(--accent-fill);
      }
      .field textarea::placeholder { color: var(--label-3); }
      .field textarea:focus-visible { outline: none; }
      .send {
        flex: 0 0 auto;
        width: 32px;
        height: 32px;
        margin: 6px 6px 6px 0;
        border-radius: 50%;
        background: var(--accent-fill);
        color: var(--on-accent);
        transform: scale(1);
        transition: background-color var(--duration-fast) var(--ease-smooth-out), color var(--duration-fast) var(--ease-smooth-out), transform var(--duration-quick) var(--ease-out);
      }
      .send:disabled { background: var(--fill-2); color: var(--label-3); }
      .send:not(:disabled):active, .send.is-pressed { transform: scale(0.9); transition-duration: var(--duration-micro); }

      /* Icon swap (transitions.dev). */
      .t-icon-swap {
        position: relative;
        display: inline-grid;
        place-items: center;
      }
      .t-icon-swap .t-icon {
        grid-area: 1 / 1;
        transition:
          opacity   var(--icon-swap-dur) var(--icon-swap-ease),
          filter    var(--icon-swap-dur) var(--icon-swap-ease),
          transform var(--icon-swap-dur) var(--icon-swap-ease);
        will-change: opacity, filter, transform;
      }
      .t-icon-swap[data-state="a"] .t-icon[data-icon="a"],
      .t-icon-swap[data-state="b"] .t-icon[data-icon="b"] {
        opacity: 1;
        filter: blur(0);
        transform: scale(1);
      }
      .t-icon-swap[data-state="a"] .t-icon[data-icon="b"],
      .t-icon-swap[data-state="b"] .t-icon[data-icon="a"] {
        opacity: 0;
        filter: blur(var(--icon-swap-blur));
        transform: scale(var(--icon-swap-start-scale));
      }
      /* Third state for three-step buttons (capture: camera, working, done). */
      .t-icon-swap[data-state="c"] .t-icon[data-icon="c"] {
        opacity: 1;
        filter: blur(0);
        transform: scale(1);
      }
      .t-icon-swap[data-state="c"] .t-icon:not([data-icon="c"]),
      .t-icon-swap:not([data-state="c"]) .t-icon[data-icon="c"] {
        opacity: 0;
        filter: blur(var(--icon-swap-blur));
        transform: scale(var(--icon-swap-start-scale));
      }
      .composer .icon-btn[data-state="c"] { color: var(--live); }
      .copy-btn { width: 32px; height: 32px; border-radius: 50%; color: var(--label-3); transition: background-color var(--duration-quick) var(--ease-out), color var(--duration-quick) var(--ease-out); }
      .copy-btn:active { background: var(--fill-2); }
      .copy-btn[data-state="b"] { color: var(--live); }
      .spin { animation: spin 900ms linear infinite; transform-origin: center; }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* Jump to latest */
      .jump {
        position: absolute;
        left: 50%;
        bottom: calc(100% + 6px);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 34px;
        padding: 0 14px 0 11px;
        translate: -50% 0;
        border-radius: var(--r-pill);
        background: var(--menu-bg);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        backdrop-filter: blur(20px) saturate(180%);
        box-shadow: inset 0 0 0 0.5px var(--hair), var(--shadow-float);
        color: var(--label);
        font-size: var(--type-footnote);
        font-weight: 600;
        pointer-events: none;
      }
      .jump.is-open { pointer-events: auto; }
      .app.has-toast .jump.is-open {
        opacity: 0;
        transform: translateY(var(--toast-distance)) scale(var(--toast-scale));
        filter: blur(var(--toast-blur));
        pointer-events: none;
      }
      .jump-count {
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: var(--r-pill);
        background: var(--accent-fill);
        color: var(--on-accent);
        font-size: var(--type-caption2);
        line-height: 18px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .jump-count:empty { display: none; }

      /* Toast (transitions.dev). */
      .t-toast {
        opacity: 0;
        transform: translateY(var(--toast-distance)) scale(var(--toast-scale));
        filter: blur(var(--toast-blur));
        will-change: transform, opacity, filter;
        transition:
          opacity var(--toast-close) var(--toast-ease),
          transform var(--toast-close) var(--toast-ease),
          filter var(--toast-close) var(--toast-ease);
      }
      .t-toast.is-open {
        opacity: 1;
        transform: translateY(0) scale(1);
        filter: blur(0);
        transition:
          opacity var(--toast-open) var(--toast-ease),
          transform var(--toast-open) var(--toast-ease),
          filter var(--toast-open) var(--toast-ease);
      }
      .toast {
        position: absolute;
        z-index: 40;
        left: 50%;
        bottom: calc(var(--dock-h) + 14px);
        max-width: calc(100% - 48px);
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 9px 16px 9px 12px;
        border-radius: var(--r-pill);
        background: var(--menu-bg);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        backdrop-filter: blur(20px) saturate(180%);
        box-shadow: inset 0 0 0 0.5px var(--hair), var(--shadow-float);
        font-size: var(--type-subhead);
        font-weight: 560;
        white-space: nowrap;
        pointer-events: none;
        translate: -50% 0;
      }
      .toast-icon { color: var(--live); display: inline-flex; }
      .toast.is-bad .toast-icon { color: var(--danger); }
      .toast-text { overflow: hidden; text-overflow: ellipsis; }

      /* Menu (transitions.dev dropdown). */
      .t-dropdown {
        transform-origin: top left;
        transform: scale(var(--dropdown-pre-scale));
        opacity: 0;
        pointer-events: none;
        transition:
          transform var(--dropdown-open-dur) var(--dropdown-ease),
          opacity   var(--dropdown-open-dur) var(--dropdown-ease);
        will-change: transform, opacity;
      }
      .t-dropdown[data-origin="top-right"]     { transform-origin: top right; }
      .t-dropdown.is-open {
        transform: scale(1);
        opacity: 1;
        pointer-events: auto;
      }
      .t-dropdown.is-closing {
        transform: scale(var(--dropdown-closing-scale));
        opacity: 0;
        pointer-events: none;
        transition:
          transform var(--dropdown-close-dur) var(--dropdown-ease),
          opacity   var(--dropdown-close-dur) var(--dropdown-ease);
      }
      .menu {
        position: absolute;
        z-index: 50;
        top: calc(var(--bar-h) - 2px);
        right: var(--gr);
        min-width: 232px;
        padding: 6px;
        border-radius: var(--r-lg);
        background: var(--menu-bg);
        -webkit-backdrop-filter: blur(28px) saturate(180%);
        backdrop-filter: blur(28px) saturate(180%);
        box-shadow: inset 0 0 0 0.5px var(--hair), var(--shadow-float);
      }
      .menu-item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 44px;
        padding: 0 12px;
        border-radius: var(--r-md);
        font-size: var(--type-callout);
        text-align: left;
        color: var(--label);
      }
      .menu-item svg { color: var(--label-2); }
      .menu-item:active { background: var(--fill-2); }
      .menu-item.is-danger, .menu-item.is-danger svg { color: var(--danger); }
      .menu-sep { height: 0.5px; margin: 5px 10px; background: var(--hair); }
      .menu-note { padding: 4px 12px 6px; font-size: var(--type-caption); line-height: 16px; color: var(--label-3); }

      /* Text swap (transitions.dev). */
      .t-text-swap {
        display: inline-block;
        transform: translateY(0);
        filter: blur(0);
        opacity: 1;
        transition:
          transform var(--text-swap-dur) var(--text-swap-ease),
          filter    var(--text-swap-dur) var(--text-swap-ease),
          opacity   var(--text-swap-dur) var(--text-swap-ease);
        will-change: transform, filter, opacity;
      }
      .t-text-swap.is-exit {
        transform: translateY(calc(var(--text-swap-translate-y) * -1));
        filter: blur(var(--text-swap-blur));
        opacity: 0;
      }
      .t-text-swap.is-enter-start {
        transform: translateY(var(--text-swap-translate-y));
        filter: blur(var(--text-swap-blur));
        opacity: 0;
        transition: none;
      }

      /* ── Lock screen: pairing link missing or expired ────── */
      .lock {
        position: absolute;
        z-index: 60;
        inset: 0;
        display: grid;
        place-items: center;
        padding: calc(var(--safe-top) + 24px) var(--gr) calc(var(--safe-bottom) + 24px) var(--gl);
        background: var(--bg);
        text-align: center;
      }
      .lock[hidden] { display: none; }
      .lock-card { max-width: 340px; }
      .lock-icon { display: inline-grid; place-items: center; width: 56px; height: 56px; margin-bottom: 18px; border-radius: var(--r-lg); background: var(--fill-1); color: var(--label-2); }
      .lock h1 { margin: 0 0 8px; font-size: var(--type-title2); line-height: 28px; font-weight: 650; letter-spacing: -0.026em; }
      .lock p { margin: 0; font-size: var(--type-subhead); line-height: 21px; color: var(--label-2); }
      .lock b { color: var(--label); font-weight: 600; }

      /* ── Split layout: tablets (phones keep the rolling line) ── */
      @media (min-width: 760px) and (min-height: 500px) {
        :root { --main-left: calc(var(--gl) + var(--tx-w)); --chrome-top-h: var(--bar-h); }
        .tx {
          --txp: 1;
          left: var(--gl);
          right: auto;
          width: var(--tx-w);
          bottom: max(12px, var(--safe-bottom));
          height: auto;
          touch-action: auto;
        }
        .tx-ticker, .tx-chevron, .tx-grip, .tx-grip-hit { display: none; }
        .tx-full { pointer-events: auto; }
        .tx-head { cursor: default; }
        .scrim { display: none; }
        .feed { padding-top: calc(var(--chrome-top-h) + var(--s3)); }
        .feed-inner { padding-left: var(--s4); }
        .chips { padding-left: var(--s4); -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent 100%); mask-image: linear-gradient(to right, #000 calc(100% - 28px), transparent 100%); }
        .composer { padding-left: var(--s4); }
        .toast { left: calc(var(--main-left) + (100% - var(--main-left)) / 2); }
      }
      /* Landscape phones: every pixel of height counts. */
      @media (orientation: landscape) and (max-height: 499px) {
        :root { --tx-collapsed: 34px; }
        .bar { min-height: calc(var(--safe-top) + 44px); padding-top: calc(var(--safe-top) + 4px); padding-bottom: 4px; }
        .chips { padding-bottom: 6px; }
        .chip { height: 30px; font-size: var(--type-footnote); }
        .tray { margin-bottom: 6px; padding: 6px 12px 6px 6px; border-radius: var(--r-md); }
        .tray-thumb { height: 34px; border-radius: var(--r-sm); }
        .tray-thumb img { min-width: 34px; max-width: 72px; }
        .tray-remove { top: 2px; right: 2px; width: 16px; height: 16px; }
        .composer .icon-btn { width: 40px; height: 40px; flex-basis: 40px; }
        .field textarea { height: 40px; padding-top: 9px; padding-bottom: 9px; }
        .send { margin: 4px 4px 4px 0; }
      }
      /* Keyboard up on a short screen: the chips give their row to the text. */
      .app.is-short.kb-up .chips, .app.is-short.kb-up .tray-wrap { display: none; }

      /* ── Accessibility preferences ──────────────────────── */
      @media (prefers-reduced-motion: reduce) {
        .enter { animation: fade-in var(--duration-fast) var(--ease-out) both; }
        @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
        .tray-wrap { transition: opacity var(--duration-fast) var(--ease-out); }
        .tray-thumb.is-new { animation: fade-in var(--duration-fast) var(--ease-out) both; }
        .t-stagger-line { transition: none !important; }
        .chip.is-shaking { animation: none !important; }
        .tk-line { scroll-behavior: auto; }
        .app[data-meeting="live"][data-speaking="true"] .tk-dot { animation: none; }
        .t-icon-swap .t-icon { transition: none !important; }
        .t-toast { transition: none !important; }
        .t-dropdown { transition: none !important; }
        .t-text-swap { transition: none !important; }
        .conn { transition: none !important; }
        .tx-chevron { transition: none !important; }
        .answer-body { transition: none !important; }
        .thinking { animation: none; background-image: none; color: var(--label-2); -webkit-text-fill-color: var(--label-2); }
        .app[data-speaking="true"] .eq i { animation: none; height: 7px; }
        .content .caret { animation: none; }
        .spin { animation-duration: 2400ms; }
      }
      @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
        :root { --island: var(--card); --menu-bg: var(--card); --chrome: var(--bg); }
      }
      @media (prefers-reduced-transparency: reduce) {
        :root { --island: var(--card); --menu-bg: var(--card); --chrome: var(--bg); }
        .chrome-top, .chrome-bottom, .tx, .menu, .toast, .jump { -webkit-backdrop-filter: none; backdrop-filter: none; }
      }
      @media (prefers-contrast: more) {
        :root { --hair: rgba(127, 127, 127, 0.6); --card-hair: rgba(127, 127, 127, 0.6); --label-2: var(--label); --label-3: var(--label); }
      }
    </style>
  </head>
  <body>
    <div class="app" id="app" data-conn="connecting" data-meeting="idle" data-speaking="false">
      <div class="chrome-top" aria-hidden="true"></div>

      <header class="bar" id="bar">
        <div class="brand">
          <img alt="" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAACXBIWXMAAAsTAAALEwEAmpwYAAAFrklEQVR42tVbS2yVRRT+uaSCLeWhxLAQIm1dQG1iE4gLFyQsWBIoFBWxhmC6ImlsumyxIBsehRWJURsTpL0RIRAeRRYmFAs+ACEBdWEkJCTGWntbDQtobX/OhK/mps6cef0zvZzkS6D/mdd3Z87MOXMmSQJLmqYvEDYTPiDkCTcIdwkFwhhQwN/Et17CLsImUTZ5GoU6vppwiHCbMJm6yyTq6CKsKvVBzye0EX5Ow8lPaKOylAb+HGE3pnEsEW11EhbN5MBnEZoIf6YzJ8OEFkIu9uBrCFc8O/8vfskC/u0jA4TqWIN/g/C3ReceEi5hF2ggrCTMldQ7l1ALHTG9+wmPLNoZJTSGHHiOcNji1+0jvEUo92izgrCVcMFilnRlviSowmewP5vIKUJVgB+gmvCFYR96CGVZDv685XrMBZqFay36cc6bBEz7Xgej1FICBAg5JnYrnwYPO1rlB4GWwVqHvhzwsfacjGm+f+3Fvh0B45q+bHbZ57mt7hPCcQP2myMRIPrSrdkiq2xOeNwh5zhsQ96AAEHi0ggEiL7MJpxk+nLZaEaS0g6NhZ8DvbzhGuyLQUDRYepbpi/vmjg2Q4rCfxFeLNLNWxiiphgEQGcZfASZDBIWcg3sYQaxYZpu3tJpWRKDAOhtYvqyi/PnVS7taYl+3nI7OhOLAOieZX6MSlnlbYwz85IFAYMMCVsiElDFOFOtsspvK5Q/UnRGRcB2wj+Kb0M+cT4bAqD/qSqyJIvhqby6KksCRCd3co5KRAJqGC+yvljxkO0WpiEgh31XJetjEIAyX2mPyPSfOwqlN10IwPfl8Alk8rtLPM+RgG2KMjeL4/aTCuNX7kqAxrAK6Y5EwDyFMZwgLE5waSGTS5rOmBAgjqffMTH/daEJQLlvFOUaEsTqZNLpSwD0ajGbZHLPJsbvQYDqgNfBDWRjFgRAt51ZCkciEKCa5cfEx+uKjyszJKBMGB2FvliLawIT8Iqi3A8JpqFMns2KAOjXM4GLX02ixx4EVCjK3U0UntO4QWesCECZvcxSOBiKAJSVkT+UKLaIQiAC5jBnDrEUXg9IwIhsq49KAMq9xhxPf5HdGoUmINoSKCp7kFkKe2MvgShGcFrZchg+VYS3PqYRVG2DtaEIQPk1WPfSc7rsVseDgDpuG+xVHhMDEoA6jjBLoT3CQejz4EdhTR2VzBJ8OH0WehDwIXcUVgUQ+0MTgHrWMYlUwpGanQEBA8rjvsYdrghNAOribnXaPN3hSsU13hN3WBMP3BqJgAWE+8xSWOFBwDuKMj+ahMQuxCAA9a3XXGvlHAm4qCizv1hpFRMUrY5BAOrsYUjY6RAUfZk5db5qGhb/OCIBzxP+YHIO3rMkoNsoLK6J3wlfYXkMAlDvFmYWDFpcjNQwOQytKmtZMLUFoQhA3Scsr91kBJyzuhpDoU6mkYaIBCxhbnhNLkcbGd0OruFFqTr1VXRoWQwCUH+TCwHiHpOZycK+LNA1vJ1p6OqUvx6aALTRZ0OA8GAJ33vlKSBFZoCp5ATi/TEIWGqYljuVInOK0ek3TtpCVuYod6vDJEllRgD60mxAwJeEz5jvI7KdTNdwo6bR8UgEzELKnUtfpm6gGlwb70rtJVMCipIdHqRuss83VbZnpglAX1ocBn/UO1kTtzrnS4CAnMY4T5ezWWaMlyHx2ESEcawJQIBwbM5Y/PJlId4IHUjNH0yIzIy3uaCKQZvz4M9fNHwwIQzevqxzlBNJDt6oxVQcw/38bgQn62T3gAiV10FnD6b7mEU7I87W3tEqX079ZKLo0dSEZ1391vt8hs/mBtN0Rp/NNQed8gZELEyfvPUdjjhwkbfcoXVsIhMhDFYrc/ubhYio1fuirSQp7XfE9dgxbnmu7wlck+3/XwwveXpeki/GY8h2nCqvEX7DknkEDONv13DeELob/4vbB5THVENMjMqwjLIAAAAASUVORK5CYII=" />
          <span class="brand-name">Natively</span>
        </div>
        <div class="conn" id="conn" role="status" aria-live="polite">
          <span class="conn-dot" aria-hidden="true"></span>
          <span class="t-text-swap" id="connText">Connecting</span>
        </div>
        <button class="icon-btn" id="menuBtn" type="button" aria-label="More" aria-haspopup="menu" aria-expanded="false" aria-controls="menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/></svg>
        </button>
      </header>

      <section class="tx" id="tx" data-open="false" aria-label="Live transcript">
        <div class="tx-ticker" id="txTicker" role="button" tabindex="0" aria-expanded="false" aria-controls="txBody" aria-label="Live transcript, open to read it all">
          <div class="tk-line" id="tkLine" aria-hidden="true"><span id="tkFinal"></span><span class="tk-live" id="tkLive"></span><span class="tk-empty" id="tkEmpty">No meeting running</span></div>
          <span class="tk-dot" aria-hidden="true"></span>
          <span class="tk-chevron" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg></span>
        </div>
        <div class="tx-full">
          <div class="tx-head" id="txHead" role="button" tabindex="0" aria-expanded="false" aria-controls="txBody">
            <span class="tx-title">Transcript</span>
            <span class="tx-state"><span class="tx-dot" aria-hidden="true"></span><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span><span class="t-text-swap" id="txState">No meeting</span></span>
            <span class="tx-spacer"></span>
            <span class="tx-chevron" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg></span>
          </div>
          <div class="tx-body" id="txBody" aria-live="off">
            <div class="tx-lines" id="txLines"></div>
            <p class="tx-empty" id="txEmpty">The interviewer's words appear here once a meeting starts on your desktop.</p>
          </div>
        </div>
        <div class="tx-grip" aria-hidden="true"></div>
        <div class="tx-grip-hit" aria-hidden="true"></div>
      </section>
      <div class="scrim" id="scrim" aria-hidden="true"></div>

      <main class="feed" id="feed" role="log" aria-label="Answers" aria-live="off">
        <div class="feed-inner" id="feedInner">
          <div class="empty t-stagger" id="empty">
            <p class="empty-title t-stagger-line" id="emptyTitle">Connecting to your desktop</p>
            <p class="empty-sub t-stagger-line t-stagger-line--2" id="emptySub">Keep Natively open on your computer.</p>
          </div>
        </div>
      </main>

      <div class="chrome-bottom" aria-hidden="true"></div>
      <footer class="dock" id="dock">
        <div class="dock-inner">
          <button class="jump t-toast" id="jump" type="button" aria-label="Jump to the latest answer" tabindex="-1">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/></svg>
            <span>Latest</span>
            <span class="jump-count" id="jumpCount"></span>
          </button>
          <div class="tray-wrap" id="trayWrap" data-open="false" aria-hidden="true">
            <div class="tray-clip">
              <div class="tray">
                <div class="tray-thumbs" id="trayThumbs"></div>
                <div class="tray-text">
                  <span class="tray-title" id="trayTitle"></span>
                  <span class="tray-sub">Goes with the next answer</span>
                </div>
              </div>
            </div>
          </div>
          <div class="chips" id="chips" role="toolbar" aria-label="Ask your desktop">
            <button class="chip is-primary" type="button" data-action="whatToAnswer" data-needs-meeting>What to Say</button>
            <button class="chip" type="button" data-action="answer">Answer</button>
            <button class="chip" type="button" data-action="followUp" data-needs-meeting>Follow Up</button>
            <button class="chip" type="button" data-action="clarify" data-needs-meeting>Clarify</button>
            <button class="chip" type="button" data-action="codeHint">Code Hint</button>
            <button class="chip" type="button" data-action="brainstorm">Brainstorm</button>
            <button class="chip" type="button" data-action="recap" data-needs-meeting>Recap</button>
          </div>
          <div class="composer">
            <button class="icon-btn t-icon-swap" id="captureBtn" type="button" data-state="a" aria-label="Capture your computer's screen for the next answer">
              <svg class="t-icon" data-icon="a" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 4.5h15A1.5 1.5 0 0 1 21 6v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5V6a1.5 1.5 0 0 1 1.5-1.5zM9 20.5h6M12 17v3.5"/></svg>
              <svg class="t-icon spin" data-icon="b" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5"/></svg>
              <svg class="t-icon" data-icon="c" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
            </button>
            <label class="icon-btn" id="imageBtn" for="imageInput" role="button" tabindex="0" aria-label="Send a photo or screenshot from this phone">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="M20.5 15.2l-4.6-4.6L7.2 19.3"/></svg>
            </label>
            <input class="sr-only" id="imageInput" type="file" accept="image/*" multiple tabindex="-1" aria-hidden="true" />
            <div class="field">
              <label class="sr-only" for="input">Message your desktop</label>
              <textarea id="input" rows="1" maxlength="2000" placeholder="Ask anything" enterkeyhint="send" autocomplete="off" autocorrect="on" spellcheck="true"></textarea>
              <button class="send t-icon-swap" id="sendBtn" type="button" data-state="a" aria-label="Send" disabled>
                <svg class="t-icon" data-icon="a" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>
                <svg class="t-icon" data-icon="b" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
              </button>
            </div>
          </div>
        </div>
      </footer>

      <div class="toast t-toast" id="toast" role="status" aria-live="polite">
        <span class="toast-icon" id="toastIcon"></span>
        <span class="toast-text" id="toastText"></span>
      </div>

      <div class="menu t-dropdown" id="menu" role="menu" data-origin="top-right" aria-label="More">
        <button class="menu-item" type="button" role="menuitem" data-menu="copy">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"/></svg>
          Copy conversation
        </button>
        <button class="menu-item" type="button" role="menuitem" data-menu="transcript">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h9"/></svg>
          Copy transcript
        </button>
        <div class="menu-sep"></div>
        <button class="menu-item is-danger" type="button" role="menuitem" data-menu="clear">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.8 11.2A2 2 0 0 0 9.3 20h5.4a2 2 0 0 0 2-1.8L17.5 7M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7"/></svg>
          Clear this screen
        </button>
        <p class="menu-note">Clearing only affects this phone.</p>
      </div>

      <div class="lock" id="lock" hidden>
        <div class="lock-card">
          <div class="lock-icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><path d="M14 14h2.5v2.5H14zM17.5 17.5H20V20h-2.5zM20 14v1M14 20h1"/></svg>
          </div>
          <h1 id="lockTitle">This pairing link has expired</h1>
          <p>On your computer, open <b>Natively Settings › Sync › Pair a phone</b>, then scan the code<span id="lockAgain"> again</span>.</p>
        </div>
      </div>

      <div class="sr-only" id="sr" aria-live="polite"></div>
    </div>

    <script>
      (function () {
        'use strict';
        // ───── Markdown renderer ─────────────────────────────────────────
        const HTML_ESCAPE = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        function esc(str) { return String(str || '').replace(/[&<>"']/g, function (c) { return HTML_ESCAPE[c]; }); }

        // ───── Syntax highlighter ────────────────────────────────────────
        const LANG_ALIAS = {
          js: 'js', javascript: 'js', jsx: 'js',
          ts: 'js', typescript: 'js', tsx: 'js',
          py: 'py', python: 'py',
          sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh',
          json: 'json',
          go: 'go', golang: 'go',
          rs: 'rs', rust: 'rs',
          c: 'c', cpp: 'c', 'c++': 'c', cc: 'c', h: 'c', hpp: 'c', java: 'c', cs: 'c', csharp: 'c',
          html: 'html', xml: 'html', svg: 'html',
          css: 'css', scss: 'css', sass: 'css',
          sql: 'sql',
          yaml: 'yaml', yml: 'yaml',
        };
        const HL_RULES = {
          py: [
            ['c', /^#[^\\n]*/],
            ['s', /^(?:"""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$)|"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')/],
            ['k', /^\\b(?:def|class|return|if|elif|else|for|while|in|is|not|and|or|import|from|as|with|try|except|finally|raise|lambda|yield|pass|break|continue|global|nonlocal|None|True|False|async|await|del|assert|match|case)\\b/],
            ['v', /^\\b(?:self|cls)\\b/],
            ['n', /^\\b(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\\d+\\.?\\d*(?:e[+-]?\\d+)?[jJ]?)\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*\\()/],
            ['o', /^[+\\-*/%=<>!&|^~?:@]+/],
          ],
          js: [
            ['c', /^(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))/],
            ['s', /^(?:\`(?:[^\`\\\\]|\\\\.)*(?:\`|$)|"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')/],
            ['k', /^\\b(?:const|let|var|function|return|if|else|for|while|do|break|continue|switch|case|default|new|delete|typeof|instanceof|in|of|throw|try|catch|finally|class|extends|super|null|undefined|true|false|async|await|yield|import|export|from|as|static|get|set|public|private|protected|interface|type|enum|namespace|implements|readonly|abstract|declare|void|never|any|unknown|keyof|infer|satisfies)\\b/],
            ['v', /^\\b(?:this|arguments|console|window|document|globalThis|process|require|module|exports)\\b/],
            ['n', /^\\b(?:0x[0-9a-fA-F]+|0b[01]+|\\d+\\.?\\d*(?:e[+-]?\\d+)?n?|\\.\\d+(?:e[+-]?\\d+)?)\\b/],
            ['f', /^\\b[A-Za-z_$][\\w$]*(?=\\s*\\()/],
            ['o', /^[+\\-*/%=<>!&|^~?:]+/],
          ],
          sh: [
            ['c', /^#[^\\n]*/],
            ['s', /^(?:"(?:[^"\\\\]|\\\\.)*"|'[^']*')/],
            ['v', /^\\$(?:\\{[^}]+\\}|[A-Za-z_]\\w*|[0-9!#?@*$])/],
            ['k', /^\\b(?:if|then|else|elif|fi|for|while|until|do|done|case|esac|in|function|return|exit|echo|export|local|set|unset|test|cd|ls|cat|grep|sed|awk|cut|sort|uniq|head|tail|wc|find|chmod|chown|mkdir|rm|cp|mv|ln|ssh|scp|rsync|curl|wget|sudo|read|printf|trap|source|eval)\\b/],
            ['n', /^\\b\\d+\\b/],
            ['o', /^[|&;<>=()$]+/],
          ],
          json: [
            ['a', /^"(?:[^"\\\\]|\\\\.)*"(?=\\s*:)/],
            ['s', /^"(?:[^"\\\\]|\\\\.)*"/],
            ['n', /^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?/],
            ['k', /^\\b(?:true|false|null)\\b/],
            ['o', /^[{}\\[\\],:]/],
          ],
          go: [
            ['c', /^(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))/],
            ['s', /^(?:\`[^\`]*(?:\`|$)|"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')/],
            ['k', /^\\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|nil|true|false|iota)\\b/],
            ['v', /^\\b(?:append|cap|close|complex|copy|delete|imag|len|make|new|panic|print|println|real|recover|string|int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|byte|rune|float32|float64|bool|error)\\b/],
            ['n', /^\\b(?:0x[0-9a-fA-F]+|0b[01]+|0o[0-7]+|\\d+\\.?\\d*(?:e[+-]?\\d+)?)\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*\\()/],
            ['o', /^[+\\-*/%=<>!&|^~?:]+/],
          ],
          rs: [
            ['c', /^(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))/],
            ['s', /^(?:b?"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)')/],
            ['k', /^\\b(?:as|async|await|break|const|continue|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while)\\b/],
            ['v', /^\\b(?:i8|i16|i32|i64|i128|isize|u8|u16|u32|u64|u128|usize|f32|f64|bool|char|str|String|Vec|Option|Result|Box|Rc|Arc|HashMap|HashSet|None|Some|Ok|Err)\\b/],
            ['n', /^\\b(?:0x[0-9a-fA-F_]+|0b[01_]+|0o[0-7_]+|\\d[\\d_]*\\.?\\d*(?:e[+-]?\\d+)?(?:[iuf](?:8|16|32|64|128|size))?)\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*[(!])/],
            ['o', /^[+\\-*/%=<>!&|^~?:@#]+/],
          ],
          c: [
            ['c', /^(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))/],
            ['s', /^(?:"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')/],
            ['k', /^\\b(?:auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|class|public|private|protected|virtual|new|delete|this|nullptr|namespace|using|template|typename|true|false|try|catch|throw|public|private|protected|abstract|interface|implements|extends|package|import|null|var|let|val|fun|fn)\\b/],
            ['n', /^\\b(?:0x[0-9a-fA-F]+|\\d+\\.?\\d*(?:[eE][+-]?\\d+)?[fFlLuU]*)\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*\\()/],
            ['o', /^[+\\-*/%=<>!&|^~?:]+/],
          ],
          html: [
            ['c', /^<!--[\\s\\S]*?(?:-->|$)/],
            ['t', /^<\\/?[A-Za-z][\\w-]*/],
            ['a', /^[A-Za-z_][\\w-]*(?=\\s*=)/],
            ['s', /^(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')/],
            ['o', /^[<>=\\/]/],
          ],
          css: [
            ['c', /^\\/\\*[\\s\\S]*?(?:\\*\\/|$)/],
            ['s', /^(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')/],
            ['a', /^[-A-Za-z]+(?=\\s*:)/],
            ['n', /^-?\\d+\\.?\\d*(?:px|em|rem|vw|vh|vmin|vmax|%|s|ms|deg|rad|turn|fr|ch|ex)?\\b/],
            ['k', /^@[A-Za-z-]+/],
            ['t', /^[#.][A-Za-z_][\\w-]*/],
            ['o', /^[{}();:,>+~]/],
          ],
          sql: [
            ['c', /^(?:--[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$))/],
            ['s', /^'(?:[^']|'')*'/],
            ['k', /^\\b(?:SELECT|FROM|WHERE|JOIN|INNER|LEFT|RIGHT|FULL|OUTER|CROSS|ON|GROUP|BY|HAVING|ORDER|LIMIT|OFFSET|INSERT|INTO|VALUES|UPDATE|SET|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|VIEW|AS|AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|ILIKE|IS|NULL|TRUE|FALSE|UNION|ALL|DISTINCT|CASE|WHEN|THEN|ELSE|END|WITH|RECURSIVE|PRIMARY|FOREIGN|KEY|REFERENCES|CONSTRAINT|UNIQUE|DEFAULT|CHECK|RETURNING|GRANT|REVOKE|BEGIN|COMMIT|ROLLBACK)\\b/i],
            ['n', /^\\b\\d+\\.?\\d*\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*\\()/],
            ['o', /^[=<>!()*,;.+\\-]/],
          ],
          yaml: [
            ['c', /^#[^\\n]*/],
            ['a', /^[A-Za-z_][\\w-]*(?=\\s*:)/],
            ['s', /^(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^']|'')*'|\\|[\\s\\S]*?$|>[\\s\\S]*?$)/],
            ['k', /^\\b(?:true|false|null|yes|no|on|off)\\b/i],
            ['n', /^-?\\d+\\.?\\d*\\b/],
            ['o', /^[:\\-?>|&*!]/],
          ],
          generic: [
            ['c', /^(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)|#[^\\n]*)/],
            ['s', /^(?:"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*(?:\`|$))/],
            ['n', /^\\b(?:0x[0-9a-fA-F]+|\\d+\\.?\\d*)\\b/],
            ['f', /^\\b[A-Za-z_]\\w*(?=\\s*\\()/],
          ],
        };
        function highlightCode(code, lang) {
          const key = LANG_ALIAS[(lang || '').toLowerCase()] || (lang ? null : null);
          const rules = (key && HL_RULES[key]) || (lang ? HL_RULES.generic : null);
          if (!rules) return esc(code);
          const out = [];
          let i = 0;
          const n = code.length;
          while (i < n) {
            const ch = code.charCodeAt(i);
            if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
              const start = i;
              do { i++; } while (i < n && (code.charCodeAt(i) === 32 || code.charCodeAt(i) === 9 || code.charCodeAt(i) === 10 || code.charCodeAt(i) === 13));
              out.push(esc(code.slice(start, i)));
              continue;
            }
            const tail = code.slice(i);
            let consumed = 0;
            for (let r = 0; r < rules.length; r++) {
              const rule = rules[r];
              const m = tail.match(rule[1]);
              if (m && m[0].length > 0) {
                out.push('<span class="hl-' + rule[0] + '">' + esc(m[0]) + '</span>');
                consumed = m[0].length;
                break;
              }
            }
            if (consumed === 0) {
              const idm = tail.match(/^[A-Za-z_$][\\w$]*/);
              if (idm) { out.push(esc(idm[0])); consumed = idm[0].length; }
              else { out.push(esc(code[i])); consumed = 1; }
            }
            i += consumed;
          }
          return out.join('');
        }

        function renderInline(text) {
          let out = esc(text);
          out = out.replace(/\`([^\`\\n]+)\`/g, function (_m, c) { return '<code class="inline">' + c + '</code>'; });
          out = out.replace(/(^|[^\\\\])\\$([^$\\n]+?)\\$/g, function (_m, pre, c) { return pre + '<span class="math">' + c + '</span>'; });
          out = out.replace(/\\*\\*([^*\\n]+?)\\*\\*/g, '<strong>$1</strong>');
          out = out.replace(/__([^_\\n]+?)__/g, '<strong>$1</strong>');
          out = out.replace(/(^|[^\\*])\\*([^*\\n]+?)\\*(?!\\*)/g, '$1<em>$2</em>');
          out = out.replace(/(^|[^_])_([^_\\n]+?)_(?!_)/g, '$1<em>$2</em>');
          out = out.replace(/\\[([^\\]\\n]+)\\]\\(([^)\\s]+)\\)/g, function (_m, label, href) {
            const safe = /^https?:\\/\\//i.test(href) ? href : '#';
            return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
          });
          return out;
        }

        function renderMarkdown(src) {
          if (!src) return '';
          const fences = [];
          const fenceRe = /\`\`\`([\\w-]*)?\\n?([\\s\\S]*?)\`\`\`/g;
          let placeheld = src.replace(fenceRe, function (_m, lang, code) {
            fences.push({ lang: (lang || '').toLowerCase(), code: code.replace(/\\n$/, ''), open: false });
            return '\\u0000FENCE' + (fences.length - 1) + '\\u0000';
          });
          const openFenceRe = /(^|\\n)\`\`\`([\\w-]*)?\\n?([\\s\\S]*)$/;
          const openMatch = placeheld.match(openFenceRe);
          if (openMatch) {
            const startIdx = openMatch.index + openMatch[1].length;
            fences.push({ lang: (openMatch[2] || '').toLowerCase(), code: openMatch[3], open: true });
            placeheld = placeheld.slice(0, startIdx) + '\\u0000FENCE' + (fences.length - 1) + '\\u0000';
          }

          const lines = placeheld.split(/\\n/);
          const out = [];
          let para = [];
          let list = null;
          let quote = [];

          function flushPara() {
            if (!para.length) return;
            const joined = para.join(' ').trim();
            if (joined) out.push('<p>' + renderInline(joined) + '</p>');
            para = [];
          }
          function flushList() {
            if (!list) return;
            out.push('<' + list.type + '>' + list.items.map(function (i) {
              return '<li>' + renderInline(i) + '</li>';
            }).join('') + '</' + list.type + '>');
            list = null;
          }
          function flushQuote() {
            if (!quote.length) return;
            out.push('<blockquote>' + renderInline(quote.join(' ')) + '</blockquote>');
            quote = [];
          }
          function flushAll() { flushPara(); flushList(); flushQuote(); }

          for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const trimmed = raw.trim();

            const fenceMatch = trimmed.match(/^\\u0000FENCE(\\d+)\\u0000$/);
            if (fenceMatch) {
              flushAll();
              const f = fences[parseInt(fenceMatch[1], 10)];
              const langLabel = f.lang ? esc(f.lang) : 'code';
              const body = f.open ? esc(f.code) : highlightCode(f.code, f.lang);
              const trailing = f.open
                ? '<span class="codeblock-copy" aria-hidden="true">Streaming…</span>'
                : '<button type="button" class="codeblock-copy">Copy</button>';
              out.push(
                '<div class="codeblock' + (f.open ? ' streaming' : '') + '" data-lang="' + esc(f.lang) + '">' +
                '<div class="codeblock-head"><span>' + langLabel + '</span>' + trailing + '</div>' +
                '<pre><code>' + body + '</code></pre>' +
                '</div>'
              );
              continue;
            }

            if (!trimmed) { flushAll(); continue; }
            if (/^(-{3,}|_{3,}|\\*{3,})$/.test(trimmed)) { flushAll(); out.push('<hr />'); continue; }
            const h = trimmed.match(/^(#{1,3})\\s+(.+)$/);
            if (h) { flushAll(); out.push('<h' + h[1].length + '>' + renderInline(h[2]) + '</h' + h[1].length + '>'); continue; }
            const q = trimmed.match(/^>\\s?(.*)$/);
            if (q) { flushPara(); flushList(); quote.push(q[1]); continue; }
            const ol = trimmed.match(/^(\\d+)[.)]\\s+(.+)$/);
            if (ol) {
              flushPara(); flushQuote();
              if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
              list.items.push(ol[2]);
              continue;
            }
            const ul = trimmed.match(/^[-*+]\\s+(.+)$/);
            if (ul) {
              flushPara(); flushQuote();
              if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
              list.items.push(ul[1]);
              continue;
            }
            if (list) { list.items[list.items.length - 1] += ' ' + trimmed; continue; }
            if (quote.length) { quote.push(trimmed); continue; }
            para.push(trimmed);
          }
          flushAll();
          return out.join('');
        }

        // ───── Elements ───────────────────────────────────────────────────
        var NL = String.fromCharCode(10);
        function byId(id) { return document.getElementById(id); }
        var root = document.documentElement;
        var app = byId('app');
        var bar = byId('bar');
        var dock = byId('dock');
        var feed = byId('feed');
        var feedInner = byId('feedInner');
        var empty = byId('empty');
        var emptyTitle = byId('emptyTitle');
        var emptySub = byId('emptySub');
        var connText = byId('connText');
        var tx = byId('tx');
        var txHead = byId('txHead');
        var txBody = byId('txBody');
        var txLines = byId('txLines');
        var txEmpty = byId('txEmpty');
        var txState = byId('txState');
        var txTicker = byId('txTicker');
        var tkLine = byId('tkLine');
        var tkFinal = byId('tkFinal');
        var tkLive = byId('tkLive');
        var tkEmpty = byId('tkEmpty');
        var scrim = byId('scrim');
        var jump = byId('jump');
        var jumpCount = byId('jumpCount');
        var input = byId('input');
        var sendBtn = byId('sendBtn');
        var captureBtn = byId('captureBtn');
        var imageBtn = byId('imageBtn');
        var imageInput = byId('imageInput');
        var menu = byId('menu');
        var menuBtn = byId('menuBtn');
        var toast = byId('toast');
        var toastIcon = byId('toastIcon');
        var toastText = byId('toastText');
        var lock = byId('lock');
        var lockTitle = byId('lockTitle');
        var sr = byId('sr');

        var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        // Must match the split-layout @media rule in the stylesheet.
        var splitQuery = window.matchMedia('(min-width: 760px) and (min-height: 500px)');
        function isSplit() { return splitQuery.matches; }

        function cssMs(name, fallback) {
          var v = parseFloat(getComputedStyle(root).getPropertyValue(name));
          return isFinite(v) ? v : fallback;
        }
        function cssPx(name, fallback) { return cssMs(name, fallback); }

        var ICON_CHECK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
        var ICON_ALERT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.4v.1"/></svg>';
        var ICON_DISPLAY_SMALL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 4.5h15A1.5 1.5 0 0 1 21 6v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5V6a1.5 1.5 0 0 1 1.5-1.5zM9 20.5h6M12 17v3.5"/></svg>';
        var ICON_REMOVE = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6"/></svg>';
        var ICON_COPY = '<svg class="t-icon" data-icon="a" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6.5A2.5 2.5 0 0 0 13 4H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"/></svg>'
          + '<svg class="t-icon" data-icon="b" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

        // ───── Spring (Apple's response + damping-ratio parameters) ───────
        // Animates from the current value and carries velocity through a
        // re-target, so a gesture can grab it mid-flight.
        function Spring(onUpdate) {
          this.value = 0;
          this.velocity = 0;
          this.target = 0;
          this.raf = 0;
          this.onUpdate = onUpdate;
        }
        Spring.prototype.stop = function () {
          if (this.raf) cancelAnimationFrame(this.raf);
          this.raf = 0;
        };
        Spring.prototype.set = function (v) {
          this.stop();
          this.value = v;
          this.velocity = 0;
          this.target = v;
          this.onUpdate(v);
        };
        Spring.prototype.to = function (target, opts) {
          var self = this;
          opts = opts || {};
          if (typeof opts.velocity === 'number') this.velocity = opts.velocity;
          this.target = target;
          if (reduceMotion.matches) { this.set(target); if (opts.onRest) opts.onRest(); return; }
          var response = opts.response || 0.38;
          var zeta = typeof opts.damping === 'number' ? opts.damping : 1;
          var stiffness = Math.pow((2 * Math.PI) / response, 2);
          var friction = (4 * Math.PI * zeta) / response;
          var last = 0;
          this.stop();
          var step = function (now) {
            var dt = last ? Math.min(0.064, (now - last) / 1000) : 0;
            last = now;
            var n = Math.max(1, Math.ceil(dt / 0.004));
            var h = dt / n;
            for (var i = 0; i < n; i++) {
              var force = -stiffness * (self.value - self.target) - friction * self.velocity;
              self.velocity += force * h;
              self.value += self.velocity * h;
            }
            if (dt > 0 && Math.abs(self.value - self.target) < 0.5 && Math.abs(self.velocity) < 10) {
              self.value = self.target;
              self.velocity = 0;
              self.raf = 0;
              self.onUpdate(self.value);
              if (opts.onRest) opts.onRest();
              return;
            }
            self.onUpdate(self.value);
            self.raf = requestAnimationFrame(step);
          };
          this.raf = requestAnimationFrame(step);
        };
        // Where a flick would come to rest (Apple's deceleration projection).
        function project(velocity, rate) {
          var d = rate || 0.998;
          return ((velocity / 1000) * d) / (1 - d);
        }
        // Progressive resistance past a boundary instead of a hard stop.
        function rubberband(overshoot, dimension) {
          var c = 0.55;
          return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
        }

        // ───── Small transitions ──────────────────────────────────────────
        var swapTimers = new WeakMap();
        function swapText(el, next) {
          if (el.textContent === next && !swapTimers.get(el)) return;
          if (reduceMotion.matches) { el.textContent = next; return; }
          clearTimeout(swapTimers.get(el));
          el.classList.add('is-exit');
          swapTimers.set(el, setTimeout(function () {
            swapTimers.delete(el);
            el.textContent = next;
            el.classList.remove('is-exit');
            el.classList.add('is-enter-start');
            void el.offsetHeight;
            el.classList.remove('is-enter-start');
          }, cssMs('--text-swap-dur', 150)));
        }
        function flashIcon(btn, ms) {
          btn.dataset.state = 'b';
          clearTimeout(btn._flash);
          btn._flash = setTimeout(function () { btn.dataset.state = 'a'; }, ms || 1300);
        }
        // Press feedback on pointer-down (iOS applies :active late or never).
        document.addEventListener('pointerdown', function (e) {
          var t = e.target.closest && e.target.closest('.chip, .icon-btn, .send, .copy-btn');
          if (!t || t.disabled) return;
          t.classList.add('is-pressed');
          var up = function () {
            t.classList.remove('is-pressed');
            window.removeEventListener('pointerup', up, true);
            window.removeEventListener('pointercancel', up, true);
          };
          window.addEventListener('pointerup', up, true);
          window.addEventListener('pointercancel', up, true);
        }, { passive: true });

        var toastTimer = 0;
        function showToast(text, bad) {
          toastText.textContent = text;
          toastIcon.innerHTML = bad ? ICON_ALERT : ICON_CHECK;
          toast.classList.toggle('is-bad', !!bad);
          toast.classList.add('is-open');
          app.classList.add('has-toast');
          clearTimeout(toastTimer);
          toastTimer = setTimeout(function () {
            toast.classList.remove('is-open');
            app.classList.remove('has-toast');
          }, 2000);
        }
        function announce(text) {
          sr.textContent = '';
          setTimeout(function () { sr.textContent = text; }, 60);
        }

        // ───── Viewport: keep the shell inside what is actually visible ───
        // The keyboard counts as up only once the visible height has actually
        // shrunk since the field took focus. Keying layout off focus alone moved
        // the dock the instant a tap blurred the field, so the tap missed.
        var kbBase = 0;
        function viewportHeight() { return window.visualViewport ? window.visualViewport.height : window.innerHeight; }
        function syncViewport() {
          var vv = window.visualViewport;
          var h = viewportHeight();
          var top = vv ? Math.max(0, vv.offsetTop) : 0;
          root.style.setProperty('--vv-h', Math.round(h) + 'px');
          root.style.setProperty('--vv-top', Math.round(top) + 'px');
          var kbUp = kbBase > 0 && h < kbBase - 120;
          if (!kbUp && document.activeElement !== input) kbBase = 0;
          app.classList.toggle('kb-up', kbUp);
          app.classList.toggle('is-short', h < 460);
          measureChrome();
        }
        function measureChrome() {
          root.style.setProperty('--bar-h', bar.offsetHeight + 'px');
          root.style.setProperty('--dock-h', dock.offsetHeight + 'px');
          layoutTranscript();
          stick();
        }
        if (window.visualViewport) {
          window.visualViewport.addEventListener('resize', syncViewport);
          window.visualViewport.addEventListener('scroll', syncViewport);
        }
        window.addEventListener('resize', syncViewport);
        window.addEventListener('orientationchange', function () { kbBase = 0; setTimeout(syncViewport, 250); });
        if (typeof ResizeObserver === 'function') {
          var chromeObserver = new ResizeObserver(function () { measureChrome(); });
          chromeObserver.observe(bar);
          chromeObserver.observe(dock);
        }

        // ───── Feed scrolling ─────────────────────────────────────────────
        var pinned = true;
        var unseen = 0;
        function distanceFromBottom() { return feed.scrollHeight - feed.clientHeight - feed.scrollTop; }
        var stuckAt = -1;          // where stick() last put the feed
        function stick() {
          if (!pinned) return;
          feed.scrollTop = feed.scrollHeight;
          stuckAt = feed.scrollTop;
        }
        // Keep following for the length of a height animation.
        function followFor(ms) {
          var until = performance.now() + ms;
          var tick = function (now) {
            stick();
            if (now < until) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
        feed.addEventListener('scroll', function () {
          // stick()'s own scroll arrives a frame later, when the row it made
          // room for may have grown (a picture decoded). That is not the reader
          // leaving the bottom: stay pinned and catch up.
          if (pinned && Math.abs(feed.scrollTop - stuckAt) < 2) { stick(); return; }
          pinned = distanceFromBottom() < 64;
          if (pinned) unseen = 0;
          updateJump();
        }, { passive: true });
        function noteNewContent() {
          if (pinned) stick();
          else { unseen++; updateJump(); }
        }
        // Rows grow after they are placed: a picture decodes, an answer
        // streams. While pinned, follow the feed's own growth, not only new rows.
        if (typeof ResizeObserver === 'function') new ResizeObserver(function () { stick(); }).observe(feedInner);
        function updateJump() {
          var show = !pinned && (unseen > 0 || distanceFromBottom() > 480);
          jump.classList.toggle('is-open', show);
          jump.tabIndex = show ? 0 : -1;
          var label = unseen > 0 ? String(unseen) : '';
          if (jumpCount.textContent !== label) jumpCount.textContent = label;
        }
        jump.addEventListener('click', function () {
          pinned = true;
          unseen = 0;
          feed.scrollTo({ top: feed.scrollHeight, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
          updateJump();
        });

        // ───── Timeline ───────────────────────────────────────────────────
        // One ordered list for server messages and phone-only rows, so a
        // reconnect's history replay can rebuild the feed in order.
        var entries = [];          // { key, t, kind, role, content, label, el, local }
        var clearedAt = 0;
        var localSeq = 0;
        var live = null;           // { streamId, content, entry }

        function timeOf(iso) {
          var t = iso ? Date.parse(iso) : NaN;
          return isFinite(t) ? t : Date.now();
        }
        function fmtTime(t) {
          var d = new Date(t);
          if (isNaN(d.getTime())) return '';
          return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        }
        function el(tag, cls, text) {
          var n = document.createElement(tag);
          if (cls) n.className = cls;
          if (text != null) n.textContent = text;
          return n;
        }
        // The overlay's [[GIST]] rule, for answers that arrive without desktop
        // HTML (the desktop renderer applies the full rule): the marker opening
        // the last line (after an optional bullet) splits off the gist, as does
        // a marker glued after a finished sentence; while streaming, a marker
        // still arriving is hidden so it never flashes as text.
        var GIST_MARKER = '[[GIST]]';
        var GIST_BULLETS = '-*•–—> ';
        function stripBullets(line) {
          var i = 0;
          while (i < line.length && GIST_BULLETS.indexOf(line.charAt(i)) >= 0) i++;
          return line.slice(i);
        }
        function splitGist(text, streaming) {
          var t = String(text || '').trimEnd();
          var lines = t.split(NL);
          var last = stripBullets(lines[lines.length - 1].trim());
          var rest = lines.slice(0, -1).join(NL).trimEnd();
          if (last.indexOf(GIST_MARKER) === 0) return { body: rest, gist: last.slice(GIST_MARKER.length).trim() || null };
          if (lines.length > 1 && stripBullets(lines[lines.length - 2].trim()) === GIST_MARKER && last.split(' ').length <= 10) {
            return { body: lines.slice(0, -2).join(NL).trimEnd(), gist: last || null };
          }
          var glued = t.lastIndexOf(GIST_MARKER);
          if (glued > 0 && t.indexOf(NL, glued) < 0) {
            var before = t.slice(0, glued).trimEnd();
            if ('.!?…:'.indexOf(before.slice(-1)) >= 0) return { body: before, gist: t.slice(glued + GIST_MARKER.length).trim() || null };
          }
          if (streaming && last && last.charAt(0) === '[' && GIST_MARKER.indexOf(last) === 0) return { body: rest, gist: null };
          return { body: t, gist: null };
        }
        function plainText(md) {
          var d = document.createElement('div');
          d.innerHTML = renderMarkdown(splitGist(md).body);
          return (d.textContent || '').replace(/ +/g, ' ').trim();
        }
        // Desktop-rendered code blocks arrive plain; highlight them here with
        // the page's own highlighter, once.
        // Diagrams the desktop finished drawing after their answer arrived
        // (the 'diagram' event), by key. Applied to any figure still waiting,
        // now and whenever an answer body is re-rendered. The picture is only
        // ever set as an image source, and only from an SVG data URL.
        var diagramImages = {};
        function applyDiagrams(scope) {
          Array.prototype.forEach.call(scope.querySelectorAll('figure.diagram[data-diagram]'), function (fig) {
            var key = fig.getAttribute('data-diagram') || '';
            if (!Object.prototype.hasOwnProperty.call(diagramImages, key)) return;
            var view = fig.querySelector('.diagram-view');
            if (!view || fig.classList.contains('is-ready')) return;
            var src = diagramImages[key];
            view.textContent = '';
            fig.classList.remove('is-pending');
            if (src) {
              var img = document.createElement('img');
              img.className = 'diagram-img';
              img.alt = fig.getAttribute('data-label') || 'Diagram';
              img.src = src;
              view.appendChild(img);
              fig.classList.remove('is-failed');
              fig.classList.add('is-ready');
            } else {
              view.appendChild(el('div', 'diagram-note', 'This diagram could not be drawn here. Its source is below.'));
              fig.classList.add('is-failed');
              var details = fig.querySelector('details');
              if (details) details.open = true;
            }
          });
        }
        function onDiagram(ev) {
          var key = String(ev.key || '');
          if (!key) return;
          var src = typeof ev.src === 'string' && ev.src.indexOf('data:image/svg+xml;charset=utf-8,') === 0 ? ev.src : '';
          diagramImages[key] = src;
          applyDiagrams(document);
        }
        function enhanceCode(scope) {
          Array.prototype.forEach.call(scope.querySelectorAll('.codeblock'), function (block) {
            var code = block.querySelector('pre code');
            if (!code || code.dataset.hl) return;
            code.innerHTML = highlightCode(code.textContent || '', block.dataset.lang || '');
            code.dataset.hl = '1';
          });
        }

        // The overlay names a button's answer by the button, on the question
        // side (NativelyInterface QUICK_ACTION_LABELS); a typed question's
        // answer needs no name, its question is right above it.
        var ASK_LABELS = {
          'What to Answer': 'What should I say?',
          'Follow-Up Questions': 'Follow-up questions',
          'Code Hint': 'Code hint',
          Recap: 'Recap',
          Clarify: 'Clarify',
          Brainstorm: 'Brainstorm',
          Chat: '',
          Answer: '',
        };
        function askLabel(label) {
          if (!label) return '';
          return Object.prototype.hasOwnProperty.call(ASK_LABELS, label) ? ASK_LABELS[label] : label;
        }
        function answerShell(entry, cls) {
          var node = el('article', cls);
          node.dataset.key = entry.key;
          node.dataset.label = entry.label || '';
          var ask = askLabel(entry.label);
          if (ask) {
            var row = el('div', 'ask');
            row.append(el('span', 'ask-label', ask));
            node.append(row);
          }
          return node;
        }
        function buildAnswer(entry, opts) {
          opts = opts || {};
          var node = answerShell(entry, 'answer');
          var body = el('div', 'answer-body content');
          var foot = el('footer', 'answer-foot');
          var copy = el('button', 'copy-btn t-icon-swap');
          copy.type = 'button';
          copy.dataset.state = 'a';
          copy.setAttribute('aria-label', 'Copy answer');
          copy.innerHTML = ICON_COPY;
          copy.addEventListener('click', function () {
            copyText(splitGist(entry.content).body).then(function (ok) {
              if (ok) flashIcon(copy, 1400);
              else showToast('Copy blocked by the browser', true);
            });
          });
          foot.append(copy, el('span', 'answer-meta', opts.streaming ? '' : fmtTime(entry.t)));
          node.append(body, foot);
          entry.el = node;
          if (opts.streaming) node.classList.add('is-streaming');
          renderAnswerBody(entry, !!opts.streaming);
          return node;
        }
        function setShimmer(node, text) {
          node.textContent = '';
          // The overlay's Thinking sweep, the page's one progress shimmer.
          node.append(el('span', 'thinking is-inline', text));
        }
        function renderAnswerBody(entry, streaming) {
          var body = entry.el.querySelector('.answer-body');
          // The desktop's rendering when it sent one (the overlay's markdown,
          // tables, math and gist rules); the page's own renderer otherwise.
          var html = entry.html;
          var gist = entry.gist || null;
          if (typeof html !== 'string') {
            var split = splitGist(entry.content, streaming);
            html = renderMarkdown(split.body);
            // A finished answer's content arrives without its gist line; the
            // desktop sends the gist on its own.
            gist = entry.gist || split.gist;
          }
          body.innerHTML = html;
          enhanceCode(body);
          applyDiagrams(body);
          if (streaming) {
            // Put the caret at the end of the last line of text. Appended to
            // the body it sat on a line of its own below the paragraph. A code
            // block has its own streaming state, so it gets no caret.
            var host = body.lastElementChild;
            if (host && (host.tagName === 'UL' || host.tagName === 'OL')) host = host.lastElementChild;
            if (!host) body.appendChild(el('span', 'caret'));
            else if (!host.classList.contains('codeblock') && !host.classList.contains('table-wrap') && host.tagName !== 'HR') host.appendChild(el('span', 'caret'));
          }
          if (gist) {
            var chip = el('div', 'gist-chip');
            chip.append(el('span', 'gist-label', 'Gist'), el('span', 'gist-text', gist));
            body.appendChild(chip);
          }
          bindCodeCopy(body);
        }
        function buildUser(entry) {
          var row = el('div', 'row-user');
          row.dataset.key = entry.key;
          row.append(el('div', 'bubble', entry.content || ''));
          var status = el('div', 'row-status');
          row.append(status);
          entry.el = row;
          paintUserState(entry);
          return row;
        }
        function paintUserState(entry) {
          var row = entry.el;
          var status = row.querySelector('.row-status');
          row.classList.toggle('is-sending', entry.state === 'sending');
          row.classList.toggle('is-failed', entry.state === 'failed');
          status.textContent = '';
          if (entry.state === 'sending') status.textContent = 'Sending';
          else if (entry.state === 'failed') {
            status.append('Not delivered · ');
            var retry = el('button', '', 'Retry');
            retry.type = 'button';
            retry.addEventListener('click', function () { retrySend(entry); });
            status.append(retry);
          }
          status.hidden = !entry.state;
        }
        function buildSys(entry) {
          var row = el('div', 'sys' + (entry.bad ? ' is-bad' : ''));
          row.dataset.key = entry.key;
          row.innerHTML = ICON_DISPLAY_SMALL;
          row.append(el('span', '', entry.content));
          entry.el = row;
          return row;
        }
        function buildPending(entry) {
          var node = answerShell(entry, 'answer is-pending');
          var body = el('div', 'answer-body');
          body.append(el('span', 'thinking', 'Thinking...'));
          node.append(body);
          entry.el = node;
          return node;
        }
        function buildImage(entry) {
          var row = el('div', 'row-user row-image');
          row.dataset.key = entry.key;
          var shot = el('div', 'shot');
          var img = document.createElement('img');
          img.alt = 'Image sent from this phone';
          img.decoding = 'async';
          img.src = entry.thumb;
          shot.append(img);
          row.append(shot, el('div', 'row-status'));
          entry.el = row;
          paintImageState(entry);
          return row;
        }
        function paintImageState(entry) {
          var row = entry.el;
          var status = row.querySelector('.row-status');
          row.classList.toggle('is-sending', entry.state === 'sending');
          row.classList.toggle('is-failed', entry.state === 'failed');
          status.textContent = '';
          if (entry.state === 'sending') {
            setShimmer(status, 'Sending to your desktop');
          } else if (entry.state === 'failed') {
            status.append('Not delivered · ');
            var retry = el('button', '', 'Retry');
            retry.type = 'button';
            retry.addEventListener('click', function () { uploadImage(entry); });
            status.append(retry);
          } else if (entry.removed) {
            status.textContent = 'Removed from the next answer';
          } else if (entry.shotId && trayHas(entry.shotId)) {
            // Still on the desktop's tray, so it can still come off.
            status.append('Attached to the next answer · ');
            var remove = el('button', '', 'Remove');
            remove.type = 'button';
            remove.addEventListener('click', function () { detachShot(entry.shotId); });
            status.append(remove);
          } else {
            // Stays true once the tray lets it go: the desktop sent it with an
            // answer, which may have happened before anyone reads this.
            status.textContent = 'Sent to your desktop';
          }
        }
        // Screenshots a question was sent with on the desktop, as the overlay's
        // question card shows them.
        function buildShots(entry) {
          var row = el('div', 'row-user row-shots');
          row.dataset.key = entry.key;
          var n = entry.images.length;
          var wrap = el('div', 'shots' + (n > 1 ? ' is-multi' : '') + (n > 2 ? ' is-many' : ''));
          entry.images.forEach(function (image, i) {
            var shot = el('div', 'shot');
            var img = document.createElement('img');
            img.alt = n > 1 ? 'Screenshot ' + (i + 1) + ' of ' + n + ' from your desktop' : 'Screenshot from your desktop';
            img.decoding = 'async';
            img.src = image.thumb;
            shot.append(img);
            wrap.append(shot);
          });
          row.append(wrap, el('div', 'row-status', n > 1 ? n + ' screenshots from your desktop' : 'Screenshot from your desktop'));
          entry.el = row;
          return row;
        }
        function buildEntry(entry, opts) {
          if (entry.kind === 'shots') return buildShots(entry);
          if (entry.kind === 'image') return buildImage(entry);
          if (entry.kind === 'user') return buildUser(entry);
          if (entry.kind === 'sys') return buildSys(entry);
          if (entry.kind === 'pending') return buildPending(entry);
          return buildAnswer(entry, opts);
        }

        function appendEntry(entry, opts) {
          opts = opts || {};
          entries.push(entry);
          var node = buildEntry(entry, opts);
          if (opts.animate !== false) {
            node.classList.add('enter');
            node.addEventListener('animationend', function () { node.classList.remove('enter'); }, { once: true });
          }
          feedInner.appendChild(node);
          updateEmpty();
          noteNewContent();
          return entry;
        }
        // Above the placeholders still waiting at the end, so an answer lands
        // under the screenshots it was asked with.
        function insertBeforePending(entry) {
          var i = entries.length;
          while (i > 0 && entries[i - 1].kind === 'pending') i--;
          var before = entries[i];
          if (!before || !before.el || !before.el.parentNode) return appendEntry(entry);
          entry.t = Math.min(entry.t, before.t - 1);
          entries.splice(i, 0, entry);
          var node = buildEntry(entry);
          node.classList.add('enter');
          node.addEventListener('animationend', function () { node.classList.remove('enter'); }, { once: true });
          feedInner.insertBefore(node, before.el);
          updateEmpty();
          noteNewContent();
          return entry;
        }
        // Swap one row for another in place: the card tweens to its new
        // height while the new content cross-fades in.
        function morph(oldEntry, newEntry, opts) {
          var oldEl = oldEntry.el;
          var i = entries.indexOf(oldEntry);
          if (i >= 0) entries.splice(i, 1, newEntry);
          else entries.push(newEntry);
          var node = buildEntry(newEntry, opts);
          if (!oldEl || !oldEl.parentNode) { feedInner.appendChild(node); noteNewContent(); return; }
          var h0 = oldEl.offsetHeight;
          oldEl.replaceWith(node);
          if (reduceMotion.matches) { noteNewContent(); return; }
          var h1 = node.offsetHeight;
          node.classList.add('is-revealing');
          node.style.height = h0 + 'px';
          node.style.overflow = 'hidden';
          void node.offsetHeight;
          node.style.transition = 'height var(--resize-dur) var(--resize-ease)';
          node.style.height = h1 + 'px';
          requestAnimationFrame(function () { node.classList.remove('is-revealing'); });
          var done = function () {
            node.style.height = '';
            node.style.overflow = '';
            node.style.transition = '';
          };
          node.addEventListener('transitionend', function (e) { if (e.propertyName === 'height') done(); }, { once: true });
          setTimeout(done, cssMs('--resize-dur', 300) + 80);
          followFor(cssMs('--resize-dur', 300) + 40);
          noteNewContent();
        }
        function removeEntry(entry, animate) {
          var i = entries.indexOf(entry);
          if (i >= 0) entries.splice(i, 1);
          var node = entry.el;
          if (!node || !node.parentNode) { updateEmpty(); return; }
          if (!animate || reduceMotion.matches) { node.remove(); updateEmpty(); return; }
          node.style.height = node.offsetHeight + 'px';
          node.classList.add('leave');
          void node.offsetHeight;
          node.style.height = '0px';
          node.style.opacity = '0';
          node.style.marginTop = '-12px';
          setTimeout(function () { node.remove(); updateEmpty(); }, cssMs('--duration-medium', 350) + 40);
        }
        function rebuildFeed() {
          Array.prototype.slice.call(feedInner.children).forEach(function (c) { if (c !== empty) c.remove(); });
          entries.sort(function (a, b) { return a.t - b.t; });
          entries.forEach(function (e) {
            var node = buildEntry(e);
            feedInner.appendChild(node);
          });
          updateEmpty();
          pinned = true;
          stick();
        }

        var emptyShown = false;
        function updateEmpty() {
          var isEmpty = entries.length === 0;
          empty.style.display = isEmpty ? '' : 'none';
          if (isEmpty && !emptyShown) {
            empty.classList.remove('is-hiding', 'is-shown');
            void empty.offsetHeight;
            empty.classList.add('is-shown');
          }
          emptyShown = isEmpty;
          paintEmptyCopy();
        }
        function paintEmptyCopy() {
          var title, sub;
          if (conn === 'live' && meetingActive) {
            title = 'Connected to your meeting';
            sub = 'Tap What to Say when you need a reply, or ask anything below.';
          } else if (conn === 'live' && meetingEnded) {
            title = 'Meeting ended';
            sub = 'Its summary is in Natively on your desktop. Start a new meeting there to pick up here.';
          } else if (conn === 'live') {
            title = 'No meeting running';
            sub = 'Start a meeting in Natively on your desktop to follow it here. You can still ask anything below.';
          } else if (conn === 'reconnecting') {
            title = 'Reconnecting';
            sub = 'Keep Natively open on your computer and this phone on the same network.';
          } else {
            title = 'Connecting to your desktop';
            sub = 'Keep Natively open on your computer.';
          }
          if (emptyTitle.textContent !== title) emptyTitle.textContent = title;
          if (emptySub.textContent !== sub) emptySub.textContent = sub;
        }

        // ───── Pending actions ────────────────────────────────────────────
        // Shortcut answers come back whole and labelled, so the phone holds a
        // placeholder under the expected label until one arrives.
        // Labels are the ones the desktop publishes for each action (see
        // PhoneMirrorPhoneActions2026_09_27.test.mjs, which pins them).
        var ACTIONS = {
          whatToAnswer: { label: 'What to Answer', expect: ['What to Answer'] },
          followUp: { label: 'Follow-Up Questions', expect: ['Follow-Up Questions'] },
          clarify: { label: 'Clarify', expect: ['Clarify'] },
          codeHint: { label: 'Code Hint', expect: ['Code Hint'] },
          brainstorm: { label: 'Brainstorm', expect: ['Brainstorm'] },
          recap: { label: 'Recap', expect: ['Recap'] },
          // Answer toggles voice recording on the desktop; the reply comes
          // later (or never, on the first tap), so no placeholder.
          answer: null,
        };
        var PENDING_TIMEOUT_MS = 45000;
        function addPending(action, label, expect) {
          var existing = entries.find(function (e) { return e.kind === 'pending' && e.action === action; });
          if (existing) return existing;
          var entry = { key: 'p:' + (++localSeq), t: Date.now(), kind: 'pending', action: action, label: label, expect: expect, local: true };
          appendEntry(entry);
          pinned = true;
          stick();
          entry.timer = setTimeout(function () { expirePending(entry); }, PENDING_TIMEOUT_MS);
          return entry;
        }
        function takePending(match) {
          for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.kind === 'pending' && match(e)) { clearTimeout(e.timer); return e; }
          }
          return null;
        }
        function expirePending(entry) {
          if (entries.indexOf(entry) < 0) return;
          var idle = { key: entry.key + ':idle', t: entry.t, kind: 'assistant', label: entry.label, content: 'Nothing came back from your desktop for this one.', local: true, idle: true };
          morph(entry, idle);
          idle.el.classList.add('is-idle');
          idle.el.querySelector('.answer-foot').remove();
          setTimeout(function () { removeEntry(idle, true); }, 7000);
        }

        // ───── Server events ──────────────────────────────────────────────
        function onHistory(list) {
          entries = entries.filter(function (e) { return e.local && (e.kind !== 'user' || e.state) && !e.streamId; });
          (list || []).forEach(function (m) {
            var t = timeOf(m.createdAt);
            if (t <= clearedAt) return;
            if (m.role === 'user' && m.awaiting) {
              entries.push({ key: m.id, t: t, kind: 'user', role: 'user', content: m.content || '' });
              entries.push(awaitingEntry(String(m.id).replace(/^u:/, ''), t + 1));
              return;
            }
            if (m.images) {
              var images = validThumbs(m.images);
              if (images.length) entries.push({ key: m.id, t: t, kind: 'shots', images: images });
              return;
            }
            entries.push({ key: m.id, t: t, kind: m.role === 'user' ? 'user' : 'assistant', role: m.role, content: m.content || '', label: m.label || '', html: m.html, gist: m.gist });
          });
          // Each connect sends history, then replays an in-flight answer as ONE
          // token frame holding everything so far. Drop the old live card, or
          // that frame would append the whole answer a second time.
          if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = 0; }
          live = null;
          rebuildFeed();
        }
        function onUser(ev) {
          var content = String(ev.content || '');
          var mine = entries.find(function (e) { return e.kind === 'user' && e.state && e.content.trim() === content.trim(); });
          if (mine) {
            clearTimeout(mine.timer);
            mine.key = ev.id;
            mine.local = false;
            mine.state = '';
            mine.el.dataset.key = ev.id;
            paintUserState(mine);
            return;
          }
          appendEntry({ key: ev.id, t: timeOf(ev.createdAt), kind: 'user', content: content });
          // Asked on the desktop, answer on its way: Thinking under it, as the
          // overlay shows, until the first words stream in under the same id.
          if (ev.awaiting) {
            appendEntry(awaitingEntry(String(ev.id).replace(/^u:/, ''), Date.now()));
            pinned = true;
            stick();
          }
        }
        function awaitingEntry(streamId, t) {
          var entry = { key: 'p:' + streamId, t: t, kind: 'pending', action: 'desktop', streamId: streamId, label: '', local: true };
          entry.timer = setTimeout(function () { expirePending(entry); }, PENDING_TIMEOUT_MS);
          return entry;
        }
        // The placeholder this answer resolves: its own (a desktop question's,
        // by stream id) first, else a question typed here.
        function takeAnswerPending(streamId) {
          return takePending(function (e) { return e.streamId === streamId; }) ||
            takePending(function (e) { return e.action === 'chat' && !e.streamId; });
        }
        var liveRaf = 0;
        // Answers still streaming when a new session started: their late
        // tokens belong to the old session and are dropped.
        var droppedStreams = {};
        function onToken(streamId, token) {
          if (droppedStreams[streamId]) return;
          if (!live || live.streamId !== streamId) {
            var entry = { key: 'live:' + streamId, t: Date.now(), kind: 'assistant', content: '', label: '' };
            live = { streamId: streamId, entry: entry };
            // The question's placeholder turns into this answer in place.
            var wait = takeAnswerPending(streamId);
            if (wait) morph(wait, entry, { streaming: true });
            else appendEntry(entry, { streaming: true });
          }
          live.entry.content += token;
          // Once the desktop's render frames are arriving they drive the
          // updates; until then the page renders the tokens itself.
          if (typeof live.entry.html !== 'string' && !liveRaf) liveRaf = requestAnimationFrame(flushLive);
        }
        function onRender(ev) {
          var streamId = String(ev.streamId);
          if (droppedStreams[streamId] || !live || live.streamId !== streamId || typeof ev.html !== 'string') return;
          live.entry.html = ev.html;
          live.entry.gist = ev.gist || null;
          if (!liveRaf) liveRaf = requestAnimationFrame(flushLive);
        }
        function flushLive() {
          liveRaf = 0;
          if (!live || !live.entry.el) return;
          renderAnswerBody(live.entry, true);
          noteNewContent();
        }
        function finishLive(entry, content) {
          if (content) entry.content = content;
          entry.el.classList.remove('is-streaming');
          renderAnswerBody(entry, false);
          entry.el.querySelector('.answer-meta').textContent = fmtTime(entry.t);
          noteNewContent();
          announce('Answer ready. ' + plainText(entry.content).slice(0, 160));
        }
        function onDone(ev) {
          var streamId = String(ev.streamId);
          if (droppedStreams[streamId]) return;
          if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = 0; }
          if (live && live.streamId === streamId) {
            var entry = live.entry;
            live = null;
            // The final rendering replaces the last streaming frame.
            entry.html = typeof ev.html === 'string' ? ev.html : undefined;
            entry.gist = ev.gist || null;
            entry.key = 'a:' + streamId;
            entry.el.dataset.key = entry.key;
            finishLive(entry, ev.content);
            return;
          }
          if (!ev.content) {
            // Nothing to show after all: clear its Thinking.
            var gone = takePending(function (e) { return e.streamId === streamId; });
            if (gone) removeEntry(gone, true);
            return;
          }
          var fresh = { key: 'a:' + streamId, t: timeOf(ev.createdAt), kind: 'assistant', content: ev.content, label: '', html: ev.html, gist: ev.gist };
          var wait = takeAnswerPending(streamId);
          if (wait) morph(wait, fresh);
          else appendEntry(fresh);
          announce('Answer ready. ' + plainText(fresh.content).slice(0, 160));
        }
        function onStreamError(ev) {
          if (droppedStreams[String(ev.streamId)]) return;
          if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = 0; }
          var message = String(ev.message || 'stream failed');
          if (live && live.streamId === String(ev.streamId)) {
            var entry = live.entry;
            live = null;
            finishLive(entry);
            entry.el.querySelector('.answer-body').append(el('p', 'answer-note', 'The answer stopped: ' + message));
            return;
          }
          var wait = takeAnswerPending(String(ev.streamId));
          var failed = { key: 'err:' + (++localSeq), t: Date.now(), kind: 'assistant', label: '', content: '', local: true };
          if (wait) morph(wait, failed);
          else appendEntry(failed);
          failed.el.querySelector('.answer-body').append(el('p', 'answer-note', 'Could not get an answer: ' + message));
          failed.el.querySelector('.answer-foot').remove();
        }
        function onAssistant(ev) {
          var label = String(ev.label || '');
          var entry = { key: ev.id, t: timeOf(ev.createdAt), kind: 'assistant', content: ev.content || '', label: label, html: ev.html, gist: ev.gist };
          if (entries.some(function (e) { return e.key === entry.key; })) return;
          var wait = takePending(function (e) { return e.expect && e.expect.indexOf(label) >= 0; });
          if (wait) morph(wait, entry);
          else appendEntry(entry);
          announce((label || 'Answer') + '. ' + plainText(entry.content).slice(0, 160));
        }
        function onAck(ev) {
          if (ev.action === 'screenshot') {
            clearTimeout(captureTimer);
            var ok = !/fail/i.test(String(ev.message || ''));
            // Success confirms on the button itself and in the feed row below;
            // a toast on top of that row said the same thing twice.
            captureBtn.dataset.state = ok ? 'c' : 'a';
            if (ok) captureTimer = setTimeout(function () { captureBtn.dataset.state = 'a'; }, 1400);
            appendEntry({
              key: 's:' + (++localSeq),
              t: Date.now(),
              kind: 'sys',
              bad: !ok,
              content: ok ? 'Screen captured for the next answer' : 'Screen capture failed',
              local: true,
            });
            if (!ok) showToast('Screen capture failed', true);
            return;
          }
          if (ev.message) showToast(String(ev.message));
        }
        // ───── Desktop screenshots ────────────────────────────────────────
        // The overlay's tray (what its next answer goes out with) arrives whole
        // on every change; a sent question's screenshots arrive once, as a row.
        // Remove asks the desktop to take one off; it leaves here at once and
        // comes back only if the desktop never confirms.
        var trayWrap = document.getElementById('trayWrap');
        var trayThumbs = document.getElementById('trayThumbs');
        var trayTitle = document.getElementById('trayTitle');
        var trayItems = [];          // the tray as the desktop last sent it
        var trayRemoving = {};       // id -> timer, removed here, not yet confirmed
        var trayCount = 0;
        var trayClearTimer = 0;
        var DETACH_CONFIRM_MS = 5000;
        function paintTrayFade() {
          var max = trayThumbs.scrollWidth - trayThumbs.clientWidth;
          trayThumbs.style.setProperty('--fade-l', trayThumbs.scrollLeft > 1 ? '18px' : '0px');
          trayThumbs.style.setProperty('--fade-r', trayThumbs.scrollLeft < max - 1 ? '18px' : '0px');
        }
        // The newest is the one to see: scroll to it (again once its image has
        // a width, as thumbnails size to their picture).
        function showNewestThumb(smooth) {
          var left = trayThumbs.scrollWidth;
          if (smooth && !reduceMotion.matches && trayThumbs.scrollTo) trayThumbs.scrollTo({ left: left, behavior: 'smooth' });
          else trayThumbs.scrollLeft = left;
          paintTrayFade();
        }
        trayThumbs.addEventListener('scroll', paintTrayFade, { passive: true });
        function validThumbs(list) {
          return (Array.isArray(list) ? list : []).filter(function (image) {
            var thumb = image && image.thumb;
            return !!image && typeof image.id === 'string' && typeof thumb === 'string' &&
              (thumb.indexOf('data:image/jpeg;base64,') === 0 || thumb.indexOf('data:image/png;base64,') === 0);
          });
        }
        function trayHas(id) {
          return !trayRemoving[id] && trayItems.some(function (image) { return image.id === id; });
        }
        function thumbNode(image, animate) {
          var node = el('div', 'tray-thumb' + (animate ? ' is-new' : ''));
          node.dataset.id = image.id;
          var img = document.createElement('img');
          img.alt = 'Attached screenshot';
          img.decoding = 'async';
          img.src = image.thumb;
          img.addEventListener('load', function () { if (trayCount) showNewestThumb(false); }, { once: true });
          var remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'tray-remove';
          remove.setAttribute('aria-label', 'Remove from the next answer');
          remove.innerHTML = ICON_REMOVE;
          remove.addEventListener('click', function () { detachShot(image.id); });
          node.append(img, remove);
          return node;
        }
        function leaveThumb(node) {
          if (reduceMotion.matches) { node.remove(); return; }
          node.style.width = node.offsetWidth + 'px';
          void node.offsetWidth;
          node.classList.add('is-leaving');
          setTimeout(function () { node.remove(); paintTrayFade(); }, cssMs('--duration-fast', 250) + 30);
        }
        function renderTray() {
          var items = trayItems.filter(function (image) { return !trayRemoving[image.id]; });
          var opening = trayWrap.dataset.open !== 'true';
          clearTimeout(trayClearTimer);
          if (!items.length) {
            trayCount = 0;
            paintMeetingChips();
            trayWrap.dataset.open = 'false';
            trayWrap.setAttribute('aria-hidden', 'true');
            // Keep the thumbnails while the tray folds away.
            trayClearTimer = setTimeout(function () { if (!trayCount) trayThumbs.textContent = ''; }, cssMs('--resize-dur', 300) + 60);
            return;
          }
          var old = {};
          Array.prototype.slice.call(trayThumbs.children).forEach(function (node) {
            if (node.classList.contains('is-leaving')) return;
            if (opening) node.remove();
            else old[node.dataset.id] = node;
          });
          var added = 0;
          items.forEach(function (image) {
            var node = old[image.id];
            if (node) delete old[image.id];
            else {
              node = thumbNode(image, !opening);
              added++;
            }
            trayThumbs.appendChild(node);
          });
          Object.keys(old).forEach(function (id) { leaveThumb(old[id]); });
          trayTitle.textContent = items.length === 1 ? '1 screenshot attached' : items.length + ' screenshots attached';
          trayWrap.dataset.open = 'true';
          trayWrap.setAttribute('aria-hidden', 'false');
          var grew = items.length > trayCount;
          trayCount = items.length;
          paintMeetingChips();
          if (added) showNewestThumb(!opening);
          else paintTrayFade();
          if (added && grew) announce(trayTitle.textContent + ' on your desktop');
        }
        function onAttachments(ev) {
          trayItems = validThumbs(ev.items);
          // Confirmed: the desktop's tray no longer has it.
          Object.keys(trayRemoving).forEach(function (id) {
            if (!trayItems.some(function (image) { return image.id === id; })) { clearTimeout(trayRemoving[id]); delete trayRemoving[id]; }
          });
          renderTray();
          paintImageRows();
        }
        function detachShot(id) {
          if (!id || trayRemoving[id]) return;
          if (!sendCommand({ type: 'detach', id: id })) { showToast('Not connected to your desktop', true); return; }
          trayRemoving[id] = setTimeout(function () {
            // The desktop never took it off: show it as it still is.
            delete trayRemoving[id];
            entries.forEach(function (e) { if (e.kind === 'image' && e.shotId === id) e.removed = false; });
            renderTray();
            paintImageRows();
          }, DETACH_CONFIRM_MS);
          entries.forEach(function (e) { if (e.kind === 'image' && e.shotId === id) e.removed = true; });
          renderTray();
          paintImageRows();
          announce('Removed from the next answer.');
        }
        function paintImageRows() {
          entries.forEach(function (e) { if (e.kind === 'image' && e.el && !e.state) paintImageState(e); });
        }
        function onImages(ev) {
          var images = validThumbs(ev.images);
          if (!images.length || entries.some(function (e) { return e.key === ev.id; })) return;
          insertBeforePending({ key: ev.id, t: timeOf(ev.createdAt), kind: 'shots', images: images });
        }
        function handleEvent(ev) {
          if (!ev || typeof ev !== 'object') return;
          switch (ev.type) {
            case 'history': onHistory(ev.messages); break;
            case 'user': onUser(ev); break;
            case 'token': onToken(String(ev.streamId), String(ev.token || '')); break;
            case 'render': onRender(ev); break;
            case 'diagram': onDiagram(ev); break;
            case 'done': onDone(ev); break;
            case 'error': onStreamError(ev); break;
            case 'assistant': onAssistant(ev); break;
            case 'ack': onAck(ev); break;
            case 'transcript': onTranscript(ev); break;
            case 'transcript-history': onTranscriptHistory(ev); break;
            case 'meeting': onMeeting(ev); break;
            case 'attachments': onAttachments(ev); break;
            case 'images': onImages(ev); break;
            default: break;
          }
        }

        // ───── Live transcript ────────────────────────────────────────────
        // Mirrors the overlay's rolling bar: a partial replaces the line in
        // progress; a final commits it (the final's punctuated text wins).
        var txFinals = [];           // { text, ts, el }
        var txLive = null;           // { text, ts }
        var txLiveEl = null;
        var meetingActive = false;
        // The last meeting ended and none has started since: the page says so
        // (the summary is on the desktop) rather than looking idle or live.
        var meetingEnded = false;
        var speakingTimer = 0;
        var txPinned = true;
        var PUNCT = '.,!?;:()[]{}' + String.fromCharCode(34, 39) + '…–—“”‘’«»¿¡/*_~';
        function txNorm(s) {
          var lower = String(s || '').toLowerCase();
          var out = '';
          for (var i = 0; i < lower.length; i++) {
            var ch = lower.charAt(i);
            if (ch === '-') out += ' ';
            else if (PUNCT.indexOf(ch) < 0) out += ch;
          }
          return out.split(' ').filter(Boolean).join(' ');
        }
        function onTranscript(ev) {
          var text = String(ev.text || '').trim();
          if (!text) return;
          var ts = typeof ev.ts === 'number' ? ev.ts : Date.now();
          markSpeaking();
          if (!ev.final) {
            txLive = { text: text, ts: ts };
          } else {
            var last = txFinals[txFinals.length - 1];
            var norm = txNorm(text);
            // A final can arrive twice (provider re-sends); keep one.
            if (!(last && norm && txNorm(last.text) === norm)) txFinals.push({ text: text, ts: ts });
            if (txFinals.length > 240) txFinals.splice(0, txFinals.length - 200);
            // One speaker: a final ends the utterance in progress.
            txLive = null;
          }
          renderTranscript();
        }
        function onTranscriptHistory(ev) {
          txFinals = (ev.segments || []).map(function (s) { return { text: String(s.text || ''), ts: s.ts }; });
          txLive = ev.partial ? { text: String(ev.partial.text || ''), ts: ev.partial.ts } : null;
          meetingActive = !!ev.meetingActive;
          meetingEnded = !meetingActive && !!ev.meetingEnded;
          rebuildTranscript();
          paintEmptyCopy();
        }
        function onMeeting(ev) {
          meetingActive = !!ev.active;
          if (ev.reset) {
            // Started: a new session, as on the overlay. Ended: a clean canvas
            // that says so; the meeting's summary is on the desktop.
            meetingEnded = !meetingActive;
            txFinals = [];
            txLive = null;
            rebuildTranscript();
            startNewSession(meetingActive ? 'New meeting' : '');
          } else {
            paintTranscriptState();
          }
          paintEmptyCopy();
        }
        // A meeting started or ended on the desktop: start the phone over. The
        // desktop has dropped its copy of the old answers as well, so a
        // reconnect won't bring them back.
        function startNewSession(toast) {
          if (liveRaf) { cancelAnimationFrame(liveRaf); liveRaf = 0; }
          if (live) { droppedStreams[live.streamId] = true; live = null; }
          entries.forEach(function (e) { clearTimeout(e.timer); });
          entries = [];
          clearedAt = 0;
          unseen = 0;
          rebuildFeed();
          updateJump();
          if (tx.dataset.open === 'true') setTxOpen(false);
          if (toast) showToast(toast);
        }
        function markSpeaking() {
          app.dataset.speaking = 'true';
          clearTimeout(speakingTimer);
          speakingTimer = setTimeout(function () { app.dataset.speaking = 'false'; paintTranscriptState(); }, 1400);
          paintTranscriptState();
        }
        function paintTranscriptState() {
          var speaking = app.dataset.speaking === 'true';
          var has = txFinals.length > 0 || !!txLive;
          var state;
          if (meetingActive) state = speaking ? 'Speaking' : 'Listening';
          else state = meetingEnded ? 'Meeting ended' : 'No meeting';
          app.dataset.meeting = meetingActive ? 'live' : 'idle';
          swapText(txState, state);
          paintMeetingChips();
          txEmpty.hidden = has;
          if (!has) {
            txEmpty.textContent = meetingActive
              ? 'Listening for the other side of the call…'
              : meetingEnded
                ? 'The meeting has ended. Its summary is in Natively on your desktop.'
                : 'No meeting is running. The interviewer’s words appear here once one starts on your desktop.';
          }
          renderTicker();
        }
        // The rolling line, as on the overlay: finals joined by a dot, the
        // utterance in progress at the end, always scrolled to the newest word.
        var TICKER_FINALS = 12;      // only the tail is ever visible
        var TICKER_SEP = '  ·  ';
        var tickerLast = null;
        var tickerCount = -1;
        function renderTicker() {
          var lastSeg = txFinals[txFinals.length - 1] || null;
          var tail = txFinals.slice(-TICKER_FINALS);
          if (lastSeg !== tickerLast || txFinals.length !== tickerCount) {
            tickerLast = lastSeg;
            tickerCount = txFinals.length;
            tkFinal.textContent = tail.map(function (seg) { return seg.text; }).join(TICKER_SEP);
          }
          var liveText = txLive ? txLive.text : '';
          tkLive.textContent = liveText ? (tail.length ? TICKER_SEP : '') + liveText : '';
          var has = tail.length > 0 || !!liveText;
          tkEmpty.hidden = has;
          tkLine.classList.toggle('is-empty', !has);
          tkEmpty.textContent = has ? '' : meetingActive ? 'Listening…' : meetingEnded ? 'Meeting ended' : 'No meeting running';
          // Glide word by word, like the overlay. A long way off (a phone
          // joining mid-meeting, a burst of finals) or text that got shorter
          // jumps instead: a long smooth scroll trails behind the words.
          var target = Math.max(0, tkLine.scrollWidth - tkLine.clientWidth);
          var gap = target - tkLine.scrollLeft;
          if (gap < 0 || gap > tkLine.clientWidth) {
            tkLine.style.scrollBehavior = 'auto';
            tkLine.scrollLeft = target;
            tkLine.style.scrollBehavior = '';
          } else {
            tkLine.scrollLeft = target;
          }
        }
        function lineEl(seg) {
          var p = el('p', 'tl');
          var time = el('span', 'tl-time', fmtTime(seg.ts));
          p.append(time, document.createTextNode(seg.text));
          return p;
        }
        function rebuildTranscript() {
          txLines.textContent = '';
          txLiveEl = null;
          txFinals.forEach(function (seg) { seg.el = lineEl(seg); txLines.append(seg.el); });
          renderTranscript(true);
        }
        function renderTranscript(skipNew) {
          if (!skipNew) {
            txFinals.forEach(function (seg) {
              if (!seg.el) { seg.el = lineEl(seg); txLines.insertBefore(seg.el, txLiveEl); }
            });
            // Lines dropped from the front of the buffer.
            while (txLines.firstChild && txLines.firstChild !== txLiveEl && !txFinals.some(function (s) { return s.el === txLines.firstChild; })) {
              txLines.firstChild.remove();
            }
          }
          var recent = txLines.querySelector('.tl.is-recent');
          if (recent) recent.classList.remove('is-recent');
          var lastFinal = txFinals[txFinals.length - 1];
          if (lastFinal && lastFinal.el && !txLive) lastFinal.el.classList.add('is-recent');
          if (txLive) {
            if (!txLiveEl) {
              txLiveEl = el('p', 'tl is-live');
              txLines.append(txLiveEl);
            }
            txLiveEl.textContent = txLive.text;
          } else if (txLiveEl) {
            txLiveEl.remove();
            txLiveEl = null;
          }
          paintTranscriptState();
          if (tx.dataset.open !== 'true' && !isSplit()) txBody.scrollTop = txBody.scrollHeight;
          else if (txPinned) txBody.scrollTop = txBody.scrollHeight;
        }
        txBody.addEventListener('scroll', function () {
          txPinned = txBody.scrollHeight - txBody.clientHeight - txBody.scrollTop < 40;
        }, { passive: true });

        // ── The island: tap or drag to open, flick to throw it shut ──────
        var txOpen = false;
        var txSpring = new Spring(function (h) {
          tx.style.height = h + 'px';
          var lo = txMin(), hi = txMax();
          var p = hi > lo ? Math.max(0, Math.min(1, (h - lo) / (hi - lo))) : 0;
          tx.style.setProperty('--txp', p.toFixed(3));
          scrim.style.opacity = String(p);
        });
        function txMin() { return cssPx('--tx-collapsed', 40); }
        // Room to read above the dock, leaving a strip of dimmed feed that says
        // "tap to go back". On a very short screen (a small phone on its side)
        // that is barely a few lines, so the transcript takes the dock's space
        // too and the strip dims the dock instead.
        function txRoomAboveDock() { return app.clientHeight - bar.offsetHeight - dock.offsetHeight - 56; }
        function txCoversDock() { return txRoomAboveDock() < 200; }
        function txMax() {
          if (txCoversDock()) return Math.max(txMin(), app.clientHeight - bar.offsetHeight - 48);
          return Math.max(txMin(), Math.min(txRoomAboveDock(), Math.round(app.clientHeight * 0.66), 620));
        }
        function layoutTranscript() {
          if (isSplit()) {
            txSpring.stop();
            tx.style.height = '';
            tx.style.removeProperty('--txp');
            app.classList.remove('tx-over-dock');
            scrim.style.opacity = '0';
            scrim.classList.remove('is-active');
            return;
          }
          var target = txOpen ? txMax() : txMin();
          if (!txSpring.raf) txSpring.set(target);
          else txSpring.target = target;
        }
        function setTxOpen(open, velocity) {
          txOpen = open;
          tx.dataset.open = open ? 'true' : 'false';
          txHead.setAttribute('aria-expanded', open ? 'true' : 'false');
          txTicker.setAttribute('aria-expanded', open ? 'true' : 'false');
          scrim.classList.toggle('is-active', open);
          if (isSplit()) return;
          if (open && txCoversDock()) app.classList.add('tx-over-dock');
          var flicked = typeof velocity === 'number' && Math.abs(velocity) > 300;
          txSpring.to(open ? txMax() : txMin(), {
            velocity: typeof velocity === 'number' ? velocity : 0,
            response: 0.4,
            damping: flicked ? 0.82 : 1,
            onRest: function () {
              if (txOpen) return;
              txBody.scrollTop = txBody.scrollHeight;
              app.classList.remove('tx-over-dock');
            },
          });
          if (open) { txPinned = true; txBody.scrollTop = txBody.scrollHeight; }
        }
        txSpring.value = txMin();

        var drag = null;
        var suppressClick = false;
        tx.addEventListener('pointerdown', function (e) {
          if (isSplit() || (e.pointerType === 'mouse' && e.button !== 0)) return;
          if (txOpen && !(e.target.closest && e.target.closest('.tx-head, .tx-grip-hit'))) return;
          drag = { id: e.pointerId, y0: e.clientY, h0: txSpring.value, active: false, samples: [{ y: e.clientY, t: e.timeStamp }] };
          // Track on the window: a fast flick leaves the island before the
          // first move event, and capture can only be taken once we're moving.
          window.addEventListener('pointermove', onDragMove);
          window.addEventListener('pointerup', endDrag);
          window.addEventListener('pointercancel', endDrag);
        });
        function onDragMove(e) {
          if (!drag || e.pointerId !== drag.id) return;
          var dy = e.clientY - drag.y0;
          if (!drag.active) {
            if (Math.abs(dy) < 8) return;
            drag.active = true;
            // Grab it wherever it is, even mid-animation.
            txSpring.stop();
            drag.h0 = txSpring.value;
            drag.y0 = e.clientY;
            dy = 0;
            try { tx.setPointerCapture(drag.id); } catch (_) {}
            tx.classList.add('is-dragging');
            scrim.classList.add('is-active');
          }
          drag.samples.push({ y: e.clientY, t: e.timeStamp });
          while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 100) drag.samples.shift();
          var lo = txMin(), hi = txMax();
          var h = drag.h0 + dy;
          if (h > hi) h = hi + rubberband(h - hi, app.clientHeight);
          if (h < lo) h = lo - rubberband(lo - h, lo);
          txSpring.value = h;
          txSpring.onUpdate(h);
          txBody.scrollTop = txBody.scrollHeight;
        }
        function endDrag(e) {
          if (!drag || e.pointerId !== drag.id) return;
          var d = drag;
          drag = null;
          window.removeEventListener('pointermove', onDragMove);
          window.removeEventListener('pointerup', endDrag);
          window.removeEventListener('pointercancel', endDrag);
          if (!d.active) return;
          suppressClick = true;
          setTimeout(function () { suppressClick = false; }, 0);
          tx.classList.remove('is-dragging');
          var first = d.samples[0], lastS = d.samples[d.samples.length - 1];
          var dt = Math.max(1, lastS.t - first.t);
          var velocity = e.type === 'pointercancel' ? 0 : ((lastS.y - first.y) / dt) * 1000;
          var lo = txMin(), hi = txMax();
          var projected = txSpring.value + project(velocity);
          setTxOpen(Math.abs(projected - hi) < Math.abs(projected - lo), velocity);
        }
        tx.addEventListener('click', function (e) {
          if (suppressClick || isSplit()) return;
          if (txOpen && !(e.target.closest && e.target.closest('.tx-head, .tx-grip-hit'))) return;
          setTxOpen(!txOpen);
        });
        [txHead, txTicker].forEach(function (node) {
          node.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!isSplit()) setTxOpen(!txOpen); }
          });
        });
        scrim.addEventListener('click', function () { setTxOpen(false); });
        document.addEventListener('keydown', function (e) {
          if (e.key !== 'Escape') return;
          if (menu.classList.contains('is-open')) closeMenu();
          else if (txOpen) setTxOpen(false);
        });
        function onLayoutChange() {
          if (isSplit()) { txOpen = false; tx.dataset.open = 'false'; scrim.classList.remove('is-active'); }
          measureChrome();
          renderTranscript(true);
        }
        if (splitQuery.addEventListener) splitQuery.addEventListener('change', onLayoutChange);
        else if (splitQuery.addListener) splitQuery.addListener(onLayoutChange);

        // ───── Connection ─────────────────────────────────────────────────
        var params = new URLSearchParams(window.location.search);
        var token = params.get('t') || '';
        var socket = null;
        var reconnectTimer = 0;
        var reconnectDelay = 800;
        var conn = 'connecting';
        // The pill is the connection only; whether a meeting is running is said
        // by the transcript line and the empty page.
        var CONN_LABEL = { connecting: 'Connecting', live: 'Connected', reconnecting: 'Reconnecting', rejected: 'Link expired', missing: 'Not paired' };
        // The pill eases to the new label's width while the label swaps (old
        // text out 150 ms, new in 150 ms, width 300 ms): one motion, instead
        // of the width snapping between the two halves of the swap.
        var connEl = byId('conn');
        var connDot = connEl.querySelector('.conn-dot');
        var connMeasure = el('span', 'conn-measure');
        connMeasure.setAttribute('aria-hidden', 'true');
        connEl.append(connMeasure);
        var connResizeTimer = 0;
        function setConnLabel(next) {
          if (reduceMotion.matches || !connEl.offsetWidth) {
            connEl.style.width = '';
            swapText(connText, next);
            return;
          }
          var cs = getComputedStyle(connEl);
          connMeasure.textContent = next;
          var to = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + connDot.offsetWidth +
            (parseFloat(cs.columnGap) || 0) + connMeasure.getBoundingClientRect().width;
          // From where it is now, mid-resize included, so a quick second
          // change turns around smoothly.
          var from = connEl.getBoundingClientRect().width;
          connEl.style.width = from + 'px';
          void connEl.offsetWidth;
          // Growing, the width leads so the longer label lands with room.
          // Shrinking, it waits for the old label to leave (one text-swap
          // beat), then closes around the new one: no letters clipped.
          var shrinkDelay = to < from ? cssMs('--text-swap-dur', 150) : 0;
          connEl.style.transitionDelay = shrinkDelay + 'ms, 0ms, 0ms';
          connEl.style.width = to + 'px';
          swapText(connText, next);
          clearTimeout(connResizeTimer);
          // Back to its natural width once settled (the same width, no jump).
          connResizeTimer = setTimeout(function () {
            connEl.style.width = '';
            connEl.style.transitionDelay = '';
          }, shrinkDelay + cssMs('--resize-dur', 300) + 60);
        }
        // Reconnecting: tap the pill to try now (the page otherwise waits up
        // to 8 s between tries); after a moment the pill says so.
        var retryHintTimer = 0;
        function retryNow() {
          if (conn !== 'reconnecting') return;
          connEl.classList.add('is-pressed');
          setTimeout(function () { connEl.classList.remove('is-pressed'); }, 140);
          clearTimeout(reconnectTimer);
          reconnectDelay = 800;
          setConnLabel(CONN_LABEL.reconnecting);
          armRetryHint();
          connect();
        }
        function armRetryHint() {
          clearTimeout(retryHintTimer);
          retryHintTimer = setTimeout(function () { if (conn === 'reconnecting') setConnLabel('Tap to retry'); }, 3000);
        }
        connEl.addEventListener('click', retryNow);
        connEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); retryNow(); }
        });
        function setConn(next) {
          if (next === conn) return;
          conn = next;
          app.dataset.conn = next;
          setConnLabel(CONN_LABEL[next] || next);
          clearTimeout(retryHintTimer);
          if (next === 'reconnecting') armRetryHint();
          connEl.tabIndex = next === 'reconnecting' ? 0 : -1;
          var locked = next === 'rejected' || next === 'missing';
          lock.hidden = !locked;
          if (locked) {
            lockTitle.textContent = next === 'missing' ? 'This page needs a pairing link' : 'This pairing link has expired';
            byId('lockAgain').hidden = next === 'missing';
          }
          paintControls();
          paintEmptyCopy();
        }
        function isLive() { return conn === 'live' && socket && socket.readyState === WebSocket.OPEN; }
        function paintControls() {
          var ok = conn === 'live';
          Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (b) { b.disabled = !ok; });
          captureBtn.disabled = !ok;
          imageInput.disabled = !ok;
          imageBtn.classList.toggle('is-disabled', !ok);
          imageBtn.setAttribute('aria-disabled', ok ? 'false' : 'true');
          sendBtn.disabled = !ok || !input.value.trim();
          input.placeholder = ok ? 'Ask anything' : 'Waiting for your desktop…';
        }
        function sendCommand(cmd) {
          if (!isLive()) return false;
          try { socket.send(JSON.stringify(cmd)); return true; } catch (_) { return false; }
        }
        function connect() {
          clearTimeout(reconnectTimer);
          if (conn === 'rejected') return;
          var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          var url = proto + '//' + window.location.host + '/ws?t=' + encodeURIComponent(token);
          var previous = socket;
          try { socket = new WebSocket(url); } catch (_) { scheduleReconnect(); return; }
          // Only one socket at a time: a second one doubles every frame (two
          // copies of each token, two echoes of each question). The old one's
          // handlers see it is no longer current and stay quiet as it closes.
          if (previous && previous.readyState <= 1) { try { previous.close(); } catch (_) {} }
          var ws = socket;
          var opened = false;
          ws.addEventListener('open', function () {
            if (ws !== socket) return;
            opened = true;
            reconnectDelay = 800;
            setConn('live');
          });
          ws.addEventListener('close', function (ev) {
            if (ws !== socket || conn === 'rejected') return;
            if (ev.code === 4401) { setConn('rejected'); return; }
            setConn('reconnecting');
            scheduleReconnect();
            if (!opened) probeToken();
          });
          ws.addEventListener('error', function () { try { ws.close(); } catch (_) {} });
          ws.addEventListener('message', function (event) {
            if (ws !== socket) return;
            var payload;
            try { payload = JSON.parse(event.data); } catch (_) { return; }
            handleEvent(payload);
          });
        }
        // A refused token fails the WebSocket upgrade with an HTTP 401, which
        // the browser reports only as close code 1006. Ask the page URL itself
        // so an expired link stops retrying and says what to do.
        function probeToken() {
          if (typeof fetch !== 'function') return;
          fetch(window.location.pathname + window.location.search, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
            if (r.status === 401) { clearTimeout(reconnectTimer); setConn('rejected'); }
          }, function () {});
        }
        function scheduleReconnect() {
          clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, Math.min(reconnectDelay, 8000));
          reconnectDelay = Math.min(reconnectDelay * 1.6, 8000);
        }
        // Come back fast after the phone wakes or the tab returns.
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState !== 'visible') return;
          requestWakeLock();
          // A retry already in flight (or a live socket) is left alone.
          if (socket && socket.readyState <= 1) return;
          if (conn === 'reconnecting' || (socket && socket.readyState > 1)) { reconnectDelay = 800; connect(); }
        });

        // ───── Composer ───────────────────────────────────────────────────
        var DELIVERY_TIMEOUT_MS = 10000;
        function autoGrow() {
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 132) + 'px';
        }
        input.addEventListener('input', function () { autoGrow(); paintControls(); });
        input.addEventListener('focus', function () { if (!kbBase) kbBase = viewportHeight(); });
        input.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
          e.preventDefault();
          submit();
        });
        sendBtn.addEventListener('click', submit);
        function submit() {
          var text = input.value.trim();
          if (!text) return;
          if (!isLive()) { showToast('Not connected to your desktop', true); return; }
          var entry = { key: 'u:local:' + (++localSeq), t: Date.now(), kind: 'user', content: text, state: 'sending', local: true };
          if (!sendCommand({ type: 'chat', message: text })) { showToast('Not connected to your desktop', true); return; }
          input.value = '';
          autoGrow();
          paintControls();
          flashIcon(sendBtn, 900);
          pinned = true;
          appendEntry(entry);
          armDelivery(entry);
          addPending('chat', '', null);
        }
        function armDelivery(entry) {
          clearTimeout(entry.timer);
          entry.timer = setTimeout(function () {
            if (entry.state !== 'sending') return;
            entry.state = 'failed';
            paintUserState(entry);
            var wait = takePending(function (e) { return e.action === 'chat'; });
            if (wait) removeEntry(wait, true);
          }, DELIVERY_TIMEOUT_MS);
        }
        function retrySend(entry) {
          if (!sendCommand({ type: 'chat', message: entry.content })) { showToast('Not connected to your desktop', true); return; }
          entry.state = 'sending';
          paintUserState(entry);
          armDelivery(entry);
          addPending('chat', '', null);
        }

        // Buttons that answer from the conversation look quieter with no
        // meeting running, unless a screenshot waits to be answered.
        function paintMeetingChips() {
          var idle = !meetingActive && !trayCount;
          Array.prototype.forEach.call(document.querySelectorAll('.chip[data-needs-meeting]'), function (chip) {
            chip.classList.toggle('needs-meeting', idle);
          });
        }

        // ───── Actions ────────────────────────────────────────────────────
        Array.prototype.forEach.call(document.querySelectorAll('.chip[data-action]'), function (chip) {
          chip.addEventListener('animationend', function () { chip.classList.remove('is-shaking'); });
          chip.addEventListener('click', function () {
            var action = chip.dataset.action;
            // Answers from the conversation need one running (an attached
            // screenshot is something to answer from on its own).
            if (chip.classList.contains('needs-meeting')) {
              chip.classList.remove('is-shaking');
              void chip.offsetWidth;   // replay on a second tap
              chip.classList.add('is-shaking');
              showToast('Start a meeting on your Mac first');
              return;
            }
            if (!sendCommand({ type: 'action', action: action })) { showToast('Not connected to your desktop', true); return; }
            var spec = ACTIONS[action];
            // The chip's own flash confirms the send. A toast here landed on
            // top of the newest answer, which ends right above the dock.
            chip.classList.add('is-sent');
            clearTimeout(chip._sent);
            chip._sent = setTimeout(function () { chip.classList.remove('is-sent'); }, spec ? 700 : 1400);
            if (spec) addPending(action, spec.label, spec.expect);
          });
        });
        var captureTimer = 0;
        captureBtn.addEventListener('click', function () {
          if (!sendCommand({ type: 'screenshot' })) { showToast('Not connected to your desktop', true); return; }
          captureBtn.dataset.state = 'b';
          clearTimeout(captureTimer);
          captureTimer = setTimeout(function () { captureBtn.dataset.state = 'a'; }, 10000);
        });

        // ───── Photos and screenshots from this phone ─────────────────────
        // The picker is the phone's own: on iOS "Photo Library / Take Photo /
        // Choose File", on Android the camera-or-files chooser. A web page
        // can't capture the phone's screen itself, so a screenshot is taken
        // with the phone's buttons and picked here. Each image is decoded with
        // its EXIF rotation applied, scaled to 2048 px on the long edge and
        // re-encoded as JPEG, which also drops its location metadata. The
        // page's CSP blocks blob: URLs, so the thumbnail is a data: URL.
        var IMAGE_MAX_EDGE = 2048;
        var THUMB_MAX_EDGE = 640;
        var UPLOAD_TIMEOUT_MS = 30000;
        var MAX_IMAGES_PER_PICK = 4;
        imageBtn.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          if (!imageInput.disabled) imageInput.click();
        });
        imageInput.addEventListener('change', function () {
          var files = Array.prototype.slice.call(imageInput.files || [], 0, MAX_IMAGES_PER_PICK);
          imageInput.value = '';
          files.reduce(function (chain, file) {
            return chain.then(function () { return sendImageFile(file); });
          }, Promise.resolve());
        });
        function decodeImage(file) {
          function viaDataUrl() {
            return new Promise(function (resolve, reject) {
              var reader = new FileReader();
              reader.onload = function () {
                var img = new Image();
                img.onload = function () { resolve(img); };
                img.onerror = function () { reject(new Error('decode')); };
                img.src = String(reader.result);
              };
              reader.onerror = function () { reject(new Error('read')); };
              reader.readAsDataURL(file);
            });
          }
          if (typeof createImageBitmap !== 'function') return viaDataUrl();
          return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(viaDataUrl);
        }
        function drawScaled(source, maxEdge) {
          var w = source.naturalWidth || source.width;
          var h = source.naturalHeight || source.height;
          var scale = Math.min(1, maxEdge / Math.max(w, h));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(w * scale));
          canvas.height = Math.max(1, Math.round(h * scale));
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';            // JPEG has no transparency
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
          return canvas;
        }
        function prepareImage(file) {
          return decodeImage(file).then(function (source) {
            var full = drawScaled(source, IMAGE_MAX_EDGE);
            var thumb = drawScaled(source, THUMB_MAX_EDGE).toDataURL('image/jpeg', 0.72);
            if (typeof source.close === 'function') source.close();
            return new Promise(function (resolve, reject) {
              full.toBlob(function (blob) {
                if (blob) resolve({ blob: blob, thumb: thumb });
                else reject(new Error('encode'));
              }, 'image/jpeg', 0.88);
            });
          });
        }
        function sendImageFile(file) {
          return prepareImage(file).then(function (prepared) {
            var entry = { key: 'img:' + (++localSeq), t: Date.now(), kind: 'image', local: true, state: 'sending', blob: prepared.blob, thumb: prepared.thumb };
            pinned = true;
            appendEntry(entry);
            return uploadImage(entry);
          }, function () {
            showToast('Couldn’t read that image', true);
          });
        }
        function uploadImage(entry) {
          entry.state = 'sending';
          paintImageState(entry);
          var controller = typeof AbortController === 'function' ? new AbortController() : null;
          var timer = setTimeout(function () { if (controller) controller.abort(); }, UPLOAD_TIMEOUT_MS);
          return fetch('/image?t=' + encodeURIComponent(token), {
            method: 'POST',
            headers: { 'Content-Type': 'image/jpeg' },
            body: entry.blob,
            cache: 'no-store',
            signal: controller ? controller.signal : undefined,
          }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json().catch(function () { return {}; });
          }).then(function (body) {
            entry.state = '';
            entry.blob = null;
            // The id the desktop's tray lists it under (for Remove).
            if (body && typeof body.id === 'string') entry.shotId = body.id;
            paintImageState(entry);
            announce('Image sent to your desktop.');
          }).catch(function () {
            entry.state = 'failed';
            paintImageState(entry);
          }).then(function () {
            clearTimeout(timer);
          });
        }

        // ───── Menu ───────────────────────────────────────────────────────
        function openMenu() {
          menu.classList.remove('is-closing');
          menu.classList.add('is-open');
          menuBtn.setAttribute('aria-expanded', 'true');
          var first = menu.querySelector('.menu-item');
          if (first && document.activeElement === menuBtn) first.focus({ preventScroll: true });
        }
        function closeMenu() {
          if (!menu.classList.contains('is-open')) return;
          menu.classList.remove('is-open');
          menu.classList.add('is-closing');
          menuBtn.setAttribute('aria-expanded', 'false');
          setTimeout(function () { menu.classList.remove('is-closing'); }, cssMs('--dropdown-close-dur', 150));
        }
        menuBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (menu.classList.contains('is-open')) closeMenu(); else openMenu();
        });
        document.addEventListener('pointerdown', function (e) {
          if (!menu.classList.contains('is-open')) return;
          if (menu.contains(e.target) || menuBtn.contains(e.target)) return;
          closeMenu();
        });
        menu.addEventListener('click', function (e) {
          var item = e.target.closest && e.target.closest('[data-menu]');
          if (!item) return;
          var what = item.dataset.menu;
          closeMenu();
          if (what === 'copy') copyConversation();
          else if (what === 'transcript') copyTranscript();
          else if (what === 'clear') clearScreen();
        });
        function copyConversation() {
          var parts = [];
          entries.forEach(function (e) {
            if (e.kind === 'user') parts.push('You: ' + e.content);
            else if (e.kind === 'image') parts.push('You: [image]');
            else if (e.kind === 'shots') parts.push('You: [' + (e.images.length > 1 ? e.images.length + ' screenshots' : 'screenshot') + ']');
            else if (e.kind === 'assistant' && e.content && !e.idle) parts.push((e.label ? '[' + e.label + '] ' : '') + splitGist(e.content).body);
          });
          if (!parts.length) { showToast('Nothing to copy yet', true); return; }
          copyText(parts.join(NL + NL)).then(function (ok) { showToast(ok ? 'Conversation copied' : 'Copy blocked by the browser', !ok); });
        }
        function copyTranscript() {
          var lines = txFinals.map(function (s) { return s.text; });
          if (txLive) lines.push(txLive.text);
          if (!lines.length) { showToast('No transcript yet', true); return; }
          copyText(lines.join(NL)).then(function (ok) { showToast(ok ? 'Transcript copied' : 'Copy blocked by the browser', !ok); });
        }
        function clearScreen() {
          clearedAt = Date.now();
          entries.slice().forEach(function (e) {
            if (live && live.entry === e) return;
            clearTimeout(e.timer);
            removeEntry(e, false);
          });
          unseen = 0;
          updateJump();
          updateEmpty();
        }

        // ───── Clipboard (the page is plain http on the LAN, so the async
        // clipboard API is usually unavailable; fall back to a selection) ──
        function legacyCopy(text) {
          var ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.top = '0';
          ta.style.left = '0';
          ta.style.opacity = '0';
          ta.style.fontSize = '16px';
          document.body.appendChild(ta);
          ta.select();
          ta.setSelectionRange(0, text.length);
          var ok = false;
          try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
          document.body.removeChild(ta);
          return ok;
        }
        function copyText(text) {
          if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
          }
          return Promise.resolve(legacyCopy(text));
        }
        function bindCodeCopy(scope) {
          Array.prototype.forEach.call(scope.querySelectorAll('button.codeblock-copy:not([data-bound])'), function (btn) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', function (e) {
              e.stopPropagation();
              var block = btn.closest('.codeblock');
              var code = block && block.querySelector('pre code');
              if (!code) return;
              copyText(code.textContent || '').then(function (ok) {
                if (!ok) { showToast('Copy blocked by the browser', true); return; }
                btn.classList.add('copied');
                swapText(btn, 'Copied');
                setTimeout(function () { btn.classList.remove('copied'); swapText(btn, 'Copy'); }, 1400);
              });
            });
          });
        }

        // ───── Wake lock: keep the phone's screen on while it's mirroring ─
        var wakeLock = null;
        function requestWakeLock() {
          if (!('wakeLock' in navigator) || wakeLock) return;
          navigator.wakeLock.request('screen').then(function (lockHandle) {
            wakeLock = lockHandle;
            lockHandle.addEventListener('release', function () { wakeLock = null; });
          }, function () { wakeLock = null; });
        }

        // ───── Boot ───────────────────────────────────────────────────────
        // iOS only honours :active when a touch listener exists.
        document.addEventListener('touchstart', function () {}, { passive: true });
        syncViewport();
        updateEmpty();
        paintTranscriptState();
        paintControls();
        if (!token) {
          setConn('missing');
          return;
        }
        // Served as refused: the link's token is not (or no longer) valid.
        if (document.documentElement.dataset.link === 'refused') {
          setConn('rejected');
          return;
        }
        requestWakeLock();
        connect();
      })();
    </script>
  </body>
</html>
`;
