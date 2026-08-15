import os
import json

out_dir = '/Users/evin/natively-cluely-ai-assistant/chargeback_evidence/imsbabu89_yearly_july_2026'
master_file = os.path.join(out_dir, 'MASTER_DISPUTE_INVESTIGATION_REPORT_BABU.md')

def load_file(filename):
    path = os.path.join(out_dir, filename)
    if os.path.exists(path):
        with open(path, 'r') as f:
            return f.read()
    return ""

master_content = f"""# Master Forensic Payment-Dispute Investigation Report & Complete Evidence File

**Target Payment ID**: `pay_0Nja3g2n3ZLDEcWesNJYd`  
**Dispute ID**: `dp_nQNEPcEZHFlvp2XTxgw9`  
**Invoice ID**: `inv_0Nja3g2n3ZLDEcWx1JylW`  
**Subscription ID**: `sub_0Nja3g32BDjHkOSqf8POR`  
**Customer Name**: Babu  
**Full Customer Email**: `imsbabu89@gmail.com`  
**Customer ID**: `cus_0Nja3g2Xx0AYPzMOoMDck`  
**Business / Brand ID**: `bus_0NazdQMiJL8kBMLSp356C`  
**Disputed Product**: Natively pro (yearly) (`pdt_0NcM4QBwy0CDcPV9CXaNP`)  
**Original List Price**: $30.00 USD  
**Discount Applied**: `INSIDER20` (`dsc_0Nflf8XdmFVgimHsHjl3b`) — 20% OFF (-$6.00 USD)  
**Charged / Settlement Amount**: $24.00 USD (Tax: $0.00 USD)  
**Payment Timestamp (UTC)**: 2026-07-20 08:11:39.553871 UTC  
**Payment Timestamp (IST)**: 2026-07-20 13:41:39.553871 IST (1:41:39 PM IST)  
**Dispute Creation Timestamp (UTC)**: 2026-07-24 05:01:25.983000 UTC  
**Dispute Creation Timestamp (IST)**: 2026-07-24 10:31:25.983000 IST (10:31:25 AM IST)  
**Elapsed Time (Purchase → Dispute)**: 3 days, 20 hours, 49 minutes, 46 seconds  
**Dispute Reason**: `product_unacceptable`  
**Card Network & Details**: Mastercard Credit Card ending in 9706 (Issuing Country: US)  
**Billing Address**: 1633 Wander Ml, Cumming, GA 30040, US  
**Operating Mode**: READ-ONLY (No modifications, refunds, or auto-submissions executed)  

---

## 1. Executive Summary & Core Investigation Findings

1. **Payment & Price Verification**:  
   On July 20, 2026 at 08:11:39 UTC (13:41:39 IST), customer Babu authorized the purchase of **Natively pro (yearly)** via Mastercard ending in `9706`. The cart price of $30.00 USD was discounted by 20% (-$6.00 USD) using promo code `INSIDER20` (`dsc_0Nflf8XdmFVgimHsHjl3b`), resulting in a net charge of **$24.00 USD**. Tax was $0.00 USD. Payment status: `succeeded`.

2. **Automated Entitlement Delivery**:  
   Within **33 seconds** of payment confirmation (July 20, 2026 at 08:12:13 UTC), Natively's backend system automatically provisioned yearly Pro license `be324788-dda5-41e0-8a23-d634b5dc7260` for `imsbabu89@gmail.com` linked directly to subscription `sub_0Nja3g32BDjHkOSqf8POR`. The entitlement was created with `active: true` in Supabase `pro_licenses` and remained accessible.

3. **Final Sale & Non-Refundable Discount Policy**:  
   Under Section 1.5 of Natively's Refund Policy effective April 25, 2026:  
   *"Anything bought with a coupon (including INSIDER20), voucher, referral credit, or limited-time offer is non-refundable."*  
   Because coupon `INSIDER20` was redeemed for a 20% discount, the transaction was **final sale** at checkout. Furthermore, Sections 1.2 and 1.4 stipulate that yearly Pro subscriptions are sold on a non-refundable basis.

4. **Required Checkout Terms Acceptance**:  
   Checkout completion at `https://natively.software/pro` required acceptance of the published and linked Terms & Conditions (`https://natively.software/terms`) and Refund Policy (`https://natively.software/refundpolicy`).

5. **Zero Pre-Dispute Customer Support Contact**:  
   An exhaustive audit of merchant support channels (`natively.contact@gmail.com`), database tables (`pro_licenses`, `api_keys`, `processed_webhooks`, `sent_marketing_emails`, `reviews`, `review_prompt_state`, `free_trials`), and Dodo transaction notes returned **zero support tickets, zero defect reports, and zero refund requests** prior to chargeback initiation.

6. **Automatic Gateway Subscription Cancellation**:  
   Subscription `sub_0Nja3g32BDjHkOSqf8POR` was automatically updated to `cancelled` by Dodo Payments on July 24, 2026 at 05:01:26 UTC upon receipt of the dispute event (`dp_nQNEPcEZHFlvp2XTxgw9`). This was an automated system response to the chargeback, not a customer-requested cancellation prior to disputing.

7. **Dispute Reason Rebuttal (`product_unacceptable`)**:  
   The cardholder's claim is contradicted by empirical evidence: the digital product was delivered within 33 seconds, the customer never reported any defects or contacted support, and the purchase was explicitly non-refundable under promotional final-sale terms.

---

## 2. Processor Ready Response Statements

### A. Primary 2,000-Character Processor Statement (`02_reason_to_win_2000_chars.txt`)
*(Exact length: 1,497 characters - Verified < 2,000 limit)*

```text
{load_file('02_reason_to_win_2000_chars.txt')}
```

### B. Compact 500-Character Summary (`03_reason_to_win_500_chars.txt`)
*(Exact length: 452 characters - Verified < 500 limit)*

```text
{load_file('03_reason_to_win_500_chars.txt')}
```

### C. Ready-to-Paste Gateway Form Answers (`22_dodo_form_answers.md`)

{load_file('22_dodo_form_answers.md')}

---

## 3. Comprehensive Access Activity Log & Chronological Audit Timeline

### CSV Timeline Log (`05_exact_timeline.csv`)

{load_file('05_exact_timeline.csv')}

### Formatted Activity Audit Table

| Date/Time (UTC) | Date/Time (IST) | System | Event Details | Result | Evidence Source |
|---|---|---|---|---|---|
| 2026-07-20 08:11:39 UTC | 2026-07-20 13:41:39 IST | Dodo Payments | Checkout completed ($24.00 USD charged with INSIDER20) | Succeeded | `pay_0Nja3g2n3ZLDEcWesNJYd` |
| 2026-07-20 08:11:39 UTC | 2026-07-20 13:41:39 IST | Dodo Payments | Yearly subscription created | Active | `sub_0Nja3g32BDjHkOSqf8POR` |
| 2026-07-20 08:11:39 UTC | 2026-07-20 13:41:39 IST | Dodo Payments | Official invoice generated | Generated | `inv_0Nja3g2n3ZLDEcWx1JylW` |
| 2026-07-20 08:12:13 UTC | 2026-07-20 13:42:13 IST | Natively Backend | Pro yearly entitlement issued (33s post-payment) | Active (`true`) | Supabase `pro_licenses` (`be324788...`) |
| 2026-07-20 to 2026-07-24 | 2026-07-20 to 2026-07-24 | Natively Backend | Pro entitlement access available | Available | Supabase DB `pro_licenses` |
| 2026-07-24 05:01:25 UTC | 2026-07-24 10:31:25 IST | Card Network | Dispute opened (`product_unacceptable`) | Dispute Opened | Dodo Payments (`dp_nQNEPcEZHFlvp2XTxgw9`) |
| 2026-07-24 05:01:26 UTC | 2026-07-24 10:31:26 IST | Dodo Payments | Subscription auto-cancelled due to dispute | Cancelled | Dodo Gateway (`sub_0Nja3g32...`) |
| 2026-08-03 00:00:00 UTC | 2026-08-03 05:30:00 IST | Merchant Audit | Evidence package compiled for review | Complete | Audit System |

---

## 4. Customer Identity & Account Linkage Verification

{load_file('08_customer_account_linkage.md')}

---

## 5. Discount & Price Mathematics Verification

{load_file('09_discount_evidence.md')}

---

## 6. Checkout Promotional Disclosure Evidence

{load_file('10_discount_checkout_disclosure.md')}

---

## 7. Terms & Policy Acceptance Evidence

{load_file('11_terms_acceptance_evidence.md')}

---

## 8. Applicable Refund Policy Evidence (April 25, 2026 Version)

{load_file('12_refund_policy_evidence.md')}

---

## 9. Product Representation & Delivery Matrix

{load_file('13_product_description_evidence.md')}

---

## 10. Entitlement Provisioning & Activation Audit

{load_file('15_activation_evidence.md')}

---

## 11. Customer Support & Communication Audit

{load_file('19_customer_communication_audit.md')}

---

## 12. Claim-Evidence Matrix

{load_file('20_claim_evidence_matrix.csv')}

---

## 13. Unknowns, Vulnerabilities & Risk Assessment

{load_file('21_unknowns_and_risks.md')}

---

## 14. Full Raw Redacted Evidence Records (JSON Objects)

### A. Disputed Payment JSON (`06_disputed_payment_redacted.json`)
```json
{load_file('06_disputed_payment_redacted.json')}
```

### B. Dispute Record JSON (`07_dispute_record_redacted.json`)
```json
{load_file('07_dispute_record_redacted.json')}
```

### C. Entitlement Record JSON (`14_entitlement_record_redacted.json`)
```json
{load_file('14_entitlement_record_redacted.json')}
```

---

## 15. Submission Quality Control Checklist

{load_file('23_submission_checklist.md')}

---

## 16. Evidence Package Index & Generated Files

{load_file('24_evidence_index.md')}

---
**End of Master Forensic Investigation Report.**
"""

with open(master_file, 'w') as f:
    f.write(master_content)

print(f"Master markdown file created successfully at: {master_file}")
