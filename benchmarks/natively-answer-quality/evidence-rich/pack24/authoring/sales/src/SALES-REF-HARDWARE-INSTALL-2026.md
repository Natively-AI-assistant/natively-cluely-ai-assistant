# TrakNode T4 and RoadLens - Installation Guide

Revision C - 8 June 2026

Owner: Anselm Vukovich-Tran, Field Engineering Manager. Written for Kestravane-certified fitters and for customers who fit their own units. TempSense sensors have their own fitting sheet and are not covered here.

## 1. Before you start

Each TrakNode T4 comes in a carton with the unit, an adhesive mounting pad, four cable ties and the harness named on the order. The serial number is printed on the underside of the unit and on the carton. It has twelve characters and begins with KT4.

You will need a trim removal tool, side cutters, isopropyl wipes, and a web browser logged in to the installer page of the admin console.

Check the vehicle against the vehicle list before opening the dash: VIN, licence plate and vehicle group. A unit fitted to the wrong vehicle reports under the wrong name until somebody corrects the record.

Work with the ignition off and the keys out of the vehicle. Do not fit a unit while the vehicle is on a lift, on charge or being fuelled, and do not disconnect any airbag wiring to make room.

| | TrakNode T4 | RoadLens |
|---|---|---|
| Size | 94 x 61 x 24 mm | 108 x 66 x 38 mm |
| Weight | 78 g | 164 g |
| Power | 9 to 32 volts from the harness | From the camera port of the TrakNode |
| Antennas | Internal, cellular and satellite | None |
| SIM | Built in; nothing to insert | None |

## 2. Choosing the connection

The TrakNode reads vehicle data through the diagnostic connector and takes its power from the same place. Use the harness that matches the connector. The vehicle compatibility list gives the same information by vehicle group, with example models.

| Connector in the vehicle | Typical vehicles | Harness |
|---|---|---|
| OBD-II, 16-pin | Cars, vans and pickups | KH-16Y |
| 16-pin OBD-style connector carrying J1939 | Medium-duty cab-over trucks | KH-16J |
| 9-pin round, green | Heavy trucks from 2016 | KH-9G |
| 9-pin round, black | Heavy trucks before 2016, yard tractors | KH-9B |
| No diagnostic connector | Forklifts, plant, older vehicles | KH-3W three-wire kit |

Every harness except the three-wire kit is a Y-harness: the vehicle's own connector stays available for a workshop tool. The 9-pin harnesses come with a 1.5-metre lead, because the connector on a truck is often low on the kick panel and the unit sits higher up. The KH-16Y and the KH-16J look alike apart from the grey band on the KH-16J. Fitting the wrong one of the pair gives position but no engine data.

The plug-in OBD-II connection is supported on light vehicles from model year 2008 onward. A light vehicle older than that is fitted with the three-wire kit.

The three-wire kit takes constant power, ignition and ground from the fuse box, using the fuse taps supplied. With this kit the unit reports position, trips and ignition time, but it has no odometer, fuel level or fault codes from the vehicle.

## 3. Mounting the unit

1. Choose a position under the dash or behind a trim panel, with the label side facing up and no metal directly above it.
2. Keep the unit at least 8 cm from airbag modules and their wiring, and clear of the pedals and the steering column.
3. Clean the surface with a wipe, apply the pad, press the unit on for thirty seconds, and add two cable ties round a solid part of the dash frame.
4. Route the harness so that it is not stretched and cannot be kicked. Tie up the spare length; do not coil it round the unit.
5. Never mount the unit in the engine bay, in a door or on the outside of the vehicle.

On tractors with a metallised or heated windshield, mount the unit as far forward on the dash top as the trim allows.

Some vehicles need extra care:

- Leased and rented vehicles: use the pad and cable ties only. Do not drill, and do not cut any of the vehicle's own wiring.
- Vehicles that already carry the maker's own telematics module on the diagnostic connector: fit the Y-harness between the connector and that module, never in its place.
- Vehicles with a body builder's control box under the dash: keep the unit and its harness on the opposite side of the steering column.
- Right-hand-drive vehicles: the connector is usually mirrored. Follow the connector, not the picture in this guide.

## 4. Power, memory and sleep

The unit runs on a supply of 9 to 32 volts, so one model covers 12-volt and 24-volt vehicles. With the ignition off it sleeps and draws less than 3 milliamps. It wakes on ignition and on movement.

When the vehicle is out of cellular coverage the unit keeps recording. It stores up to 9 days of trip data and sends it when coverage returns; beyond that, the oldest data is overwritten first.

