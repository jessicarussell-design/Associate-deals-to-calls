// HubSpot workflow custom code action: link a call to the right deal(s).
//
// Replaces HubSpot's default "link to the 5 most recent open deals".
// Workflow: call-based, trigger "call created" -> delay 30 min -> this action.
// Runs entirely in HubSpot: no outside services.
//
// Secret (Workflow > custom code > Secrets):
//   HUBSPOT_TOKEN  private app token with crm.objects.contacts.read/write,
//                  crm.objects.deals.read/write (calls use the contacts scopes)
//
// Output fields (add them all as "String" in the action):
//   result           linked | guessed (linked on a best guess) | no_match | no_deal | skipped | error
//                    (dry run: would_link / would_guess)
//   call_type        booking | sales | attempt | mixed | unknown | none
//   linked_deal_ids  comma-separated deal ids that were linked
//   reason           one line explaining the decision

const DRY_RUN = true; // true: decide and report only, link nothing. Set false to go live.

const PIPE = {
  TOUR: '3952990',
  CRUISE: '119709005',
  PROSPECTING: '34914410',
  TAILOR_MADE: '779110774',
};
const BOOKING_PIPES = [PIPE.TOUR, PIPE.CRUISE];
const SALES_PIPES = [PIPE.PROSPECTING, PIPE.TAILOR_MADE];
const SALES_WON_STAGES = ['76188161', '1138366822'];
const SALES_LOST_STAGES = ['76188162', '1138366823'];
// Booking stages: Tour "Booking Cancelled" / Cruise "Cancelled", and Tour
// "Cancellation Pending" / Cruise "Amendment/Cancel Pending".
const CANCELLED_STAGES = ['13222454', '211325816'];
const CANCEL_PENDING_STAGES = ['15879201', '218944675'];

const DAYS_AFTER_DEPARTURE = 90;
const DAYS_SINCE_WON = 2;
// Bookings created up to this long after a sales call count as made on the call.
// Keep it no longer than the workflow's delay before this action runs.
const FRESH_BOOKING_MINUTES = 30;

// Aircall tags. Any tag not listed here is ignored when deciding the call type
// (agency/brand tags, Follow Up, Called Back, Local Presence, Miscellaneous, ...).
const BOOKING_TAGS = [
  'Sales (existing booking question/s)', 'Sales (cancellation request)', 'Sales (day 2 call)',
  'Sales (transfer to CS)', 'On Tour', 'Cancellations', 'Date/Name Change',
  'Invoice or Payment Query', 'Credit Enquiry/Rebooking', 'Date UA or Consolidation',
  'Transfers', 'Pre Departure Check', 'Post Tour feedback', 'CS MEL - Escalations',
  'CJ- Post docs call', 'Traveller Hub', 'Operations Outbound', 'Cruises - Existing Travel docs',
];
const BOOKING_TAG_PREFIXES = ['Flights -', 'Documents -', 'General -', 'Cruise - Existing'];
const SALES_TAGS = [
  'Sales (initial consult)', 'Sales (follow up consult)', 'Sales (callback request)',
  'Sales (event queries)', 'Sales (transfer to sales agent)', 'Sales (CS team)',
  'Sales (Closed won 1st call)', 'Sales (Closed won - Follow up)', 'Sales (outbound lead - not interested)',
  'Tailormade', 'General - Destination Queries', 'Cruise - New Enquiry - FSC',
  'Cruise - New Enquiry Follow up', 'Cruise - Events', 'Travelzoo',
];
// Calls that didn't connect: linked by the caller's team (see callerSide).
const ATTEMPT_TAGS = ['Sales (no answer/voicemail)', 'Sales (NA)', 'Cruise - VM/no answer', 'Cruise - NA', 'Voicemail Drop'];
// Not customer calls.
const NO_DEAL_TAGS = ['Supplier', 'Cruise - Supplier', 'Partnerships', 'B2B outbound', 'TEST'];
// HubSpot teams of the person who made or took the call (the call's hubspot_team_id).
const SALES_TEAM_IDS = [
  '6518282', '13171973', '36883468', '42931633', '51990430', '78191667', '35979300', '62962791',
  '49791378', '37169413', '49788896', '49301706', '44925751',
]; // Sales General AU/CA/India, TA, Cruise, Away teams, TLS & Events, Sales, Tailor-made, Events
const BOOKING_TEAM_IDS = [
  '66975016', '78191641', '8282717', '12941658', '6518338', '49791426', '49791483', '6518319',
  '49791363', '76778770', '7057642', '76122688', '76007309', '84450698', '47151248', '47151266',
  '49788928', '48572437',
]; // Admin Coordinators (check-in calls), Manila/MEL CS, Flights, Operations, MNL Ops, Cruise Leader

