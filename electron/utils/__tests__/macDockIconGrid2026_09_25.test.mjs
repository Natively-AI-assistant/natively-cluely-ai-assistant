// The Natively Dock tile drew ~20% larger than every other app's, with a
// different corner shape and none of the Liquid Glass look.
//
// macOS draws each icon canvas at the same tile size and expects Apple's grid
// inside it (an 824px body on 1024, ~80%); on macOS 26+ system icons are also
// Liquid Glass (continuous-corner shape, specular rim, Default/Dark/Clear/Tinted
// styles). Natively shipped full-bleed flat art (~98% of its canvas) in BOTH
// places the Dock reads it:
//   - the bundle icon (pinned / not-running tile)
//   - the PNG AppState._applyDisguise('none') handed app.dock.setIcon() at every
//     launch, which replaced the running tile (was assets/icon.png)
// Now the bundle icon is the Icon Composer document assets/Natively.icon
// (electron-builder -> actool -> Assets.car), the packaged app no longer
// overwrites it at launch, and every flat bitmap (natively.icns, dock-icon.png)
// is that icon as macOS itself draws it — the setIcon() bitmaps (dock-icon.png,
// the disguise icons) 1% larger, because the Dock drew them ~1% smaller than
// their neighbours (Evin, 2026-09-25). assets/icon.png stays full-bleed: the
// renderer's permissions onboarding imports it.
//
// Platform is injected, so the darwin and win32 branches run on either OS.
// Nothing here needs actool/Xcode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const { disguiseIconRelativePath, shouldSetMacDockIcon } = require(path.join(repoRoot, 'dist-electron/electron/utils/disguiseIcon.js'));

// Minimal PNG decoder: 8-bit RGBA, non-interlaced (what the icon pipeline writes).
function decodePngAlpha(buf) {
  assert.equal(buf.readUInt32BE(0), 0x89504e47, 'not a PNG');
  let off = 8;
  let width = 0, height = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'bit depth');
      assert.equal(data[9], 6, 'colour type RGBA');
      assert.equal(data[12], 0, 'non-interlaced');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = 0; break;
        case 1: v = a; break;
        case 2: v = b; break;
        case 3: v = (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`bad PNG filter ${filter}`);
      }
      row[x] = (src[x] + v) & 0xff;
    }
  }
  return { width, height, alphaAt: (x, y) => px[(y * width + x) * bpp + 3] };
}

