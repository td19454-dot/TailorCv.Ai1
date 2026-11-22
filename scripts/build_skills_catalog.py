"""Build static/skills_catalog.json — the "search all skills" list on /onboarding.

Source: skill_categories.TERM_INDEX, the vocabulary the resume pipeline already
groups skills with (spoken languages and generic phrases left out). Its terms
are stored lowercase, so each is given its conventional spelling here: the
display forms functions.py already uses, then the overrides below, then
"short = acronym" (SQL, AWS, ETL) unless it is a word (Git, Flask), else
capitalised words.

Run:  python scripts/build_skills_catalog.py
Re-run whenever skill_categories.py gains terms.
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import skill_categories as sc  # noqa: E402

# Conventional spellings that no rule produces.
OVERRIDES = {
    "numpy": "NumPy", "scipy": "SciPy", "spacy": "spaCy", "pypdf": "pypdf", "pyqt": "PyQt",
    "mysql": "MySQL", "nosql": "NoSQL", "mssql": "MS SQL", "plsql": "PL/SQL", "pl/sql": "PL/SQL",
    "tsql": "T-SQL", "t-sql": "T-SQL", "postgresql": "PostgreSQL", "postgres": "Postgres",
    "mongodb": "MongoDB", "sqlite": "SQLite", "graphql": "GraphQL", "rxjs": "RxJS", "mobx": "MobX",
    "vuejs": "Vue.js", "vue": "Vue", "htmx": "htmx", "grpc": "gRPC", "wandb": "W&B", "macos": "macOS",
    "ocaml": "OCaml", "latex": "LaTeX", "owasp": "OWASP", "javascript": "JavaScript",
    "typescript": "TypeScript", "github": "GitHub", "gitlab": "GitLab", "bitbucket": "Bitbucket",
    "pytorch": "PyTorch", "tensorflow": "TensorFlow", "scikit-learn": "scikit-learn",
    "opencv": "OpenCV", "openai": "OpenAI", "langchain": "LangChain", "llamaindex": "LlamaIndex",
    "fastapi": "FastAPI", "nodejs": "Node.js", "node.js": "Node.js", "nextjs": "Next.js",
    "next.js": "Next.js", "nuxt": "Nuxt", "reactjs": "React", "jquery": "jQuery",
    "powerbi": "Power BI", "power bi": "Power BI", "tableau": "Tableau", "devops": "DevOps",
    "mlops": "MLOps", "llmops": "LLMOps", "dataops": "DataOps", "devsecops": "DevSecOps",
    "c#": "C#", "c++": "C++", "f#": "F#", "objective-c": "Objective-C", "vb.net": "VB.NET",
    "asp.net": "ASP.NET", ".net": ".NET", "ios": "iOS", "ipados": "iPadOS", "iot": "IoT",
    "oauth": "OAuth", "oops": "OOPs", "tfidf": "TF-IDF", "qlora": "QLoRA", "lora": "LoRA",
    "pnpm": "pnpm", "npm": "npm", "pip": "pip", "xai": "XAI", "vllm": "vLLM", "dspy": "DSPy",
    "onnx": "ONNX", "huggingface": "Hugging Face", "hugging face": "Hugging Face",
    "chatgpt": "ChatGPT", "gpt-4": "GPT-4", "bigquery": "BigQuery", "dynamodb": "DynamoDB",
    "elasticsearch": "Elasticsearch", "cloudformation": "CloudFormation", "javafx": "JavaFX",
    "phpmyadmin": "phpMyAdmin", "wordpress": "WordPress", "webgl": "WebGL", "websocket": "WebSocket",
    "websockets": "WebSockets", "webrtc": "WebRTC", "mathematica": "Mathematica", "xgboost": "XGBoost",
    "lightgbm": "LightGBM", "catboost": "CatBoost", "pyspark": "PySpark", "sparksql": "Spark SQL",
    "matlab": "MATLAB", "sass": "Sass", "scss": "SCSS", "regex": "Regex", "json": "JSON",
    "yaml": "YAML", "rest": "REST", "rest apis": "REST APIs", "restful apis": "RESTful APIs",
    "llms": "LLMs", "apis": "APIs", "vlms": "VLMs", "ci/cd": "CI/CD", "systemverilog": "SystemVerilog",
    "rabbitmq": "RabbitMQ", "timescaledb": "TimescaleDB", "cockroachdb": "CockroachDB",
    "typeorm": "TypeORM", "langgraph": "LangGraph", "langsmith": "LangSmith", "powerpoint": "PowerPoint",
    "sharepoint": "SharePoint", "onedrive": "OneDrive", "mariadb": "MariaDB", "couchdb": "CouchDB",
    "influxdb": "InfluxDB", "clickhouse": "ClickHouse", "neo4j": "Neo4j", "pandas": "Pandas",
    "pydantic": "Pydantic", "sqlalchemy": "SQLAlchemy", "jupyter": "Jupyter", "devtools": "DevTools",
    "javafx": "JavaFX", "netsuite": "NetSuite", "quickbooks": "QuickBooks", "hubspot": "HubSpot",
    "salesforce": "Salesforce", "servicenow": "ServiceNow", "wireshark": "Wireshark",
    "payu": "PayU", "github actions": "GitHub Actions", "gitlab ci": "GitLab CI",
}

# Acronyms that appear inside multi-word names ("Azure SQL", "Explainable AI").
ACRONYMS_EXTRA = {
    "ai", "ml", "api", "ui", "ux", "sdk", "db", "ci", "cd", "http", "ide", "cli", "os", "qa", "kpi", "seo",
    "bi", "gpu", "cpu", "nlp", "llm", "sql", "aws", "gcp", "etl", "elt", "crm", "erp", "iam", "vpc", "rds",
    "ec2", "s3", "ecs", "eks", "aks", "gke", "iot", "jwt", "sso", "saml", "tcp", "udp", "dns", "ssl", "tls",
    "html", "css", "xml", "json", "rest", "soap", "mvc", "oop", "tdd", "bdd", "cnn", "rnn", "gan", "lstm",
    "ocr", "nlu", "asr", "tts", "rag", "pdf", "sap", "sas", "spss", "vba", "ab", "a/b", "hr", "pm",
    "ats", "iq", "zap", "gpt", "ad", "id", "ar", "vr", "erp", "qa",
}

# Short terms that are words or names, not acronyms.
WORDS = {
    "agile", "apex", "asana", "audit", "azure", "babel", "bash", "beam", "bicep", "bokeh", "chai",
    "chef", "cisco", "colab", "comet", "conda", "dart", "dash", "dask", "excel", "faiss", "feast",
    "fiber", "figma", "flask", "flax", "flink", "gin", "git", "glove", "glue", "go", "hbase", "heap",
    "helm", "hive", "ionic", "istio", "java", "jest", "jinja", "jira", "julia", "junit", "kafka",
    "keras", "kivy", "lean", "lime", "linux", "lisp", "lua", "luigi", "make", "maven", "miro",
    "mocha", "neon", "nginx", "nifi", "nmap", "perl", "polar", "proxy", "qlik", "rails", "ray",
    "react", "realm", "redis", "redux", "remix", "ruby", "rust", "sage", "safe", "scala", "scrum",
    "shap", "shell", "snort", "soap", "solr", "spark", "stata", "swift", "tauri", "tax", "timm",
    "trino", "unity", "unix", "vespa", "vim", "visio", "vite", "word", "xcode", "xero", "yarn",
    "emacs", "cmake", "payu", "adyen", "eikon", "cobol", "actix", "zsh",
}


# Single-word acronyms the vocabulary itself holds (short, not a word) — reused
# for the same token inside longer names.
ACRONYMS = ACRONYMS_EXTRA | {
    t for t in sc.TERM_INDEX
    if " " not in t and t.isalpha() and len(t) <= 4 and t not in WORDS
}


def display(term: str) -> str:
    key = term.strip().lower()
    if key in OVERRIDES:
        return OVERRIDES[key]
    try:
        from functions import _SKILL_DISPLAY_FORMS  # the pipeline's own spellings
        if key in _SKILL_DISPLAY_FORMS:
            return _SKILL_DISPLAY_FORMS[key]
    except Exception:
        pass
    words = key.split()
    if len(words) == 1:
        w = words[0]
        bare = re.sub(r"[^a-z]", "", w)
        if bare and len(bare) <= 4 and bare == w and w not in WORDS:
            return w.upper()                         # SQL, AWS, ETL, CI, CD
        return w[:1].upper() + w[1:]
    out = []
    for w in words:
        if out and w in {"and", "of", "for", "with", "to", "in", "on", "the", "or", "a", "an", "by", "via"}:
            out.append(w)                            # "Ruby on Rails", not "Ruby ON Rails"
        elif w in OVERRIDES:
            out.append(OVERRIDES[w])
        elif w in ACRONYMS:
            out.append(w.upper())                    # "Azure SQL", "Explainable AI"
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def build() -> list[str]:
    seen, out = set(), []
    # Broad areas ("Machine Learning", "Data Analysis") are real answers on a
    # skills form, so they are listed too — only spoken languages are left out.
    terms = {t: c for t, c in sc.TERM_INDEX.items()}
    for t in sc._GENERIC_PHRASE_TERMS:
        terms.setdefault(sc._normalize(t), "generic")
    for term, category in sorted(terms.items()):
        if category == sc.HUMAN_LANGUAGE:
            continue
        name = display(term)
        if name.lower() not in seen:
            seen.add(name.lower())
            out.append(name)
    return sorted(out, key=str.lower)


if __name__ == "__main__":
    skills = build()
    path = os.path.join(ROOT, "static", "skills_catalog.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(skills, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(skills)} skills -> {path}")
