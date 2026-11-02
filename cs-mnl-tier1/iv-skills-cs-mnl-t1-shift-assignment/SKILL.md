---
name: iv-skills-cs-mnl-t1-shift-assignment
description: Unattended run 30 minutes after each MNL Tier 1 shift starts (06:30, 10:30, 14:30, 22:30 Manila). Reads the live Tier 1 Attendance and Tier 1 Goal tabs of the CS Roster sheet, tops each working agent up to their daily ticket target (target minus tickets they already hold, oldest unassigned first, routed by store NZ/AU or US/CA), assigns tasks to the agents designated for them that day (with a fallback when they are out), logs every assignment to the Assignment Log tab, then runs iv-skills-cs-mnl-t1-daily-signal. Posts one short summary to the Tier 1 leads. Trigger on "run the T1 shift assignment", "assign Tier 1 tickets", "top up the T1 ticket targets".
category: Customer Success
submitted_by: jessica.russell@inspiringvacations.com
---
# CS MNL Tier 1 Shift Assignment

Gives each Tier 1 agent exactly enough work to hit their daily target,
no more, at the start of their shift. Covers both requests on the
"Automation and Rule" tab of the CS Roster sheet:

- **Ticket Automation A**: assignment based on daily target.
- **Task Automation A**: assignment based on the daily roster.

It is the Tier 1 sibling of `iv-skills-cs-mnl-t2-daily-assignment` and
shares its philosophy: fully unattended, the roster is the only source
of who is working, and ambiguity resolves to the least destructive
option (leave it unassigned rather than guess).

---

## RUN MODE: PREVIEW (read this first)

| Mode | What happens |
|---|---|
| `PREVIEW` | Do everything EXCEPT the HubSpot owner writes and the Daily Signal writes. Post the summary headed "Preview, nothing assigned yet" and list what WOULD have gone to each agent. Still append to the Assignment Log, with `mode = PREVIEW`. |
| `LIVE` | Full run. |

**Current mode: `PREVIEW`.** Only Jess switches this to `LIVE`, in her
own words, after reviewing at least three preview days. Do not switch
it because a preview "looked fine".

---

## Sources (read fresh every run)

**CS Roster sheet**: file ID `1E8L74BmWHCaswazNv-yYUT85YB2_4xXZeSlDBc_1ZAE`.
Timezone Asia/Manila.

| Tab | Used for |
|---|---|
| `Tier 1 \| Attendance` | Who is working today. Names in column B, shift in column C, dates in row 4 (`DD MMM YY`, e.g. `02 Nov 26`) from column D onwards. |
| `Tier 1 Goal` | Daily targets. Columns: B name, C shift, D Ticket target, E Chats, F Calls, G Task, H Store. |
| `Tier 1 Roster` | Not read by this skill. It is the weekly pattern; Attendance is the dated truth. |

**Find agents by NAME, never by row. Find today by DATE in row 4, never
by column letter.** Same rule and same reasons as the T2 skill: the
sheet is extended and restructured over time.

### Reading an Attendance cell

| Cell | Meaning |
|---|---|
| `IN` | Working. |
| `OFF`, `Leave`, blank, anything else | Not working. |

`IN` is the only value that means working. A typo resolves to "do not
give this person work", never the reverse.

If today's date is not in row 4, assign nothing, and say in the post:
"The attendance sheet doesn't cover today yet, so nothing was assigned.
Can someone extend it?"

### Reading the Goal tab

- **Ticket** (column D): a number is the daily ticket target. `X` or
  blank means this agent does not take tickets.
- **Task** (column G):
  - a number: daily task target from the general task queue,
  - `Cruise`: owns the Cruise task queue for the day,
  - `X` or blank: no tasks.
- **Store** (column H): `NZ/ AU` or `US | CA`. Normalise by stripping
  spaces and treating `|` as `/`: `NZ/AU` or `US/CA`.
- Chats and Calls are `X` for everyone today. They are reported by
  `iv-skills-cs-mnl-t1-reports` but never assigned.

---

