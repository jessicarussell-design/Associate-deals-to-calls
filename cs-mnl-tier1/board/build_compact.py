#!/usr/bin/env python3
"""Bake compact HubSpot inputs into the Tier 1 board for IV Insights.
Usage: python3 build_compact.py <data_dir> <out.html> --template <page.html>
<data_dir>: inputs.json (format in from_compact), team.json, today.json,
and optional daily/ and shifts/ folders of board-store documents.
"""
import glob
import json
import os
import re
import sys
import time

ROLE = {"79945403", "217656597", "1041973559", "217656601", "761394559", "82811021", "76981964"}


def from_compact(c):
    """Compact inputs the hourly routine can write without copying every record.

    {
      "open_by_owner":   {"<owner id>": count, ...},       open pipeline-0 tickets
      "closed_by_owner": {"<owner id>": count, ...},       closed since 00:00 Manila
      "unassigned":      ["created|priority|category", ...],
      "open_tasks":      ["owner|status|created|assigned|due|subject", ...],
      "done_today":      ["owner|created|assigned|due|completed|subject", ...],
      "done_counts":     [["owner", "YYYY-MM-DD", count], ...],   last 8 days, non-zero only
      "queues":          {"all": n, "callbacks": n, "cruise": n, "q360": n}
    }
    Dates are ISO strings (UTC). Totals become count-only rows the page
    counts but never lists.
    """
    out = {}
    def expand(d, key, extra=None):
        rows = []
        for owner, n in (d or {}).items():
            for i in range(int(n)):
                p = {"hubspot_owner_id": str(owner)}
                if extra: p.update(extra)
                rows.append({"id": f"{key}-{owner}-{i}", "properties": p, "countOnly": True})
        return rows
    if "open_by_owner" in c: out["open"] = expand(c["open_by_owner"], "o")
    if "closed_by_owner" in c: out["closed"] = expand(c["closed_by_owner"], "c")
    if "unassigned" in c:
        rows = []
        for i, line in enumerate(c["unassigned"]):
            cr, pr, cat = (line.split("|") + ["", "", ""])[:3]
            rows.append({"id": f"u{i}", "properties": {k: v for k, v in (("createdate", cr), ("hs_ticket_priority", pr), ("hs_ticket_category", cat)) if v}})
        out["unTickets"] = rows
    if "open_tasks" in c:
        rows = []
        for i, line in enumerate(c["open_tasks"]):
            o, st, cr, asg, due, sub = (line.split("|", 5) + [""] * 6)[:6]
            rows.append({"id": f"t{i}", "properties": {k: v for k, v in (("hubspot_owner_id", o), ("hs_task_status", st), ("hs_createdate", cr), ("hubspot_owner_assigneddate", asg), ("hs_timestamp", due), ("hs_task_subject", sub)) if v}})
        out["openAll"] = rows
        out["tasks"] = [r for r in rows if r["properties"].get("hubspot_owner_id") in ROLE]
    done = []
    for i, line in enumerate(c.get("done_today", [])):
        o, cr, asg, due, comp, sub = (line.split("|", 5) + [""] * 6)[:6]
        done.append({"id": f"d{i}", "properties": {k: v for k, v in (("hubspot_owner_id", o), ("hs_task_status", "COMPLETED"), ("hs_createdate", cr), ("hubspot_owner_assigneddate", asg), ("hs_timestamp", due), ("hs_task_completion_date", comp), ("hs_task_subject", sub)) if v}})
    def manila_day(iso):
        # done_counts are grouped by Manila day (UTC+8); match done_today on the same basis
        try:
            from datetime import datetime, timedelta
            return (datetime.fromisoformat(iso.replace("Z", "+00:00")) + timedelta(hours=8)).strftime("%Y-%m-%d")
        except Exception:
            return iso[:10]
    today_ids = {}
    for r in done:
        k = (r["properties"].get("hubspot_owner_id"), manila_day(r["properties"].get("hs_task_completion_date", "")))
        today_ids[k] = today_ids.get(k, 0) + 1
    for owner, day, n in c.get("done_counts", []):
        n = int(n) - today_ids.get((str(owner), day), 0)   # don't double count rows listed in done_today
        for i in range(max(0, n)):
            done.append({"id": f"dc-{owner}-{day}-{i}", "countOnly": True,
                         "properties": {"hubspot_owner_id": str(owner), "hs_task_status": "COMPLETED", "hs_task_completion_date": day + "T04:00:00Z"}})
    if "done_today" in c or "done_counts" in c:
        out["doneAll"] = done
    q = c.get("queues", {})
    for src, key in (("all", "qAll"), ("callbacks", "qCb"), ("cruise", "qCruise"), ("q360", "q360")):
        if src in q: out[key] = {"total": int(q[src])}
    return out



def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def unwrap(doc):
    if isinstance(doc, dict) and isinstance(doc.get("data"), dict):
        return doc["data"]
    return doc


def folder(data_dir, name):
    return [unwrap(load(fp)) for fp in sorted(glob.glob(os.path.join(data_dir, name, "*.json")))]


def main():
    argv = sys.argv[1:]
    tpl = "template.html"
    if "--template" in argv:
        i = argv.index("--template"); tpl = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
    if len(argv) != 2:
        sys.exit(__doc__)
    data_dir, out = argv
    live = from_compact(load(os.path.join(data_dir, "inputs.json")))
    snap = {"generatedAt": int(time.time() * 1000), "live": live}
    for name in ("team", "today"):
        fp = os.path.join(data_dir, name + ".json")
        if os.path.exists(fp):
            doc = unwrap(load(fp))
            snap[name] = doc.get("agents") if name == "team" else doc
    snap["shifts"] = sorted(folder(data_dir, "shifts"), key=lambda d: d.get("runAt", 0), reverse=True)[:60]
    snap["daily"] = sorted(folder(data_dir, "daily"), key=lambda d: (d.get("date", ""), d.get("shift", "")))
    html = open(tpl, encoding="utf-8").read()
    block = re.compile(r'<script id="snapshot" type="application/json">.*?</script>', re.S)
    if not block.search(html):
        sys.exit("Template has no snapshot block; use the board page or the shared page")
    payload = json.dumps(snap, separators=(",", ":")).replace("</", "<\\/")
    html = block.sub(lambda m: '<script id="snapshot" type="application/json">' + payload + "</script>", html, count=1)
    if not html.lstrip().lower().startswith("<!doctype"):
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
