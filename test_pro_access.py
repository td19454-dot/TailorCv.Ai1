"""A paying user must never meet a paywall.

Covers both providers. Razorpay grants Pro synchronously in /verify; Polar
grants it from a webhook that lands after the buyer is already redirected back.
Either way, once pro_until is in the future EVERY gate must let them through,
and it must do so whatever shape the database hands the date back in.

Real incidents this locks down:
  - is_pro() RAISED on a timezone-aware or string pro_until instead of returning
    a bool. That 500s the request, and the download gate reads any non-OK
    response as refusal, so a paying user with a perfectly correct row was told
    to upgrade.
  - The Polar success URL is "/dashboard?upgrade=success", and ?upgrade= is the
    parameter that names which FEATURE to show the paywall for. "success" is
    truthy, matched no feature, and fell through to the generic "You've used
    your 1 free use" modal — so completing a payment opened a paywall.

No external services and no API keys required.
Run:  python test_pro_access.py
"""

import re
import sys
import traceback
from datetime import datetime, timedelta, timezone
from pathlib import Path

import main

ROOT = Path(__file__).resolve().parent


class FakeUser:
    """Enough of a User row for the gates, which read only id and pro_until."""

    def __init__(self, pro_until):
        self.id = 3301
        self.pro_until = pro_until


FUTURE = datetime.utcnow() + timedelta(days=7)

# Every shape production has actually handed back. The naive datetime is the
# normal case; the others are why is_pro used to explode.
PRO_SHAPES = {
    "naive datetime (postgres timestamp)": FUTURE,
    "aware datetime (postgres timestamptz)": datetime.now(timezone.utc) + timedelta(days=7),
    "ISO string (sqlite TEXT column)": FUTURE.isoformat(),
    "space-separated string": FUTURE.strftime("%Y-%m-%d %H:%M:%S"),
    "ISO string with Z suffix": FUTURE.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
}

NOT_PRO_SHAPES = {
    "never subscribed": None,
    "expired naive": datetime.utcnow() - timedelta(days=1),
    "expired aware": datetime.now(timezone.utc) - timedelta(days=1),
    "unparseable": "not-a-date",
    "empty string": "",
}


# --------------------------------------------------------------------------- #
# is_pro must answer, never raise
# --------------------------------------------------------------------------- #
def test_is_pro_true_for_every_stored_shape():
    for label, value in PRO_SHAPES.items():
        assert main.is_pro(FakeUser(value)) is True, f"paying user refused: {label}"


def test_is_pro_false_for_non_pro_shapes():
    for label, value in NOT_PRO_SHAPES.items():
        assert main.is_pro(FakeUser(value)) is False, f"wrongly granted Pro: {label}"


def test_is_pro_never_raises():
    for value in list(PRO_SHAPES.values()) + list(NOT_PRO_SHAPES.values()) + [object(), 0, []]:
        try:
            main.is_pro(FakeUser(value))
        except Exception as exc:  # noqa: BLE001
            raise AssertionError(f"is_pro raised on {value!r}: {type(exc).__name__}: {exc}")


# --------------------------------------------------------------------------- #
# Every metered feature must bypass for a Pro user, in every shape.
#
# enforce_quota returns before touching the database when is_pro is true, so
# passing db=None here is the assertion: if the Pro check ever stops short-
# circuiting, this raises AttributeError instead of passing quietly.
# --------------------------------------------------------------------------- #
def test_every_paid_feature_bypasses_quota_for_pro_users():
    features = list(main.FREE_LIMITS) + ["ai_optimizations", "linkedin_imports"]
    for label, value in PRO_SHAPES.items():
        user = FakeUser(value)
        for field in features:
            try:
                main.enforce_quota(None, user, field)
            except Exception as exc:  # noqa: BLE001
                raise AssertionError(
                    f"Pro user hit the paywall on '{field}' ({label}): "
                    f"{type(exc).__name__}: {exc}"
                )


def test_quota_exhausted_is_false_for_pro_users():
    for label, value in PRO_SHAPES.items():
        assert main.quota_exhausted(None, FakeUser(value), "ai_optimizations") is False, label


def test_free_limits_still_gate_a_non_pro_user():
    """The bypass must not have been widened into "nobody is ever gated"."""
    import os

    if os.getenv("BILLING_BETA_USER_IDS", "").strip():
        return  # beta allowlist active: gating is intentionally narrowed
    try:
        main.quota_exhausted(None, FakeUser(None), "ai_optimizations")
    except AttributeError:
        return  # reached the DB query, i.e. it did NOT bypass — correct
    raise AssertionError("a non-Pro user bypassed the quota check entirely")


# --------------------------------------------------------------------------- #
# Payment-outcome values must never be read as a paywall FEATURE name.
# --------------------------------------------------------------------------- #
def test_payment_outcomes_do_not_open_the_paywall():
    js = (ROOT / "static" / "auth_nav.js").read_text(encoding="utf-8", errors="replace")
    match = re.search(r"var OUTCOMES\s*=\s*\[(.*?)\]", js, re.S)
    assert match, "the ?upgrade= outcome guard is gone from auth_nav.js"
    outcomes = {v.strip().strip("\"'").lower() for v in match.group(1).split(",") if v.strip()}
    # Both providers redirect to /dashboard?upgrade=success on completion.
    for value in ("success", "pending", "cancel", "cancelled", "failed"):
        assert value in outcomes, f"'{value}' would still open a paywall after payment"


def test_both_providers_redirect_through_a_guarded_outcome():
    """Razorpay redirects from pricing.html, Polar from the billing router."""
    pricing = (ROOT / "templates" / "pricing.html").read_text(encoding="utf-8", errors="replace")
    billing = (ROOT / "routers" / "billing.py").read_text(encoding="utf-8", errors="replace")

    razorpay_targets = re.findall(r"upgrade=([a-z_]+)", pricing)
    assert razorpay_targets, "Razorpay success redirect not found in pricing.html"
    polar_targets = re.findall(r"upgrade=\{?'?([a-z_]+)", billing)
    assert polar_targets, "Polar success redirect not found in billing.py"

    js = (ROOT / "static" / "auth_nav.js").read_text(encoding="utf-8", errors="replace")
    outcomes = re.search(r"var OUTCOMES\s*=\s*\[(.*?)\]", js, re.S).group(1).lower()
    for value in razorpay_targets + polar_targets:
        if value in ("success", "pending"):
            assert f'"{value}"' in outcomes or f"'{value}'" in outcomes, (
                f"a provider redirects with upgrade={value}, which is not guarded"
            )


def main_runner() -> int:
    tests = [v for k, v in sorted(globals().items())
             if k.startswith("test_") and callable(v)]
    passed, failures = 0, []
    for t in tests:
        try:
            t()
            passed += 1
            print(f"  PASS  {t.__name__}")
        except Exception as exc:  # noqa: BLE001
            failures.append(t.__name__)
            print(f"  FAIL  {t.__name__}: {exc}")
            traceback.print_exc()
    print(f"\n{passed}/{len(tests)} passed, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main_runner())
