"""Regression tests for Skills-section categorization.

Covers group_skills() in main.py and the skill_categories taxonomy behind it:
every item must land on the row a hiring manager would expect, non-skills
("proficient") must be dropped, compounds ("HTML/CSS") split only when every
part is a real skill, and "Other Technical Skills" must hold only genuine
leftovers. No external services and no API keys required.

Run:  python test_skill_grouping.py
Exit code is non-zero if any test fails (CI-friendly).
"""

import sys
import traceback

import main
import skill_categories as skillcat

L, AI, FW, DB = skillcat.LANGUAGES, skillcat.AI_ML, skillcat.FRAMEWORKS, skillcat.DATABASES
TOOLS, CLOUD, NET, SEC = skillcat.TOOLS, skillcat.CLOUD, skillcat.NETWORKING, skillcat.SECURITY
ANALYTICS, OTHER = skillcat.ANALYTICS, skillcat.OTHER


def rows(skills: list[str]) -> dict[str, list[str]]:
    out = {}
    for line in main.group_skills(skills):
        label, _, items = line.partition(":")
        out[label.strip()] = [i.strip() for i in items.split(",") if i.strip()]
    return out


def expect(result: dict[str, list[str]], placements: dict[str, list[str]]) -> None:
    """Assert every item sits on its expected row and appears exactly once."""
    problems = []
    everything = [item for items in result.values() for item in items]
    for label, items in placements.items():
        for item in items:
            where = [lbl for lbl, vals in result.items() if item in vals]
            if where != [label]:
                problems.append(f"{item!r}: expected [{label}], got {where}")
    dupes = {i for i in everything if everything.count(i) > 1}
    if dupes:
        problems.append(f"duplicated across rows: {sorted(dupes)}")
    assert not problems, "\n      ".join([""] + problems + [f"rows: {result}"])


def assert_other_is_genuine(result: dict[str, list[str]]) -> None:
    for item in result.get(OTHER, []):
        category = skillcat.classify_skill(item)[0][1]
        assert category in (OTHER, None), f"{item!r} is in Other but classifies as {category}"


SCREENSHOT_LABELLED = [
    "Languages: Python, C, Java",
    "Frameworks/Libraries: TensorFlow, Keras, LangChain, spaCy, scikit-learn, pandas, NumPy, "
    "Node.js, React, Streamlit, Django, Flask, Bootstrap, OpenCV, PyTorch, Spark, REST APIs",
    "Databases: MongoDB, MySQL, Firebase",
    "Tools & Platforms: Git, MLflow, Kubeflow, Airflow",
    "Cloud & DevOps: Docker, Kubernetes, AWS, GCP, Azure",
    "Other Technical Skills: Tesseract OCR, PyPDF2, RegEx, LaTeX, Hugging Face Transformers, "
    "proficient, HTML/CSS, MaterialUI, LagGraph, Stable-Baselines3, PineconeDB, TorchServe, "
    "TF Serving, Dask",
]

SCREENSHOT_EXPECTED = {
    L: ["Python", "C", "Java", "LaTeX", "HTML", "CSS"],
    AI: ["TensorFlow", "Keras", "LangChain", "spaCy", "scikit-learn", "OpenCV", "PyTorch",
         "MLflow", "Kubeflow", "Tesseract OCR", "Hugging Face Transformers", "LagGraph",
         "Stable-Baselines3", "TorchServe", "TF Serving"],
    FW: ["pandas", "NumPy", "Node.js", "React", "Streamlit", "Django", "Flask", "Bootstrap",
         "Spark", "PyPDF2", "MaterialUI", "Dask"],
    DB: ["MongoDB", "MySQL", "Firebase", "PineconeDB"],
    TOOLS: ["Git", "Airflow"],
    CLOUD: ["Docker", "Kubernetes", "AWS", "GCP", "Azure"],
    OTHER: ["REST APIs", "RegEx"],
}


