// Labelled interviewer scripts for the Auto Answer live rig.
//
// Each interviewer turn says what SHOULD happen:
//   expect 'answer' — an answer must appear, once, for this ask (q = the ask);
//   expect 'silent' — nothing may fire;
//   expect 'either' — logistics / comprehension checks where both are defensible.
// `parts` interleaves spoken text with { pause } gaps, so announced structures
// and thinking pauses reach the STT with real silences inside the turn.
// `check` is a loose content check; answers are still hand-read.
// `after: 'firstToken'` speaks the turn that long after the PREVIOUS answer's
// first token, i.e. while that answer is still streaming.

export const technicalInterview = [
  { who: 'interviewer', id: 'T01', expect: 'either', parts: ['Hi there, thanks for making the time today. Can you hear me okay?'] },
  { who: 'user', text: 'Yes, I can hear you fine, thanks for having me.' },
  { who: 'interviewer', id: 'T02', expect: 'silent', parts: ["Great. So I'm Sarah, I lead the platform team here. We'll spend about forty five minutes today. A few questions about your background, then some fundamentals, and then a coding problem."] },
  { who: 'user', text: 'Sounds good.' },
  { who: 'interviewer', id: 'T03', expect: 'answer', q: 'Tell me a little bit about yourself and what you have been working on recently', check: /\w{4,}.*\w{4,}/s,
    parts: ["Let's start with you. Tell me a little bit about yourself and what you've been working on recently."] },
  { who: 'user', text: "Sure. I'm a backend engineer. For the last three years I've been building payment services in Go and Node." },
  { who: 'interviewer', id: 'T04', expect: 'answer', q: "What's the difference between a process and a thread", check: /memory|address space/i,
    parts: ["Nice. What's the difference between a process and a thread?"] },
  { who: 'user', text: 'A process has its own memory space, and threads share memory inside one process.' },
  { who: 'interviewer', id: 'T05', expect: 'answer', q: 'And when would you pick one over the other', check: /isolat|crash|shar|overhead|parallel|CPU|communicat/i,
    parts: ['Right. And when would you pick one over the other'] },
  { who: 'user', text: 'Processes when I want isolation, threads when the work shares a lot of state.' },
  { who: 'interviewer', id: 'T06', expect: 'answer', q: 'How does a hash map handle collisions', check: /chain|open addressing|prob|bucket|linked/i,
    parts: ['Okay. How does a hash map handle collisions'] },
  { who: 'user', text: 'Usually with chaining, or with open addressing and probing.' },
  { who: 'interviewer', id: 'T07', expect: 'answer', q: 'how would you design a distributed cache for a read heavy service', check: /consistent hash|shard|replica|evict|TTL|LRU|invalidat/i,
    parts: ["Why do we use consistent hashing? Because adding a node shouldn't reshuffle every key. So with that in mind, how would you design a distributed cache for a read heavy service?"] },
  { who: 'user', text: "I'd shard keys with consistent hashing, keep replicas for the hot keys, and use a time to live with LRU eviction." },
  { who: 'interviewer', id: 'T08', expect: 'answer', q: 'design a data structure that supports insert, remove and get random in average constant time',
    check: /(array|list)[\s\S]*(hash|map|dict)|(hash|map|dict)[\s\S]*(array|list)/i,
    parts: ["Alright, let's move on to coding.", { pause: 1500 },
      'I want you to design a data structure that supports three operations.', { pause: 1400 },
      'First, insert a value.', { pause: 1200 },
      'Second, remove a value.', { pause: 1200 },
      'And third, get a random element, where every element has the same probability of being returned.', { pause: 700 },
      'All three should run in average constant time.'] },
  { who: 'interviewer', id: 'T09', expect: 'silent', parts: ["Take your time, and feel free to use whatever language you're comfortable with."] },
  { who: 'user', text: "Thanks. I'll use Python. I'm thinking a list for the values, plus a dictionary from each value to its index in the list." },
  { who: 'interviewer', id: 'T10', expect: 'answer', q: "What's the time complexity of your remove operation, and why", check: /O\(1\)|constant/i,
    parts: ["What's the time complexity of your remove operation, and why?"] },
  { who: 'user', text: "It's constant, because I swap with the last element and pop." },
  { who: 'interviewer', id: 'T11', expect: 'either', parts: ["So you're swapping the element with the last one and then popping it, right?"] },
  { who: 'user', text: 'Exactly.' },
  { who: 'interviewer', id: 'T12', expect: 'answer', q: 'walk me through what happens when you type a URL into the browser and press enter', check: /DNS[\s\S]*(TCP|TLS|HTTP)/i,
    parts: ["Let's switch gears. Can you walk me through what happens when you type a URL into the browser and press enter?"] },
  { who: 'user', text: 'The browser resolves the name with DNS, opens a TCP and TLS connection, and sends the HTTP request.' },
  { who: 'interviewer', id: 'T13', expect: 'silent', parts: ["Good. We'll come back to the networking side a bit later."] },
  { who: 'interviewer', id: 'T14', expect: 'answer', q: 'Tell me about a time you disagreed with a teammate on a technical decision, and how you resolved it', check: /\w{4,}.*\w{4,}/s,
    parts: ['Tell me about a time you disagreed with a teammate on a technical decision, and how you resolved it.'] },
  { who: 'user', text: 'We disagreed about moving to an event queue. I wrote a small prototype and we compared the numbers together.' },
  { who: 'interviewer', id: 'T15', expect: 'answer', q: 'a Node service in production is slowly running out of memory, how would you go about debugging that', check: /heap|snapshot|inspect|profil|clinic|leak/i,
    parts: ['Hmm, let me think how to phrase this next one.', { pause: 1600 },
      'Say a Node service in production is slowly running out of memory over a few days.', { pause: 900 },
      'How would you go about debugging that?'] },
  { who: 'interviewer', id: 'T16', expect: 'answer', after: 'firstToken', delayMs: 1500, q: 'Why not just restart it on a schedule', check: /mask|root cause|symptom|band|hide|hiding|underlying/i,
    parts: ['Why not just restart it on a schedule?'] },
  { who: 'user', text: 'Restarting hides the leak. I would rather find the root cause with heap snapshots.' },
  { who: 'interviewer', id: 'T17', expect: 'answer', q: 'Do you have any questions for me', check: /\?/,
    parts: ["Okay, we're almost at time. Do you have any questions for me?"] },
  { who: 'user', text: 'Yes. What does on call look like for the platform team?' },
  { who: 'interviewer', id: 'T18', expect: 'silent', parts: ['Good question. We run a weekly rotation with a secondary, and most pages are about deploys.'] },
  { who: 'interviewer', id: 'T19', expect: 'silent', parts: ["Thanks so much for your time today. We'll be in touch soon."] },
];

