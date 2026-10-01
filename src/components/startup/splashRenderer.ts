// Canvas renderer for the startup splash: the logo rebuilt in characters.
// The timeline lives in splashTimeline.ts; this file only lays out cells and draws them.
import {
    EXIT_FADE_MS, EXIT_MS, FOCUS_MS, LOGO_SCALE, RIPPLE_DENSITY, RIPPLE_WIDTH, SETTLE_AT_MS, STEP_MS,
    animationTime, cameraAt, cellTimes, churnClock, easeOut, hash, logoLetGo, prog, rippleAt, rippleReach, smoothstep, zoomAt,
} from './splashTimeline';

// The Natively mark: brand/natively-mark-*.svg, the same path as NativelyLogoMark.tsx.
const MARK_D = 'M512 106 A406 406 0 1 1 512 918 A406 406 0 1 1 512 106 Z M512 174 A338 338 0 1 0 512 850 A338 338 0 1 0 512 174 Z M288 192.77 H356 V831.23 H288 Z M668 192.77 H736 V831.23 H668 Z M271.30 207 L352.62 207 L752.70 817 L671.38 817 Z';
const MARK_ORIGIN = 106, MARK_BOX = 812;
const MARK_PX = 96;

// ui-monospace is SF Mono on macOS; Windows has neither it nor Menlo and lands on Consolas.
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
// The logo is drawn in 0 and 1 with a few . and : mixed into the churn.
const CHARS = '01.:';
const CHURN = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 2, 3];
// Where a cell locks, 1s fill the strokes and 0 . : trace the edges.
const lockedChar = (cov: number) => (cov < 0.25 ? 2 : cov < 0.5 ? 3 : cov < 0.75 ? 0 : 1);
const tone = (cov: number) => 0.55 + 0.45 * cov;
// How much of a cell the logo covers (0..1), with a gentle contrast curve so the faint halo outside the logo goes.
const contrast = (v: number) => smoothstep(v, 0.06, 0.7);

type Surface = OffscreenCanvas | HTMLCanvasElement;
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function surface(w: number, h: number, readback = false): { cv: Surface; c: Ctx } {
    let cv: Surface;
    if (typeof OffscreenCanvas !== 'undefined') cv = new OffscreenCanvas(w, h);
    else {
        cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
    }
    const c = cv.getContext('2d', readback ? { willReadFrequently: true } : undefined) as Ctx | null;
    if (!c) throw new Error('startup splash: no 2d canvas context');
    return { cv, c };
}

// Characters are drawn once into a strip and stamped from there: far cheaper than fillText per cell.
// A blurred strip pads every cell so a soft character never bleeds into its neighbour.
interface Atlas { cv: Surface; pw: number; ph: number; pad: number }

function atlas(chars: string, cw: number, ch: number, font: string, blurPx = 0): Atlas {
    const list = Array.from(chars), pad = blurPx ? Math.ceil(blurPx * 2.5) : 0, pw = cw + 2 * pad, ph = ch + 2 * pad;
    const { cv, c } = surface(Math.max(1, pw * list.length), ph);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = font;
    if (blurPx) c.filter = `blur(${blurPx}px)`;
    list.forEach((g, i) => c.fillText(g, i * pw + pw / 2, ph / 2 + ch * 0.04));
    return { cv, pw, ph, pad };
}

function glyph(ctx: CanvasRenderingContext2D, at: Atlas, index: number, x: number, y: number, alpha: number) {
    if (alpha <= 0.003) return;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(at.cv, index * at.pw, 0, at.pw, at.ph, x - at.pad, y - at.pad, at.pw, at.ph);
}

/** The mark rasterised at its on-screen size, as coverage 0..1 per device pixel. */
function markMask(F: number, cx: number, cy: number) {
    const size = Math.ceil(F) + 4, x0 = Math.round(cx - size / 2), y0 = Math.round(cy - size / 2);
    const { c } = surface(size, size, true);
    c.fillStyle = '#fff';
    c.translate(cx - F / 2 - x0, cy - F / 2 - y0);
    c.scale(F / MARK_BOX, F / MARK_BOX);
    c.translate(-MARK_ORIGIN, -MARK_ORIGIN);
    c.fill(new Path2D(MARK_D));
    const d = c.getImageData(0, 0, size, size).data, a = new Float32Array(size * size);
    for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
    return { x0, y0, size, a };
}