# --------------------------------------------------------------------------- #
# The reported resume
# --------------------------------------------------------------------------- #
def test_screenshot_labelled():
    result = rows(SCREENSHOT_LABELLED)
    expect(result, SCREENSHOT_EXPECTED)
    assert "proficient" not in str(result).lower(), result
    assert sorted(result[OTHER]) == sorted(SCREENSHOT_EXPECTED[OTHER]), result[OTHER]


def test_screenshot_flat():
    flat = [i.strip() for line in SCREENSHOT_LABELLED
            for i in line.split(":", 1)[1].split(",") if i.strip()]
    result = rows(flat)
    expect(result, SCREENSHOT_EXPECTED)
    assert "proficient" not in str(result).lower(), result


# --------------------------------------------------------------------------- #
# Realistic stacks
# --------------------------------------------------------------------------- #
def test_frontend_stack():
    result = rows(["React", "TypeScript", "JavaScript (ES6+)", "Tailwind CSS", "MUI",
                   "Redux Toolkit", "Next.js", "Jest", "Cypress", "Storybook", "Vite",
                   "Figma", "Vercel", "GraphQL", "HTML5", "CSS3", "SCSS"])
    expect(result, {
        L: ["TypeScript", "JavaScript (ES6+)", "HTML5", "CSS3", "SCSS"],
        FW: ["React", "Tailwind CSS", "MUI", "Redux Toolkit", "Next.js"],
        TOOLS: ["Jest", "Cypress", "Storybook", "Vite", "Figma"],
        CLOUD: ["Vercel"],
        OTHER: ["GraphQL"],
    })


def test_backend_stack():
    result = rows(["Java", "Spring Boot", "Hibernate", "PostgreSQL", "Redis", "Apache Kafka",
                   "RabbitMQ", "Docker", "Kubernetes", "Jenkins", "GitHub Actions", "JUnit",
                   "Mockito", "Microservices", "gRPC", "Maven", "AWS Lambda", "Amazon S3"])
    expect(result, {
        L: ["Java"],
        FW: ["Spring Boot", "Hibernate"],
        DB: ["PostgreSQL", "Redis"],
        TOOLS: ["Apache Kafka", "RabbitMQ", "Jenkins", "GitHub Actions", "JUnit", "Mockito",
                "Maven"],
        CLOUD: ["Docker", "Kubernetes", "AWS Lambda", "Amazon S3"],
        OTHER: ["Microservices", "gRPC"],
    })


def test_data_engineering_stack():
    result = rows(["Python", "SQL", "PySpark", "Apache Airflow", "dbt", "Snowflake",
                   "BigQuery", "Databricks", "Kafka", "Terraform", "Great Expectations",
                   "Pandas", "ETL", "Data Warehousing", "Tableau", "AWS Glue"])
    expect(result, {
        L: ["Python", "SQL"],
        FW: ["PySpark", "Pandas"],
        DB: ["Snowflake", "BigQuery", "Databricks"],
        TOOLS: ["Apache Airflow", "dbt", "Kafka", "Great Expectations", "Tableau"],
        CLOUD: ["Terraform", "AWS Glue"],
        ANALYTICS: ["ETL", "Data Warehousing"],
    })


def test_devops_stack():
    result = rows(["Terraform", "Ansible", "Kubernetes", "Helm", "Argo CD", "Prometheus",
                   "Grafana", "Datadog", "Linux", "Bash", "Nginx", "AWS", "EKS", "Istio",
                   "GitLab CI", "Python", "CI/CD", "ELK Stack"])
    expect(result, {
        L: ["Bash", "Python"],
        CLOUD: ["Terraform", "Ansible", "Kubernetes", "Helm", "Linux", "Nginx", "AWS", "EKS",
                "Istio", "CI/CD"],
        TOOLS: ["Argo CD", "Prometheus", "Grafana", "Datadog", "GitLab CI", "ELK Stack"],
    })


