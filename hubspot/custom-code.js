/**
 * HubSpot workflow custom code action: link a connected call to the right deal.
 *
 * Paste this whole file into a "Custom code" action (Node.js 20) in a
 * call-based workflow. See hubspot/SETUP.md for the full setup.
 *
 * How a call is matched (same rules as associate_calls.py):
 *   1. Read the Aircall call summary stored on the call (hs_call_body).
 *   2. Work out the customer: the contact already on the call, or, when Aircall
 *      logged it against a placeholder "Aircall new contact", the contact whose
 *      phone number matches the caller.
 *   3. If the summary mentions a booking number, e.g. "(1529953) 21 Day Follow the
 *      Lights to Iceland", that deal wins, but only when it belongs to the caller.
 *      A booking on someone else's deal is skipped and noted for a person.
 *   4. When the customer has several open deals and no booking number settles it,
 *      the call is skipped. Otherwise Claude reads the summary alongside the
 *      customer's deals (stage and departure date included) and picks one, only
 *      when it is highly confident.
 *   5. The call is linked to the deal, and to the deal's contact when the call was
 *      not already linked to them.
 *
 * Every outcome is written to the call's "Deal match note" property.
 *
 * Secrets: HUBSPOT_TOKEN (private app token), ANTHROPIC_API_KEY.
 * Properties to include: hs_call_body, hs_call_direction, hs_call_from_number,
 *   hs_call_to_number, hs_timestamp.
 */

// ----- Settings you can change ------------------------------------------------

// false = preview: only writes the note, links nothing. Set to true to go live.
const LIVE_MODE = false;
// Skip, rather than ask Claude, when the customer has several open deals.
const STRICT_OPEN_DEALS = true;
// Inspiring Vacations' own lines; never treated as the customer's number.
const OWN_PHONE_NUMBERS = [];
const CLAUDE_MODEL = "claude-opus-5-5";
// Custom code actions stop after about 20 seconds; leave room for HubSpot calls.
const CLAUDE_TIMEOUT_MS = 12000;
const NOTE_PROPERTY = "deal_match_note";

// ----- Matching helpers -------------------------------------------------------

const HUBSPOT_BASE = "https://api.hubapi.com";
const PLACEHOLDER_CONTACT = /aircall new contact/i;
// Booking numbers are 6-8 digits; deal names carry them as "(1529953) ...".
const BOOKING_NUMBER = /(?<![\d+])(\d{6,8})(?!\d)/g;
const DEAL_NAME_BOOKING = /^\((\d{6,8})\)/;
const DEAL_PROPS = [
  "dealname", "dealstage", "pipeline", "hs_is_closed", "createdate",
  "hs_lastmodifieddate", "departure_date", "preferred_departure_date", "cruise_date",
];
const CONTACT_PROPS = ["firstname", "lastname", "phone", "mobilephone"];