A small internal backup cell keeps the unit reporting for a short time after power is removed, long enough to send a "power removed" message with its position. The vehicle then shows as offline in the admin console. The backup cell cannot be replaced by the user.

## 5. Activation and checks

Open the installer page, choose the vehicle and enter or scan the serial number. Then:

1. Turn the ignition on. The network light should turn solid green within 2 minutes.
2. With the vehicle outdoors, wait for the position light. A first fix normally takes up to 3 minutes; later fixes take seconds.
3. Check that the installer page shows ignition, odometer and, where the vehicle supports it, fuel level.
4. Turn the ignition off and on again and confirm that the page records both events.
5. Drive the vehicle at least 500 metres and confirm that a trip appears.

The vehicle is marked "Fitted" on the installer page when every check has passed.

## 6. Status lights

| Light | Pattern | Meaning |
|---|---|---|
| Network (green) | Solid | Connected to the cellular network |
| Network (green) | Slow blink | Searching for a network |
| Network (green) | Off | No power, or the unit is asleep |
| Position (blue) | Solid | Position fix obtained |
| Position (blue) | Slow blink | Looking for satellites |
| Fault (amber) | Slow blink | No vehicle data: wrong harness, or the vehicle's protocol was not detected |
| Fault (amber) | Fast blink | Supply below 9 volts |
| Fault (amber) | Solid | Firmware update in progress; do not unplug |

The lights switch off 10 minutes after the ignition is turned on, so that they do not distract the driver. Press the recessed button once to show them again.

## 7. Firmware

Units leave the warehouse with firmware 4.4 or later. Updates arrive over the air and install with the ignition on. An update takes about 6 minutes, during which the amber light is solid. The unit keeps its previous firmware and goes back to it if an update fails. Neither the fitter nor the driver has to do anything.

## 8. Fitting a RoadLens camera

The RoadLens is powered from the camera port of the TrakNode T4 through the 3-metre camera cable packed with the camera, so the TrakNode is always fitted first. One RoadLens can be connected to each TrakNode.

1. Position the camera on the windshield on the passenger side of the mirror, inside the area swept by the wipers and outside any tinted band.
2. Its top edge should sit no more than 6 cm below the headliner, so that it does not intrude on the driver's view.
3. Clean the glass, peel the backing from the mount and press the mount on for one minute. Do not fit the mount to cold or wet glass; warm the glass with the cab heater first.
4. Run the cable along the headliner and down the A-pillar behind the trim, away from the curtain airbag, and plug it into the camera port.
5. On the installer page, open the camera view and turn the road lens until the horizon lies between the two guide lines. Tilt the cab lens until both seats are in the picture.
6. Finish with the alignment drive: at least 3 km at more than 50 km/h on a road with lane markings. The camera view shows "Aligned" when it is done.

A camera that has been moved, or a vehicle whose windshield has been replaced, needs the alignment drive again.

## 9. Common problems

| Symptom | Likely cause | What to do |
|---|---|---|
| Amber slow blink that does not clear | KH-16Y fitted where KH-16J is needed, or the connector is not fully home | Check the compatibility list and reseat the harness |
| Position but no odometer | Three-wire kit in use, or the vehicle does not send odometer | Normal with the three-wire kit; otherwise report the vehicle group to Field Engineering |
| Network light never solid | Unit under a metal panel, or vehicle underground | Move the unit and test outdoors |
| Vehicle offline overnight | The unit is asleep | Normal; it wakes on ignition |
| Camera view is black | Cable in the wrong port, or not latched | Reseat both ends |
| Trips split in two at fuel stops | Ignition was off for less than the trip gap setting | An account setting, not a fitting fault |

## 10. Finishing the job

Upload three photographs for each vehicle from the installer page: the unit in position, the harness at the connector, and the serial label. Refit all trim. Put the workshop-tool side of the Y-harness back where the original connector was, so that a mechanic finds it where expected. Tell the customer's project lead which vehicles on the day's list were not presented.

Customers who fit their own units follow the same steps and use the installer page with an administrator's login. The photographs are optional for them, but they are worth taking: they save a visit if a unit is reported faulty later.

Wipe the road lens and the cab lens with a dry microfibre cloth when the camera is fitted and whenever the windshield is cleaned on the inside. Solvent cleaners cloud the lens cover.

Faulty units go back through Kestravane support. A fitter never opens a unit.

Field Engineering: fieldeng@kestravane.example

---

Kestravane, Inc. Revision C replaces revision B.