def test_ml_llm_stack():
    result = rows(["PyTorch", "Hugging Face", "LangChain", "LlamaIndex", "vLLM", "Ollama",
                   "Pinecone", "FAISS", "Weaviate", "MLflow", "Weights & Biases", "DVC",
                   "Amazon SageMaker", "FastAPI", "Docker",
                   "Retrieval Augmented Generation (RAG)", "LLaMA 3.1", "GPT-4o", "LoRA",
                   "OpenAI API", "YOLOv8", "Transformers"])
    expect(result, {
        AI: ["PyTorch", "Hugging Face", "LangChain", "LlamaIndex", "vLLM", "Ollama", "MLflow",
             "Weights & Biases", "DVC", "Amazon SageMaker",
             "Retrieval Augmented Generation (RAG)", "LLaMA 3.1", "GPT-4o", "LoRA",
             "OpenAI API", "YOLOv8", "Transformers"],
        DB: ["Pinecone", "FAISS", "Weaviate"],
        FW: ["FastAPI"],
        CLOUD: ["Docker"],
    })


def test_mobile_stack():
    result = rows(["Kotlin", "Swift", "Dart", "Flutter", "SwiftUI", "Jetpack Compose",
                   "Android Studio", "Xcode", "Firebase", "SQLite", "REST APIs"])
    expect(result, {
        L: ["Kotlin", "Swift", "Dart"],
        FW: ["Flutter", "SwiftUI", "Jetpack Compose"],
        TOOLS: ["Android Studio", "Xcode"],
        DB: ["Firebase", "SQLite"],
        OTHER: ["REST APIs"],
    })


def test_security_stack():
    result = rows(["Splunk", "Nmap", "Wireshark", "Burp Suite", "Metasploit", "Python",
                   "OWASP Top 10", "SIEM", "TCP/IP", "Incident Response"])
    expect(result, {
        SEC: ["Splunk", "Nmap", "Burp Suite", "Metasploit", "OWASP Top 10", "SIEM",
              "Incident Response"],
        NET: ["Wireshark", "TCP/IP"],
        L: ["Python"],
    })


# --------------------------------------------------------------------------- #
# Edge cases
# --------------------------------------------------------------------------- #
def test_compounds_split_when_every_part_is_a_skill():
    result = rows(["C/C++", "Docker & Kubernetes", "Pandas and NumPy", "Python/Django",
                   "HTML/CSS/JavaScript"])
    expect(result, {
        L: ["C", "C++", "Python", "HTML", "CSS", "JavaScript"],
        CLOUD: ["Docker", "Kubernetes"],
        FW: ["Pandas", "NumPy", "Django"],
    })


def test_compounds_that_must_stay_whole():
    result = rows(["CI/CD", "TCP/IP", "PL/SQL", "A/B Testing", "Weights & Biases"])
    expect(result, {
        CLOUD: ["CI/CD"],
        NET: ["TCP/IP"],
        L: ["PL/SQL"],
        ANALYTICS: ["A/B Testing"],
        AI: ["Weights & Biases"],
    })


def test_level_words_are_dropped():
    result = rows(["proficient", "Experienced", "Advanced", "working knowledge",
                   "Intermediate", "Advanced Excel", "Python"])
    expect(result, {TOOLS: ["Advanced Excel"], L: ["Python"]})
    flat = [i.lower() for items in result.values() for i in items]
    for word in ("proficient", "experienced", "advanced", "working knowledge", "intermediate"):
        assert word not in flat, f"{word!r} survived: {result}"


def test_human_languages_dropped():
    result = rows(["English", "Hindi", "Python", "Languages: French, Java"])
    assert result == {L: ["Python", "Java"]}, result


def test_labelled_items_are_still_classified():
    result = rows(["Languages: Python, React, TensorFlow",
                   "Databases: PostgreSQL, Docker",
                   "Tools: Git, Pinecone"])
    expect(result, {
        L: ["Python"],
        FW: ["React"],
        AI: ["TensorFlow"],
        DB: ["PostgreSQL", "Pinecone"],
        CLOUD: ["Docker"],
        TOOLS: ["Git"],
    })


