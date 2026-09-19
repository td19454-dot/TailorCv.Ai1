from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class UserSignup(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    code: str = Field(min_length=4, max_length=12)


class UserLogin(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)


class UserLoginVerify(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)


class SignupCodeRequest(BaseModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=12)
    password: str = Field(min_length=6, max_length=128)


class SaveJobRequest(BaseModel):
    jobId: int


class LogApplicationRequest(BaseModel):
    jobId: int
    method: Literal["manual", "auto"]


class AutoApplyRequest(BaseModel):
    jobId: int


class ApplyProfileRequest(BaseModel):
    """The answer bank auto-apply fills forms from. Every field is optional here
    so the modal can be saved incrementally; validate_profile() decides which
    ones a run actually requires."""
    phone: str = Field(default="", max_length=40)
    location: str = Field(default="", max_length=160)
    linkedinUrl: str = Field(default="", max_length=300)
    githubUrl: str = Field(default="", max_length=300)
    portfolioUrl: str = Field(default="", max_length=300)

    workAuthorized: Literal["", "yes", "no"] = ""
    requiresSponsorship: Literal["", "yes", "no"] = ""
    visaStatus: str = Field(default="", max_length=60)
    willingToRelocate: Literal["", "yes", "no"] = ""
    remotePreference: Literal["", "remote", "hybrid", "onsite", "flexible"] = ""
    yearsExperience: str = Field(default="", max_length=20)
    currentTitle: str = Field(default="", max_length=120)
    noticePeriod: str = Field(default="", max_length=60)
    expectedSalary: str = Field(default="", max_length=60)
    availableStartDate: str = Field(default="", max_length=60)
    howDidYouHear: str = Field(default="", max_length=120)
    whyThisRole: str = Field(default="", max_length=2000)

    gender: str = Field(default="", max_length=60)
    raceEthnicity: str = Field(default="", max_length=80)
    veteranStatus: str = Field(default="", max_length=80)
    disabilityStatus: str = Field(default="", max_length=80)
    genderPronouns: str = Field(default="", max_length=40)
    lgbtqIdentity: str = Field(default="", max_length=60)

    agreeToEmployerTerms: bool = False
    consent: bool = False


class QAAnswerItem(BaseModel):
    """One answer to a question a job application form asked that auto-apply
    couldn't resolve from the fixed profile fields — saved to UserApplyQA so
    the same (or a similarly-worded) question resolves automatically next time.
    Real EEO/compliance questions run well past a "label"-length string —
    e.g. a real Robinhood conflict-of-interest question observed in practice
    was 538 characters — so this is bounded generously, not tightly."""
    question: str = Field(min_length=1, max_length=2000)
    answer: str = Field(min_length=1, max_length=2000)


class RunAnswersRequest(BaseModel):
    answers: list[QAAnswerItem] = Field(min_length=1, max_length=25)


class ApplyAnswersRequest(BaseModel):
    """Answers the user typed into the Chrome extension's autofill panel.

    Separate from RunAnswersRequest, which is tied to an auto_apply_runs row
    that must be in needs_input state; a client-side fill has no run at all.
    Same storage, same per-item bounds.
    """
    answers: list[QAAnswerItem] = Field(min_length=1, max_length=25)


class AutofillField(BaseModel):
    """One form field the extension found and could not answer for itself.

    `label`, `kind` and `options` are all the server ever learns about the page —
    never a value read out of it. `sensitive` is advisory: the server re-derives
    it (auto_apply/match_guard.classify_sensitive) and ORs the two, so a request
    cannot unlock a field by claiming it is ordinary.
    """
    i: int = Field(ge=0, le=999)
    label: str = Field(min_length=1, max_length=2000)
    kind: str = Field(default="text", max_length=40)
    required: bool = False
    sensitive: bool = False
    neverFill: bool = False
    documentSlot: str | None = Field(default=None, max_length=40)
    # Bounded generously: a country picker legitimately has ~250 entries, and the
    # server truncates to what it will actually put in the prompt.
    options: list[str] = Field(default_factory=list, max_length=300)


class AutofillPlanRequest(BaseModel):
    url: str = Field(default="", max_length=2000)
    host: str = Field(default="", max_length=253)
    ats: str = Field(default="generic", max_length=40)
    jobTitle: str = Field(default="", max_length=300)
    jobCompany: str = Field(default="", max_length=300)
    jdExcerpt: str = Field(default="", max_length=2000)
    fields: list[AutofillField] = Field(default_factory=list, max_length=200)
