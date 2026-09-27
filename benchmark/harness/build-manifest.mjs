// Builds benchmark/manifest.json from the corpus actually on disk.
import fs from 'node:fs'
import path from 'node:path'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const CORPUS = [
  { id: 'SALES-S', category: 'sales', natively_mode: 'sales', length_bucket: 'short', source: 'synthetic' },
  { id: 'TEAM-S', category: 'team_meeting', natively_mode: 'team-meet', length_bucket: 'short', source: 'synthetic' },
  { id: 'INT-M', category: 'interview', natively_mode: 'looking-for-work', length_bucket: 'medium', source: 'synthetic' },
  { id: 'CASUAL-M', category: 'casual_mixed', natively_mode: 'general', length_bucket: 'medium', source: 'synthetic' },
  { id: 'TEAM-M', category: 'team_meeting', natively_mode: 'team-meet', length_bucket: 'long', source: 'synthetic' },
  { id: 'INT-TECH-L', category: 'interview', natively_mode: 'recruiting', length_bucket: 'long', source: 'synthetic' },
  { id: 'SALES-DISC-L', category: 'sales', natively_mode: 'sales', length_bucket: 'long', source: 'synthetic' },
  { id: 'TECH-DISC-L', category: 'technical_discussion', natively_mode: 'general', length_bucket: 'long', source: 'synthetic' },
  { id: 'REAL-LECT-L', category: 'lecture', natively_mode: 'lecture', length_bucket: 'long', source: 'youtube', video: 'Uihjety2d5M' },
  { id: 'LECT-VL', category: 'lecture', natively_mode: 'lecture', length_bucket: 'very_long', source: 'synthetic' },
  { id: 'REAL-LECT-VL', category: 'lecture', natively_mode: 'lecture', length_bucket: 'very_long', source: 'youtube', video: 'dYorCZaF8ag' },
]
const conversations = []
for (const c of CORPUS) {
  const segFile = path.join(ROOT, 'transcripts', `${c.id}.segments.json`)
  if (!fs.existsSync(segFile)) continue
  const seg = JSON.parse(fs.readFileSync(segFile, 'utf8'))
  const src = fs.readFileSync(path.join(ROOT, 'transcripts/src', `${c.id}.txt`), 'utf8')
  const title = (/^# title: (.*)$/m.exec(src) || [])[1] || null
  const chars = seg.segments.reduce((s, x) => s + x.text.length, 0)
  const entry = {
    benchmark_id: 'natively-summary-models-2026-09-17', ...c, title,
    duration_min: +(seg.durationMs / 60000).toFixed(1), words: seg.words, segments: seg.segments.length,
    transcript_chars: chars, token_estimate_chars_div_4: Math.ceil(chars / 4),
    speaker_count: seg.speakerCount,
    reference: fs.existsSync(path.join(ROOT, 'references', `${c.id}.json`)) ? `references/${c.id}.json` : null,
  }
  if (c.source === 'youtube') {
    const meta = fs.readFileSync(path.join(ROOT, 'raw/youtube', `${c.video}.meta.txt`), 'utf8').trim().split('|')
    Object.assign(entry, {
      source_url: meta[5], source_title: meta[4], source_channel: meta[3], source_duration_s: Number(meta[1]), source_upload_date: meta[2],
      date_downloaded: '2026-09-17', rights_note: 'NIH VideoCast lecture by a US federal employee (work of the US Government); captions only, no media downloaded',
      transcript_method: 'Human-authored YouTube English captions (json3) fetched with yt-dlp --skip-download; NOT transcribed by Natively (no audio downloaded: disk had <500MB free). Transcription is not part of this benchmark.',
      preprocessing: 'ALL-CAPS broadcast captions sentence-cased (small acronym list kept upper; proper nouns lowercased); caption events merged/split at sentence boundaries (<=45 words) to approximate STT finalization; all lines on system-audio speaker_1 (no diarization in captions); real caption timing used for timestamps',
    })
  } else {
    Object.assign(entry, {
      source_url: null, date_downloaded: null,
      transcript_method: 'Synthetic, authored per benchmark/transcripts/CORPUS_SPEC.md (speech-style, light STT artifacts) — transcription is not part of this benchmark',
      preprocessing: 'S0 -> mic channel speaker "user" (Me); S1..Sn -> system-audio speaker "interviewer" with diarization speakerId speaker_N; epoch-ms finalization timestamps paced at 150 wpm + 600 ms turn gap',
    })
  }
  conversations.push(entry)
}
fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify({ benchmark_id: 'natively-summary-models-2026-09-17', generated_at: new Date().toISOString(), conversations }, null, 1))
console.table(conversations.map(c => ({ id: c.id, mode: c.natively_mode, bucket: c.length_bucket, min: c.duration_min, words: c.words, tok_est: c.token_estimate_chars_div_4, spk: c.speaker_count, ref: !!c.reference })))
