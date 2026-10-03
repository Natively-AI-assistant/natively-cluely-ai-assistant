# Catarina Velmonte

Lead Frontend Engineer, Product Engineering

Porto, Portugal | catarina@velmonte.example | +351 22 555 0178 | velmonte.example

## About me

Product-minded frontend engineer with nine years of experience: the last four in React and TypeScript, the earlier five mostly in Vue. I lead the frontend chapter at Lumenquay, built its design system, and run the experimentation practice that decides what ships in our booking product. I care most about interfaces that are fast on a mid-range phone and fully usable with a keyboard and a screen reader. Most interested in work where product decisions are made with data and accessibility is a first-class requirement.

## Experience

### Lumenquay, Porto (remote-first)

Scheduling and client-messaging software for veterinary clinics, used by about 2,700 clinics.

#### Lead Frontend Engineer | January 2024 - Present

- Lead the frontend chapter of 18 engineers across 5 product squads and work day to day in the booking squad of 6; I set frontend standards, run the fortnightly architecture forum and own the frontend hiring loop.
- Founded and lead Pebblekit, the company design system (details under Selected projects).
- Wrote Dialbench, the in-house experimentation toolkit, including its small Node.js assignment service (details under Selected projects).
- Defined the product analytics taxonomy with product and data colleagues: 96 tracked events with typed payloads, so that a renamed event fails the build instead of silently breaking a funnel.
- Run a weekly accessibility triage with design and support, and review every new pattern for keyboard and screen-reader behaviour before it reaches a squad.

#### Senior Frontend Engineer | June 2022 - December 2023

- Tech lead of Fernlatch, the rebuild of the pet-owner booking flow (details under Selected projects).
- Moved the clinic web app from JavaScript to TypeScript in strict mode: 1,150 files over 5 months, folder by folder, with no release freeze.
- Introduced performance budgets with Lighthouse CI so that a pull request adding more than 25 kB to the booking route is blocked.

### Ondaverde Health, Lisbon

Patient portal and appointment tools for private clinics.

#### Frontend Engineer | February 2020 - May 2022

- Led the move of Farolim, the patient portal, from Vue 2 to Vue 3: 140 views, Vuex replaced by Pinia, done in 8 months alongside normal feature work.
- Raised unit coverage of the portal from 34% to 71% while the views were being rewritten.
- Ran the accessibility remediation of the portal; it passed an external WCAG 2.1 AA audit in March 2022, with manual checks in NVDA and VoiceOver.
- Built the appointment-reminder preferences screens and the clinic-side availability editor.

### Plumewright Studio, Braga

Digital agency building marketing sites and small online shops.

#### Junior Web Developer | September 2017 - January 2020

- Built more than 20 marketing sites and 4 online storefronts in Vue 2 and plain JavaScript.
- Set up the agency's first shared component folder and its CSS naming conventions, reused across client work.

## Selected projects

### Pebblekit design system (Lumenquay, 2023 - present)

Role: founder and lead of the working group of 3 engineers and 2 designers.

- 64 components in React and TypeScript, documented in Storybook, with design tokens generated from Figma variables.
- Adopted by all 5 product squads and used in 3 applications: the clinic web app, the pet-owner booking flow and the internal admin.
- Every component meets WCAG 2.2 AA; axe-core checks and keyboard-interaction specs run in CI on every pull request.
- Automated accessibility violations across the product fell from 212 to 9 in the year after adoption.
- Visual regression with Playwright screenshots on every pull request.

### Fernlatch booking flow (Lumenquay, September 2022 - April 2023)

Role: tech lead of 3 frontend engineers, working with 1 designer.

- Rebuilt the booking flow in React and TypeScript with server rendering on Next.js, route-level code splitting and image sizing done at build time.
- Mobile p75 LCP went from 4.3 s to 1.7 s and interaction delay from 380 ms to 120 ms.
- JavaScript on first load went from 1.9 MB to 610 kB.
- Booking completion rose from 61.2% to 66.8%, measured in a six-week A/B experiment against the old flow.

### Dialbench experimentation toolkit (Lumenquay, 2024)

Role: sole author of the first version; now maintained with 1 backend engineer.

- A feature-flag and A/B assignment service in Node.js on Fastify, plus a React hooks SDK; deterministic bucketing by account, with exposure events sent to Amplitude.
- 38 experiments ran on it in its first year, each with a written hypothesis, a primary metric and guardrail metrics agreed before launch.
- One of them, the reminder opt-in redesign, raised opt-in from 27% to 33%.

## Skills

- Frontend: React, TypeScript, Vue 3, Next.js, modern CSS (container queries, CSS modules)
- Quality: Playwright, Vitest, axe-core, Storybook, Lighthouse CI
- Product: experiment design, funnel analysis, Amplitude, event taxonomies
- Backend, light: Node.js, Fastify, GraphQL clients
- Accessibility: WCAG 2.2, ARIA authoring patterns, NVDA and VoiceOver

## Education

Licenciatura (BSc) in Informatics Engineering, Instituto Superior de Valdouro, Braga, 2014 - 2017. Final grade 16 / 20.

## Certifications and community

- IAAP Web Accessibility Specialist (WAS), 2023
- Talk: Design tokens that survive a rebrand, Porto Frontend Meetup, October 2024
- Languages: Portuguese (native), English (fluent), Spanish (intermediate)
