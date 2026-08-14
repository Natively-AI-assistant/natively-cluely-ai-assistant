# Security Policy

_Last updated: April 25th 2026_

We take the security of Natively seriously and we genuinely appreciate reports from researchers, users, and the community. This document describes how to report a vulnerability, what we'll do with it, and the rules of engagement.

---

## Supported versions

Security fixes are issued for:

- The **current minor release** (the latest version available on GitHub Releases); and
- The **previous minor release** for a reasonable transition window after a new minor ships.

Older versions are not supported. If you find a security issue in an unsupported version, please first reproduce it on the current release before reporting.

You can find the current version in the app's **Settings → About** screen, in `package.json` at the repo root, or on the [GitHub Releases page](https://github.com/evinjohnn/natively-cluely-ai-assistant/releases).

---

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues, GitHub Discussions, social media, blog posts, or any other public channel.** Public disclosure before a fix is available puts users at risk and is the single most common reason a coordinated-disclosure relationship breaks down.

### Where to send reports

Email **natively.contact@gmail.com** with a clear subject line such as "Security report — [short description]".

If your report is sensitive enough that you'd like an encrypted channel, mention this in your initial email and we'll arrange one before you send the technical details.

### What to include

Please include as much of the following as you can:

1. The **type of issue** (e.g., remote code execution, sandbox escape, IPC injection, license-validation bypass, audio-capture privacy boundary, dependency CVE, etc.).
2. The **affected component(s)**: full file paths and, ideally, the commit hash or release version where the issue is present.
3. **Steps to reproduce**, including any special configuration, OS version, hardware, or network setup needed.
4. A **proof-of-concept or exploit code** if one is practical.
5. The **impact** — what an attacker could realistically do, and against which class of user.
6. Any **suggested mitigation** you've considered (optional).

### Our response

- We acknowledge receipt of every security report **within 72 hours** on weekdays.
- We aim to give you an initial assessment (severity, in-scope status, expected timeline) within **7 days** of acknowledgement.
- We aim to release a fix for confirmed in-scope issues within **30–90 days** of confirmation, depending on severity and complexity.
- We will keep you informed of progress and let you know when the fix is released.

---

## Safe Harbor

If you make a **good-faith effort** to follow this policy, we commit to:

- Treating your report as authorised security testing under any applicable computer-misuse, anti-hacking, or unauthorised-access law that we have standing to assert (in India, the Information Technology Act, 2000; in the US, the Computer Fraud and Abuse Act; in the UK, the Computer Misuse Act 1990; and equivalents elsewhere).
- **Not pursuing legal action against you** for security research conducted under this policy.
- Working with you in good faith to understand and resolve the issue.
- Crediting your contribution publicly (with your consent) once the fix is released.

"Good-faith effort" means: you didn't access, modify, or destroy data beyond what was necessary to demonstrate the issue; you didn't degrade service quality or pivot to other systems; you didn't share the issue with anyone outside our coordinated process; and you gave us a reasonable opportunity to fix it before public disclosure.

This Safe Harbor extends to actions taken under this policy and within its scope. It does **not** authorise activity outside this policy, against third-party services, or against other users.

---

## Coordinated disclosure timeline

Our default position is **coordinated disclosure with a 90-day window**:

- If we confirm an issue is in-scope, we will work with you on a timeline to release a fix.
- After **90 days from the date we confirmed the issue** (or sooner if a fix is shipped earlier), you may publicly disclose the issue. We may ask for a short extension for high-complexity fixes; we won't ask for indefinite delays.
- If we cannot reproduce or confirm the issue, we'll explain why, and you may publicly disclose your findings on your own schedule.
- If a fix is shipped, we'll publish a corresponding **GitHub Security Advisory** and link your name (with consent) in the credits.

If we don't respond within the timelines above, you are free to disclose publicly — but please send a follow-up email first to make sure your initial report wasn't missed (email is unreliable, and as a small team we want every chance to respond).

---

## Scope

