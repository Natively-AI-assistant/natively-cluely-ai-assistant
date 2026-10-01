// The Meet reader (natively-browser/src/meet-dom.ts) against a page shaped like
// the real Google Meet, as measured in a live three-person call on 2026-09-27:
//   - a camera tile is [data-participant-id][data-tile-media-id] with equal ids,
//     its name in span.notranslate;
//   - its voice indicator ([jsname="QgSmzd"]) switches classes while that
//     person talks (bursts at 100–106 s and 122–128 s followed the scripted
//     turns) and holds still otherwise;
//   - the user's own tile has the self-view controls (jsname nsKqzb, Ac69Jc);
//   - with captions on, a "Captions" region prefixes utterances with names
//     ("Gojo Satoru Hi, this is Gojo…", then "natively Thanks Gojo!…").
// Meet's own markup can change without notice; this pins OUR reading of it.
//
// Runs the real code in Electron's Chromium (a real DOM and MutationObserver).
// Run: npm run test:meet-dom
import { app, BrowserWindow } from 'electron';
import { writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSync } from 'esbuild';

const READER = resolve(process.cwd(), 'natively-browser/src/meet-dom.ts');
const bundle = buildSync({ entryPoints: [READER], bundle: true, format: 'iife', globalName: '__meetDom', target: 'chrome114', write: false }).outputFiles[0].text;

const tile = (id, name, { self = false, media = id } = {}) => `
  <div data-participant-id="spaces/X/devices/${id}" data-requested-participant-id="spaces/X/devices/${id}" data-tile-media-id="spaces/X/devices/${media}">
    <div class="knW4sf"><div class="DYfzY cYKTje gjg47c" jsname="QgSmzd"></div></div>
    <div class="IisKdb GF8M7d gjg47c YFyDbd iPFm3e VeFZv" jsname="QgSmzd" id="ind-${id}${media !== id ? '-share' : ''}"></div>
    ${self ? '<button jsname="nsKqzb" aria-label="Reframe"></button><button jsname="Ac69Jc" aria-label="Backgrounds and effects"></button>' : `<button aria-label="Pin ${name} to your main screen"></button>`}
    <div class="ne2Ple" aria-hidden="true">${name}</div><span class="notranslate">${name}</span>
  </div>`;

const page = `<!doctype html><html><body>
  <div role="region" aria-label="Meeting grid">
    ${tile(372, 'natively')}${tile(373, 'Gojo Satoru')}${tile(367, 'Evin John Ignatious', { self: true })}
    ${tile(373, 'Gojo Satoru (Presentation)', { media: 900 })}
  </div>
  <script>${bundle}</script>
</body></html>`;

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };

app.whenReady().then(async () => {
  const file = join(tmpdir(), `natively-meet-dom-${process.pid}.html`);
  writeFileSync(file, page);
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  const js = (code) => win.webContents.executeJavaScript(code);
  try {
    await win.loadFile(file);
    await js(`window.r = __meetDom.createMeetReader(document); true`);
    const read = () => js(`JSON.stringify(window.r.read())`).then(JSON.parse);
    const speakingNow = async () => (await read()).filter((p) => p.speaking).map((p) => p.name);

    const first = await read();
    ok(JSON.stringify(first.map((p) => p.name)) === JSON.stringify(['natively', 'Gojo Satoru', 'Evin John Ignatious']), `names from the camera tiles, not the screen share (${first.map((p) => p.name).join(', ')})`);
    ok(first.find((p) => p.name === 'Evin John Ignatious')?.self === true && first.filter((p) => p.self).length === 1, 'the user\'s own tile is marked self, and only it');
    ok((await speakingNow()).length === 0, 'nobody speaking in silence');

    // Gojo talks: the indicator steps through audio levels for 3 s.
    await js(`window.flip = setInterval(() => { const el = document.getElementById('ind-373'); el.className = el.className.includes('Oaajhc') ? 'IisKdb GF8M7d HX2H7 MNVeFb kT2pkb VeFZv' : 'IisKdb GF8M7d Oaajhc MNVeFb kT2pkb VeFZv'; }, 120); true`);
    await new Promise((r) => setTimeout(r, 1500));
    ok(JSON.stringify(await speakingNow()) === JSON.stringify(['Gojo Satoru']), 'while Gojo\'s indicator moves, Gojo (and only Gojo) is speaking');
    // The share tile's indicator moving is not a second Gojo.
    await js(`document.getElementById('ind-373-share').className = 'IisKdb x'; true`);
    ok((await read()).length === 3, 'a screen share never adds a person');
    await js(`clearInterval(window.flip); true`);
    await new Promise((r) => setTimeout(r, 1000));
    ok((await speakingNow()).length === 0, 'silence again within a second of the indicator stopping');

    // An unrelated class change elsewhere in the tile (hover styling) is not speech.
    await js(`document.querySelector('[data-participant-id$="/372"] .knW4sf').className = 'knW4sf hovered'; true`);
    ok((await speakingNow()).length === 0, 'only the voice indicator counts');

    // Captions on: they already show earlier lines (not speech now) ...
    await js(`document.body.insertAdjacentHTML('beforeend', '<div role="region" aria-label="Captions" id="cc"><div><span>Gojo Satoru</span><div>Hi, this is Gojo.</div></div></div>'); true`);
    ok((await speakingNow()).length === 0, 'captions already on screen are not speech now');
    // ... then natively's words arrive in the captions (no indicator movement at all:
    // the signal that still updates in a background tab).
    await js(`document.getElementById('cc').insertAdjacentHTML('beforeend', '<div><span>natively</span><div>Thanks Gojo! The timeline works</div></div>'); true`);
    ok(JSON.stringify(await speakingNow()) === JSON.stringify(['natively']), 'a new captioned utterance names its speaker');
    await js(`document.querySelector('#cc > div:last-child > div').textContent += ' for me.'; true`);
    ok(JSON.stringify(await speakingNow()) === JSON.stringify(['natively']), 'still natively while the caption grows');
    await new Promise((r) => setTimeout(r, 1700));
    ok((await speakingNow()).length === 0, 'a caption that stopped growing is not speech');
  } catch (err) {
    console.error(err);
    failures++;
  } finally {
    rmSync(file, { force: true });
    win.destroy();
    console.log(failures ? `${failures} FAILED` : 'ALL PASS');
    app.exit(failures ? 1 : 0);
  }
});
