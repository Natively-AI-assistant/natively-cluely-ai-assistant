// electron/llm/visionTestImage.ts
//
// The image the one-time vision test shows a model: four digits composed from
// embedded glyph bitmaps into an 8-bit RGB PNG (design:
// docs/plans/2026-10-01-vision-capability-design.md, phase 3). Pure Node — zlib
// and PNG chunks only — so the bytes are identical on macOS and Windows: no
// system font, no native module, nothing to differ between machines.
//
// A REAL TYPEFACE, measured (2026-10-01). The first version drew a 5x7 block
// font: GPT-4o mini read 7392 as "7320" and Claude Haiku 4.5 answered "12345".
// Square seven-segment digits fixed Claude but GPT-4o mini read 4816 as
// "49/16". Inter Bold was read correctly 12 times out of 12 by both, so the
// digits are Inter Bold, rasterised once at development time
// (scripts/generate-vision-test-glyphs.py) and embedded in visionTestGlyphs.ts.
// A test image a capable model misreads would save a false "no" for a month.

import zlib from 'node:zlib';
import { GLYPH_H, GLYPH_W, GLYPHS_DEFLATED_BASE64 } from './visionTestGlyphs';

const MARGIN = 40;   // white space around the number, in pixels
const GAP = 6;       // between digit cells (each glyph is already centred in its cell)
const ROW_BYTES = (GLYPH_W + 7) >> 3;

let glyphBits: Buffer | null = null;
function glyphs(): Buffer {
  return (glyphBits ??= zlib.inflateSync(Buffer.from(GLYPHS_DEFLATED_BASE64, 'base64')));
}

/** A four-digit number, 1000–9999: no leading zero for a model to drop. */
export function newVisionTestNumber(random: () => number = Math.random): string {
  return String(1000 + Math.floor(random() * 9000));
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(body) >>> 0, body.length + 4);
  return out;
}

/** Black digits on white. The image size depends only on how many digits there are. */
export function renderDigitsPng(digits: string): Buffer {
  if (!/^\d+$/.test(digits)) throw new Error('renderDigitsPng: digits only');
  const bits = glyphs();
  const width = MARGIN * 2 + digits.length * GLYPH_W + (digits.length - 1) * GAP;
  const height = MARGIN * 2 + GLYPH_H;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y++) raw[y * stride] = 0; // filter type 0 on every row
  [...digits].forEach((d, i) => {
    const glyph = Number(d) * GLYPH_H * ROW_BYTES;
    const left = MARGIN + i * (GLYPH_W + GAP);
    for (let gy = 0; gy < GLYPH_H; gy++) {
      const rowStart = (MARGIN + gy) * stride + 1;
      for (let gx = 0; gx < GLYPH_W; gx++) {
        if (bits[glyph + gy * ROW_BYTES + (gx >> 3)] & (0x80 >> (gx & 7))) raw.fill(0, rowStart + (left + gx) * 3, rowStart + (left + gx) * 3 + 3);
      }
    }
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
