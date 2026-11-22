import os
from dataclasses import replace
from datetime import datetime, timedelta
from urllib.parse import parse_qs, urlparse

from jinja2 import UndefinedError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import database
from database import Base
from email_suppression import (
    make_unsubscribe_token, read_track_token, read_unsubscribe_campaign, read_unsubscribe_token,
)
from marketing import render as render_mod
from marketing.render import Campaign, build_campaign, inner_body, load_campaign, save_campaign
from marketing.segments import recipients
from marketing.sender import build_campaign_message, send_campaign
from models import (
    JobApplication, MarketingEvent, MarketingSend, Payment, Portfolio, ResumeOptimization, SavedResume, UsageRecord, User,
)
from quota_limits import FREE_LIMITS

NOW = datetime(2026, 10, 11, 12, 0, 0)
ENV = {
    "SES_SMTP_HOST": "email-smtp.us-east-1.amazonaws.com",
    "SES_SMTP_PORT": "587",
    "SES_SMTP_USERNAME": "smtp-user",
    "SES_SMTP_PASSWORD": "smtp-password",
    "EMAIL_FROM": "noreply@example.com",
    "APP_BASE_URL": "https://thetailorcv.com",
    "BILLING_BETA_USER_IDS": "",
}
SIMPLE = Campaign(
    name="test-campaign",
    subject="Hi {{ first_name }}",
    preheader="",
    body='{% extends "_base.html" %}{% block body %}<p>Hello {{ first_name }}</p>{% endblock %}',
)


class FakeSMTP:
    sent = []
    fail_for = set()

    def __init__(self, host, port, timeout=None):
        pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def starttls(self):
        pass

    def login(self, username, password):
        pass

    def send_message(self, message):
        if message["To"] in FakeSMTP.fail_for:
            raise OSError("connection refused")
        FakeSMTP.sent.append(message)


def _db():
    # StaticPool: one shared connection, so sessions made by the tracking routes
    # see the same in-memory database as the test.
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[
        User.__table__, UsageRecord.__table__, Payment.__table__, MarketingSend.__table__, MarketingEvent.__table__,
        SavedResume.__table__, ResumeOptimization.__table__, Portfolio.__table__, JobApplication.__table__,
    ])
    return sessionmaker(bind=engine)()


def _user(db, email, **fields):
    user = User(name=fields.pop("name", "Asha Rao"), email=email, hashed_password="x", **fields)
    db.add(user)
    db.commit()
    return user


def _pay(db, user, plan):
    db.add(Payment(user_id=user.id, provider="razorpay", payment_id=f"pay_{user.id}_{plan}",
                   plan=plan, currency="INR", amount=99, paid_at=NOW - timedelta(days=30)))
    db.commit()


def _emails(db, segment, **kwargs):
    kwargs.setdefault("campaign", "c1")
    kwargs.setdefault("now", NOW)
    return sorted(u.email for u in recipients(db, segment, **kwargs))


def _fixture():
    db = _db()
    # Far future: test_send_log_rerun_gap_and_failure also checks at the real
    # utcnow(), and a pro_until a few days past NOW turned paying users free.
    future, past = NOW + timedelta(days=3650), NOW - timedelta(days=3)
    _user(db, "free@x.com")
    monthly = _user(db, "monthly@x.com", pro_until=future, pro_plan="monthly")
    _pay(db, monthly, "monthly")
    weekly = _user(db, "weekly@x.com", pro_until=future, pro_plan="weekly")
    _pay(db, weekly, "weekly")
    expired = _user(db, "expired@x.com", pro_until=past, pro_plan="weekly")
    _pay(db, expired, "weekly")
    upgraded = _user(db, "upgraded@x.com", pro_until=past, pro_plan="monthly")
    _pay(db, upgraded, "weekly")
    _pay(db, upgraded, "monthly")
    capped = _user(db, "capped@x.com")
    db.add(UsageRecord(user_id=capped.id, month="2026-09",
                       ai_optimizations=FREE_LIMITS["ai_optimizations"] - 1))
    db.add(UsageRecord(user_id=capped.id, month="2026-10", ai_optimizations=1))
    under = _user(db, "under@x.com")
    db.add(UsageRecord(user_id=under.id, month="2026-10", ai_optimizations=1))
    _user(db, "optout@x.com", marketing_opt_out=True)
    _user(db, "bounced@x.com", email_bounced_at=past)
    db.commit()
    return db


