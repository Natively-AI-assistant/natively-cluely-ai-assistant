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

---

## 2. Permissions Used and Why

To perform its core functions, the extension requests the following permissions. None of these permissions are used to collect or monitor your data:

- **`activeTab` & `scripting`:** Used to temporarily read the text content of the tab you explicitly choose to capture.
- **`storage`:** Used to store your local pairing credentials (the port number and secure authorization token) so you do not have to pair the extension every time.
- **`alarms`:** Used for local keep-alive scheduling to maintain the connection to your desktop client.
- **`tabs`:** Used to find the correct active browser tab when you press the global shortcut on your desktop.
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
