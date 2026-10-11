"""Lifetime free-tier allowance per feature, enforced by enforce_quota() in main.py."""

FREE_LIMITS: dict[str, int] = {
    # Lowered from 3 to 2 to 1 as model costs rose, raised back to 2 (Oct 2026).
    # The download popup reads this number rather than hardcoding it, so the
    # copy follows automatically.
    "ai_optimizations": 2,
    "cover_letters": 2,
    "linkedin_imports": 1,
    "mock_interviews": 1,
    "interview_questions": 1,
    # Extension autofill: 10 applications filled, ever, then Pro. Priced low
    # because a fill is one small LLM call in the user's own browser — unlike
    # auto_applies, which has its own monthly cap (enforce_auto_apply_quota)
    # because every run burns a cloud browser session and applies to Pro too.
    "autofills": 10,
    "ats_scans": 3,
    "cv_uploads": 1,
    "template_changes": 1,
}
