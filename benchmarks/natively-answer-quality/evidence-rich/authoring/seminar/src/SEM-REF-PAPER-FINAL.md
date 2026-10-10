# TERN: Calibrated Fault Detection for School Air-Handling Units from Thermal-Balance Residuals and Conformal Change Detection

**Maelis Thornquist, Juho Raskinen, Odalys Brennecke**

Halvard Laboratory for Building Analytics, Kestrelmoor Institute of Technology

Camera-ready version, 11 September 2026. Accepted for the Proceedings of the 9th Symposium on Building Systems Analytics (SBSA 2026).

## Abstract

Air-handling units (AHUs) in school buildings can run in a faulty state for weeks before anyone notices, and the rule engines shipped with building management systems raise so many alarms that staff stop reading them. We present TERN, a fault detection and isolation method that combines a small thermal-balance model of each unit with a conformal change detector applied to the model's residuals. We evaluate TERN on 17 months of one-minute data from 86 AHUs in 14 school buildings of the Brackenfirth estate, holding out five whole buildings (31 units, 187 labelled fault episodes) for the final evaluation. On the held-out buildings TERN reaches an F1 of 0.87 (precision 0.91, recall 0.84) with a median detection delay of 34 minutes and 16 false alarms. The estate's incumbent rule set reaches an F1 of 0.71 with a median delay of 126 minutes, and an LSTM autoencoder reaches 0.79 and 52 minutes. In a ten-week live pilot in four buildings, weather-normalised heating energy fell by 6.8%, against 1.9% in the remaining ten buildings; the pilot was not randomised and we report this as an association only.

## 1 Introduction

Most school buildings in temperate climates are ventilated and heated through air-handling units (AHUs). When a damper sticks, a valve leaks or a sensor drifts, the unit usually keeps running, and the fault wastes heat or starves rooms of fresh air until the next service visit.

Building management systems (BMS) ship with rule engines meant to catch this. In practice they are noisy. In the 2023–24 school year the rule engine of the Brackenfirth school estate raised 2,317 alarms, and facilities staff closed 1,576 of them (68%) without taking any action.

Three families of alternatives exist, and each fits this setting poorly. Purely data-driven detectors such as autoencoders learn what normal operation looks like, but a cold snap or an evening event also looks abnormal to them, and they offer no principled alarm threshold. Supervised classifiers need many labelled faults; the estate logged 412 verified faults in 17 months across all units, far too few per unit and per fault class. Detectors that reason over a graph of how equipment is connected need that graph in machine-readable form, which the estate's BMS cannot export.

We therefore designed TERN around three requirements that came from the estate rather than from the literature. First, the detector had to work from a few weeks of ordinary operation per unit, without labelled faults for that unit. A small thermal-balance model does this: it absorbs the variation caused by weather and occupancy, so that what remains in its residuals is mostly equipment behaviour. Second, the false-alarm rate had to be something the facilities team could set in advance; they asked for at most one false alarm per unit per school term. Conformal change detection turns residuals into calibrated p-values and provides exactly that dial. Third, an alarm had to point at a component. Because each residual belongs to one physical balance, the pattern of residuals says which part to inspect.

## 2 Background

Rule catalogues for AHUs encode expert knowledge as threshold checks on temperatures and actuator positions [1, 2]. They are transparent, but their thresholds are static. Data-driven methods model the joint behaviour of the measured points with principal component analysis [3] or recurrent autoencoders [4] and flag large reconstruction errors. Grey-box models keep the structure of the physics and fit a handful of parameters [5]; for fault detection they have usually been paired with fixed residual thresholds. Conformal methods calibrate anomaly scores without distributional assumptions when observations are exchangeable [6]. To our knowledge they have not been combined with thermal-balance residuals for AHUs.

## 3 Method

### 3.1 Thermal-balance model

For each unit we write three steady-state balances: one for the mixing box, one for the heating coil and one for the supply fan. Together they have 7 free parameters per unit. We fit them by nonlinear least squares on the first six weeks (42 days) of that unit's data, which we call the commissioning window and assume to be free of faults. Every minute the model yields four residuals: mixed-air temperature, coil outlet temperature, fan pressure, and a consistency residual between the supply-air sensor and the coil outlet estimate. Residuals are averaged over 15-minute windows before detection.

### 3.2 Conformal change detection

