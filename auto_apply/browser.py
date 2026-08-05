"""The only module that imports stagehand and playwright.

Both are imported lazily inside functions so the app boots without them, and
everything version-sensitive about the Stagehand SDK is quarantined behind
RemoteBrowser. The SDK has shipped two shapes: v3 returns a bound session
object (session.navigate(...)), earlier builds keep the client and pass an id
(client.sessions.execute(id=...)). open_browser() probes for whichever the
installed version exposes; callers see one interface either way.
"""

from __future__ import annotations

import asyncio
import logging
import platform
import threading
from typing import Any, Coroutine

import httpx

from auto_apply import config

logger = logging.getLogger(__name__)

BROWSERBASE_API = "https://api.browserbase.com/v1"
CDP_ENDPOINT = "wss://connect.browserbase.com"

_IS_WINDOWS = platform.system() == "Windows"

# Playwright's async API spawns its Node driver as a subprocess, which needs
# ProactorEventLoop on Windows — SelectorEventLoop's subprocess transport is
# unimplemented there and raises NotImplementedError. uvicorn forces
# SelectorEventLoop for the worker process whenever --reload or workers>1 is
# used on Windows (its own reload-supervisor requirement), so a plain "uvicorn
# main:app --reload" dev server is incompatible with Playwright out of the
# box. Rather than ask for --reload to be dropped, run Playwright on its own
# dedicated Proactor loop in a background thread, decoupled from whatever loop
# policy the ASGI server ends up with. Linux (production) never hits this —
# every event loop there supports subprocesses — so this only activates on
# Windows and the rest of the app is untouched.
_pw_loop: asyncio.AbstractEventLoop | None = None
_pw_loop_lock = threading.Lock()


def _get_playwright_loop() -> asyncio.AbstractEventLoop:
    global _pw_loop
    if _pw_loop is not None:
        return _pw_loop
    with _pw_loop_lock:
        if _pw_loop is None:
            loop = asyncio.ProactorEventLoop()  # type: ignore[attr-defined]

            def _run() -> None:
                asyncio.set_event_loop(loop)
                loop.run_forever()

            threading.Thread(target=_run, name="playwright-proactor-loop", daemon=True).start()
            _pw_loop = loop
    return _pw_loop


async def _run_playwright(coro: Coroutine) -> Any:
    """Run a Playwright coroutine on a loop that actually supports subprocess
    transports, regardless of which loop is driving the current request."""
    if not _IS_WINDOWS:
        return await coro
    loop = _get_playwright_loop()
    fut = asyncio.run_coroutine_threadsafe(coro, loop)
    return await asyncio.wrap_future(fut)


def _unwrap(response: Any) -> Any:
    """Stagehand wraps results as resp.data.result; tolerate flatter shapes."""
    data = getattr(response, "data", response)
    result = getattr(data, "result", data)
    if hasattr(result, "model_dump"):
        return result.model_dump()
    return result


# extract/act/agent calls send real page content to the model, so a single run
# (page-read, open-form, fill, verify, submit, confirm, maybe a repair pass)
# can burn through an OpenAI account's tokens-per-minute cap in well under a
# minute — especially with more than one run in flight. Stagehand's backend
# already retries a few times internally and, when that's exhausted, reports
# it back as a 422 rather than a clean 429 ("AI_RetryError: ... Rate limit
# reached ... Requested X. Please try again in Yms"). Without a retry here
# that surfaces as the whole run crashing, even though the TPM window resets
# every 60s on its own.
_RETRY_ATTEMPTS = 4
_RETRY_BASE_DELAY = 3.0
_RETRY_MAX_DELAY = 20.0
_TRANSIENT_MARKERS = ("rate limit", "ai_retryerror", "try again", "timed out", "temporarily unavailable")
# "Request too large" is reported through the same AI_RetryError wrapper as a
# genuine rate limit, but it isn't transient — a heavy, JS-rendered page (seen
# in practice: one Lever posting alone needed 54k tokens against a 30k/min
# cap) produces the same oversized payload on every attempt. Retrying just
# wastes the backoff window before failing identically; check for this first.
_PERMANENT_MARKERS = ("request too large", "must be reduced")


