# Related work: reading notes (MT)

Last edited 14 August 2026. Rough notes for the background section of the paper. Not for sharing.

READ THIS FIRST: everything below is OTHER groups' systems and OTHER groups' numbers, measured on THEIR data. None of it was run on the Brackenfirth data. Do not mix any of it with our own results.

## Corvane-Net (Ostrander group, Pellworth University, 2025)

- Graph neural network over the BMS equipment graph (which sensor and actuator belongs to which duct, coil and zone).
- Their data: the Larkhill office campus, 22 office buildings, 140 AHUs, 11 months of trend logs.
- They report an F1 of 0.94 and a median detection delay of 19 minutes.
- All of their faults are injected. No naturally occurring faults at all. Six fault classes, including economiser faults that we do not have.
- They do not report false alarms per unit. Precision only.
- We did not run Corvane-Net on our data. Two reasons: (1) there is no public code; I emailed Dr Ostrander on 12 February 2026 and had no reply; (2) it needs the equipment graph, and the Brackenfirth BMS cannot export one.
- So no head-to-head exists. Their figure is on offices with injected faults, ours is on schools with mostly natural faults; the two are not comparable, and nobody knows which method would win on the same buildings.

## MineRule-V (Sable and Ilvesmaa, Dunmere Facilities Research Unit, 2024)

- Mines association rules from historical alarm logs, then ranks violations of those rules.
- One university laboratory complex, 35 AHUs, a lot of fume-cupboard extract. Nothing like classrooms.
- Reported F1 of 0.58. Delays are in hours (median 3.4 hours) because it works on alarm logs, not on trend data.
- Useful for the alarm-fatigue argument. Not a comparator.

## AeroFormer (Vantongeren lab, 2025)

- Transformer encoder over raw trend data.
- Simulation only: 8 simulated units and one simulated year of weather.
- Reported F1 of 0.97. No real-building results. Reviewers like to cite it; I think simulated faults are too clean to mean much.

## CrossEstate study (Hesketh-Mbeki consortium, 2025)

- A residual-based detector, not ours: regression residuals with fixed thresholds.
- Validated across three sites: a retail park (their home site), a further-education college and an office tower.
- F1 of 0.75 on the home site, 0.59 averaged over the two external sites.
- The clearest evidence I know of that single-site numbers shrink when a detector moves. Worth citing when we discuss transfer.

## Tolland Open AHU Corpus (public data)

- Public trend data from 3 sites, 67 units, one-minute resolution, with a fault log.
- A candidate for an external check in a journal version. The conversion script for their point naming is not written.

## Quillfeather drift monitor (Quillfeather and Adeyemi-Strand, 2023)

- CUSUM on pairs of redundant temperature sensors, aimed only at sensor drift.
- Needs duplicate sensors, which most school units lack. They report catching drift of 0.5 °C within 3 days on a laboratory rig.
- Possible starting point for a drift-specific residual.

## Harwell rule catalogue

- The classic expert-rule catalogue for central air systems. The vendor rules in the estate's BMS descend from it.
- Cite for the rule-based baseline.

## Conformal methods: background

- Validity needs exchangeability. Seasonal data break that. Other authors handle it with weighted or rolling calibration; nobody I found proves anything for building data.
- So for buildings it is a calibrated heuristic, not a guarantee, and the false-alarm rate has to be checked empirically on data the detector has not seen.

## To chase

- Ostrander reply about code.
- A 2026 preprint from the Pellworth group says Corvane-Net v2 runs without the equipment graph. Not read yet; do not cite.
- Ask Odalys whether the Hesketh-Mbeki numbers are per site or pooled.
