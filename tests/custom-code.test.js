const test = require("node:test");
const assert = require("node:assert");
const {
  summaryText, bookingNumbers, dealBookingNumber, customerNumber, phonesMatch,
  matchBooking, openDealCount, dealLine, matchCall,
} = require("../hubspot/custom-code.js")._test;

const BODY =
  '<div><strong>Inbound answered call</strong> on <strong>[ IVR 2 ] Existing Bookings</strong></div>' +
  '<div id="aircall-call-summary"><strong>Call Summary:</strong> Customer called about booking 1449977 ' +
  "(18-Day Essential South Africa), DOB 21/01/1945, phone 0403231778, paid $8,990.</div>" +
  '<div id="aircall-call-id"><span><strong>Call ID:</strong> 4238394774</span></div>';

const deal = (id, name, closed = false, props = {}) => ({
  id, properties: { dealname: name, hs_is_closed: closed ? "true" : "false", ...props },
});
const ICELAND = deal("1", "(1529953) 21 Day Follow the Lights to Iceland");
const JAPAN = deal("2", "(1449977) 14 Day Japan");
const SOMEONE_ELSES = deal("9", "(1600001) 18-Day Essential South Africa");

test("summary text strips html and finds only the booking number", () => {
  const text = summaryText(BODY);
  assert.ok(!text.includes("<"));
  assert.deepStrictEqual(bookingNumbers(text), ["1449977"]);
});

test("deal booking number", () => {
  assert.strictEqual(dealBookingNumber("(1529953) 21 Day Iceland (2027-28)"), "1529953");
  assert.strictEqual(dealBookingNumber("Iceland enquiry"), null);
});

test("customer number by direction, phones match across formats", () => {
  assert.strictEqual(customerNumber({ hs_call_direction: "INBOUND", hs_call_from_number: "+61407486491" }), "+61407486491");
  assert.strictEqual(customerNumber({ hs_call_direction: "OUTBOUND", hs_call_to_number: "+61893686367" }), "+61893686367");
  assert.ok(phonesMatch("+61 407 486 491", "0407486491"));
  assert.ok(!phonesMatch("+61407486491", "+61407486492"));
});

test("booking rules", () => {
  assert.strictEqual(matchBooking({ 1: ICELAND }, { 1: ICELAND, 2: JAPAN }, true).deal, ICELAND);
  const other = matchBooking({ 9: SOMEONE_ELSES }, { 1: ICELAND }, true);
  assert.strictEqual(other.action, "skip");
  assert.match(other.note, /not on the caller's deals/);
  assert.strictEqual(matchBooking({ 1: ICELAND, 9: SOMEONE_ELSES }, { 1: ICELAND }, true).deal, ICELAND);
  assert.strictEqual(matchBooking({ 1: ICELAND, 2: JAPAN }, { 1: ICELAND, 2: JAPAN }, true).action, "ask_claude");
  assert.strictEqual(matchBooking({ 9: SOMEONE_ELSES }, {}, false).action, "link");
  assert.strictEqual(matchBooking({ 1: ICELAND, 9: SOMEONE_ELSES }, {}, false).action, "skip");
  assert.strictEqual(matchBooking({}, { 1: ICELAND }, true).action, "ask_claude");
});

test("deal line shows stage and departure", () => {
  assert.strictEqual(openDealCount([ICELAND, JAPAN, deal("3", "Old", true)]), 2);
  const line = dealLine(deal("1", "Iceland", false, { dealstage: "s1", departure_date: "2027-02-14" }), { s1: "Bookings: Deposit paid" });
  assert.match(line, /stage Bookings: Deposit paid/);
  assert.match(line, /departs 2027-02-14/);
  assert.match(dealLine(deal("3", "No dates"), {}), /departs unknown/);
});

// Full flow against a fake HubSpot.
const DEALS = {
  1: ICELAND, 2: JAPAN, 3: deal("3", "(1300000) Old trip", true),
  5: deal("5", "(1700000) Peru"), 9: SOMEONE_ELSES,
};
const CONTACT_DEALS = { A: ["1", "2", "3"], B: ["5", "3"], C: ["9"] };

function fakeHubspot(callContact, callDeals = []) {
  return {
    async associations(from, to, id) {
      if (from === "calls" && to === "deals") return callDeals;
      if (from === "calls" && to === "contacts") return [callContact];
      if (from === "contacts" && to === "deals") return CONTACT_DEALS[id];
      if (from === "deals" && to === "contacts") return Object.keys(CONTACT_DEALS).filter((k) => CONTACT_DEALS[k].includes(id));
    },
    async batchRead(type, ids) {
      const out = {};
      for (const id of ids) out[id] = type === "contacts" ? { id, properties: { firstname: "Jo", lastname: id } } : DEALS[id];
      return out;
    },
    async dealsByBookingNumber(n) { return Object.values(DEALS).filter((d) => dealBookingNumber(d.properties.dealname) === n); },
    async contactsByPhone() { return []; },
    async dealStageLabels() { return {}; },
  };
}

function stubClaude(dealId) {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return {
      ok: true,
      json: async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ deal_id: dealId, confidence: "high", reason: "Peru trip" }) }],
      }),
    };
  };
  return () => calls;
}

test("full flow: each case lands where expected", async () => {
  const claudeCalls = stubClaude("5");
  const run = (contact, body, callDeals) => matchCall(fakeHubspot(contact, callDeals), "key", "c1", { hs_call_body: body });

  let r = await run("A", "Re booking 1529953");
  assert.strictEqual(r.outcome, "preview");
  assert.strictEqual(r.dealId, "1");

  r = await run("A", "Re booking 1600001");
  assert.strictEqual(r.outcome, "skipped");
  assert.match(r.note, /not on the caller's deals/);

  r = await run("A", "About my Iceland trip");
  assert.match(r.note, /2 open deals/);

  r = await run("A", "anything", ["1"]);
  assert.match(r.note, /already linked/);

  assert.strictEqual(claudeCalls(), 0);
  r = await run("B", "About my Peru trip");
  assert.strictEqual(r.dealId, "5");
  assert.match(r.note, /Claude read the summary/);
  assert.strictEqual(claudeCalls(), 1);
});

test("Claude can't pick a deal outside the caller's list", async () => {
  stubClaude("9");
  const r = await matchCall(fakeHubspot("B"), "key", "c1", { hs_call_body: "About my trip" });
  assert.strictEqual(r.outcome, "skipped");
});
