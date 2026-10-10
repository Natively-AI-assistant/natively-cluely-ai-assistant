# Brackenfirth datasets: data dictionary

Halvard Laboratory for Building Analytics, Kestrelmoor Institute of Technology

Revision 4, released 16 September 2026. Maintained by Odalys Brennecke. Send corrections to her; do not edit the files to match what you think they should say.

## 1 What this covers

Two datasets live on the project share and are described here because they use the same building codes and the same time conventions:

- the **trend logs** exported from the Brackenfirth estate's building management system (BMS) for its air-handling units;
- the **classroom logger files** from the carbon dioxide study of spring term 2026.

This document describes file names, columns, units, flags and known quirks. It does not say how many units or classrooms there are, which were left out of an analysis, or what any analysis found. Those things are in the papers and thesis chapters that use the data, and they are the authority for them.

## 2 Building codes

Every building of the estate has a code of the form `BF-nn`, taken from the council's asset register. The code is the first part of every trend-log file name and is the `building` column of every table. The table below lists only the codes that occur in the classroom logger files. The codes of the other buildings are in the council's asset register extract (`estate_assets.xlsx`) and are not reproduced here.

| Code | School | Note for anyone working with the files |
|---|---|---|
| BF-02 | Dunnock Lea Primary | Main block and a later extension; the extension's rooms are numbered from 6 |
| BF-05 | Aldergate Primary | The annexe across the playground has no ducted supply |
| BF-09 | Tessel Lane Primary | The upper-school wing has no ducted supply |
| BF-11 | Pennystone Road Primary | Two temporary classrooms in the yard, called Hut 1 and Hut 2 on site |
| BF-12 | Larchfold Infants | Single storey; every teaching room is on the ducted supply |
| BF-14 | Marrowby Infants | Trend points carry a legacy prefix, see section 4.5 |

The thesis chapter on classroom carbon dioxide refers to these six schools by letter. The letters are not in this dictionary: they are the `school_label` column of the logger register (`classroom_co2_logger_register.csv`), next to the building code.

## 3 Time

**Trend logs.** The BMS outstations write local civil time. The export script keeps that as `ts_local` and adds `ts_utc`. On the spring clock change one hour of `ts_local` does not exist, and on the autumn change one hour occurs twice; the repeated rows can only be told apart by `ts_utc`. Always sort and join on `ts_utc`. A row describes the interval that starts at its timestamp.

**Classroom logger files.** The loggers keep UTC internally and the files have `ts_utc` only. Each logger's clock was set from a laptop at installation and compared with the laptop again at retrieval; the largest difference found was 40 seconds, and no correction has been applied.

**School calendar.** The file `school_days.csv` has one row per date with a flag for school day, holiday or staff training day. Term dates differ slightly between schools in the summer term only.

## 4 Files of the trend logs

### 4.1 Names and layout

One file per unit per calendar month, named `<building>_<unit>_<yyyy>-<mm>.csv`, for example `BF-09_AHU03_2025-11.csv`. Files are comma-separated UTF-8 with one header row. Units are numbered within a building in the order of the BMS graphics pages, which is not the order of the plant rooms.

### 4.2 Columns

`ts_utc`, `ts_local`, `building`, `unit`, then one column per logged point, then the quality flag `q`. Point columns are numeric. An empty cell means the outstation returned nothing for that point in that interval.

### 4.3 Points read by the laboratory's models

The table lists the points that the thermal-balance fit and the detectors read directly. The files also hold status bits, setpoints and the vendor's own alarm points; those keep the vendor's names and are described in the vendor's point schedule, not here.

| Column | Meaning | Unit | Sensor or source | Installer's stated accuracy | Valid range |
|---|---|---|---|---|---|
| `t_oa` | Outdoor-air temperature | °C | Thermistor in the intake louvre | ±0.5 °C | −20 to 40 |
| `t_ra` | Return-air temperature | °C | Duct thermistor | ±0.3 °C | 5 to 35 |
| `t_ma` | Mixed-air temperature | °C | Averaging element across the mixing box | ±0.4 °C | −5 to 35 |
| `t_sa` | Supply-air temperature | °C | Duct thermistor downstream of the fan | ±0.2 °C | 5 to 45 |
| `t_hwf` | Heating water flow temperature | °C | Strap-on sensor on the flow pipe | ±1.0 °C | 10 to 90 |
| `dp_fan` | Pressure rise across the supply fan | Pa | Differential pressure transmitter | ±2% of span | 0 to 1,250 |
| `dp_fil` | Pressure drop across the filter bank | Pa | Differential pressure transmitter | ±3% of span | 0 to 500 |
| `pos_oad` | Outdoor-air damper command | fraction open | Controller output | not a measurement | 0 to 1 |
| `pos_hv` | Heating valve command | fraction open | Controller output | not a measurement | 0 to 1 |
| `spd_fan` | Supply fan speed command | fraction of full speed | Controller output | not a measurement | 0 to 1 |
| `occ` | Occupancy schedule | 0 or 1 | Time schedule in the controller | not a measurement | 0 or 1 |

