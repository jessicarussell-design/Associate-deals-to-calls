#!/usr/bin/env python3
"""Bake live data into the Tier 1 board so it can be shared on IV Insights.

The Claude board (board/index.html) fetches HubSpot and its data store
through the viewer's Claude login. People without Claude cannot run that,
so the hourly job gathers the same data, then this script writes it into
the page's <script id="snapshot"> block. The page sees the block and
renders from it instead of calling Claude.

Usage:
    python3 build_snapshot.py <data_dir> <out.html> [--template board/index.html]

<data_dir> holds raw tool results, one or more pages per name:

    HubSpot search_crm_objects results ({"results": [...], "total": N}):
      open_tickets*.json      open pipeline-0 tickets owned by T1 agents
      closed_today*.json      pipeline-0 tickets closed since 00:00 Manila by T1 agents
      unassigned_tickets*.json open pipeline-0 tickets with no owner
      role_tasks*.json        open tasks owned by agents with a task role
      open_tasks*.json        open tasks owned by any T1 agent
      done_tasks*.json        tasks completed in the last 35 days by T1 agents
      q_all.json q_callbacks.json q_cruise.json q_360.json
                              limit-1 searches; only "total" is used
      calls*.json emails*.json notes*.json  (optional) activity since 22:00
                              yesterday Manila, for the "Not seen yet" tags

    Board store (ArtifactData get/list, or out_dir files):
      team.json  today.json   one document each (config/team, config/today)
      shifts/    daily/       one file per document, or shifts.json /
                              daily.json holding a list

Missing inputs are fine: that part of the page shows "loading" or n/a.
"""
import glob
import json
import os
import sys
import time

KEEP = {
    "open_tickets": ["hubspot_owner_id", "hs_ticket_category"],
    "closed_today": ["hubspot_owner_id"],
    "unassigned_tickets": ["createdate", "hs_ticket_priority", "hs_ticket_category"],
    "role_tasks": ["hubspot_owner_id", "hs_timestamp"],
    "open_tasks": ["hubspot_owner_id", "hs_task_subject", "hs_task_status", "hs_createdate",
                   "hubspot_owner_assigneddate", "hs_timestamp", "hs_task_completion_date"],
    "done_tasks": ["hubspot_owner_id", "hs_task_subject", "hs_task_status", "hs_createdate",
                   "hubspot_owner_assigneddate", "hs_timestamp", "hs_task_completion_date"],
    "calls": ["hubspot_owner_id", "hs_createdate"],
    "emails": ["hubspot_owner_id", "hs_createdate"],
    "notes": ["hubspot_owner_id", "hs_createdate"],
}
LIVE_KEY = {"open_tickets": "open", "closed_today": "closed", "unassigned_tickets": "unTickets",
            "role_tasks": "tasks", "open_tasks": "openAll", "done_tasks": "doneAll",
            "calls": "calls", "emails": "emails", "notes": "notes"}
TOTALS = {"q_all": "qAll", "q_callbacks": "qCb", "q_cruise": "qCruise", "q_360": "q360"}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def records(data_dir, name):
    """Merge every page for a name, de-duplicated by id. None if no file."""
    files = sorted(glob.glob(os.path.join(data_dir, name + "*.json")))
    if not files:
        return None
    seen = {}
    for fp in files:
        doc = load(fp)
        for r in (doc.get("results") if isinstance(doc, dict) else doc) or []:
            props = r.get("properties", {})
            seen[str(r.get("id"))] = {"id": str(r.get("id")),
                                     "properties": {k: props.get(k) for k in KEEP[name] if props.get(k) not in (None, "")}}
    return list(seen.values())


def unwrap(doc):
    """ArtifactData returns {"id","data","version"}; out_dir files may be bare."""
    if isinstance(doc, dict) and isinstance(doc.get("data"), dict):
        return doc["data"]
    return doc


def store_list(data_dir, name):
    d = os.path.join(data_dir, name)
    if os.path.isdir(d):
        return [unwrap(load(fp)) for fp in sorted(glob.glob(os.path.join(d, "*.json")))]
    fp = os.path.join(data_dir, name + ".json")
    if os.path.exists(fp):
        doc = load(fp)
        if isinstance(doc, dict) and "documents" in doc:
            doc = doc["documents"]
        return [unwrap(x) for x in (doc if isinstance(doc, list) else [doc])]
    return []


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    data_dir, out = args
    tpl = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
    if "--template" in sys.argv:
        tpl = sys.argv[sys.argv.index("--template") + 1]

    live = {}
    for name, key in LIVE_KEY.items():
        recs = records(data_dir, name)
        if recs is not None:
            live[key] = recs
    for name, key in TOTALS.items():
        fp = os.path.join(data_dir, name + ".json")
        if os.path.exists(fp):
            live[key] = {"total": int(load(fp).get("total", 0))}

    snap = {"generatedAt": int(time.time() * 1000), "live": live}
    for name in ("team", "today"):
        fp = os.path.join(data_dir, name + ".json")
        if os.path.exists(fp):
            doc = unwrap(load(fp))
            snap[name] = doc.get("agents") if name == "team" else doc
    snap["shifts"] = sorted(store_list(data_dir, "shifts"), key=lambda d: d.get("runAt", 0), reverse=True)[:60]
    snap["daily"] = sorted(store_list(data_dir, "daily"), key=lambda d: (d.get("date", ""), d.get("shift", "")))

    html = open(tpl, encoding="utf-8").read()
    marker = '<script id="snapshot" type="application/json"></script>'
    if marker not in html:
        sys.exit("Template has no empty snapshot block; use the unbaked board/index.html")
    payload = json.dumps(snap, separators=(",", ":")).replace("</", "<\\/")
    html = html.replace(marker, '<script id="snapshot" type="application/json">' + payload + "</script>")
    # The Claude viewer wraps the page in a document skeleton; IV Insights
    # serves the file as-is, so add the skeleton here.
    html = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<style>body{margin:0;font-size:14px}img{max-width:100%}[hidden]{display:none!important}</style>'
            '</head><body>' + html + '</body></html>')
    with open(out, "w", encoding="utf-8") as f:
        f.write(html)
    counts = {k: (len(v) if isinstance(v, list) else v.get("total")) for k, v in live.items()}
    print(f"wrote {out} ({len(html)//1024} KB) live={counts} shifts={len(snap['shifts'])} daily={len(snap['daily'])}")


if __name__ == "__main__":
    main()
