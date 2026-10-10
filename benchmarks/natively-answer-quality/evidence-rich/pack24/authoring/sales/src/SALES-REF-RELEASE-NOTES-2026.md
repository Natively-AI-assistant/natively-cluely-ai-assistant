# Kestravane Fleet - Release Notes 2026

Releases 2026.1 to 2026.10 - Maintained by Product Operations - Last updated 2026-09-28

These notes list what has shipped during 2026 in the web application, the optional modules and the device firmware: what changed, which plans or modules each change applies to, and how each release was deployed. They describe shipped functionality only. Nothing here is a statement about future releases.

Unless an entry says otherwise, a change applies to every plan. The newest release is listed first.

## 2026.10 (2026-09-20)

New

- Reports: the idle report and the trip report can be grouped by vehicle group as well as by depot and by driver.
- Admin console: a change history tab on each vehicle record shows who edited the record and when.

Fixes

- Trip report: a trip that crossed midnight was counted on both days in the daily total.
- Maintenance Planner: a service marked complete from the work order screen did not always reset its interval.
- Depot comparison report: depots with no vehicles were listed with a blank row.

Deployment: scheduled maintenance window on 2026-09-20. The web application and API were unavailable for 65 minutes.

## 2026.9 (2026-08-23)

New

- Maintenance Planner: parts lists. Each service template can carry a list of parts with part numbers and unit costs, and the cost-per-vehicle report adds parts to labour. Requires the Maintenance Planner module.
- Maintenance Planner: a work order can be printed or saved as a PDF with the customer's own logo. Requires the Maintenance Planner module.

Changed

- Live map: below a set zoom level, vehicles are grouped into clusters. A cluster shows how many vehicles it contains and how many of them are moving.

Fixes

- Vehicle groups: a vehicle removed from its last group disappeared from group-filtered reports for the rest of the day.

Deployment: scheduled maintenance window on 2026-08-23. The web application and API were unavailable for 155 minutes, longer than planned because a database migration had to be run again.

## 2026.8 (2026-08-02)

New

- Depot comparison report: ranks depots against each other on distance, engine hours, idling and open maintenance items. Available on every plan. The idling column is empty without the Fuel & Idle Analytics module, and the maintenance column is empty without Maintenance Planner.
- Vehicle groups: a vehicle can belong to any number of groups, and a group can be used as a filter on every report.

Fixes

- Idle report: idling during a power take-off cycle was counted as idle time on some refuse trucks.
- Admin console: the depot filter on the vehicle list was cleared each time a record was opened.

Deployment: scheduled maintenance window on 2026-08-02. The web application and API were unavailable for 110 minutes.

## 2026.7 (2026-07-19)

Device firmware

- TrakNode T4 firmware 4.5: faster wake from sleep and a quicker first position fix after a long stop. Rolled out over the air across ten days from the release date. No action is needed.
- RoadLens: an event clip now starts 8 seconds before the trigger and ends 12 seconds after it. Until this release a clip ran 6 seconds either side.

Changed

- Driver Safety Scoring: the weekly digest email to depot managers now lists the drivers whose score moved most, up or down, instead of the lowest scores only.

Deployment: firmware and email changes only. There was no interruption to the web application or the API.

## 2026.6 (2026-06-28)

New

- Admin console: bulk edit. Up to 500 vehicle records can be changed in one action (depot, vehicle group, vehicle class).
- Regions: depots can be placed under regions, and any report can be rolled up by region.
- Report builder: saved report templates. Operations accounts can keep 30 templates; Enterprise accounts have no limit. Launch accounts use the built-in reports.

Fixes

- Import: a vehicle list with a byte-order mark at the start of the file was rejected.
- Live map: the satellite layer did not load for accounts hosted in the European Union region.
- Idle report: the totals row left out vehicles that had been moved to another depot during the period.

Deployment: scheduled maintenance window on 2026-06-28. The web application and API were unavailable for 80 minutes.

## 2026.5 (2026-06-14)

New

- Cold Chain Monitoring: set-range profiles. A profile holds a set range under a name the customer chooses, and can be applied to a vehicle or to a single trip instead of typing the limits each time.
- Cold Chain Monitoring: alert delay. A temperature excursion alert is raised only when a sensor has been outside the set range for longer than the alert delay, which an administrator can set between 2 and 30 minutes. New accounts start at 4 minutes.
- Cold Chain Monitoring: the temperature record for a chosen trip can be saved as a PDF, with the set range drawn on the chart.