// Fraction of the canvas the opaque body covers, and its centre offset.
function bodyGeometry(pngBuf) {
  const { width, height, alphaAt } = decodePngAlpha(pngBuf);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (alphaAt(x, y) >= 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  assert.ok(x1 >= 0, 'icon is fully transparent');
  return {
    width,
    height,
    bodyW: (x1 + 1 - x0) / width,
    bodyH: (y1 + 1 - y0) / height,
    centreDx: ((x0 + x1 + 1) / 2 - width / 2) / width,
    centreDy: ((y0 + y1 + 1) / 2 - height / 2) / height,
  };
}

// Walks the icns chunk list (4-byte type, 4-byte big-endian length incl. header).
function icnsChunk(buf, wanted) {
  assert.equal(buf.toString('latin1', 0, 4), 'icns', 'not an icns file');
  let off = 8;
  while (off + 8 <= buf.length) {
    const type = buf.toString('latin1', off, off + 4);
    const len = buf.readUInt32BE(off + 4);
    if (type === wanted) return buf.subarray(off + 8, off + len);
    off += len;
  }
  return null;
}

function assertOnAppleGrid(label, g) {
  // Apple's grid is 824/1024 = 80.5% (~81.6% in the 128/256px layouts), +1% on the
  // setIcon() bitmaps; the alpha>=128 cut ignores the soft drop shadow.
  assert.ok(g.bodyW >= 0.79 && g.bodyW <= 0.84, `${label}: body width ${(g.bodyW * 100).toFixed(1)}% of canvas, want ~80.5-83%`);
  assert.ok(g.bodyH >= 0.79 && g.bodyH <= 0.84, `${label}: body height ${(g.bodyH * 100).toFixed(1)}% of canvas, want ~80.5-83%`);
  assert.ok(Math.abs(g.centreDx) <= 0.01 && Math.abs(g.centreDy) <= 0.01, `${label}: body off-centre by (${g.centreDx}, ${g.centreDy})`);
}

test('darwin: the undisguised Dock icon is the macOS-drawn render, not full-bleed icon.png', () => {
  assert.equal(disguiseIconRelativePath('none', 'darwin'), 'assets/icons/mac/dock-icon.png');
});

test('win32: every icon path is unchanged (taskbar .ico and win fake icons)', () => {
  assert.equal(disguiseIconRelativePath('none', 'win32'), 'assets/icons/win/icon.ico');
  assert.equal(disguiseIconRelativePath('terminal', 'win32'), 'assets/fakeicon/win/terminal.png');
  assert.equal(disguiseIconRelativePath('settings', 'win32'), 'assets/fakeicon/win/settings.png');
  assert.equal(disguiseIconRelativePath('activity', 'win32'), 'assets/fakeicon/win/activity.png');
});

test('darwin: disguise modes keep their mac fake icons', () => {
  assert.equal(disguiseIconRelativePath('terminal', 'darwin'), 'assets/fakeicon/mac/terminal.png');
  assert.equal(disguiseIconRelativePath('settings', 'darwin'), 'assets/fakeicon/mac/settings.png');
  assert.equal(disguiseIconRelativePath('activity', 'darwin'), 'assets/fakeicon/mac/activity.png');
});

test('an out-of-union mode falls back to the real app icon, never a fake one', () => {
  assert.equal(disguiseIconRelativePath('bogus', 'darwin'), 'assets/icons/mac/dock-icon.png');
  assert.equal(disguiseIconRelativePath('bogus', 'win32'), 'assets/icons/win/icon.ico');
});

test('every resolved icon exists under assets/ (shipped by the assets/ extraResources copy)', () => {
  for (const platform of ['darwin', 'win32']) {
    for (const mode of ['none', 'terminal', 'settings', 'activity']) {
      const rel = disguiseIconRelativePath(mode, platform);
      assert.ok(rel.startsWith('assets/'), `${platform}/${mode}: ${rel} is outside assets/`);
      assert.ok(fs.existsSync(path.join(repoRoot, rel)), `${platform}/${mode}: ${rel} is missing`);
    }
  }
});

test('the running Dock tile (setIcon PNG) sits on Apple\'s icon grid', () => {
  const rel = disguiseIconRelativePath('none', 'darwin');
  assertOnAppleGrid(rel, bodyGeometry(fs.readFileSync(path.join(repoRoot, rel))));
});

test('the bundle icon (natively.icns, 1024 rep) sits on Apple\'s icon grid; the Dock PNG is it +1%', () => {
  const ic10 = icnsChunk(fs.readFileSync(path.join(repoRoot, 'assets/natively.icns')), 'ic10');
  assert.ok(ic10, 'natively.icns has no ic10 (512@2x) representation');
  const bundle = bodyGeometry(ic10);
  assert.equal(bundle.width, 1024);
  assertOnAppleGrid('natively.icns ic10', bundle);
  // Same icon, but the Dock draws a setIcon() bitmap ~1% smaller than a bundle icon,
  // so the running-tile PNG carries +1% to land at the size of its neighbours.
  const dock = bodyGeometry(fs.readFileSync(path.join(repoRoot, disguiseIconRelativePath('none', 'darwin'))));
  for (const [b, d, axis] of [[bundle.bodyW, dock.bodyW, 'width'], [bundle.bodyH, dock.bodyH, 'height']]) {
    const ratio = d / b;
    assert.ok(ratio >= 1.004 && ratio <= 1.02, `dock/bundle body ${axis} ratio ${ratio.toFixed(4)}, want ~1.01`);
  }
});

// The disguise icons are the real system apps' icons as macOS 27 draws them (+1%,
// like dock-icon.png), so a disguised tile matches its neighbours; nativeImage
// picks up the @2x pair.
test('darwin: each disguise icon is 128px with a 256px @2x pair, on Apple\'s icon grid', () => {
  for (const mode of ['terminal', 'settings', 'activity']) {
    const rel = disguiseIconRelativePath(mode, 'darwin');
    const one = bodyGeometry(fs.readFileSync(path.join(repoRoot, rel)));
    const two = bodyGeometry(fs.readFileSync(path.join(repoRoot, rel.replace(/\.png$/, '@2x.png'))));
    assert.equal(one.width, 128, `${rel} width`);
    assert.equal(two.width, 256, `${rel} @2x width`);
    assertOnAppleGrid(rel, one);
    assertOnAppleGrid(`${rel} @2x`, two);
  }
});

test('package.json builds the mac bundle icon from the Icon Composer document; Windows keeps its .ico', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.build.mac.icon, 'assets/Natively.icon');
  assert.equal(pkg.build.win.icon, 'assets/icons/win/icon.ico');
});