function summaryText(callBody) {
  if (!callBody) return "";
  return callBody
    .replace(/<br\s*\/?>|<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Booking numbers in a summary, skipping the Aircall "Call ID" line. */
function bookingNumbers(text) {
  const cleaned = text.replace(/Call ID:\s*\d+/gi, "");
  return [...new Set([...cleaned.matchAll(BOOKING_NUMBER)].map((m) => m[1]))];
}

function dealBookingNumber(dealname) {
  const match = DEAL_NAME_BOOKING.exec(dealname || "");
  return match ? match[1] : null;
}

const digits = (phone) => (phone || "").replace(/\D/g, "");

/** The customer's side of the call: caller for inbound, callee for outbound. */
function customerNumber(props) {
  const inbound = (props.hs_call_direction || "").toUpperCase() === "INBOUND";
  const number = inbound ? props.hs_call_from_number : props.hs_call_to_number;
  if (!number || OWN_PHONE_NUMBERS.includes(number)) return null;
  return number;
}

/** Compare on the last 9 digits so +61 412... and 0412... match. */
function phonesMatch(a, b) {
  const da = digits(a);
  const db = digits(b);
  return da.length >= 8 && db.length >= 8 && da.slice(-9) === db.slice(-9);
}

/**
 * Decide what the booking numbers in a summary tell us.
 * Returns {action: "link" | "skip" | "ask_claude", deal, note}. A booking number
 * only counts when its deal belongs to the caller.
 */
function matchBooking(booked, customerDeals, callerKnown) {
  const bookedDeals = Object.values(booked);
  if (!bookedDeals.length) return { action: "ask_claude", deal: null, note: "" };
  const names = bookedDeals.map((d) => d.properties.dealname || d.id).sort().join(", ");
  if (!callerKnown) {
    if (bookedDeals.length === 1) {
      return { action: "link", deal: bookedDeals[0], note: "booking number in summary (caller not identified)" };
    }
    return { action: "skip", deal: null, note: `summary mentions several bookings (${names}) and the caller was not identified` };
  }
  const own = bookedDeals.filter((d) => d.id in customerDeals);
  if (own.length === 1) {
    return { action: "link", deal: own[0], note: "booking number in summary, on the caller's deal" };
  }
  if (!own.length) {
    return { action: "skip", deal: null, note: `booking in summary (${names}) is not on the caller's deals; check by hand` };
  }
  return { action: "ask_claude", deal: null, note: "" };
}

const openDealCount = (deals) => deals.filter((d) => d.properties.hs_is_closed !== "true").length;

/** One line describing a deal for Claude. */
function dealLine(deal, stageLabels) {
  const p = deal.properties;
  const stage = stageLabels[p.dealstage] || p.dealstage || "unknown";
  const departure = (p.departure_date || p.cruise_date || p.preferred_departure_date || "").slice(0, 10);
  return (
    `- id ${deal.id}: ${p.dealname} | ` +
    `${p.hs_is_closed === "true" ? "closed" : "open"} | ` +
    `stage ${stage} | ` +
    `departs ${departure || "unknown"} | ` +
    `created ${(p.createdate || "").slice(0, 10)}`
  );
}

// ----- HubSpot API ------------------------------------------------------------

function hubspotClient(token) {
  async function request(method, path, body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const resp = await fetch(HUBSPOT_BASE + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (resp.status === 429 || resp.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (!resp.ok) throw new Error(`HubSpot ${method} ${path} failed: ${resp.status} ${await resp.text()}`);
      const text = await resp.text();
      return text ? JSON.parse(text) : {};
    }
    // Let HubSpot retry the whole action later.
    const err = new Error(`HubSpot ${method} ${path} still rate limited`);
    err.response = { status: 429 };
    throw err;
  }

  return {
    request,
    async associations(fromType, toType, id) {
      const data = await request("GET", `/crm/v4/objects/${fromType}/${id}/associations/${toType}?limit=500`);
      return (data.results || []).map((r) => String(r.toObjectId));
    },
    async batchRead(objectType, ids, properties) {
      const out = {};
      const unique = [...new Set(ids)];
      for (let i = 0; i < unique.length; i += 100) {
        const data = await request("POST", `/crm/v3/objects/${objectType}/batch/read`, {
          properties,
          inputs: unique.slice(i, i + 100).map((id) => ({ id })),
        });
        for (const rec of data.results || []) out[rec.id] = rec;
      }
      return out;
    },
    async search(objectType, body) {
      const data = await request("POST", `/crm/v3/objects/${objectType}/search`, { ...body, limit: 100 });
      return data.results || [];
    },
    async contactsByPhone(number) {
      const last9 = digits(number).slice(-9);
      if (last9.length < 8) return [];
      const found = await this.search("contacts", {
        filterGroups: ["hs_searchable_calculated_phone_number", "hs_searchable_calculated_mobile_number"].map(
          (propertyName) => ({ filters: [{ propertyName, operator: "CONTAINS_TOKEN", value: `*${last9}` }] })
        ),
        properties: CONTACT_PROPS,
      });
      return found.filter(
        (c) => phonesMatch(c.properties.phone, number) || phonesMatch(c.properties.mobilephone, number)
      );
    },
    async dealsByBookingNumber(number) {
      const found = await this.search("deals", {
        filterGroups: [{ filters: [{ propertyName: "dealname", operator: "CONTAINS_TOKEN", value: number }] }],
        properties: DEAL_PROPS,
      });
      return found.filter((d) => dealBookingNumber(d.properties.dealname) === number);
    },
    async dealStageLabels() {
      const data = await request("GET", "/crm/v3/pipelines/deals");
      const labels = {};
      for (const pipeline of data.results || []) {
        for (const stage of pipeline.stages || []) labels[stage.id] = `${pipeline.label}: ${stage.label}`;
      }
      return labels;
    },
    associate(fromType, fromId, toType, toId) {
      return request("PUT", `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`);
    },
    setNote(callId, note) {
      return request("PATCH", `/crm/v3/objects/calls/${callId}`, {
        properties: { [NOTE_PROPERTY]: note.slice(0, 1000) },
      });
    },
  };
}

// ----- Claude: pick the deal from the summary ---------------------------------

const PICK_SCHEMA = {
  type: "object",
  properties: {
    deal_id: { type: ["string", "null"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reason: { type: "string" },
  },
  required: ["deal_id", "confidence", "reason"],
  additionalProperties: false,
};

function pickPrompt(props, summary, deals, stageLabels) {
  return `You match a travel company's phone call to the CRM deal it was about.

Each deal is one tour or cruise booking or enquiry. Deal names usually start with
the booking number in brackets, then the trip name and season.

Pick the deal the call was about, using the trip, destination, departure date,
deal stage, booking number, or anything else in the call summary. Answer with
confidence "high" only when the summary clearly points to one deal. If the call
could fit several deals, or none, return deal_id null. Never guess.

Call (${props.hs_timestamp || ""}, ${(props.hs_call_direction || "").toLowerCase()}):
${summary}

Customer's deals:
${deals.map((d) => dealLine(d, stageLabels)).join("\n")}`;
}

async function pickDealWithClaude(apiKey, props, summary, deals, stageLabels) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLAUDE_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4000,
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema", schema: PICK_SCHEMA } },
        messages: [{ role: "user", content: pickPrompt(props, summary, deals, stageLabels) }],
      }),
    });
  } catch (err) {
    if (err.name === "AbortError") return { deal_id: null, confidence: "low", reason: "Claude took too long" };
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) throw new Error(`Claude API failed: ${resp.status} ${await resp.text()}`);
  const message = await resp.json();
  if (message.stop_reason !== "end_turn") {
    return { deal_id: null, confidence: "low", reason: `Claude stopped: ${message.stop_reason}` };
  }
  const text = message.content.find((b) => b.type === "text");
  const result = JSON.parse(text.text);
  if (!deals.some((d) => d.id === result.deal_id)) result.deal_id = null;
  return result;
}

