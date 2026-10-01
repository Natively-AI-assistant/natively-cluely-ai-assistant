// electron/llm/__tests__/PhoneImageVisionEdge2026_09_27.test.mjs
//
// Photos and screenshots sent from the Phone Mirror page go to vision models at
// 2048 px on the long edge; captures of this machine's screen stay at 1536.
// A 2026-09-27 comparison on the default models: 2048 read small print that
// 1536 could not for Gemini 3.8 Flash and GPT-5.4 (Claude Sonnet 4.6 shrinks
// both to ~1.15 MP itself), while screen captures gain nothing and would cost
// GPT ~42% more image tokens.
//
// Phone images are recognised by the file-name prefix AppState.receivePhoneImage
// saves them with. EXECUTED here: LLMHelper.processImage (the path every
// built-in vision adapter uses) on real files, decoding what it would send.
//
// Platform-agnostic: node:path + sharp; the same on macOS and Windows.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = (f) => path.resolve(__dirname, '../../../dist-electron/electron', f);
const sharp = require('sharp');

const { LLMHelper } = require(process.env.LLM_HELPER_BUNDLE ? path.resolve(process.env.LLM_HELPER_BUNDLE) : dist('LLMHelper.js'));
const { PHONE_IMAGE_PREFIX, isPhoneImagePath, visionImageEdge } = require(
  process.env.PHONE_IMAGE_BUNDLE ? path.resolve(process.env.PHONE_IMAGE_BUNDLE) : dist('utils/phoneImage.js'),
);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-phone-edge-'));
const helper = () => Object.create(LLMHelper.prototype);
async function sentSize(file) {
  const { mimeType, data } = await LLMHelper.prototype.processImage.call(helper(), file);
  const meta = await sharp(Buffer.from(data, 'base64')).metadata();
  return { mimeType, w: meta.width, h: meta.height };
}
async function makeImage(name, width, height, format) {
  const file = path.join(dir, name);
  const img = sharp({ create: { width, height, channels: 3, background: { r: 30, g: 90, b: 200 } } });
  await (format === 'png' ? img.png() : img.jpeg()).toFile(file);
  return file;
}

after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('which images are phone images', () => {
  test('the saved-file prefix, on the file name only', () => {
    assert.equal(PHONE_IMAGE_PREFIX, 'phone-');
    assert.equal(isPhoneImagePath(path.join(dir, 'phone-1b2c.jpg')), true);
    assert.equal(isPhoneImagePath(path.join(dir, '1b2c.png')), false);
    // A folder called phone-… does not make a desktop capture a phone image.
    assert.equal(isPhoneImagePath(path.join(dir, 'phone-stuff', '1b2c.png')), false);
  });

  test('edge rule: phone 2048, screen 1536, "shrink when slow" 1024 for both', () => {
    assert.equal(visionImageEdge({ phoneImage: true, shrink: false }), 2048);
    assert.equal(visionImageEdge({ phoneImage: false, shrink: false }), 1536);
    assert.equal(visionImageEdge({ phoneImage: true, shrink: true }), 1024);
    assert.equal(visionImageEdge({ phoneImage: false, shrink: true }), 1024);
  });
});

describe('processImage sends phone images at 2048 px', () => {
  let phonePhoto, screenCapture, phoneScreenshot;
  before(async () => {
    phonePhoto = await makeImage(`${PHONE_IMAGE_PREFIX}photo.jpg`, 3000, 2000, 'jpeg');
    screenCapture = await makeImage('capture.png', 3000, 2000, 'png');
    phoneScreenshot = await makeImage(`${PHONE_IMAGE_PREFIX}shot.jpg`, 1192, 2048, 'jpeg');
  });

  test('a phone photo larger than 2048 → 2048 on the long edge', async () => {
    assert.deepEqual(await sentSize(phonePhoto), { mimeType: 'image/jpeg', w: 2048, h: 1365 });
  });

  test('a capture of this screen, same pixels → still 1536', async () => {
    assert.deepEqual(await sentSize(screenCapture), { mimeType: 'image/jpeg', w: 1536, h: 1024 });
  });

  test('a phone image already within 2048 is not shrunk (or enlarged)', async () => {
    assert.deepEqual(await sentSize(phoneScreenshot), { mimeType: 'image/jpeg', w: 1192, h: 2048 });
  });
});
