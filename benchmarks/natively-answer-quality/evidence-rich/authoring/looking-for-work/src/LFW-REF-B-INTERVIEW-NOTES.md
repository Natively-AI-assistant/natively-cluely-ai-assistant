# Hollowpine - interview prep

Private notes. First written 18 August 2026 and added to since; the additions are dated at the end.

## Why now

I became Lead in January 2024 and the job quietly turned into coordination. I tracked one month this spring: about 60% of my hours went to the hiring loop, the architecture forum and chapter standards. In the last twelve months I shipped 2 product features myself. I'm good at the coordinating and I miss the building.

The other half is the roadmap. Lumenquay's plan for 2027 is integrations with practice-management systems. Necessary, but almost no new interface work. The problems I want now are the ones Hollowpine describes: many people in one document, and an assistant whose answers arrive slowly, partially or wrongly.

I am not unhappy with anyone. Joaquim, our CTO, has been fair to me and I intend to leave Pebblekit in good hands. Never frame it as an escape.

## What I'm looking for

A senior individual-contributor seat in a single product squad, with a designer and a product manager close by. No chapter to run. I'm glad to mentor and to set the accessibility bar, but I don't want to own a hiring loop again for a while. Written decisions, experiments before opinions, and remote-first for real, not as a perk.

## Practicalities

| Topic | Where I stand |
|---|---|
| Where I live | Staying in Porto. I'm not moving to Rotterdam or anywhere else, so remote within Europe is a condition, not a preference. |
| Travel | Fine. The four team weeks are a plus, and up to about six weeks of travel a year works for me. More than that doesn't. |
| Notice | My contract says 60 days. |
| Start (18 Aug) | If I resign at the end of September I could be there on 1 December. See additions. |
| Pay now | EUR 71,000 base at Lumenquay, no bonus. |
| Pay, first thought (18 Aug) | Ask for EUR 78,000 to 82,000. Revised, see additions. |

## Where I'm thin

Real-time. I have never shipped multiplayer: no live cursors, no shared editing, no WebSocket work beyond reading about it. The posting lists it as a requirement, so I say it before they find it. What I can honestly offer: I spent four evenings in September building a shared checklist on Yjs to understand how the document model and awareness work. It's a toy and I'll call it one.

AI features. None shipped. I have opinions about loading, partial and failed states from years of slow clinic networks, and that is all I should claim.

Editors. No ProseMirror, Tiptap or Lexical. Canvas: a little, for charts, years ago. Leave it out.

## What I'm bad at

I say yes too easily. In the third quarter of 2025 I accepted component requests from 3 squads in the same fortnight and the date picker slipped by 5 weeks, which held up the booking squad's release. Nobody shouted; I simply delivered late to everyone. Since then Pebblekit has a public intake board with a work-in-progress limit of 2, and I publish a short "not doing this quarter" list. I still find the no hard to write.

## Stories I can tell

### Stopping an experiment early (Fernlatch)

Two weeks into the A/B run the new flow was ahead by 8.1 points and Rodrigo Azinhal, the booking squad's product manager, wanted to ship and announce. We had agreed the length in advance because clinics book in a weekly rhythm and returning pet owners behave differently from new ones. I said no in the squad channel and then, more usefully, on a call. We settled on raising exposure from 20% to 50% and waiting. The gain settled lower than the week-two reading. Rodrigo and I now write the stopping rule into every experiment plan; it became a required field in the Dialbench template.

### The Azores reminders (11 July 2023)

During the TypeScript migration I merged a batch that tightened the types in our date utilities. The tests were green and I skipped the manual timezone check I normally do. Clinics in the Azores, an hour behind the mainland, had reminders sent with the wrong time: 312 reminders across 9 clinics before support noticed the next morning. I reverted, then phoned the nine clinics myself together with our support lead. Afterwards I added property-based tests for timezone conversion and an Azores clinic to the end-to-end fixtures. My mistake was treating a type change as if it could not change behaviour.

### The audit date (Ondaverde, early 2022)

The external audit of Farolim was fixed for 14 March 2022 by a contract with a hospital group. Six weeks before, our own pre-audit found 87 issues, 31 of them blocking. I asked product for a four-week freeze on new portal features and got it, sorted the blockers by user journey and not by component, and ran screen-reader sessions in pairs so that a fix was checked the same day. We passed with 3 minor findings.

### Leonor

Leonor Abrunhal, a mid-level engineer in the chapter, wanted to specialise in accessibility and didn't know where to start. From January to March 2026 we did one hour a week of screen-reader testing together, on real tickets. She now takes the accessibility triage every other week in my place, and she passed the IAAP CPACC exam in June 2026.

## Additions

26 Sep - Pay. Spoke to a former Ondaverde colleague who is now at a Dutch scale-up of a similar size. Senior product engineers there are on base salaries in the low to mid nineties. My August figure was a Portuguese-market number for a job that is not paid on the Portuguese market. New ask: EUR 88,000 to 95,000 base. Don't bring up the earlier figure.

26 Sep - Start. Pebblekit version 3 has moved to 27 November and I told Joaquim I would see it out. So I resign on 30 November at the earliest and the notice runs from there. The August date is off the table.
