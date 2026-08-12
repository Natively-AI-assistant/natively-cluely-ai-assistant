# Known issues and workarounds

- **NAT-218** — STT reconnect loop on Windows when an active corporate VPN tunnel drops UDP heartbeats. Workaround: switch STT provider to Local Whisper in Settings until the next release.
- **NAT-241** — Linux is not currently a supported platform. The installer is mac/Windows only; Linux build is on the roadmap but not committed.
- **NAT-309** — Custom provider API key replacement does not invalidate the in-memory client; restart the app after replacing a custom provider key.
- **NAT-322** — Resume parsing fails on legacy DOC files. The supported formats for Profile Intelligence ingestion are PDF and DOCX only.

When a customer reports something not in this list, ask for OS version, app version, and the last 30 lines of the diagnostics log before promising a fix.
