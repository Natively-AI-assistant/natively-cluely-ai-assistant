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

export const SCRIPTS = { ti: technicalInterview };
