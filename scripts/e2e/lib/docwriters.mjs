// scripts/e2e/lib/docwriters.mjs
// Render plain-text resume/JD content into REAL .pdf / .docx / .txt that parse
// through the app's actual DocumentReader (pdf-parse for PDF, mammoth for docx).
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import fs from 'node:fs';

/** Write a multi-page PDF from lines of text. Real pdf-parse-readable output. */
export function writePdf(filePath, lines, opts = {}) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 48;
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const maxW = pageW - margin * 2;
  const fontSize = opts.fontSize || 10;
  const lineH = fontSize * 1.35;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);
  let y = margin;
  for (const raw of lines) {
    const wrapped = doc.splitTextToSize(String(raw), maxW);
    for (const w of wrapped) {
      if (y + lineH > pageH - margin) { doc.addPage(); y = margin; }
      doc.text(w, margin, y);
      y += lineH;
    }
  }
  fs.writeFileSync(filePath, Buffer.from(doc.output('arraybuffer')));
}

/** Write a real .docx (OOXML zip) from paragraphs; mammoth reads it. */
export async function writeDocx(filePath, paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join('');
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  fs.writeFileSync(filePath, buf);
}

export function writeTxt(filePath, lines) {
  fs.writeFileSync(filePath, Array.isArray(lines) ? lines.join('\n') : String(lines), 'utf8');
}
