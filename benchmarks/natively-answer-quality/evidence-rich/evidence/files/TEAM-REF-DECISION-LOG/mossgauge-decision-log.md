# Mossgauge 3.0 decision log

Maintained by Saoirse Lindqvang, Product Manager. Last updated Wednesday 30 September 2026.

This log is the source of record for scope and release decisions on Mossgauge 3.0. A decision stands until a later entry replaces it. Proposals raised in chat or in draft documents are not decisions until they are entered here. Entries are added at the Wednesday release review.

## D-011 Sync API v3 adopted for 3.0

Date: Wednesday 15 July 2026 | Decided by: Halvard Niemczyk, Tobiah Kessenich | Status: Decided

3.0 clients talk only to Sync API v3. The v2 endpoints stay up for 2.x clients until at least the end of January 2027.

## D-012 PDF renderer

Date: Wednesday 29 July 2026 | Decided by: Halvard Niemczyk, Yevgenia Marchetti-Oduya | Status: Decided

PDF export uses the Inkspindle renderer on both platforms. The alternative, rendering HTML to PDF with each platform's own print engine, was rejected because page breaks differed between Android and iOS in the prototype. The licence is annual and is held by Product.

## D-013 Asset tag scanning

Date: Wednesday 12 August 2026 | Decided by: Saoirse Lindqvang, Dorrin Ashgrove-Patel | Status: Decided

The scanner reads QR codes and Code 128 barcodes. Data Matrix tags are deferred; no customer has asked for them so far.

## D-014 Platform support

Date: Wednesday 26 August 2026 | Decided by: Halvard Niemczyk, Dorrin Ashgrove-Patel, Saoirse Lindqvang | Status: Decided

3.0 supports Android 10 (API level 29) and later, and iOS 16 and later. Devices on older systems stay on the 2.x line, which receives security fixes only. At the time of the decision 3.8% of active Android devices and 2.1% of active iOS devices were below the new minimum. iPad gets an adapted layout. Android tablets run the phone layout in 3.0; a dedicated tablet layout is a candidate for 3.1.

## D-015 Android ownership and release captain

Date: Wednesday 2 September 2026 | Decided by: Halvard Niemczyk | Status: Decided

Ilka Vantongeren owns the Android workstream from Monday 7 September, following the previous lead's move to the Payments team. Ilka is also the release captain for 3.0.

## D-016 Offline mode

Date: Wednesday 9 September 2026 | Decided by: Halvard Niemczyk, Saoirse Lindqvang, Tobiah Kessenich | Status: Decided

Offline mode is cut from 3.0 and moved to 3.1. Conflict handling in Sync API v3 is not ready for edits made without a connection, and Tobiah estimates five more weeks of work to make it safe. Crews keep the 2.x behaviour: an inspection can be opened without signal only if it was loaded earlier in the same session.

## D-017 Export scope

Date: Wednesday 9 September 2026 | Decided by: Halvard Niemczyk, Saoirse Lindqvang, Yevgenia Marchetti-Oduya | Status: Decided

3.0 exports inspection reports as PDF and CSV only. XLSX is not in 3.0; the request will be looked at again for 3.1. An export covers one inspection or a batch of up to 50 inspections. Exports are generated on the device and shared through the system share sheet; there is no emailed export from the server in 3.0.

## D-018 Crash-free bar

Date: Wednesday 9 September 2026 | Decided by: Halvard Niemczyk, Ilka Vantongeren, Dorrin Ashgrove-Patel, Corbin Thistlewood | Status: Decided

The bar for 3.0 is 99.5% crash-free sessions on each platform, measured over the trailing seven days on the build being judged. This is higher than the bar used for 2.x releases. The same figure is used for the release candidate and for moving between rollout stages.

## D-019 Release candidate exit criteria

Date: Wednesday 16 September 2026 | Decided by: Halvard Niemczyk, Corbin Thistlewood | Status: Decided

A build can be declared a release candidate only with zero open P0 defects and no more than three open P1 defects in total across Android, iOS and the backend. P2 defects do not block.

## D-020 Rollout strategy

Date: Wednesday 16 September 2026 | Decided by: Halvard Niemczyk, Saoirse Lindqvang, Ilka Vantongeren | Status: Decided

Android goes out as a staged rollout through Google Play:

1. 5% of Android devices for 3 days
2. 25% for 4 days
3. 50% for 7 days
4. 100%

A stage advances only if the crash-free bar in D-018 is met at the end of the stage. iOS uses the App Store phased release over seven days. The rollout is halted if crash-free sessions on the release build fall below 99.1% in any stage, or if any P0 defect is opened. The release captain may halt and resume the rollout. Changing the stage sizes or durations needs approval from Halvard Niemczyk at the release review. A full release to every user on launch day was considered and rejected.

The go/no-go call is made on Monday 2 November by the release captain together with the product manager.

## D-021 Closed beta

Date: Wednesday 23 September 2026 | Decided by: Saoirse Lindqvang | Status: Decided

The closed beta runs with three pilot customers: Halden Valley Water, Corrimount Gas Networks and Tarnbrook Power. A fourth, Ostwick Rail Maintenance, declined because of its own change freeze. Each pilot customer nominates up to 25 crew members.

## D-022 Photo annotation limits

Date: Wednesday 30 September 2026 | Decided by: Saoirse Lindqvang, Lucinda Farthingale | Status: Decided

An inspection can hold up to 12 annotated photos in 3.0. Photos are stored at a maximum of 2048 pixels on the long edge.
