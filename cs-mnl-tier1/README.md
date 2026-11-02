# CS MNL Tier 1 automation

Everything requested in the **CS Roster** sheet
(https://docs.google.com/spreadsheets/d/1E8L74BmWHCaswazNv-yYUT85YB2_4xXZeSlDBc_1ZAE/edit?gid=1423572952).

## Where things live

| Piece | Where |
|---|---|
| Shared board (team opens this, IV login, no Claude) | https://mcp-insights.inspiringvacations.com/reports/production/0be7350e-c68f-4f48-af48-d9f7099cd43c |
| Claude board (live every 3 min, Claude users) | https://claude.ai/artifact/6i2JURcUyKT47ptZvfVQmd |
| Board source | `board/index.html`; `board/build_snapshot.py` bakes data in for IV Insights |
| Playbooks (source of truth) | IV skills broker: `iv-skills-cs-mnl-t1-shift-assignment`, `iv-skills-cs-mnl-t1-daily-signal`, `iv-skills-cs-mnl-t1-reports`, `iv-skills-cs-mnl-t1-board-publish` (IV Insights refresh every 4 hours) |

Edit the playbooks through the broker (`revise_iv_playbook`), not here.

## What updates when

- **Every 3 minutes, live from HubSpot** while the board is open: closed
  today vs target, open tickets per agent, unassigned tickets and task
  queues, open and overdue tasks.
- **30 minutes after each shift starts** (06:30, 10:30, 14:30, 22:30
  Manila): the shift top-up runs and its summary appears on the board.
- **Sick-call check before every top-up**: an agent must be IN on the
  Attendance tab AND have logged a call, email or note (or finished a
  task / closed a ticket) in HubSpot since their shift started. Anyone on
  the sheet but not seen gets nothing, is flagged on the board, and is
  re-checked by a catch-up run 2 hours into the shift (08:00, 12:00,
  16:00, 00:00).
- **10 minutes after each shift ends**: the shift wrap (calls, tickets,
  chats, tasks, per-agent productivity) appears on the board. Weekly and
  monthly views build from these.
- **No Slack.** Nothing posts anywhere else.

## Board data store

| Doc | Written by |
|---|---|
| `config/team` | Seeded from the Goal tab; refreshed by the shift assignment when targets change |
| `config/today` | Shift assignment (who is IN today) |
| `shifts/{date}_{shift}` | Shift assignment summary |
| `daily/{date}_{shift}` | Reports (shift wrap) |

## Safety

- Assignment starts in **PREVIEW**: nothing is assigned in HubSpot until
  Jess switches it to LIVE.
- Only `hubspot_owner_id`, `daily_signal` and `daily_signal_date` are ever
  written in HubSpot. Owned work is never reassigned.

## Open questions

1. **360 task**: done, queue "360 - MNL CS" (6411821).
2. **Call Backs queue** (`6411820`): assign or report only?
3. **Chats**: confirm HubSpot chat conversations are the source.
4. **Store routing**: inferred from deal currency until a store field exists.
