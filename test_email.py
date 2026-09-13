import logging

from dotenv import load_dotenv
from email_service import send_email

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

recipients = [
    "supersarkar804@gmail.com",
    "bergerhr9@gmail.com",
    "founderpromax@gmail.com",
    "studioswastika2001@gmail.com",
    "td19454@gmail.com",
]

for recipient in recipients:
    try:
        send_email(
            recipient_email=recipient,
            subject="Hello from TailorCV",
            html_body="<p>Hi! This is a test email from TailorCV.</p>",
        )
        print(f"Accepted by SMTP server: {recipient}")
    except Exception as exc:
        print(f"Failed for {recipient}: {exc}")

print("Done")
