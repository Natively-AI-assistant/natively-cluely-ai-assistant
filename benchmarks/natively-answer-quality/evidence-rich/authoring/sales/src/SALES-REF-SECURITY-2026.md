# Kestravane Fleet - Security and Compliance Overview

Version 2026.2 - 12 June 2026

Owner: Ingrid Solheimsvik, Head of Security and Trust. Approved for sharing with customers and prospects. Reports referred to below are released under a non-disclosure agreement through trust@kestravane.example.

## 1. Purpose

This overview summarises the main controls that protect customer data in the Kestravane Fleet service. Where something is planned or in progress rather than in place, it says so. It is not a complete list of controls, nor of the laws and standards Kestravane works to; anything not covered here should be raised with the Security and Trust team.

## 2. Hosting and data residency

Kestravane Fleet runs on Amazon Web Services.

| Region | Location | Availability |
|---|---|---|
| United States (default) | Oregon, with disaster recovery in Ohio | All plans |
| European Union | Frankfurt, Germany | Enterprise only |

The region is chosen when the account is provisioned. Moving an account between regions after go-live is not supported. No other hosting regions are available, and Kestravane does not offer an on-premises or customer-hosted deployment.

## 3. Encryption

Data at rest is encrypted with AES-256. Data in transit is protected with TLS 1.2 or higher; TLS 1.3 is used wherever the client supports it. Encryption keys are held in AWS Key Management Service and rotated every 12 months. Customer-managed encryption keys are not offered.

TrakNode units encrypt data before sending it over the cellular network, and each unit holds its own device certificate.

## 4. Identity and access

| Capability | Availability by plan |
|---|---|
| Single sign-on (SAML 2.0 or OpenID Connect) | Included on Operations and Enterprise; not available on Launch |
| SCIM 2.0 user provisioning | Included on Enterprise only |
| Multi-factor authentication | Required for password logins on Launch; enforced through the identity provider on Operations and Enterprise |
| Role-based access control | 3 fixed roles on Launch; custom roles as well on Operations and Enterprise |

Single sign-on has been verified with Okta, Microsoft Entra ID, Google Workspace and Ping Identity. SCIM provisioning creates, updates and deactivates users and maps identity provider groups to Kestravane roles.

Kestravane staff reach production systems only through a bastion with hardware-key authentication, and access is reviewed every quarter.

## 5. Audit logs

Administrative actions and data-access events are written to an audit log that customers can read in the admin console.

| Plan | Audit log retention |
|---|---|
| Launch | 30 days |
| Operations | 90 days |
| Enterprise | 13 months |

Enterprise customers can also pull audit events into their own SIEM through the audit log API. Audit entries cannot be edited or deleted by customer administrators or by Kestravane staff.

## 6. Independent assurance

SOC 2: Kestravane holds a SOC 2 Type II report covering the period 1 April 2025 to 31 March 2026, issued on 22 May 2026 by Harrowgate Assurance LLP. The report covers the Security and Availability trust services criteria. Confidentiality, Processing Integrity and Privacy are outside its scope.

ISO 27001: Kestravane is not ISO 27001 certified. The Stage 1 audit was completed in March 2026 and the Stage 2 audit is scheduled for November 2026. Certification is not expected before the first quarter of 2027, and no date is committed.

Penetration assessment: an external assessment of the web application, the API and the TrakNode firmware is carried out once a year. The most recent one was completed in February 2026 by Corvane Labs. A summary letter is available; the full report is not shared.

## 7. Data retention and deletion

| Data | Retention while the contract is active |
|---|---|
| Vehicle location and engine data | 25 months, then deleted; aggregated reports are kept |
| Temperature sensor readings | 36 months |
| Camera footage | 45 days, or 180 days with Extended Video Retention |
| Driver safety events | 25 months |

When a contract ends, the customer can export its data for 30 days after the termination date. All customer data is deleted from production systems within 60 days of the termination date, and from backups within a further 35 days.

## 8. Resilience

Production databases are backed up every day and replicated to the disaster recovery site. The recovery point objective is 24 hours and the recovery time objective is 8 hours. Recovery is rehearsed twice a year.

## 9. Privacy

Kestravane acts as a processor of customer data. A data processing addendum incorporating the EU Standard Contractual Clauses is available on request for any plan. The list of sub-processors is published on the trust page and customers are notified 30 days before a new sub-processor is added. Kestravane does not sell customer data and does not use it to train models offered to other customers.

## 10. Vulnerability management

Critical vulnerabilities are remediated within 7 days and high-severity ones within 30 days. Kestravane runs a private bug bounty programme. Security incidents affecting customer data are notified to the affected customer's security contact within 72 hours of confirmation.

---

This overview is descriptive. It does not amend any contract. Contractual security terms are those in the customer's signed agreement.
