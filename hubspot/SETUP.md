# HubSpot workflow setup: link calls to deals

A HubSpot workflow that runs on every connected call, about 15 minutes after it ends, and links it to the right deal. Its rules are the same as the GitHub version's, and it records what it decided in a **Deal match note** on the call.

**Time needed:** about 30 minutes, plus a HubSpot Super Admin for step 2.

## Before you start

You need:

- **Operations Hub (now Data Hub) Professional or Enterprise.** Custom code steps only come with these plans. If you're not sure, ask your HubSpot admin.
- **A HubSpot Super Admin** to create the private app in step 2.
- **Permission to create workflows** in HubSpot.
- **A Claude API key** (step 3).

> Menu names change from time to time. If a screen doesn't match these steps, look for the nearest equivalent, or ask Claude.

## Step 1: Create the "Deal match note" call property (3 min)

This is where the workflow records what it did with each call, and why.

1. **Settings** (gear icon) → **Data Management → Properties**.
2. Choose **Call properties** from the object dropdown, then click **Create property**.
3. Fill in:
   - **Label:** `Deal match note`
   - **Field type:** Single-line text
4. Save. Then open the property and check its **internal name** is `deal_match_note`. If it's different, change the `NOTE_PROPERTY` line near the top of the code to match.

## Step 2: Create the private app (Super Admin, 5 min)

The code uses this token to read calls, contacts and deals, and to link them.

1. **Settings → Integrations → Private Apps** (in newer portals: **Development → Legacy apps**) → **Create**.
2. **Name:** `Calls to deals workflow`
3. **Scopes:** tick read **and** write for:
   - `crm.objects.contacts.read` / `crm.objects.contacts.write`
   - `crm.objects.deals.read` / `crm.objects.deals.write`
   - Calls: `crm.objects.calls.read` / `crm.objects.calls.write` (listed under "Engagements" in some portals)
4. **Create app**, then copy the access token. It starts with `pat-`.

The admin can paste the token straight into the workflow secret in step 5, so it never has to be sent to anyone.

## Step 3: Get a Claude API key (3 min)

1. Go to **console.anthropic.com → API Keys → Create key**, and copy it. It starts with `sk-ant-`.
2. **Recommended:** under **Billing → Limits**, set a monthly spend limit, e.g. $100.

## Step 4: Create the workflow (5 min)

1. **Automation → Workflows → Create workflow → From scratch**.
2. Choose **Call-based**.
   - **If "Call" isn't offered as a workflow type, stop here and tell Claude.** The setup needs a different trigger.
3. **Enrollment trigger**, with all of these:
   - **Call status** is **Completed**
   - **Call duration** is greater than **0**
   - **Call notes** (`hs_call_body`) **is known**
4. **Re-enrollment:** leave off.
5. Add a **Delay** action of **15 minutes**. This gives Aircall time to add its call summary.

## Step 5: Add the custom code action (10 min)

1. After the delay, click **+** → **Custom code**.
2. **Language:** Node.js 20.x (or the newest Node.js offered).
3. **Secrets**, add two:
   - `HUBSPOT_TOKEN`: the `pat-...` token from step 2
   - `ANTHROPIC_API_KEY`: the `sk-ant-...` key from step 3
4. **Properties to include in code**, add these five (the names must match exactly):
   - `hs_call_body`
   - `hs_call_direction`
   - `hs_call_from_number`
   - `hs_call_to_number`
   - `hs_timestamp`
5. **Code:** delete the sample code, then paste the whole of `hubspot/custom-code.js`.
6. **Optional:** in `OWN_PHONE_NUMBERS` near the top, list your own Aircall lines, e.g.
   `const OWN_PHONE_NUMBERS = ["+61283115019", "+61272275786"];`
7. **Data outputs**, add three, all of type **String**: `outcome`, `deal_id`, `note`.
8. **Test it:** use the action's **Test** button and pick a recent connected call. In preview mode it only writes the note, so this is safe. Check that:
   - the test output shows `outcome` and `note`
   - the call now has a **Deal match note**
9. **Save.**

## Step 6: Turn it on in preview mode

1. Click **Review and publish**.
2. When asked about existing calls, choose **only calls that meet the trigger from now on**.
3. **Turn on.**

Preview mode (`LIVE_MODE = false`) links nothing. Each call just gets a note such as:

- `PREVIEW, would link to (1529953) 21 Day Follow the Lights to Iceland (booking number in summary, on the caller's deal)`
- `customer has 2 open deals and no booking number settles it; check by hand`
- `booking in summary ((1600001) ...) is not on the caller's deals; check by hand`

## Step 7: Review the preview notes (a few days)

1. Go to **CRM → Activities → Calls**, or build a calls report.
2. Filter on **Deal match note is known**.
3. Spot-check the "would link" rows against the calls, and look at why others were skipped.

If too many calls are skipped for "2 open deals", set `STRICT_OPEN_DEALS = false`. Claude then reads those calls too, and still links only when it's highly confident.

## Step 8: Go live

1. Edit the custom code action and change `const LIVE_MODE = false;` to `const LIVE_MODE = true;`.
2. Save and **Review and publish**.

From then on, matched calls are linked to the deal (and to the deal's contact, if missing). The note starts with `Linked to ...`.

## How it decides, in short

1. **Already on a deal:** skipped.
2. **Finds the customer:** the contact on the call, or a phone number lookup when Aircall used "Aircall new contact".
3. **Booking number in the summary:** used only if that deal belongs to the caller. If it belongs to someone else, the call is skipped and flagged.
4. **Several open deals and no booking number:** skipped and flagged.
5. **Otherwise Claude reads the summary** with the customer's deals (stage and departure date included) and links only when it's highly confident.
6. **Never removes links.** It only ever adds them.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Action fails with a timeout | Custom code steps have a short time limit. Change `CLAUDE_MODEL` to `"claude-sonnet-5-5"`, which is faster and half the price. |
| `401` from HubSpot | The `HUBSPOT_TOKEN` secret is wrong or the private app was deleted. |
| `403` from HubSpot | The private app is missing a scope from step 2. |
| `PROPERTY_DOESNT_EXIST` | The note property's internal name isn't `deal_match_note`. See step 1. |
| `401` from Claude API | The `ANTHROPIC_API_KEY` secret is wrong, or the account is out of credit. |
| Note says "no call summary to read" | Aircall's summary arrived after the delay. Increase the delay to 30 minutes. |

Errors appear in the workflow's **Action logs**.
