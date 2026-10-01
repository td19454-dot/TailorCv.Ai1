"""Hand-rolled tests for analytics.py (no pytest, no API key, no network).

Run: python test_analytics.py
Uses an in-memory SQLite DB and a fake PostHog client.
"""
import os

os.environ["DATABASE_URL"] = "sqlite://"

from sqlalchemy.pool import StaticPool  # noqa: E402

import database  # noqa: E402

# One shared in-memory connection so every SessionLocal() sees the same tables.
database.engine.dispose()
database.engine = database.create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
database.SessionLocal.configure(bind=database.engine)

import models  # noqa: E402,F401
import analytics  # noqa: E402

database.Base.metadata.create_all(bind=database.engine)


class FakeClient:
    def __init__(self):
        self.calls = []

    def capture(self, event, **kw):
        self.calls.append((event, kw))

    def shutdown(self):
        pass


class FakeRequest:
    def __init__(self, headers):
        self.headers = headers


def fresh():
    fake = FakeClient()
    analytics._client = fake
    return fake


def test_noop_without_client():
    analytics._client = None
    assert analytics.track(1, "sign_up") is False


def test_distinct_id_is_string_user_id():
    fake = fresh()
    analytics.track(42, "sign_up", {"method": "email"})
    assert fake.calls[0][1]["distinct_id"] == "42"


def test_request_adds_country_and_device_only():
    fake = fresh()
    req = FakeRequest({"cf-ipcountry": "IN", "user-agent": "Mozilla/5.0 (iPhone) Mobile"})
    analytics.track(1, "pricing_viewed", {}, request=req)
    props = fake.calls[0][1]["properties"]
    assert props["country"] == "IN" and props["device"] == "mobile"
    assert set(props) == {"country", "device"}, props


def test_dedupe_key_blocks_second_event():
    fake = fresh()
    assert analytics.track(7, "payment_success", {"plan": "weekly"}, dedupe_key="payment:razorpay:pay_1") is True
    assert analytics.track(7, "payment_success", {"plan": "weekly"}, dedupe_key="payment:razorpay:pay_1") is False
    assert len(fake.calls) == 1


def test_different_keys_both_fire():
    fake = fresh()
    analytics.track(7, "payment_success", {}, dedupe_key="payment:razorpay:pay_2")
    analytics.track(7, "payment_success", {}, dedupe_key="payment:razorpay:pay_3")
    assert len(fake.calls) == 2


def test_optimization_count_and_is_repeat():
    fake = fresh()
    analytics.track_optimization_completed(9, None, {"source": "web"})
    analytics.track_optimization_completed(9, None, {"source": "web"})
    first, second = (c[1]["properties"] for c in fake.calls)
    assert (first["optimization_count"], first["is_repeat"]) == (1, False)
    assert (second["optimization_count"], second["is_repeat"]) == (2, True)


def test_error_category_never_leaks_message():
    assert analytics.error_category(RuntimeError("secret resume text"), "ai") == "ai_error"
    assert analytics.error_category(RuntimeError("x"), "render") == "render"
    assert analytics.error_category(TimeoutError(), "ai") == "timeout"
    assert analytics.error_category(RuntimeError("x"), "whatever") == "unknown"


def test_track_never_raises():
    class Boom:
        def capture(self, *a, **k):
            raise RuntimeError("network down")

    analytics._client = Boom()
    assert analytics.track(1, "sign_up") is False


tests = [
    test_noop_without_client,
    test_distinct_id_is_string_user_id,
    test_request_adds_country_and_device_only,
    test_dedupe_key_blocks_second_event,
    test_different_keys_both_fire,
    test_optimization_count_and_is_repeat,
    test_error_category_never_leaks_message,
    test_track_never_raises,
]

if __name__ == "__main__":
    failed = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"FAIL {t.__name__}: {exc!r}")
    raise SystemExit(1 if failed else 0)
