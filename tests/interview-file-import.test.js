const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Module = require('node:module');
const { jsPDF } = require('jspdf');

const originalModuleLoad = Module._load;
Module._load = function mockElectron(request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => os.tmpdir() } };
  }
  return originalModuleLoad.call(this, request, parent, isMain);
};
const { InterviewContextManager } = require('../dist-electron/electron/services/InterviewContextManager.js');
Module._load = originalModuleLoad;

test('interview imports accept bounded text files and reject unsafe shapes', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-interview-import-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const manager = InterviewContextManager.getInstance();
  const textPath = path.join(tempDir, 'resume.txt');
  fs.writeFileSync(textPath, '  Revenue workflow experience  ', 'utf8');
  const imported = await manager.extractFile(textPath);
  assert.equal(imported.text, 'Revenue workflow experience');
  assert.equal(imported.fileName, 'resume.txt');

  const pdfPath = path.join(tempDir, 'resume.pdf');
  const pdf = new jsPDF();
  pdf.text('Enterprise seller adoption', 10, 10);
  fs.writeFileSync(pdfPath, Buffer.from(pdf.output('arraybuffer')));
  const importedPdf = await manager.extractFile(pdfPath);
  assert.match(importedPdf.text, /Enterprise seller adoption/);

  const unsupportedPath = path.join(tempDir, 'resume.json');
  fs.writeFileSync(unsupportedPath, '{}', 'utf8');
  await assert.rejects(() => manager.extractFile(unsupportedPath), /Unsupported file type/);

  const oversizedPath = path.join(tempDir, 'large.txt');
  fs.writeFileSync(oversizedPath, '');
  fs.truncateSync(oversizedPath, (10 * 1024 * 1024) + 1);
  await assert.rejects(() => manager.extractFile(oversizedPath), /10 MB interview import limit/);

  await assert.rejects(() => manager.extractFile(tempDir), /Unsupported file type|regular file/);
});
