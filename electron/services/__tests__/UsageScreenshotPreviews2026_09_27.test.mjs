// Screenshot previews in the Meeting Notes Usage tab (2026-09-27).
//
// The screenshots an answer used are temporary files (ScreenshotHelper keeps five
// per queue and deletes the rest), so a preview is made when the usage entry is
// logged (usagePreviews.ts), lands on that entry as `images`, and is stored in
// ai_interactions.metadata_json (usageMetadata.ts). Old rows keep reading as before.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/', p)).href;

const { makeUsagePreviews, USAGE_PREVIEW_MAX_EDGE, USAGE_PREVIEW_MAX_IMAGES } = await import(dist('services/meeting/usagePreviews.js'));
const { encodeUsageMetadata, decodeUsageMetadata } = await import(dist('db/usageMetadata.js'));
const { SessionTracker } = await import(dist('SessionTracker.js'));
const { default: sharp } = await import('sharp');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-usage-previews-'));
async function screenshot(name, width, height, alpha = false) {
    const file = path.join(dir, name);
    await sharp({ create: { width, height, channels: alpha ? 4 : 3, background: alpha ? { r: 20, g: 40, b: 60, alpha: 0.5 } : { r: 20, g: 40, b: 60 } } }).png().toFile(file);
    return file;
}
const decode = async (dataUrl) => sharp(Buffer.from(dataUrl.replace(/^data:image\/jpeg;base64,/, ''), 'base64')).metadata();

describe('makeUsagePreviews', () => {
    test('a Retina-size screenshot becomes a JPEG no larger than the preview edge', async () => {
        const file = await screenshot('big.png', 2880, 1800, true);
        const [preview] = await makeUsagePreviews([file]);
        assert.match(preview, /^data:image\/jpeg;base64,/);
        const meta = await decode(preview);
        assert.equal(meta.format, 'jpeg');
        assert.equal(meta.width, USAGE_PREVIEW_MAX_EDGE);
        assert.equal(meta.height, Math.round(1800 * USAGE_PREVIEW_MAX_EDGE / 2880));
    });

    test('a small screenshot is not enlarged', async () => {
        const file = await screenshot('small.png', 400, 300);
        const meta = await decode((await makeUsagePreviews([file]))[0]);
        assert.deepEqual([meta.width, meta.height], [400, 300]);
    });

    test('files already deleted are skipped; duplicates count once; at most the cap', async () => {
        const a = await screenshot('a.png', 300, 200);
        const b = await screenshot('b.png', 300, 200);
        assert.equal((await makeUsagePreviews([a, path.join(dir, 'gone.png'), a, b])).length, 2);
        const many = await Promise.all(Array.from({ length: USAGE_PREVIEW_MAX_IMAGES + 2 }, (_, i) => screenshot(`m${i}.png`, 120, 80)));
        assert.equal((await makeUsagePreviews(many)).length, USAGE_PREVIEW_MAX_IMAGES);
        assert.deepEqual(await makeUsagePreviews(undefined), []);
        assert.deepEqual(await makeUsagePreviews([]), []);
    });
});

describe('usage metadata', () => {
    const img = 'data:image/jpeg;base64,/9j/AAAA';

    test('rows without previews keep the old bare-array form', () => {
        assert.equal(encodeUsageMetadata({ type: 'chat', answer: 'x' }), null);
        assert.equal(encodeUsageMetadata({ type: 'assist', items: ['a', 'b'] }), '["a","b"]');
        assert.equal(encodeUsageMetadata({ type: 'followup_questions', answer: ['q1', 'q2'] }), '["q1","q2"]');
        assert.deepEqual(decodeUsageMetadata('["a","b"]'), { items: ['a', 'b'] });
    });

    test('previews are stored alongside items and read back', () => {
        const withImages = encodeUsageMetadata({ type: 'assist', answer: 'x', images: [img] });
        assert.deepEqual(decodeUsageMetadata(withImages), { images: [img] });
        const both = encodeUsageMetadata({ type: 'followup_questions', answer: ['q1'], images: [img] });
        assert.deepEqual(decodeUsageMetadata(both), { items: ['q1'], images: [img] });
    });

    test('anything that is not an image data URL is never stored or returned', () => {
        assert.equal(encodeUsageMetadata({ type: 'chat', images: ['/Users/me/shot.png', 'javascript:alert(1)'] }), null);
        assert.deepEqual(decodeUsageMetadata(JSON.stringify({ images: ['file:///etc/passwd', img] })), { images: [img] });
        assert.deepEqual(decodeUsageMetadata('{not json'), {});
        assert.deepEqual(decodeUsageMetadata(null), {});
        assert.deepEqual(decodeUsageMetadata('"text"'), {});
    });
});

describe('SessionTracker usage entries', () => {
    const settle = async (entry) => {
        for (let i = 0; i < 100 && !entry.images; i++) await new Promise(r => setTimeout(r, 20));
        return entry;
    };

    test('logUsage with screenshots: the entry gains previews and never keeps the file paths', async () => {
        const file = await screenshot('chat.png', 1600, 1000);
        const session = new SessionTracker();
        session.logUsage('chat', 'What is on my screen?', 'A settings page.', [file]);
        const [entry] = session.getFullUsage();
        assert.equal('imagePaths' in entry, false);
        await settle(entry);
        assert.equal(entry.images?.length, 1);
        assert.match(entry.images[0], /^data:image\/jpeg;base64,/);
    });

    test('pushUsage keeps the caller\'s object and fills it in place', async () => {
        const file = await screenshot('wta.png', 800, 500);
        const session = new SessionTracker();
        const pushed = { type: 'assist', timestamp: Date.now(), question: 'What to Answer', answer: 'Say yes.', imagePaths: [file] };
        session.pushUsage(pushed);
        assert.equal(session.getFullUsage()[0], pushed);
        await settle(pushed);
        assert.equal(pushed.images?.length, 1);
        assert.equal('imagePaths' in pushed, false);
    });

    test('an entry without screenshots is unchanged', () => {
        const session = new SessionTracker();
        session.logUsage('chat', 'Hi', 'Hello');
        const [entry] = session.getFullUsage();
        assert.equal(entry.images, undefined);
        assert.equal('imagePaths' in entry, false);
    });
});
