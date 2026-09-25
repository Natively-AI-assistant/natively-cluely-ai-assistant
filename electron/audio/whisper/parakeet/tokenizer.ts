// electron/audio/whisper/parakeet/tokenizer.ts
import fs from 'fs';

export class ParakeetTokenizer {
  public vocab: Map<number, string> = new Map();
  public vocabSize: number = 0;
  public blankId: number = 8192;

  constructor(vocabSource: string, isFilePath: boolean = false) {
    let content = vocabSource;
    if (isFilePath) {
      content = fs.readFileSync(vocabSource, 'utf8');
    }

    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    for (const line of lines) {
      const lastSpace = line.lastIndexOf(' ');
      if (lastSpace === -1) continue;
      const token = line.slice(0, lastSpace);
      const id = parseInt(line.slice(lastSpace + 1), 10);
      if (!isNaN(id)) {
        this.vocab.set(id, token);
        if (token === '<blk>') {
          this.blankId = id;
        }
      }
    }
    this.vocabSize = this.vocab.size;
  }

  public decode(ids: number[]): string {
    const pieces: string[] = [];
    for (const id of ids) {
      if (id === this.blankId) continue;
      const token = this.vocab.get(id);
      if (!token) continue;
      // Skip special tags like <|nospeech|>, <pad>, <|startoftranscript|>, etc.
      if (token.startsWith('<|') && token.endsWith('|>')) continue;
      if (token === '<unk>' || token === '<pad>') continue;
      pieces.push(token);
    }
    // SentencePiece \u2581 -> space
    return pieces
      .join('')
      .replace(/\u2581/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();
  }
}