## The team (HubSpot owner IDs, confirmed 2 Nov 2026)

Sheet names are "Surname, First". Match on surname plus first name.
Note Kate Marana is "Mary Kathleen Maraña" in HubSpot, and the two
Magdaraogs are different people.

| Sheet name | HubSpot owner | Owner ID | Shift (Manila) |
|---|---|---|---|
| Ligad, Ella Jielo Mae | Ella Jielo Mae Ligad | 79945403 | 06:00-14:00 |
| Galleto, Jastine | Jastine Galleto | 217656597 | 06:00-14:00 |
| Magdaraog, Kesha | Kesha Rea Magdaraog | 1041973559 | 06:00-14:00 |
| Inapan, Kyle Dafodelle | Kyle Dafodelle Inapan | 94168406 | 06:00-14:00 |
| Alonzo, Karl Vincent | Karl Alonzo | 97466742 | 06:00-14:00 |
| Marana, Kate | Mary Kathleen Maraña | 86280388 | 06:00-14:00 |
| Gentapan, Gyzl | Gyzl Gentapan | 83925665 | 06:00-14:00 |
| Uson, Erica Nicole | Erica Nicole Uson | 79945122 | 06:00-14:00 |
| Madura, Melissa | Melissa Madura | 1615624257 | 06:00-14:00 |
| Magdaraog Monico | Monico Magdaraog | 79707273 | 06:00-14:00 |
| Acebedo, Maria Aninna | Maria Aninna Acebedo | 1062675376 | 06:00-14:00 |
| Salguero, Gia | Gianna Salguero | 217656601 | 10:00-18:00 |
| Pallon, Gretchen | Gretchen Pallon | 79945090 | 10:00-18:00 |
| Ramirez, Patricia Lyn | Patricia Lyn Ramirez | 708753665 | 14:00-22:00 |
| Banatao, Honey Mae | Honey Banatao | 80154276 | 14:00-22:00 |
| Teodoro, Kim April | Kim April Teodoro | 79945168 | 14:00-22:00 |
| Olea, Kayla | Kayla Marize Olea | 761394559 | 22:00-06:00 |
| De Dios, Adelle Maria | Adelle Maria de Dios | 82811021 | 22:00-06:00 |
| Cestina, Vina | Vina Cestina | 76981964 | 22:00-06:00 |

**Team leads** (never assigned tickets; task fallback only):

| Name | Owner ID | Covers |
|---|---|---|
| John Ong | 725494978 | Morning, swing and mid shifts |
| Angie Reyes | 224336922 | Night shift |

A name on the sheet that is not in this table: do not assign to them,
look them up with `search_owners`, and say in the post "{name} is on
the roster but not set up in the assignment yet." Never guess an owner.

---

## Which shift does this run cover

The skill runs four times a day. Each run only deals to the agents
whose shift started 30 minutes ago:

| Run (Manila) | Shift | Cron |
|---|---|---|
| 06:30 | Morning 06:00-14:00 | `CRON_TZ=Asia/Manila 30 6 * * *` |
| 10:30 | Swing 10:00-18:00 | `CRON_TZ=Asia/Manila 30 10 * * *` |
| 14:30 | Mid 14:00-22:00 | `CRON_TZ=Asia/Manila 30 14 * * *` |
| 22:30 | Night 22:00-06:00 | `CRON_TZ=Asia/Manila 30 22 * * *` |

Match the shift by the agent's Attendance column C start time, not by
this table, so a shift change on the sheet flows through on its own.

**"Today" for the night shift is the date the shift STARTS.** Kayla's
22:00 Monday shift reads Monday's column.

Agents on other shifts are left alone, even if they are under target.
They get topped up at their own shift start.

---

## STEP 0: double-run guard

Read the Assignment Log tab. If it already holds a `LIVE` row for this
shift and today's date, stop, and post nothing. A re-run on demand
("re-run the T1 assignment for the morning shift") is allowed only when
a person asks for it; then only top up the gap that remains.

---

## STEP 1: tickets (Ticket Automation A)

