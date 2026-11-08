# Outlook calendar: Microsoft app registration

Natively reads Outlook calendars (Microsoft 365 work or school accounts and personal Outlook.com accounts) through Microsoft Graph. Signing in needs one Microsoft Entra app registration. Until a build carries its client ID, the Outlook row in Settings › Calendar shows, greyed out, with the line "Not available in this version yet".

The registration is a **public client**: an installed app cannot keep a secret, so there is none. The sign-in is the authorization code flow with PKCE on a loopback redirect (`electron/services/calendar/providers/MicrosoftCalendarProvider.ts`), the same pattern Google Calendar uses.

## 1. Register the app

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com) (or the Azure portal) with the account that should own the app.
2. Go to **Identity › Applications › App registrations › New registration**.
3. **Name:** `Natively`. This is the name people see on Microsoft's consent screen.
4. **Supported account types:** choose **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**. This is what the `common` tenant needs.
5. **Redirect URI:** leave it empty here (step 2 adds it under the right platform).
6. Select **Register**.
7. On the app's **Overview** page, copy the **Application (client) ID**. It is a GUID such as `00001111-aaaa-2222-bbbb-3333cccc4444`.

## 2. Add the redirect URI

1. Open **Authentication** (under Manage).
2. Select **Add a platform**, then **Mobile and desktop applications**.
3. Under **Custom redirect URIs**, enter exactly `http://localhost` and select **Configure**.
   - Do not add a port or a path. Microsoft ignores the port on `localhost` redirect URIs, and Natively opens its callback server on a free port each time (`http://localhost:<port>`).
   - Do not add the same URI under the **Web** or **Single-page application** platform. Microsoft would then expect a client secret or a browser origin, and the token request from the app would be refused.
   - Do not register several `localhost` URIs that differ only by port.
4. Under **Advanced settings**, set **Allow public client flows** to **Yes**, then **Save**.

## 3. API permissions

1. Open **API permissions**.
2. A new registration already lists **Microsoft Graph › User.Read (Delegated)**. Keep it: it gives the account's name and address that Settings shows ("Connected as …") and that the notes use to tell your colleagues from the other side.
3. Select **Add a permission › Microsoft Graph › Delegated permissions** and add:
   - `Calendars.Read`: reads the events in the signed-in user's default calendar.
   - `offline_access`: keeps the connection without asking the user to sign in again.
4. Do **not** grant admin consent unless your own organisation wants to. Each person consents for themselves when they connect. Some work tenants block user consent: their admin then approves Natively once, and nothing in the app changes.

These three are exactly the scopes the app requests (`MICROSOFT_SCOPES` in `electron/services/calendar/providers/microsoftGraph.ts`). All three are delegated and read-only.

## 4. No secret, no certificate

Leave **Certificates & secrets** empty. The app never sends a client secret. PKCE protects the authorization code instead: only the Natively process that started the sign-in holds the code verifier.

## 5. Branding (recommended before release)

Under **Branding & properties**, set the logo, the home page `https://heynatively.com`, and the privacy and terms URLs. For multitenant apps, Microsoft shows unverified apps with a warning on the consent screen. **Publisher verification** (a Microsoft Partner Network ID linked to the app) removes it and is required before users in many work tenants can consent.

## 6. Put the ID in the build

The client ID is not a secret. It ships inside every installer, like Google's client ID does. It is baked in at build time by `scripts/build-electron.js` (esbuild `define`, read by `scripts/lib/microsoft-calendar-client.cjs`):

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `MICROSOFT_CALENDAR_CLIENT_ID` | yes | empty: the Outlook row is disabled | The Application (client) ID from step 1 |
| `MICROSOFT_CALENDAR_TENANT` | no | `common` | Leave unset. Use `organizations` (work and school only) or one tenant's ID only if the registration in step 1 was made for that |

**Local builds (macOS and Windows), the normal way Natively is released:** add the variable to `.env` at the repo root, or set it in the shell. `npm run dist` (and `dist:signed`) runs `build:electron`, which reads it:

- macOS: `export MICROSOFT_CALENDAR_CLIENT_ID=00001111-aaaa-2222-bbbb-3333cccc4444`
- Windows PowerShell: `$env:MICROSOFT_CALENDAR_CLIENT_ID = "00001111-aaaa-2222-bbbb-3333cccc4444"`

The build log says `MICROSOFT_CALENDAR_CLIENT_ID is not set` when it is missing. The build still succeeds, but Outlook is disabled in that installer, so check the log before shipping. A Windows build made on another machine needs the same `.env` line there.

**CI (only if a release is ever built on GitHub Actions):** add a repository **variable** (not a secret), `MICROSOFT_CALENDAR_CLIENT_ID`, under GitHub › Settings › Secrets and variables › Actions › Variables. `.github/workflows/release-macos.yml` passes `vars.MICROSOFT_CALENDAR_CLIENT_ID` (and the optional `vars.MICROSOFT_CALENDAR_TENANT`) to the build step. A Windows release workflow, when there is one, needs the same two lines in its build step's `env`.

**Development override:** an unpackaged run also reads `MICROSOFT_CALENDAR_CLIENT_ID` from the environment at runtime, so a dev build can try another registration without rebuilding.

## 7. Check it

1. Build with the ID set, open Settings › Calendar and select **Connect** on the Outlook row.
2. The browser opens Microsoft's account picker and the consent screen lists "Read your calendars", "Maintain access to data you have given it access to" and "Sign you in and read your profile".
3. After consenting, the browser shows "Outlook Calendar connected" and the row shows the account's name and address. The next 7 days include the Outlook meetings, with a Join button on Teams meetings.

If the sign-in page says the redirect URI does not match, check step 2: the URI must be under **Mobile and desktop applications** and be exactly `http://localhost`. If it says the app needs admin approval, the user's tenant blocks user consent (step 3, point 4).

## What the app does with it

- Tokens are stored in `outlook_calendar_tokens.enc` in the app's user data folder, encrypted with Electron safeStorage (macOS Keychain, Windows DPAPI), the same way Google Calendar's are. Microsoft rotates refresh tokens. Every refresh stores the new one.
- Events come from `GET /me/calendarView` for the same 7 days the Google sync covers, every page followed (at most 1000 events), times in UTC. Only the default calendar is read.
- All-day, cancelled and under-5-minute events are skipped (the same rules Google's events follow). A recurring occurrence keeps its series (`seriesMasterId`), so "last time" notes find the previous meeting of the series.
- Disconnect in Settings deletes the tokens on this computer. To revoke Natively's access entirely, the user removes it at [myapps.microsoft.com](https://myapps.microsoft.com) (work or school) or [account.live.com/consent/Manage](https://account.live.com/consent/Manage) (personal).
