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

Enter the desktop LAN/Tailscale host, port (default `4123`), and phone token from Settings → Sync (or paste the pairing URL).

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
| Host | LAN IP or Tailscale IP of the desktop |
| Port | Phone Mirror port (usually `4123`) |
| Phone token | `t=` from the QR / `primaryUrl` / `lanUrls` |

Host, port, and token persist via AsyncStorage.

On token rotate the server closes with code **4401**. This client **stops auto-reconnect** and shows an error — update the token and connect again (no reconnect storm). HTTP **401** on upgrade is treated the same (fatal; no storm).

## Unit tests

Protocol parse, command builders, reconnect policy (no device required):

```bash
cd mobile
npm test
```

## Layout

```text
mobile/
  App.tsx                 # Pairing ↔ stream screens
  src/
    protocol/             # StreamEvent types, parse, feed, phoneCommands, reconnect
    storage/              # AsyncStorage pairing persistence
    ws/                   # PhoneMirrorConnection (+ sendCommand)
    components/           # PairingScreen, StreamFeed, SessionControls
```

After connect, `SessionControls` (bottom, one-handed) sends chat / quick actions /
screenshot / two-device stealth over the same WS. `StreamFeed` exposes `topSlot`
for ticket 20 (start-session / modes / status).
