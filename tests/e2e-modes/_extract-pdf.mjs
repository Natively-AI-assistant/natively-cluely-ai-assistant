import { PDFParse } from 'pdf-parse';
import fs from 'node:fs';
const path = process.argv[2];
const buf = fs.readFileSync(path);
const parser = new PDFParse({ data: buf });
const res = await parser.getText();
// emit [Page N] markers like the app does
let out = '';
if (res.pages && res.pages.length) {
  res.pages.forEach((p, i) => { out += `[Page ${i+1}]\n${p.text || ''}\n`; });
} else { out = res.text || ''; }
process.stdout.write(JSON.stringify({ chars: out.length, pages: res.total || res.pages?.length || 0, text: out }));