For each residual, the nonconformity score of a window is its absolute standardised value. We convert the score into a p-value by ranking it against a calibration set drawn from the unit's own most recent 14 days without alarms. Successive p-values are combined with a power martingale, which grows when p-values are persistently small. TERN raises an alarm when the martingale of any residual exceeds 100, corresponding to a significance level of 0.01, and stays above it for at least 10 minutes. The guarantee behind conformal methods assumes exchangeable observations. Building data are seasonal and are not strictly exchangeable; the rolling calibration window is a practical remedy, not a proof, and we check the resulting false-alarm rate empirically.

### 3.3 Fault isolation

Each alarm carries a signature: which residuals moved and in which direction. A nearest-centroid classifier maps the signature to one of five fault classes. Centroids are learned from fault episodes in the development buildings only.

## 4 Dataset

The data come from the school estate of Brackenfirth Borough Council: 14 buildings, of which 10 are primary or infant schools and 4 are secondary schools. We collected BMS trend logs from 2 September 2024 to 30 January 2026, a span of 17 months, at one-minute intervals with 23 measured points per unit. The estate has 93 AHUs. We removed 7 units in which more than 20% of samples were missing, leaving 86 units: 52 constant-air-volume and 34 variable-air-volume units from two manufacturers.

Fault labels come from two sources. The estate's maintenance work orders gave 412 natural fault episodes, each confirmed by the estate's lead technician against the trend logs. In addition we injected 96 faults on 9 units during the Easter 2025 break and the October 2025 half-term. From 560 candidate episodes we removed 41 that lasted less than 10 minutes and 11 in which two faults overlapped, which leaves the 508 episodes used here. There are five fault classes: stuck outdoor-air damper (121 episodes), leaking heating-coil valve (109), slipping fan belt (94), supply-air sensor drift (83) and fouled filter (101).

We split by building, never by unit or by time. Nine development buildings (55 units, 321 episodes) are used to learn fault signatures and to choose hyperparameters. Five buildings (31 units, 187 episodes, of which 145 are natural and 42 injected) are held out and used only for the final evaluation. After removing shutdown weeks and logger outages, the held-out buildings contribute 498 unit-months of monitoring.

## 5 Experiments

### 5.1 Baselines

We compare against three systems that receive the same 23 points. RB-28 is the set of 28 rules that runs in the estate's BMS today, with the vendor's default thresholds. LSTM-AE is a recurrent autoencoder trained per unit on the same commissioning window, alarming when the reconstruction error exceeds its 99th percentile. PCA-T2 is principal component analysis with Hotelling's T² statistic. All systems use the same 10-minute persistence rule.

### 5.2 Metrics

An episode counts as detected if a system raises an alarm between its labelled onset and its end. Detection delay is the time in minutes from onset to the first alarm, over detected episodes; we report the median and the interquartile range (IQR). An alarm outside every labelled episode is a false alarm, and false alarms less than 60 minutes apart on one unit are merged. Precision is the share of alarms inside a labelled episode, recall the share of episodes detected, and F1 their harmonic mean. Isolation accuracy is the share of detected episodes assigned to the correct fault class.

### 5.3 Ablations

We remove one stage at a time: (a) no thermal-balance model, with the conformal detector applied directly to the raw measured points; (b) no conformal stage, with a fixed three-sigma threshold on the residuals; (c) no rolling recalibration, with the calibration set frozen at the commissioning window.

## 6 Results

### 6.1 Main comparison

**Table 1. Detection on the held-out buildings (187 episodes, 498 unit-months).**

| System | Precision | Recall | F1 | Median delay in minutes (IQR) | False alarms |
|---|---|---|---|---|---|
| TERN | 0.91 | 0.84 | 0.87 | 34 (21–58) | 16 |
| LSTM-AE | 0.76 | 0.83 | 0.79 | 52 (33–97) | 49 |
| RB-28 | 0.78 | 0.65 | 0.71 | 126 (64–310) | 34 |
| PCA-T2 | 0.63 | 0.70 | 0.66 | 74 (40–155) | 77 |

TERN detected 157 of the 187 held-out episodes, with a precision of 0.91, a recall of 0.84 and an F1 of 0.87. Its median detection delay was 34 minutes. It raised 16 false alarms, which is 3.2 per 100 unit-months and well inside the limit of one per unit per term. LSTM-AE detected almost as many episodes (155) but raised 49 false alarms, giving an F1 of 0.79 and a median delay of 52 minutes. RB-28 detected 122 episodes with an F1 of 0.71; its median delay of 126 minutes reflects the timers built into many of its rules. PCA-T2 was the weakest system, with an F1 of 0.66 and 77 false alarms.

### 6.2 Isolation and fault classes

