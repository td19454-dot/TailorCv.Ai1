"""Bulk marketing email sender, via Amazon SES — separate on purpose from the
Resend-based transactional emails in main.py (password reset, signup code,
welcome email). Nothing in main.py imports this file; it's run by hand or on a
schedule, never from a request handler.

Requires env vars:
    AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (or the default
        boto3 credential chain)
    SES_FROM                a verified SES identity, e.g. news@thetailorcv.com
    COMPANY_MAILING_ADDRESS a physical postal address (CAN-SPAM requires one
                             in every commercial email)
Optional:
    SES_CONFIGURATION_SET   enables SES event publishing (bounces/complaints/
                             opens) to the SNS topic wired up in routers/marketing.py
    APP_BASE_URL             defaults to https://thetailorcv.com

Usage:
    python marketing_email.py --subject "..." --body-file campaign.txt --dry-run
    python marketing_email.py --subject "..." --body-file campaign.txt --limit 50 --send
    python marketing_email.py --subject "..." --body-file campaign.txt --send

Recipients are every User with marketing_opt_out=False, email_bounced_at=NULL,
and email_complained_at=NULL. Each send gets a List-Unsubscribe header (RFC 8058
one-click) plus a visible unsubscribe link and mailing address in the body, and
sends are throttled to the account's current SES send rate.
"""
import argparse
import os
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Optional

import boto3
from botocore.exceptions import ClientError

from database import SessionLocal
from email_suppression import unsubscribe_url
from models import User

AWS_REGION = os.getenv("AWS_REGION", "us-east-1").strip()
SES_FROM = os.getenv("SES_FROM", "").strip()
SES_CONFIGURATION_SET = os.getenv("SES_CONFIGURATION_SET", "").strip()
COMPANY_MAILING_ADDRESS = os.getenv("COMPANY_MAILING_ADDRESS", "").strip()


def _eligible_users(limit: Optional[int] = None) -> List[User]:
    db = SessionLocal()
    try:
        query = (
            db.query(User)
            .filter(User.marketing_opt_out.is_(False))
            .filter(User.email_bounced_at.is_(None))
            .filter(User.email_complained_at.is_(None))
        )
        if limit:
            query = query.limit(limit)
        users = query.all()
        # Detach values we need after the session closes.
        return [(u.id, u.email) for u in users]
    finally:
        db.close()


def _build_message(user_id: int, email: str, subject: str, text_body: str) -> MIMEMultipart:
    unsub_url = unsubscribe_url(user_id)
    footer = f"\n\n---\nYou're receiving this because you have a TailorCV account ({email}).\nUnsubscribe: {unsub_url}\n"
    if COMPANY_MAILING_ADDRESS:
        footer += f"{COMPANY_MAILING_ADDRESS}\n"

    msg = MIMEMultipart()
    msg["Subject"] = subject
    msg["From"] = SES_FROM
    msg["To"] = email
    # RFC 8058 one-click unsubscribe: the "Unsubscribe" button Gmail/Yahoo show
    # next to the sender name, instead of relying on the reader to scroll to the
    # footer. Required by Gmail/Yahoo's 2024 bulk-sender rules for >5k/day senders,
    # good practice regardless of volume.
    msg["List-Unsubscribe"] = f"<{unsub_url}>, <mailto:{SES_FROM}?subject=unsubscribe>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    if SES_CONFIGURATION_SET:
        msg["X-SES-CONFIGURATION-SET"] = SES_CONFIGURATION_SET
    msg.attach(MIMEText(text_body + footer, "plain"))
    return msg


def send_campaign(subject: str, text_body: str, dry_run: bool = True, limit: Optional[int] = None) -> None:
    if not SES_FROM:
        raise SystemExit("Set SES_FROM (a verified SES identity) before sending.")
    if not COMPANY_MAILING_ADDRESS:
        print(
            "WARNING: COMPANY_MAILING_ADDRESS is not set. CAN-SPAM requires a physical "
            "postal address in every commercial email — set it before a real send."
        )

    recipients = _eligible_users(limit)
    print(f"{len(recipients)} eligible recipient(s) (opted-out/bounced/complained already excluded).")

    if dry_run:
        for _, email in recipients[:10]:
            print(f"  would send to {email}")
        if len(recipients) > 10:
            print(f"  ... and {len(recipients) - 10} more")
        print("Dry run — nothing sent. Re-run with --send to actually send.")
        return

    client = boto3.client("ses", region_name=AWS_REGION)
    quota = client.get_send_quota()
    max_per_second = max(quota.get("MaxSendRate", 1.0), 1.0)
    min_interval = 1.0 / max_per_second

    sent, failed = 0, 0
    for user_id, email in recipients:
        started = time.monotonic()
        try:
            msg = _build_message(user_id, email, subject, text_body)
            client.send_raw_email(
                Source=SES_FROM,
                Destinations=[email],
                RawMessage={"Data": msg.as_string()},
            )
            sent += 1
        except ClientError as exc:
            failed += 1
            print(f"  FAILED {email}: {exc}")
        elapsed = time.monotonic() - started
        if elapsed < min_interval:
            time.sleep(min_interval - elapsed)

    print(f"Done. Sent {sent}, failed {failed}.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a bulk marketing campaign via Amazon SES.")
    parser.add_argument("--subject", required=True)
    parser.add_argument("--body-file", required=True, help="Path to a plain-text file with the email body.")
    parser.add_argument("--limit", type=int, default=None, help="Cap recipients (useful while in the SES sandbox).")
    parser.add_argument("--send", action="store_true", help="Actually send. Without this flag, runs as a dry run.")
    args = parser.parse_args()

    with open(args.body_file, "r", encoding="utf-8") as f:
        text_body = f.read()

    send_campaign(args.subject, text_body, dry_run=not args.send, limit=args.limit)


if __name__ == "__main__":
    main()
