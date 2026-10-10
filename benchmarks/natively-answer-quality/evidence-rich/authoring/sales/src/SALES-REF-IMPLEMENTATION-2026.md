# Kestravane Fleet - Implementation and Onboarding Guide

Version 2.3 - 14 April 2026

Owner: Bartholomew Nkemelu, Director of Professional Services. Written for customers who are about to start a rollout and for the Kestravane teams who support them.

## 1. How a rollout runs

Every rollout moves through the same six stages: kickoff, configuration, hardware installation, data migration, training and go-live. On Launch the customer runs these stages alone with the setup wizard. On Operations a Kestravane onboarding specialist guides the customer through them. On Enterprise a named project manager runs the plan and chairs a weekly status call.

The kickoff call is normally held within 5 business days of contract signature. Every duration in this guide is counted from the kickoff call, not from the signature.

## 2. Typical timelines

| Plan and fleet size | Delivery model | Duration from kickoff to go-live |
|---|---|---|
| Launch | Self-serve | 5 to 10 business days |
| Operations, up to 200 vehicles | Guided | Typically 30 days |
| Operations, more than 200 vehicles | Guided | 45 to 75 days |
| Enterprise | Managed, with a named project manager | 60 to 90 days |

These durations are planning estimates drawn from completed projects. They are not commitments, and Kestravane does not write go-live dates into order forms. Where a customer needs a committed date, it is set out in a Statement of Work signed by the Director of Professional Services after a scoping call; account teams cannot commit to a date on their own.

The most common causes of delay are vehicles not being released for installation, a late vehicle list, and waiting for the customer's identity provider team to configure single sign-on.

## 3. What the rollout depends on

- Hardware delivery. Units arrive 7 to 10 business days after the hardware order is placed. Installation cannot be scheduled until the delivery date is confirmed.
- Installer availability. Professional installation is booked at least 10 business days ahead. One two-person installer crew fits about 15 vehicles per working day at a single depot.
- Vehicle downtime. A professional installation keeps a vehicle off the road for about 40 minutes. A self-installed TrakNode on a light vehicle with an OBD-II port takes about 20 minutes; heavy trucks need the 9-pin harness and are best left to an installer.
- Connectors. Each native connector takes 3 to 5 business days to configure and validate, and the customer's administrator for the connected system has to be available during that window.
- Single sign-on. The customer's identity provider team supplies the metadata and assigns users; allow one week.

## 4. Customer responsibilities

The customer is asked to:

1. Name a project lead within 3 business days of the kickoff call. The project lead needs authority over vehicle scheduling.
2. Supply the vehicle list (VIN, licence plate, home depot and vehicle class) in the Kestravane template at least 5 business days before the first installation date.
3. Release vehicles for installation on the agreed days. Vehicles that are not presented are rebooked at the next available slot.
4. Supply the driver roster, with a unique identifier for each driver.
5. Send its administrators to both remote training sessions, each lasting 90 minutes.
6. Sign off the go-live checklist.

## 5. Data migration

Kestravane can load data from an earlier system so that reports do not start from zero.

| Data | What can be migrated |
|---|---|
| Vehicles, drivers and depots | All records, from the Kestravane CSV templates |
| Trip and location history | The most recent 24 months only |
| Maintenance history | Up to 5 years, as service records |
| Driver safety scores | Cannot be migrated; scores are recalculated from new data |
| Camera footage | Cannot be migrated |

Files must be UTF-8 CSV in the Kestravane templates. Ready-made converters exist for exports from Dorrowick Telematics and Pennoway Fleet; exports from any other system are mapped by the customer into the templates. Trip history older than 24 months is not loaded under any plan, because the reporting engine does not index it.

Assisted data migration, in which the onboarding specialist maps and loads the files, is a paid service on Operations and is part of the onboarding fee on Enterprise; the price list gives the amount. Customers on Launch load their own files with the import wizard.

Tracking hardware from another supplier cannot be reused with Kestravane Fleet. Every vehicle needs a TrakNode unit.

## 6. Training

Two remote sessions for administrators are included with onboarding on Operations and Enterprise. Dispatcher and driver training is delivered through recorded modules in the help centre. On-site training is available as a paid day.

## 7. Go-live and hypercare

A rollout is declared live when 95% of contracted vehicles have reported data for three consecutive days, the administrators have completed training and the customer has signed the go-live checklist.

For 14 days after go-live the onboarding specialist or project manager stays assigned to the account and handles issues directly. After that hypercare period the account moves to the standard support channels for its plan.

## 8. Changes during a rollout

Adding vehicles, depots or connectors after kickoff is handled through a change note agreed between the customer's project lead and the onboarding specialist. Changes can move the go-live date; the specialist gives a revised estimate when the change note is raised.

---

Kestravane Professional Services. This guide describes the standard approach. A signed Statement of Work takes precedence where one exists.
