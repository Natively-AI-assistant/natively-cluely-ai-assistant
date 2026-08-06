# iOS USB interview path (Phone Mirror)

**Transport role:** USB is the **interview-day primary** link. Tailscale (or same Wi‑Fi LAN) is for **on-the-go testing**. Protocol is unchanged — only the host IP changes.

## Chosen mechanism: USB network via iPhone Personal Hotspot

iOS has **no `adb reverse`**. Stock `iproxy` / usbmuxd only forwards **Mac → device**, not phone → Mac localhost. Embedding a PeerTalk-style reverse tunnel in the RN app is out of scope for this ticket.

**Primary path:** plug in USB, enable **Personal Hotspot** on the iPhone (Allow Others to Join), and pair the RN app to the **Mac’s IP on the USB/hotspot interface** — typically `172.20.10.2` — with Phone Mirror port `4123`.

Traffic stays on the cable/tether link. You still turn on Phone Mirror **Allow LAN** so the desktop binds beyond loopback; you do **not** need shared office Wi‑Fi or Tailscale for the interview desk.

| Role | Host to enter in RN Pairing |
| --- | --- |
| Interview (USB hotspot) | Mac IP on tether (often `172.20.10.2`) |
| On-the-go test | Tailscale `100.x` / MagicDNS |
| Same Wi‑Fi fallback | Desktop LAN IP |

Do **not** use `127.0.0.1` / `localhost` on a physical iPhone — that is the phone itself, not the Mac (unlike Android `adb reverse`).

### Why not `iproxy` reverse?

`iproxy LOCAL_PORT DEVICE_PORT` exposes a device port on the Mac. Phone Mirror needs the **opposite** direction (app → desktop). Without a custom in-app USB tunnel, that is not available. We document the USB **network interface** path instead.

---

## Interview-day setup (Mac + iPhone)

### Once (or after OS updates)

1. Trust this Mac on the iPhone when prompted (USB).
2. Install / sideload the Natively Mirror RN app (see [../README.md](../README.md)).
3. Confirm desktop Natively Phone Mirror works (Settings → Sync).

### Every interview

1. Connect iPhone to Mac with a **data-capable** USB cable.
2. On iPhone: **Settings → Personal Hotspot → Allow Others to Join** (USB tether; Wi‑Fi hotspot clients optional).
3. On Mac: confirm the tether interface has an IPv4 address (often `172.20.10.2`):

   ```bash
   node scripts/ios-usb-interview-host.mjs
   ```

   Copy the printed **Suggested host**.
4. Desktop: enable **Phone Mirror** and **Allow LAN**. Copy the phone token (or pairing URL) from Sync. You can rewrite the host in the URL to the USB host from step 3.
5. On the phone app: choose transport tip **USB**, set **Host** to the suggested Mac tether IP, **Port** `4123`, paste **phone token**, Connect.
6. Verify live stream + a quick action before the call. Leave the cable plugged in for the session.

### Optional: Mac Internet Sharing → iPhone USB

If Personal Hotspot is unavailable, share Mac internet **to** iPhone USB (System Settings → General → Sharing → Internet Sharing → iPhone USB). The Mac is often `192.168.2.1` on that bridge — still use that IP (not localhost) in Pairing. Prefer Personal Hotspot when it works; the helper script looks for both patterns.

### Tear-down

- End / disconnect Phone Mirror session as usual.
- Turn off Personal Hotspot when finished (saves battery).
- Unplug USB.

---

## Desktop helper

```bash
# From repo root
node scripts/ios-usb-interview-host.mjs
node scripts/ios-usb-interview-host.mjs --port 4123 --check
node scripts/ios-usb-interview-host.mjs --json
```

The script:

- Detects likely USB/tether IPv4 addresses on **macOS** (`172.20.10.0/28`, `bridge*`, etc.).
- Prints suggested host, port, and a short checklist.
- Optionally TCP-checks `host:port` (Phone Mirror listening).
- On **Windows**: prints an explicit gap — no verified Windows USB interview path in this ticket; use Tailscale/LAN for Windows desks until a Windows USB path is designed and physically verified.

Requires only Node (no Homebrew `iproxy`).

---

## Pairing UX (RN app)

On the pairing screen:

- **USB** — interview tip + suggested host `172.20.10.2` (override with helper output if different).
- **LAN** — same Wi‑Fi desktop IP.
- **Tailscale** — `100.x` / MagicDNS for away-from-desk tests.

Paste-URL still works; after paste, switch host to the USB IP if the desktop QR still shows a Wi‑Fi/Tailscale address.

---

## Manual AC checklist

- [ ] Cable connected; iPhone trusts Mac
- [ ] Personal Hotspot on; `node scripts/ios-usb-interview-host.mjs` prints a tether host (or you confirmed Mac IP another way)
- [ ] Phone Mirror **on** + **Allow LAN** on desktop
- [ ] RN Pairing: transport **USB**, host = tether Mac IP, port `4123`, valid phone token
- [ ] Connect succeeds; history and live `token` stream visible
- [ ] At least one control path works (chat or quick action) over USB host
- [ ] Disconnect cable → session drops or errors (expected); reconnect USB + hotspot restores with same host
- [ ] Tailscale path still works when USB is off (on-the-go regression)

### Physical verification still required

- Full Mac + physical iPhone USB hotspot + Phone Mirror WS was **not** executed in the agent environment for this ticket.
- Confirm `172.20.10.2` vs your Mac’s actual tether IP on interview hardware.
- Windows USB tether path: **not designed / not verified** — do not claim Windows USB interview support yet.

---

## Cross-platform notes

| Platform | USB interview status |
| --- | --- |
| macOS + iPhone | **Primary documented path** (Personal Hotspot over USB + Allow LAN) |
| Windows + iPhone | **Gap** — Apple Mobile Device USB networking differs; helper refuses to invent a host. Use Tailscale/LAN until a Windows path is implemented and physically tested. |
| Android | Out of scope here; desktop already documents `adb reverse` + loopback for the web/Android path. |