def test_segments():
    db = _fixture()
    assert _emails(db, "all") == ["capped@x.com", "expired@x.com", "free@x.com", "monthly@x.com",
                                  "under@x.com", "upgraded@x.com", "weekly@x.com"]
    assert _emails(db, "free") == ["capped@x.com", "expired@x.com", "free@x.com", "under@x.com",
                                   "upgraded@x.com"]
    assert _emails(db, "paying") == ["monthly@x.com", "weekly@x.com"]
    assert _emails(db, "weekly_active") == ["weekly@x.com"]
    assert _emails(db, "weekly_expired") == ["expired@x.com"], "bought monthly later -> excluded"
    # Usage summed across months reaches the limit; one month alone doesn't.
    assert _emails(db, "upgrade_prompt") == ["capped@x.com"]
    assert _emails(db, "free", exclude=("upgrade_prompt", "weekly_expired")) == [
        "free@x.com", "under@x.com", "upgraded@x.com"]


def test_upgrade_prompt_respects_billing_beta():
    db = _fixture()
    os.environ["BILLING_BETA_USER_IDS"] = "99999"
    try:
        assert _emails(db, "upgrade_prompt") == []
    finally:
        os.environ["BILLING_BETA_USER_IDS"] = ""


def test_send_log_rerun_gap_and_failure():
    db = _fixture()
    FakeSMTP.sent = []
    FakeSMTP.fail_for = {"under@x.com"}
    users = recipients(db, "free", campaign="c1", now=NOW)
    result = send_campaign(db, replace(SIMPLE, name="c1"), users, "news@example.com", rate_per_second=1000,
                           smtp_factory=FakeSMTP, progress=lambda _: None)
    assert (result.sent, result.failed) == (4, 1)
    assert db.query(MarketingSend).count() == 4, "failed send must release its claim"

    # Rerun of the same campaign: only the failed one is left.
    FakeSMTP.fail_for = set()
    assert _emails(db, "free", campaign="c1") == ["under@x.com"]
    # A different campaign within the gap: everyone just mailed is held back.
    assert _emails(db, "free", campaign="c2", now=datetime.utcnow()) == ["under@x.com"]
    assert len(_emails(db, "free", campaign="c2", min_gap_days=0, now=datetime.utcnow())) == 5


