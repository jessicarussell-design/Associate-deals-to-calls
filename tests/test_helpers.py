from datetime import datetime

from associate_calls import (
    TIMEZONE,
    booking_numbers,
    customer_number,
    deal_booking_number,
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
