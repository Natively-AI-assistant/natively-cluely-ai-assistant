import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

const mainSrc = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const ipcSrc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

describe('STT reconfigure serialization remains intact', () => {
  it('declares and uses the serialization chain', () => {
    assert.match(mainSrc, /_sttReconfigureChain\s*:\s*Promise<void>/);
    const pubStart = mainSrc.indexOf('public async reconfigureSttProvider(');
    assert.ok(pubStart >= 0, 'public reconfigureSttProvider must exist');
    const pubBody = mainSrc.slice(pubStart, pubStart + 1200);
    assert.match(pubBody, /_sttReconfigureChain/);
    assert.match(pubBody, /_doReconfigureSttProvider\s*\(/);
  });

  it('serializes concurrent reconfigure calls behaviorally', async () => {
    let chain = Promise.resolve();
    let active = 0;
    let maxActive = 0;
    const run = () => {
      const r = chain.then(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((res) => setTimeout(res, 5));
        active--;
      });
      chain = r.then(() => undefined, () => undefined);
      return r;
    };

    await Promise.all([run(), run(), run(), run()]);
    assert.equal(maxActive, 1);
  });
});

describe('public OpenOffer build removes hosted Natively key activation path', () => {
  it('set-natively-api-key is a compatibility stub and does not activate license/STT', () => {
    const start = ipcSrc.indexOf("safeHandle('set-natively-api-key'");
    assert.ok(start >= 0, 'set-natively-api-key compatibility handler must exist');
    const end = ipcSrc.indexOf("safeHandle('get-natively-pricing'", start);
    const handlerBody = ipcSrc.slice(start, end > start ? end : start + 1200);
    assert.match(handlerBody, /Hosted API removed in this build/);
    assert.doesNotMatch(handlerBody, /activateWithApiKey/);
    assert.doesNotMatch(handlerBody, /setSttProvider\(\s*['"]natively['"]/);
  });
});