def test_message_personalised_with_working_unsubscribe():
    db = _fixture()
    user = db.query(User).filter_by(email="free@x.com").one()
    message = build_campaign_message(SIMPLE, user, "news@example.com")
    assert message["Subject"] == "Hi Asha"
    assert message["From"] == "news@example.com"
    html = message.get_body(preferencelist=("html",)).get_content()
    assert "Hello Asha" in html and "free@x.com" in html
    header_url = message["List-Unsubscribe"].strip("<>")
    token = parse_qs(urlparse(header_url).query)["token"][0]
    assert read_unsubscribe_token(token) == user.id
    assert header_url in html.replace("&amp;", "&")
    assert message["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "Hello Asha" in message.get_body(preferencelist=("plain",)).get_content()


def test_template_typo_fails_loudly():
    db = _fixture()
    user = db.query(User).filter_by(email="free@x.com").one()
    broken = Campaign("broken", "Hi {{ frist_name }}", "", SIMPLE.body)
    try:
        build_campaign_message(broken, user, "news@example.com")
    except UndefinedError:
        return
    raise AssertionError("an undefined template variable must raise, not render blank")


def test_example_template_renders():
    db = _fixture()
    user = db.query(User).filter_by(email="free@x.com").one()
    message = build_campaign_message(load_campaign("example-announcement"), user, "news@example.com")
    assert message["Subject"] == "Asha, something new in TailorCV"
    assert "utm_campaign=example-announcement" in message.get_body(preferencelist=("html",)).get_content()


def test_retention_segments():
    db = _db()
    old, recent = NOW - timedelta(days=30), NOW - timedelta(days=3)
    _user(db, "ghost@x.com", created_at=old)                       # signed up, did nothing
    _user(db, "brandnew@x.com", created_at=NOW - timedelta(hours=5))  # too new to nag
    scanner = _user(db, "scanner@x.com", created_at=old)
    db.add(UsageRecord(user_id=scanner.id, month="2026-09", ats_scans=2))
    quiet = _user(db, "quiet@x.com", created_at=old, first_activity_at=old)
    db.add(SavedResume(user_id=quiet.id, created_at=old))
    db.add(UsageRecord(user_id=quiet.id, month="2026-09", ats_scans=1, ai_optimizations=1))
    active = _user(db, "active@x.com", created_at=old, first_activity_at=old)
    db.add(ResumeOptimization(user_id=active.id, token="t1", created_at=old))
    db.add(ResumeOptimization(user_id=active.id, token="t2", created_at=recent))
    # Used the product in ways other than scan/tailor: none of these is "never used".
    interviewer = _user(db, "interviewer@x.com", created_at=old)
    db.add(UsageRecord(user_id=interviewer.id, month="2026-09", mock_interviews=1))
    builder = _user(db, "builder@x.com", created_at=old)
    db.add(Portfolio(user_id=builder.id, slug="b", token="tok", data_json="{}"))
    _user(db, "profile@x.com", created_at=old, base_resume_path="uploads/x.pdf")
    _user(db, "pro@x.com", created_at=old, pro_until=old)  # Pro use is never counted
    db.commit()
    assert _emails(db, "never_used") == ["ghost@x.com"]
    assert _emails(db, "scanned_not_tailored") == ["scanner@x.com"]
    assert _emails(db, "tailored_gone_quiet") == ["quiet@x.com"], "a tailoring 3 days ago is not quiet"


def test_editor_campaign_roundtrip():
    original_dir = render_mod.TEMPLATES_DIR
    import tempfile, shutil
    tmp = tempfile.mkdtemp()
    try:
        shutil.copy(original_dir / "_base.html", tmp)
        render_mod.TEMPLATES_DIR = type(original_dir)(tmp)
        body = '<p>Hi {{ first_name }},</p>\n<p>Come back.</p>'
        campaign = build_campaign("come-back", "{{ first_name }}, quick one", "Preview text", body)
        save_campaign(campaign)
        loaded = load_campaign("come-back")
        assert (loaded.subject, loaded.preheader) == ("{{ first_name }}, quick one", "Preview text")
        assert inner_body(loaded) == body
        db = _fixture()
        user = db.query(User).filter_by(email="free@x.com").one()
        html = build_campaign_message(loaded, user, "n@example.com").get_body(preferencelist=("html",)).get_content()
        assert "Come back." in html and "Unsubscribe" in html, "editor body must get the footer"
    finally:
        render_mod.TEMPLATES_DIR = original_dir
        shutil.rmtree(tmp)
    for bad in [("Bad Name", "s", "", "x"), ("ok-name", "", "", "x"), ("ok-name", "a\nb", "", "x"),
                ("ok-name", "s", "", "{% endblock %}")]:
        try:
            build_campaign(*bad)
        except ValueError:
            continue
        raise AssertionError(f"build_campaign should reject {bad!r}")


def test_template_sandbox_blocks_python_internals():
    db = _fixture()
    user = db.query(User).filter_by(email="free@x.com").one()
    evil = build_campaign("evil", "hi", "", "{{ ''.__class__.__mro__[1].__subclasses__() }}")
    try:
        build_campaign_message(evil, user, "n@example.com")
    except Exception as exc:
        assert "unsafe" in str(exc).lower() or "__class__" in str(exc), exc
        return
    raise AssertionError("the sandbox must refuse access to Python internals")


def test_admin_router_is_local_only():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.marketing_admin import router

    app = FastAPI()
    app.include_router(router)
    # TestClient's client host is "testclient": not loopback, so 404.
    assert TestClient(app).get("/admin/email/api/campaigns/example-announcement").status_code == 404
    local = TestClient(app, client=("127.0.0.1", 50000))
    ok = local.get("/admin/email/api/campaigns/example-announcement", headers={"host": "localhost:8006"})
    assert ok.status_code == 200 and ok.json()["subject"] == "{{ first_name }}, something new in TailorCV"
    rebound = local.get("/admin/email/api/campaigns/example-announcement", headers={"host": "evil.example"})
    assert rebound.status_code == 404, "a non-localhost Host header (DNS rebinding) must be refused"
    os.environ["ENVIRONMENT"] = "production"
    try:
        assert local.get("/admin/email/api/campaigns/example-announcement",
                         headers={"host": "localhost"}).status_code == 404
    finally:
        os.environ.pop("ENVIRONMENT", None)


LINKED = Campaign(
    name="c-track",
    subject="Hi",
    preheader="",
    body='{% extends "_base.html" %}{% block body %}'
         '<a href="{{ base_url }}/ats-analysis?utm_source=email&utm_campaign={{ campaign }}">Scan</a>'
         '<a href="mailto:hi@x.com">Mail</a>{% endblock %}',
)


def _tokens(html, kind):
    import re
    return re.findall(rf'https://thetailorcv\.com/e/{kind}/([A-Za-z0-9_.\-]+?)(?:\.gif)?"', html)


def test_tracking_instrumentation():
    db = _fixture()
    user = db.query(User).filter_by(email="free@x.com").one()
    tracked = build_campaign_message(LINKED, user, "n@example.com", track=True)
    html = tracked.get_body(preferencelist=("html",)).get_content()

    clicks = _tokens(html, "c")
    assert len(clicks) == 1, "one http link rewritten; mailto and unsubscribe left alone"
    assert read_track_token(clicks[0]) == (
        "c-track", user.id, "https://thetailorcv.com/ats-analysis?utm_source=email&utm_campaign=c-track")
    opens = _tokens(html, "o")
    assert len(opens) == 1 and read_track_token(opens[0]) == ("c-track", user.id, "")
    assert 'href="mailto:hi@x.com"' in html

    unsub = tracked["List-Unsubscribe"].strip("<>")
    assert unsub in html.replace("&amp;", "&"), "unsubscribe link must not go through /e/c/"
    token = parse_qs(urlparse(unsub).query)["token"][0]
    assert (read_unsubscribe_token(token), read_unsubscribe_campaign(token)) == (user.id, "c-track")

    plain = build_campaign_message(LINKED, user, "n@example.com")
    plain_html = plain.get_body(preferencelist=("html",)).get_content()
    assert "/e/c/" not in plain_html and "/e/o/" not in plain_html, "test sends and previews are untracked"
    old = parse_qs(urlparse(plain["List-Unsubscribe"].strip("<>")).query)["token"][0]
    assert (read_unsubscribe_token(old), read_unsubscribe_campaign(old)) == (user.id, None)


def test_tracking_routes_record_events():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from routers.marketing import router

    db = _fixture()
    user = db.query(User).filter_by(email="free@x.com").one()
    other = db.query(User).filter_by(email="under@x.com").one()
    html = build_campaign_message(LINKED, user, "n@example.com", track=True).get_body(
        preferencelist=("html",)).get_content()
    click, pixel = _tokens(html, "c")[0], _tokens(html, "o")[0]

    original = database.SessionLocal
    database.SessionLocal = sessionmaker(bind=db.get_bind())
    try:
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app, follow_redirects=False)

        def events(kind=None):
            q = db.query(MarketingEvent)
            return q.filter_by(kind=kind).all() if kind else q.all()

        for _ in range(2):
            r = client.get(f"/e/o/{pixel}.gif")
            assert r.status_code == 200 and r.headers["content-type"] == "image/gif"
        assert len(events("open")) == 1, "repeat opens are counted once"

        r = client.get(f"/e/c/{click}")
        assert r.status_code == 302
        assert r.headers["location"] == "https://thetailorcv.com/ats-analysis?utm_source=email&utm_campaign=c-track"
        assert len(events("click")) == 1 and len(events("open")) == 1

        assert client.get("/e/o/forged.gif").status_code == 200, "a bad pixel token still returns an image"
        r = client.get("/e/c/forged")
        assert r.status_code == 302 and r.headers["location"] == "https://thetailorcv.com"
        assert len(events()) == 2

        unsub = make_unsubscribe_token(user.id, "c-track")
        assert client.get(f"/unsubscribe?token={unsub}").status_code == 200
        assert client.post(f"/unsubscribe?token={unsub}").status_code == 200
        assert len(events("unsubscribe")) == 1
        db.expire_all()
        assert user.marketing_opt_out

        assert client.get(f"/unsubscribe?token={make_unsubscribe_token(other.id)}").status_code == 200
        db.expire_all()
        assert other.marketing_opt_out and len(events("unsubscribe")) == 1, "old-style links opt out, unattributed"
    finally:
        database.SessionLocal = original


