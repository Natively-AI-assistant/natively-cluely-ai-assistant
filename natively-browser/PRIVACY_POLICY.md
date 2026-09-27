# Privacy Policy for Natively Companion

*Last Updated: June 13, 2026*

Natively ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how the Natively Companion Chrome Extension handles user data.

---

## 1. Information Collection and Use

The Natively Companion Chrome Extension **does not collect, store, or transmit any personal data, tracking information, or browsing history** to Natively or any third-party servers.

### How Data is Handled:
- **On-Demand Capture:** When you click "Capture Page" or use the capture hotkey, the extension extracts the readable text content of the active tab.
- **Local Transmission Only:** The extracted content is sent directly to your locally running Natively desktop application via a secure local loopback connection (`http://127.0.0.1` and `ws://127.0.0.1`).
- **No Remote Processing:** No external servers are involved in extracting, transmitting, or processing this page content.
- **Meeting detection:** While meeting detection is on in the Natively desktop app, the extension tells your local Natively app which of your open tabs are video meetings (Google Meet, Zoom, Microsoft Teams, Webex), so Natively can match the meeting to your calendar event. It sends only a short meeting identifier (for example `meet:abc-defg-hij`), the tab's title, and whether the tab is playing sound or in front. It never sends the page address (a Zoom link contains its passcode), the page's content, or anything about any other tab, and never anything from an incognito window. This also goes only to your local app over the loopback connection. Turn meeting detection off in Natively to stop it.
- **Names in Google Meet (optional):** Only if you click "Read names in Google Meet" in the extension's popup (which asks Chrome for access to meet.google.com), and only while meeting detection is on in Natively, the extension reads the participants' display names in your Google Meet calls and which of them is speaking, so Natively can label who said what in its transcript. This goes only to your local Natively app over the loopback connection; nothing is read from any other site, and nothing about the call's audio, video, chat or content. You can remove the access anytime under the extension's Details → Site access.

---

## 2. Permissions Used and Why

To perform its core functions, the extension requests the following permissions. None of these permissions are used to collect or monitor your data:

- **`activeTab` & `scripting`:** Used to temporarily read the text content of the tab you explicitly choose to capture.
- **`storage`:** Used to store your local pairing credentials (the port number and secure authorization token) so you do not have to pair the extension every time.
- **`alarms`:** Used for local keep-alive scheduling to maintain the connection to your desktop client.
- **`tabs`:** Used to find the correct active browser tab when you press the global shortcut on your desktop, and, while meeting detection is on in the desktop app, to recognise which open tabs are video meetings (see above).
- **Host Permissions (`http://127.0.0.1/*`, `ws://127.0.0.1/*`):** Needed to send data to the Natively desktop application running on your computer.

---

## 3. Data Retention and Third Parties

- We do not store your browsing data.
- We do not share any data with third parties.
- Since all communication happens locally on your computer, your data remains completely offline and private.

---

## 4. Changes to This Policy

We may update this Privacy Policy from time to time. Any changes will be reflected in this document and updated with a new revision date.

---

## 5. Contact Us

If you have any questions or feedback about this privacy policy, please contact us through our main website or open an issue on our official repository.
