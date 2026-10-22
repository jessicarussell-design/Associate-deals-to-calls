---
name: iv-skills-cs-escalation-watch
description: Twice-daily CS escalation watch. Reads open Support Tickets where the customer has written since our last reply, judges whether the customer is still unhappy or the problem is still unresolved (never by email count), and moves the ticket one step up the ladder by setting the ticket property Escalation Level (Green T1, Amber T2, Red TL, Red Melbourne) plus a short ticket note saying why. Official letters only (Fair Trading, ACCC, a lawyer's letter, a letter of demand, a bank chargeback notice) go straight to Red Melbourne (CS MEL - Escalations); a customer just mentioning them is judged as a normal strike. Clears the colour when the customer is happy or the ticket is solved. Tickets only, never tasks. Never replies to customers; posts nothing to Slack. Runs 8am and 2pm Manila, Monday to Friday, in DRY RUN, PRACTICE or LIVE mode. Trigger on "run the escalation watch", "check for unhappy customers", "escalation ladder run", or the twice-daily routine.
---

# CS Escalation Watch

Finds customers who have been helped and are still not happy, and moves
their ticket one step up to a more senior person. It does this by
setting one ticket property, **Escalation Level**, which the Help Desk
views pick up. It never replies to anyone and never touches tasks.

Source of truth for the rules: the "CS escalation ladder: proposal" doc
(https://claude.ai/artifact/46krEQJLmXwdcWgEEs6ABm).

---

## Execution contract

- **Nothing in this skill waits for a human.** It runs on schedule,
  resolves every judgement call by the rules below, and reports after.
- **Ambiguity resolves to the least destructive option.** If unsure
  whether something is a strike, it is NOT a strike. List it under
  "Watching" in the run summary instead.
- **One step at a time.** Never move a ticket more than one level in a
  run. The only exceptions are the hard triggers.
- **Never move a ticket down a level.** Only a person lowers a level.
  The one thing the skill takes away is the whole colour, when the
  customer is happy or the ticket is solved (STEP 3b).
- **No Slack, no messages, no emails.** The skill posts nothing anywhere.
  The ticket note and the run summary are the only record.
- **The number of emails never counts.** A long, friendly thread that is
  moving along stays where it is.

---

## Mode

Every run is in exactly one mode. Read it from the prompt that started
the run. **If the prompt does not say, use DRY RUN.**

| Mode | Writes to HubSpot | Run summary |
|---|---|---|
| DRY RUN | Nothing | Every call it would make, for a Team Leader to check (build Step 3) |
| PRACTICE | Escalation Level + ticket note | Every change, one line each |
| LIVE | Escalation Level + ticket note | Counts and hard triggers only |

During PRACTICE the T1 views do not filter on Escalation Level yet, so
T1 keeps every ticket. Team Leaders check the "Escalation watch" note on
each moved ticket in their views. If a call is wrong, they set the
colour back and add a note starting `Escalation watch: wrong`. LIVE
starts when the T1 filter is added (build Step 7).

---

## The ladder

Property: `escalation_level` on TICKET (dropdown).

| Level | Option label | Internal value | Who has the ticket |
|---|---|---|---|
| none | (blank) | (blank) | T1, no strikes yet |
| L0 | Green: T1 | `Green_T1` | T1, one strike recorded |
| L1 | Amber: T2 | `Amber:_T2` | Manila T2 (MNL T2 Escalations view) |
| L2 | Red: TL | `Red_TL` | Manila Team Leader (MNL TL Escalations view) |
| L3 | Red: Melbourne | `Red_Melbourne` | Melbourne (CS MEL - Escalations view) |

**Always re-read the option values with `get_properties` at the start of
each run** and use what HubSpot returns. The Amber value contains a
colon today and may be tidied to `Amber_T2`. Never hardcode it blindly.

### One strike moves one step

| Current level | On a strike | Result |
|---|---|---|
| blank | first strike | Green: T1 |
| Green: T1 | second strike | Amber: T2 |
| Amber: T2 | strike | Red: TL |
| Red: TL | strike | Red: Melbourne |
| Red: Melbourne | strike | No change. Add a note "still unhappy at Melbourne" and list it in the run summary |

---

## Scope

- **Object:** TICKET only.
- **Pipeline:** Support Tickets (pipeline `0`).
- **Open stages:** New `1`, Open `2`, Waiting on customer `15040590`,
  Waiting on Internal `28896561`. Closed `4` and Archive `15475992` are
  out of scope.
- Other pipelines (Sales, Cruise, Operations, Flights, India, Product,
  Privacy) are out of scope until someone asks for them.

---

## STEP 0: gather

1. **Resolve today's date and time in Asia/Manila.** The container clock
   is UTC. Never use the raw system date.
2. Read `escalation_level` options with `get_properties` (see above).
3. Pull candidate tickets with `search_crm_objects` (TICKET), pipeline
   `0`, open stages only, where ANY of these is true:
   - **Customer wrote last:** `hs_last_message_from_visitor` = true, or
     `last_reply_date` / `hs_last_message_received_at` is later than
     `hs_last_message_sent_at`.
   - **Reopened:** `hs_ticket_reopened_at` is within the last 24 hours.

   Also pull, separately, **closed tickets with a colour**: pipeline `0`,
   stage Closed `4`, `escalation_level` HAS_PROPERTY, closed in the last
   7 days. These are for STEP 3b only.

   Properties to fetch: `subject`, `hs_pipeline_stage`,
   `hubspot_owner_id`, `escalation_level`, `last_reply_date`,
   `hs_last_message_received_at`, `hs_last_message_sent_at`,
   `hs_last_message_from_visitor`, `hs_ticket_reopened_at`,
   `number_of_times_ticket_reopened`, `hs_ticket_category`,
   `hs_lastmodifieddate`. Page through ALL results. Never work from a
   sample.
4. HubSpot dates are UTC. Convert to Manila before comparing.

---

## First run only: catch up from history

The first time the skill runs in PRACTICE or LIVE (no ticket in scope has
an `escalation_level` and no `Escalation watch:` notes exist yet), count
strikes from the **whole thread history** of each candidate, not just
the latest message, so long-running complaints start where they belong:

- One strike in the history: Green: T1.
- Two or more strikes: Amber: T2. Never higher than Amber from history
  alone; Red only comes from new strikes or a hard trigger.
- The note says `Escalation watch: catch-up from history ([n] strikes)`.

The safety cap does not apply to this first catch-up run.

---

## STEP 1: skip what is already judged

For each candidate, read the ticket's notes. If a note starting
`Escalation watch:` already names the same customer message timestamp,
**skip the ticket**. That message has been judged. This makes the skill
safe to run twice in a day, and stops it re-escalating a ticket a Team
Leader has set back with an `Escalation watch: wrong` note.

---

## STEP 2: read the thread and judge

**Two points at T1.** The first strike marks the ticket Green and T1
tries again. The second strike moves it to Amber (T2). After that, each
strike moves it one more step.

Read the conversation with `search_conversations`, `objectType=TICKET`,
`objectId=<ticket id>`, `messageDetail=WITH_ROLE`.

Look at the customer messages since our last agent reply, in the
context of the whole thread. Decide ONE of:

| Call | What it looks like | Strike? |
|---|---|---|
| **Fixed / happy** | "Thanks, that's sorted", "Perfect" | No |
| **Moving along** | Sends info we asked for, asks a new, simple question, friendly back and forth | No |
| **Unhappy or unresolved** | The tone is unhappy, or our reply didn't fix it: "That doesn't answer my question", "Still not fixed", repeats the same ask, frustration, threats to cancel or complain, "this is the third time" | **Yes** |
| **Needs an answer sooner** | Not sorted yet and time matters: travelling within 7 days or on tour now, missing flights, transfers or documents close to departure, a payment or cancellation deadline, stranded, or a health or safety worry | **Yes** |
| **Not sure** | Can't tell | No. List under "Watching" |

**Time alone is never a strike.** How long the customer has waited, or
how many emails there are, does not move a ticket by itself. Only the
tone, or a real need for a faster answer, does.

Other strikes:

- **Reopen** because the problem isn't fixed: one strike. A reopen with
  a "thank you" is not a strike. If the colour was cleared when the
  ticket closed, restore the level from the last `Escalation watch:`
  note first, then move it up one step. A closed-then-reopened ticket
  keeps its place on the ladder.

Who counts as the customer:

- **Travel agents** writing on behalf of a customer count as the
  customer. Judge them the same way.
- **Replies to marketing or event emails** (newsletters, "are you
  ready?", travel show follow-ups) are ignored. Never a strike.
- Suppliers, airlines, automated notices and our own staff are never
  the customer.

Not strikes:

- The customer's very first message on a ticket, unless it **needs an
  answer sooner**. An urgent first message (e.g. "I fly Monday and have
  no tickets") IS the first strike.
- A rule-based hand-off from Miles (inside 7 days, Perseus edits and
  similar). Miles handing over a cross customer, or the customer coming
  back after Miles said it was sorted, IS a strike.

### Hard triggers (skip the line)

**Only official correspondence skips the line.** A customer simply
mentioning ACCC, Fair Trading or legal action does NOT skip. Judge that
message like any other: it is usually a strike, and the ticket moves one
step as normal.

| Skips straight to Red: Melbourne | Does NOT skip (judge as normal) |
|---|---|
| A letter or email FROM Fair Trading, ACCC, Consumer Affairs, an ombudsman or a tribunal (e.g. VCAT, NCAT) | "I'll report you to the ACCC" |
| A letter from a lawyer or solicitor acting for the customer | "I'm going to take legal action" |
| A formal letter of demand | "This isn't fair under ACCC rules" |
| A chargeback or dispute notice from the customer's bank or card provider | "I'll do a chargeback" |

Signs it is official: it comes from the agency, firm or bank (not the
customer), or the customer attaches or forwards it, or it is set out as a
formal notice (reference number, legal headings, a deadline to respond).

Action: set **Red: Melbourne** straight away, whatever the current level.
It lands in CS MEL - Escalations. For Fair Trading the note also says
"Fair Trading: for Loren".

If unsure whether it is official, treat it as official: these are the
cases where waiting costs most.

---

## STEP 3: write (PRACTICE and LIVE only)

For each strike or hard trigger:

1. **Set `escalation_level`** to the next level with
   `manage_crm_objects` (updateRequest, TICKET). Change NOTHING else on
   the ticket.
2. **Add a note** on the ticket (NOTE object associated to the ticket):

   ```
   Escalation watch: [old level] -> [new level]
   Why: [one plain sentence, e.g. "Customer still disputes the $400 fee after our second reply."]
   Customer message judged: [timestamp, Manila]
   Mode: [PRACTICE or LIVE]
   ```

DRY RUN writes nothing. It only reports.

**Safety cap:** if a run would change more than 40 tickets, stop after
the hard triggers, write nothing else, and say so at the top of the run
summary. A number that high means the rules or the data have gone wrong.

### STEP 3b: clear the colour when it's fixed

For the closed tickets pulled in STEP 0, and any open ticket judged
**Fixed / happy**:

- Closed ticket with a colour: clear `escalation_level` (set it empty)
  and add a note `Escalation watch: cleared, ticket solved ([old level])`.
  The note keeps the record, so a reopen can restore the level.
- Open ticket where the customer says it's sorted: leave the colour
  until the ticket is closed. Whoever fixed it closes it as normal.

---

## What this skill never does

- Never replies to, emails or messages a customer.
- Never creates, edits, assigns or completes tasks.
- Never touches the MNL T2 daily assignment or its Daily Signal.
- Never changes ticket owner, status, pipeline, priority or category.
- Never moves a ticket down a level. It only clears the colour on a
  solved ticket (STEP 3b).
- Never changes anything in Lorikeet.
- Never posts to Slack, or sends a message or email of any kind.

---

## STEP 4: run summary (no Slack)

End every run with ONE plain-English summary as the run's final output.
It shows in the routine's run history. **Do not post it to Slack or
send it anywhere.** Always refer to a ticket by booking number and a
HubSpot link, never by ID alone.

**DRY RUN and PRACTICE:**

```
Escalation watch, [Mon 2pm Manila] ([MODE])
Moved up: [n]  |  Cleared: [n]  |  Watching: [n]  |  Hard triggers: [n]

1. [Booking] [link]  Green -> Amber (T2)
   Customer still disputes the $400 fee after our second reply.
2. ...

Watching (not moved):
- [Booking] [link]  Customer sounds annoyed but got a reply this morning.

Marked wrong by a Team Leader since last run: [n]
```

**LIVE:** counts per level, any hard triggers, anything stuck at
Red: Melbourne, and anything for Loren. No per-ticket list unless it is
a hard trigger.

**Practice score:** count the `Escalation watch: wrong` notes against the
moves made, over the last 7 days, and show it as "[x] of [y] right ([z]%)".
Build Step 7 switches to LIVE at 85% or better.

If nothing needs moving, the summary is one line: "Escalation watch:
nothing to move this run."

---

## Schedule

Twice a day, Monday to Friday: **8am and 2pm Manila time** (Asia/Manila).
No weekend runs. Agreed with Jess, Oct 2026.

## Open question

- Whether other pipelines (e.g. Flights, Operations) should be watched.