// Looking for work: a recruiter screen against tests/auto-answer-live/profile/resume-alex-rivera.txt
// and tests/auto-answer-live/profile/jd-northwind-integrations.txt (ingest both before the run).
// Personal questions the answer must ground in the résumé (check = a résumé
// fact), logistics, recruiter monologue that must stay quiet, asks without a
// question mark, a two-part question and a recap the candidate confirms.
export const lookingForWork = [
  { who: 'interviewer', id: 'L01', expect: 'either', parts: ["Hi, is this Alex? This is Priya from the talent team at Northwind. Is now still a good time?"] },
  { who: 'user', text: 'Yes, this is Alex. Now works great, thanks for calling.' },
  { who: 'interviewer', id: 'L02', expect: 'silent', parts: ["Perfect. So a bit of context first. Northwind builds logistics software for mid size retailers. We're about two hundred people, fully remote, and this role sits on the integrations team, which owns every connector to carriers and warehouses."] },
  { who: 'interviewer', id: 'L03', expect: 'answer', q: 'walk me through your background and what you do today', check: /Ledgerly|payout|payment/i,
    parts: ["To start, could you walk me through your background and what you're doing today?"] },
  { who: 'user', text: "Sure. I'm a backend engineer at Ledgerly, a fintech startup. I work on payment services in Go." },
  { who: 'interviewer', id: 'L04', expect: 'answer', q: 'I see you were at Shiplane before that, what did you work on there', check: /carrier|FedEx|UPS|DHL|connector|integration/i,
    parts: ['I see you were at Shiplane before that. What did you work on there'] },
  { who: 'user', text: 'Mostly carrier integrations in Node, things like FedEx and UPS connectors.' },
  { who: 'interviewer', id: 'L05', expect: 'answer', q: 'Tell me about the payout service rewrite on your resume', check: /50|half|40 minutes|five minutes|5 minutes|latency/i,
    parts: ['Tell me more about the payout service rewrite on your resume.'] },
  { who: 'user', text: 'We rewrote it in Go and cut failed payouts by half.' },
  { who: 'interviewer', id: 'L06', expect: 'silent', parts: ["Nice. That's actually very close to what the team deals with. A lot of our pain is retries and duplicate events from carrier webhooks."] },
  { who: 'interviewer', id: 'L07', expect: 'answer', q: 'how did you make the webhook ingestion idempotent', check: /idempot|outbox|Kafka|dedup|key/i,
    parts: ['So how did you make the webhook ingestion idempotent at Ledgerly?'] },
  { who: 'user', text: 'We used an outbox table in Postgres and Kafka, with idempotency keys on every event.' },
  { who: 'interviewer', id: 'L08', expect: 'answer', q: 'what made you start looking for something new', check: /\w{4,}.*\w{4,}/s,
    parts: ['Makes sense. And what made you start looking for something new'] },
  { who: 'user', text: 'I want to work on integrations at a bigger scale, and logistics is a space I already know from Shiplane.' },
  { who: 'interviewer', id: 'L09', expect: 'answer', q: 'what are your salary expectations for this role', check: /\d|range|band|compens|flexib/i,
    parts: ["Great. I have to ask this one early. What are your salary expectations for this role?"] },
  { who: 'user', text: "I'm targeting around one hundred and sixty thousand base, but I'm flexible for the right role." },
  { who: 'interviewer', id: 'L10', expect: 'silent', parts: ["Okay, that's within our band for this level, so no concerns there."] },
  { who: 'interviewer', id: 'L11', expect: 'answer', q: "what's your notice period, and are you open to fully remote work", check: /notice|week|remote/i,
    parts: ["Two quick ones. What's your notice period, and are you comfortable working fully remote?"] },
  { who: 'user', text: "Four weeks, and yes, I've been remote for two years." },
  { who: 'interviewer', id: 'L12', expect: 'answer', q: "Tell me about a time an integration you owned broke in production", check: /\w{4,}.*\w{4,}/s,
    parts: ['Tell me about a time an integration you owned broke in production, and what you did.'] },
  { who: 'user', text: 'A carrier changed their rate API without notice. I rolled back to cached rates and added contract tests after.' },
  { who: 'interviewer', id: 'L13', expect: 'either', parts: ["So you fell back to cached rates and then added contract tests so it wouldn't happen again, right?"] },
  { who: 'user', text: 'Exactly.' },
  { who: 'interviewer', id: 'L14', expect: 'answer', q: 'Why Northwind', check: /integrat|logistic|carrier|remote/i,
    parts: ["That's a good story. So why Northwind? What drew you to us specifically?"] },
  { who: 'user', text: 'Logistics integrations are a hard problem I enjoy, and the team owns the whole connector layer.' },
  { who: 'interviewer', id: 'L15', expect: 'silent', parts: ["So here's how the process works. There's a technical screen with an engineer, then a system design round, and then a final conversation with the hiring manager. The whole thing usually takes about three weeks."] },
  { who: 'interviewer', id: 'L16', expect: 'answer', q: 'are you interviewing anywhere else at the moment', check: /\w{4,}/,
    parts: ['Are you interviewing anywhere else at the moment'] },
  { who: 'user', text: "Yes, I'm in early stages with two other companies." },
  { who: 'interviewer', id: 'L17', expect: 'silent', parts: ["Thanks for being upfront. I'll send over a calendar invite for the technical screen later today."] },
  { who: 'interviewer', id: 'L18', expect: 'answer', q: 'Do you have any questions for me about the role or the team', check: /\?/,
    parts: ['Before we wrap up, do you have any questions for me about the role or the team?'] },
  { who: 'user', text: 'What does on call look like for the integrations team?' },
  { who: 'interviewer', id: 'L19', expect: 'silent', parts: ["Good question. It's a weekly rotation with a secondary, and most pages come from carrier outages rather than our own code."] },
  { who: 'interviewer', id: 'L20', expect: 'silent', parts: ["Great talking with you, Alex. Have a good rest of your day."] },
];

