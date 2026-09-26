// tests/meeting-memory/live-audio/mock-tech-interview.mjs
//
// A realistic ~60 minute mock interview for a senior backend role, spoken for
// real (interviewer on system audio, candidate on the mic). 90+ interviewer
// questions, each followed by a What-to-answer press 2.5 s after the question
// ends — the way a user leans on Cmd+Enter through an interview. Sections:
// background, fundamentals with pushback and discussion, a coding problem the
// interviewer breaks down step by step (clarify → approach → walkthrough →
// complexity → code → edge cases → streaming → scale), a second coding problem,
// a system design with numbers given out loud, behavioural, and recall questions
// that point back up to an hour.
//
// Each press is scored for:
//   question — did the overlay answer the question just asked (the prompt's
//              question vs the spoken one, word overlap)
//   relevant — does the suggestion address it (per-question pattern)
//   memory   — for questions that depend on something said earlier, is that
//              detail in the suggestion (pattern), and how far back it was said
//
// The candidate's own spoken answers are scripted, so the conversation — and
// therefore every later memory probe — is deterministic.

export const WPM = 160;
export const TURN_GAP_S = 1.2;

const say = (who, text) => ({ kind: 'say', who, text });
const S = (text) => say('interviewer', text);                 // interviewer statement, no press
const C = (text) => say('user', text);                        // candidate speaks
let qn = 0;
/** Interviewer question + a What-to-answer press. `memory` marks a question that needs an earlier detail. */
const Q = (text, expect, opts = {}) => {
  qn++;
  return [say('interviewer', text), { kind: 'wta', id: `Q${String(qn).padStart(2, '0')}${opts.tag ? `-${opts.tag}` : ''}`, asked: text, expect, ...opts }];
};
const typed = (id, text, expect, also) => ({ kind: 'typed', id, text, expect: { re: expect, also } });
/** Typed into the overlay early and NOT probed now — asked about at the end. */
const plant = (id, text, opts = {}) => ({ kind: 'typed', id, text, plant: true, ...opts });
/** A typed follow-up about an earlier ANSWER (scored against that answer's words). */
const recall = (id, text, from) => ({ kind: 'typed', id, text, from });
const index = (id, query, expect) => ({ kind: 'index', id, query, expect: { re: expect } });
const mark = (name) => ({ kind: 'mark', minute: name });

const ANY = /\S/;

