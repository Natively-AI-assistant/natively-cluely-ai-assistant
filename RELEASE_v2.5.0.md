## Summary

This major release introduces the **Modes Manager**, bringing 7 specialized AI personas to your workflow, alongside **Custom Context** for deeper profile intelligence, a new **10-Minute Free Trial** system, and significant **STT stability** upgrades.

## What's New

- **Modes Manager**: Tailor Natively to your specific meeting context with 7 specialized personas: General, Sales, Recruiting, Team Meet, Looking for Work, Lecture, and Technical Interview. Each mode features custom system prompts and note templates.
- **Custom Context**: A new free-form textarea in Profile Intelligence—auto-saved and injected into all AI interactions—allowing you to provide persistent context like sales stats, tech stacks, or personal preferences.
- **10-Minute Free Trial**: New users can now explore the full power of Natively, including premium STT and AI features, with a guided 10-minute trial and real-time quota tracking.
- **Permissions Guided Setup**: A new premium "Permissions Toaster" ensures Mic and Screen Recording permissions are correctly configured on first launch, reducing setup friction.
- **Trial Promo Toaster**: A subtle, beautifully designed delayed offer that introduces new users to the Pro features via a 10-minute hero countdown.

## Improvements

- **STT Stability & Resilience**: Completely rewrote the STT pipeline to use @deepgram/sdk v3 (Nova-3 model). Implemented a robust "shadow probe" system and smarter exponential backoff to eliminate 1006 connection drops and silent failures.
- **Premium Upgrade Redesign**: A full "Apple-tier" redesign of the upgrade modal, featuring clear plan tiers (Pro, Max, Ultra, Standard) with premium glass aesthetics and magnetic hover effects.
- **Ad Campaign Rework**: Optimized the ad engine to be less intrusive, with a 1h cooldown, sequential rotation, and plan-based targeting to avoid redundant offers for high-tier users.
- **Diagnostic Logging**: Added a new "Forward Log to File" capability (`~/Documents/natively_debug.log`) with an in-app toggle and progress bar for easier troubleshooting.

## Fixes

- **Audio Privacy**: Fixed an issue where the microphone could remain active while browsing the settings menu outside of a meeting.
- **Screenshot Capture**: Resolved a race condition that prevented screenshot listeners from attaching correctly during panel expansion.
- **Trial Persistence**: Fixed the "Start Trial" card incorrectly reappearing after a trial had already been claimed or expired.
- **Branding Consistency**: Completed the rebranding transition by replacing legacy "Cluely" references with "Natively" across all user-facing components.
- **Pro Gating**: Reinforced security gates on Modes and Profile Intelligence features to ensure correct license entitlement.

## Technical

- **Database Migration**: Upgraded SQLite to v14 to support Modes, Reference Files, and Custom Context persistence.
- **IPC Enhancements**: Expanded the IPC layer with robust extraction for PDF, DOCX, and TXT reference files.
- **Webhook Hardening**: Refactored Dodo webhook handling with per-endpoint secrets and strict product-id validation to prevent accidental license provisioning.
- **Deepgram & ElevenLabs Pools**: Implemented multi-key pools with round-robin rotation and per-key health tracking for enterprise-grade reliability.

## ⚠️macOS Installation (Unsigned Build)

Download the correct architecture .zip or .dmg file for your device (Apple Silicon or Intel).

If you see "App is damaged":

- **For .zip downloads:**
  1. Move the app to your Applications folder.
  2. Open Terminal and run: `xattr -cr /Applications/Natively.app`

- **For .dmg downloads:**
  1. Open Terminal and run:
     ```bash
     xattr -cr ~/Downloads/Natively-2.5.0-arm64.dmg
     # Or for Intel Macs:
     xattr -cr ~/Downloads/Natively-2.5.0-x64.dmg
     ```
  2. Install the natively.dmg
  3. Open Terminal and run: `xattr -cr /Applications/Natively.app`

## ⚠️Windows Installation (Unsigned Build)

When running the installer on Windows, you might see a "Windows protected your PC" warning from Microsoft Defender SmartScreen saying it prevented an unrecognized app from starting. 

Since this is an unsigned build, this is expected. You can safely ignore it by clicking **More info** and then **Run anyway**.

---
*Refer to changes.md for detailed breakdown of architectural fixes.*
