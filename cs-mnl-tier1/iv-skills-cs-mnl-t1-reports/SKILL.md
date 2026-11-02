---
name: iv-skills-cs-mnl-t1-reports
description: MNL Tier 1 reporting. Daily (10 minutes after each shift ends), weekly (Monday 05:00 Manila, last week) and monthly (1st of the month, last month) reports covering calls (T1 and TA inbound, outbound, missed call rate), tickets (opening, aged, closed per agent, turnaround, time to close), chats (closed, first contact resolution, response time, per agent) and tasks (opening and closed T1 and T2, 360, average turnaround, CS Pending Enquiry, remaining). Also builds the Team Lead productivity view (target, pending, assigned, actioned, closed, remaining, achievement %) and task monitoring view, all written to the live Tier 1 Ops Board, which TLs filter by date, shift, store and agent. Trigger on "run the T1 daily report", "T1 weekly report", "T1 monthly report", "Tier 1 productivity".
category: Customer Success
submitted_by: jessica.russell@inspiringvacations.com
---
# CS MNL Tier 1 Reports

Answers the "Report Requests" tab and the two monitoring reports on the
"Automation and Rule" tab of the CS Roster sheet
(`1E8L74BmWHCaswazNv-yYUT85YB2_4xXZeSlDBc_1ZAE`).

