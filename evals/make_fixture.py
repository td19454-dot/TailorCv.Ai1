"""Turn a real resume PDF into an eval fixture.

    python evals/make_fixture.py uploads/02e1af2e03d045850ceb.pdf --jd samplejd.txt --name analyst_real

Writes evals/fixtures/private/<name>/ with resume.txt, jd.txt and a meta.json
skeleton pre-filled with best-guess counts.

Fixtures land under private/ because that directory is gitignored. Real resumes
are other people's personal data - name, phone, email, employment history - and
must never be committed to the repo. Read the generated meta.json and correct
the counts by hand: the guesses come from the same extraction the pipeline uses,
so an error there would be invisible to the very metric meant to catch it.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

EVAL_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(EVAL_DIR.parent))


def guess_counts(text: str) -> dict:
    """Rough section-entry counts to seed meta.json. Intentionally crude - this
    is a starting point for a human, not ground truth."""
    from functions import _extract_hard_skills_from_jd  # noqa: F401  (import check)

    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    date_like = sum(
        1 for ln in lines
        if any(m in ln for m in ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"))
        and any(y in ln for y in ("19", "20"))
    )
    return {
        "experience": 0,
        "projects": 0,
        "education": 0,
        "certifications": 0,
        "_hint_lines_with_dates": date_like,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Create an eval fixture from a resume PDF.")
    parser.add_argument("pdf", help="path to the resume PDF")
    parser.add_argument("--jd", required=True, help="path to a job description .txt")
    parser.add_argument("--name", required=True, help="fixture name (directory under fixtures/private/)")
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    jd_path = Path(args.jd)
    if not pdf_path.exists():
        print(f"No such PDF: {pdf_path}", file=sys.stderr)
        return 1
    if not jd_path.exists():
        print(f"No such JD: {jd_path}", file=sys.stderr)
        return 1

    from main import extract_pdf_text

    resume_text = extract_pdf_text(str(pdf_path))
    if not resume_text.strip():
        print("Extracted no text from that PDF — is it a scan?", file=sys.stderr)
        return 1

    out_dir = EVAL_DIR / "fixtures" / "private" / args.name
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "resume.txt").write_text(resume_text, encoding="utf-8")
    (out_dir / "jd.txt").write_text(jd_path.read_text(encoding="utf-8"), encoding="utf-8")

    meta_path = out_dir / "meta.json"
    if meta_path.exists():
        print(f"Kept existing {meta_path} (not overwriting your corrections)")
    else:
        meta_path.write_text(json.dumps({
            "name": args.name,
            "notes": "FILL ME IN: what does this fixture test?",
            "_TODO": "Correct expected_counts by hand from the PDF, then delete this key.",
            "expected_counts": guess_counts(resume_text),
            "expected_entry_names": [],
            "unevidenced_jd_skills": [],
        }, indent=2), encoding="utf-8")

    print(f"Wrote {out_dir}")
    print(f"  resume.txt  ({len(resume_text):,} chars)")
    print("\nNow open meta.json and fill in expected_counts, expected_entry_names and")
    print("unevidenced_jd_skills by reading the actual resume — the graders are only")
    print("as honest as that file.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