def test_stats():
    from routers.marketing_admin import campaign_links, campaign_stats

    db = _fixture()
    users = db.query(User).order_by(User.id).limit(4).all()
    for u in users:
        db.add(MarketingSend(campaign="new", user_id=u.id, sent_at=NOW))
    db.add(MarketingSend(campaign="old", user_id=users[0].id, sent_at=NOW - timedelta(days=30)))
    a, b, c = users[0].id, users[1].id, users[2].id
    db.add_all([
        MarketingEvent(campaign="new", user_id=a, kind="open"),
        MarketingEvent(campaign="new", user_id=b, kind="open"),
        MarketingEvent(campaign="new", user_id=a, kind="click", url="https://x/1"),
        MarketingEvent(campaign="new", user_id=a, kind="click", url="https://x/2"),
        MarketingEvent(campaign="new", user_id=c, kind="unsubscribe"),
    ])
    db.commit()

    new, old = campaign_stats(db)
    assert new["campaign"] == "new", "newest campaign first"
    assert (new["sent"], new["opens"], new["clicks"], new["unsubscribes"]) == (4, 2, 1, 1), \
        "a recipient clicking two links is one clicker"
    assert (new["open_rate"], new["ctr"], new["click_to_open"], new["unsub_rate"]) == (0.5, 0.25, 0.5, 0.25)
    assert new["tracked"] and not old["tracked"] and old["sent"] == 1
    assert sorted(l["url"] for l in campaign_links(db, "new")) == ["https://x/1", "https://x/2"]


if __name__ == "__main__":
    previous = {key: os.environ.get(key) for key in ENV}
    os.environ.update(ENV)
    try:
        test_segments()
        test_upgrade_prompt_respects_billing_beta()
        test_send_log_rerun_gap_and_failure()
        test_message_personalised_with_working_unsubscribe()
        test_template_typo_fails_loudly()
        test_example_template_renders()
        test_retention_segments()
        test_editor_campaign_roundtrip()
        test_template_sandbox_blocks_python_internals()
        test_admin_router_is_local_only()
        test_tracking_instrumentation()
        test_tracking_routes_record_events()
        test_stats()
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    print("test_marketing_email.py: ok")
