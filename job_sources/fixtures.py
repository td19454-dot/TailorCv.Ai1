"""Fixtures adapter — a representative starter batch of real AI-gig / freelance
platforms so the Gigs board is populated and testable from day one with zero
scraping/legal risk. `apply_url` points to each platform's real application page.
Real per-platform scraping adapters replace/augment this in Phase 2.
"""

from __future__ import annotations

from job_sources import NormalizedJob, register


_GIGS = [
    dict(
        source="mercor", source_job_id="mercor-ai-tutor-coding",
        title="AI Coding Tutor (Freelance, Interview-Based)",
        company="Mercor", category="AI Training",
        apply_url="https://work.mercor.com/",
        pay_text="$25–$50/hr", location="Remote", is_remote=True,
        min_experience="1-3y",
        required_skills=["Python", "JavaScript", "Code Review", "Technical Writing"],
        tags=["coding", "llm", "remote"],
        description=(
            "Help train frontier AI models by reviewing and writing code, evaluating model "
            "outputs, and producing clear technical explanations. Flexible hours. Selection is "
            "via a short skills interview/assessment — typical of interview-based gig platforms."
        ),
    ),
    dict(
        source="outlier", source_job_id="outlier-writing-expert",
        title="AI Writing & Reasoning Expert",
        company="Outlier", category="AI Training",
        apply_url="https://outlier.ai/",
        pay_text="$15–$40/hr", location="Remote", is_remote=True,
        min_experience="entry",
        required_skills=["Writing", "Critical Thinking", "Research", "Editing"],
        tags=["writing", "llm", "flexible"],
        description=(
            "Rate and improve AI-generated text, write high-quality reference answers, and "
            "provide feedback that makes models more helpful and accurate. Work when you want. "
            "Onboarding includes a qualification assessment."
        ),
    ),
    dict(
        source="alignerr", source_job_id="alignerr-stem-expert",
        title="STEM Expert — Math & Science Model Evaluation",
        company="Alignerr", category="AI Training",
        apply_url="https://alignerr.com/",
        pay_text="$20–$60/hr", location="Remote", is_remote=True,
        min_experience="1-3y",
        required_skills=["Mathematics", "Physics", "Chemistry", "Problem Solving"],
        tags=["stem", "math", "science", "remote"],
        description=(
            "Evaluate and correct AI model reasoning on advanced STEM problems. Ideal for "
            "graduates, postgraduates, and educators. Pay scales with expertise; selection "
            "involves a domain interview/assessment."
        ),
    ),
    dict(
        source="fleet", source_job_id="fleet-data-labeling",
        title="Data Labeling & Annotation Specialist",
        company="Fleet", category="Data Labeling",
        apply_url="https://www.fleet.so/",
        pay_text="$12–$22/hr", location="Remote", is_remote=True,
        min_experience="entry",
        required_skills=["Attention to Detail", "Data Annotation", "English"],
        tags=["annotation", "entry-level", "remote"],
        description=(
            "Label images, text, and audio to build high-quality training datasets. Great "
            "entry point into the AI-gig world — no prior experience required, just accuracy "
            "and consistency."
        ),
    ),
    dict(
        source="remotasks", source_job_id="remotasks-image-annotation",
        title="Image & LiDAR Annotation Tasker",
        company="Remotasks (Scale AI)", category="Data Labeling",
        apply_url="https://www.remotasks.com/",
        pay_text="Task-based pay", location="Remote", is_remote=True,
        min_experience="entry",
        required_skills=["Data Annotation", "Attention to Detail", "Computer Basics"],
        tags=["annotation", "lidar", "entry-level"],
        description=(
            "Complete image, video, and LiDAR annotation tasks that power self-driving and "
            "computer-vision models. Training courses provided; earn per completed task."
        ),
    ),
    dict(
        source="dataannotation", source_job_id="dataannotation-ai-trainer",
        title="AI Trainer — Text & Code Feedback",
        company="DataAnnotation", category="AI Training",
        apply_url="https://www.dataannotation.tech/",
        pay_text="$20+/hr", location="Remote", is_remote=True,
        min_experience="entry",
        required_skills=["Writing", "Reading Comprehension", "Basic Coding"],
        tags=["writing", "coding", "flexible"],
        description=(
            "Train AI chatbots by writing prompts, rating responses, and fact-checking. "
            "Flexible, fully remote work with a starter assessment to qualify."
        ),
    ),
    dict(
        source="surge", source_job_id="surge-rlhf-annotator",
        title="RLHF Annotator — Model Preference Data",
        company="Surge AI", category="AI Training",
        apply_url="https://www.surgehq.ai/",
        pay_text="Competitive", location="Remote", is_remote=True,
        min_experience="1-3y",
        required_skills=["Critical Thinking", "Writing", "Research"],
        tags=["rlhf", "llm", "remote"],
        description=(
            "Provide human preference data that fine-tunes large language models through RLHF. "
            "Careful reading and clear judgement matter most."
        ),
    ),
    dict(
        source="prolific", source_job_id="prolific-research-participant",
        title="Paid Research Study Participant",
        company="Prolific", category="Research",
        apply_url="https://www.prolific.com/",
        pay_text="£8–£12/hr equivalent", location="Remote", is_remote=True,
        min_experience="entry",
        required_skills=["Reliability", "English"],
        tags=["research", "surveys", "flexible"],
        description=(
            "Take part in vetted academic and AI research studies and surveys. A simple, "
            "flexible way to earn — studies are screened for fair pay."
        ),
    ),
    dict(
        source="appen", source_job_id="appen-search-evaluator",
        title="Search Quality & AI Data Evaluator",
        company="Appen", category="Data Labeling",
        apply_url="https://www.appen.com/careers",
        pay_text="Project-based", location="Remote", is_remote=True,
        min_experience="entry",
        required_skills=["Attention to Detail", "Local Language", "Internet Research"],
        tags=["evaluation", "search", "remote"],
        description=(
            "Rate search results, social media content, and AI outputs for relevance and "
            "quality across languages. Long-standing crowd-work platform."
        ),
    ),
    dict(
        source="turing", source_job_id="turing-llm-engineer",
        title="Freelance LLM Training Engineer",
        company="Turing", category="AI Training",
        apply_url="https://www.turing.com/jobs",
        pay_text="$40–$90/hr", location="Remote", is_remote=True,
        min_experience="senior",
        required_skills=["Python", "Machine Learning", "PyTorch", "LLM"],
        tags=["engineering", "llm", "senior", "remote"],
        description=(
            "Work on high-value LLM training and evaluation projects for top AI labs. "
            "Rigorous technical interview process — strong software engineering required."
        ),
    ),
]


@register("fixtures")
async def fetch() -> list[NormalizedJob]:
    return [NormalizedJob(**g) for g in _GIGS]