// Sales discovery call: the "interviewer" channel is the PROSPECT. Objections
// and buying questions must fire; the prospect describing their own setup,
// and small talk, must not.
export const salesCall = [
  { who: 'interviewer', id: 'S01', expect: 'silent', parts: ["Hey, thanks for jumping on. Sorry I'm a couple of minutes late, my last meeting ran over."] },
  { who: 'user', text: 'No worries at all. Thanks for making the time.' },
  { who: 'interviewer', id: 'S02', expect: 'silent', parts: ["So a bit of background on us. We're a team of about forty support agents, and right now we use a mix of spreadsheets and a shared inbox to track escalations."] },
  { who: 'interviewer', id: 'S03', expect: 'answer', q: 'how does your product handle escalations between tiers', check: /\w{4,}.*\w{4,}/s,
    parts: ['So how does your product actually handle escalations between tiers?'] },
  { who: 'user', text: 'Each ticket carries its tier, and escalation rules move it up automatically with the full history attached.' },
  { who: 'interviewer', id: 'S04', expect: 'answer', q: 'Does it integrate with Zendesk', check: /zendesk|integrat|api|connector/i,
    parts: ['Okay. Does it integrate with Zendesk'] },
  { who: 'user', text: 'Yes, there is a native Zendesk connector that syncs both ways.' },
  { who: 'interviewer', id: 'S05', expect: 'answer', q: 'what does pricing look like for a team our size', check: /\w{4,}.*\w{4,}/s,
    parts: ["Good. And what does pricing look like for a team our size?"] },
  { who: 'user', text: "For forty seats you'd be on our team plan. I can send the exact numbers after the call." },
  { who: 'interviewer', id: 'S06', expect: 'answer', q: 'that seems expensive compared to what we pay now, why is it worth it', check: /\w{4,}.*\w{4,}/s,
    parts: ["Honestly that seems expensive compared to what we pay now. Why would it be worth it for us?"] },
  { who: 'user', text: 'Mostly time saved on manual routing, and fewer escalations that fall through the cracks.' },
  { who: 'interviewer', id: 'S07', expect: 'silent', parts: ["Right. Our biggest pain is that escalations get lost over the weekend, when only two people are on shift."] },
  { who: 'interviewer', id: 'S08', expect: 'answer', q: 'how do you handle data security and are you SOC 2 compliant', check: /SOC|secur|encrypt|complian/i,
    parts: ['What about data security? Are you SOC two compliant?'] },
  { who: 'user', text: 'We are SOC two type two, and data is encrypted at rest and in transit.' },
  { who: 'interviewer', id: 'S09', expect: 'silent', parts: ["Okay, I'll need to loop in our IT lead on that before we go further."] },
  { who: 'interviewer', id: 'S10', expect: 'answer', q: 'what would the next steps look like if we wanted to try it', check: /\w{4,}.*\w{4,}/s,
    parts: ['If we wanted to try it, what would the next steps look like?'] },
  { who: 'user', text: 'I can set up a two week pilot with your escalations team.' },
  { who: 'interviewer', id: 'S11', expect: 'silent', parts: ["Sounds good. Send me the details and I'll share them with the team. Thanks again."] },
];

