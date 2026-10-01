<!--
HOW THIS FILE IS READ
The in-app update card (src/components/UpdateModal.tsx) reads this release body
through electron/update/ReleaseNotesManager.ts and src/lib/releaseNotesDigest.mjs.
It shows the Summary, a count line ("12 new · 6 improvements · 11 fixes") and a
"Full release notes" link to this page. HTML comments like this one never appear
on GitHub or in the app.

RULES
1. Keep these exact headings: Summary, What's New, Improvements, Fixes, Technical.
   The app drops any other heading (e.g. "New", "Improved", "Fixed") without warning.
2. Every item is one line starting with "- ". Other lines are ignored by the app.
3. No markdown inside Summary or the bullets: no **bold**, links or `code`.
   Installed versions up to 2.8.8 show every bullet exactly as typed, so
   "**Auto Answer**" appears there with the asterisks. Write
   "Feature name — description" instead.
4. Tag the release v<version>, lowercase v, e.g. v2.9.0. Versions up to 2.8.8
   only look up the lowercase tag; with "V2.9.0" they find no notes at all.
5. Never start a line inside these comments with "- " or "* ": versions up to
   2.8.8 read such a line as a bullet even inside a comment.
-->

## Summary

<!--
THE ONLY TEXT THE UPDATE CARD SHOWS. Hard limit: 170 characters (about 25 words),
one paragraph, no bullets. The card has room for 5 lines; anything longer is cut
off with "…". Measured on macOS: 180–200 characters fill the 5 lines; 170 leaves
room for Windows' wider font. Check it with: echo -n "<summary>" | wc -m

Name the 4–6 biggest features from What's New, in the same order, using the
words a user would recognise. Do not describe them here; the bullets do that.

Pattern:  [One-phrase theme] — [feature], [feature], [feature], and [feature].
Example (159 characters):
Three months of work since v2.7.0 — a smarter answer engine, Auto Answer, rebuilt meeting notes, a Chrome extension, NVIDIA speech, and Windows stealth typing.
-->
[One-phrase theme] — [feature], [feature], [feature], and [feature].

## What's New

<!--
One bullet per feature, biggest first: the feature name, a spaced em dash,
then one or two sentences on what it does for the user and where to find it.
  Example: Auto Answer (Beta) — answers appear on their own when the other
  person finishes a question. Off by default; turn it on in Settings → General.
Keep the name under 40 characters: if a release has no Summary, the card shows
the first four names (the text before " — "), one line each.
Keep each bullet under about 300 characters (two sentences): versions up to
2.8.8 show every bullet in a small scrolling box.
-->
- Feature name — what it does for the user, and where to find it.
- Feature name — what it does for the user, and where to find it.
- Feature name — what it does for the user, and where to find it.

## Improvements

<!-- Changes to things that already existed. One line each, the result first. -->
- What got better, and how the user notices it.
- What got better, and how the user notices it.

## Fixes

<!--
What was broken, from the user's point of view. Group related fixes under an
area name:
  Example: Startup — fixed the app getting stuck on the logo, and a crash on launch.
-->
- Area — what was broken and is now fixed.
- Area — what was broken and is now fixed.

## Technical

<!-- For people building from source. Not counted on the update card. -->
- Dependency and build changes.
- Minimum tool versions.

## macOS Installation (Signed Build)

Download the correct architecture `.dmg` or `.zip` file for your device (Apple Silicon or Intel).

- **For Apple Silicon (M1/M2/M3/M4):** Download the `arm64` build.
- **For Intel Macs:** Download the `x64` build.

Open the downloaded file, drag **Natively** to your **Applications** folder, and launch it.

## ⚠️Windows Installation (Unsigned Build)

When running the installer on Windows, you might see a "Windows protected your PC" warning from Microsoft Defender SmartScreen saying it prevented an unrecognized app from starting. 

Since this is an unsigned build, this is expected. You can safely ignore it by clicking **More info** and then **Run anyway**.

\\ refer to change.md for detailed changes
