"""Regression tests for the editor render gate (_run_editor_render in main.py).

The editors send a WeasyPrint layout request per edit. Run unbounded, one user
dragging a slider stacked a dozen layouts in parallel threads and OOM-killed
the 512 MB instance. The gate must:
  - run at most one editor layout at a time,
  - skip a queued request once a newer one from the same user has arrived
    (each request carries the whole document, so only the newest matters),
  - never skip another user's request,
  - release the gate when a render raises, and leave no bookkeeping behind.
"""
import asyncio
import sys
import threading
import time
import traceback
from types import SimpleNamespace

import main


def _fake_request(user_id):
    return SimpleNamespace(session={"user_id": user_id})


# One loop for every test, as under uvicorn: the gate's module-level semaphore
# binds to the first loop that waits on it, like request_semaphore does.
_LOOP = asyncio.new_event_loop()


def _run(coro):
    return _LOOP.run_until_complete(coro)


class _Tracker:
    """A blocking render stand-in that records concurrency and which ran."""

    def __init__(self):
        self.lock = threading.Lock()
        self.active = 0
        self.max_active = 0
        self.ran = []

    def job(self, label, seconds=0.2):
        def _fn():
            with self.lock:
                self.active += 1
                self.max_active = max(self.max_active, self.active)
            try:
                time.sleep(seconds)
                with self.lock:
                    self.ran.append(label)
                return label
            finally:
                with self.lock:
                    self.active -= 1
        return _fn


def test_one_layout_at_a_time_and_newest_wins():
    tracker = _Tracker()

    async def scenario():
        req = _fake_request(1)
        return await asyncio.gather(*(
            main._run_editor_render(req, "estimate", tracker.job(i)) for i in range(6)
        ))

    results = _run(scenario())
    assert tracker.max_active == 1, f"{tracker.max_active} layouts ran at once"
    # The first starts immediately; 1-4 are superseded while queued; 5 is newest.
    assert tracker.ran == [0, 5], f"ran {tracker.ran}"
    assert results == [0, None, None, None, None, 5], f"results {results}"


def test_other_users_are_never_skipped():
    tracker = _Tracker()

    async def scenario():
        return await asyncio.gather(
            main._run_editor_render(_fake_request(1), "render", tracker.job("u1")),
            main._run_editor_render(_fake_request(2), "render", tracker.job("u2")),
        )

    results = _run(scenario())
    assert results == ["u1", "u2"], f"results {results}"
    assert tracker.max_active == 1, f"{tracker.max_active} layouts ran at once"


def test_endpoints_do_not_supersede_each_other():
    tracker = _Tracker()

    async def scenario():
        req = _fake_request(1)
        return await asyncio.gather(
            main._run_editor_render(req, "render", tracker.job("render")),
            main._run_editor_render(req, "estimate", tracker.job("estimate")),
        )

    results = _run(scenario())
    assert results == ["render", "estimate"], f"results {results}"


def test_error_propagates_and_releases_the_gate():
    def _boom():
        raise ValueError("render failed")

    async def scenario():
        req = _fake_request(1)
        try:
            await main._run_editor_render(req, "render", _boom)
        except ValueError:
            pass
        else:
            raise AssertionError("the render error was swallowed")
        # The gate must be free again, or every later preview would hang.
        return await asyncio.wait_for(
            main._run_editor_render(req, "render", lambda: "after"), timeout=5)

    assert _run(scenario()) == "after"


def test_no_bookkeeping_left_behind():
    assert main._editor_render_latest == {}, (
        f"stale entries: {main._editor_render_latest}")


def main_runner() -> int:
    # Order matters only for the last test, which checks the others cleaned up.
    tests = [
        test_one_layout_at_a_time_and_newest_wins,
        test_other_users_are_never_skipped,
        test_endpoints_do_not_supersede_each_other,
        test_error_propagates_and_releases_the_gate,
        test_no_bookkeeping_left_behind,
    ]
    passed, failures = 0, []
    for t in tests:
        try:
            t()
            passed += 1
            print(f"  PASS  {t.__name__}")
        except Exception as exc:  # noqa: BLE001
            failures.append(t.__name__)
            print(f"  FAIL  {t.__name__}: {exc}")
            traceback.print_exc()
    print(f"\n{passed}/{len(tests)} passed, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main_runner())