The following areas of the Service are **in scope** for security reports. High-value targets (where we'd particularly appreciate scrutiny) are marked with ★.

- ★ **License activation &amp; validation** — license-server protocol, signature checks, hardware-ID generation, attempts to bypass device-binding.
- ★ **IPC bridge** — communication between the Electron renderer and main processes; preload bridge; exposed API surface.
- ★ **Audio &amp; screen capture** — privacy boundaries around what's captured, when, and where it's sent. Improper capture, unintended capture, or capture leaks are taken very seriously.
- ★ **Auto-update mechanism** — integrity of updates, signature verification, downgrade protection.
- ★ **Phone Mirror pairing** — pairing-token handling, replay or hijack of paired sessions.
- **Authentication &amp; account boundaries** — anything that lets one user access another user's licence, quota, or data.
- **Payment-flow handling** (the parts the desktop app participates in — Dodo Payments handles the actual card processing).
- **Network communication** — TLS configuration, certificate handling, request integrity.
- **Local data storage** — SQLite database, `electron-store` settings, BYOK API-key storage.
- **Dependency vulnerabilities** — Electron, Node, and Rust-crate CVEs that materially affect the shipped app. Please reproduce on the current release before reporting.
- **The natively.software website** — server misconfigurations, common web vulnerabilities, and information leaks.

If you're not sure whether something is in scope, send the report — we'd rather triage and decline than miss a real issue.

---

## Out of scope

The following are **not** considered in-scope vulnerabilities under this policy:

- **Issues in unsupported versions** (see "Supported versions" above).
- **Issues already publicly known** or already tracked in our issue tracker / advisories.
- **Reports without a working proof-of-concept** or with only theoretical impact.
- **Bugs that don't have a security impact** — please file these as regular GitHub issues.
- **Reports from automated scanners or vulnerability dashboards** without manual verification or a clear exploitability case.
- **Self-XSS** and issues that require an attacker to already have full control of the victim's machine.
- **Social-engineering attacks** against the developer, support email, or other users.
- **Physical-access attacks** (anything requiring physical possession of an unlocked device).
- **Denial-of-service** attacks against our infrastructure that don't reveal a separate underlying weakness.
- **Email spoofing, missing SPF/DKIM/DMARC** on shared hosting / personal domains where they're outside our control. (We do try to keep them right, but reports here aren't bounty-eligible.)
- **Best-practice deviations** without exploitability (missing security headers on static pages, weak TLS suite ordering on a non-sensitive endpoint, etc.) — useful as feedback, not as security reports.

### AI-specific behaviour — clarification

The following are **not vulnerabilities** under this policy:

- **AI hallucinations or factual errors** in model outputs.
- **Prompt-injection attacks** that cause the underlying AI provider to behave in unintended ways. These are limitations of the underlying models, are in scope for the model provider's own safety processes, and are discussed in our [Terms &amp; Conditions §11](https://natively.software/termsandconditions). Reports about a *specific way to bypass a safety filter on OpenAI / Anthropic / Google models* should go to the respective provider.
- **Jailbreaks** of the AI assistant persona that don't expose data or control the user's machine.

A prompt-injection issue **becomes** in-scope if it leads to **exfiltration of user data**, **unauthorised local file access**, **privilege escalation in the IPC bridge**, or **execution of arbitrary code on the user's machine**. Please call this out clearly in your report.

---

## Public advisories &amp; credit

When a confirmed issue is fixed, we publish a **GitHub Security Advisory** at:

<https://github.com/evinjohnn/natively-cluely-ai-assistant/security/advisories>

The advisory includes a description of the issue, affected versions, the fix, and (with your consent) credit to the reporter. CVE assignment is requested where applicable through GitHub's CNA.

---

## Bounty / acknowledgement

We are a small project and **do not currently offer monetary bounties**.

What we do offer:

- A meaningful **acknowledgement in the security advisory** with a link of your choice (your name, handle, or website), with your consent.
- Inclusion in a "Hall of Thanks" section in the repository.
- A genuine, written thank-you. Reporting good-faith bugs to a one-person team is generous, and we don't take it for granted.

If we ever introduce a paid bounty programme, we'll publish the rules here before paying anyone — and previous reporters will be eligible retroactively for material findings.

---

## Contact

**Email:** natively.contact@gmail.com

For Privacy Policy questions, see [PRIVACY.md](./PRIVACY.md). For commercial / refund / licensing questions, see the [Refund Policy](https://natively.software/refundpolicy) and [Terms &amp; Conditions](https://natively.software/termsandconditions).

Thanks for helping keep Natively safe.
