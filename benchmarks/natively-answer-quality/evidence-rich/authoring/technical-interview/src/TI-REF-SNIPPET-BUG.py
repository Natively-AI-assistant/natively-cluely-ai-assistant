"""Usage metering and tiered pricing for the gateway's monthly invoices.

All money is in mills (thousandths of one currency unit) so that the
arithmetic stays in integers. A tier is a pair ``(upper, rate)``: ``upper``
is the cumulative number of requests up to which ``rate`` applies, and
``None`` marks the last, open-ended tier.
"""
from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable, Iterator, Optional

Tier = tuple[Optional[int], int]

# The first 1,000 requests cost 50 mills each, the next 9,000 cost 30 each,
# and everything above 10,000 costs 10 each.
DEFAULT_TIERS: list[Tier] = [(1_000, 50), (10_000, 30), (None, 10)]

FREE_ALLOWANCE = 250
MINIMUM_CHARGE_MILLS = 5_000


@dataclass(frozen=True)
class UsageRecord:
    tenant: str
    day: date
    requests: int


def parse_usage(lines: Iterable[str]) -> Iterator[UsageRecord]:
    """Yield one record per ``tenant,timestamp,requests`` row.

    Blank rows and rows starting with ``#`` are skipped.
    """
    for row in csv.reader(lines):
        if not row or row[0].startswith("#"):
            continue
        tenant, stamp, count = row[0].strip(), row[1].strip(), int(row[2])
        if count < 0:
            raise ValueError(f"negative request count for {tenant}: {count}")
        yield UsageRecord(tenant, datetime.fromisoformat(stamp).date(), count)


def monthly_totals(records: Iterable[UsageRecord], year: int, month: int) -> dict[str, int]:
    """Sum requests per tenant for one calendar month."""
    totals: dict[str, int] = defaultdict(int)
    for record in records:
        if record.day.year == year and record.day.month == month:
            totals[record.tenant] += record.requests
    return dict(totals)


def tiered_cost(units: int, tiers: list[Tier] = DEFAULT_TIERS) -> int:
    """Return the cost in mills of ``units`` requests under ``tiers``."""
    cost = 0
    remaining = units
    for upper, rate in tiers:
        if remaining <= 0:
            break
        in_tier = remaining if upper is None else min(remaining, upper)
        cost += in_tier * rate
        remaining -= in_tier
    return cost


def invoice_amount(units: int, tiers: list[Tier] = DEFAULT_TIERS) -> int:
    """Apply the free allowance and the minimum charge to a month's usage."""
    billable = max(0, units - FREE_ALLOWANCE)
    if billable == 0:
        return 0
    return max(MINIMUM_CHARGE_MILLS, tiered_cost(billable, tiers))


def build_invoices(lines: Iterable[str], year: int, month: int) -> list[tuple[str, int, int]]:
    """Return ``(tenant, requests, amount_in_mills)`` rows, largest invoice first."""
    totals = monthly_totals(parse_usage(lines), year, month)
    rows = [(tenant, units, invoice_amount(units)) for tenant, units in totals.items()]
    rows.sort(key=lambda row: (-row[2], row[0]))
    return rows


def format_mills(mills: int) -> str:
    """Render mills as a decimal amount with two places, e.g. 340000 -> '340.00'."""
    whole, fraction = divmod(mills, 1000)
    return f"{whole}.{fraction // 10:02d}"


if __name__ == "__main__":
    import sys

    with open(sys.argv[1], newline="") as handle:
        for tenant, units, amount in build_invoices(handle, int(sys.argv[2]), int(sys.argv[3])):
            print(f"{tenant:<24}{units:>12,}{format_mills(amount):>14}")
