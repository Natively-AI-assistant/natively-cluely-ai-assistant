# Natively Phone Mirror (React Native)

Personal **iOS-first** React Native client for desktop [Phone Mirror](../electron/services/PhoneMirrorService.ts).  
Connects with the existing phone-token WebSocket (`ws://host:port/ws?t=<token>`), shows connect `history`, and streams live `token` / `done` / `assistant` / `error` (plus `user`) answers.

- **Not** Safari and **not** a WKWebView wrapping Phone Mirror HTML — native RN UI.
- **Distribution:** personal sideload only (Xcode / Expo). Android is deferred.
- Does **not** require knowledge-gateway tickets 16/17.

## Prerequisites

- Node 20+ (repo uses Node 24 locally)
- Xcode + iOS Simulator (or a physical iPhone with a development team)
- Desktop Natively with Phone Mirror enabled and **Allow LAN** (or Tailscale IP)
- **Interview day (USB):** see **[docs/USB-INTERVIEW.md](./docs/USB-INTERVIEW.md)** — iPhone Personal Hotspot over USB (not `localhost`; iOS has no `adb reverse`)

## Install

```bash
cd mobile
npm install
```

## Run on iOS Simulator (Expo)

```bash
cd mobile
npm run ios
```

Or:

```bash
npx expo start --ios
```

Enter the desktop host, port (default `4123`), and phone token from Settings → Sync (or paste the pairing URL).

On the pairing screen pick a transport tip:

| Tip | When |
| --- | --- |
| **USB** | Interview day — Mac tether IP (often `172.20.10.2`); run `node scripts/ios-usb-interview-host.mjs` on the Mac |
| **LAN** | Same Wi‑Fi desk test |
| **Tailscale** | On-the-go test (`100.x` / MagicDNS) |

Full USB checklist: [docs/USB-INTERVIEW.md](./docs/USB-INTERVIEW.md).

## Sideload / open in Xcode

Generate the native iOS project and build:

```bash
cd mobile
npx expo prebuild --platform ios
npx expo run:ios
# or: open ios/NativelyMirror.xcworkspace
```

`ios/` is generated locally (gitignored). Use your Apple development team for device installs.

## Pairing notes

| Field | Source |
| --- | --- |
| Host | USB tether Mac IP (interview), LAN IP, or Tailscale IP |
| Port | Phone Mirror port (usually `4123`) |
| Phone token | `t=` from the QR / `primaryUrl` / `lanUrls` |

Do **not** use `127.0.0.1` on a physical iPhone — that is not the Mac (unlike Android `adb reverse`).

Host, port, and token persist via AsyncStorage.

On token rotate the server closes with code **4401**. This client **stops auto-reconnect** and shows an error — update the token and connect again (no reconnect storm). HTTP **401** on upgrade is treated the same (fatal; no storm).

## Unit tests

Protocol parse + reconnect policy (no device required):

```bash
cd mobile
npm test
```

## Layout

```text
mobile/
  App.tsx                 # Pairing ↔ stream screens
  docs/USB-INTERVIEW.md   # Interview-day USB path + AC checklist
  src/
    pairing/              # USB / LAN / Tailscale transport tips
    protocol/             # StreamEvent types, parse, feed, reconnect policy
    storage/              # AsyncStorage pairing persistence
    ws/                   # PhoneMirrorConnection
    components/           # PairingScreen, StreamFeed
```

Desktop helper (repo root): `node scripts/ios-usb-interview-host.mjs`
