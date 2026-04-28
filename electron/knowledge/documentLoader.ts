import fs from 'fs';
import path from 'path';

export async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.pdf') {
    const { PDFParse } = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return (result?.text ?? '').trim();
    } finally {
      try { await parser.destroy(); } catch { /* ignore */ }
    }
  }

  if (ext === '.docx' || ext === '.doc') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return (result?.value ?? '').trim();
  }

  return fs.readFileSync(filePath, 'utf8').trim();
}
