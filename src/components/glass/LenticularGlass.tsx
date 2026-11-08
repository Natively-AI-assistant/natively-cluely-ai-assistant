// Ported from natively-website src/components/glass/LenticularGlass.tsx
// (2026-11-07) for the in-app Unlock Pro page, so its backdrop is the
// website's own reeded glass. Changes from the website: no prerender check
// (Electron has none), hardwareContext inlined below, Tailwind classes as
// inline styles. lenticular.ts is copied unchanged.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type RefObject } from "react";
import { CONCEPTS, FRAGMENT_SHADER, VERTEX_SHADER, conceptById, fallbackStyle, hexToRgb, ribComb, type ConceptId, type GlassParams, type Palette } from "./lenticular";


/**
 * A WebGL context, only where a GPU draws it (natively-website
 * src/lib/hardwareWebgl.ts). In software (SwiftShader, llvmpipe: no GPU, or a
 * blocklisted one) the shader would take the renderer's main thread, so null
 * there and the CSS stand-in shows instead.
 */
function hardwareContext(canvas: HTMLCanvasElement, type: "webgl", attributes: WebGLContextAttributes = {}): WebGLRenderingContext | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext(type, { ...attributes, failIfMajorPerformanceCaveat: true }) as WebGLRenderingContext | null;
  } catch {
    return null;
  }
  if (!gl) return null;
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  if (/swiftshader|llvmpipe|softpipe|software/i.test(gpu)) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  return gl;
}

/**
 * A lenticular glass backdrop: one of the eight concepts in `lenticular.ts`,
 * drawn by WebGL into a canvas that fills its parent.
 *
 * It renders on demand, not on a clock: once when it mounts, again when it is
 * resized or its props change, and, when `parallax` is on, as the pointer
 * moves over its parent (the scene shifts a little behind the ribs, the way
 * reeded glass does when you move past it). `drift` turns on a slow, cheap
 * animation of the scene; it is off by default and stays off under reduced
 * motion. A CSS stand-in, the concept's ground with the ribs as a comb of
 * light, always sits under the canvas: it is the first paint, and all there
 * is without WebGL.
 *
 * `image` puts a picture behind the glass in place of the concept's scene (the
 * concept still gives the glass its settings); it is read once, when the
 * canvas mounts, and the CSS stand-in shows the picture until it is drawn.
 *
 * `ref.exportPng(scale)` renders the current frame at `scale` times the CSS
 * size and returns it as a PNG data URL.
 *
 * Nothing runs in the prerender: the HTML it writes is the empty canvas the
 * page then paints on the client.
 */

export type LenticularGlassHandle = { exportPng: (scale?: number) => string | null };

type Props = {
  concept: ConceptId;
  params?: Partial<GlassParams>;
  /** Overrides the concept's default palette (background top, background bottom, three object colours). */
  palette?: Palette;
  parallax?: boolean;
  /** The element whose pointer moves the scene: a ref, or a selector for the
      closest ancestor (a backdrop inside a section gives "section"); the
      canvas's parent when not given. */
  pointerTarget?: RefObject<HTMLElement | null> | string;
  drift?: boolean;
  /** A picture to bend in place of the concept's scene (same origin). */
  image?: string;
  className?: string;
  style?: CSSProperties;
};

const DPR_CAP = 2;
const DRIFT_DPR_CAP = 1.25;