// Lecture: the user is a student. Long explanation full of rhetorical
// questions the lecturer answers himself must stay quiet; a question put to the
// user by name must be answered; a question thrown to the whole room is either.
export const lecture = [
  { who: 'interviewer', id: 'C01', expect: 'silent', parts: ["Okay everyone, let's get started. Today we're covering database indexing, and specifically how B trees make lookups fast."] },
  { who: 'interviewer', id: 'C02', expect: 'silent', parts: ["So why can't we just scan the table? Because a full scan is linear in the number of rows, and a table with a hundred million rows would take seconds for every query."] },
  { who: 'interviewer', id: 'C03', expect: 'silent', parts: ["A B tree keeps keys sorted in wide nodes. Each node can hold hundreds of keys, so the tree stays very shallow, usually three or four levels even for huge tables."] },
  { who: 'interviewer', id: 'C04', expect: 'either', q: 'can anyone tell me the time complexity of a lookup in a B tree', check: /log/i,
    parts: ['Can anyone tell me the time complexity of a lookup in a B tree?'] },
  { who: 'interviewer', id: 'C05', expect: 'silent', parts: ["Right, it's logarithmic, but with a very large base, which is why it's so fast in practice."] },
  { who: 'interviewer', id: 'C06', expect: 'silent', parts: ["Now, what happens when we insert? The leaf might be full. When that happens, the node splits in two and pushes the middle key up to its parent."] },
  { who: 'interviewer', id: 'C07', expect: 'answer', q: 'Alex, why do you think databases prefer B trees over binary search trees on disk', check: /disk|page|block|I\/O|height|shallow|fan/i,
    parts: ['Alex, you had your hand up earlier. Why do you think databases prefer B trees over binary search trees when the data lives on disk?'] },
  { who: 'user', text: 'Because each node fits a disk page, so you do fewer reads.' },
  { who: 'interviewer', id: 'C08', expect: 'silent', parts: ["Exactly. Every level is one disk read, so a shallow tree means fewer reads. That's the whole trick."] },
  { who: 'interviewer', id: 'C09', expect: 'silent', parts: ["For next week, read chapter seven on hash indexes, and the problem set is due on Friday."] },
  { who: 'interviewer', id: 'C10', expect: 'answer', q: 'Alex, can you explain the difference between a clustered and a non clustered index', check: /cluster/i,
    parts: ['Before we finish, Alex, can you explain the difference between a clustered and a non clustered index?'] },
  { who: 'user', text: 'A clustered index stores the rows in key order, a non clustered one points to them.' },
  { who: 'interviewer', id: 'C11', expect: 'either', parts: ['Any questions before we wrap up?'] },
  { who: 'interviewer', id: 'C12', expect: 'silent', parts: ["Alright, see you all on Thursday."] },
];