All three require the Cold Chain Monitoring module.

Deployment: scheduled maintenance window on 2026-06-14. The web application and API were unavailable for 140 minutes.

## 2026.4 (2026-05-10)

New

- Fuel & Idle Analytics: the idle threshold can be set for each depot, anywhere between 1 and 12 minutes. Until this release it was one setting for the whole account. New depots start at 3 minutes.
- Fuel & Idle Analytics: idle cost. The idle report shows an estimated cost, worked out from a fuel price per gallon that an administrator enters and can change at any time.

Both require the Fuel & Idle Analytics module.

Changed

- Trip report: the trip gap setting, which decides how long the ignition must be off before a new trip starts, moved from the vehicle record to the account settings page.
- Admin console: the vehicle list remembers its column layout for each user.

Fixes

- Idle report: a vehicle left idling across the change of day was listed twice.
- Maintenance Planner: the reminder email quoted the service interval in kilometres for accounts set to miles.

Deployment: released behind a feature switch that was turned on for all accounts on 2026-05-10. There was no interruption.

## 2026.3 (2026-04-12)

Changed

- Driver Safety Scoring: event thresholds. Harsh braking is now recorded from 0.38 g; until this release the threshold was 0.42 g. Harsh acceleration is recorded from 0.33 g and harsh cornering from 0.36 g, as before.
- Driver Safety Scoring: speeding is now measured against the posted limit for the road, taken from map data, in place of one fleet-wide limit typed in by the administrator.
- Driver Safety Scoring: a driver's score is a number from 0 to 100, worked out again each night from the previous 28 days of driving. Braking, acceleration, cornering and speeding each make up a quarter of the score.

All three require the Driver Safety Scoring module.

Fixes

- Safety events recorded while a vehicle was being towed are now ignored.
- Maintenance Planner: a service due on distance was shown as overdue when the odometer had been corrected downwards.

Deployment: scheduled maintenance window on 2026-04-12. The web application and API were unavailable for 125 minutes.

## 2026.2 (2026-02-15)

New

- Custom dashboards. An administrator can build a dashboard from a library of tiles: distance, engine hours, utilisation, open maintenance items, idle minutes, temperature excursions. Custom dashboards are available on Operations and Enterprise: an Operations account can have 12 of them, an Enterprise account any number. Launch accounts keep the three built-in dashboards.
- A dashboard can be shown full-screen on a wall display and refreshes itself every 60 seconds.
- Dashboards can be copied between depots, and a copied dashboard keeps its tiles but takes the vehicles of the depot it is copied to.

Fixes

- Reports: column totals were missing from the PDF version of the trip report.
- Admin console: a depot could be deleted while it still had vehicles; the delete button is now greyed out until the depot is empty.

Deployment: there was no interruption.

## 2026.1 (2026-01-11)

New

- Maintenance Planner: a service schedule can be driven by engine hours as well as by distance and by calendar interval, whichever comes first. Requires the Maintenance Planner module.
- Maintenance Planner: a reminder email goes to the depot manager a chosen number of days before a service falls due. Requires the Maintenance Planner module.

Changed

- The vehicle list can be exported from the admin console as a CSV file in the same layout as the import template.

Deployment: scheduled maintenance window on 2026-01-11. The web application and API were unavailable for 70 minutes.

## Known issues

- Custom dashboards: the utilisation tile shows a dash for a vehicle on the day it is added to the account.
- Cold Chain Monitoring: the PDF temperature record splits the chart across two pages for a trip longer than 36 hours.
- Bulk edit: a bulk change cannot be undone in one step. Use the change history tab on each vehicle record.
- Regions: a depot can belong to one region only.
- Depot comparison report: engine hours are blank for vehicles fitted with the three-wire kit until the unit has seen its first full day of use.

## Browser support

The web application is supported on the current and the previous major version of Chrome, Edge, Firefox and Safari.

## How releases are deployed

A release that needs an interruption is deployed in the scheduled maintenance window described in the Support Plans and Service Level Guide, and is announced on the status page beforehand. The unavailable time given for each release is the measured time from the start of the interruption until the web application and the API were serving requests again. Device firmware is released separately from the web application and never needs an interruption.

Product Operations: releases@kestravane.example
