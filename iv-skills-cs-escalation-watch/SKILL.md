---
name: iv-skills-cs-escalation-watch
description: Twice-daily CS escalation watch. Reads open Support Tickets where the customer has written since our last reply, judges whether the customer is still unhappy or the problem is still unresolved (never by email count), and moves the ticket one step up the ladder by setting the ticket property Escalation Level (Green T1, Amber T2, Red TL, Red Melbourne) plus a short ticket note saying why. ACCC, chargeback and legal words go straight to Red TL; Fair Trading goes to Melbourne for Loren. Tickets only, never tasks. Never replies to customers. Runs in DRY RUN, PRACTICE or LIVE mode. Trigger on "run the escalation watch", "check for unhappy customers", "escalation ladder run", or the twice-daily routine.
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
  "Watching" in the Slack post instead.
- **One step at a time.** Never move a ticket more than one level in a
  run. The only exceptions are the hard triggers.
- **Never move a ticket down.** Only a person lowers a level.
- **The number of emails never counts.** A long, friendly thread that is
  moving along stays where it is.

---

## Mode

Every run is in exactly one mode. Read it from the prompt that started
the run. **If the prompt does not say, use DRY RUN.**

| Mode | Writes to HubSpot | Slack post |
|---|---|---|
| DRY RUN | Nothing | Every call it would make, for checking |
| PRACTICE | Escalation Level + ticket note | Every change, one line each, for TLs to mark right or wrong |
| LIVE | Escalation Level + ticket note | Short summary only |

During PRACTICE the T1 views do not filter on Escalation Level yet, so
T1 keeps every ticket. LIVE starts when the T1 filter is added.

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
| Red: Melbourne | strike | No change. Flag in Slack: "still unhappy at Melbourne" |

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
   - **No reply from us:** the customer's last message is more than
     2 business days old (Manila, Mon to Fri) and we have not replied
     since.
   - **Reopened:** `hs_ticket_reopened_at` is within the last 24 hours.

   Properties to fetch: `subject`, `hs_pipeline_stage`,
   `hubspot_owner_id`, `escalation_level`, `last_reply_date`,
   `hs_last_message_received_at`, `hs_last_message_sent_at`,
   `hs_last_message_from_visitor`, `hs_ticket_reopened_at`,
   `number_of_times_ticket_reopened`, `hs_ticket_category`,
   `hs_lastmodifieddate`. Page through ALL results. Never work from a
   sample.
4. HubSpot dates are UTC. Convert to Manila before comparing.

---

## STEP 1: skip what is already judged

For each candidate, read the ticket's notes. If a note starting
`Escalation watch:` already names the same customer message timestamp,
**skip the ticket**. That message has been judged. This makes the skill
safe to run twice in a day.

---

## STEP 2: read the thread and judge

Read the conversation with `search_conversations`, `objectType=TICKET`,
`objectId=<ticket id>`, `messageDetail=WITH_ROLE`.

Look at the customer messages since our last agent reply, in the
context of the whole thread. Decide ONE of:

| Call | What it looks like | Strike? |
|---|---|---|
| **Fixed / happy** | "Thanks, that's sorted", "Perfect" | No |
| **Moving along** | Sends info we asked for, asks a new, simple question, friendly back and forth | No |
| **Unhappy or unresolved** | "That doesn't answer my question", "Still not fixed", repeats the same ask, frustration, threats to cancel or complain, "this is the third time" | **Yes** |
| **Not sure** | Can't tell | No. List under "Watching" |

Other strikes:

- **No reply from us for 2 business days** after the customer wrote:
  one strike.
- **Reopen** because the problem isn't fixed: one strike. A reopen with
  a "thank you" is not a strike.

Not strikes:

- The customer's very first message on a ticket. We haven't replied yet.
- A rule-based hand-off from Miles (inside 7 days, Perseus edits and
  similar). Miles handing over a cross customer, or the customer coming
  back after Miles said it was sorted, IS a strike.

### Hard triggers (skip the line)

Check every customer message since our last reply, case-insensitive.

| Words | Action |
|---|---|
| ACCC, chargeback, charge back, dispute with my bank, lawyer, solicitor, legal action, sue, tribunal | Set **Red: TL** straight away, whatever the current level (unless already Red: Melbourne) |
| Fair Trading | Set **Red: Melbourne** and flag "for Loren" in Slack |

Read the sentence, not just the word. "No need for legal action, thanks"
is not a trigger. If unsure, treat it as a trigger: these are the cases
where waiting costs most.

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
the hard triggers, write nothing else, and say so in Slack. A number
that high means the rules or the data have gone wrong.

---

## What this skill never does

- Never replies to, emails or messages a customer.
- Never creates, edits, assigns or completes tasks.
- Never touches the MNL T2 daily assignment or its Daily Signal.
- Never changes ticket owner, status, pipeline, priority or category.
- Never moves a ticket down a level, or clears a level.
- Never changes anything in Lorikeet.

---

## STEP 4: report to Slack

Post ONE message per run to the agreed channel (default: AI CS space,
`C0C1YK6BVDH`, until the owner names another). Plain English. Always
refer to a ticket by booking number and a HubSpot link, never by ID
alone.

**DRY RUN and PRACTICE:**

```
Escalation watch, [Mon 2pm] ([MODE])
Moved up: [n]  |  Watching: [n]  |  Hard triggers: [n]

1. [Booking] [link]  Green -> Amber (T2)
   Customer still disputes the $400 fee after our second reply.
2. ...

Watching (not moved):
- [Booking] [link]  Customer sounds annoyed but got a reply this morning.

Team Leaders: react ✅ if a call is right, ❌ if it's wrong.
```

**LIVE:** counts per level, any hard triggers, anything stuck at
Red: Melbourne, and anything for Loren. No per-ticket list unless it is
a hard trigger.

If nothing needs moving, still post one line: "Escalation watch: nothing
to move this run."

---

## Open questions (owner to confirm)

- Run times (draft: start of the Manila shift and mid-afternoon, Manila
  time, Monday to Friday) and whether to run at weekends.
- Slack channel.
- Time limits for T2 and the Team Leader before a ticket moves up. Until
  agreed, the 2 business day no-reply rule applies at every level.
- Whether other pipelines (e.g. Flights, Operations) should be watched.