// Team meet: several voices on the meeting audio. Asks addressed to the user
// (Alex) must be answered; asks addressed to someone else, status updates and
// decisions must stay quiet.
export const teamMeet = [
  { who: 'interviewer', id: 'M01', voice: 'Samantha', expect: 'silent', parts: ["Morning everyone. Let's do a quick standup and then talk about the payout migration."] },
  { who: 'interviewer', id: 'M02', voice: 'Rishi', expect: 'silent', parts: ["I'll go first. Yesterday I finished the retry dashboard, and today I'm pairing with support on the refund backlog. No blockers."] },
  { who: 'interviewer', id: 'M03', voice: 'Samantha', expect: 'answer', q: 'Alex, how is the payout migration going', check: /\w{4,}.*\w{4,}/s,
    parts: ['Thanks Raj. Alex, how is the payout migration going?'] },
  { who: 'user', text: "It's going well. Half of the merchants are on the new service, the rest move on Thursday." },
  { who: 'interviewer', id: 'M04', voice: 'Samantha', expect: 'answer', q: 'what is the rollback plan if Thursday goes badly', check: /roll|back|flag|revert|old service/i,
    parts: ["Okay. And what's the rollback plan if Thursday goes badly?"] },
  { who: 'user', text: 'We keep the old service warm behind a feature flag, so we can flip merchants back in minutes.' },
  { who: 'interviewer', id: 'M05', voice: 'Karen', expect: 'silent', parts: ["Sam here. From the data side, the reconciliation report is ready, so we can compare old and new payouts daily."] },
  { who: 'interviewer', id: 'M06', voice: 'Samantha', expect: 'silent', parts: ['Raj, can you make sure support knows about the Thursday cutover?'] },
  { who: 'interviewer', id: 'M07', voice: 'Rishi', expect: 'silent', parts: ["Yes, I'll post in their channel today."] },
  { who: 'interviewer', id: 'M08', voice: 'Karen', expect: 'answer', q: 'Alex, do you need anything from the data team before Thursday', check: /\w{4,}/,
    parts: ['Alex, do you need anything from the data team before Thursday?'] },
  { who: 'user', text: 'Just the reconciliation report every morning, thanks.' },
  { who: 'interviewer', id: 'M09', voice: 'Samantha', expect: 'silent', parts: ["Great. So the decision is: we cut over the remaining merchants on Thursday at ten, and Alex owns the rollback."] },
  { who: 'interviewer', id: 'M10', voice: 'Samantha', expect: 'either', parts: ['Does anyone have concerns about that plan?'] },
  { who: 'interviewer', id: 'M11', voice: 'Rishi', expect: 'silent', parts: ["No concerns from me."] },
  { who: 'interviewer', id: 'M12', voice: 'Samantha', expect: 'answer', q: 'Alex, can you estimate how long the rollback would take end to end', check: /minute|hour|second|\d/i,
    parts: ['One more thing. Alex, can you estimate how long a full rollback would take end to end?'] },
  { who: 'user', text: 'About fifteen minutes, most of it waiting for the cache to warm.' },
  { who: 'interviewer', id: 'M13', voice: 'Samantha', expect: 'silent', parts: ["Perfect, thanks everyone. Let's sync again on Friday."] },
];

