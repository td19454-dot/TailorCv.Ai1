from dotenv import load_dotenv
from email_service import send_email

load_dotenv()

recipients = [
    "supersarkar804@gmail.com",
    "bergerhr9@gmail.com",
    "founderpromax@gmail.com",
    "studioswastika2001@gmail.com",
    "td19454@gmail.com",
]

for recipient in recipients:
    send_email(
        recipient_email=recipient,
        subject="Hello from TailorCV",
        html_body="<p>Hi! This is a test email from TailorCV.</p>",
    )