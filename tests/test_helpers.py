from datetime import datetime

from associate_calls import (
    TIMEZONE,
    booking_numbers,
    customer_number,
    deal_booking_number,
    deal_line,
    match_booking,
    open_deal_count,
    phones_match,
    summary_text,
    yesterday_window,
)

BODY = (
    '<div><strong>Inbound answered call</strong> on <strong>[ IVR 2 ] Existing Bookings</strong></div>'
    '<div id="aircall-call-summary"><strong>Call Summary:</strong> Customer called about booking 1449977 '
    "(18-Day Essential South Africa), DOB 21/01/1945, phone 0403231778, paid $8,990.</div>"
    '<div id="aircall-call-id"><span><strong>Call ID:</strong> 4238394774</span></div>'
)


def test_summary_text_strips_html():
    text = summary_text(BODY)
    assert "<" not in text
    assert "booking 1449977" in text


def test_booking_numbers_ignores_call_id_phone_and_dates():
    assert booking_numbers(summary_text(BODY)) == {"1449977"}


def test_deal_booking_number():
    assert deal_booking_number("(1529953) 21 Day Follow the Lights to Iceland (2027-28)") == "1529953"
    assert deal_booking_number("Iceland enquiry") is None


def test_customer_number_by_direction():
    inbound = {"properties": {"hs_call_direction": "INBOUND", "hs_call_from_number": "+61407486491", "hs_call_to_number": "+61283115019"}}
    outbound = {"properties": {"hs_call_direction": "OUTBOUND", "hs_call_from_number": "+61283115019", "hs_call_to_number": "+61893686367"}}
    assert customer_number(inbound) == "+61407486491"
    assert customer_number(outbound) == "+61893686367"


def test_phones_match_across_formats():
    assert phones_match("+61 407 486 491", "0407486491")
    assert not phones_match("+61407486491", "+61407486492")
    assert not phones_match("", "0407486491")


def test_yesterday_window_is_full_melbourne_day():
    start, end = yesterday_window(datetime(2026, 10, 14, 6, 0, tzinfo=TIMEZONE))
    assert start == datetime(2026, 10, 13, tzinfo=TIMEZONE)
    assert (end - start).days == 1


def _deal(deal_id, name, closed=False, **props):
    return {"id": deal_id, "properties": {"dealname": name, "hs_is_closed": "true" if closed else "false", **props}}


ICELAND = _deal("1", "(1529953) 21 Day Follow the Lights to Iceland")
JAPAN = _deal("2", "(1449977) 14 Day Japan")
SOMEONE_ELSES = _deal("9", "(1600001) 18-Day Essential South Africa")


def test_booking_on_callers_deal_links():
    action, deal, _ = match_booking({"1": ICELAND}, {"1": ICELAND, "2": JAPAN}, caller_known=True)
    assert action == "link" and deal is ICELAND


def test_booking_on_someone_elses_deal_is_skipped():
    action, deal, note = match_booking({"9": SOMEONE_ELSES}, {"1": ICELAND}, caller_known=True)
    assert action == "skip" and deal is None
    assert "not on the caller's deals" in note


def test_booking_ignores_other_customers_deal_when_one_is_theirs():
    action, deal, _ = match_booking({"1": ICELAND, "9": SOMEONE_ELSES}, {"1": ICELAND}, caller_known=True)
    assert action == "link" and deal is ICELAND


def test_several_of_callers_bookings_go_to_claude():
    action, deal, _ = match_booking({"1": ICELAND, "2": JAPAN}, {"1": ICELAND, "2": JAPAN}, caller_known=True)
    assert action == "ask_claude" and deal is None


def test_unknown_caller_single_booking_links():
    action, deal, _ = match_booking({"9": SOMEONE_ELSES}, {}, caller_known=False)
    assert action == "link" and deal is SOMEONE_ELSES


def test_unknown_caller_several_bookings_is_skipped():
    action, _, _ = match_booking({"1": ICELAND, "9": SOMEONE_ELSES}, {}, caller_known=False)
    assert action == "skip"


def test_no_booking_goes_to_claude():
    assert match_booking({}, {"1": ICELAND}, caller_known=True)[0] == "ask_claude"


def test_open_deal_count():
    assert open_deal_count([ICELAND, JAPAN, _deal("3", "Old trip", closed=True)]) == 2


def test_deal_line_shows_stage_and_departure():
    deal = _deal("1", "(1529953) Iceland", dealstage="s1", departure_date="2027-02-14", createdate="2026-05-01T00:00:00Z")
    line = deal_line(deal, {"s1": "Bookings: Deposit paid"})
    assert "stage Bookings: Deposit paid" in line
    assert "departs 2027-02-14" in line


def test_deal_line_falls_back_to_preferred_date():
    deal = _deal("2", "Japan enquiry", preferred_departure_date="2027-04-01")
    assert "departs 2027-04-01" in deal_line(deal, {})
    assert "departs unknown" in deal_line(_deal("3", "No dates"), {})
