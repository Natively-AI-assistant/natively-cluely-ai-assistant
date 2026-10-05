/**
 * The one-time test's image (2026-10-01): digits composed from embedded glyph
 * bitmaps (Inter Bold, rasterised once at development time) into a PNG by pure
 * Node, so it is byte-identical on macOS and Windows — no system fonts, no
 * native modules. A real typeface on purpose: a 5x7 block font was misread by
 * GPT-4o mini ("7320" for 7392) and Claude Haiku 4.5 ("12345"), and square
 * seven-segment digits by GPT-4o mini ("49/16" for 4816); Inter Bold was read
 * correctly 12 times out of 12 by both.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (p) => path.join(__dirname, '../../../dist-electron/electron', p);
const electronPath = require.resolve('electron');
require.cache[electronPath] = {
  id: electronPath, filename: electronPath, loaded: true,
  exports: { app: { isReady: () => true, getPath: () => os.tmpdir(), getVersion: () => '0.0.0-test' }, safeStorage: { isEncryptionAvailable: () => false } },
};
const { newVisionTestNumber, renderDigitsPng } = require(dist('llm/visionTestImage.js'));

/** Minimal PNG reader for 8-bit RGB, filter 0: returns { width, height, pixels } with one value (the red channel) per pixel. */
function decode(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  let off = 8; let width = 0; let height = 0; const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off); const type = png.toString('ascii', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    assert.equal(png.readUInt32BE(off + 8 + len), zlib.crc32(png.subarray(off + 4, off + 8 + len)), `${type} CRC`);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.equal(data[8], 8, 'bit depth'); assert.equal(data[9], 2, 'colour type RGB'); }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = [];
  const stride = width * 3 + 1;
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * stride], 0, 'filter byte');
    pixels.push(Uint8Array.from({ length: width }, (_, x) => raw[y * stride + 1 + x * 3]));
  }
  return { width, height, pixels };
}

describe('newVisionTestNumber', () => {
  test('always four digits, never a leading zero', () => {
    for (const r of [0, 0.5, 0.9999999]) assert.match(newVisionTestNumber(() => r), /^[1-9]\d{3}$/);
    assert.equal(newVisionTestNumber(() => 0), '1000');
    assert.equal(newVisionTestNumber(() => 0.9999999), '9999');
  });
});

describe('renderDigitsPng', () => {
  test('a valid RGB PNG with dark digits on a light background', () => {
    const { width, height, pixels } = decode(renderDigitsPng('7392'));
    assert.ok(width >= 300 && height >= 120, `${width}x${height}`);
    const dark = pixels.reduce((n, row) => n + row.filter((v) => v < 64).length, 0);
    assert.ok(dark > width * height * 0.05 && dark < width * height * 0.5, `dark share ${dark / (width * height)}`);
    assert.equal(pixels[0][0], 255, 'the margin is white');
  });
  test('deterministic, and different numbers give different images', () => {
    assert.ok(renderDigitsPng('7392').equals(renderDigitsPng('7392')));
    assert.ok(!renderDigitsPng('7392').equals(renderDigitsPng('7393')));
  });
  test('the glyphs are real digit shapes: an 8 has more ink than a 1', () => {
    const a = decode(renderDigitsPng('1111')); const b = decode(renderDigitsPng('8888'));
    const dark = (d) => d.pixels.reduce((n, row) => n + row.filter((v) => v < 64).length, 0);
    assert.ok(dark(b) > dark(a) * 1.5, 'an 8 has more ink than a 1');
    assert.equal(a.width, b.width, 'every digit takes the same cell, so the image size never depends on the number');
  });
  test('rejects anything but digits', () => {
    assert.throws(() => renderDigitsPng('12a4'));
    assert.throws(() => renderDigitsPng(''));
  });
});