Of the 157 episodes that TERN detected, it assigned the correct fault class to 128, an isolation accuracy of 81.5%. Of the 29 errors, 19 were confusions between a leaking valve and sensor drift, which disturb the same residual. Recall differs sharply by class: it is 0.93 for stuck dampers and only 0.64 for sensor drift, which develops over days and is partly absorbed by the rolling calibration. Per-class figures for all systems are in the supplementary results table. TERN's recall was 0.95 on injected faults against 0.81 on natural ones.

### 6.3 Ablation

Without the thermal-balance model the F1 falls to 0.74, the median delay grows to 61 minutes and false alarms rise to 38. Without the conformal stage TERN is quicker, with a median delay of 29 minutes, but it raises 44 false alarms and its F1 falls to 0.81. Freezing the calibration set gives an F1 of 0.84, a median delay of 41 minutes and 27 false alarms. The thermal-balance stage therefore accounts for most of the detection quality, and the conformal stage for most of the reduction in false alarms.

### 6.4 Uncertainty

Resampling units with replacement 2,000 times gives a 95% interval for TERN's F1 of 0.83 to 0.90. The F1 gain over LSTM-AE is 0.08 (interval 0.03 to 0.13) and the gain over RB-28 is 0.16 (interval 0.10 to 0.22). Across the five held-out buildings, TERN's F1 ranged from 0.80 to 0.93.

### 6.5 Audit of false alarms

Because work orders are incomplete, some alarms counted as false may be real. The lead technician re-inspected the units behind all 16 of TERN's false alarms. He judged 5 to be real faults that had never been logged and 11 to be genuine false alarms. All 16 remain counted as false alarms in the figures above.

### 6.6 Live pilot

From 3 November 2025 to 9 January 2026 TERN ran live in four of the nine development buildings, sending alerts to the facilities team. It sent 63 alerts, of which 51 were acted on within two working days. Over the pilot weeks, heating energy per heating degree-day was 6.8% lower than in the same weeks one year earlier in the four pilot buildings, against 1.9% lower in the other ten buildings.

## 7 Limitations

First, all of our data come from a single estate in one temperate maritime climate, and every building is a school that is occupied in the daytime only. We did not evaluate TERN on a second estate or on any external dataset, so how well it transfers is unknown.

Second, the evaluation covers five fault classes and single faults. The 11 episodes with overlapping faults were excluded, and faults outside the five classes are not scored.

Third, the labels are imperfect. Work orders miss faults, as the audit shows, and injected faults are easier to find than natural ones, so results on injected faults alone would flatter any method.

Fourth, the commissioning window is assumed to be fault-free. A unit that was already faulty in its first six weeks would have the fault built into its model, and TERN would not see it.

Fifth, sensor drift remains hard, with roughly a third of drift episodes missed.

Sixth, the energy comparison in the pilot is observational. The four pilot buildings were chosen by the facilities team, who picked the buildings with the newest controllers; they were not assigned at random. One of them also had its boiler replaced in August 2025. A before-and-after comparison of this kind cannot separate the effect of TERN from these differences, and we make no causal claim about energy savings.

## 8 Conclusion

TERN shows that a seven-parameter thermal-balance model and a conformal change detector, fitted from six weeks of ordinary operation, detect AHU faults in school buildings earlier and with fewer false alarms than the rule set in use and than two data-driven baselines, while keeping false alarms within the limit the facilities team asked for. The next steps are overlapping faults, a dedicated residual for slow sensor drift, and a study of how the approach carries over to other estates and building types.

## Acknowledgements

This work was funded by the Northmarch Energy Trust under grant NET-2291. We thank the Brackenfirth facilities team for access to the trend logs and for auditing the alarms.

## References

[1] H. Pellowe and R. Castellanos-Wren. Expert rules for assessing air-handling units. *Journal of Building Services Analytics*, 2009.

[2] D. Harwell. A catalogue of diagnostic rules for central air systems. Harwell Controls Institute, 2008.

[3] S. Okonjo-Leitner and P. Vasquez-Thorne. Principal component monitoring of ventilation plant. *Proceedings of SBSA*, 2020.

[4] L. Farrowdale and T. Sunde. Recurrent autoencoders for building trend data. *Energy Informatics Letters*, 2021.

[5] K. Brandvold and A. Mirzakhanian. Grey-box thermal models for school heating control. *Building Systems Review*, 2020.

[6] E. Tallowmere. Conformal martingales for monitoring: a tutorial. *Annals of Applied Sequential Analysis*, 2022.
