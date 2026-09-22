// Converts an authored transcript (benchmark/transcripts/src/<ID>.txt, `S<n>: text` lines)
// into Natively's real TranscriptSegment[] shape (electron/SessionTracker.ts):
//   { speaker, speakerId?, text, timestamp, final, confidence?, origin }
//
// Channel mapping mirrors production capture:
//   S0 (microphone)     -> speaker 'user'                          (normalizer: "Me")
//   S1..Sn (system audio, diarized) -> speaker 'interviewer', speakerId 'speaker_<n>'
//                                                                  (normalizer: "Speaker <n>")
// Timestamps are epoch ms stamped at segment finalization (SessionTracker uses Date.now()),
// paced at 150 words/minute plus a 600ms turn gap.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const WPM = 150
const GAP_MS = 600

export function convert(id, { startEpochMs = Date.UTC(2026, 8, 15, 14, 0, 0) } = {}) {
  const src = fs.readFileSync(path.join(ROOT, 'transcripts/src', `${id}.txt`), 'utf8')
  const segments = []
  let t = startEpochMs
  const speakers = new Set()
  let words = 0
  for (const line of src.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('#')) continue
    const m = /^S(\d+):\s*(.*)$/.exec(line)
    if (!m) throw new Error(`${id}: unparseable line: ${line.slice(0, 80)}`)
    const n = Number(m[1])
    const text = m[2].trim()
    if (!text) continue
    const w = text.split(/\s+/).length
    words += w
    t += Math.round((w / WPM) * 60000) + GAP_MS
    speakers.add(n)
    segments.push(n === 0
      ? { speaker: 'user', text, timestamp: t, final: true, confidence: 0.93, origin: 'stt' }
      : { speaker: 'interviewer', speakerId: `speaker_${n}`, text, timestamp: t, final: true, confidence: 0.91, origin: 'stt' })
  }
  return { id, segments, words, speakerCount: speakers.size, durationMs: t - startEpochMs, startEpochMs }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const ids = process.argv.slice(2)
  for (const id of ids) {
    const out = convert(id)
    fs.writeFileSync(path.join(ROOT, 'transcripts', `${id}.segments.json`), JSON.stringify(out, null, 1))
    console.log(`${id}: segments=${out.segments.length} words=${out.words} speakers=${out.speakerCount} duration_min=${(out.durationMs / 60000).toFixed(1)}`)
  }
}
