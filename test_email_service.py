import os

from email_service import send_email


class FakeSMTP:
    instances = []

    def __init__(self, host, port, timeout=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.started_tls = False
        self.login_args = None
        self.messages = []
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def starttls(self):
        self.started_tls = True

    def login(self, username, password):
        self.login_args = (username, password)

    def send_message(self, message):
        self.messages.append(message)


def test_send_email_uses_ses_smtp_settings_without_network():
    previous = {
        key: os.environ.get(key)
        for key in (
            "SES_SMTP_HOST",
            "SES_SMTP_PORT",
            "SES_SMTP_USERNAME",
            "SES_SMTP_PASSWORD",
            "EMAIL_FROM",
        )
    }
    try:
        os.environ["SES_SMTP_HOST"] = "email-smtp.us-east-1.amazonaws.com"
        os.environ["SES_SMTP_PORT"] = "587"
        os.environ["SES_SMTP_USERNAME"] = "smtp-user"
        os.environ["SES_SMTP_PASSWORD"] = "smtp-password"
        os.environ["EMAIL_FROM"] = "TailorCV <no-reply@example.com>"
        FakeSMTP.instances = []

        assert send_email(
            "user@example.com",
            "Hello",
            "<p>Welcome to <strong>TailorCV</strong>.</p>",
            smtp_factory=FakeSMTP,
        )

        smtp = FakeSMTP.instances[0]
        assert smtp.host == "email-smtp.us-east-1.amazonaws.com"
        assert smtp.port == 587
        assert smtp.started_tls
        assert smtp.login_args == ("smtp-user", "smtp-password")
        assert len(smtp.messages) == 1
        message = smtp.messages[0]
        assert message["To"] == "user@example.com"
        assert message["Subject"] == "Hello"
        assert "TailorCV" in message.get_body(preferencelist=("html",)).get_content()
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == "__main__":
    test_send_email_uses_ses_smtp_settings_without_network()
    print("test_email_service.py: ok")