// Which side of the business made or took the call: the team, or for missed
// calls (no team) the Aircall line the customer rang.
function callerSide(teamId, body) {
  const team = String(teamId || '');
  if (SALES_TEAM_IDS.includes(team)) return 'sales';
  if (BOOKING_TEAM_IDS.includes(team)) return 'booking';
  const line = ((body || '').match(/(?:on|via) <strong>(.*?)<\/strong>/) || [])[1] || '';
  if (/Existing Bookings|On Tour|Emergency/i.test(line)) return 'booking';
  if (/Sales|Cruises enquiries|Tailor-made|TravelZoo|DELACON/i.test(line)) return 'sales';
  return null;
}

const CANCELLATION_TAGS = ['Cancellations', 'Sales (cancellation request)', 'Credit Enquiry/Rebooking'];
const WON_TAGS = ['Sales (Closed won 1st call)', 'Sales (Closed won - Follow up)'];

// Words in tour and deal names that say nothing about which trip it is.
const GENERIC_WORDS = new Set(`
  day days night nights tour tours trip trips small group private premium deluxe adventure adventures
  discovery discover explorer explore rail train by the and of with to in on at for a an extension
  uncovered highlights complete grand journey journeys classic ultimate essential essentials best
  magical wonders secrets lights follow including incl new lead leads online showcase webinar event
  expo booking flight flights package self guided escorted luxury signature edition
  inspiring vacations vacation holiday holidays
  january february march april may june july august september october november december
  jan feb mar apr jun jul aug sep sept oct nov dec mon tue wed thu fri sat sun
`.trim().split(/\s+/));

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];

const DEAL_PROPS = [
  'dealname', 'pipeline', 'dealstage', 'booking_id', 'booking_status', 'tour_name',
  'departure_date', 'createdate', 'closedate', 'hubspot_owner_id',
  ...[...CANCELLED_STAGES, ...CANCEL_PENDING_STAGES].map(s => `hs_v2_date_entered_${s}`),
];

// ---------- parsing the call ----------