def _is_transient(exc: Exception) -> bool:
    import stagehand

    # 5xx / connection / timeout errors are Stagehand's own backend or the
    # network having a bad moment, not a judgment about the request — nearly
    # always worth a retry regardless of what the (often generic, e.g. "An
    # internal server error occurred") message says.
    if isinstance(exc, (stagehand.InternalServerError, stagehand.APIConnectionError)):
        return True
    text = str(exc).lower()
    if any(m in text for m in _PERMANENT_MARKERS):
        return False
    return any(m in text for m in _TRANSIENT_MARKERS)


class RemoteBrowser:
    """One Browserbase session, with the SDK-shape differences absorbed."""

    def __init__(self, client: Any, session: Any, session_id: str, bound: bool):
        self._client = client
        self._session = session
        self._bound = bound  # True: session.act(...); False: client.sessions.act(id=...)
        self.session_id = session_id
        self.live_view_url: str | None = None
        self.replay_url: str | None = f"https://browserbase.com/sessions/{session_id}" if session_id else None

    # ── SDK shape shim ────────────────────────────────────────────────────
    async def _call(self, name: str, **kwargs) -> Any:
        import stagehand

        async def invoke() -> Any:
            if self._bound:
                return await getattr(self._session, name)(**kwargs)
            return await getattr(self._client.sessions, name)(id=self.session_id, **kwargs)

        delay = _RETRY_BASE_DELAY
        for attempt in range(_RETRY_ATTEMPTS):
            try:
                return await invoke()
            except stagehand.APIError as exc:
                is_last = attempt == _RETRY_ATTEMPTS - 1
                if is_last or not _is_transient(exc):
                    raise
                logger.warning(
                    "stagehand.%s hit a transient error (attempt %s/%s), retrying in %.0fs: %s",
                    name, attempt + 1, _RETRY_ATTEMPTS, delay, exc,
                )
                await asyncio.sleep(delay)
                delay = min(_RETRY_MAX_DELAY, delay * 2)

    # ── Operations ────────────────────────────────────────────────────────
    async def navigate(self, url: str) -> None:
        await self._call("navigate", url=url)

    async def act(self, instruction: str) -> Any:
        return await self._call("act", input=instruction)

    async def observe(self, instruction: str) -> Any:
        return _unwrap(await self._call("observe", instruction=instruction))

    async def extract(self, instruction: str, schema: dict) -> dict:
        resp = await self._call("extract", instruction=instruction, schema=schema)
        result = _unwrap(resp)
        return result if isinstance(result, dict) else {}

    async def agent(
        self,
        instruction: str,
        system_prompt: str,
        max_steps: int = 50,
        timeout: float = 300.0,
    ) -> Any:
        return _unwrap(
            await self._call(
                "execute",
                execute_options={"instruction": instruction, "max_steps": max_steps},
                agent_config={"model": config.model_name(), "system_prompt": system_prompt},
                timeout=timeout,
            )
        )

    async def upload_resume(self, resume_path: str) -> bool:
        """Attach the resume PDF by driving the file input directly over CDP.

        The browser agent cannot do this — a file picker is an OS dialog, not a
        DOM interaction. So we attach Playwright to the *same* Browserbase
        session and call set_input_files ourselves.

        Two details that matter: the form is usually inside an iframe on
        Greenhouse/Lever, so every frame is searched; and the input is very
        often display:none, so set_input_files goes to the element handle
        (page.set_input_files(selector) applies visibility checks and would
        fail on exactly the inputs we need).
        """
        try:
            return await _run_playwright(self._upload_resume_impl(resume_path))
        except Exception:
            logger.exception("resume upload over CDP failed for session %s", self.session_id)
            return False

    async def _upload_resume_impl(self, resume_path: str) -> bool:
        from playwright.async_api import async_playwright

        key = config.browserbase_api_key()
        cdp_url = f"{CDP_ENDPOINT}?apiKey={key}&sessionId={self.session_id}"
        async with async_playwright() as p:
            # Deliberately never call browser.close() here. For a browser
            # obtained via connect_over_cdp, Playwright's own docs say close()
            # "clears all created contexts belonging to this browser" — not a
            # soft disconnect. Since we're attaching to Stagehand's *existing*
            # context/page (not one we created), that would tear down the very
            # page the agent needs for every step after this one — exactly
            # what showed up as "Debugging connection was closed" in the live
            # view, on every run, right after the upload. Letting the `async
            # with async_playwright()` block exit just stops our local driver
            # connection without touching the remote session.
            browser = await p.chromium.connect_over_cdp(cdp_url)
            contexts = browser.contexts
            if not contexts:
                return False
            ctx = contexts[0]
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()

            # Upload to every file input on the page, not just the first.
            # Ashby (among others) has TWO: a convenience "Autofill from
            # resume" uploader that only pre-fills text fields, and a
            # separate REQUIRED "Resume*" input that's the actual attachment.
            # Stopping at the first successful upload attached the file to
            # the wrong one, left the required field empty, and the agent
            # can't fix that in a repair pass — it's explicitly forbidden
            # from touching file inputs, since a file picker isn't something
            # act() can drive. Uploading to every input found is harmless —
            # a convenience uploader just re-parses the same PDF it already
            # would have — and is the only way to guarantee the real one
            # gets it too.
            uploaded_any = False
            for frame in [page.main_frame, *page.frames]:
                try:
                    handles = await frame.query_selector_all('input[type="file"]')
                except Exception:
                    continue
                for handle in handles:
                    try:
                        await handle.set_input_files(resume_path)
                        uploaded_any = True
                    except Exception:
                        continue
            if uploaded_any:
                await asyncio.sleep(1.5)  # let the ATS parse/echo the upload(s)
            return uploaded_any

    async def end(self) -> None:
        try:
            if self._bound and hasattr(self._session, "end"):
                await self._session.end()
            else:
                await self._client.sessions.end(id=self.session_id)
        except Exception:
            logger.warning("could not cleanly end Browserbase session %s", self.session_id, exc_info=True)


