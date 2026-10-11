"""Alert before Render kills the process, and when a request hangs.

An out-of-memory kill is SIGKILL: no exception, no handler, no Sentry event.
The process vanishes mid-request and the user's tailoring just never finishes.
The only way to hear about it from inside is to watch memory climb and alert
first, naming the requests in flight so the culprit is obvious.

The same in-flight registry catches requests that hang (an LLM call that never
returns) — those also never produce an error anywhere.

Procfile runs a single uvicorn worker, so this registry sees every request.
Alerting itself is alerts.notify, which no-ops outside production.
"""

import asyncio
import itertools
import logging
import os
import time

import alerts

logger = logging.getLogger(__name__)

CHECK_SECONDS = 5
# Container memory as a fraction of its limit. Render kills at 100%.
MEMORY_WARN_FRACTION = float(os.getenv("MEMORY_WARN_FRACTION", "0.85"))
# A request still running after this long is treated as hung.
STUCK_SECONDS = float(os.getenv("STUCK_REQUEST_SECONDS", "240"))

_inflight: dict[int, tuple[str, float]] = {}
_ids = itertools.count()


def request_started(label: str) -> int:
    rid = next(_ids)
    _inflight[rid] = (label, time.monotonic())
    return rid


def request_finished(rid: int) -> None:
    _inflight.pop(rid, None)


def inflight_summary(limit: int = 8) -> str:
    now = time.monotonic()
    oldest = sorted(_inflight.values(), key=lambda item: item[1])[:limit]
    lines = [f"- {label} ({now - started:.0f}s)" for label, started in oldest]
    if len(_inflight) > limit:
        lines.append(f"- ...and {len(_inflight) - limit} more")
    return "\n".join(lines) or "- none"


def _read(path: str) -> str | None:
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return None


def _stat_value(stat: str | None, key: str) -> int:
    for line in (stat or "").splitlines():
        name, _, value = line.partition(" ")
        if name == key:
            return int(value)
    return 0


def memory_usage() -> tuple[int, int] | None:
    """(working_set_bytes, limit_bytes) for this container, or None if unknown.

    Working set = usage minus reclaimable page cache, the same number the
    kernel's OOM killer effectively compares against the limit. Reads cgroup v2,
    then v1; returns None off Linux. MEMORY_LIMIT_MB overrides the limit when
    the cgroup reports none."""
    for base, current, maximum, inactive in (
        ("/sys/fs/cgroup", "memory.current", "memory.max", "inactive_file"),
        ("/sys/fs/cgroup/memory", "memory.usage_in_bytes", "memory.limit_in_bytes", "total_inactive_file"),
    ):
        used = _read(f"{base}/{current}")
        if used is None:
            continue
        try:
            working_set = int(used) - _stat_value(_read(f"{base}/memory.stat"), inactive)
            raw_limit = (_read(f"{base}/{maximum}") or "max").strip()
            limit = None if raw_limit == "max" else int(raw_limit)
        except ValueError:
            return None
        if limit is None or limit > 1 << 50:  # v1 reports "unlimited" as ~2^63
            override = os.getenv("MEMORY_LIMIT_MB", "").strip()
            limit = int(override) << 20 if override.isdigit() else None
        return (working_set, limit) if limit else None
    return None


def _check(reported_stuck: set[int]) -> None:
    mem = memory_usage()
    if mem:
        used, limit = mem
        if used >= limit * MEMORY_WARN_FRACTION:
            logger.warning("memory at %.0f%% of limit (%s MB / %s MB)", 100 * used / limit, used >> 20, limit >> 20)
            alerts.notify(
                f"Memory at {used / limit:.0%} of limit",
                f"{used >> 20} MB of {limit >> 20} MB. Render kills the process at 100%, "
                f"failing every request below.\n\nIn flight:\n{inflight_summary()}",
                key="memory:high",
            )

    now = time.monotonic()
    for rid, (label, started) in list(_inflight.items()):
        if now - started > STUCK_SECONDS and rid not in reported_stuck:
            reported_stuck.add(rid)
            logger.warning("request hung for %.0fs: %s", now - started, label)
            alerts.notify(
                f"Request hung {now - started:.0f}s: {label}",
                f"Still running, no response sent.\n\nIn flight:\n{inflight_summary()}",
                key=f"stuck:{label}",
            )
    reported_stuck.intersection_update(_inflight)


async def watch_loop() -> None:
    reported_stuck: set[int] = set()
    while True:
        try:
            await asyncio.sleep(CHECK_SECONDS)
            _check(reported_stuck)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("health watch tick failed; continuing")


def notify_startup() -> None:
    """Info ping on every boot. One you didn't deploy means the last process
    died — on Render that is almost always the out-of-memory killer."""
    commit = (os.getenv("RENDER_GIT_COMMIT") or "unknown")[:7]
    alerts.notify(
        f"Server started (commit {commit})",
        "If you didn't just deploy, the previous process crashed or was killed "
        "(most likely out of memory). Check Render > Events.",
        key="startup",
        urgent=False,
    )