The accuracies are the figures on the installer's commissioning sheets. The laboratory has not checked any of these sensors against a reference instrument, and the figures should be quoted as the installer's and not as ours. The mixed-air sensor is an averaging element strung across the mixing box: it smooths the stratification there, but it cannot be taken out and checked in a bath like a duct thermistor.

The three command columns are what the controller asked for, not what the actuator did. There is no position feedback on dampers or valves anywhere in the estate.

### 4.4 Quality flag `q`

One flag per row.

| `q` | Meaning |
|---|---|
| 0 | Good |
| 1 | One or more points in the row were filled by interpolation across a short gap |
| 2 | Outstation offline: the row is present so that the file has no holes, but its points are empty |
| 3 | Unit scheduled off (holiday or shutdown calendar) |
| 4 | A manual override was active on one of the command points |
| 5 | One or more points outside the valid range of section 4.3; the value is kept, not clipped |

Where two conditions apply, the higher number is written.

### 4.5 Known quirks

- **Legacy prefix at BF-14.** Points at Marrowby Infants are exported with the prefix `MI_` and older point names. The export script renames them to the columns above using `legacy_tags.csv`. If a column is missing for that building, look there first.
- **Duplicate rows after an outstation restart.** A restart can replay the last few intervals. Remove duplicates on `ts_utc` and `unit`, keeping the last row written.
- **Heating water sensors.** The strap-on sensors behind `t_hwf` read low where pipe lagging is missing. Treat the column as indicative; it is not used in any balance.
- **Fan pressure span.** The valid range for `dp_fan` in the table is the span of the transmitters on belt-driven fans. Transmitters on direct-drive fans have a span of 0 to 800 Pa, and the stated accuracy is a percentage of whichever span applies.
- **One outdoor sensor per building.** A building with a single intake louvre sensor writes the same `t_oa` value into the files of every unit in that building. It is one sensor repeated, not several sensors that happen to agree.
- **Occupancy schedule.** `occ` is the controller's time schedule, not a measurement of whether anyone is in the building. Evening lettings are entered by the site manager and are often missing from it.
- **Rounding.** Temperatures are stored to one decimal place, pressures to the nearest pascal, commands to two decimal places.

## 5 Files of the classroom loggers

### 5.1 Names and layout

One file per logger for the whole term, named `CO2_<logger id>.csv`, for example `CO2_Q2-2271.csv`. Comma-separated UTF-8, one header row.

### 5.2 Columns

| Column | Meaning | Unit |
|---|---|---|
| `ts_utc` | Time of the reading | UTC |
| `co2_ppm` | Carbon dioxide concentration | ppm, whole numbers |
| `temp_c` | Air temperature at the logger | °C, one decimal place |
| `rh_pct` | Relative humidity at the logger | %, whole numbers |
| `q` | Quality flag | see below |

The files hold one reading every 5 minutes.

The flag `q` in these files is not the trend-log flag. Here 0 is good; 1 marks readings taken while the logger was moved or unplugged, as recorded in the register notes; 2 marks readings removed after the check at retrieval.

### 5.3 What is not in these files

The files do not say which room or school a logger was in. Join to the logger register on the logger id. The register also holds each room's ventilation type, floor area and the dates of installation and retrieval.

### 5.4 Derived table

`classroom_days.csv` has one row per logger per school day: the mean concentration in teaching hours, the share of teaching-hours readings above 1,500 ppm, and a flag for whether the day counts as valid. It is rebuilt from the logger files by `build_classroom_days.py` and should never be edited by hand.

## 6 Revision history

- Revision 1, 14 March 2025: first issue, trend logs only.
- Revision 2, 3 October 2025: `ts_utc` added to every trend file and section 3 rewritten.
- Revision 3, 19 February 2026: quality flag 5 introduced; valid ranges added to the point table.
- Revision 4, 16 September 2026: section 2 (building codes) and section 5 (classroom logger files) added.
