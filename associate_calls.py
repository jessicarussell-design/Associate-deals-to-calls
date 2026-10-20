"""Associate yesterday's connected HubSpot calls to the right deal and contact.

How a call is matched:
  1. Read the Aircall call summary that is stored on the call (hs_call_body).
  2. Work out the customer: the contact already on the call, or, when Aircall
     logged it against a placeholder "Aircall new contact", the contact whose
     phone number matches the caller.
  3. If the summary mentions a booking number, e.g. "(1529953) 21 Day Follow the
     Lights to Iceland", that deal wins, but only when it belongs to the caller.
     A booking on someone else's deal is skipped and reported for a person.
  4. Otherwise Claude reads the summary alongside the customer's deals (stage and
     departure date included) and picks one, only when it is confident. When the
     customer has more than one open deal and no booking number settles it, the
     call is skipped instead. Anything uncertain is skipped and reported.
  5. The call is linked to the deal, and to the deal's contact when the call was
     not already linked to them.

Runs in dry-run mode unless DRY_RUN=false. Writes a CSV report of every decision.
"""

from __future__ import annotations

import csv
import html
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import anthropic
import requests

HUBSPOT_BASE = "https://api.hubapi.com"
TIMEZONE = ZoneInfo(os.environ.get("TIMEZONE", "Australia/Melbourne"))
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
# Skip, rather than ask Claude, when the customer has several open deals.
STRICT_OPEN_DEALS = os.environ.get("STRICT_OPEN_DEALS", "true").lower() != "false"
# Inspiring Vacations' own lines; never treated as the customer's number.
OWN_NUMBERS = {
    n.strip()
    for n in os.environ.get("OWN_PHONE_NUMBERS", "").split(",")
    if n.strip()
}
PLACEHOLDER_CONTACT = re.compile(r"aircall new contact", re.I)
# Booking numbers are 6-8 digits; deal names carry them as "(1529953) ...".
BOOKING_NUMBER = re.compile(r"(?<![\d+])(\d{6,8})(?!\d)")
DEAL_NAME_BOOKING = re.compile(r"^\((\d{6,8})\)")

CALL_PROPS = [
    "hs_timestamp",
    "hs_call_title",
    "hs_call_body",
    "hs_call_direction",
    "hs_call_from_number",
    "hs_call_to_number",
    "hubspot_owner_id",
]
DEAL_PROPS = [
    "dealname",
    "dealstage",
    "pipeline",
    "hs_is_closed",
    "hubspot_owner_id",
    "createdate",
    "hs_lastmodifieddate",
    "departure_date",
    "preferred_departure_date",
    "cruise_date",
]
CONTACT_PROPS = ["firstname", "lastname", "email", "phone", "mobilephone"]


# --------------------------------------------------------------------------- #
# Pure helpers (unit tested)
# --------------------------------------------------------------------------- #


