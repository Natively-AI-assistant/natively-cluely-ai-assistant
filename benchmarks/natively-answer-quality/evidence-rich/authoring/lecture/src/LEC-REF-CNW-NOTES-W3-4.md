# CNW 2140 Computer Networks: lecturer's notes, weeks 3 and 4

Dr. Oleska Brantigern. These are my own running notes for lectures 5 to 7, posted after each session. They fill in what I said aloud and correct anything I said too loosely. They do not replace the slides.

Last edited: Wednesday 30 September 2026.

## Lecture 5 (Tuesday 22 September 2026): DNS

All term we resolve the same name: portal.tarnhollow.example.

The cast, in the order a lookup meets them:

1. The stub resolver on your laptop. It sends one recursive query and waits.
2. The campus recursive resolver at 10.40.0.53. It does the legwork iteratively.
3. A root server, which refers the resolver to the servers for .example.
4. The .example TLD server, which refers it to the zone's own name server.
5. The authoritative server for the zone, ns1.tarnhollow.example, which holds the record.

**How we count.** A cold lookup, with nothing cached anywhere, costs 4 queries in CNW 2140: laptop to campus resolver, resolver to root, resolver to TLD, resolver to authoritative. Several textbooks give 8 for the same exchange because they count the replies as well. We count queries only. If an exam wants messages rather than queries, it will say so.

**The record in the example.** The authoritative server returns an A record, 203.0.113.48, with a TTL of 300 seconds. In the lecture I said "think five minutes" and a few of you wrote that down as a property of DNS. It is not. The 300 seconds belongs to this one record and was chosen by whoever runs the zone. In the same example the NS records for tarnhollow.example carry a TTL of 86,400 seconds, a full day.

**Warm lookups.** While the A record is still within its TTL the campus resolver replies from its cache: 1 query from the laptop, none upstream. Once the A record has expired but the NS records are still cached, the resolver skips the root and the TLD and goes straight to ns1.

**Names that do not exist.** A reply of NXDOMAIN is cached too. In our zone the negative-caching time is 900 seconds, taken from the SOA record.

**The alias.** www.tarnhollow.example is a CNAME pointing at portal.tarnhollow.example. In our example it costs no extra query, because the same authoritative server holds both records and returns the CNAME and the A record in one reply. With the alias in a different zone you would pay for a second chain of referrals.

**"DNS is UDP."** I said this and it needs a footnote. Queries go to port 53 over UDP by default. If a reply would exceed 1,232 bytes (the limit we use in this course), the server sets the TC flag and the resolver repeats the query over TCP. Zone transfers between name servers always use TCP.

Housekeeping: the sandbox resolver for Lab 4 is at 10.40.0.54. Do not point your laptop at it for everyday use; it empties its cache every 60 seconds on purpose.

## Lecture 6 (Thursday 24 September 2026): HTTP

The page we load all term is the timetable page on the portal: one HTML file plus 11 embedded objects (8 images, 2 scripts, 1 stylesheet), so 12 objects in all.

**How we count round trips.** Opening a TCP connection costs 1 RTT. Each request with its response costs 1 RTT. We ignore TLS and we ignore transmission time until lecture 12. In the lecture the RTT was 50 ms.

- Non-persistent, one object at a time: every object pays for its own connection, 2 RTT each. Twelve objects make 24 RTT, which is 1,200 ms.
- Persistent, no pipelining: one handshake, then one round trip per object. That is 13 RTT, or 650 ms.
- Parallel non-persistent connections: the browser fetches the HTML first, on its own connection, then opens up to 6 connections at a time for the embedded objects. Each batch costs 2 RTT. I left the total for you to work out before the lab.

**Status codes in the demo.** The short address /tt replied 301 Moved Permanently and sent us to /timetable. The second load of the stylesheet replied 304 Not Modified, because the browser sent If-None-Match with the ETag "v7-a41c" and the file had not changed. I also showed a 503 from enrolment week, when the portal was overloaded.

**Caching.** The stylesheet carries Cache-Control: max-age=600, so for ten minutes the browser does not even ask. After that it revalidates with the ETag.

**"HTTP is stateless, full stop."** Too strong. The protocol is stateless: the server is not required to remember anything between two requests. The portal still knows who you are because your browser sends the sid cookie back with every request. The state lives in the cookie and in the server's session store, not in HTTP itself.

**HTTP/2 and later.** HTTP/2 multiplexes many streams over one connection, which removes the 6-connection juggling, but one lost TCP segment still stalls every stream. HTTP/3 over QUIC is lecture 12 and will not be on the midterm.

## Follow-ups from lecture 7 (TCP congestion control), added 30 September

**"+1" on the congestion avoidance slide.** Plus one segment per round, meaning per RTT. Not per ACK. Per ACK the growth is 1/cwnd of a segment, which adds up to one segment once a whole window has been acknowledged.

**"The window is 20."** In the throughput example, 20 is the peak: the window at which the loss happens. It is not the average and it is not the starting value.

**"AIMD is fair."** Fair between flows with similar round-trip times. A flow with a shorter RTT climbs its staircase more often and ends up with the larger share.

**Midterm scope.** The midterm covers everything up to and including lecture 7. Lecture 8 will be examined in the final only.
