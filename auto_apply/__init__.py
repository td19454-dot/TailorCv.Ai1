"""Auto-apply: fill and submit job applications in a Browserbase cloud browser.

Layered so the heavy, optional dependencies stay isolated:

  config.py   stdlib only — safe to import at module scope anywhere
  profile.py  stdlib + functions.py — builds the answer bank from the user's
              stored profile and resume
  browser.py  the ONLY module importing stagehand/playwright, imported lazily
  runner.py   orchestration; imports browser.py, so import it inside a function

Importing this package must never require stagehand or playwright to be
installed — the app has to boot and serve the dashboard without them.
"""

from auto_apply.config import (  # noqa: F401
    availability,
    deps_installed,
    free_monthly_cap,
    job_supported,
    pro_monthly_cap,
    submit_enabled,
)

__all__ = [
    "availability",
    "deps_installed",
    "free_monthly_cap",
    "job_supported",
    "pro_monthly_cap",
    "submit_enabled",
]
