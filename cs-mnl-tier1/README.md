# CS MNL Tier 1 automation

Everything requested in the **CS Roster** sheet
([link](https://docs.google.com/spreadsheets/d/1E8L74BmWHCaswazNv-yYUT85YB2_4xXZeSlDBc_1ZAE/edit?gid=1423572952)),
built as three iv-skills playbooks that run as Cowork scheduled tasks.

## What maps to what

| Sheet request | Playbook |
|---|---|
| Ticket Automation A: assign to daily target, minus pending, store routing, FIFO, skip leave | `iv-skills-cs-mnl-t1-shift-assignment` (Step 1) |
| Task Automation A: assign by roster, fallback, no duplicates, keep history | `iv-skills-cs-mnl-t1-shift-assignment` (Steps 2-3) |
| "Run the skill 30 minutes after each person's start time" | 4 runs: 06:30, 10:30, 14:30, 22:30 Manila |
| Daily Signal (task running order) | `iv-skills-cs-mnl-t1-daily-signal` |
| Ticket Automation B: TL productivity report | `iv-skills-cs-mnl-t1-reports` (productivity view) |
| Task Monitoring Report | `iv-skills-cs-mnl-t1-reports` (task monitoring view) |
| Report Requests tab: calls, tickets, chats, tasks; daily, weekly, monthly | `iv-skills-cs-mnl-t1-reports` |

## Schedule (Manila time, no daylight saving)

| Time | Runs |
|---|---|
| 06:10 | Daily report, night shift |
| 06:30 | Assignment + Daily Signal, morning shift |
| 10:30 | Assignment + Daily Signal, swing shift |
| 14:10 | Daily report, morning shift |
| 14:30 | Assignment + Daily Signal, mid shift |
| 18:10 | Daily report, swing shift |
| 22:10 | Daily report, mid shift |
| 22:30 | Assignment + Daily Signal, night shift |
| Mon 05:00 | Weekly report |
| 1st 05:00 | Monthly report |

## Safety

- The assignment starts in **PREVIEW**: it posts what it would assign,
  writes nothing to HubSpot. Switch to LIVE after three good preview days.
- Only `hubspot_owner_id` (assignment) and `daily_signal` /
  `daily_signal_date` (running order) are ever written.
- Never reassigns an owned ticket or task. Never assigns to anyone not
  `IN` on the Attendance tab.

## Set up

1. Submit each `SKILL.md` to the iv-skills broker (`submit_iv_playbook`).
2. Create the Cowork scheduled tasks using the cron lines in each playbook.
3. Review the first preview posts, then set the assignment to LIVE.

## Open questions

1. **Slack destination**: defaults to AI CS space (`C0C1YK6BVDH`). Is
   there a Tier 1 leads channel instead?
2. **360 task**: which queue or subject is it?
3. **Call Backs queue** (`6411820`): assign it too, or report only?
4. **Chats**: confirm chats are HubSpot chat conversations.
5. **Store routing**: tickets have no store field, so it is inferred from
   the linked deal currency. A real `store` property would be more reliable.