def summary_text(call_body: str | None) -> str:
    """Turn the Aircall HTML call body into plain text."""
    if not call_body:
        return ""
    text = re.sub(r"<br\s*/?>|</div>", "\n", call_body, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    return re.sub(r"\n\s*\n+", "\n", text).strip()


def booking_numbers(text: str) -> set[str]:
    """Booking numbers mentioned in a call summary.

    Skips the Aircall "Call ID" line, which is also a long number.
    """
    cleaned = re.sub(r"Call ID:\s*\d+", "", text, flags=re.I)
    return set(BOOKING_NUMBER.findall(cleaned))


def deal_booking_number(dealname: str | None) -> str | None:
    match = DEAL_NAME_BOOKING.match(dealname or "")
    return match.group(1) if match else None


def digits(phone: str | None) -> str:
    return re.sub(r"\D", "", phone or "")


def customer_number(call: dict) -> str | None:
    """The customer's side of the call: caller for inbound, callee for outbound."""
    props = call["properties"]
    inbound = (props.get("hs_call_direction") or "").upper() == "INBOUND"
    number = props.get("hs_call_from_number") if inbound else props.get("hs_call_to_number")
    if not number or number in OWN_NUMBERS:
        return None
    return number


def phones_match(a: str | None, b: str | None) -> bool:
    """Compare on the last 9 digits so +61 412... and 0412... match."""
    da, db = digits(a), digits(b)
    return len(da) >= 8 and len(db) >= 8 and da[-9:] == db[-9:]


def match_booking(booked: dict[str, dict], customer_deals: dict[str, dict], caller_known: bool) -> tuple[str, dict | None, str]:
    """Decide what the booking numbers in a summary tell us.

    Returns (action, deal, note) where action is "link", "skip" or "ask_claude".
    A booking number only counts when its deal belongs to the caller, so a typo
    or another customer's booking never links the call to the wrong deal.
    """
    if not booked:
        return "ask_claude", None, ""
    names = ", ".join(sorted(d["properties"].get("dealname") or d["id"] for d in booked.values()))
    if not caller_known:
        if len(booked) == 1:
            return "link", next(iter(booked.values())), "booking number in summary (caller not identified)"
        return "skip", None, f"summary mentions several bookings ({names}) and the caller was not identified"
    own = {i: d for i, d in booked.items() if i in customer_deals}
    if len(own) == 1:
        return "link", next(iter(own.values())), "booking number in summary, on the caller's deal"
    if not own:
        return "skip", None, f"booking in summary ({names}) is not on the caller's deals; check by hand"
    return "ask_claude", None, ""


def open_deal_count(deals: list[dict]) -> int:
    return sum(d["properties"].get("hs_is_closed") != "true" for d in deals)


def deal_line(deal: dict, stage_labels: dict[str, str]) -> str:
    """One line describing a deal for Claude."""
    props = deal["properties"]
    stage = stage_labels.get(props.get("dealstage") or "", props.get("dealstage") or "unknown")
    departure = (
        props.get("departure_date")
        or props.get("cruise_date")
        or props.get("preferred_departure_date")
        or ""
    )[:10]
    return (
        f"- id {deal['id']}: {props.get('dealname')} | "
        f"{'closed' if props.get('hs_is_closed') == 'true' else 'open'} | "
        f"stage {stage} | "
        f"departs {departure or 'unknown'} | "
        f"created {(props.get('createdate') or '')[:10]}"
    )


def yesterday_window(now: datetime | None = None) -> tuple[datetime, datetime]:
    now = now or datetime.now(TIMEZONE)
    start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


# --------------------------------------------------------------------------- #
# HubSpot client
# --------------------------------------------------------------------------- #


class HubSpot:
    def __init__(self, token: str):
        self.session = requests.Session()
        self.session.headers.update(
            {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        )

    def _request(self, method: str, path: str, **kwargs) -> dict:
        for attempt in range(6):
            resp = self.session.request(method, HUBSPOT_BASE + path, timeout=60, **kwargs)
            if resp.status_code == 429 or resp.status_code >= 500:
                time.sleep(float(resp.headers.get("Retry-After", 2 ** attempt)))
                continue
            resp.raise_for_status()
            return resp.json() if resp.content else {}
        resp.raise_for_status()
        return {}

    def search(self, object_type: str, body: dict) -> list[dict]:
        results, after = [], None
        while True:
            page = dict(body, limit=200)
            if after:
                page["after"] = after
            data = self._request("POST", f"/crm/v3/objects/{object_type}/search", json=page)
            results.extend(data.get("results", []))
            after = data.get("paging", {}).get("next", {}).get("after")
            if not after:
                return results
            time.sleep(0.25)  # search API allows ~5 requests a second

    def batch_read(self, object_type: str, ids: list[str], props: list[str]) -> dict[str, dict]:
        out: dict[str, dict] = {}
        for chunk in _chunks(sorted(set(ids)), 100):
            data = self._request(
                "POST",
                f"/crm/v3/objects/{object_type}/batch/read",
                json={"properties": props, "inputs": [{"id": i} for i in chunk]},
            )
            for rec in data.get("results", []):
                out[rec["id"]] = rec
        return out

    def associations(self, from_type: str, to_type: str, ids: list[str]) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {i: [] for i in ids}
        for chunk in _chunks(sorted(set(ids)), 1000):
            data = self._request(
                "POST",
                f"/crm/v4/associations/{from_type}/{to_type}/batch/read",
                json={"inputs": [{"id": i} for i in chunk]},
            )
            for row in data.get("results", []):
                out[str(row["from"]["id"])] = [str(t["toObjectId"]) for t in row.get("to", [])]
        return out

    def associate(self, from_type: str, to_type: str, pairs: list[tuple[str, str]]) -> None:
        for chunk in _chunks(pairs, 100):
            self._request(
                "POST",
                f"/crm/v4/associations/{from_type}/{to_type}/batch/associate/default",
                json={"inputs": [{"from": {"id": a}, "to": {"id": b}} for a, b in chunk]},
            )

    def deal_stage_labels(self) -> dict[str, str]:
        """Stage id to "Pipeline: Stage" label, so Claude sees readable stages."""
        data = self._request("GET", "/crm/v3/pipelines/deals")
        return {
            stage["id"]: f"{pipeline['label']}: {stage['label']}"
            for pipeline in data.get("results", [])
            for stage in pipeline.get("stages", [])
        }

    def contacts_by_phone(self, number: str) -> list[dict]:
        last9 = digits(number)[-9:]
        if len(last9) < 8:
            return []
        groups = [
            {"filters": [{"propertyName": p, "operator": "CONTAINS_TOKEN", "value": f"*{last9}"}]}
            for p in ("hs_searchable_calculated_phone_number", "hs_searchable_calculated_mobile_number")
        ]
        found = self.search("contacts", {"filterGroups": groups, "properties": CONTACT_PROPS})
        return [
            c for c in found
            if phones_match(c["properties"].get("phone"), number)
            or phones_match(c["properties"].get("mobilephone"), number)
        ]

    def deals_by_booking_number(self, number: str) -> list[dict]:
        found = self.search(
            "deals",
            {
                "filterGroups": [
                    {"filters": [{"propertyName": "dealname", "operator": "CONTAINS_TOKEN", "value": number}]}
                ],
                "properties": DEAL_PROPS,
            },
        )
        return [d for d in found if deal_booking_number(d["properties"].get("dealname")) == number]


def _chunks(items: list, size: int):
    for i in range(0, len(items), size):
        yield items[i : i + size]


# --------------------------------------------------------------------------- #
# Claude: pick the deal from the summary
# --------------------------------------------------------------------------- #

PICK_SCHEMA = {
    "type": "object",
    "properties": {
        "deal_id": {"type": ["string", "null"]},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
        "reason": {"type": "string"},
    },
    "required": ["deal_id", "confidence", "reason"],
    "additionalProperties": False,
}

PICK_PROMPT = """You match a travel company's phone call to the CRM deal it was about.

Each deal is one tour or cruise booking or enquiry. Deal names usually start with
the booking number in brackets, then the trip name and season.

Pick the deal the call was about, using the trip, destination, departure date,
deal stage, booking number, or anything else in the call summary. Answer with confidence "high" only
when the summary clearly points to one deal. If the call could fit several deals,
or none, return deal_id null. Never guess.

Call ({when}, {direction}):
{summary}

Customer's deals:
{deals}"""


def pick_deal_with_claude(
    client: anthropic.Anthropic, call: dict, summary: str, deals: list[dict], stage_labels: dict[str, str]
) -> dict:
    props = call["properties"]
    deal_lines = "\n".join(deal_line(d, stage_labels) for d in deals)
    prompt = PICK_PROMPT.format(
        when=props.get("hs_timestamp", ""),
        direction=(props.get("hs_call_direction") or "").lower(),
        summary=summary,
        deals=deal_lines,
    )
    response = client.beta.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=4000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={
            "effort": "low",
            "format": {"type": "json_schema", "schema": PICK_SCHEMA},
        },
        messages=[{"role": "user", "content": prompt}],
    )
    if response.stop_reason != "end_turn":
        return {"deal_id": None, "confidence": "low", "reason": f"Claude stopped: {response.stop_reason}"}
    text = next(b.text for b in response.content if b.type == "text")
    result = json.loads(text)
    if result["deal_id"] not in {d["id"] for d in deals}:
        result["deal_id"] = None
    return result


# --------------------------------------------------------------------------- #
# Main run
# --------------------------------------------------------------------------- #


@dataclass
class Decision:
    call_id: str
    call_title: str
    call_time: str
    outcome: str  # linked | skipped
    method: str = ""
    deal_id: str = ""
    deal_name: str = ""
    contacts_added: list[str] = field(default_factory=list)
    note: str = ""


def run() -> list[Decision]:
    dry_run = os.environ.get("DRY_RUN", "true").lower() != "false"
    hubspot = HubSpot(os.environ["HUBSPOT_TOKEN"])
    claude = anthropic.Anthropic()
    stage_labels = hubspot.deal_stage_labels()

    start, end = yesterday_window()
    print(f"Window: {start.isoformat()} to {end.isoformat()} | dry run: {dry_run}")

    calls = hubspot.search(
        "calls",
        {
            "filterGroups": [
                {
                    "filters": [
                        {"propertyName": "hs_timestamp", "operator": "GTE", "value": str(int(start.timestamp() * 1000))},
                        {"propertyName": "hs_timestamp", "operator": "LT", "value": str(int(end.timestamp() * 1000))},
                        {"propertyName": "hs_call_status", "operator": "EQ", "value": "COMPLETED"},
                        {"propertyName": "hs_call_duration", "operator": "GT", "value": "0"},
                    ]
                }
            ],
            "properties": CALL_PROPS,
        },
    )
    call_ids = [c["id"] for c in calls]
    call_deals = hubspot.associations("calls", "deals", call_ids)
    calls = [c for c in calls if not call_deals.get(c["id"])]
    print(f"Connected calls with no deal yet: {len(calls)}")

    call_contacts = hubspot.associations("calls", "contacts", [c["id"] for c in calls])
    contacts = hubspot.batch_read(
        "contacts", [i for ids in call_contacts.values() for i in ids], CONTACT_PROPS
    )

    decisions: list[Decision] = []
    deal_links: list[tuple[str, str]] = []
    contact_links: list[tuple[str, str]] = []

    for call in calls:
        props = call["properties"]
        decision = Decision(call["id"], props.get("hs_call_title") or "", props.get("hs_timestamp") or "", "skipped")
        decisions.append(decision)
        summary = summary_text(props.get("hs_call_body"))

        # Who was the customer on this call?
        linked_contacts = [contacts[i] for i in call_contacts.get(call["id"], []) if i in contacts]
        real_contacts = [
            c for c in linked_contacts
            if not PLACEHOLDER_CONTACT.search(f"{c['properties'].get('firstname')} {c['properties'].get('lastname')}")
        ]
        number = customer_number(call)
        if not real_contacts and number:
            real_contacts = hubspot.contacts_by_phone(number)
            if len(real_contacts) > 1:
                decision.note = f"{len(real_contacts)} contacts share phone {number}"
        customer_ids = {c["id"] for c in real_contacts}

        # Candidate deals: the customer's deals plus any deal named in the summary.
        candidate_deals: dict[str, dict] = {}
        if customer_ids:
            contact_deals = hubspot.associations("contacts", "deals", sorted(customer_ids))
            deal_ids = [d for ids in contact_deals.values() for d in ids]
            candidate_deals.update(hubspot.batch_read("deals", deal_ids, DEAL_PROPS))

        booked = {
            d["id"]: d
            for n in booking_numbers(summary)
            for d in hubspot.deals_by_booking_number(n)
        }
        action, chosen, booking_note = match_booking(booked, candidate_deals, bool(customer_ids))

        if action == "link":
            decision.method = booking_note
        elif action == "skip":
            decision.note = booking_note
            continue
        elif not summary:
            decision.note = decision.note or "no call summary to read"
            continue
        elif not candidate_deals:
            decision.note = decision.note or ("customer has no deals" if customer_ids else "caller not identified")
            continue
        elif STRICT_OPEN_DEALS and open_deal_count(list(candidate_deals.values())) > 1:
            decision.note = (
                f"customer has {open_deal_count(list(candidate_deals.values()))} open deals "
                "and no booking number settles it; check by hand"
            )
            continue
        else:
            # Claude only ever chooses among the caller's own deals.
            options = dict(candidate_deals)
            if len(options) > 40:
                options = dict(
                    sorted(
                        options.items(),
                        key=lambda kv: kv[1]["properties"].get("hs_lastmodifieddate") or "",
                        reverse=True,
                    )[:40]
                )
            pick = pick_deal_with_claude(claude, call, summary, list(options.values()), stage_labels)
            if pick["deal_id"] and pick["confidence"] == "high":
                chosen, decision.method = options[pick["deal_id"]], "Claude read the summary"
            else:
                decision.note = f"not confident ({pick['confidence']}): {pick['reason']}"
                continue

        decision.outcome = "linked"
        decision.deal_id = chosen["id"]
        decision.deal_name = chosen["properties"].get("dealname") or ""
        deal_links.append((call["id"], chosen["id"]))

        # Make sure the call sits on the deal's contact, not just a placeholder.
        deal_contact_ids = set(hubspot.associations("deals", "contacts", [chosen["id"]]).get(chosen["id"], []))
        already = set(call_contacts.get(call["id"], []))
        if customer_ids & deal_contact_ids:
            to_add = (customer_ids & deal_contact_ids) - already
        else:
            to_add = deal_contact_ids - already
            if customer_ids:
                decision.note = "call's contact is not on this deal; added the deal's contact, check the old link"
        for contact_id in sorted(to_add):
            contact_links.append((call["id"], contact_id))
            decision.contacts_added.append(contact_id)

    if not dry_run:
        hubspot.associate("calls", "deals", deal_links)
        hubspot.associate("calls", "contacts", contact_links)

    linked = sum(d.outcome == "linked" for d in decisions)
    print(
        f"{'Would link' if dry_run else 'Linked'} {linked} calls to deals, "
        f"{len(contact_links)} call-contact links; skipped {len(decisions) - linked}"
    )
    return decisions


def write_report(decisions: list[Decision], path: str) -> None:
    with open(path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["call_id", "call_title", "call_time", "outcome", "method", "deal_id", "deal_name", "contacts_added", "note"])
        for d in decisions:
            writer.writerow([d.call_id, d.call_title, d.call_time, d.outcome, d.method, d.deal_id, d.deal_name, " ".join(d.contacts_added), d.note])


if __name__ == "__main__":
    results = run()
    write_report(results, os.environ.get("REPORT_PATH", "report.csv"))
    sys.exit(0)
