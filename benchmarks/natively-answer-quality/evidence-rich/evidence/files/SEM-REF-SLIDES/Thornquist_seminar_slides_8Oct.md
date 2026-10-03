---
title: "TERN: catching air-handling faults in schools before anyone complains"
author: Maelis Thornquist
event: Built Environment Research Seminar, Kestrelmoor Institute of Technology
date: 8 October 2026
---

# TERN: catching air-handling faults in schools before anyone complains

Maelis Thornquist, Halvard Laboratory for Building Analytics

Joint work with Juho Raskinen and Odalys Brennecke

Built Environment Research Seminar, Thursday 8 October 2026, room G.14. 25-minute talk, then 15 minutes of discussion.

---

## 1. Nobody reads the alarms

- Brackenfirth school estate, school year 2023–24: 2,317 alarms from the rule engine
- 68% closed with no action taken
- "If unit 3 alarms again I don't even open it." (facilities technician, site visit, March 2025)
- Meanwhile real faults run for weeks: wasted heat, stale classrooms

Speaker note: start with the story of the damper at the infants' school that was stuck open all winter.

---

## 2. What goes wrong in an air-handling unit

- Stuck outdoor-air damper
- Leaking heating-coil valve
- Slipping fan belt
- Supply-air sensor drift
- Fouled filter

The unit keeps running in every case. That is the problem.

---

## 3. The idea in one line

Model the heat balance of each unit, then watch the leftovers with a detector whose false-alarm rate we can set.

---

## 4. Stage one: thermal balance

- Three balances: mixing box, heating coil, supply fan
- 7 parameters per unit, fitted on six weeks of ordinary operation
- Weather and occupancy are explained away; what is left is the equipment
- No labelled faults needed for a new unit

---

## 5. Stage two: conformal change detection

- Residuals become calibrated p-values
- Calibration set rolls forward: the unit's own last 14 alarm-free days
- Facilities team's limit: one false alarm per unit per term
- Caveat I will say out loud: the theory wants exchangeable data, buildings are seasonal. Rolling calibration is a remedy, not a proof.

---

## 6. Stage three: which part is it?

- Each residual belongs to one physical balance
- The pattern of residuals names the component
- Technicians get "look at the valve", not "anomaly score 4.2"

---

## 7. Data

- 14 schools, 86 units, 17 months, one-minute data
- 508 fault episodes: 412 from work orders, 96 injected in the holidays
- Split by whole building: 9 for development, 5 held out
- Held out: 31 units, 187 episodes

---

## 8. Headline results (held-out buildings)

| | F1 | Median delay | False alarms |
|---|---|---|---|
| TERN | 0.87 | 34 min | 16 |
| LSTM autoencoder | 0.79 | 52 min | 49 |
| Rule set (RB-28) | 0.71 | 126 min | 34 |
| PCA-T2 | 0.66 | 74 min | 77 |

- TERN finds 157 of 187 faults
- Correct component named for 81.5% of detected faults

---

## 9. What each stage buys

- Without thermal balance: F1 0.74, 38 false alarms
- Without conformal stage: quicker (29 min) but 44 false alarms
- Without rolling calibration: F1 0.84, 27 false alarms
- Take-away: physics buys detection, calibration buys quiet

---

## 10. Can we believe it?

- Whole buildings held out; nothing tuned on them
- 95% interval on F1: 0.83 to 0.90
- All 16 false alarms re-inspected by the lead technician: 5 were real, unlogged faults
- Every held-out building is at 0.80 or above

---

## 11. Live pilot

- Four buildings, 3 November 2025 to 9 January 2026
- 63 alerts, 51 acted on within two working days
- Heating energy per degree-day: 6.8% lower than the year before (other ten buildings: 1.9%)
- Association, not cause: buildings were picked by the facilities team, and one had a new boiler

---

## 12. Limits

- Daytime occupancy only, one mild climate
- Five fault classes, one fault at a time
- Sensor drift is the weak spot: recall 0.64
- Work-order labels are incomplete
- Commissioning weeks assumed fault-free

---

## 13. Next

- Overlapping faults
- A dedicated residual for slow sensor drift
- Stepped roll-out across 12 buildings in the 2026–27 heating season, with the switch-on order drawn at random, so that the energy effect can be estimated properly
- Journal version in spring 2027

---

## 14. Discussion

Thank you. Funded by the Northmarch Energy Trust. Thanks to the Brackenfirth facilities team.

---

## Backup A: settings

- Significance level 0.01, alarm when the martingale passes 100 and holds for 10 minutes
- Residuals averaged over 15 minutes
- Autoencoder baseline: 2 layers, 64 hidden units, 120-minute window

## Backup B: recall by fault class (TERN)

- Stuck damper 0.93
- Leaking valve 0.88
- Fan belt 0.88
- Fouled filter 0.79
- Sensor drift 0.64