test('assets/Natively.icon is a well-formed Icon Composer document whose layers all exist', () => {
  const dir = path.join(repoRoot, 'assets/Natively.icon');
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'icon.json'), 'utf8'));
  assert.deepEqual(doc['supported-platforms']?.squares, ['macOS']);
  const layers = (doc.groups ?? []).flatMap((g) => g.layers ?? []);
  assert.ok(layers.length > 0, 'icon.json has no layers');
  for (const layer of layers) {
    assert.ok(layer['image-name'], `layer ${layer.name} has no image-name`);
    assert.ok(fs.existsSync(path.join(dir, 'Assets', layer['image-name'])), `Assets/${layer['image-name']} is missing`);
  }
});

test('darwin: a packaged, undisguised app never overwrites its live bundle icon', () => {
  assert.equal(shouldSetMacDockIcon('none', true, false), false);
  assert.equal(shouldSetMacDockIcon('bogus', true, false), false);
});

test('darwin: disguises always paint; returning from one repaints the static render; dev always paints', () => {
  for (const mode of ['terminal', 'settings', 'activity']) {
    assert.equal(shouldSetMacDockIcon(mode, true, false), true, mode);
    assert.equal(shouldSetMacDockIcon(mode, false, false), true, mode);
  }
  assert.equal(shouldSetMacDockIcon('none', true, true), true, 'packaged, back from a disguise');
  assert.equal(shouldSetMacDockIcon('none', false, false), true, 'dev: the bundle icon is Electron\'s');
});

test('AppState._applyDisguise resolves its icon through the helpers and gates setIcon', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
  const start = src.indexOf('private _applyDisguise(');
  const end = src.indexOf('// 5. Update Window Titles', start);
  assert.ok(start > 0 && end > start, '_applyDisguise not found');
  const body = src.slice(start, end);
  assert.ok(body.includes('disguiseIconRelativePath(mode, process.platform)'), '_applyDisguise no longer uses the path helper');
  assert.ok(!body.includes('"assets/icon.png"') && !body.includes("'assets/icon.png'"), '_applyDisguise hard-codes the full-bleed icon.png again');
  const setIconAt = body.indexOf('app.dock.setIcon(image)');
  const gateAt = body.indexOf('shouldSetMacDockIcon(mode, app.isPackaged, this._macDockIconOverridden)');
  assert.ok(gateAt > 0 && setIconAt > gateAt, 'app.dock.setIcon must sit behind shouldSetMacDockIcon');
  assert.ok(body.indexOf('this._macDockIconOverridden = true', setIconAt) > setIconAt, 'the override flag must be set after a real setIcon');
});
