// Real public lecture captions (YouTube json3, human-authored English captions) ->
// (a) benchmark/transcripts/src/<ID>.txt  (numbered-line format used for fact sheets)
// (b) benchmark/transcripts/<ID>.segments.json  (Natively TranscriptSegment[] with REAL timing)
// Segmentation approximates STT finalization: caption events are merged and split at
// sentence boundaries (max ~45 words). Captions carry no diarization, so every line is the
// system-audio channel speaker_1 (lecturer; audience Q&A is also on speaker_1).
import fs from 'node:fs'
import path from 'node:path'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const [videoId, id, title] = process.argv.slice(2)
const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'raw/youtube', `${videoId}.en.json3`), 'utf8'))
const words = []
for (const ev of j.events || []) {
  if (!ev.segs) continue
  const text = ev.segs.map(s => s.utf8).join('').replace(/\n/g, ' ')
  for (const w of text.split(/\s+/).filter(Boolean)) words.push({ w: w.replace(/^>>+/, '').trim(), t: ev.tStartMs + (ev.dDurationMs || 0) })
}
const ACRONYMS = new Set(['FDA','NIH','HIV','AIDS','US','USA','DNA','RNA','IRB','IRBS','CDC','PHD','MD','OK','TV','UK','NCI','HHS','OHRP','CFR','IPPCR','ICH','GCP','WHO','II','III','IV','COX','KAPLAN','MEIER'])
// Broadcast captions are ALL CAPS; Natively STT emits normal casing. Sentence-case the text,
// keep a small acronym list upper, restore standalone "I". Proper nouns become lowercase
// (documented limitation of this source).
let sentenceStart = true
for (const x of words) {
  const core = x.w.replace(/[^A-Za-z']/g, '')
  let w = x.w
  if (/[A-Z]/.test(w) && w === w.toUpperCase()) {
    if (ACRONYMS.has(core.toUpperCase()) && !['KAPLAN','MEIER','COX'].includes(core.toUpperCase())) w = w
    else if (['KAPLAN','MEIER','COX'].includes(core.toUpperCase())) w = w.charAt(0) + w.slice(1).toLowerCase()
    else if (/^I('|$)/.test(core) && core.length <= 3 && /^I('M|'LL|'VE|'D)?$/.test(core)) w = w.charAt(0) + w.slice(1).toLowerCase()
    else { w = w.toLowerCase(); if (sentenceStart) w = w.replace(/[a-z]/, c => c.toUpperCase()) }
  }
  x.w = w
  if (w) sentenceStart = /[.?!]["')\]]?$/.test(w)
}
const clean = words.filter(x => x.w && !/^\[.*\]$/.test(x.w))
const lines = []
let cur = []
for (const x of clean) {
  cur.push(x)
  const end = /[.?!]["')\]]?$/.test(x.w)
  if ((end && cur.length >= 6) || cur.length >= 45) { lines.push(cur); cur = [] }
}
if (cur.length) lines.push(cur)
const start = Date.UTC(2026, 8, 15, 14, 0, 0)
const header = [`# id: ${id}`, `# title: ${title}`, `# source: https://www.youtube.com/watch?v=${videoId} (NIH VideoCast, human-authored English captions)`, `# S1: lecturer / audience (captions have no diarization)`]
const txt = header.concat(lines.map(l => `S1: ${l.map(x => x.w).join(' ')}`)).join('\n') + '\n'
fs.writeFileSync(path.join(ROOT, 'transcripts/src', `${id}.txt`), txt)
const segments = lines.map(l => ({ speaker: 'interviewer', speakerId: 'speaker_1', text: l.map(x => x.w).join(' '), timestamp: start + l[l.length - 1].t, final: true, confidence: 0.91, origin: 'stt' }))
const nWords = clean.length
const durationMs = clean.length ? clean[clean.length - 1].t : 0
fs.writeFileSync(path.join(ROOT, 'transcripts', `${id}.segments.json`), JSON.stringify({ id, segments, words: nWords, speakerCount: 1, durationMs, startEpochMs: start, source: `https://www.youtube.com/watch?v=${videoId}` }, null, 1))
console.log(`${id}: lines=${lines.length} words=${nWords} duration_min=${(durationMs / 60000).toFixed(1)}`)