export function buildMock() {
  qn = 0;
  const steps = [
    // ── A. Opening and background ──────────────────────────────────────────
    S("Hi Arjun, I'm Maya, I'm an engineering manager on the payments platform team at Northwind Pay. Thanks for making the time."),
    C('Hi Maya, thanks for having me, I am looking forward to it.'),
    S('Quick context: our team is about forty five engineers. Most of our services are written in Go, we use Postgres as our main database, and Kafka for payment events. Today we will do background, some fundamentals, a coding problem, a design question, and a few behavioural questions.'),
    C('That sounds great.'),
    ...Q('To start, can you give me a quick introduction about yourself?', ANY, { tag: 'intro' }),
    C('Sure. I am a backend engineer with five years of experience. For the last three years I have been at Tallyfin, where I work on the ledger service that records every money movement. We peak at around twelve thousand transactions per second.'),
    ...Q('What does your current team work on day to day?', /ledger|payment|transaction|money|account/i),
    C('We own the ledger and the reconciliation jobs. Day to day it is feature work for new payment products, performance work, and a weekly on call rotation. The team is six engineers, and I am the tech lead.'),
    ...Q('Tell me about the most technically challenging project you have worked on.', ANY),
    C('The hardest one was migrating the ledger from MySQL to Postgres without downtime. The ledger cannot lose or duplicate a single entry, so correctness was the whole game.'),
    ...Q('Why did you decide to migrate from MySQL to Postgres?', /postgres|mysql|jsonb|partition|replicat|lock|index|extension|feature/i, { tag: 'why-migrate' }),
    C('Mainly for better partitioning, transactional DDL, and stronger tooling for our reporting queries. We were also fighting replication issues on MySQL.'),
    ...Q('How did you handle the data migration without downtime?', /dual|backfill|shadow|cutover|replicat|cdc|flag|sync|compare/i),
    C('We used change data capture to stream writes into Postgres, backfilled history in batches, ran both in parallel for two weeks comparing balances every hour, and then flipped reads behind a feature flag.'),
    ...Q('Given the load you mentioned earlier, how did you make sure Postgres could keep up at peak?', /12,?000|twelve thousand|peak|tps|load test|benchmark|capacity/i, { memory: /12,?000|twelve thousand/i, tag: 'peak-mem' }),
    C('We load tested at two times our peak, tuned connection pooling with PgBouncer, and partitioned the entries table by month.'),
    ...Q('What would you do differently if you did that migration again?', ANY),
    C('I would invest earlier in the reconciliation tooling. We built it halfway through, and it caught two subtle rounding bugs that we could have found in week one.'),
    ...Q('How big is your team, and what is your role on it?', /six|\b6\b|tech lead|lead/i, { memory: /six|\b6\b/i, tag: 'team-mem' }),
    C('Six engineers, and I am the tech lead, so I split my time between design reviews, mentoring, and hands on work.'),
    ...Q('What are you looking for in your next role?', ANY),
    C('Bigger scale problems, especially around distributed data, and a team that cares about reliability as much as speed.'),
    S('That lines up well with what we do. Let us move into some fundamentals.'),
    // Session content that never enters the meeting index (typed chat, a
    // screenshot, manual answers) — asked about again in the wrap-up, ~100
    // exchanges later (2026-09-24).
    plant('P-offer', 'Quick note for later: the recruiter told me the offer band tops out at 212k base.'),
    plant('P-screen', "What's the error on my screen?", { image: true }),
    plant('P-manual', 'Give me a one-line way to explain backpressure.'),
    plant('P-chain', 'Which algorithm would you use to find the top ten most frequent search terms in a day of logs?'),
    mark(10),

    // ── B. Fundamentals, with pushback and discussion ──────────────────────
    ...Q('What is the difference between a process and a thread?', /memory|address space|share|heap|isolat/i),
    C('A process has its own memory space, while threads inside a process share memory. So threads are cheaper to create and communicate, but a bug in one thread can corrupt the others.'),
    ...Q('When would you prefer multiple processes over threads?', /isolat|crash|gil|security|fault|separate/i),
    C('When I want isolation, for example running untrusted work, or when a crash should not take down everything. In Python it also matters because of the global interpreter lock.'),
    ...Q('What causes a deadlock, and how do you prevent one?', /lock order|order|circular|mutual|timeout|hold and wait|cycle/i),
    C('Two workers each hold a lock and wait for the other. The simplest prevention is always acquiring locks in the same order, plus timeouts as a safety net.'),
    ...Q('Explain what a database index is, and how a B-tree index speeds up a query.', /b-?tree|balanced|log|sorted|lookup|pointer|tree/i),
    C('An index is a separate sorted structure that points at rows. A B-tree keeps keys sorted in a shallow balanced tree, so a lookup is logarithmic instead of scanning the table.'),
    ...Q('When can an index actually make things slower?', /write|insert|update|maintain|selectiv|cardinal|overhead/i),
    C('On write heavy tables, because every insert and update must also update the index. And a low selectivity index can be worse than a sequential scan.'),
    ...Q('What are the transaction isolation levels, and what anomalies does each one prevent?', /read committed|repeatable read|serializable|dirty|phantom|non-?repeatable/i),
    C('Read uncommitted, read committed, repeatable read, and serializable. Moving up the list you prevent dirty reads, then non repeatable reads, then phantoms.'),
    ...Q('Which isolation level does Postgres use by default?', /read committed/i),
    C('Read committed.'),
    ...Q('Can you explain the CAP theorem in simple terms?', /consisten|availab|partition/i),
    C('In a distributed system, when there is a network partition, you have to choose between consistency and availability.'),
    ...Q('A lot of people say pick two out of three. That is not quite right, is it?', /partition|during|network|always|not optional|tolerance/i, { tag: 'pushback' }),
    C('Right, partitions are not optional. The real choice only appears during a partition. The rest of the time you trade latency against consistency, which is what PACELC describes.'),
    ...Q('What is the difference between strong consistency and eventual consistency?', /eventual|converge|stale|latest|read/i),
    C('With strong consistency every read sees the latest write. With eventual consistency replicas converge over time, so a read can briefly be stale.'),
    ...Q('How would you explain consistent hashing to a junior engineer?', /ring|hash|node|remap|move|virtual/i),
    C('Picture a ring. Nodes and keys are hashed onto it, and each key belongs to the next node clockwise. Adding a node only moves the keys between it and its neighbour.'),
    ...Q('Why do we add virtual nodes to a consistent hashing ring?', /balanc|even|distribut|hot|spread|uneven/i),
    C('To spread load evenly. With few physical nodes the arcs are uneven, so each node takes many positions on the ring.'),
    ...Q('What caching strategies do you know, like write-through and write-back?', /write-?through|write-?back|write-?around|cache-?aside|read-?through/i),
    C('Cache aside is the common one. Write through writes to the cache and the store together, and write back writes to the cache first and flushes later, which is fast but risks losing data.'),
    ...Q('What is the hardest part of cache invalidation in practice?', /stale|invalidat|race|ttl|consisten|order/i),
    C('Races. A slow reader can put an old value back into the cache after a writer invalidated it. We usually use short TTLs plus versioned keys.'),
    ...Q('What is a cache stampede, and how do you prevent it?', /stampede|thundering|lock|coalesc|jitter|early|single ?flight|request/i),
    C('When a hot key expires and thousands of requests hit the database at once. Request coalescing, jittered expiry, and refreshing early all help.'),
    ...Q('Explain at-least-once versus exactly-once delivery in a message queue.', /duplicat|idempoten|at-?least|exactly|retry/i),
    C('At least once means a message can be delivered more than once, so consumers must be idempotent. True exactly once is rare. Usually it is at least once plus deduplication.'),
    ...Q('How do you get effectively exactly-once processing with Kafka?', /idempoten|transaction|offset|dedup/i),
    C('Idempotent producers, transactions that commit the output and the consumer offset together, or an idempotent sink keyed by event ID.'),
    ...Q('How does Kafka guarantee ordering, and what is the catch?', /partition|key|within|single/i),
    C('Ordering is only guaranteed within a partition, so related events need the same key.'),
    S('That is exactly how we do it. Our payment events are keyed by merchant ID, so every merchant is one ordered stream.'),
    C('Makes sense. That also gives you natural per merchant parallelism.'),
    ...Q('Given that setup, what happens to ordering if we increase the number of partitions?', /remap|reshuffl|re-?partition|different partition|rebalanc|hash.*change|order.*(break|lost)|move/i, { memory: /merchant/i, tag: 'kafka-mem' }),
    C('The key to partition mapping changes, so a merchant can move to a new partition while old events are still unprocessed in the old one. You need to drain first or accept a short window of reordering.'),
    ...Q('What is the difference between TCP and UDP, and when would you pick UDP?', /reliab|order|connection|latency|video|dns|game|stream/i),
    C('TCP gives reliable ordered delivery with a connection. UDP is fire and forget, so it is better for real time audio, video, or games where late data is useless.'),
    ...Q('Walk me through what happens during a TLS handshake.', /certificate|key exchange|handshake|cipher|session key|hello/i),
    C('The client and server agree on a cipher suite, the server presents its certificate, they do a key exchange, and derive session keys for symmetric encryption.'),
    ...Q('What is idempotency, and why does it matter for a payments API?', /idempoten|retry|duplicate|same result|twice|charge/i),
    C('An idempotent operation gives the same result no matter how many times you run it. In payments it means a client retry never charges someone twice.'),
    ...Q('How would you implement an idempotency key on a POST endpoint?', /key|store|header|unique|same response|cache|table/i),
    C('The client sends a unique key in a header. We store the key with the response in a table with a unique constraint, and a repeat request returns the stored response.'),
    ...Q('What is the difference between optimistic and pessimistic locking?', /version|conflict|lock|retry|for update|contention/i),
    C('Pessimistic locking takes the lock up front, like select for update. Optimistic locking checks a version at write time and retries on conflict, which is better when conflicts are rare.'),
    ...Q('When would you choose a NoSQL store over Postgres?', /schema|scale|write|document|key-?value|flexib|access pattern/i),
    C('When the access pattern is simple key value at huge scale, or the schema really varies. For money, I stay relational.'),
    ...Q('How do you shard a database, and what makes a good shard key?', /shard key|distribut|hot|cardinal|even|tenant|merchant|spread/i),
    C('Pick a key with high cardinality that spreads writes evenly and keeps related data together, like a tenant or merchant ID. Avoid keys that create hot spots, like timestamps.'),
    ...Q('What problems does replication lag cause for users?', /stale|read.{0,10}own|lag|replica|disappear|missing/i),
    C('A user writes something, reads from a lagging replica, and it looks like their change disappeared.'),
    ...Q('How would you handle read-your-own-writes consistency?', /primary|leader|sticky|session|version|read from/i),
    C('Route a user to the primary for a short window after they write, or track the write position and only read from replicas that have caught up.'),
    ...Q('Monolith or microservices for a brand new product, and why?', /monolith|microservice|team|complex|deploy|boundar/i),
    C('A modular monolith first. Microservices pay off when team boundaries and scaling needs are clear, not on day one.'),
    ...Q('What are the three pillars of observability?', /log|metric|trac/i),
    C('Logs, metrics, and traces.'),
    ...Q('What is the difference between p50 and p99 latency, and why do we care about p99?', /percentile|tail|99|median|slowest|user/i),
    C('P fifty is the median, p ninety nine is the slowest one percent. At scale, that one percent is thousands of real users, and a single page load often hits many services, so tails compound.'),
    ...Q('What is the difference between horizontal and vertical scaling?', /horizontal|vertical|more machines|bigger|scale out|scale up/i),
    C('Vertical scaling is a bigger machine, horizontal is more machines. Vertical is simpler until you hit the ceiling. Horizontal needs the service to be stateless or the data to be partitioned.'),
    ...Q('What does a load balancer do at layer four versus layer seven?', /layer 4|layer 7|layer four|layer seven|tcp|http|header|path|l4|l7/i),
    C('Layer four balances TCP connections without looking inside them. Layer seven understands HTTP, so it can route by path or header, terminate TLS, and retry.'),
    ...Q('How does a circuit breaker work?', /open|closed|half-?open|fail|threshold|trip/i),
    C('It counts failures to a dependency. Past a threshold it opens and fails fast, after a cooldown it goes half open and lets a few requests through, and if they succeed it closes again.'),
    ...Q('What is backpressure, and why does it matter?', /backpressure|slow|consumer|queue|buffer|overwhelm|flow control|reject/i),
    C('It is the downstream telling the upstream to slow down. Without it queues grow until something runs out of memory, so you bound queues and reject or shed load early.'),
    ...Q('How would you design pagination for a REST API?', /cursor|offset|limit|page|token|keyset/i),
    C('I prefer cursor based pagination, where the response gives an opaque token for the next page, built from the last sort key.'),
    ...Q('Why is offset pagination a problem on large tables?', /scan|skip|slow|shift|consisten|offset|duplicate|miss/i),
    C('The database still reads and throws away all the skipped rows, so deep pages get slow, and inserts shift the pages so users see duplicates or miss rows.'),
    ...Q('What is a write-ahead log, and why do databases use one?', /durab|crash|recover|log|sequential|wal|replay/i),
    C('Every change is appended to a log before the data pages are changed, so after a crash the database replays the log. Sequential writes are also much faster than random page writes.'),
    ...Q('What is MVCC?', /version|snapshot|concurren|mvcc|reader|writer/i),
    C('Multi version concurrency control. Writers create new row versions instead of overwriting, so readers see a consistent snapshot without blocking writers.'),
    ...Q('How does vacuum in Postgres relate to MVCC?', /dead|vacuum|bloat|old version|reclaim|tuple/i),
    C('Old row versions stay around as dead tuples. Vacuum reclaims them, and if it falls behind, tables bloat and you can even hit transaction ID wraparound.'),
    ...Q('What is the N plus one query problem?', /n ?\+ ?1|n plus one|join|eager|batch|loop|queries/i),
    C('Loading a list and then running one more query per item, usually hidden by an ORM. The fix is a join or a batched lookup.'),
    ...Q('How do you find a slow query in production?', /explain|slow query|pg_stat|trac|index|analy|log/i),
    C('Start from pg stat statements or the slow query log, then run explain analyze on the worst ones and check the plan for sequential scans.'),
    S('That reminds me. We had an outage last month where a missing index on a lookup table made one of our Kafka consumers fall hours behind.'),
    C('Ouch. That kind of thing usually only shows up at production data sizes.'),
    ...Q('How would you catch something like that before it hits production?', /explain|review|load test|staging|lint|migration|index|production-?like|size/i),
    C('Run migrations and new queries against a production sized copy, add explain plan checks to code review for new queries, and alert on consumer lag early.'),
    ...Q('What is the difference between a mutex and a semaphore?', /count|permit|one|mutual|resource/i),
    C('A mutex lets exactly one holder in. A semaphore has a count, so it lets up to n holders in, which is useful for limiting concurrency to a pool.'),
    ...Q('What are goroutines, and how are they different from OS threads?', /goroutine|lightweight|scheduler|stack|runtime|cheap|m:n/i),
    C('Goroutines are lightweight tasks scheduled by the Go runtime onto a small number of OS threads. They start with a tiny stack that grows, so you can run hundreds of thousands of them.'),
    ...Q('How do channels work in Go?', /channel|send|receiv|buffer|block|goroutine/i),
    C('A channel passes values between goroutines. An unbuffered channel blocks until both sides are ready, and a buffered one blocks only when it is full or empty.'),
    mark(30),

    // ── C. Coding, broken down by the interviewer ──────────────────────────
    S('Okay, let us do a coding problem. I will describe it and we will break it down together. You are given a list of intervals, each with a start and an end, and you need to merge all the overlapping intervals and return the result.'),
    ...Q('Before you start, what clarifying questions would you ask?', /sorted|empty|inclusive|touch|overlap|negative|size|duplicate|order/i, { tag: 'clarify' }),
    C('Are the intervals sorted? Should touching intervals, like one to three and three to five, be merged? And how large can the input be?'),
    S('Good questions. They are not sorted. Touching intervals should merge. The number of intervals can be up to one hundred thousand, and the values fit in a thirty two bit integer.'),
    ...Q('So what is the first step you would take?', /sort/i),
    C('Sort the intervals by their start value.'),
    ...Q('Why does sorting by start time help?', /adjacent|consecutive|only (need|compare)|previous|last|neighbo|overlap/i),
    C('After sorting, any interval that overlaps the current merged interval must come right after it, so I only compare with the last merged interval.'),
    ...Q('Walk me through the example: one to three, two to six, eight to ten, and fifteen to eighteen.', /1.{0,6}6|one to six|8.{0,6}10|15.{0,6}18/i, { tag: 'walkthrough' }),
    C('One to three and two to six overlap, so they become one to six. Eight to ten does not overlap, so it stays. Fifteen to eighteen stays too. The result is one to six, eight to ten, fifteen to eighteen.'),
    ...Q('What is the time complexity of your approach?', /n ?log ?n|o\(n log/i),
    C('O of n log n for the sort, and the sweep is linear.'),
    ...Q('And the space complexity?', /o\(n\)|linear|o\(log n\)|output|in place/i),
    C('O of n for the output, plus whatever the sort uses.'),
    ...Q('Can you write the code for it?', /def |function |=>|\bfor\b|\bsort/i, { code: true, tag: 'code' }),
    C('Sure. I sort the list by start, start the result with the first interval, then for each next interval, if its start is at most the last end, I extend the last end with the maximum. Otherwise I append it.'),
    ...Q('How would you test your function?', /unit test|edge|random|property|assert|case|brute/i),
    C('Unit tests for the edge cases, plus a randomized test that compares against a brute force version on small inputs.'),
    ...Q('Where could an off by one bug sneak into your code?', /<=|less than or equal|touch|boundar|equal|end|strict/i, { memory: /touch|equal|<=/i, tag: 'off-by-one' }),
    C('In the overlap check. Since touching intervals must merge, it has to be less than or equal, not strictly less than.'),
    ...Q('What edge cases would you test?', /empty|single|nested|contain|touch|same|duplicate|one interval/i),
    C('An empty list, a single interval, touching intervals, fully nested intervals, and duplicates.'),
    ...Q('What happens with fully nested intervals, like one to ten and two to three?', /max|1.{0,6}10|one to ten|contain|absorb|swallow/i),
    C('Because I take the maximum of the two ends, two to three is absorbed and the result stays one to ten.'),
    ...Q('How would it change if the intervals were already sorted?', /o\(n\)|linear|skip|single pass|no sort/i),
    C('Then I skip the sort, and it is a single linear pass.'),
    ...Q('Now suppose intervals arrive as a stream, and you need to keep the merged set up to date. How does your approach change?', /tree|balanced|bst|treemap|sorted (set|map)|binary search|insert|skip list/i, { tag: 'stream' }),
    C('I would keep the merged intervals in a balanced tree keyed by start. For each new interval I find its neighbours, merge whatever overlaps, and reinsert.'),
    ...Q('What is the complexity of inserting one new interval in that design?', /log n|o\(log|amortiz/i),
    C('O of log n to find the position, plus the cost of merging the neighbours it swallows, which is amortized.'),
    S('Nice. Let me push a little. The stream is huge and does not fit in memory.'),
    C('Okay, then I cannot keep everything in one tree.'),
    ...Q('So what would you do if the data does not fit in memory?', /external|chunk|disk|merge|shard|partition|batch|spill/i),
    C('External sort: sort chunks that fit in memory, write them to disk, then do a k way merge while sweeping, keeping only the current interval in memory.'),
    ...Q('How would you parallelize the merge across machines?', /partition|range|map ?reduce|shard|boundar|split/i),
    C('Partition by range of start values, merge each range on its own machine, then fix up the boundaries.'),
    ...Q('What is the tricky part about intervals that cross partition boundaries?', /boundar|span|overlap|cross|stitch|again|adjacent/i),
    C('An interval can start in one range and end in the next, so after the parallel step you need a final pass that stitches adjacent ranges together.'),
    S('Good. Let us do a second, quicker problem.'),
    ...Q('How would you find the k most frequent elements in an array?', /hash ?map|count|heap|bucket|frequen/i, { tag: 'topk' }),
    C('Count with a hash map, then keep a min heap of size k over the counts.'),
    ...Q('What is the complexity with a heap of size k?', /n ?log ?k|o\(n log k/i),
    C('O of n log k.'),
    ...Q('Can you do better than n log k?', /bucket|quick ?select|o\(n\)|linear/i),
    C('Yes, bucket sort by frequency gives linear time, or quickselect on average.'),
    ...Q('Which approach would you pick for our payment events if k is ten and n is a few million?', /heap|bucket|count|stream|memory|approximate|count-?min/i, { memory: /payment|merchant|event/i }),
    C('A heap of size ten over a hash map of counts. It is simple and memory is fine at a few million. If it were unbounded I would use a count min sketch.'),
    ...Q('Before we move on, what time complexity did you give for the merge intervals problem?', /n ?log ?n/i, { memory: /n ?log ?n/i, tag: 'mem-complexity' }),
    C('N log n.'),
    ...Q('And what did I say the maximum number of intervals was?', /100,?000|one hundred thousand|10\^?5|hundred thousand|100k/i, { memory: /100,?000|one hundred thousand|10\^?5|hundred thousand|100k/i, tag: 'mem-n' }),
    C('One hundred thousand.'),
    typed('T1-constraints', 'What constraints did she give for the intervals problem?', /100,?000|one hundred thousand|10\^?5|hundred thousand|100k/i, /touch|sorted|32/i),
    mark(45),

    // ── D. System design ───────────────────────────────────────────────────
    S('Let us do a design question. Design a webhook delivery service that notifies merchants when a payment event happens.'),
    ...Q('What requirements would you clarify first?', /volume|latency|retry|order|at-?least|scale|security|sign|guarantee/i, { tag: 'design-req' }),
    C('Volume, delivery guarantee, how long to retry, whether ordering matters, and latency expectations.'),
    S('Let us say fifty million events a day, at least once delivery, retries for up to twenty four hours, and ordering per merchant.'),
    ...Q('What is your back of the envelope estimate for events per second?', /5\d\d|6\d\d|about 600|six hundred|five hundred|580/i, { memory: /50 ?million|fifty million|5\d\d|6\d\d|580/i, tag: 'eps' }),
    C('Fifty million a day is about five hundred eighty per second on average.'),
    ...Q('And what peak should we design for?', /peak|3,?000|thousand|times|burst|5x|five times|\dx/i),
    C('Payments are bursty, so I would design for five times average, around three thousand per second.'),
    ...Q('What does the high-level architecture look like?', /queue|kafka|worker|database|store|retry|consumer/i),
    C('Payment events come off Kafka into a dispatcher, deliveries are recorded in a table, workers send the HTTP calls, and failures go to a retry schedule.'),
    ...Q('How would you store pending deliveries?', /table|postgres|queue|status|attempt|next.?retry|row/i),
    C('A deliveries table with the event ID, merchant ID, status, attempt count, and next retry time, indexed on next retry time.'),
    ...Q('How would you partition the Kafka topic for this service?', /merchant|key|partition/i, { memory: /merchant/i }),
    C('Key by merchant ID, same as the payment events, so a merchant stays on one partition and one consumer.'),
    ...Q('If each delivery takes two hundred milliseconds, how many concurrent workers do we need at peak?', /600|six hundred|3,?000|workers|concurren/i, { memory: /600|six hundred|3,?000|three thousand/i, tag: 'workers' }),
    C('Three thousand per second times zero point two seconds is about six hundred deliveries in flight, so around six hundred concurrent workers or connections.'),
    ...Q('How would you design the retry policy?', /exponential|backoff|jitter|24|dead.?letter|twenty-?four/i, { memory: /24|twenty-?four/i }),
    C('Exponential backoff with jitter, capped so the last attempt lands at twenty four hours, then a dead letter state the merchant can replay from.'),
    ...Q('How do you preserve per merchant ordering while still scaling out?', /partition|key|merchant|single|sequence|one (worker|consumer)/i, { memory: /merchant/i }),
    C('Partition work by merchant ID, so one worker owns a merchant at a time, and never send event n plus one until event n succeeded or died.'),
    ...Q('What happens if one merchant endpoint is down for hours? How do you stop it from blocking others?', /isolat|per-?merchant|queue|circuit|separate|backoff|head.of.line|pause/i),
    C('Each merchant has its own queue and circuit breaker, so a dead endpoint only backs up its own events.'),
    ...Q('How would a merchant verify that a webhook really came from us?', /sign|hmac|signature|secret/i),
    C('We sign the payload with an HMAC using a per merchant secret and send the signature in a header.'),
    ...Q('How do you prevent replay attacks on those webhooks?', /timestamp|nonce|window|expire|event id|tolerance/i),
    C('Include a timestamp in the signed payload and reject anything older than five minutes, plus the event ID so they can deduplicate.'),
    ...Q('How would you let merchants replay failed webhooks?', /dead.?letter|replay|dashboard|api|redeliver|button/i),
    C('Keep dead lettered deliveries for thirty days and expose a replay API and a button in the dashboard.'),
    ...Q('What if a merchant changes their webhook URL while events are still retrying?', /latest|lookup|config|send time|current|version|read/i),
    C('Look up the URL at send time instead of storing it on the delivery, so retries go to the new endpoint.'),
    ...Q('What metrics would you put on the dashboard for this service?', /latency|success|failure|retry|queue|lag|error|rate/i),
    C('Delivery latency, success rate per merchant, retry queue depth, consumer lag, and the count of dead letters.'),
    ...Q('How would you handle a merchant that responds with a five hundred versus a four hundred?', /retry|transient|permanent|client error|4\d\d|5\d\d|stop/i),
    C('A five hundred is transient, so retry. Most four hundreds are permanent, so stop and mark it failed, except four twenty nine, which means back off.'),
    ...Q('Where would idempotency come into this design?', /idempoten|event id|dedup|duplicate/i, { memory: /idempoten|event id|dedup|duplicate/i }),
    C('Since delivery is at least once, every webhook carries a stable event ID so merchants can deduplicate.'),
    ...Q('How would you roll out a change to the retry policy safely?', /flag|canary|gradual|percent|shadow|subset/i),
    C('Behind a flag, to a small percentage of merchants first, watching the retry and dead letter metrics.'),
    ...Q('What is the biggest single point of failure in your design?', /database|table|postgres|queue|kafka|single|failover|replica|primary/i),
    C('The deliveries table. I would run it with a replica and automatic failover, and keep Kafka as the source of truth so we can rebuild.'),
    ...Q('How would this change if we needed delivery within one second for ninety nine percent of events?', /latency|p99|push|connection|pool|priorit|in-?memory|skip/i),
    C('Skip the database on the hot path, dispatch straight from the consumer with warm connection pools, and write the delivery record asynchronously.'),
    ...Q('Remind me, what delivery guarantee did we agree on?', /at-?least-?once|at least once/i, { memory: /at-?least-?once|at least once/i, tag: 'mem-guarantee' }),
    C('At least once.'),
    ...Q('And how long did we say retries should continue?', /24|twenty-?four/i, { memory: /24|twenty-?four/i, tag: 'mem-retry' }),
    C('Twenty four hours.'),
    ...Q('Using the numbers we discussed, how much storage do we need for a week of events if each event is one kilobyte?', /350|3\d\d ?gb|gigabyte|0\.35 ?tb/i, { memory: /350|3\d\d ?gb|0\.35/i, tag: 'mem-storage' }),
    C('Fifty million times seven days times one kilobyte is about three hundred fifty gigabytes.'),
    ...Q('Is there anything you would change in your design now that you have thought about it more?', ANY),
    C('I would add a per merchant rate limit, so one big merchant cannot starve the workers.'),
    typed('T2-design-numbers', 'What numbers did she give for the webhook service?', /50 ?million|fifty million/i, /24|twenty-?four/i),
    index('X1-retry', 'how long should webhook retries continue', /24|twenty-?four/i),
    mark(60),

    // ── E. Behavioural ─────────────────────────────────────────────────────
    S('Let us finish with a few behavioural questions.'),
    ...Q('Tell me about a time you disagreed with your manager.', ANY, { tag: 'behav-disagree', story: true }),
    C('My manager wanted to ship the migration a month early. I showed the reconciliation mismatches we were still finding, and we agreed to keep the date but cut scope instead.'),
    ...Q('How do you handle receiving critical feedback?', ANY),
    C('I ask for a concrete example, I repeat it back to make sure I understood, and I follow up a few weeks later to check it improved.'),
    ...Q('Tell me about a production incident you owned.', ANY, { tag: 'behav-incident', story: true }),
    C('A bad index change locked the entries table for eight minutes during peak. I rolled it back, wrote the postmortem, and we added a check that blocks non concurrent index builds.'),
    ...Q('How do you prioritize when everything is urgent?', /impact|priorit|urgent|stakeholder|trade|risk/i),
    C('I rank by customer impact and risk, make the trade offs visible to stakeholders, and say no explicitly instead of silently.'),
    ...Q('Describe a time you mentored someone.', ANY, { story: true }),
    C('I paired with a new grad on our first reconciliation job, and six months later she owned the whole reconciliation area.'),
    ...Q('What is a technical decision you regret?', ANY, { story: true }),
    C('Using a shared database between two services early on. It made every schema change a cross team negotiation.'),
    ...Q('Tell me about a time you had to push back on a product deadline.', ANY, { story: true }),
    C('Product wanted a new payout type in two weeks. I laid out what we could safely ship in two weeks and what needed four, and we shipped a smaller first version on time.'),
    ...Q('How do you make sure your code reviews are useful?', /small|context|review|feedback|test|kind|specific/i),
    C('I keep my own changes small, I review within a day, and I separate must fix comments from suggestions.'),
    ...Q('What is the best feedback you have ever received?', ANY),
    C('That I explained solutions before explaining the problem. Now I start design docs with the problem and the constraints.'),
    ...Q('How do you keep up with new technologies?', ANY),
    C('Engineering blogs, postmortems from other companies, and small side projects.'),

    // ── F. Recall and wrap-up ──────────────────────────────────────────────
    ...Q('Before we finish, what language and database did I say our team mainly uses?', /\bgo\b|golang/i, { memory: /\bgo\b|golang/i, also: /postgres/i, tag: 'mem-stack' }),
    C('Go and Postgres, with Kafka for events.'),
    ...Q('What was the peak throughput you mentioned for your ledger service?', /12,?000|twelve thousand/i, { memory: /12,?000|twelve thousand/i, tag: 'mem-tps' }),
    C('Twelve thousand transactions per second.'),
    ...Q('Which database did you migrate away from?', /mysql/i, { memory: /mysql/i, tag: 'mem-mysql' }),
    C('MySQL.'),
    ...Q('What did I say we key our Kafka payment events by?', /merchant/i, { memory: /merchant/i, tag: 'mem-key' }),
    C('Merchant ID.'),
    ...Q('How many engineers did I say are on our team?', /forty[- ]five|\b45\b/i, { memory: /forty[- ]five|\b45\b/i, tag: 'mem-45' }),
    C('About forty five.'),
    ...Q('Which function failed in the build you had up on your screen earlier?', /reconcileLedgerV3/i, { memory: /reconcileLedgerV3/i, tag: 'mem-screen' }),
    C('The ledger reconciliation function, version three.'),
    ...Q('Do you have any questions for me?', ANY),
    C('Yes, how does the payments platform team split on call between Go services and the Kafka infrastructure?'),
    S('Good question. Platform owns Kafka, and each service team owns its own on call. Thanks Arjun, that is all from me today.'),
    C('Thank you, Maya.'),
    typed('T3-summary', 'Summarize what the interviewer told me about their team and stack.', /\bgo\b|golang/i, /postgres|kafka|merchant|forty[- ]five|45/i),
    typed('T4-offer', 'What did I tell you the offer band tops out at?', /212/),
    typed('T5-screen', 'What was the error code on the screenshot I showed you earlier?', /7Q41/i),
    recall('T6-manual', 'What one-liner did you give me for backpressure earlier?', 'P-manual'),
    recall('T7-chain', 'Why did you pick that approach for the top ten search terms earlier?', 'P-chain'),
    recall('T8-wta', 'What did you suggest I say when she asked what my team works on day to day?', 'Q02'),
    index('X2-ledger', 'peak transactions per second of the ledger', /12,?000|twelve thousand/i),
    mark(70),
  ];
  return { steps, questions: qn };
}

const ACTION_S = { wta: 7.5, typed: 6, index: 2 };
export function estSeconds(step) {
  if (step.kind === 'say') return step.text.split(/\s+/).length / (WPM / 60) + TURN_GAP_S;
  return ACTION_S[step.kind] ?? 0;
}
