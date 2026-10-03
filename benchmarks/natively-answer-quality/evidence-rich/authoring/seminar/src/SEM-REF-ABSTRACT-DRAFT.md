# DRAFT: abstract for SBSA 2026

**Status: DRAFT v0.3, 20 March 2026. Not for circulation outside the group.**

Working title: Physics-residual conformal detection of air-handling faults in school buildings

Authors (order to be agreed): M. Thornquist, J. Raskinen, O. Brennecke

Submission: abstract due 10 April 2026, limit 250 words. Full paper due 29 May 2026.

## Abstract (v0.3)

Faults in air-handling units (AHUs) go unnoticed for weeks in school buildings, while rule-based alarms are ignored because most of them are false. We propose a detector that fits a small thermal-balance model to each unit and applies conformal change detection to the model's residuals, so that the false-alarm rate can be set in advance. Using 17 months of one-minute data from 86 AHUs in 14 school buildings, with whole buildings held out for evaluation, the detector reaches an F1 of 0.82 and a median detection delay of 48 minutes, well under half the delay of the rule set currently running in the estate. It needs no labelled faults for a new unit, only six weeks of normal operation. We also outline a live pilot in four buildings; energy results will follow in the full paper.

Keywords: fault detection, air-handling units, conformal prediction, grey-box model, schools

## Notes to co-authors

- Juho: these numbers are from the March run (pipeline 0.6), before your change to the calibration window and before we drop the very short episodes. Expect both figures to move. I will not submit until the re-run is in.
- Odalys: do we lead with the delay or with the false alarms? Reviewers at SBSA tend to care most about alarm load.
- The method has no name yet. Candidates: TERN, KITE, ResiCon. I lean towards TERN.
- Baselines: only the rule set has been run so far. The autoencoder and PCA are still to do, so no baseline numbers go in the abstract yet.
- Pilot: gas meter data for the pilot buildings arrive in April. Nothing on energy in the abstract until we have seen them.
- If the abstract runs over the limit, cut the sentence about the pilot first.

## Change log

- v0.1, 2 March 2026: first outline, no numbers.
- v0.2, 11 March 2026: dataset sentence added.
- v0.3, 20 March 2026: figures from the March run inserted.
