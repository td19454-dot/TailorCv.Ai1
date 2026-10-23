"""document_store.py: base resumes and cover letters that outlive a deploy.

Runs against an in-memory fake of the S3 client — no network, no credentials.

Run: python test_document_store.py
"""

import os
import shutil
import sys
import tempfile
import threading
import time
import traceback

import document_store as ds

ENV = {
    "STORAGE_BACKEND": "r2",
    "STORAGE_ENDPOINT_URL": "https://example.r2.cloudflarestorage.com",
    "STORAGE_BUCKET": "test-bucket",
    "STORAGE_ACCESS_KEY_ID": "id",
    "STORAGE_SECRET_ACCESS_KEY": "secret",
}


class NotFound(Exception):
    response = {"Error": {"Code": "NoSuchKey"}, "ResponseMetadata": {"HTTPStatusCode": 404}}


class Boom(Exception):
    response = {"Error": {"Code": "InternalError"}, "ResponseMetadata": {"HTTPStatusCode": 500}}


class _Body:
    def __init__(self, data):
        self._data = data

    def read(self):
        return self._data


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.calls = []
        self.fail_put = False
        self.fail_get = False

    def put_object(self, Bucket, Key, Body, ContentType=None):
        self.calls.append(("put", Key))
        if self.fail_put:
            raise Boom("put failed")
        self.objects[Key] = Body

    def get_object(self, Bucket, Key):
        self.calls.append(("get", Key))
        if self.fail_get:
            raise Boom("get failed")
        if Key not in self.objects:
            raise NotFound(Key)
        return {"Body": _Body(self.objects[Key])}

    def head_object(self, Bucket, Key):
        self.calls.append(("head", Key))
        if Key not in self.objects:
            raise NotFound(Key)
        return {}

    def delete_object(self, Bucket, Key):
        self.calls.append(("delete", Key))
        self.objects.pop(Key, None)


class Env:
    """Fresh module state, a temp dir and (optionally) R2 switched on."""

    def __init__(self, on=True):
        self.on = on

    def __enter__(self):
        self.saved = {k: os.environ.get(k) for k in ENV}
        for k, v in ENV.items():
            if self.on:
                os.environ[k] = v
            else:
                os.environ.pop(k, None)
        self.s3 = FakeS3()
        ds._client = self.s3
        ds._misses.clear()
        ds._confirmed.clear()
        ds._backfilling.clear()
        self.dir = tempfile.mkdtemp()
        return self

    def path(self, name="a1b2c3.pdf", data=None):
        p = os.path.join(self.dir, "uploads", name)
        if data is not None:
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as fh:
                fh.write(data)
        return p

    def __exit__(self, *exc):
        _join_backfills()
        for k, v in self.saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        ds._client = None
        shutil.rmtree(self.dir, ignore_errors=True)


def _join_backfills():
    for t in threading.enumerate():
        if t is not threading.current_thread() and t.daemon:
            t.join(timeout=2)


# ── tests ────────────────────────────────────────────────────────────────

def test_off_without_configuration():
    with Env(on=False) as e:
        p = e.path(data=b"%PDF")
        assert not ds.enabled()
        assert ds.ensure_file(p) is True, "a local file is still available"
        os.remove(p)
        assert ds.ensure_file(p) is False, "and a missing one is missing, as before"
        assert ds.store_file(e.path("x.pdf", b"%PDF")) is False
        ds.remove_file(p)
        assert e.s3.calls == [], "nothing touches storage when it is not configured"


def test_key_is_the_basename_only():
    assert ds.key_for("/opt/render/project/src/uploads/abc.pdf") == "documents/abc.pdf"
    assert ds.key_for(r"C:\dev\TailorCv\uploads\abc.pdf") == "documents/abc.pdf" or os.sep == "/"


def test_a_stored_file_comes_back_after_the_disk_loses_it():
    with Env() as e:
        p = e.path(data=b"%PDF-1.4 resume bytes")
        assert ds.store_file(p) is True
        os.remove(p)                               # the deploy wipes the disk
        assert ds.ensure_file(p) is True
        with open(p, "rb") as fh:
            assert fh.read() == b"%PDF-1.4 resume bytes", "the same bytes, at the same path"


def test_a_restore_recreates_a_missing_directory():
    with Env() as e:
        p = e.path(data=b"%PDF")
        ds.store_file(p)
        shutil.rmtree(os.path.dirname(p))          # uploads/ itself is gone after a deploy
        assert ds.ensure_file(p) is True
        assert os.path.exists(p)


def test_a_file_storage_never_had_is_missing_and_not_asked_for_again():
    with Env() as e:
        p = e.path("lost-before-r2.pdf")
        assert ds.ensure_file(p) is False
        gets = sum(1 for c in e.s3.calls if c[0] == "get")
        assert ds.ensure_file(p) is False
        assert sum(1 for c in e.s3.calls if c[0] == "get") == gets, \
            "the frequent has-a-resume checks must not hit storage every time"


def test_a_missing_file_is_looked_up_again_after_the_wait():
    with Env() as e:
        p = e.path("later.pdf")
        assert ds.ensure_file(p) is False
        e.s3.objects[ds.key_for(p)] = b"%PDF"     # uploaded from another instance
        ds._misses[p] = time.time() - ds.MISS_TTL_SECONDS - 1
        assert ds.ensure_file(p) is True


def test_a_failed_store_reports_and_never_raises():
    with Env() as e:
        e.s3.fail_put = True
        assert ds.store_file(e.path(data=b"%PDF")) is False


def test_a_failed_restore_leaves_no_partial_file():
    with Env() as e:
        p = e.path(data=b"%PDF")
        ds.store_file(p)
        os.remove(p)
        e.s3.fail_get = True
        assert ds.ensure_file(p) is False
        leftovers = os.listdir(os.path.dirname(p))
        assert leftovers == [], f"nothing half-written left behind: {leftovers}"


def test_remove_deletes_the_stored_copy():
    with Env() as e:
        p = e.path(data=b"%PDF")
        ds.store_file(p)
        ds.remove_file(p)
        assert ds.key_for(p) not in e.s3.objects


def test_a_file_already_on_disk_is_copied_to_storage_once():
    with Env() as e:
        p = e.path("from-before-r2.pdf", data=b"%PDF old")
        assert ds.ensure_file(p) is True
        _join_backfills()
        assert e.s3.objects.get(ds.key_for(p)) == b"%PDF old", "backfilled"
        heads = sum(1 for c in e.s3.calls if c[0] == "head")
        ds.ensure_file(p)
        _join_backfills()
        assert sum(1 for c in e.s3.calls if c[0] == "head") == heads, "checked once per process"


def test_ensure_file_async_restores_too():
    import asyncio

    with Env() as e:
        p = e.path(data=b"%PDF")
        ds.store_file(p)
        os.remove(p)
        assert asyncio.run(ds.ensure_file_async(p)) is True
        assert os.path.exists(p)


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed, failures = 0, []
    for t in tests:
        try:
            t()
            passed += 1
            print(f"  PASS  {t.__name__}")
        except Exception as exc:  # noqa: BLE001 - report every failure
            failures.append((t.__name__, exc))
            print(f"  FAIL  {t.__name__}: {exc}")
            traceback.print_exc()
    print(f"\n{passed}/{len(tests)} passed, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
