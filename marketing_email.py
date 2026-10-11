"""Send a marketing campaign to a segment of users, over the same Amazon SES
SMTP credentials as the transactional mail (email_service.py). Nothing in
main.py imports this file; it's run by hand.

Usage:
    # 1. Dry run (default): count, sample recipients, preview file. Sends nothing.
    python marketing_email.py example-announcement --segment free

    # 2. Send one copy, rendered as the first recipient, to yourself. Not logged.
    python marketing_email.py example-announcement --segment free --test-to you@gmail.com

    # 3. Real send: a small batch first, then the rest (reruns skip anyone already sent).
    python marketing_email.py example-announcement --segment free --send --limit 50
    python marketing_email.py example-announcement --segment free --send

Campaigns are HTML files in marketing/templates/ (the file name is the campaign
name); segments are defined in marketing/segments.py. Run against production
by pointing DATABASE_URL at it.

Requires for --send / --test-to:
    SES_SMTP_HOST, SES_SMTP_USERNAME, SES_SMTP_PASSWORD   (as email_service.py)
    MARKETING_FROM   sender, e.g. "Shubham from TailorCV <support@thetailorcv.com>";
                     falls back to EMAIL_FROM
    SECRET_KEY       must be production's value: unsubscribe links are signed
                     with it and verified by the live /unsubscribe route
Optional:
    COMPANY_MAILING_ADDRESS  printed in the footer (CAN-SPAM, US recipients)
    MARKETING_SEND_RATE      emails per second, default 5
    SES_CONFIGURATION_SET    SES event publishing to routers/marketing.py's webhook
"""
import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from database import DATABASE_URL, SessionLocal, engine  # noqa: E402
from email_service import smtp_session  # noqa: E402
from marketing.render import load_campaign  # noqa: E402
from marketing.segments import SEGMENTS, recipients  # noqa: E402
from marketing.sender import build_campaign_message, send_campaign  # noqa: E402
from models import MarketingSend  # noqa: E402

PREVIEW_DIR = Path(__file__).parent / "marketing" / "previews"
# email_suppression.py signs with this when SECRET_KEY is unset — production
# never accepts tokens signed with it.
_FALLBACK_SECRET = "your-secret-key"


def _sender_address() -> str:
    return (os.getenv("MARKETING_FROM", "").strip() or os.getenv("EMAIL_FROM", "").strip()).strip("'\"")


def _preflight() -> list[str]:
    problems = []
    secret = os.getenv("SECRET_KEY", "").strip()
    if not secret or secret == _FALLBACK_SECRET:
        problems.append(
            "SECRET_KEY is not set. Set it to production's value (Render > Environment): "
            "unsubscribe links are signed with it, and with any other value every "
            "unsubscribe link in this campaign would fail."
        )
    if not _sender_address():
        problems.append("Set MARKETING_FROM (or EMAIL_FROM) to the sender address.")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Send a marketing campaign to a segment of users.")
    parser.add_argument("campaign", help="Template name in marketing/templates/ (without .html)")
    parser.add_argument("--segment", required=True, choices=sorted(SEGMENTS))
    parser.add_argument("--exclude", action="append", default=[], choices=sorted(SEGMENTS),
                        help="Leave out users in this segment (repeatable)")
    parser.add_argument("--limit", type=int, default=None, help="Send to at most N users this run")
    parser.add_argument("--min-gap-days", type=int, default=7,
                        help="Skip users who got any marketing email in the last N days (0 = off)")
    parser.add_argument("--test-to", metavar="EMAIL", help="Send one copy only to this address; logs nothing")
    parser.add_argument("--send", action="store_true", help="Actually send. Without it, a dry run.")
    args = parser.parse_args()

    try:
        campaign = load_campaign(args.campaign)
    except (FileNotFoundError, ValueError) as exc:
        print(f"ERROR: {exc}")
        print("Create it by copying marketing/templates/example-announcement.html to "
              f"marketing/templates/{args.campaign}.html")
        return 1

    # The app creates tables at startup, so a database whose server hasn't run
    # this code yet has no send log. The table is this script's own; creating it
    # here (a no-op when it exists) means a send never waits on a deploy.
    MarketingSend.__table__.create(bind=engine, checkfirst=True)

    db = SessionLocal()
    try:
        users = recipients(
            db, args.segment, campaign=campaign.name, exclude=tuple(args.exclude),
            min_gap_days=args.min_gap_days, limit=args.limit, now=datetime.utcnow(),
        )
        if args.test_to:
            mode = f"TEST: sends ONE email, only to {args.test_to}. The list below is who --send would reach."
        elif args.send:
            mode = "SEND: emails everyone listed below (you'll be asked to confirm first)."
        else:
            mode = "DRY RUN: sends nothing. The list below is who --send would reach."
        print(f"MODE: {mode}")
        print(f"Database: {engine.url.host or engine.url.database}")
        label = args.segment + "".join(f" - {x}" for x in args.exclude)
        print(f"Campaign '{campaign.name}' -> segment [{label}]: {len(users)} recipient(s)")
        print("  (unsubscribed / bounced / complained, already sent this campaign, and "
              f"mailed in the last {args.min_gap_days} day(s) are excluded)")
        if DATABASE_URL.startswith("sqlite"):
            print("  NOTE: using the local SQLite database, not production.")
        for user in users[:10]:
            print(f"    {user.email}")
        if len(users) > 10:
            print(f"    ... and {len(users) - 10} more")
        if not users:
            return 0

        # Render the first recipient now, in every mode, so a template error
        # surfaces before anything is sent.
        message = build_campaign_message(campaign, users[0], _sender_address() or "preview@localhost")
        PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
        preview = PREVIEW_DIR / f"{campaign.name}.html"
        preview.write_text(message.get_body(preferencelist=("html",)).get_content(), encoding="utf-8")
        print(f"Subject: {message['Subject']}  (rendered as {users[0].email})")
        print(f"Preview: {preview}")

        if not (args.send or args.test_to):
            print("Dry run - nothing sent. Add --test-to you@example.com, then --send.")
            return 0

        problems = _preflight()
        if problems:
            for problem in problems:
                print(f"ERROR: {problem}")
            return 1
        if not os.getenv("COMPANY_MAILING_ADDRESS", "").strip():
            print("WARNING: COMPANY_MAILING_ADDRESS is not set; CAN-SPAM requires a postal "
                  "address in commercial email sent to US recipients.")

        if args.test_to:
            test = build_campaign_message(campaign, users[0], _sender_address(), to_email=args.test_to)
            with smtp_session() as smtp:
                smtp.send_message(test)
            print(f"Test email sent to {args.test_to} (rendered as {users[0].email}). Nothing logged.")
            return 0

        typed = input(f"Type {len(users)} to send '{campaign.name}' from {_sender_address()}: ").strip()
        if typed != str(len(users)):
            print("Cancelled - nothing sent.")
            return 1

        rate = float(os.getenv("MARKETING_SEND_RATE", "5") or 5)
        result = send_campaign(db, campaign, users, _sender_address(), rate_per_second=rate)
        print(f"Done. Sent {result.sent}, failed {result.failed}, skipped {result.skipped}.")
        if result.failed:
            print("Failed recipients were not logged; rerun the same command to retry them.")
        return 0 if not result.failed else 2
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
