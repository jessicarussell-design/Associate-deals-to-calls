# Associate calls to deals

Every morning this links yesterday's connected HubSpot calls to the deal they were about, and to the right contact.

## How a call is matched

1. **Picks up calls**: completed calls from yesterday (Melbourne time) with a duration above 0 that have no deal yet.
2. **Finds the customer**: the contact already on the call. If Aircall logged it against a placeholder "Aircall new contact", it looks the customer up by phone number.
3. **Booking number first**: if the Aircall call summary mentions a booking number that matches exactly one deal name, e.g. `(1529953) 21 Day Follow the Lights to Iceland`, that deal wins.
4. **Otherwise Claude reads the summary** next to the customer's deals and picks one. It links only when Claude is highly confident. Everything else is skipped and listed in the report.
5. **Fixes the contact**: the call is also linked to the deal's contact if it wasn't already. Existing links are never removed. Suspect ones are flagged in the report instead.

## Setup (one time)

1. **HubSpot private app**: Settings → Integrations → Private Apps → Create. Give it these scopes:
   - `crm.objects.contacts.read` and `crm.objects.contacts.write`
   - `crm.objects.deals.read` and `crm.objects.deals.write`
   - `crm.objects.calls.read` and `crm.objects.calls.write` (shown in some portals as Sales → Engagements)
2. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):
   - `HUBSPOT_TOKEN`: the private app token
   - `ANTHROPIC_API_KEY`: a Claude API key
3. **GitHub variables** (same page, Variables tab):
   - `OWN_PHONE_NUMBERS` (optional): your own Aircall lines, comma separated, e.g. `+61283115019,+61272275786`
   - `LIVE_MODE`: leave unset at first. Set it to `true` once you're happy with the dry-run reports.

## Running it

- **Schedule**: daily at 19:00 UTC, which is 6:00am Melbourne in daylight time (5:00am in winter).
- **Dry run by default**: until `LIVE_MODE` is `true`, scheduled runs only preview what they would do.
- **On demand**: Actions tab → "Associate calls to deals" → Run workflow. Untick "Preview only" to make real changes.
- **Report**: each run uploads `report.csv` with every call, what was linked, how, and why anything was skipped.

## Local run

```bash
pip install -r requirements.txt
export HUBSPOT_TOKEN=... ANTHROPIC_API_KEY=...
DRY_RUN=true python associate_calls.py   # writes report.csv
python -m pytest -q
```

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `DRY_RUN` | `true` | `false` writes associations to HubSpot |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used to read call summaries |
| `TIMEZONE` | `Australia/Melbourne` | Defines "yesterday" |
| `OWN_PHONE_NUMBERS` | empty | Numbers never treated as the customer |
| `REPORT_PATH` | `report.csv` | Where the report is written |
