# Phone Mirror Mode

Phone Mirror Mode streams Natively AI responses from your desktop to a phone browser on the same WiFi network. It is useful when you are sharing your desktop screen and want to keep the AI output visible privately on your phone instead of on the shared display.

## Setup

```bash
cd phone-bridge
npm install
node server.js
```

The bridge starts an HTTP and WebSocket server on port `3000`, watches Natively's local SQLite database in read-only mode, and prints a phone-friendly URL:

```text
Open on your phone: http://192.168.x.x:3000
```

Open that URL from your phone while both devices are on the same WiFi network. New assistant responses will appear as cards with timestamps.

## Database Path

The bridge auto-detects Natively's database from these locations:

- `%APPDATA%\natively\natively.db`
- `%APPDATA%\Natively\natively.db`
- `%LOCALAPPDATA%\natively\natively.db`

If your database is somewhere else, pass `DB_PATH` when starting the server.

PowerShell:

```powershell
$env:DB_PATH="C:\path\to\natively.db"
node server.js
```

macOS or Linux shell:

```bash
DB_PATH="/path/to/natively.db" node server.js
```

On first run, the server prints the SQLite table names and columns so schema mismatches are easy to debug.
