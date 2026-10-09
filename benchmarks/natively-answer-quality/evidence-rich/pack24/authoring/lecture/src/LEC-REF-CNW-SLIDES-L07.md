# CNW 2140 Computer Networks

## Lecture 7: TCP congestion control

Dr. Oleska Brantigern, School of Computing, Tarnhollow University

Tuesday 29 September 2026. Slide deck v3, exported with presenter remarks.

---

### Slide 1. Where we are

- Lecture 6 treated the transport as a pipe that just works. Today we open the pipe.
- Flow control protects the receiver (rwnd). Congestion control protects the network (cwnd).
- A sender keeps at most min(cwnd, rwnd) of unacknowledged data in flight.
- Nobody tells the sender how much capacity the path has. It has to find out by probing.

Presenter remarks: open with the 1986 collapse story. Two sites 400 yards apart, throughput down from 32 kbit/s to 40 bit/s. That is why this lecture exists.

### Slide 2. House conventions for CNW 2140

- cwnd and ssthresh are counted in segments, never in bytes.
- One segment carries one MSS. In every worked example in this course the MSS is 1,200 bytes.
- The initial window (IW) is 2 segments. Older textbooks start from 1 and many current servers start from 10; we use 2 so the arithmetic stays small.
- Time is counted in rounds. One round is one RTT: send a window, collect its ACKs.
- The receiver window is assumed large enough never to matter.

### Slide 3. Slow start

- Begin at IW. Every ACK grows cwnd by one segment, so cwnd doubles each round.
- Slow to start, not slow to grow. The name compares it with what senders did before 1988: open with the whole receiver window at once.
- Slow start ends when cwnd reaches ssthresh or when a loss is detected, whichever comes first.
- Clamp rule: slow start never overshoots the threshold. Next cwnd = min(2 x cwnd, ssthresh).

Presenter remarks: they always assume slow start is the cautious phase. It is the aggressive one. Say it twice.

### Slide 4. Congestion avoidance

- At or above ssthresh: additive increase, +1.
- The sender is now feeling for spare capacity instead of racing towards it.
- ssthresh is the sender's memory of roughly where trouble began last time.
- The sender stays in this phase until a loss signal arrives.

### Slide 5. Loss signals

- Mild signal: three duplicate ACKs. One segment went missing but later ones are still getting through.
- After three duplicate ACKs: set ssthresh = cwnd / 2, then cwnd = ssthresh, and carry on in congestion avoidance.
- Severe signal: the retransmission timer expires. Nothing is getting through.
- After a timeout: set ssthresh = cwnd / 2, then cwnd = IW, and go back to slow start.
- Halves are rounded down, and ssthresh is never set below 2 segments.
- Course simplification: full Reno briefly inflates the window by 3 segments during fast recovery. We skip that step. In CNW 2140 the window lands on the new ssthresh in one move.

### Slide 6. The lecture 7 trace

Setup: IW = 2 segments, initial ssthresh = 16 segments, MSS = 1,200 bytes, RTT = 80 ms.

- Round 1: cwnd = 2 (slow start)
- Round 2: cwnd = 4 (slow start)
- Round 3: cwnd = 8 (slow start)
- Round 4: cwnd = 16 (slow start reaches ssthresh)
- Round 5: cwnd = 17 (congestion avoidance)
- Round 6: cwnd = 18
- Round 7: cwnd = 19
- Round 8: cwnd = 20; three duplicate ACKs arrive in this round
- Round 9: cwnd = 10, ssthresh = 10 (congestion avoidance continues)
- Round 10: cwnd = 11
- Round 11: cwnd = 12; the retransmission timer expires in this round
- Round 12: cwnd = 2, ssthresh = 6 (slow start again)
- Round 13: cwnd = 4
- Round 14: cwnd = 6 (clamped, because doubling would overshoot)
- Round 15: cwnd = 7 (congestion avoidance)

Lab 3 starts from this trace and asks you to extend it by ten rounds.

### Slide 7. Average throughput of the sawtooth

- In steady state the window swings between W / 2 and W, where W is the window at which loss occurs.
- The average window is therefore 0.75 x W.
- Formula used in this course: throughput = 0.75 x W x MSS / RTT.
- Slide example: W = 20 segments, MSS = 1,200 bytes, RTT = 80 ms. Average window 15 segments, 18,000 bytes per round, 225,000 bytes per second, which is 1.8 Mbit/s.
- We do not use the square-root loss formula (Mathis and colleagues) in this course. It is on the further reading list only.

### Slide 8. The retransmission timer

- Smoothed RTT: SRTT = 7/8 x SRTT + 1/8 x sample.
- Variation: RTTVAR = 3/4 x RTTVAR + 1/4 x the absolute difference between SRTT and the sample.
- Timeout value: RTO = SRTT + 4 x RTTVAR.
- Slide example: SRTT = 80 ms and RTTVAR = 15 ms give RTO = 140 ms.
- Each time the timer expires, the RTO doubles (exponential backoff).
- Course convention: in exercises we ignore the 1-second minimum RTO that real stacks apply.

### Slide 9. Why additive increase, multiplicative decrease

- Two flows sharing one bottleneck drift towards equal shares: both add the same amount, but the larger one loses more when both halve.
- Picture to remember: the staircase and the cliff. Climb one step per round; fall half the height on a loss.
- AIMD is fair.
- A sender that ignores the rules gains in the short term and wrecks the path for everyone, itself included.

### Slide 10. Before Thursday

- Lecture 8: TCP reliability and retransmission.
- Reading: Halloway and Minch, Networks from the Wire Up, sections 6.3 to 6.5.
- Bring a laptop with the capture tool installed for the lab session.