// Call center: the user is the support agent; the meeting audio is the
// customer. The customer's questions to the agent are asks. A symptom report
// is an implicit request for help, so drafting a diagnosis there is either
// (live 2026-09-27: the judge answered both, and the drafts were exactly what
// an agent wants). Prices and refunds must not be invented.
export const callCenter = [
  { who: 'interviewer', id: 'K01', expect: 'silent', parts: ["Hi, thanks for picking up. My name is Dana, and I'm calling about our company account."] },
  { who: 'interviewer', id: 'K02', expect: 'either', parts: ["So last week we upgraded to the annual plan, and since then my team can't log in to the dashboard. They just see a spinning wheel."] },
  { who: 'interviewer', id: 'K03', expect: 'answer', q: 'Is there something wrong on your side, or is it something we need to fix', check: /\w{4,}.*\w{4,}/s,
    parts: ['Is there something wrong on your side, or is it something we need to fix?'] },
  { who: 'user', text: 'Let me check. Are they signing in with single sign on?' },
  { who: 'interviewer', id: 'K04', expect: 'silent', parts: ['Yes, we use Okta for everyone.'] },
  { who: 'interviewer', id: 'K05', expect: 'either', parts: ['Actually, one of them just tried again, and now it says license limit reached.'] },
  { who: 'interviewer', id: 'K06', expect: 'answer', q: 'What does license limit reached mean, and how do I fix it', check: /licen|seat|user/i,
    parts: ['What does license limit reached mean, and how do I fix it?'] },
  { who: 'user', text: 'It means the plan has fewer seats than active users. I can add seats for you.' },
  { who: 'interviewer', id: 'K07', expect: 'answer', q: 'How much would it cost to add five more seats', check: /\w{4,}/,
    parts: ['How much would it cost to add five more seats?'] },
  { who: 'user', text: "I'll send you the exact price by email right after this call." },
  { who: 'interviewer', id: 'K08', expect: 'silent', parts: ['Okay, that works. My manager will need to approve it anyway.'] },
  { who: 'interviewer', id: 'K09', expect: 'answer', q: "can I get a refund for the days my team couldn't log in", check: /refund|credit|billing|policy|check|confirm/i,
    parts: ["And can I get a refund for the days my team couldn't log in?"] },
  { who: 'user', text: "I'll raise that with billing and get back to you today." },
  { who: 'interviewer', id: 'K10', expect: 'silent', parts: ['Great, thanks so much for your help today.'] },
];

