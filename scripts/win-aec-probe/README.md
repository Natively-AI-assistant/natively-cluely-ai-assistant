# win-aec-probe (issue #710)

Checks whether opening the Windows microphone in **communications mode**
makes Windows cancel the speaker echo that Natively transcribes as "Me".

It records the default mic twice, once the way Natively opens it today
(default mode) and once as a communications stream. During each recording
it also captures what the speakers play. Then it reports how much of the
speaker sound reached the mic in each mode.

## Run it

You need a Windows laptop with built-in speakers and a built-in mic (no headphones).

1. Install Rust from https://rustup.rs (Rust 1.82 or newer). This installs
   the Visual Studio C++ build tools if they're missing.
2. In this folder, run:
   ```
   cargo run --release
   ```
3. Play continuous speech (a YouTube talk or podcast) through the laptop
   speakers at normal volume. Press Enter, then stay silent for about 40 s
   (20 s for each mode).

Options:

| Flag | Meaning |
|---|---|
| `--seconds N` | length of each recording (default 20) |
| `--mode both\|default\|comms` | which modes to record (default both) |
| `--role console\|communications` | which default mic to use (default console, the one Natively uses) |
| `--allow-ducking` | don't opt out of Windows turning other audio down |
| `--out DIR` | where the WAVs go (default `aec-probe-out`) |

## Reading the result

- **Effects on mic stream** lists what Windows says it applies, for example
  "Acoustic echo cancellation ON". Windows 11 only.
- **Echo coupling** is the mic level minus the speaker level while speech
  plays. The **reduction** from default to communications mode is the echo
  Windows removed:

  | Reduction | Meaning |
  |---|---|
  | 15 dB or more | communications mode handles the echo on this PC |
  | 6–15 dB | partial reduction |
  | under 6 dB | no meaningful echo cancellation |

- **Echo correlation** (0–1) is how closely the mic matches the speaker
  signal. It should drop sharply when echo cancellation works.
- The **ducking warning** means the speakers got quieter in communications
  mode, so Windows may be turning other apps down.

Listen to `aec-probe-out/mic-default.wav` and `mic-communications.wav` too.

Paste the full output into issue #710, with the PC model and the mic name it prints.

For a second run, talk over the video during the recording. This checks
that communications mode doesn't cut your own voice.
