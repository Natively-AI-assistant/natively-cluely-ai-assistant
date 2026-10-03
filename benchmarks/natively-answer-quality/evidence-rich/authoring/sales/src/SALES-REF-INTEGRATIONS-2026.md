# Kestravane Fleet - Integration Matrix

Edition 2026-Q3 - Effective 1 July 2026 - Published together with price list version 4.2

Approved by: Teodric Vanterpool, Director of Partner Engineering. Maintained by Partner Engineering; corrections to integrations@kestravane.example.

This matrix lists every integration Kestravane ships and supports, the plans on which each is available, and any fee. An integration that does not appear here is not supported.

## 1. Summary

| System | Type | Data direction | Plans | Fee |
|---|---|---|---|---|
| Salesforce (Sales Cloud and Service Cloud) | Native connector | Two-way | Operations, Enterprise | Included at no additional charge |
| HubSpot | Native connector | One-way, Kestravane to HubSpot | Operations, Enterprise | No connector fee |
| NetSuite | Native connector | Two-way, standard records only | Enterprise only | $400 per month add-on |
| Slack | App | Outbound alerts | Launch, Operations, Enterprise | No fee |
| Microsoft Teams | App, in beta | Outbound alerts | Operations, Enterprise | No fee during beta |
| QuickBooks Online | Export | One-way invoice export | Launch, Operations, Enterprise | No fee |
| WEX fuel cards | Data feed | Inbound transactions | Operations, Enterprise | No fee |
| REST API and webhooks | Developer access | Read and write | Operations, Enterprise | No fee |

None of the native connectors is available on the Launch plan.

## 2. Connector detail

### 2.1 Salesforce

The Salesforce connector is part of the Operations and Enterprise subscriptions and carries no connector fee. It keeps Accounts, Contacts, Cases and Work Orders in step with Kestravane customers, sites and jobs, in both directions, on a 15-minute sync cycle. Custom fields on those standard objects can be mapped, up to 40 mapped fields per object. Salesforce custom objects can be mapped on Enterprise only, with a ceiling of 5 custom objects. The customer needs Salesforce Enterprise Edition or higher, or Professional Edition with API access enabled. One Salesforce org can be connected per Kestravane account.

### 2.2 HubSpot

The HubSpot connector posts vehicle visits, completed jobs and delivery exceptions to the company timeline in HubSpot once an hour. It is one-way: nothing written in HubSpot flows back into Kestravane. HubSpot Professional or higher is required.

### 2.3 NetSuite

The NetSuite connector exchanges five standard record types: Customer, Vendor, Item, Invoice and Purchase Order. It runs as a nightly batch, with an on-demand sync button for administrators. Custom records, custom segments and any other custom objects are not supported by the connector. Customers who depend on custom records build that part themselves against the REST API, usually with their own SuiteScript or through an implementation partner. There is no committed date for custom record support.

### 2.4 Slack and Microsoft Teams

The Slack app sends four kinds of alert to channels the customer chooses: geofence entry and exit, maintenance due, temperature excursion and harsh-driving events. Up to 25 channels can be connected. It does not accept commands typed in Slack. The Microsoft Teams app offers the same alerts but is in beta; beta features fall outside the uptime commitment and may change without notice.

### 2.5 REST API and webhooks

The REST API uses JSON over HTTPS with OAuth 2.0 client credentials. It is included on Operations and Enterprise and is not available on Launch.

| Plan | API rate limit |
|---|---|
| Operations | 600 requests per minute |
| Enterprise | 2,400 requests per minute |

Webhooks are available for trip completed, geofence, alert raised and device offline events. There is no GraphQL endpoint and no bulk export endpoint; bulk extracts are delivered as scheduled CSV files.

## 3. Systems without a connector

No native connector exists for the systems below, and none is planned for 2026. They can be reached through the REST API by the customer's own developers or by an implementation partner.

- SAP S/4HANA
- Microsoft Dynamics 365
- Sage Intacct
- QuickBooks Desktop
- Comdata fuel cards

## 4. General limitations

- Connectors are configured once, during implementation; each connects to a single production instance of the other system.
- Field mappings are changed by an account administrator in the admin console. Kestravane support does not edit mappings on a customer's behalf.
- Sync history is kept for 45 days for troubleshooting.
- Connector behaviour against a customer's sandbox of the other system is supported, but a Kestravane sandbox environment is needed for it.
- Partner-built integrations listed in the partner directory are supported by the partner, not by Kestravane.

---

Kestravane, Inc. This matrix describes shipped functionality on its effective date. It is not a roadmap and it creates no obligation to deliver functionality that is not listed.