// Recruiting: the user is the RECRUITER; the meeting audio is the candidate.
// The candidate's answers, however long, stay quiet (a rhetorical question
// they answer themselves included); the candidate's questions TO the
// recruiter are asks.
export const recruiting = [
  { who: 'interviewer', id: 'R01', expect: 'silent', parts: ["Hi, thanks for having me. I'm excited to learn more about the role."] },
  { who: 'user', text: 'Great to meet you. Can you walk me through your background?' },
  { who: 'interviewer', id: 'R02', expect: 'silent', parts: ["Sure. I've been a backend engineer for six years, mostly at fintech companies. Most recently I led the payments platform team at a startup of about eighty people."] },
  { who: 'user', text: 'What made you start looking?' },
  { who: 'interviewer', id: 'R03', expect: 'silent', parts: ["Honestly, the company is being acquired, and I want to stay close to product work rather than move into a big org."] },
  { who: 'interviewer', id: 'R04', expect: 'silent', parts: ['Why did I pick payments in the first place? Because I like problems where correctness really matters.'] },
  { who: 'user', text: 'Makes sense. How do you usually handle disagreements with product managers?' },
  { who: 'interviewer', id: 'R05', expect: 'silent', parts: ["I try to get to the underlying goal. Usually we agree on the goal and only disagree on the path, so I'll prototype both options quickly and compare."] },
  { who: 'interviewer', id: 'R06', expect: 'answer', q: 'Can I ask what the salary range is for this role', check: /\w{4,}/,
    parts: ['Can I ask what the salary range is for this role?'] },
  { who: 'user', text: 'Sure, the base range is one fifty to one eighty, plus equity.' },
  { who: 'interviewer', id: 'R07', expect: 'answer', q: 'what does the interview process look like from here', check: /\w{4,}.*\w{4,}/s,
    parts: ['And what does the interview process look like from here?'] },
  { who: 'user', text: 'Next is a technical screen, then an onsite with four sessions.' },
  { who: 'interviewer', id: 'R08', expect: 'answer', q: 'Is the role fully remote, or would I need to be in the office', check: /remote|office|hybrid|\w{4,}/i,
    parts: ['Is the role fully remote, or would I need to be in the office?'] },
  { who: 'user', text: "It's remote, with one team week per quarter." },
  { who: 'interviewer', id: 'R09', expect: 'silent', parts: ['That sounds great. Thanks for your time, I really enjoyed the conversation.'] },
];

