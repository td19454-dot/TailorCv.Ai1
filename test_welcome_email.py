import os
from datetime import datetime, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from database import Base
from models import User, WelcomeEmailLog
from welcome_email import mark_first_activity, send_due_welcome_emails

T0 = datetime(2026, 10, 1, 12, 0, 0)
ENV = {
    "SES_SMTP_HOST": "email-smtp.us-east-1.amazonaws.com",
    "SES_SMTP_PORT": "587",
    "SES_SMTP_USERNAME": "smtp-user",
    "SES_SMTP_PASSWORD": "smtp-password",
    "EMAIL_FROM": "noreply@example.com",
    "EMAIL_FROM_WELCOME": "support@example.com",
}


class FakeSMTP:
    sent = []
    fail = False

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
        if FakeSMTP.fail:
            raise OSError("connection refused")
        FakeSMTP.sent.append(message)


def _session_factory():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[User.__table__, WelcomeEmailLog.__table__])
    return sessionmaker(bind=engine)


def _add_user(factory, email, created_at=T0, **fields):
    db = factory()
    user = User(name="Test", email=email, hashed_password="x", created_at=created_at, **fields)
    db.add(user)
    db.commit()
    uid = user.id
    db.close()
    return uid


def _tick(factory, now):
    db = factory()
    try:
        return send_due_welcome_emails(db, now=now, smtp_factory=FakeSMTP)
    finally:
        db.close()


def _first_activity(factory, uid):
    db = factory()
    try:
        return db.get(User, uid).first_activity_at
    finally:
        db.close()


def test_sent_24h_after_first_activity_from_welcome_address():
    factory = _session_factory()
    uid = _add_user(factory, "new@example.com")
    mark_first_activity(uid, session_factory=factory, now=T0)
    mark_first_activity(uid, session_factory=factory, now=T0 + timedelta(hours=5))
    assert _first_activity(factory, uid) == T0, "second activity must not move the stamp"

    assert _tick(factory, T0 + timedelta(hours=23)) == 0
    assert _tick(factory, T0 + timedelta(hours=24)) == 1
    assert FakeSMTP.sent[-1]["To"] == "new@example.com"
    assert FakeSMTP.sent[-1]["From"] == "support@example.com"
    assert _tick(factory, T0 + timedelta(hours=48)) == 0, "only ever one email"


def test_pre_feature_user_never_stamped_or_emailed():
    factory = _session_factory()
    uid = _add_user(factory, "old@example.com", created_at=None)
    db = factory()
    db.query(User).filter(User.id == uid).update({User.created_at: None})
    db.commit()
    db.close()
    mark_first_activity(uid, session_factory=factory, now=T0)
    assert _first_activity(factory, uid) is None
    assert _tick(factory, T0 + timedelta(days=30)) == 0


def test_user_with_no_activity_gets_nothing():
    factory = _session_factory()
    _add_user(factory, "idle@example.com")
    assert _tick(factory, T0 + timedelta(days=30)) == 0


def test_bounced_user_skipped():
    factory = _session_factory()
    uid = _add_user(factory, "bounced@example.com", email_bounced_at=T0)
    mark_first_activity(uid, session_factory=factory, now=T0)
    assert _tick(factory, T0 + timedelta(days=2)) == 0


def test_failed_send_releases_claim_and_retries():
    factory = _session_factory()
    uid = _add_user(factory, "retry@example.com")
    mark_first_activity(uid, session_factory=factory, now=T0)
    FakeSMTP.fail = True
    try:
        assert _tick(factory, T0 + timedelta(hours=25)) == 0
    finally:
        FakeSMTP.fail = False
    db = factory()
    assert db.query(WelcomeEmailLog).count() == 0, "failed send must not leave a claim"
    db.close()
    assert _tick(factory, T0 + timedelta(hours=26)) == 1


if __name__ == "__main__":
    previous = {key: os.environ.get(key) for key in ENV}
    os.environ.update(ENV)
    try:
        test_sent_24h_after_first_activity_from_welcome_address()
        test_pre_feature_user_never_stamped_or_emailed()
        test_user_with_no_activity_gets_nothing()
        test_bounced_user_skipped()
        test_failed_send_releases_claim_and_retries()
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    print("test_welcome_email.py: ok")