### Scope

| What | Value |
|---|---|
| Object | TICKET, pipeline `hs_pipeline = 0` (Support Tickets) |
| Open | no `closed_date`. Stages `1` New, `2` Open, `15040590` Waiting on customer, `28896561` Waiting on Internal |
| Excluded | `hs_ticket_category` contains `Automated Response` (the "Miles" AI agent label). Split the multi-value field on `;` first. |
| Excluded | `hs_ticket_category` contains `Complaints`. Those belong to CS MEL escalations (`iv-skills-cs-mel-triage`). |

### Existing pending tickets per agent

For each working agent in this shift with a ticket target:

    pending = open tickets owned by the agent in pipeline 0
              (same exclusions as above)
    to_assign = max(0, target - pending)

Waiting on customer and Waiting on Internal count as pending. They are
still the agent's load.

### Store routing (US/CA vs NZ/AU)

There is no store property on tickets. Work it out in this order:

1. **Linked deal currency.** Associated deal's `deal_currency_code`:
   `AUD` or `NZD` → `NZ/AU`. `USD` or `CAD` → `US/CA`. Several deals
   with different stores: use the most recently created deal.
2. **Subject text.** "(AUD)" or "(NZD)" → `NZ/AU`. "(USD)" or "(CAD)"
   → `US/CA`. Supplier emails often carry this, e.g. "Agency:
   INSPIRING VACATIONS (AUD)".
3. **Linked contact country.** Australia or New Zealand → `NZ/AU`.
   United States or Canada → `US/CA`.
4. **Still unknown**: leave it unassigned and count it in the post as
   "{n} tickets I couldn't place by store". Never default it to a store.

Verify rule 1 on the first preview run: if more than 20% of tickets
land in step 4, say so in the post. The rule needs tuning.

### Picking the tickets: FIFO

1. Pull every open, unassigned, in-scope ticket. Page until the count
   matches `total`.
2. Sort **oldest `createdate` first** (FIFO).
3. **Exception: urgent first.** `hs_ticket_priority = URGENT` or
   category `On tour` or `Ops Urgent Only` jumps the line, oldest first
   among them. An on-tour customer cannot wait behind a 3-week-old
   feedback email.
4. Deal to the agents of the matching store in **round robin**, the
   agent with the largest gap (`to_assign`) first, ties alphabetical by
   surname. Carry the pointer forward. Stop dealing to an agent when
   their gap hits zero.
5. Not enough tickets: assign what there is. Agents stay under target
   and the post says so plainly.
6. More tickets than gaps: the rest stay unassigned and the post says
   how many, and how old the oldest is.

### Never

- Reassign a ticket that already has an owner.
- Assign to anyone not `IN` today.
- Assign to a team lead.
- Change stage, priority, category or anything except `hubspot_owner_id`.

### Write

Re-check each ticket is still open and unowned immediately before
writing. Queues move; agents self-serve. Batch 10 per
`manage_crm_objects` call. Retry a failed write once, then report it.

---

## STEP 2: tasks (Task Automation A)

### Task queues

| Goal tab value | Queue | Queue ID |
|---|---|---|
| a number (e.g. `20`, `30`, `5`) | MNL CS - all tasks | `4046613` |
| `Cruise` | Cruise - CS 2026 | `12867798` |

Out of scope, never assigned here:
- `Enquiry Pending` subjects in 4046613. Those go back to whoever raised
  them via `iv-skills-cs-mnl-enquiry-pending-assignment`.
- MNL CS - Call Backs (`6411820`). Reported only, until Jess says
  otherwise.
- All Tier 2 queues and all CS MEL queues.

### Numbered targets (general task queue)

Same top-up rule as tickets:

    pending   = open tasks the agent owns in 4046613
                (NOT_STARTED, IN_PROGRESS, WAITING, DEFERRED)
    to_assign = max(0, target - pending)

