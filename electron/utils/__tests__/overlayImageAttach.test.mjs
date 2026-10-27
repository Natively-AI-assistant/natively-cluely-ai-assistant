import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  imageExtFromBytes,
  imageExtFromPath,
  OVERLAY_DROP_IMAGE_PREFIX,
  OVERLAY_IMAGE_SUFFIXES,
  OVERLAY_PASTE_IMAGE_PREFIX,
} from '../overlayImageAttach.ts';
import { OVERLAY_IMAGE_NAME } from '../../../src/lib/overlayImageDrop.mjs';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

describe('overlayImageAttach (issue #351)', () => {
  test('file suffixes map to png/jpg/webp', () => {
    assert.equal(imageExtFromPath('/tmp/a.PNG'), 'png');
    assert.equal(imageExtFromPath('C:\\Users\\x\\shot.jpeg'), 'jpg');
    assert.equal(imageExtFromPath('diagram.webp'), 'webp');
    assert.equal(imageExtFromPath('notes.pdf'), null);
    assert.equal(imageExtFromPath(''), null);
  });

  test('the bytes name the image, whatever the file is called', () => {
    assert.equal(imageExtFromBytes(PNG), 'png');
    assert.equal(imageExtFromBytes(JPEG), 'jpg');
    assert.equal(imageExtFromBytes(WEBP), 'webp');
  });

  test('a non-image, a RIFF that is not WebP, and a truncated header are refused', () => {
    assert.equal(imageExtFromBytes(Buffer.from('just some text named photo.png')), null);
    assert.equal(imageExtFromBytes(Buffer.from('%PDF-1.7\n')), null);
    assert.equal(imageExtFromBytes(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')])), null);
    assert.equal(imageExtFromBytes(PNG.subarray(0, 4)), null);
    assert.equal(imageExtFromBytes(Buffer.alloc(0)), null);
  });

  test('the overlay filters drops by the same names main accepts', () => {
    for (const suffix of Object.keys(OVERLAY_IMAGE_SUFFIXES)) {
      assert.ok(OVERLAY_IMAGE_NAME.test(`x${suffix}`), `renderer refuses ${suffix}, which main accepts`);
    }
    for (const name of ['a.png', 'a.jpg', 'a.jpeg', 'a.webp', 'a.gif', 'a.heic', 'a.bmp', 'a.tiff', 'a.pdf']) {
      assert.equal(OVERLAY_IMAGE_NAME.test(name), imageExtFromPath(name) !== null, name);
    }
  });

  test('name prefixes are safe for addExternalImage', () => {
    assert.match(OVERLAY_PASTE_IMAGE_PREFIX, /^[a-z0-9-]+$/i);
    assert.match(OVERLAY_DROP_IMAGE_PREFIX, /^[a-z0-9-]+$/i);
  });
});
