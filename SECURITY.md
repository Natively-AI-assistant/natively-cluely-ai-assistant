# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.2.x   | :white_check_mark: |
| < 2.1.0 | :x:                |

## Reporting a Vulnerability

We take the security of our software seriously. If you have found a security vulnerability in this open-source interview meeting application, please report it to us as described below.

**Do not report security vulnerabilities through public GitHub issues.**

## Disclosure Process

1.  Please email your report to **natively.contact@gmail.com**.
2.  In your report, please include:
    *   The type of issue (e.g., buffer overflow, SQL injection, cross-site scripting, etc.).
    *   Full paths of source file(s) related to the manifestation of the issue.
    *   The location of the affected source code (tag/branch/commit or direct URL).
    *   Any special configuration required to reproduce the issue.
    *   Step-by-step instructions to reproduce the issue.
    *   Proof-of-concept or exploit code if possible.
    *   Impact of the issue, including how an attacker might exploit the issue.
3.  We will acknowledge receipt of your vulnerability report within **72 hours**.
4.  We will investigate the report and may ask for further information.
5.  Once the issue is resolved, we will release a patch and publish a security advisory.

## Scope

The following areas are considered in scope for security reports:

*   **Data Handling:** Issues related to how user data is stored, processed, or transmitted.
*   **Local Processing:** Vulnerabilities arising from local data processing on the user's machine.
*   **Permissions:** Incorrect or overly broad permission requests or enforcement.
*   **Network Communication:** Insecure network connections or data leakage during communication.

Out of scope:
*   Bugs that do not have a security impact.
*   Reports from automated tools or scans without manual verification.
*   Attacks requiring physical access to the user's device.

## Appreciation

We appreciate the efforts of security researchers and the open-source community in helping us improve the security of this project.
