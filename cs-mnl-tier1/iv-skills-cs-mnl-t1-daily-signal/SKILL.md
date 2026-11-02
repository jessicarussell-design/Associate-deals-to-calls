---
name: iv-skills-cs-mnl-t1-daily-signal
description: Stamp every open MNL Tier 1 task (owned by a Tier 1 agent, or unassigned in the MNL CS all tasks, Call Backs and Cruise queues) with a Daily Signal running order (NNN - Urgent / High / Medium / Low / Waiting) in the HubSpot daily_signal property, plus daily_signal_date, so agents sort their task view and work top-down. Wording identical to iv-skills-cs-daily-signal and iv-skills-cs-mnl-t2-daily-assignment. Runs as the last step of iv-skills-cs-mnl-t1-shift-assignment, and on demand ("re-run the T1 daily signal").
category: Customer Success
submitted_by: jessica.russell@inspiringvacations.com
---
# CS MNL Tier 1 Daily Signal

The Tier 1 version of `iv-skills-cs-daily-signal`. Same properties,
same format, same tier words. Only the scope differs.

**Run mode follows `iv-skills-cs-mnl-t1-shift-assignment`.** In
`PREVIEW`, work out the running order and report it, but write nothing.

---

## Properties (already exist, never create new ones)

| Property | What this skill writes |
|---|---|
| `daily_signal` | `NNN - Word`, e.g. `001 - Urgent`, `014 - Low` |
| `daily_signal_date` | Run timestamp, epoch milliseconds UTC |

Writes ONLY these two properties. Never owner, status, queue, subject.

**Tasks only.** `daily_signal` does not exist on tickets. Ticket order
is FIFO, set by the assignment, and the reports list aged tickets.

### Format (exact, shared with the MEL and T2 skills)

- Always three digits, zero padded: `001`, never `1` or `01`.
- No prefixes, dates or emoji.
- If the tier words change in one of the three skills, change all three
  in the same session via the broker.

---

## Scope

Open tasks: `hs_task_status` IN NOT_STARTED, IN_PROGRESS, WAITING,
DEFERRED.

1. **Owned**: open tasks owned by the Tier 1 agents in the team table
   of `iv-skills-cs-mnl-t1-shift-assignment`, whatever queue they sit
   in. When run from a shift assignment, only that shift's agents.
2. **Unassigned** in the Tier 1 queues:
   MNL CS - all tasks `4046613`, MNL CS - Call Backs `6411820`,
   Cruise - CS 2026 `12867798`.

**Out of scope, never touch:** the CS MEL queues and owners (owned by
`iv-skills-cs-daily-signal`), the T2 queues `3384069`, `10404111`,
`12818856`, `8643140`, `6217900` (owned by
`iv-skills-cs-mnl-t2-daily-assignment`). If a Tier 1 agent owns a task
in one of those queues, skip it: the other skill numbers it.

---

## Tier words

Apply in order, first match wins. When unsure between two, take the
more urgent.

| Word | What lands there |
|---|---|
| `Urgent` | On tour; `hs_task_priority` HIGH; "urgent" in the subject; departure or hard deadline within 7 days |
| `High` | Callback requests (anything in `6411820`); complaints, upset customers; open 5+ business days (Manila, weekends excluded, from `hs_createdate`); past its due date (`hs_timestamp`) |
| `Medium` | Payment or booking chases; cruise queue tasks; amendments and date changes |
| `Low` | Routine admin and anything else |
| `Waiting` | Status WAITING or DEFERRED; `Enquiry Pending` subjects (waiting on another department); an unexpired "NFAR until", "hold until", "no action until" marker |

---

## How to rank

1. Re-tier every task from scratch every run. Never reuse yesterday's.
2. Waiting sorts to the bottom.
3. Within a tier: closest departure or due date first, else oldest
   created first.
4. Number from `001`: **per agent** for owned tasks, **per queue** for
   unassigned tasks.
5. Skip a task that already carries today's date and the same value.
6. Batch 10 per `manage_crm_objects` call. A failed write: retry once,
   then carry on and report it.

## Output

No Slack post of its own. Hand back to the shift assignment:
how many stamped, and the `Urgent` ones (booking number plus owner or
queue) so the post can name anything nobody owns.

## Team usage

Sort any HubSpot task view by **Daily Signal** ascending and work from
`001` down. If **Daily Signal Date** is not today, the order is stale.

## Change log

- 2 Nov 2026: created (Jess). Mirrors `iv-skills-cs-daily-signal`.
