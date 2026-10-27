// Run with: node hubspot/test.js
const assert = require('node:assert');
const { decideFromData } = require('./associate_call.js')._test;

const body = '<div id="aircall-tags">Tags: Pre Departure Check</div>';
const callTime = Date.parse('2026-10-27T03:00:00Z');
const deal = (id, props) => ({ id, properties: { pipeline: '3952990', ...props } });

const cancelled = deal('55044028745', {
  dealstage: '13222454', booking_status: 'Cancelled', tour_name: ' 12 Day Essential Egypt with Nile Cruise',
  departure_date: '2027-03-15', createdate: '2026-01-30T08:39:54Z', closedate: '2026-02-03T05:47:37Z',
  hs_v2_date_entered_13222454: '2026-02-03T05:47:37Z',
});
const pending = deal('66184448141', {
  dealstage: '15879201', booking_status: 'Cancellation Pending', tour_name: ' 19 Day Essential Egypt & Jordan',
  departure_date: '2027-10-25', createdate: '2026-10-18T07:13:31Z', hs_v2_date_entered_15879201: '2026-10-25T08:25:59Z',
});
const active = deal('1', {
  dealstage: '16054545', booking_status: 'Confirmed', tour_name: ' 10 Day Japan', departure_date: '2027-12-01',
  createdate: '2026-09-01T00:00:00Z',
});

// Cancelled + cancellation pending: the pending one (more recent) wins.
let out = decideFromData({ body, callTime, deals: [cancelled, pending], contactNames: [] });
assert.deepStrictEqual(out.ids, ['66184448141']);
assert.strictEqual(out.result, 'guessed');

// An active booking still beats a cancellation pending one.
out = decideFromData({ body, callTime, deals: [cancelled, pending, active], contactNames: [] });
assert.deepStrictEqual(out.ids, ['1']);

// Two fully cancelled bookings on a cancellation call: the most recently cancelled.
const older = deal('2', { ...cancelled.properties, departure_date: '2027-01-01', hs_v2_date_entered_13222454: '2025-12-01T00:00:00Z' });
out = decideFromData({ body: '<div id="aircall-tags">Tags: Cancellations</div>', callTime, deals: [older, cancelled], contactNames: [] });
assert.deepStrictEqual(out.ids, ['55044028745']);

console.log('ok');
