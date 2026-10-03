# Ostrakel Payments - what I found

Two evenings of reading: their site, the engineering blog, the status page, two press pieces and one conference talk. Collected 12 to 20 September 2026.

## What they sell

Two products. Ostrakel Route is the orchestration side: a marketplace integrates once and Route decides which processor each payment goes through. Ostrakel Books is the merchant ledger: it tracks what every seller on a marketplace is owed and when it is paid out. The role I'm talking to them about sits under Books.

Customers are mid-market marketplaces, not the giants. The two named on their site are Hattibazaar (groceries) and Rentloom (furniture rental). One press piece puts annualised payment volume at about USD 4.1 billion. I couldn't find a revenue figure anywhere and shouldn't quote one.

## Money and people

| Round | When | Amount | Lead investor |
|---|---|---|---|
| Series A | 2020 | USD 8 million | Kestrelmoor Partners |
| Series B | 2022 | USD 27 million | Kestrelmoor Partners |
| Series C | March 2025 | USD 62 million | Harrowfield Ventures |

Total raised: USD 97 million. The founders are Vennela Aramudhan (CEO, came out of a bank's treasury technology team) and Kaustubh Marivalen (CTO). A Singapore entity was set up in 2024 and they are live in Indonesia and Vietnam.

For comparison: Paylattice, the nearest competitor, has raised USD 140 million and is roughly twice the headcount. Ostrakel is the smaller and more engineering-led of the two, which is part of the appeal.

## Engineering, seen from outside

- Blog, May 2026, "Why our ledger never updates a row". The journal is append-only and a correction is a pair of reversing entries, never an edit. This post is the reason I applied.
- Blog, on reconciliation. The unexplained break rate was 0.31% in 2024, before they rebuilt matching. The posting gives today's figure.
- Talk by Sarvesh Idnavalli at Ledgerfest, February 2026, on idempotency keys. Keys are stored for 72 hours, and a retried request gets the original stored response back, not a second execution. In the Q&A he was direct about what they got wrong the first time. He would be my manager.
- Status page. On 11 June 2026 settlement files to 2 partner banks went out about 6 hours late. The public write-up blames a reconciliation batch that hung while holding a lock.

Employee reviews are thin: 63 on the one site I checked, average 4.1. The recurring complaint is on-call around month-end.

## Why this one

Three reasons, in order. Correctness is the product there, not a quality attribute. The team is small and writes down how it thinks, in public. And it is the stack I already know (Go, PostgreSQL, Kafka) pointed at a domain I don't, which is the right amount of new.

## Things to ask them

1. Is the Java settlement engine staying, or is there a plan to move it to Go? Either answer is fine; I want to know which one I'm signing up for.
2. How many pages does the primary get in a normal week, and what does month-end look like?
3. Which kinds of break make up most of what is left, and what is the plan for getting from today's rate to the target?
4. What does going from L5 to L6 look like in practice, and how many Staff engineers are there today?
5. What changed after the June settlement delay?

Not for round one: leave, the learning budget. Both are in the posting.