def test_unknown_items_fall_back_to_their_label_then_other():
    result = rows(["Databases: Aerospike", "Tools: Zapier", "Zapier Tables"])
    expect(result, {DB: ["Aerospike"], TOOLS: ["Zapier"], OTHER: ["Zapier Tables"]})


def test_one_skill_one_row():
    result = rows(["Python", "Languages: Python", "python3", "NLP",
                   "Natural Language Processing (NLP)", "Frameworks: React", "React.js"])
    everything = [i.lower() for items in result.values() for i in items]
    assert sum(i.startswith("python") for i in everything) == 1, result
    assert sum("nlp" in i for i in everything) == 1, result
    assert sum(i.startswith("react") for i in everything) == 1, result


def test_vendor_prefixes_suffixes_and_versions():
    result = rows(["Google BigQuery", "Microsoft Azure", "Amazon DynamoDB", "Apache Spark",
                   "Redis DB", "ReactJS", "Vue 3", "Python 3.11"])
    expect(result, {
        DB: ["Google BigQuery", "Amazon DynamoDB", "Redis DB"],
        CLOUD: ["Microsoft Azure"],
        FW: ["Apache Spark", "ReactJS", "Vue 3"],
        L: ["Python 3.11"],
    })


def test_typos_resolve_to_the_right_row():
    result = rows(["Tensorflw", "Kuberntes", "LagGraph", "Postgressql"])
    expect(result, {AI: ["Tensorflw", "LagGraph"], CLOUD: ["Kuberntes"], DB: ["Postgressql"]})


def test_short_names_are_never_fuzzy_matched():
    # "Go", "C", "R" are real languages; they must not pull in lookalikes.
    for word in ("Ga", "Cx", "Rq"):
        assert skillcat.classify_skill(word)[0][1] != L, word


def test_other_holds_only_genuine_leftovers():
    for fixture in (SCREENSHOT_LABELLED,
                    ["REST APIs", "System Design", "Zapier", "OOP", "JSON", "RegEx"]):
        assert_other_is_genuine(rows(fixture))


def test_no_term_filed_under_two_rows():
    assert not skillcat.DUPLICATE_TERMS, skillcat.DUPLICATE_TERMS


def test_output_format_and_row_order():
    lines = main.group_skills(["Docker", "Python", "React", "MongoDB", "Git", "PyTorch"])
    labels = [line.split(":", 1)[0] for line in lines]
    assert labels == [c for c in skillcat.CATEGORY_ORDER if c in labels], labels
    assert all(": " in line for line in lines), lines
    assert main.group_skills([]) == []
    assert main.group_skills(["", "   "]) == []


tests = [
    test_screenshot_labelled,
    test_screenshot_flat,
    test_frontend_stack,
    test_backend_stack,
    test_data_engineering_stack,
    test_devops_stack,
    test_ml_llm_stack,
    test_mobile_stack,
    test_security_stack,
    test_compounds_split_when_every_part_is_a_skill,
    test_compounds_that_must_stay_whole,
    test_level_words_are_dropped,
    test_human_languages_dropped,
    test_labelled_items_are_still_classified,
    test_unknown_items_fall_back_to_their_label_then_other,
    test_one_skill_one_row,
    test_vendor_prefixes_suffixes_and_versions,
    test_typos_resolve_to_the_right_row,
    test_short_names_are_never_fuzzy_matched,
    test_other_holds_only_genuine_leftovers,
    test_no_term_filed_under_two_rows,
    test_output_format_and_row_order,
]


if __name__ == "__main__":
    passed = failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
            passed += 1
        except Exception:
            print(f"  FAIL  {fn.__name__}")
            traceback.print_exc()
            failed += 1
    print(f"\n{passed}/{passed + failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
