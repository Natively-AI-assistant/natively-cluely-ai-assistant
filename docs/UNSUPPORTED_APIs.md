# Unsupported/Unimplemented Preload APIs

These channels and methods were investigated during the Codex + Antigravity deep comparison audits across Natively 3.1.0 and current development builds.

## Overview

A deep comparison audit identified 18 preload channels as potential "ghost" APIs (declared in `electron/preload.ts` without direct `safeHandle` registrations in `electron/ipcHandlers.ts`):

1. `stealth-tap:*` (6 channels: `available`, `open-settings`, `stop`, `start`, `should-auto-engage`, `refresh-ime`)
2. `stealth-edit:*` (2 channels: `read-clipboard`, `write-clipboard`)
3. `connectors:gmail-*` (5 channels: `status`, `connect`, `cancel`, `disconnect`, `set-briefs`, `send-followup`)
4. `connectors:apikeys-*` (3 channels: `list`, `create`, `revoke`)
5. `get-system-audio-permission-warning` (1 channel)

## Subsystem Architecture & Status

Investigation revealed that rather than being dead or missing code, these channels are registered through dedicated modular subsystem lifecycles:

### 1. Stealth Mode & Tap Interception
- **Channels**: `stealth-tap:available`, `stealth-tap:open-settings`, `stealth-tap:stop`, `stealth-tap:start`, `stealth-tap:should-auto-engage`, `stealth-tap:refresh-ime`, `stealth-edit:read-clipboard`, `stealth-edit:write-clipboard`
- **Backend Location**: `electron/main.ts` (registered dynamically via `registerStealthHandler`)
- **Platform Behavior**: On macOS, backed by `CGEventTap` and Accessibility permissions; on Windows, backed by low-level keyboard hooks and fallback handlers.
- **Renderer Usage**: Invoked by `src/components/NativelyInterface.tsx` and protected by regression tests (`PreloadStealthTapBridgeComplete2026_08_14.test.mjs`, `StealthIpcHandlerRegistration.test.mjs`).

### 2. Connectors (Gmail & Local API)
- **Channels**:
  - `connectors:gmail-status`, `connectors:gmail-connect`, `connectors:gmail-cancel`, `connectors:gmail-disconnect`, `connectors:gmail-set-briefs`, `connectors:gmail-send-followup`
  - `connectors:apikeys-list`, `connectors:apikey-create`, `connectors:apikey-revoke`
- **Backend Location**: Registered modularly in `electron/services/outputs/outputsIpc.ts` via `registerGmailIpc` (`gmailIpc.ts`) and `registerLocalApiIpc` (`localApiIpc.ts`).
- **Status**: Tested in `electron/services/__tests__/ConnectorsGmail2026_10_17.test.mjs` and `ConnectorsLocalApi2026_10_17.test.mjs`.

### 3. System Audio Permission Warning
- **Channel**: `get-system-audio-permission-warning`
- **Backend Location**: Registered in `electron/main.ts` via `registerStealthHandler('get-system-audio-permission-warning', ...)`.
- **Status**: Provides current platform warning for system audio permissions.

## Summary

These APIs are documented to clarify their modular registration outside `ipcHandlers.ts`. Do not remove these declarations from `preload.ts` as doing so breaks renderer features and automated regression tests.

