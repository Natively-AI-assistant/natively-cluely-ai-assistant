import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs'; import path from 'node:path';
const exec = promisify(execFile);
const OUT = 'transcripts';
const RETRY = {
  'call-center': ['customer service call center training example calls', 'inbound support call role play full'],
  'looking-for-work': ['full behavioral interview questions and answers mock', 'job interview simulation entire interview'],
  'general': ['long form technical podcast interview engineering', 'software engineering podcast conversation full episode'],
};
function vttToText(file) {
  const raw = fs.readFileSync(file, 'utf8'); const lines = [];
  for (let ln of raw.split('\n')) {
    if (/^(WEBVTT|Kind:|Language:|NOTE)/.test(ln) || ln.includes('-->') || !ln.trim()) continue;
    ln = ln.replace(/<[^>]+>/g, '').trim(); if (ln) lines.push(ln);
  }
  const seen = new Set();
  return lines.filter(l => seen.has(l) ? false : (seen.add(l), true)).join(' ').replace(/\s+/g,' ').trim();
}
for (const [mode, queries] of Object.entries(RETRY)) {
  for (const q of queries) {
    const tag = `retry-${mode}-${queries.indexOf(q)}`;
    try {
      await exec('yt-dlp', ['--skip-download','--write-auto-subs','--write-subs','--sub-lang','en.*','--sub-format','vtt',
        '--match-filter','duration > 900 & duration < 7200','-o',`/tmp/${tag}.%(ext)s`,`ytsearch3:${q}`], { timeout: 300000 });
    } catch {}
    const f = fs.readdirSync('/tmp').filter(x => x.startsWith(tag) && x.endsWith('.vtt'))[0];
    if (!f) continue;
    const t = vttToText(path.join('/tmp', f));
    if (t.split(' ').length > 2500) {
      fs.writeFileSync(path.join(OUT, `${mode}.raw.txt`), t);
      console.log(`${mode.padEnd(20)} ${String(t.split(' ').length).padStart(6)} words  (replaced)`);
      break;
    }
  }
}
