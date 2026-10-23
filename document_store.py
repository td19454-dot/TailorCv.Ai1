"""Durable copies of the user documents that must outlive a deploy.

Render's disk is wiped on every deploy and restart. Base resumes are saved to
uploads/ and base cover letters to resumes/, with only their path kept in the
database (users.base_resume_path / users.base_cover_letter_path) — so after a
deploy every user looked as if they had never uploaded one.

Cloudflare R2 now holds the durable copy; the local disk is only a cache. The
object key is derived from the file's own name (documents/<basename>), and
those names are already random and unique, so no column or migration was
needed: the stored path keeps its meaning, and ensure_file() puts the file
back at exactly that path whenever the disk has lost it. Every caller then
reads a real local file as before (pdfplumber, FileResponse, Playwright's
set_input_files, the PDF link-annotation reader).

Off unless configured: without STORAGE_BACKEND=r2 and the four STORAGE_* values
every function here is a no-op and ensure_file() is just os.path.exists().

Never raises. A storage failure must not fail the request that triggered it —
the file is still on disk until the next deploy, exactly as before R2.
"""

import asyncio
import logging
import os
import threading
import time
import uuid

import alerts

logger = logging.getLogger(__name__)

KEY_PREFIX = "documents/"
# How long a path R2 does not have (a file lost before R2 existed) is
# remembered, so the frequent "has a base resume?" checks don't ask R2 every
# time. Short enough that a later upload of the same key is picked up.
MISS_TTL_SECONDS = 600

_REQUIRED = ("STORAGE_ENDPOINT_URL", "STORAGE_BUCKET",
             "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY")

_client = None
_client_lock = threading.Lock()
_misses: dict[str, float] = {}
# Local files known to be in R2 already this process, so the lazy backfill
# below runs at most once per file.
_confirmed: set[str] = set()
_backfilling: set[str] = set()
_state_lock = threading.Lock()


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def enabled() -> bool:
    return _env("STORAGE_BACKEND").lower() == "r2" and all(_env(n) for n in _REQUIRED)


def _bucket() -> str:
    return _env("STORAGE_BUCKET")


def key_for(path: str) -> str:
    """documents/<basename>. Only the basename: the absolute directory differs
    between a laptop and Render, the generated file name does not."""
    return KEY_PREFIX + os.path.basename(str(path or ""))


def _get_client():
    """One lazily built client. Short timeouts and two attempts, so an R2
    outage costs a request seconds, never a hang."""
    global _client
    if _client is not None:
        return _client
    with _client_lock:
        if _client is None:
            import boto3
            from botocore.config import Config

            _client = boto3.client(
                "s3",
                endpoint_url=_env("STORAGE_ENDPOINT_URL"),
                region_name="auto",
                aws_access_key_id=_env("STORAGE_ACCESS_KEY_ID"),
                aws_secret_access_key=_env("STORAGE_SECRET_ACCESS_KEY"),
                config=Config(connect_timeout=3, read_timeout=10,
                              retries={"max_attempts": 2}),
            )
    return _client


def _is_not_found(exc: Exception) -> bool:
    response = getattr(exc, "response", None) or {}
    code = str((response.get("Error") or {}).get("Code") or "")
    status = (response.get("ResponseMetadata") or {}).get("HTTPStatusCode")
    return code in ("404", "NoSuchKey", "NotFound") or status == 404


def _report(action: str, path: str, exc: Exception) -> None:
    logger.error("document_store %s failed for %s: %s", action, key_for(path), exc, exc_info=True)
    try:
        alerts.notify(f"R2 {action} failed",
                      f"{key_for(path)} — {type(exc).__name__}: {str(exc)[:300]}",
                      key=f"r2:{action}", urgent=False)
    except Exception:
        pass


def store_file(path: str) -> bool:
    """Copy a local file to R2. True once stored; False (never raises) if not."""
    if not enabled() or not path or not os.path.exists(path):
        return False
    try:
        with open(path, "rb") as fh:
            _get_client().put_object(Bucket=_bucket(), Key=key_for(path), Body=fh.read(),
                                     ContentType="application/pdf")
    except Exception as exc:
        _report("store", path, exc)
        return False
    with _state_lock:
        _confirmed.add(path)
        _misses.pop(path, None)
    return True


def ensure_file(path: str) -> bool:
    """Is this document available at `path`? Restores it from R2 if the disk
    lost it. The drop-in replacement for `os.path.exists(path)`."""
    if not path:
        return False
    if os.path.exists(path):
        _backfill_later(path)
        return True
    if not enabled():
        return False
    with _state_lock:
        missed_at = _misses.get(path)
    if missed_at is not None and time.time() - missed_at < MISS_TTL_SECONDS:
        return False
    try:
        obj = _get_client().get_object(Bucket=_bucket(), Key=key_for(path))
        data = obj["Body"].read()
    except Exception as exc:
        if not _is_not_found(exc):
            _report("restore", path, exc)
        with _state_lock:
            _misses[path] = time.time()
        return False
    # Written beside the target and renamed into place, so a reader never sees
    # a half-written PDF.
    tmp = f"{path}.{uuid.uuid4().hex}.part"
    try:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except Exception as exc:
        _report("restore", path, exc)
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError:
            pass
        return False
    with _state_lock:
        _confirmed.add(path)
        _misses.pop(path, None)
    return True


async def ensure_file_async(path: str) -> bool:
    """ensure_file off the event loop: a first restore is a network call."""
    if path and os.path.exists(path):
        _backfill_later(path)
        return True
    return await asyncio.to_thread(ensure_file, path)


def remove_file(path: str) -> None:
    """Delete the R2 copy (the caller removes the local file)."""
    if not enabled() or not path:
        return
    try:
        _get_client().delete_object(Bucket=_bucket(), Key=key_for(path))
    except Exception as exc:
        _report("delete", path, exc)
    with _state_lock:
        _confirmed.discard(path)


def _backfill_later(path: str) -> None:
    """A file on disk that R2 may not have — uploaded before R2 was configured.
    Checked once per process, in the background, and stored if missing."""
    if not enabled():
        return
    with _state_lock:
        if path in _confirmed or path in _backfilling:
            return
        _backfilling.add(path)
    threading.Thread(target=_backfill, args=(path,), daemon=True).start()


def _backfill(path: str) -> None:
    try:
        try:
            _get_client().head_object(Bucket=_bucket(), Key=key_for(path))
            with _state_lock:
                _confirmed.add(path)
        except Exception as exc:
            if _is_not_found(exc):
                store_file(path)
            else:
                _report("check", path, exc)
    finally:
        with _state_lock:
            _backfilling.discard(path)