interface Cell {
    x: number; y: number;
    cov: number; // how much of the cell the logo covers
    dist: number; // distance from the centre, in logo radii
    id: number;
    phase: number; // every cell churns on its own beat
    still: number; // the one character an empty cell shows when the ring crosses it
    appear: number; lockAt: number; drainAt: number;
}

export interface SplashScene {
    reach: number; // how far the ring travels, in logo radii
    cx: number; cy: number;
    logo: Cell[]; // cells the logo covers
    field: Cell[]; // the sparse churning field around it
    ringOnly: Cell[]; // otherwise-empty cells, lit only by the ring
    sharp: Atlas; soft: Atlas; softer: Atlas; glow: Atlas;
}

/**
 * Lays the splash out for a W x H device-pixel canvas. `u` is device pixels per
 * CSS pixel. Runs once per canvas size; everything is snapped to whole device
 * pixels so the characters stay crisp at 125 % and 150 % display scaling.
 */
export function prepareSplash(W: number, H: number, u: number): SplashScene {
    const cell = (px: number) => Math.max(1, Math.round(px * u));
    // terminal-shaped cells: line height 10 px, width = the font's measured advance
    const ch = cell(10), fontPx = Math.round(ch * 0.86), font = `500 ${fontPx}px ${MONO}`;
    const measure = surface(8, 8).c;
    measure.font = font;
    const cw = Math.max(1, Math.round(measure.measureText('0').width + 0.6 * u));

    // the logo sits at the centre of the window
    const ecx = W / 2, ecy = H / 2;
    const F = MARK_PX * u * LOGO_SCALE, R = F / 2, mask = markMask(F, ecx, ecy);
    const cx = Math.round(ecx), cy = Math.round(ecy);
    const nx = (Math.ceil(W / cw) + 2) | 1, ny = (Math.ceil(H / ch) + 2) | 1; // odd counts: one cell sits dead centre
    const ox = cx - Math.floor(nx / 2) * cw - Math.floor(cw / 2), oy = cy - Math.floor(ny / 2) * ch - Math.floor(ch / 2);
    const fieldDensity = 0.2 * (((cw / u) * (ch / u)) / 81);
    // the ring crosses a window of any size the way it crosses the default one
    const reach = rippleReach(Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) / R);
    const rippleDensity = Math.max(fieldDensity, RIPPLE_DENSITY), rippleMax = reach + 3 * RIPPLE_WIDTH;

    const logo: Cell[] = [], field: Cell[] = [], ringOnly: Cell[] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const x0 = ox + i * cw, y0 = oy + j * ch;
        let sum = 0; // average the mask over this cell
        if (x0 + cw > mask.x0 && y0 + ch > mask.y0 && x0 < mask.x0 + mask.size && y0 < mask.y0 + mask.size)
            for (let y = y0; y < y0 + ch; y++) {
                const my = y - mask.y0;
                if (my < 0 || my >= mask.size) continue;
                for (let x = x0; x < x0 + cw; x++) {
                    const mx = x - mask.x0;
                    if (mx >= 0 && mx < mask.size) sum += mask.a[my * mask.size + mx];
                }
            }
        const cov = contrast(sum / (cw * ch)), isField = cov < 0.03;
        const dist = Math.hypot((x0 + cw / 2 - cx) / R, (y0 + ch / 2 - cy) / R);
        // The field outside the logo is sparse. A few more empty cells are kept for the ring alone
        // (same noise channel, so the field cells are a subset of the cells the ring can light).
        const sparse = hash(i, j, 3), ring = isField && sparse >= fieldDensity;
        if (ring && (sparse >= rippleDensity || dist > rippleMax)) continue;
        (isField ? (ring ? ringOnly : field) : logo).push({
            x: x0, y: y0, cov, dist, id: i * 131 + j * 7919,
            phase: hash(i, j, 13) * STEP_MS,
            still: CHURN[Math.floor(hash(i, j, 17) * CHURN.length)],
            ...cellTimes(dist, hash(i, j, 7), hash(i, j, 11), isField),
        });
    }

    return {
        reach, cx, cy, logo, field, ringOnly,
        sharp: atlas(CHARS, cw, ch, font),
        soft: atlas(CHARS, cw, ch, font, 0.9 * u), // slightly out of focus
        softer: atlas(CHARS, cw, ch, font, 1.8 * u), // far from the centre
        glow: atlas(CHARS, cw, ch, font, 2.2 * u), // the light around a character the ring is crossing
    };
}