const LenticularGlass = forwardRef<LenticularGlassHandle, Props>(function LenticularGlass(
  { concept, params, palette, parallax = true, pointerTarget, drift = false, image, className = "", style },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);
  const draw = useRef<((scale?: number) => void) | null>(null);

  const def = conceptById(concept);
  const colors: Palette = palette ?? def.palettes[0].colors;
  const p: GlassParams = { ...def.params, ...params };

  // Everything the shader is given, kept where the render closure can read the
  // latest values without being rebuilt for each change.
  const latest = useRef({ def, colors, p, parallax, drift, pointerTarget, image });
  latest.current = { def, colors, p, parallax, drift, pointerTarget, image };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = hardwareContext(canvas, "webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) {
      setFallback(true);
      return;
    }
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) return null;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      setFallback(true);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      setFallback(true);
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    const U = {
      res: u("uRes"), dpr: u("uDpr"), time: u("uTime"), mouse: u("uMouse"), rib: u("uRib"), dist: u("uDist"), blur: u("uBlur"),
      light: u("uLight"), disp: u("uDisp"), concept: u("uConcept"), c: [u("uC0"), u("uC1"), u("uC2"), u("uC3"), u("uC4")],
      img: u("uImg"), hasImg: u("uHasImg"), imgSize: u("uImgSize"),
    };
    // The picture, once loaded: a texture any size (clamped, no mipmaps, as WebGL 1 needs).
    const pic = { tex: null as WebGLTexture | null, w: 0, h: 0 };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mouse = [0.5, 0.5];
    const target = [0.5, 0.5];
    const start = performance.now();
    let raf = 0;

    const render = (scale = 1) => {
      // A concept with a picture has nothing worth drawing until that picture's
      // texture is ready: drawing now would paint the concept's flat, picture-less
      // ground for one frame — a visible flash of the wrong background between
      // the CSS stand-in (which already shows the picture) and the real glass
      // render. The canvas stays hidden until drawn, so the stand-in shows instead.
      if (latest.current.image && !pic.tex) return;
      const { def, colors, p } = latest.current;
      // Drawn every frame while drifting, so a lower cap on the pixel ratio then.
      const dpr = Math.min(window.devicePixelRatio || 1, latest.current.drift ? DRIFT_DPR_CAP : DPR_CAP) * scale;
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(U.res, w, h);
      gl.uniform1f(U.dpr, dpr);
      gl.uniform1f(U.time, still ? 0 : (performance.now() - start) / 1000);
      gl.uniform2f(U.mouse, mouse[0], mouse[1]);
      gl.uniform1f(U.rib, p.rib);
      gl.uniform1f(U.dist, p.distortion);
      gl.uniform1f(U.blur, p.blur);
      gl.uniform1f(U.light, p.lighting);
      gl.uniform1f(U.disp, p.dispersion);
      gl.uniform1i(U.concept, def.index);
      colors.forEach((hex, i) => {
        const [r, g, b] = hexToRgb(hex);
        gl.uniform3f(U.c[i], r, g, b);
      });
      gl.uniform1f(U.hasImg, pic.tex ? 1 : 0);
      if (pic.tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, pic.tex);
        gl.uniform1i(U.img, 0);
        gl.uniform2f(U.imgSize, pic.w, pic.h);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      canvas.style.visibility = "visible";
    };
    draw.current = render;

    // The pointer eases toward where it is; while it is still moving, or the
    // scene drifts, frames are drawn on the clock; otherwise none are.
    const tick = () => {
      raf = 0;
      const { parallax, drift } = latest.current;
      mouse[0] += (target[0] - mouse[0]) * 0.08;
      mouse[1] += (target[1] - mouse[1]) * 0.08;
      render();
      const moving = parallax && (Math.abs(target[0] - mouse[0]) > 0.0005 || Math.abs(target[1] - mouse[1]) > 0.0005);
      if ((drift && !still) || moving) raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const want = latest.current.pointerTarget;
    const host: HTMLElement =
      (typeof want === "string" ? (canvas.closest(want) as HTMLElement | null) : want?.current) ?? canvas.parentElement ?? canvas;
    const onMove = (e: PointerEvent) => {
      if (!latest.current.parallax) return;
      const r = host.getBoundingClientRect();
      target[0] = (e.clientX - r.left) / r.width;
      target[1] = (e.clientY - r.top) / r.height;
      wake();
    };
    const onLeave = () => {
      target[0] = 0.5;
      target[1] = 0.5;
      wake();
    };
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);

    const src = latest.current.image;
    let cancelled = false;
    if (src) {
      const el = new Image();
      el.onload = () => {
        if (cancelled) return;
        pic.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, pic.tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, el);
        pic.w = el.naturalWidth;
        pic.h = el.naturalHeight;
        render();
      };
      el.src = src;
    }

    const ro = new ResizeObserver(() => render());
    ro.observe(canvas);

    // Drawn only while on screen.
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) wake();
      else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(canvas);
    render();

    return () => {
      cancelled = true;
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      ro.disconnect();
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
      draw.current = null;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  // A change of concept, params, palette or drift redraws (or restarts the clock).
  const paletteKey = colors.join();
  useEffect(() => {
    if (draw.current) draw.current();
    if (drift && draw.current && canvasRef.current) {
      // Nudge the loop: a synthetic leave resets the pointer and wakes the clock.
      canvasRef.current.parentElement?.dispatchEvent(new PointerEvent("pointerleave"));
    }
  }, [concept, params, palette, drift, p.rib, p.distortion, p.blur, p.lighting, p.dispersion, paletteKey]);

  useImperativeHandle(ref, () => ({
    exportPng: (scale = 2) => {
      const canvas = canvasRef.current;
      if (!canvas || !draw.current) return null;
      draw.current(scale);
      const url = canvas.toDataURL("image/png");
      draw.current();
      return url;
    },
  }));

  // The CSS stand-in is always underneath: it is what the prerendered page and
  // the first paint show, and all that shows where WebGL is not there.
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{ position: "absolute", inset: 0, ...(image ? pictureStyle(image, p.rib) : fallbackStyle(def, colors, p.rib)), ...style }}
    >
      {/* Hidden until its first frame: an opaque (alpha: false) WebGL canvas is
          black until drawn, and with a picture nothing is drawn until it loads. */}
      {!fallback && <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%", visibility: "hidden" }} />}
    </div>
  );
});

/** The CSS stand-in with a picture: the picture, cover-fitted, under the ribs' comb of light. */
const pictureStyle = (image: string, rib: number): CSSProperties => ({
  backgroundImage: `${ribComb(rib)}, url(${image})`,
  backgroundSize: "auto, cover",
  backgroundPosition: "center",
});

export default LenticularGlass;
export { CONCEPTS };