// ----- Main -------------------------------------------------------------------

async function matchCall(hubspot, apiKey, callId, props) {
  // Already on a deal: nothing to do (also makes re-enrolment safe).
  if ((await hubspot.associations("calls", "deals", callId)).length) {
    return { outcome: "skipped", note: "call already linked to a deal" };
  }
  const summary = summaryText(props.hs_call_body);

  // Who was the customer on this call?
  const linkedIds = await hubspot.associations("calls", "contacts", callId);
  const linked = Object.values(await hubspot.batchRead("contacts", linkedIds, CONTACT_PROPS));
  let customers = linked.filter(
    (c) => !PLACEHOLDER_CONTACT.test(`${c.properties.firstname} ${c.properties.lastname}`)
  );
  const number = customerNumber(props);
  let phoneNote = "";
  if (!customers.length && number) {
    customers = await hubspot.contactsByPhone(number);
    if (customers.length > 1) phoneNote = `${customers.length} contacts share phone ${number}; `;
  }
  const customerIds = new Set(customers.map((c) => c.id));

  // The customer's deals.
  let customerDeals = {};
  if (customerIds.size) {
    const dealIds = [];
    for (const id of customerIds) dealIds.push(...(await hubspot.associations("contacts", "deals", id)));
    customerDeals = await hubspot.batchRead("deals", dealIds, DEAL_PROPS);
  }

  // Any deal named by booking number in the summary.
  const booked = {};
  for (const n of bookingNumbers(summary)) {
    for (const d of await hubspot.dealsByBookingNumber(n)) booked[d.id] = d;
  }
  const booking = matchBooking(booked, customerDeals, customerIds.size > 0);

  let chosen = null;
  let method = "";
  if (booking.action === "link") {
    chosen = booking.deal;
    method = booking.note;
  } else if (booking.action === "skip") {
    return { outcome: "skipped", note: phoneNote + booking.note };
  } else if (!summary) {
    return { outcome: "skipped", note: phoneNote + "no call summary to read" };
  } else if (!Object.keys(customerDeals).length) {
    return { outcome: "skipped", note: phoneNote + (customerIds.size ? "customer has no deals" : "caller not identified") };
  } else if (STRICT_OPEN_DEALS && openDealCount(Object.values(customerDeals)) > 1) {
    const count = openDealCount(Object.values(customerDeals));
    return { outcome: "skipped", note: `${phoneNote}customer has ${count} open deals and no booking number settles it; check by hand` };
  } else {
    // Claude only ever chooses among the caller's own deals.
    const options = Object.values(customerDeals)
      .sort((a, b) => (b.properties.hs_lastmodifieddate || "").localeCompare(a.properties.hs_lastmodifieddate || ""))
      .slice(0, 40);
    const stageLabels = await hubspot.dealStageLabels();
    const pick = await pickDealWithClaude(apiKey, props, summary, options, stageLabels);
    if (!pick.deal_id || pick.confidence !== "high") {
      return { outcome: "skipped", note: `${phoneNote}not confident (${pick.confidence}): ${pick.reason}` };
    }
    chosen = options.find((d) => d.id === pick.deal_id);
    method = `Claude read the summary: ${pick.reason}`;
  }

  // Make sure the call sits on the deal's contact, not just a placeholder.
  const dealContactIds = new Set(await hubspot.associations("deals", "contacts", chosen.id));
  const already = new Set(linkedIds);
  const shared = [...customerIds].filter((id) => dealContactIds.has(id));
  const toAdd = (shared.length ? shared : [...dealContactIds]).filter((id) => !already.has(id));

  if (LIVE_MODE) {
    await hubspot.associate("calls", callId, "deals", chosen.id);
    for (const contactId of toAdd) await hubspot.associate("calls", callId, "contacts", contactId);
  }
  const verb = LIVE_MODE ? "Linked" : "PREVIEW, would link";
  const contacts = toAdd.length ? `; ${LIVE_MODE ? "added" : "would add"} contact ${toAdd.join(", ")}` : "";
  return {
    outcome: LIVE_MODE ? "linked" : "preview",
    dealId: chosen.id,
    note: `${phoneNote}${verb} to ${chosen.properties.dealname} (${method})${contacts}`,
  };
}

exports.main = async (event, callback) => {
  const hubspot = hubspotClient(process.env.HUBSPOT_TOKEN);
  const callId = String(event.object.objectId);
  const result = await matchCall(hubspot, process.env.ANTHROPIC_API_KEY, callId, event.inputFields || {});
  await hubspot.setNote(callId, result.note);
  callback({
    outputFields: { outcome: result.outcome, deal_id: result.dealId || "", note: result.note.slice(0, 1000) },
  });
};

// Exported for the local tests in tests/custom-code.test.js; HubSpot ignores these.
exports._test = {
  summaryText, bookingNumbers, dealBookingNumber, customerNumber, phonesMatch,
  matchBooking, openDealCount, dealLine, matchCall,
};