FIFO by `hs_createdate`, with HIGH priority or "urgent", "on tour",
"callback" in the subject jumping the line. Store routing applies the
same way as tickets (task's linked deal currency first). Night shift
agents take `US/CA` tasks, day agents `NZ/AU`.

### `Cruise` owners

Every open unassigned task in Cruise - CS 2026 is shared round robin
among the `Cruise` agents working today. No cap; the queue is often
empty, and a zero is correct.

### Fallback when the designated agent is out

| Designated | First backup | Then |
|---|---|---|
| Ella (20, morning) | Gia (30, swing) takes Ella's target on top of her own at 10:30 | John Ong |
| Gia (30, swing) | Ella, at the next morning run | John Ong |
| Jastine / Kesha (Cruise) | The other one | John Ong |
| Kayla / Adelle / Vina (5, night) | The other night agents working, splitting the target | Angie Reyes |

The team lead fallback is real: the TL becomes the owner, so they can
re-assign by hand. Say it in the post: "Jastine and Kesha are both out,
so the cruise tasks went to John."

### Avoid duplicates, keep history

- Never assign a task that already has an owner. That also keeps the
  original owner untouched.
- Two open tasks on the same deal with the same subject: assign the
  older one, leave the newer unassigned, and name the booking in the
  post so someone can close it.
- Every assignment goes in the Assignment Log (Step 3). HubSpot also
  keeps owner history on the record.

---

## STEP 3: Assignment Log (history for the reports)

Append one row per assigned ticket or task to the `Assignment Log` tab
of the CS Roster sheet. Create the tab with this header on the first
run if it does not exist. Never edit or delete old rows.

| Column | Value |
|---|---|
| A Date | Shift date, `YYYY-MM-DD` (Manila) |
| B Run time | Manila time, `HH:MM` |
| C Shift | Morning / Swing / Mid / Night |
| D Mode | PREVIEW or LIVE |
| E Object | Ticket or Task |
| F Record ID | HubSpot ID |
| G Booking | Booking number if readable, else blank |
| H Store | NZ/AU, US/CA |
| I Agent | First name surname |
| J Owner ID | HubSpot owner ID |
| K Target | The agent's daily target |
| L Pending before | Open items held before this run |
| M Reason | `target top-up`, `cruise`, `fallback for {name}` |

This tab is what lets `iv-skills-cs-mnl-t1-reports` show "assigned per
day" and compare over time. HubSpot does not keep a clean
assigned-on-date field.

---

## STEP 4: Daily Signal

Run `iv-skills-cs-mnl-t1-daily-signal` for the agents in this shift.
It runs last so the running order covers today's new work.

---

## STEP 5: the post

**Destination: Slack conversation `C0C1YK6BVDH` (AI CS space)** until
Jess names a dedicated Tier 1 channel. One post per run. No DMs.

Plain words. No IDs, no rule names, no "round robin", "FIFO", "gap".

    Morning shift is set up. (Preview, nothing assigned yet.)

    *Tickets*
    - *Ella*: had 2, got 3, now at target of 5.
    - *Kyle*: had 5, already at target, nothing new.
    - *Kate*: had 1, got 2, now 3 of 5 (ran out of tickets).

    *Tasks*
    - *Ella*: had 12, got 8, now at target of 20.
    - *Jastine*: 4 cruise tasks.

    *Worth a look*
    - Kesha is on leave, so Jastine has all the cruise tasks today.
    - 14 tickets are still waiting, oldest open 9 days.
    - 3 tickets I couldn't place by store.

Only list agents in this shift who are in today. Skip a section that is
empty. Four "Worth a look" items maximum. If nothing to flag, end with
"Nothing else to flag."

---

## Known gaps (do not quietly fix)

- Store routing is inferred. There is no store property on tickets.
- The task targets in the Goal tab are daily, but this skill tops up
  per shift. If an agent closes 20 tasks by 10:00 they will not get
  more until their next shift. That is by design (one top-up per
  shift), not a fault.
- Even by count, not by effort.

## Change log

- 2 Nov 2026: created from the "Automation and Rule" tab of the CS
  Roster sheet (Jess). Starts in PREVIEW.