All dates and day boundaries are **Asia/Manila** unless a row says
otherwise. Every number on the dashboard says what it measures ("14
tickets closed", never "14").

---

## Schedule

| Report | When (Manila) | Cron | Covers |
|---|---|---|---|
| Daily, morning shift | 14:10 | `CRON_TZ=Asia/Manila 10 14 * * *` | 06:00-14:00 today |
| Daily, swing shift | 18:10 | `CRON_TZ=Asia/Manila 10 18 * * *` | 10:00-18:00 today |
| Daily, mid shift | 22:10 | `CRON_TZ=Asia/Manila 10 22 * * *` | 14:00-22:00 today |
| Daily, night shift | 06:10 | `CRON_TZ=Asia/Manila 10 6 * * *` | 22:00 yesterday-06:00 today |
| Weekly | Monday 05:00 | `CRON_TZ=Asia/Manila 0 5 * * 1` | Mon-Sun last week |
| Monthly | 1st, 05:00 | `CRON_TZ=Asia/Manila 0 5 1 * *` | Last calendar month |

Manila has no daylight saving, so these times hold all year.

A daily run reports only that shift's agents and that shift's window.
Calls always use the shift window, so the TA missed call rate on the
morning report is the 06:00-14:00 window the request asks for.

---

## Data sources

| Area | Source |
|---|---|
| Who is working, targets, store | CS Roster sheet, `Tier 1 \| Attendance` and `Tier 1 Goal`, read as in `iv-skills-cs-mnl-t1-shift-assignment` |
| Agent owner IDs | The team table in `iv-skills-cs-mnl-t1-shift-assignment` (one source, do not copy it here) |
| Assigned per day | `Assignment Log` tab, written by the shift assignment |
| Tickets, tasks | HubSpot (`search_crm_objects`, paginate until count matches `total`) |
| Chats | HubSpot conversations, channel = chat (`search_conversations`), or the iv-dw conversations view if one exists. Confirm on the first run and write the choice into this file. |
| Calls | iv-dw `iv_datawarehouse_mcp.aircall_calls`. **Not** `aircall_call_engagements`, which drops calls without a transcript. |

---

## Calls

| Line | `number_id` |
|---|---|
| T1: `[ IVR 2 ] Existing Bookings` | `407336` |
| T1: `[ IVR 2 ] On Tour` | `418969` |
| TA: `[ IVR 2 ] Travel Agent` | `982499` |

Never scope by `number_name LIKE '%IVR 2%'`; that drags in Sales and
Cruise lines.

| Metric | Definition |
|---|---|
| Total Inbound Calls, T1 / TA | `call_direction = 'INBOUND'` on that line's numbers in the window |
| Total Outbound Calls, T1 / TA | `call_direction = 'OUTBOUND'` from that line's numbers in the window |
| Missed Call Rate | inbound where `call_outcome <> 'answered'` ÷ all inbound. Includes rang out and voicemail. Never use the agent's `call_tag`. |
| MCR TA | Same, but only 06:00-14:00 Manila, on every report that covers that window |

Use the timestamp column converted to Manila (or convert
`started_at_epoch` with `zoneinfo`, never a fixed offset).

---

## Tickets

Scope: pipeline `0`, `hs_ticket_category` not containing
`Automated Response`. Owned by a Tier 1 agent, or unassigned.

| Metric | Definition |
|---|---|
| Opening Number of Tickets | Open at the start of the window (created before it, and no `closed_date` before it) |
| Number of Aged Tickets | Open at the end of the window with no activity (`hs_lastactivitydate`, fallback `createdate`) for 3+ days. Same buckets as CS Queue Board: Today, 1-3, 4-7, 7+ |
| Tickets Closed per Agent | `closed_date` in the window, grouped by `hubspot_owner_id` |
| Average Ticket TAT | Average `time_to_first_agent_reply` on tickets created in the window (first response turnaround) |
| Average Time to Close | Average `time_to_close` on tickets closed in the window. Report in hours under 2 days, days above. |

---

## Chats

| Metric | Definition |
|---|---|
| Total Closed Chats | Chat-channel conversations closed in the window |
| First Contact Resolution | Closed chats needing one agent session and not reopened within 24h ÷ closed chats. For chats linked to a ticket, `hs_is_one_touch_ticket` is the tie-breaker. |
| Chat Response Time | Average time from customer's first message to first agent reply |
| Closed Chats per Agent | Closed chats grouped by the assigned agent |

If chat data can't be reached, show "Chats: not available this run" and
carry on. Never drop the whole report over one source.

---

## Tasks

Open = NOT_STARTED, IN_PROGRESS, WAITING, DEFERRED. Age from
`hs_createdate` (tasks are not aged on activity).

| Metric | Queues / rule |
|---|---|
| Opening task, T1 | Open at window start in `4046613`, `6411820`, `12867798` |
| Closed task, T1 (per agent) | `hs_task_completion_date` in window, those queues, grouped by owner |
| Opening task, T2 | Open at window start in `10404111`, `3384069`, `6217900`, `8643140`, `12818856` |
| Closed task, T2 | Completed in window, T2 queues |
| 360 task | **A specific queue, ID to confirm with Jess.** Until then show "queue to confirm". |
| Average TAT, T1 / T2 | Average (`hs_task_completion_date` - `hs_createdate`) on tasks completed in the window, in business days |
| CS Pending Enquiry Task | Open tasks in `4046613` whose subject starts with `Enquiry Pending` |
| Remaining task | Open T1 tasks at window end |

---

## Team Lead productivity view (Ticket Automation B)

One row per agent per day.

| Column | Definition |
|---|---|
| Daily ticket target | Goal tab, column D |
| Existing pending tickets | Open tickets the agent owned at shift start (Assignment Log `Pending before`; if the agent got nothing, count it from HubSpot) |
| Assigned per day | Assignment Log rows for the agent and date, `mode = LIVE`, object Ticket. Also count self-assigned: tickets whose `hubspot_owner_id` became this agent during the shift (property history) |
| Actioned per day | Owned tickets with an agent email or message sent during the shift (`hs_last_message_sent_at` or `first_agent_reply_date` in the window), or a stage change, closed or not |
| Closed per day | `closed_date` in the shift, owned by the agent |
| Remaining pending | Open tickets owned at shift end |
| Target achievement % | Closed ÷ target. Show "n/a" when the target is X. |

**Keep the three apart:** assigned (given to them), actioned (they
worked it), closed (finished). A ticket can be all three in one day,
and is then counted once in each column.

## Task monitoring view (Task Automation B)

One row per agent per day: tasks assigned, completed, open, overdue
(`hs_timestamp` in the past and still open), oldest open task age,
plus a detail list of each open task with created date, due date,
assigned date and age.

---

## Where it goes: the Tier 1 Ops Board only

**No Slack, no iv-insights, no sheet tabs** (Jess, 2 Nov 2026). Every
daily run writes ONE document to the live board,
https://claude.ai/artifact/6i2JURcUyKT47ptZvfVQmd, with `ArtifactData`. The board updates the moment it lands
and works out weekly and monthly views, filters (date, shift, store,
agent) and "vs previous period" itself.

Doc: `daily/{YYYY-MM-DD}_{morning|swing|mid|night}` (set; pin
`if_version` when re-running a shift, so a re-run replaces rather than
doubles).

    {
      date: "2026-11-02", shift: "Morning", runAt: <epoch ms>,
      metrics: {
        t1In, t1Out, t1Mcr,            // calls; MCR as a percent, 1 dp
        taIn, taOut, taMcr,            // TA; taMcr null outside 06:00-14:00
        ticketsOpening, ticketsAged,   // counts
        ticketTatH, ticketCloseH,      // hours, 1 dp
        chatsClosed, fcr, crtSec,      // fcr percent, crtSec seconds
        t1TasksOpening, t1TasksClosed, t2TasksOpening, t2TasksClosed,
        t1TatD, t2TatD,                // business days, 1 dp
        pendingEnquiry, t360, tasksRemaining
      },
      agents: [{id, name, store, target, pendingStart, assigned,
                actioned, closed, remaining, taskTarget, tasksAssigned,
                tasksDone, tasksOpen, tasksOverdue, oldestTaskDays}]
    }

A metric whose source failed is `null`, never 0; the board shows
"n/a". Only agents who were IN for that shift go in `agents`.

**Weekly (Mon 05:00) and monthly (1st 05:00) runs** do not write a
separate report. They check that every shift in the period has a
`daily` doc, backfill any that are missing, and finish. The board
builds the weekly and monthly views from the daily docs.

The board also reads HubSpot live every 3 minutes for open tickets,
closed today and unassigned queues. That needs no run.

---

## Change log

- 2 Nov 2026: created (Jess), from the "Report Requests" and
  "Automation and Rule" tabs.
- 2 Nov 2026 (Jess): no Slack posts. All reporting lives on the live
  Tier 1 Ops Board (daily docs in its store); weekly and monthly runs
  only backfill.