function stripHtml(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function sectionText(body, id) {
  const m = (body || '').match(new RegExp(`<div id="${id}">([\\s\\S]*?)</div>`));
  return m ? stripHtml(m[1]).replace(/^[^:]*:\s*/, '') : '';
}

function parseCallBody(body) {
  const tagText = sectionText(body, 'aircall-tags');
  const tags = tagText ? tagText.split(';').map(t => t.trim()).filter(Boolean) : [];
  const summary = sectionText(body, 'aircall-call-summary');
  const topics = sectionText(body, 'aircall-call-key-topics');
  // Calls logged by hand (no Aircall sections) keep whatever the agent typed.
  const isAircall = /aircall-call-id|assets\.aircall\.io/.test(body || '');
  const notes = isAircall ? '' : stripHtml(body);
  return { tags, summary, topics, notes };
}

function classifyTags(tags) {
  const isBooking = t => BOOKING_TAGS.includes(t)
    || (BOOKING_TAG_PREFIXES.some(p => t.startsWith(p)) && t !== 'General - Destination Queries');
  const booking = tags.some(isBooking);
  const sales = tags.some(t => SALES_TAGS.includes(t));
  if (booking && sales) return 'mixed';
  if (booking) return 'booking';
  if (sales) return 'sales';
  if (tags.some(t => ATTEMPT_TAGS.includes(t))) return 'attempt';
  if (tags.some(t => NO_DEAL_TAGS.includes(t))) return 'none';
  return 'unknown';
}

// 7-digit booking ids, allowing one space ("1523 549"). Six-digit order ids are ignored.
function bookingIdsIn(text) {
  const found = new Set();
  for (const m of (text || '').matchAll(/\b\d{3,4} ?\d{3,4}\b/g)) {
    const id = m[0].replace(' ', '');
    if (id.length === 7) found.add(id);
  }
  return [...found].slice(0, 5);
}

// ---------- choosing candidate deals ----------

const DAY = 24 * 60 * 60 * 1000;
// "Cancellation Pending" isn't cancelled yet: the booking is still live.
const isCancelPending = d => CANCEL_PENDING_STAGES.includes(d.properties.dealstage)
  || /cancel.*pending/i.test(d.properties.booking_status || '');
const isCancelled = d => !isCancelPending(d)
  && (CANCELLED_STAGES.includes(d.properties.dealstage) || /cancel/i.test(d.properties.booking_status || ''));
// When a booking was cancelled (or its cancellation requested), for picking the most recent.
function cancelledAt(deal) {
  const p = deal.properties;
  const entered = [...CANCELLED_STAGES, ...CANCEL_PENDING_STAGES]
    .map(s => Date.parse(p[`hs_v2_date_entered_${s}`] || ''))
    .filter(t => !Number.isNaN(t));
  return entered.length ? Math.max(...entered) : (Date.parse(p.closedate || p.createdate || '') || 0);
}

function isBookingCandidate(deal, callTime) {
  const p = deal.properties;
  if (!BOOKING_PIPES.includes(p.pipeline)) return false;
  if (!p.departure_date) return true;
  return Date.parse(p.departure_date) >= callTime - DAYS_AFTER_DEPARTURE * DAY;
}

function isSalesCandidate(deal, callTime) {
  const p = deal.properties;
  if (!SALES_PIPES.includes(p.pipeline)) return false;
  if (SALES_LOST_STAGES.includes(p.dealstage)) return false;
  if (SALES_WON_STAGES.includes(p.dealstage)) {
    return Boolean(p.closedate) && Math.abs(Date.parse(p.closedate) - callTime) <= DAYS_SINCE_WON * DAY;
  }
  return true;
}

// ---------- matching the call's words to deals ----------

function words(text, extraIgnore) {
  return new Set((text || '').toLowerCase().split(/[^a-z]+/)
    .filter(w => w.length >= 3 && !GENERIC_WORDS.has(w) && !extraIgnore.has(w)));
}

function dealWords(deal, ignore) {
  const p = deal.properties;
  return words(p.tour_name || p.dealname, ignore);
}

// Departure date said on the call: "October 8", "8th October", "Oct 8", "08/10", "10/08".
function mentionsDepartureDay(text, isoDate) {
  if (!isoDate) return false;
  const [, mm, dd] = isoDate.split('-').map(Number);
  const mon = MONTHS[mm - 1];
  const m = `${mon.slice(0, 3)}(?:${mon.slice(3)})?`;
  const d = `0?${dd}(?:st|nd|rd|th)?`;
  const re = new RegExp(`\\b(?:${d}\\s+(?:of\\s+)?${m}|${m}\\s+${d})\\b|\\b0?${dd}/0?${mm}\\b|\\b0?${mm}/0?${dd}\\b`, 'i');
  return re.test(text);
}

// Month alone counts only when capitalised, so "may" the verb doesn't match May.
function mentionsDepartureMonth(text, isoDate) {
  if (!isoDate) return false;
  const mon = MONTHS[Number(isoDate.split('-')[1]) - 1];
  return new RegExp(`\\b${mon[0].toUpperCase()}${mon.slice(1)}\\b`).test(text);
}

function scoreDeal(deal, text, textWords, ignore) {
  const matched = [...dealWords(deal, ignore)].filter(w => textWords.has(w));
  const dayHit = mentionsDepartureDay(text, deal.properties.departure_date);
  let score = matched.length;
  if (dayHit) score += 3;
  else if (score && mentionsDepartureMonth(text, deal.properties.departure_date)) score += 1;
  return { deal, score, dayHit, matched: matched.sort().join(' ') };
}

// Deals the call talks about, by tour/destination words and departure date.
// Several different trips can all be picked ("Morocco and Egypt"). Deals picked
// on exactly the same words (two Japan tours, "Japan" said) are narrowed to one
// by `chooseOne`, unless they're the same trip on the same date (linked together).
function matchByText(candidates, text, ignore, chooseOne) {
  const textWords = words(text, ignore);
  let scored = candidates.map(d => scoreDeal(d, text, textWords, ignore)).filter(s => s.score > 0);
  if (!scored.length) return [];
  // An exact departure date said on the call outranks everything else.
  if (scored.some(s => s.dayHit)) scored = scored.filter(s => s.dayHit);
  const strong = scored.filter(s => s.score >= 2);
  const max = Math.max(...scored.map(s => s.score));
  const picked = strong.length ? strong : scored.filter(s => s.score === max);

  const byWords = new Map();
  for (const s of picked) byWords.set(s.matched, [...(byWords.get(s.matched) || []), s.deal]);
  return [...byWords.values()].flatMap(group => {
    const sameTrip = new Set(group.map(d => `${d.properties.tour_name}|${d.properties.departure_date}`)).size === 1;
    return sameTrip ? group : [chooseOne(group)];
  });
}

const dep = d => Date.parse(d.properties.departure_date || '') || NaN;

// Best single booking when the call doesn't say which: an active booking first,
// then one with a cancellation pending (unless the call is about a cancellation,
// when both count alike). Among those: the next to depart, else the most
// recently departed; on-tour and post-tour calls take the trip that has already
// departed. With only cancelled bookings: the most recently cancelled.
function bestBooking(bookings, ctx) {
  const live = bookings.filter(d => !isCancelled(d));
  if (!live.length) return [...bookings].sort((a, b) => cancelledAt(b) - cancelledAt(a))[0];
  const active = live.filter(d => !isCancelPending(d));
  const pool = active.length && !ctx.aboutCancellation ? active : live;
  const departed = pool.filter(d => dep(d) <= ctx.callTime).sort((a, b) => dep(b) - dep(a));
  const upcoming = pool.filter(d => !(dep(d) <= ctx.callTime)).sort((a, b) => (dep(a) || Infinity) - (dep(b) || Infinity));
  const onOrAfterTour = ctx.tags.some(t => t === 'On Tour' || t === 'Post Tour feedback');
  if (onOrAfterTour && departed.length) return departed[0];
  return upcoming[0] || departed[0];
}

// Best single enquiry: the caller's own, newest first; otherwise the newest.
function bestEnquiry(enquiries, ctx) {
  const newestFirst = (a, b) => Date.parse(b.properties.createdate) - Date.parse(a.properties.createdate);
  const own = enquiries.filter(d => d.properties.hubspot_owner_id === ctx.ownerId).sort(newestFirst);
  return own[0] || [...enquiries].sort(newestFirst)[0];
}

// Cancelled + rebooked same tour: keep only the live booking, unless the call is
// about the cancellation itself.
function dropReplacedCancellations(deals, aboutCancellation) {
  if (aboutCancellation) return deals;
  const liveTours = new Set(deals.filter(d => !isCancelled(d)).map(d => (d.properties.tour_name || '').trim()));
  return deals.filter(d => !isCancelled(d) || !liveTours.has((d.properties.tour_name || '').trim()));
}

// ---------- the decision ----------

function pickBookings(bookings, ctx) {
  if (!bookings.length) return { ids: [], why: 'no bookings' };

  const quoted = bookings.filter(d => ctx.quotedIds.includes(d.properties.booking_id));
  if (quoted.length) return { ids: quoted.map(d => d.id), why: 'booking id said on the call' };

  let picked = matchByText(dropReplacedCancellations(bookings, ctx.aboutCancellation), ctx.text, ctx.ignore,
    group => bestBooking(group, ctx));
  // Sales calls often discuss a new trip to a place the customer has booked
  // before, so there only an exact departure date counts.
  if (ctx.dateOnly) picked = picked.filter(d => mentionsDepartureDay(ctx.text, d.properties.departure_date));
  if (picked.length) return { ids: picked.map(d => d.id), why: 'tour name/date said on the call' };

  // Nothing said that identifies a booking. Untagged calls stop here; booking
  // calls take the best guess.
  if (!ctx.guess) return { ids: [], why: 'nothing on the call names a booking' };
  const live = bookings.filter(d => !isCancelled(d));
  if (!live.length && !ctx.aboutCancellation) return { ids: [], why: 'only cancelled bookings' };
  const best = bestBooking(bookings, ctx);
  const active = live.filter(d => !isCancelPending(d));
  let why = 'best guess: next/current trip';
  if (active.length === 1 && best === active[0]) why = 'only one live booking';
  else if (isCancelPending(best)) why = 'best guess: most recent booking (cancellation pending)';
  else if (!live.length) why = 'best guess: most recently cancelled booking';
  return { ids: [best.id], why };
}

function pickEnquiries(enquiries, ctx) {
  if (!enquiries.length) return { ids: [], why: 'no open enquiries' };
  if (enquiries.length === 1 && ctx.guess) return { ids: [enquiries[0].id], why: 'only one open enquiry' };

  const picked = matchByText(enquiries, ctx.text, ctx.ignore, group => bestEnquiry(group, ctx));
  if (picked.length) return { ids: picked.map(d => d.id), why: 'destination said on the call' };

  if (!ctx.guess) return { ids: [], why: 'nothing on the call names an enquiry' };
  const best = bestEnquiry(enquiries, ctx);
  const own = best.properties.hubspot_owner_id === ctx.ownerId;
  return { ids: [best.id], why: own ? "best guess: caller's newest enquiry" : 'best guess: newest enquiry' };
}

// Pure decision from the call and the contact's deals (no API calls), so it can be tested.
function decideFromData({ body, callTime, ownerId, teamId, deals, contactNames }) {
  const parsed = parseCallBody(body);
  const text = [parsed.summary, parsed.topics, parsed.notes].filter(Boolean).join(' ');
  let callType = classifyTags(parsed.tags);
  if (callType === 'unknown' && !text) callType = 'attempt'; // nothing logged: treat as an attempt

  if (callType === 'none') return { result: 'no_deal', callType, ids: [], reason: `Not a customer call: ${parsed.tags.join('; ')}` };

  const ctx = {
    text,
    tags: parsed.tags,
    callTime,
    ownerId,
    ignore: new Set((contactNames || []).map(n => n.toLowerCase())),
    quotedIds: bookingIdsIn(text),
    aboutCancellation: parsed.tags.some(t => CANCELLATION_TAGS.includes(t)) || /\b(cancel|refund|credit)/i.test(text),
    // Tagged calls take a best guess when nothing on the call names a deal;
    // untagged calls only link deals the call actually names.
    guess: callType !== 'unknown',
  };

  const bookings = deals.filter(d => isBookingCandidate(d, callTime));
  const enquiries = deals.filter(d => isSalesCandidate(d, callTime));
  const ids = new Set();
  const why = [];

  if (['booking', 'mixed', 'unknown'].includes(callType)) {
    const r = pickBookings(bookings, ctx);
    r.ids.forEach(id => ids.add(id));
    why.push(`booking: ${r.why}`);
  }
  if (callType === 'sales') {
    // Sales agents also take calls about existing bookings. A booking the call
    // names wins over an enquiry it doesn't name; with no open enquiry at all,
    // fall back to the booking rules.
    const named = pickBookings(bookings, { ...ctx, guess: false, dateOnly: true });
    const r = pickEnquiries(enquiries, ctx);
    const enquiryNamed = r.why === 'destination said on the call' || ctx.tags.some(t => WON_TAGS.includes(t));
    if (named.ids.length) {
      named.ids.forEach(id => ids.add(id));
      why.push(`booking: ${named.why}`);
    }
    if (!named.ids.length || enquiryNamed) {
      r.ids.forEach(id => ids.add(id));
      why.push(`sales: ${r.why}`);
    }
    // An initial consult is about a new trip, so it never falls back to an old booking.
    if (!ids.size && !enquiries.length && !ctx.tags.includes('Sales (initial consult)')) {
      const b = pickBookings(bookings, ctx);
      b.ids.forEach(id => ids.add(id));
      why.push(`booking: ${b.why}`);
    }
  }
  if (['mixed', 'unknown'].includes(callType)) {
    const r = pickEnquiries(enquiries, ctx);
    r.ids.forEach(id => ids.add(id));
    why.push(`sales: ${r.why}`);
  }
  // Attempts and calls with nothing logged: go by who made or took the call.
  // Sales -> their open enquiry (else the live booking); CS, ops, flights and
  // admin coordinators (check-in calls) -> the live booking. Untagged calls
  // with a summary don't get this: they're mostly airline hold lines.
  if (callType === 'attempt') {
    const side = callerSide(teamId, body);
    const live = bookings.filter(d => !isCancelled(d));
    let pick = null;
    if (side === 'sales') pick = enquiries.length ? bestEnquiry(enquiries, ctx) : (live.length ? bestBooking(live, ctx) : null);
    if (side === 'booking' && live.length) pick = bestBooking(live, ctx);
    if (pick) ids.add(pick.id);
    why.push(pick ? `best guess: ${side} team fallback` : `no fallback (${side || 'unknown'} team)`);
  }
  // A booking made on this call: also link the new booking. Without a "Closed
  // won" tag, only bookings created during or just after the call count.
  const won = ctx.tags.some(t => WON_TAGS.includes(t));
  if (won || ['sales', 'mixed'].includes(callType)) {
    const fresh = bookings.filter(d => {
      const gap = Date.parse(d.properties.createdate) - callTime;
      return won ? Math.abs(gap) <= DAY : gap >= -15 * 60 * 1000 && gap <= FRESH_BOOKING_MINUTES * 60 * 1000;
    });
    fresh.forEach(d => ids.add(d.id));
    if (fresh.length) why.push('new booking from this call');
  }

  const reason = why.join('; ');
  if (ids.size) return { result: /best guess/.test(reason) ? 'guessed' : 'linked', callType, ids: [...ids], reason };
  return { result: 'no_match', callType, ids: [], reason };
}

// ---------- HubSpot API ----------

async function hs(path, options = {}) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.HAccessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`HubSpot ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json();
}

async function getCall(callId) {
  const props = 'hs_call_body,hs_timestamp,hubspot_owner_id,hubspot_team_id';
  return hs(`/crm/v3/objects/calls/${callId}?properties=${props}&associations=contacts`);
}

async function readBatch(objectType, ids, properties) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = await hs(`/crm/v3/objects/${objectType}/batch/read`, {
      method: 'POST',
      body: JSON.stringify({ properties, inputs: ids.slice(i, i + 100).map(id => ({ id })) }),
    });
    out.push(...batch.results);
  }
  return out;
}

async function getDealIdsForContacts(contactIds) {
  const ids = new Set();
  for (const contactId of contactIds) {
    let after;
    do {
      const page = await hs(`/crm/v4/objects/contacts/${contactId}/associations/deals?limit=500${after ? `&after=${after}` : ''}`);
      page.results.forEach(r => ids.add(String(r.toObjectId)));
      after = page.paging?.next?.after;
    } while (after);
  }
  return [...ids];
}

async function findBookingsById(bookingIds) {
  if (!bookingIds.length) return [];
  const res = await hs('/crm/v3/objects/deals/search', {
    method: 'POST',
    body: JSON.stringify({
      filterGroups: [{ filters: [
        { propertyName: 'booking_id', operator: 'IN', values: bookingIds },
        { propertyName: 'pipeline', operator: 'IN', values: BOOKING_PIPES },
      ] }],
      properties: DEAL_PROPS,
      limit: 20,
    }),
  });
  return res.results;
}

async function linkCallToDeal(callId, dealId) {
  await hs(`/crm/v4/objects/calls/${callId}/associations/default/deals/${dealId}`, { method: 'PUT' });
}

// ---------- main ----------

async function decide(callId) {
  const call = await getCall(callId);
  const contactIds = (call.associations?.contacts?.results || []).map(r => String(r.id)).slice(0, 3);
  if (!contactIds.length) return { result: 'skipped', callType: '', ids: [], reason: 'Call has no contact' };

  const contacts = await readBatch('contacts', contactIds, ['firstname', 'lastname']);
  const contactNames = contacts.flatMap(c => [c.properties.firstname, c.properties.lastname]).filter(Boolean);
  const deals = await readBatch('deals', await getDealIdsForContacts(contactIds), DEAL_PROPS);

  // Booking ids quoted on the call that are not on the contact (travel agents
  // call about their clients' bookings): look them up across the portal.
  const body = call.properties.hs_call_body || '';
  const known = new Set(deals.map(d => d.properties.booking_id).filter(Boolean));
  const missing = bookingIdsIn(stripHtml(body)).filter(id => !known.has(id));
  const extra = missing.length ? await findBookingsById(missing) : [];

  return decideFromData({
    body,
    callTime: Date.parse(call.properties.hs_timestamp),
    ownerId: call.properties.hubspot_owner_id,
    teamId: call.properties.hubspot_team_id,
    deals: deals.concat(extra),
    contactNames,
  });
}

exports.main = async (event, callback) => {
  const callId = event.object.objectId;
  try {
    const out = await decide(callId);
    if (!DRY_RUN) for (const dealId of out.ids) await linkCallToDeal(callId, dealId);
    callback({ outputFields: {
      result: DRY_RUN && out.ids.length ? `would_${out.result === 'guessed' ? 'guess' : 'link'}` : out.result,
      call_type: out.callType,
      linked_deal_ids: out.ids.join(','),
      reason: (out.reason || '').slice(0, 250),
    } });
  } catch (err) {
    console.error(err);
    callback({ outputFields: { result: 'error', call_type: '', linked_deal_ids: '', reason: String(err.message).slice(0, 250) } });
  }
};

// Used by test.js only; HubSpot ignores this.
exports._test = { parseCallBody, classifyTags, bookingIdsIn, decideFromData, mentionsDepartureDay };