/**
 * Draws the frame for T (real ms since the splash mounted) over whatever the canvas
 * holds. `exitT` is real ms since the splash started to leave, or -1 while it stays.
 */
export function renderSplash(ctx: CanvasRenderingContext2D, s: SplashScene, T: number, exitT = -1): void {
    const t = Math.min(animationTime(T), SETTLE_AT_MS), ring = rippleAt(t, s.reach);
    const leaving = exitT >= 0, e = Math.min(exitT, EXIT_MS);
    const churn = (k: Cell, at: Atlas, alpha: number, clock: number) => {
        const step = Math.floor((clock + k.phase) / STEP_MS);
        glyph(ctx, at, CHURN[Math.floor(hash(k.id, step, 5) * CHURN.length)], k.x, k.y, alpha);
    };
    // depth: the field is out of focus, more so far from the centre
    const fieldAtlas = (k: Cell) => (k.dist > 2.4 ? s.softer : s.soft);

    // the field and the ring first, outside the zoom and drifting towards the viewer
    const camera = cameraAt(t);
    ctx.save();
    if (camera !== 1) {
        ctx.translate(s.cx, s.cy);
        ctx.scale(camera, camera);
        ctx.translate(-s.cx, -s.cy);
    }
    for (const k of s.field) {
        const a = easeOut(prog(t, k.appear, 140));
        if (a <= 0) continue;
        const base = k.dist < 1.05 ? 0.14 : 0.24 * Math.max(0.45, 1 - k.dist / 9);
        const alpha = base * a * (1 - easeOut(prog(t, k.drainAt, 260)));
        if (alpha > 0.003) churn(k, fieldAtlas(k), alpha, t);
        // under the ring a cell holds one character instead of churning, so the ring glides rather than flickers
        if (ring) glyph(ctx, fieldAtlas(k), k.still, k.x, k.y, 0.45 * ring(k.dist));
    }
    if (ring) for (const k of s.ringOnly) glyph(ctx, fieldAtlas(k), k.still, k.x, k.y, 0.45 * ring(k.dist));
    ctx.restore();

    // then the logo, inside the spring zoom
    const zoom = zoomAt(t);
    ctx.save();
    if (zoom !== 1) {
        ctx.translate(s.cx, s.cy);
        ctx.scale(zoom, zoom);
        ctx.translate(-s.cx, -s.cy);
    }
    const lit: number[] = [];
    for (let n = 0; n < s.logo.length; n++) {
        const k = s.logo[n], a = easeOut(prog(t, k.appear, 140));
        if (a <= 0) continue;
        const alpha = a * tone(k.cov);
        if (leaving) {
            // the exit: the outer cells let go first, fall back into the churn out of focus, and fade
            const letGo = logoLetGo(k.dist, k.phase / STEP_MS);
            if (e >= letGo) {
                churn(k, s.soft, alpha * 0.7 * (1 - easeOut(prog(e, letGo, EXIT_FADE_MS))), SETTLE_AT_MS + e);
                continue;
            }
        }
        if (t < k.lockAt) {
            churn(k, s.soft, alpha * 0.7, churnClock(t, k.lockAt));
            continue;
        }
        const index = lockedChar(k.cov), focus = easeOut(prog(t, k.lockAt, FOCUS_MS));
        if (focus < 1) glyph(ctx, s.soft, index, k.x, k.y, alpha * (1 - focus));
        glyph(ctx, s.sharp, index, k.x, k.y, alpha * focus);
        const light = ring ? 0.9 * ring(k.dist) : 0;
        if (light > 0.01) lit.push(n, light * a * Math.max(tone(k.cov), 0.5));
    }
    // the light: each character the ring is crossing gets a blurred copy of itself added on top
    if (lit.length) {
        ctx.globalCompositeOperation = 'lighter';
        for (let n = 0; n < lit.length; n += 2) {
            const k = s.logo[lit[n]], light = lit[n + 1], index = lockedChar(k.cov);
            glyph(ctx, s.glow, index, k.x, k.y, light * 0.9);
            glyph(ctx, s.sharp, index, k.x, k.y, light * 0.35);
        }
        ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    ctx.globalAlpha = 1;
}