// Seminar / thesis defence: the user presented; the committee asks. A
// committee member's own remark and a question to the rest of the committee
// stay quiet.
export const seminar = [
  { who: 'interviewer', id: 'E01', voice: 'Karen', expect: 'silent', parts: ['Thank you for the presentation. We have about twenty minutes for questions from the committee.'] },
  { who: 'interviewer', id: 'E02', voice: 'Karen', expect: 'answer', q: 'Why did you choose those three datasets, and do you think the results generalize', check: /dataset|general/i,
    parts: ['Let me start. Your evaluation uses only three datasets. Why did you choose those three, and do you think the results generalize?'] },
  { who: 'user', text: 'We picked them because they cover different sizes and domains, and the trend held on all three.' },
  // A pointed observation in a defence invites a response: either (live
  // 2026-09-27: the draft explained the gap before E04 even asked for it).
  { who: 'interviewer', id: 'E03', voice: 'Samantha', expect: 'either', parts: ['Okay. I noticed the baseline numbers in table four are lower than the ones reported in the original paper.'] },
  { who: 'interviewer', id: 'E04', voice: 'Samantha', expect: 'answer', q: 'Can you explain that difference', check: /\w{4,}.*\w{4,}/s,
    parts: ['Can you explain that difference?'] },
  { who: 'user', text: 'We re-ran the baselines with the same compute budget as our method, which is lower than the original setup.' },
  { who: 'interviewer', id: 'E05', voice: 'Karen', expect: 'silent', parts: ["I'd like to add to that. The compute budget matters a lot here, so it's good that you controlled for it."] },
  { who: 'interviewer', id: 'E06', voice: 'Samantha', expect: 'answer', q: 'What would you do differently if you had ten times the compute', check: /\w{4,}.*\w{4,}/s,
    parts: ['What would you do differently if you had ten times the compute?'] },
  { who: 'user', text: "I'd scale the ablations and add a larger model to test whether the gain holds." },
  { who: 'interviewer', id: 'E07', voice: 'Samantha', expect: 'silent', parts: ['Those are my questions. Thank you.'] },
  { who: 'interviewer', id: 'E08', voice: 'Karen', expect: 'either', parts: ['Does anyone else on the committee have questions?'] },
  { who: 'interviewer', id: 'E09', voice: 'Karen', expect: 'silent', parts: ["Alright, then we'll deliberate and call you back in about fifteen minutes."] },
];

// General: a casual one-on-one with a manager.
export const general = [
  { who: 'interviewer', id: 'G01', expect: 'silent', parts: ['Hey, thanks for jumping on. I just wanted to catch up quickly before the planning meeting.'] },
  { who: 'interviewer', id: 'G02', expect: 'answer', q: 'How are you feeling about the launch next week', check: /\w{4,}/,
    parts: ['How are you feeling about the launch next week?'] },
  { who: 'user', text: 'Pretty good. The main risk is the migration script.' },
  { who: 'interviewer', id: 'G03', expect: 'silent', parts: ["Yeah, I heard the migration took four hours in staging. That's longer than we planned."] },
  { who: 'interviewer', id: 'G04', expect: 'answer', q: 'What do you think we should do about it', check: /\w{4,}.*\w{4,}/s,
    parts: ['What do you think we should do about it?'] },
  { who: 'user', text: 'We could run it in batches overnight.' },
  { who: 'interviewer', id: 'G05', expect: 'silent', parts: ["I like that. I'll mention it in planning, and we can decide there."] },
  { who: 'interviewer', id: 'G06', expect: 'answer', q: 'can you remind me what the difference between a canary release and a blue green deployment is', check: /canary/i,
    parts: ['By the way, can you remind me what the difference between a canary release and a blue green deployment is?'] },
  { who: 'user', text: 'A canary sends a small share of traffic to the new version first; blue green switches all traffic at once.' },
  { who: 'interviewer', id: 'G07', expect: 'silent', parts: ["Cool, that's helpful. Talk to you later."] },
];

export const SCRIPTS = { ti: technicalInterview, lfw: lookingForWork, sales: salesCall, lecture, team: teamMeet, call: callCenter, recruit: recruiting, seminar, general };
