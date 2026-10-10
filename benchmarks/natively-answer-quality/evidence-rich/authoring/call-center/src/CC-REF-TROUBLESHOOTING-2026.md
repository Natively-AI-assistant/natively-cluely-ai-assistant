# Outage and Troubleshooting Guide

Revised 1 September 2026 | Maintained by Tier 2 Device Diagnostics (Ezekiel Brandvold-Osei) | For Tier 1 agents

## Before anything else: is it us?

Open the Incident Board before touching the customer's setup.

| Level | Meaning |
|---|---|
| Severity 1 | Live view or recording is unavailable for more than 10% of cameras in a region |
| Severity 2 | The service works but is degraded: late notifications, slow clip loading |

While an incident is open for the customer's region, do not walk them through device steps, and never have them factory-reset a camera. Say that there is a known incident and that their equipment is not at fault. Give a time for the fix only if the Incident Board shows one; never estimate one yourself. Customers can follow updates at status.brindlewatch.example.

Outage credit. When a Severity 1 incident lasts more than 24 hours in a row, affected subscribers are credited 10% of their monthly plan fee for each full 24 hours, up to a maximum of 50%. Annual subscribers get the same percentages of one-twelfth of the annual price. The credit is applied automatically on the next invoice; customers do not need to ask and agents do not add it by hand. Severity 2 incidents carry no credit.

## Camera offline: the six steps

Work through these in order and note each one on the ticket.

1. Read the light.

| Light | Meaning |
|---|---|
| Solid green | Online |
| Blinking blue | Pairing mode |
| Solid amber | Starting up; this can take up to 90 seconds |
| Blinking red | No network connection |
| Solid red | Hardware fault - stop here and escalate to Tier 2 Device Diagnostics |

2. Check power. Use the original adapter and try a different outlet. An Eave Cam needs its battery above 15% to reconnect.

3. Check the Wi-Fi band. Lantern Cam (2nd generation) and Eave Cam connect on 2.4 GHz only. Lantern Cam (3rd generation) uses 2.4 GHz or 5 GHz. A router set to broadcast only a 5 GHz network will not work with a 2.4 GHz camera. Trek Cam uses Wi-Fi or cellular.

4. Restart the router. Unplug it for 30 seconds, plug it back in and wait 3 minutes before checking the camera.

5. Check signal. In the app under Device Health, the signal should read -67 dBm or stronger (closer to zero). If it is weaker, move the camera or the router closer together; thick walls and metal doors are the usual cause.

6. Factory reset. Hold the reset button for 12 seconds, until the light blinks amber, then pair the camera again in the app. A factory reset clears the camera's Wi-Fi settings and activity zones. It does not delete recordings already in the cloud and does not change the plan.

If the camera is still offline after step 6, escalate to Tier 2 Device Diagnostics with the light colour, the firmware version and the steps done.

## Firmware

| Camera | Current firmware |
|---|---|
| Lantern Cam (3rd generation) | 4.8.2 |
| Lantern Cam (2nd generation) | 4.5.9 (final release) |
| Eave Cam | 3.11.0 |
| Trek Cam | 2.6.1 |

Cameras update themselves between 2:00 am and 4:00 am local time, when idle. A customer cannot force an update; leaving the camera powered and online overnight is enough.

Known fault: Eave Cam firmware 3.10.4 made night vision flicker. It is corrected in 3.11.0.

## Notifications late or missing

Check the Incident Board for a Severity 2 incident first. Then check that notifications are allowed for the app in the phone's settings, that battery saver is not restricting it, and that the app is version 7.3 or newer.

## Live view will not load although the camera is online

Ask whether the phone is on a VPN and have them switch it off. Have them change between Wi-Fi and mobile data. Reinstalling the app is the last resort and does not affect recordings.

## Trek Cam on cellular

In Device Health the SIM status should read Active and the camera should show at least two signal bars. Abroad, connections carry Roam Day fees; see the Billing Guide before advising a customer who is travelling.

## Eave Cam battery

A full charge typically lasts 4 to 6 months. Below -10 C the battery drains faster, and it will not charge below 0 C. Bring the camera indoors to charge it.
