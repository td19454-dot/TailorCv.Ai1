"""Instant phone alerts, free: a Telegram message plus a Telegram voice call.

Sentry records errors but only emails about them; this pings the owner's phone
the moment a 500 or a checkout failure happens.

- Message: Telegram's official Bot API. Env: TELEGRAM_BOT_TOKEN (from
  @BotFather) and TELEGRAM_CHAT_ID (your chat with that bot).
- Call: CallMeBot (free, unofficial) rings you on Telegram and reads the alert
  aloud. Env: CALLMEBOT_TELEGRAM_USER (your @username). Best-effort — the
  message is the reliable channel.

Only sends when ENVIRONMENT=production so local dev errors never ring anyone;
a channel whose env vars are missing is skipped.

Sends run on a background thread so a slow API never delays the response.
Repeats are throttled so one bug hit by 200 users is one alert, not 200: each
distinct error messages at most once per 10 minutes, at most 20 messages an
hour overall, and the phone is called at most once per 10 minutes whatever the
error.
"""

import logging
import os
import threading
import time

import httpx

logger = logging.getLogger(__name__)

MSG_DEDUPE_SECONDS = 10 * 60   # same error key messages at most this often
CALL_GAP_SECONDS = 10 * 60     # at most one call per this window, any error
MAX_MSG_PER_HOUR = 20          # hard cap across all keys

_lock = threading.Lock()
_last_msg: dict[str, float] = {}
_recent_msg: list[float] = []
_last_call = 0.0


def _config():
    if os.getenv("ENVIRONMENT", "development").lower() != "production":
        return None
    cfg = {
        "bot_token": os.getenv("TELEGRAM_BOT_TOKEN"),
        "chat_id": os.getenv("TELEGRAM_CHAT_ID"),
        "call_user": os.getenv("CALLMEBOT_TELEGRAM_USER"),
    }
    has_msg = cfg["bot_token"] and cfg["chat_id"]
    return cfg if (has_msg or cfg["call_user"]) else None


def _plan(key: str) -> tuple[bool, bool]:
    """Decide (send_message, place_call) for this key, recording the decision."""
    global _last_call
    now = time.time()
    with _lock:
        if now - _last_msg.get(key, 0) < MSG_DEDUPE_SECONDS:
            return False, False
        _recent_msg[:] = [t for t in _recent_msg if now - t < 3600]
        if len(_recent_msg) >= MAX_MSG_PER_HOUR:
            return False, False
        _last_msg[key] = now
        _recent_msg.append(now)
        call = now - _last_call >= CALL_GAP_SECONDS
        if call:
            _last_call = now
        return True, call


def _send(cfg: dict, text: str, spoken: str, call: bool) -> None:
    # Never let alerting raise into anything else.
    if cfg["bot_token"] and cfg["chat_id"]:
        try:
            r = httpx.post(
                f"https://api.telegram.org/bot{cfg['bot_token']}/sendMessage",
                json={"chat_id": cfg["chat_id"], "text": text[:4000],
                      "disable_web_page_preview": True},
                timeout=10,
            )
            if r.status_code >= 400:
                logger.warning("Alert message failed: %s %s", r.status_code, r.text[:300])
        except Exception as exc:
            logger.warning("Alert message failed: %s", exc)

    if call and cfg["call_user"]:
        # cc: CallMeBot also texts a copy by default ("yes"). Our bot already
        # sent the message, so skip it — unless the bot isn't configured, in
        # which case leave a text when the call is missed.
        cc = "no" if (cfg["bot_token"] and cfg["chat_id"]) else "missed"
        try:
            r = httpx.get(
                "https://api.callmebot.com/start.php",
                params={"user": cfg["call_user"], "text": spoken[:256],
                        "lang": "en-GB-Standard-B", "rpt": 2, "cc": cc},
                timeout=30,
            )
            if r.status_code >= 400:
                logger.warning("Alert call failed: %s %s", r.status_code, r.text[:300])
        except Exception as exc:
            logger.warning("Alert call failed: %s", exc)


def notify(title: str, details: str = "", key: str | None = None) -> None:
    """Message (and, if none in the last 10 min, call) the owner. Safe anywhere."""
    cfg = _config()
    if cfg is None:
        return
    send_msg, call = _plan(key or title)
    if not send_msg:
        return
    text = f"🚨 TailorCV ALERT: {title}"
    if details:
        text += f"\n\n{details}"
    spoken = f"TailorCV alert. {title}. Check Telegram for details."
    threading.Thread(target=_send, args=(cfg, text, spoken, call), daemon=True).start()
