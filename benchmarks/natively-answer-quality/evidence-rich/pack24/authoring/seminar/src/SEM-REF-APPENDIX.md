# Supplementary Material

**TERN: Calibrated Fault Detection for School Air-Handling Units from Thermal-Balance Residuals and Conformal Change Detection**

Thornquist, Raskinen and Brennecke. Supplement to the camera-ready paper, SBSA 2026. Version of 11 September 2026.

## A.1 Thermal-balance parameters

The 7 parameters fitted per unit are: damper leakage fraction, damper characteristic exponent, coil effectiveness at design flow, coil flow exponent, valve authority, fan pressure coefficient, and a supply-air sensor offset. Fitting uses the 42-day commissioning window at one-minute resolution, restricted to occupied hours (07:00 to 17:30 on school days). Across the 86 units, the median root-mean-square error on the commissioning window was 0.6 °C for the mixed-air balance and 0.9 °C for the coil outlet balance. Units whose fit error exceeded 2.0 °C were refitted after removing the first week of the window; this applied to 4 units.

## A.2 Hyperparameters

All hyperparameters were chosen by grid search on the nine development buildings. The held-out buildings were not used for any of these choices.

| System | Setting | Value |
|---|---|---|
| TERN | Aggregation window | 15 minutes |
| TERN | Rolling calibration window | 14 days |
| TERN | Significance level | 0.01 |
| TERN | Alarm threshold on the martingale | 100 |
| TERN | Persistence before an alarm | 10 minutes |
| TERN | Merge gap between alarms | 60 minutes |
| LSTM-AE | Architecture | 2 layers, 64 hidden units |
| LSTM-AE | Input window | 120 minutes |
| LSTM-AE | Training | 40 epochs, learning rate 0.001, batch size 256 |
| LSTM-AE | Alarm threshold | 99th percentile of reconstruction error |
| PCA-T2 | Components kept | 9 components (95% of variance) |
| PCA-T2 | Alarm threshold | 99th percentile of T² |
| RB-28 | Rules | 28 rules, vendor default thresholds |
| RB-28 | Delay timers | 30-minute timers on 17 of the rules |

LSTM-AE has 2 layers with 64 hidden units and reads a 120-minute input window; it was trained for 40 epochs. It was trained with 5 random seeds per unit. The paper reports the mean over seeds; the standard deviation of its F1 across seeds was 0.012. TERN and RB-28 are deterministic. In RB-28, 17 of the 28 rules wait on a 30-minute delay timer before they fire.

## A.3 Exclusion criteria

**Units.** Of the estate's 93 units, 7 were excluded because more than 20% of their one-minute samples were missing: 4 had failed trend loggers and 3 were decommissioned during the collection period.

**Episodes.** Of 560 candidate episodes, 41 lasted less than 10 minutes and were removed as likely logging artefacts, and 11 contained two overlapping faults.

**Time.** The summer shutdown from 21 July to 29 August 2025 was removed for all units, as were logger outages longer than 6 hours. Gaps of up to 5 minutes were filled by linear interpolation.

**Injected faults.** Injections were carried out by the estate's lead technician on 9 units, 54 in development buildings and 42 in held-out buildings. Each injected fault lasted between 2 and 6 hours.

## A.4 Sensitivity to the significance level

Held-out buildings, all other settings as in the paper.

| Significance level | F1 | Median delay (minutes) | False alarms |
|---|---|---|---|
| 0.05 | 0.85 | 26 | 31 |
| 0.01 (used in the paper) | 0.87 | 34 | 16 |
| 0.005 | 0.86 | 43 | 11 |

At a significance level of 0.05 the median delay drops to 26 minutes but false alarms rise to 31, roughly twice as many. At 0.005 false alarms fall to 11 while the median delay grows to 43 minutes. The F1 changes little: 0.85 at the looser level and 0.86 at the stricter one, against 0.87 at the level used in the paper.

## A.5 Length of the commissioning window

| Commissioning window | F1 on held-out buildings |
|---|---|
| 2 weeks | 0.77 |
| 4 weeks | 0.85 |
| 6 weeks (used in the paper) | 0.87 |
| 8 weeks | 0.87 |

With a two-week window the F1 is 0.77 and with four weeks it is 0.85. The gain flattens after six weeks: an eight-week window gives the same F1 of 0.87, so six weeks was chosen as the least data that reaches it.

## A.6 Results by held-out building

| Building | Units | Episodes | F1 | Median delay (minutes) |
|---|---|---|---|---|
| Aldergate Primary | 5 | 27 | 0.93 | 28 |
| Fenwick Hollow Secondary | 9 | 61 | 0.87 | 31 |
| Marrowby Infants | 4 | 19 | 0.80 | 44 |
| Quarrelton Academy | 8 | 52 | 0.86 | 36 |
| Tessel Lane Primary | 5 | 28 | 0.89 | 39 |

Marrowby Infants, where TERN scored an F1 of 0.80, has the oldest controllers in the estate and the fewest episodes. Aldergate Primary gave the highest F1, 0.93.

## A.7 Paired comparison of delays

On the 139 episodes detected by both TERN and LSTM-AE, TERN raised its alarm first in 104. The median paired difference was 15 minutes in TERN's favour (Wilcoxon signed-rank, p < 0.001).

## A.8 Pilot details

The four pilot buildings were Hollin Bank Primary, Skerrow Secondary, Withenshaw Primary and Calder Yew Infants. Of the 63 alerts, 51 were acted on within two working days, 9 were acted on later, and 3 were dismissed by staff as not worth a visit. Heating energy was read from the estate's gas meters and normalised by heating degree-days to a base temperature of 15.5 °C. Skerrow Secondary is the building whose boiler was replaced in August 2025. With Skerrow Secondary left out, the reduction in the three remaining pilot buildings was 5.2%.

## A.9 The false-alarm limit in the paper's units

The facilities team expressed its tolerance as one false alarm per unit per school term. Taking a term as four months, that limit is equivalent to 25 false alarms per 100 unit-months, the unit used in the paper and in the results table.