def _session_id_of(session: Any) -> str:
    for attr in ("id", "session_id", "sessionId"):
        value = getattr(session, attr, None)
        if isinstance(value, str) and value:
            return value
    data = getattr(session, "data", None)
    if data is not None:
        for attr in ("id", "session_id", "sessionId"):
            value = getattr(data, attr, None)
            if isinstance(value, str) and value:
                return value
    return ""


async def _fetch_live_view_url(session_id: str) -> str | None:
    """Best-effort. A missing live-view URL costs the user a convenience link,
    so it must never fail the run."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                f"{BROWSERBASE_API}/sessions/{session_id}/debug",
                headers={"X-BB-API-Key": config.browserbase_api_key()},
            )
            if r.status_code != 200:
                return None
            payload = r.json()
        url = payload.get("debuggerFullscreenUrl") or payload.get("debuggerUrl")
        return url or None
    except Exception:
        logger.debug("live view URL unavailable for %s", session_id, exc_info=True)
        return None


async def open_browser() -> RemoteBrowser:
    """Start a Browserbase session. Raises if the SDK or credentials are absent."""
    from stagehand import AsyncStagehand

    client = AsyncStagehand(
        browserbase_api_key=config.browserbase_api_key(),
        model_api_key=config.model_api_key(),
    )

    session: Any = None
    bound = True
    starter = getattr(client.sessions, "create", None) or getattr(client.sessions, "start", None)
    if starter is None:
        raise RuntimeError("Installed stagehand SDK exposes neither sessions.create nor sessions.start")

    # Without an explicit timeout, Browserbase applies its own platform
    # default — observed in practice to be well under 7 minutes, which a real
    # multi-field ATS form (fill + verify + repair pass + submit) can exceed.
    # When that happens the session dies mid-run with an abrupt 410 ("session
    # has completed or timed out") instead of our own run_timeout_seconds()
    # ever getting a chance to fire cleanly. Give the session comfortably more
    # room than our own budget so ours is always the one that trips first.
    bb_params: dict[str, Any] = {"timeout": config.run_timeout_seconds() + 120}
    project_id = config.browserbase_project_id()
    if project_id:
        bb_params["project_id"] = project_id

    session = await starter(model_name=config.model_name(), browserbase_session_create_params=bb_params)
    session_id = _session_id_of(session)
    if not session_id:
        raise RuntimeError("Browserbase session started but returned no session id")

    # v3 returns a session object carrying the operations; older builds return a
    # plain response and expect client.sessions.<op>(id=...).
    if not hasattr(session, "navigate"):
        bound = False

    browser = RemoteBrowser(client, session, session_id, bound)
    browser.live_view_url = await _fetch_live_view_url(session_id)
    return browser
