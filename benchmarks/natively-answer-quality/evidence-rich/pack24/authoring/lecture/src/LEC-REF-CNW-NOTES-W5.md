# CNW 2140 Computer Networks: lecturer's notes, week 5

Dr. Oleska Brantigern. These are my own running notes for lecture 9, posted after the session. They fill in what I said aloud and correct anything I said too loosely. They do not replace the slides. Lecture 10 will get a file of its own.

Last edited: Friday 9 October 2026.

## Lecture 9 (Tuesday 6 October 2026): IP addressing and subnets

All term our addresses come out of one block, the campus block: 10.40.0.0/16.

**How we count hosts.** A prefix of length p leaves 32 - p bits for the host part. In CNW 2140 the number of usable hosts in a subnet equals two raised to the number of host bits, less two: we take off the all-zeros address, which names the subnet itself, and the all-ones address, which is the broadcast. Some books do not subtract. We always do. If an exam wants the number of addresses and not the number of usable hosts, it will say addresses.

**The campus plan.** This is the plan from the slide, with the arithmetic done.

| Subnet | Used for | Usable hosts |
|---|---|---|
| 10.40.0.0/24 | servers | 254 |
| 10.40.8.0/22 | teaching labs in Hale-Voss | 1,022 |
| 10.40.16.0/20 | staff offices | 4,094 |
| 10.40.64.0/18 | halls of residence | 16,382 |
| 10.40.128.0/23 | library and study rooms | 510 |

Everything else in the block is either unallocated or used for things I left off the slide.

**Worked example A: the four lab rooms.** The teaching labs have 10.40.8.0/22, which runs from 10.40.8.0 to 10.40.11.255. Each of the four lab rooms gets a /24 of its own: 10.40.8.0/24, 10.40.9.0/24, 10.40.10.0/24 and 10.40.11.0/24. Each room then has 254 usable hosts. We borrowed two bits and got four subnets; cutting a /22 into /24s is nothing more than that.

**Worked example B: benches.** Inside one room we wanted a small subnet for every bench of machines. A /28 keeps four bits for the host part: 16 addresses, 14 usable hosts. One /24 holds 16 subnets of that size. The first three in the first room are 10.40.8.0/28, 10.40.8.16/28 and 10.40.8.32/28.

**Worked example C: which subnet am I in?** Take the host 10.40.9.93. With the room's /24, the first 24 bits name the subnet, so the subnet is 10.40.9.0/24 and its broadcast address is 10.40.9.255. With the bench-sized /28 the same host sits in 10.40.9.80/28, because 93 falls between 80 and 95.

**Masks.** The slash is shorthand for the mask. A /24 is 255.255.255.0, a /22 is 255.255.252.0 and a /28 is 255.255.255.240. I will always write the slash. The old equipment in the Annex still wants the dotted form, so you need to be able to go both ways.

**Longest prefix wins.** A router looks a destination up in its forwarding table and may find more than one row that matches. It takes the row with the longest prefix. On the slide the campus border router had a row for 10.40.0.0/16 (send inside), a row for 10.40.8.0/22 (send to Hale-Voss) and a default row. A packet for 10.40.9.93 matches all three and goes to Hale-Voss. How the rows get into the table is the next lecture's business, not this one's.

**Joining subnets together.** The same idea run backwards: the four room subnets can be advertised to the rest of the campus as the single prefix 10.40.8.0/22. One row in everybody else's table in place of four. This only works because the four are neighbours and fill the /22 exactly.

**The IP header, as we use it.** In this course an IP header is 20 bytes: we never use options. Three fields matter for the exercises: the total length, the fragment offset with its more-fragments flag, and the hop limit. The header calls the hop limit TTL. It is counted in routers passed, not in seconds, and it has nothing to do with the DNS TTL of week 3. In our examples a packet leaves its host with a hop limit of 16. In the demo, the trace from the lab room to the portal showed 5 routers on the way.

**Fragmentation, the course version.** Every link has an MTU: the largest IP packet it will carry, header included. Our rules:

- The lab Ethernet has an MTU of 1,500 bytes. The old serial link to the Annex has an MTU of 620 bytes.
- A router that has to send a packet over a link with a smaller MTU cuts the packet's payload into fragments. Each fragment gets a 20-byte IP header of its own.
- Every fragment except the last carries a payload that is a multiple of 8 bytes, and as much of it as the MTU allows.
- Only the IP payload is cut up. Whatever the packet was carrying, a TCP header included, is just payload to the router. In this course a TCP header is 20 bytes, again with no options.
- Fragments are put back together at the destination host, never by a router on the way.

Slide example: a 1,500-byte packet arrives at the router for the Annex. Its payload is 1,480 bytes. Each fragment can carry 600 bytes, so the payload goes out as 600, 600 and 280. That makes three fragments, of 620, 620 and 300 bytes on the wire.

**Addresses with a special meaning.** Three to know. 127.0.0.1 is the machine talking to itself and never leaves it. 0.0.0.0 is what a laptop calls itself before it has been given an address. 255.255.255.255 is the broadcast to everything on the local link, and no router passes it on.

**Worked example D: how many bits do I borrow?** The halls asked for five separate subnets out of their /18, one for each building. Two borrowed bits give four subnets, which is too few. Three borrowed bits give eight, which is enough, with three to spare. Three borrowed bits turn the /18 into /21s, and each /21 has 2,046 usable hosts. Always round the number of subnets up to a power of two, and say what you did with the spares.

**Private addresses and the border.** 10.0.0.0/8 is private space, so no address in the campus block can be reached from outside as it stands. The border router rewrites source addresses on the way out. Address translation comes back later in the term. For now remember only that a private address tells you nothing about how well a machine is protected.

**How a laptop gets its address.** DHCP hands out addresses from the subnet you plug into. Leases in the teaching labs last 90 minutes; leases in the halls last 12 hours. That is why your laptop has one address in the lab and another in your room, and why I keep saying that an IP address names a place on the network, not a machine.

**Things I said too loosely.**

"A /24 has 256 hosts." It has 256 addresses and 254 usable hosts. Use the house count.

"The mask tells you the class of the network." Classes went out in the 1990s. A prefix can be any length from 0 to 32, and nothing about the first octet fixes it.

"The next router reassembles the fragments." No. Fragments travel separately all the way and are reassembled only at the destination. If one fragment is lost, the whole packet is lost.

"Subnetting wastes addresses." Under our count every subnet uses up two addresses. Sixteen bench subnets in a /24 give 224 usable hosts where the undivided /24 gave 254. Whether that is waste depends on what you wanted the benches kept apart for.

## Practice before the lab session

1. How many usable hosts does 10.40.128.0/23 have, and what is its broadcast address? (510; 10.40.129.255.)
2. Cut 10.40.16.0/20 into /22s. How many do you get, and which is the third? (Four; 10.40.24.0/22.)
3. A 980-byte packet meets the Annex link. How many fragments, and how long is the last one on the wire? (Two; 380 bytes.)
4. Which row does the border router use for a packet to 10.40.200.7? (The /16 row. It is the longest prefix that matches.)

## What the lab session will ask

You will be given a block and a list of rooms with the number of machines in each, and asked for a plan: a prefix for every room, with the first and last usable address and the broadcast address. Largest room first. Then a second sheet with three packets and the Annex link, for fragment counts and sizes. Neither sheet is assessed; they are there so that the arithmetic stops being the hard part.

## Housekeeping

**Lab 4.** One thing to get right in your resolver: truncation. If a reply comes back cut short, repeat the query over TCP, as in the week 3 notes. One of the hidden names is there to check exactly that, and a resolver without the retry will lose it.

**Addresses in lab reports.** Write prefixes with the slash, and give usable-host counts by the house count. A bare 256 with no word after it will be read as a host count and marked wrong.

**Slides.** The deck for lecture 9 on the course site is v2. In v1 the halls prefix on the plan slide was wrong.
