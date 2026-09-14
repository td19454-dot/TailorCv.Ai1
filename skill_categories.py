"""Skill taxonomy for the resume's Skills section.

group_skills() in main.py decides which row every skill lands on. It used to do
that with exact-string sets checked in a fixed order, so any spelling nobody had
listed ("Hugging Face Transformers", "PineconeDB", "Tesseract OCR", a typo like
"LagGraph") and any compound ("HTML/CSS") fell into "Other Technical Skills",
and ML libraries sat under Frameworks because that set was checked first.

This module owns the vocabulary and the matching rules instead:
  - one term -> category index, so precedence can't depend on check order
    (DUPLICATE_TERMS lists any term filed under two rows; the tests keep it empty);
  - a cascade of CONFIDENT lookups (exact, full-name/acronym, canonical alias,
    vendor prefix, suffix/version noise, known product families);
  - compound splitting ("HTML/CSS" -> HTML + CSS) only when every part is known;
  - HEURISTIC lookups last (typo-tolerant match, model-name and keyword
    patterns). Callers should drop a heuristic hit that reads as a generic
    phrase - see group_skills().

The displayed text is never rewritten here; only its row is decided.
"""

from __future__ import annotations

import difflib
import re

from functions import canonical_skill_key

LANGUAGES = "Languages"
AI_ML = "AI/ML"
FRAMEWORKS = "Frameworks/Libraries"
DATABASES = "Databases"
TOOLS = "Tools & Platforms"
CLOUD = "Cloud & DevOps"
NETWORKING = "Networking & Protocols"
SECURITY = "Security & SIEM"
METHODOLOGIES = "Methodologies & Practices"
ANALYTICS = "Data & Analytics"
FINANCE = "Finance & Economics"
OTHER = "Other Technical Skills"
# Spoken languages are dropped from the technical Skills section entirely.
HUMAN_LANGUAGE = "human_language"

CATEGORY_ORDER = (
    LANGUAGES, AI_ML, FRAMEWORKS, DATABASES, TOOLS, CLOUD, NETWORKING,
    SECURITY, METHODOLOGIES, ANALYTICS, FINANCE, OTHER,
)

_HUMAN_LANGUAGE_TERMS = {
    "english", "french", "german", "spanish", "hindi", "marathi", "tamil",
    "telugu", "kannada", "malayalam", "punjabi", "urdu", "arabic", "chinese",
    "mandarin", "cantonese", "japanese", "korean", "italian", "portuguese",
    "russian", "bengali", "bangla", "gujarati", "odia", "assamese", "nepali",
    "sinhala", "dutch", "swedish", "norwegian", "danish", "finnish", "polish",
    "turkish", "persian", "farsi", "hebrew", "greek", "indonesian", "malay",
    "vietnamese", "thai", "swahili", "tagalog", "filipino",
}

# Programming, scripting, markup, style-sheet and query languages.
_LANGUAGE_TERMS = {
    "python", "c", "c++", "java", "javascript", "typescript", "sql", "html",
    "css", "r", "go", "golang", "rust", "php", "kotlin", "swift", "scala",
    "perl", "ruby", "matlab", "bash", "shell", "shell scripting",
    "bash scripting", "powershell", "zsh", "c#", "dart", "groovy", "julia",
    "solidity", "assembly", "assembly language", "haskell", "elixir", "erlang",
    "f#", "vba", "visual basic", "vb.net", "cobol", "fortran", "objective-c",
    "lua", "clojure", "ocaml", "lisp", "scheme", "prolog", "verilog", "vhdl",
    "systemverilog", "scss", "sass", "xml", "latex", "markdown", "pl/sql",
    "plsql", "t-sql", "tsql", "apex", "abap",
}

# Everything machine-learning: concepts and techniques, ML/DL/NLP/CV/LLM
# libraries, OCR engines, model serving, and ML-specific (MLOps) platforms.
_AI_ML_TERMS = {
    # Fields and concepts
    "machine learning", "deep learning", "generative ai", "gen ai",
    "natural language processing", "nlp", "computer vision",
    "reinforcement learning", "deep reinforcement learning", "data science",
    "llm", "llms", "large language models", "prompt engineering", "rag",
    "retrieval augmented generation", "agentic ai", "ai agents",
    "fine tuning", "fine-tuning", "finetuning", "llm fine tuning",
    "llm finetuning", "transfer learning", "artificial intelligence", "mlops",
    "llmops", "feature engineering", "supervised learning",
    "unsupervised learning", "object detection", "image classification",
    "image segmentation", "text classification", "sentiment analysis",
    "speech recognition", "text generation", "image generation",
    "neural networks", "neural network", "data mining", "anomaly detection",
    "recommendation systems", "recommender systems", "time series analysis",
    "time series forecasting", "embeddings", "vector embeddings",
    "semantic search", "knowledge graphs", "multimodal",
    "vision language models", "vlm", "explainable ai", "xai",
    "model monitoring", "function calling", "tool calling",
    # Classical ML / NLP algorithms and techniques
    "tf-idf", "tfidf", "term frequency-inverse document frequency",
    "random forest", "random forests", "decision tree", "decision trees",
    "logistic regression", "linear regression", "svm",
    "support vector machine", "support vector machines", "naive bayes",
    "k-means", "k means", "kmeans", "k-means clustering", "knn",
    "k-nearest neighbors", "k-nearest neighbours", "gradient boosting",
    "boosting", "bagging", "ensemble learning", "clustering",
    "classification", "pca", "principal component analysis",
    "dimensionality reduction", "cnn", "convolutional neural networks", "rnn",
    "lstm", "gru", "gan", "generative adversarial networks", "autoencoder",
    "autoencoders", "diffusion models", "transformers", "transformer",
    "attention mechanism", "word2vec", "glove", "fasttext", "bag of words",
    "n-grams", "tokenization", "lemmatization", "stemming",
    "named entity recognition", "ner", "topic modeling", "topic modelling",
    "lda", "latent dirichlet allocation", "ocr",
    "optical character recognition", "hyperparameter tuning",
    "cross validation", "cross-validation", "feature selection",
    "model evaluation", "model deployment", "lora", "qlora", "peft",
    "quantization", "knowledge distillation", "few-shot learning",
    "zero-shot learning", "chain of thought", "data annotation",
    "data labeling", "data labelling",
    # ML / DL libraries and frameworks
    "tensorflow", "tensorflow lite", "tflite", "pytorch", "pytorch lightning",
    "keras", "keras tuner", "jax", "flax", "scikit-learn", "sklearn",
    "xgboost", "lightgbm", "catboost", "fastai", "timm", "torchvision",
    "torchaudio", "optuna", "shap", "lime", "onnx", "onnx runtime",
    "tensorrt", "openvino",
    # NLP / LLM / GenAI libraries
    "nltk", "spacy", "gensim", "hugging face", "huggingface",
    "hugging face transformers", "huggingface transformers",
    "hugging face datasets", "sentence-transformers", "sentence transformers",
    "langchain", "langgraph", "langsmith", "langfuse", "llamaindex",
    "llama index", "crewai", "autogen", "dspy", "haystack", "semantic kernel",
    "openai api", "openai", "anthropic api", "vllm", "ollama", "llama.cpp",
    # Computer vision and OCR
    "opencv", "mediapipe", "detectron2", "mmdetection", "ultralytics",
    "tesseract", "tesseract ocr", "easyocr", "paddleocr",
    # Reinforcement learning
    "stable-baselines3", "stable baselines3", "stable baselines",
    "gymnasium", "openai gym",
    # Model serving
    "torchserve", "tf serving", "tensorflow serving", "triton",
    "triton inference server", "bentoml", "seldon", "kserve",
    # ML-specific platforms and MLOps tools
    "mlflow", "kubeflow", "wandb", "weights & biases", "weights and biases",
    "dvc", "comet", "comet ml", "neptune", "clearml", "feast", "evidently",
    "sagemaker", "amazon sagemaker", "aws sagemaker", "vertex ai",
    "google vertex ai", "azure machine learning", "azure ml", "databricks ml",
    "bedrock", "amazon bedrock", "aws bedrock", "azure openai", "azure ai",
}

# General-purpose software frameworks and libraries (web, backend, mobile,
# data, UI, desktop, games) - not ML-specific ones, which live in AI/ML.
_FRAMEWORK_TERMS = {
    # Scientific / data libraries
    "numpy", "pandas", "scipy", "statsmodels", "polars", "matplotlib",
    "seaborn", "plotly", "bokeh", "altair", "dash", "plotly dash",
    "streamlit", "gradio",
    # Big data processing
    "spark", "pyspark", "spark sql", "hadoop", "mapreduce", "flink", "beam",
    "kafka streams", "dask", "ray",
    # Python backend and utilities
    "flask", "fastapi", "django", "django rest framework", "drf",
    "sqlalchemy", "celery", "pydantic", "beautifulsoup", "beautiful soup",
    "bs4", "scrapy", "pypdf2", "pypdf", "pymupdf", "pdfplumber", "reportlab",
    "openpyxl", "fasthtml", "tkinter", "pyqt", "qt", "kivy", "pygame",
    # JavaScript / web
    "react", "reactjs", "react.js", "react native", "vue", "vuejs", "vue.js",
    "angular", "angularjs", "svelte", "sveltekit", "next.js", "nextjs",
    "nuxt", "nuxt.js", "remix", "gatsby", "node.js", "nodejs", "express",
    "expressjs", "express.js", "nestjs", "jquery", "redux", "redux toolkit",
    "zustand", "mobx", "rxjs", "three.js", "d3", "d3.js", "chart.js",
    "socket.io", "electron", "tauri", "htmx", "alpine.js",
    # UI / styling
    "bootstrap", "tailwind", "tailwindcss", "tailwind css", "material ui",
    "material-ui", "mui", "chakra ui", "ant design", "shadcn", "shadcn/ui",
    # JVM / .NET / PHP / Ruby / Go / Rust
    "spring", "spring boot", "spring mvc", "hibernate", ".net", ".net core",
    "asp.net", "asp.net core", "entity framework", "laravel", "symfony",
    "codeigniter", "rails", "ruby on rails", "gin", "fiber", "actix",
    # ORMs
    "prisma", "sequelize", "mongoose", "typeorm",
    # Mobile
    "flutter", "swiftui", "jetpack compose", "xamarin", "ionic",
    # Graphics, games, robotics
    "unity", "unreal engine", "opengl", "vulkan", "ros", "ros2",
}

_DATABASE_TERMS = {
    "mongodb", "mysql", "postgresql", "postgres", "sqlite", "redis",
    "cassandra", "dynamodb", "oracle", "oracle database", "oracle db",
    "sql server", "mssql", "ms sql", "ms sql server", "microsoft sql server",
    "azure sql", "cloud sql", "mariadb", "firestore", "cloud firestore",
    "firebase", "firebase realtime database", "supabase", "neon",
    "planetscale", "cockroachdb", "couchdb", "couchbase", "hbase",
    "memcached", "duckdb", "aurora", "amazon aurora", "rds", "amazon rds",
    "realm", "indexeddb", "neo4j", "arangodb", "tigergraph", "influxdb",
    "timescaledb", "teradata", "db2", "ibm db2", "cosmos db", "cosmosdb",
    "azure cosmos db", "nosql", "hive", "presto", "trino", "delta lake",
    # Warehouses and lakehouses
    "snowflake", "bigquery", "redshift", "databricks", "clickhouse",
    # Search engines
    "elasticsearch", "opensearch", "solr", "typesense", "meilisearch",
    # Vector databases and vector search libraries
    "vector databases", "vector database", "faiss", "pinecone", "chroma",
    "chromadb", "weaviate", "milvus", "qdrant", "pgvector", "lancedb",
    "vespa",
}

# Developer tools, version control, CI/CD tools, workflow orchestration,
# messaging, testing, monitoring, build tooling, BI, office and enterprise
# software.
_TOOL_TERMS = {
    # Version control and hosting
    "git", "github", "gitlab", "bitbucket", "svn", "mercurial",
    # Editors and notebooks
    "vscode", "vs code", "visual studio code", "visual studio", "intellij",
    "intellij idea", "eclipse", "android studio", "xcode", "vim", "neovim",
    "emacs", "pycharm", "jupyter", "jupyter notebook", "jupyter notebooks",
    "colab", "google colab", "anaconda", "conda",
    # Package managers and build tools
    "pip", "poetry", "npm", "yarn", "pnpm", "maven", "gradle", "make",
    "cmake", "webpack", "vite", "babel", "eslint", "prettier",
    # API tools
    "postman", "insomnia", "swagger", "openapi",
    # CI/CD tools
    "jenkins", "github actions", "gitlab ci", "gitlab ci/cd", "circleci",
    "travis ci", "argo cd", "argocd", "teamcity", "bamboo", "spinnaker",
    "sonarqube",
    # Monitoring and observability
    "grafana", "prometheus", "datadog", "new relic", "sentry", "elk",
    "elk stack", "kibana", "logstash", "pagerduty", "nagios", "zabbix",
    # Workflow orchestration, data integration, messaging
    "airflow", "prefect", "dagster", "luigi", "nifi", "dbt", "fivetran",
    "airbyte", "talend", "informatica", "ssis", "great expectations",
    "kafka", "rabbitmq", "activemq",
    # Testing
    "pytest", "unittest", "jest", "mocha", "chai", "cypress", "playwright",
    "puppeteer", "selenium", "junit", "testng", "mockito", "jmeter",
    "locust", "k6", "cucumber", "storybook",
    # Hardware, OS and media tooling
    "cuda", "arduino", "raspberry pi", "windows", "macos", "ffmpeg",
    "wkhtmltopdf",
    # BI / analytics
    "power bi", "powerbi", "tableau", "looker", "looker studio", "qlik",
    "qlikview", "qlik sense", "quicksight", "google data studio",
    "data studio", "alteryx", "google analytics",
    # Office suite and documents
    "excel", "advanced excel", "microsoft excel", "ms excel", "google sheets",
    "powerpoint", "microsoft powerpoint", "ms powerpoint", "word",
    "microsoft word", "ms word", "microsoft office", "ms office",
    "microsoft office suite", "office 365", "microsoft 365", "outlook",
    "microsoft outlook", "google docs", "google slides", "google workspace",
    # Diagramming / design
    "visio", "microsoft visio", "lucidchart", "draw.io", "drawio", "miro",
    "figma", "balsamiq",
    # Enterprise platforms (ERP / CRM / ITSM)
    "sap", "salesforce", "servicenow", "hubspot", "workday", "sharepoint",
    "erp", "erp systems", "crm",
    # Project / work tracking
    "jira", "confluence", "ms project", "microsoft project", "asana",
    "trello", "notion",
    # Finance / statistics software
    "bloomberg", "bloomberg terminal", "refinitiv", "eikon",
    "refinitiv eikon", "capital iq", "s&p capital iq", "factset", "stata",
    "eviews", "spss", "sas", "quickbooks", "xero", "sage", "sage pastel",
    "pastel",
}

# Cloud providers and services, containers and orchestration, infrastructure
# as code, hosting/deployment, servers, operating systems, DevOps practice.
_CLOUD_DEVOPS_TERMS = {
    "aws", "amazon web services", "azure", "microsoft azure", "gcp",
    "google cloud", "google cloud platform", "oracle cloud", "oci",
    "ibm cloud", "alibaba cloud", "digitalocean", "linode", "cloud platforms",
    "serverless", "cloud infrastructure", "cloud computing",
    # AWS services
    "ec2", "s3", "lambda", "aws lambda", "ecs", "eks", "fargate",
    "cloudfront", "route 53", "api gateway", "sqs", "sns", "vpc",
    "cloudwatch", "elastic beanstalk", "amplify", "step functions", "glue",
    "aws glue", "athena", "emr", "kinesis", "cloudformation", "aws cdk",
    # Google Cloud services
    "cloud run", "cloud functions", "app engine", "gke", "compute engine",
    "pub/sub", "cloud storage", "dataflow", "dataproc",
    # Azure services
    "aks", "azure functions", "azure devops", "azure app service",
    "blob storage", "azure blob storage", "azure data factory",
    "data factory", "synapse", "azure synapse", "bicep", "arm templates",
    # Containers and orchestration
    "docker", "docker compose", "docker-compose", "podman", "kubernetes",
    "k8s", "helm", "openshift", "rancher", "istio",
    # Infrastructure as code and configuration
    "terraform", "ansible", "puppet", "chef", "pulumi", "packer", "vagrant",
    "infrastructure as code", "iac", "gitops",
    # Servers and hosting
    "nginx", "apache", "apache http server", "iis", "tomcat", "gunicorn",
    "vercel", "netlify", "heroku", "railway", "render", "fly.io",
    "cloudflare", "cloudflare workers", "firebase hosting", "github pages",
    # Operating systems
    "linux", "ubuntu", "centos", "debian", "red hat", "rhel", "unix",
    # Practice
    "ci/cd", "ci", "cd", "devops", "continuous integration",
    "continuous deployment", "continuous delivery", "sre",
    "site reliability engineering",
}

_NETWORK_PROTOCOL_TERMS = {
    "tcp/ip", "tcp", "udp", "ip", "dns", "http", "https", "ftp", "sftp",
    "ssh", "smtp", "dhcp", "arp", "vpn", "tls", "ssl", "ospf", "bgp", "snmp",
    "ipv4", "ipv6", "subnetting", "routing", "switching", "firewalls",
    "firewall", "load balancing", "network protocols", "osi model",
    "packet analysis", "wireshark", "tcpdump", "vlan", "nat", "proxy",
    "network segmentation", "computer networks", "networking", "cisco",
    "ccna", "cisco packet tracer", "lan", "wan",
}

_SECURITY_SIEM_TERMS = {
    "splunk", "splunk enterprise", "sysmon", "siem", "threat hunting",
    "incident investigation", "incident response", "ioc analysis",
    "security event analysis", "log ingestion", "spl",
    "search processing language", "event correlation", "security operations",
    "soc", "security operations (soc)", "log analysis", "windows event logs",
    "windows event viewer", "windows endpoint monitoring",
    "endpoint monitoring", "authentication monitoring",
    "powershell monitoring", "qradar", "ibm qradar", "arcsight",
    "microsoft sentinel", "sentinel", "crowdstrike", "nessus", "metasploit",
    "burp suite", "nmap", "snort", "suricata", "ids", "ips", "edr", "xdr",
    "mitre att&ck", "mitre attack", "vulnerability assessment",
    "penetration testing", "malware analysis", "digital forensics", "dfir",
    "security information and event management", "threat intelligence",
    "vulnerability management", "owasp", "owasp top 10", "owasp zap",
    "kali linux", "iam", "oauth", "oauth2", "jwt", "sso", "saml",
    "encryption", "cryptography", "sast", "dast",
}

# Ways of working and analysis artefacts - legitimate skills, but not tools.
_METHODOLOGY_TERMS = {
    "agile", "waterfall", "scrum", "kanban", "safe", "lean", "six sigma",
    "bpmn", "uml", "sdlc", "rup", "user stories", "user story", "use cases",
    "use case", "brd", "brds", "business requirements document", "frd",
    "srs", "user acceptance testing", "uat", "wireframes", "wireframing",
    "prototyping", "mockups", "requirements gathering",
    "requirement gathering", "gap analysis", "process mapping",
    "process modelling", "process modeling", "process flow",
    "data modelling", "data modeling", "project management",
    "stakeholder management", "change management", "process improvement",
    "tdd", "test-driven development", "bdd", "behavior-driven development",
    "unit testing", "integration testing", "code review", "pair programming",
}

# Analysis and data-engineering skills that belong to no single domain.
_ANALYTICS_TERMS = {
    "data analysis", "data analytics", "statistical analysis", "statistics",
    "quantitative analysis", "regression analysis", "business analysis",
    "market research", "business intelligence", "data visualization",
    "data visualisation", "data cleaning", "data entry",
    "reporting and analysis", "kpi tracking", "dashboarding", "a/b testing",
    "etl", "elt", "etl pipelines", "data pipelines", "data engineering",
    "data warehousing", "data wrangling", "exploratory data analysis", "eda",
    "predictive analytics", "big data", "data governance", "data quality",
}

_FINANCE_TERMS = {
    "corporate finance", "finance", "financial analysis",
    "financial modelling", "financial modeling", "financial reporting",
    "financial statement analysis", "financial planning",
    "financial planning and analysis", "fp&a", "valuation", "dcf",
    "discounted cash flow", "budgeting", "forecasting",
    "budgeting and forecasting", "variance analysis", "investment analysis",
    "quantitative investment analysis", "portfolio management",
    "asset management", "equity research", "credit analysis", "credit risk",
    "market risk", "risk management", "risk analysis",
    "financial risk management", "derivatives",
    "derivatives & risk management", "derivatives and risk management",
    "fixed income", "capital markets", "mergers and acquisitions", "m&a",
    "accounting", "financial accounting", "management accounting",
    "cost accounting", "bookkeeping", "auditing", "audit", "taxation", "tax",
    "ifrs", "gaap", "us gaap", "reconciliation", "account reconciliation",
    "accounts payable", "accounts receivable", "payroll", "treasury",
    "economics", "econometrics", "microeconomics", "macroeconomics",
    "international trade", "international economics",
    "development economics", "economic analysis", "economic modelling",
    "economic modeling",
}

# Real technical skills that are concepts rather than tools - API styles,
# architecture, CS fundamentals, data formats. "Other Technical Skills" is
# their genuine home; listing them here also keeps them from being mistaken
# for generic phrases and dropped.
_OTHER_TECHNICAL_TERMS = {
    "rest api", "rest apis", "restful api", "restful apis", "rest",
    "graphql", "grpc", "websocket", "websockets", "soap", "microservices",
    "microservice architecture", "event-driven architecture", "oop", "oops",
    "object-oriented programming", "object oriented programming",
    "data structures", "algorithms", "data structures and algorithms",
    "data structures & algorithms", "dsa", "system design",
    "design patterns", "regex", "regular expressions", "json", "yaml",
    "api development", "api integration", "web scraping", "multithreading",
    "concurrency", "operating systems", "dbms", "distributed systems",
    "blockchain", "web3", "smart contracts", "iot", "embedded systems", "mvc",
    "responsive design", "web accessibility", "wcag", "pwa",
    "progressive web apps",
}

_CATEGORY_TERMS: dict[str, set[str]] = {
    HUMAN_LANGUAGE: _HUMAN_LANGUAGE_TERMS,
    LANGUAGES: _LANGUAGE_TERMS,
    AI_ML: _AI_ML_TERMS,
    FRAMEWORKS: _FRAMEWORK_TERMS,
    DATABASES: _DATABASE_TERMS,
    TOOLS: _TOOL_TERMS,
    CLOUD: _CLOUD_DEVOPS_TERMS,
    NETWORKING: _NETWORK_PROTOCOL_TERMS,
    SECURITY: _SECURITY_SIEM_TERMS,
    METHODOLOGIES: _METHODOLOGY_TERMS,
    ANALYTICS: _ANALYTICS_TERMS,
    FINANCE: _FINANCE_TERMS,
    OTHER: _OTHER_TECHNICAL_TERMS,
}


def _normalize(value: str) -> str:
    v = re.sub(r"\s+", " ", str(value or "").lower()).strip()
    return v.strip(" \t\"'`,;:•*|").rstrip(".").strip()


def _build_index() -> tuple[dict[str, str], dict[str, set[str]]]:
    index: dict[str, str] = {}
    duplicates: dict[str, set[str]] = {}
    for category, terms in _CATEGORY_TERMS.items():
        for term in terms:
            key = _normalize(term)
            if key in index and index[key] != category:
                duplicates.setdefault(key, {index[key]}).add(category)
            else:
                index.setdefault(key, category)
    return index, duplicates


TERM_INDEX, DUPLICATE_TERMS = _build_index()

# Typo-tolerant matching only against longer names: "Go", "C", "R" and other
# short terms would match almost anything.
_FUZZY_MIN_LENGTH = 6
_FUZZY_CUTOFF = 0.9
_FUZZY_TERMS = [t for t in TERM_INDEX if len(t) >= _FUZZY_MIN_LENGTH]

_VENDOR_PREFIXES = (
    "apache ", "amazon ", "aws ", "google ", "microsoft ", "ms ", "azure ",
    "gcp ", "ibm ", "adobe ",
)
# "PineconeDB", "Pinecone DB", "Redis database", "React.js", "ReactJS",
# "Keras library", "Stripe SDK", "Tesseract OCR", "Unity engine".
_SUFFIX_NOISE_RE = re.compile(
    r"(?:\s+(?:db|database|library|libraries|framework|sdk|api|toolkit|"
    r"platform|ocr|engine|server)|(?<=[a-z])db|\.?\s?js)$"
)
# "Vue 3", "Python 3.11", "C++17", "Angular v15".
_VERSION_RE = re.compile(r"\s*v?\d+(?:\.\d+)*[a-z]?\+?$")
_PARENTHETICAL_RE = re.compile(r"^(.*?)\s*\(([^)]+)\)$")

# Product families whose sub-products read as the parent on a resume:
# "React Router" -> React, "Spring Security" -> Spring, "Power BI Desktop" ->
# Power BI. Only these prefixes are trusted - "Java Spring" must not resolve
# through its first word.
_FAMILY_PREFIXES = {
    "tensorflow", "pytorch", "keras", "hugging face", "huggingface",
    "langchain", "llamaindex", "openai", "opencv", "react", "angular", "vue",
    "next.js", "node.js", "django", "flask", "fastapi", "spring", "pandas",
    "numpy", "spark", "kafka", "airflow", "docker", "kubernetes",
    "terraform", "aws", "azure", "gcp", "google cloud", "power bi",
    "tableau", "excel", "microsoft excel", "git", "github", "gitlab",
    "jenkins", "selenium", "mongodb", "postgresql", "mysql", "redis",
    "elasticsearch", "firebase", "supabase", "unity", "salesforce", "sap",
}

# Model families and versioned model names ("LLaMA 3.3", "GPT-4o", "YOLOv8").
_AI_MODEL_RE = re.compile(
    r"(?:^|[^a-z0-9])(?:"
    r"llama|llama\d|gemma|mistral|mixtral|qwen|deepseek|falcon|"
    r"gpt|chatgpt|gemini|claude|"
    r"bert|roberta|deberta|albert|distilbert|xlnet|electra|"
    r"whisper|wav2vec|llava|blip|"
    r"yolo|yolov\d+|resnet|efficientnet|mobilenet|densenet|u-net|unet|"
    r"stable diffusion|sdxl|dall-e|dalle|midjourney"
    r")(?:[^a-z0-9]|$)"
)

# Last-resort keyword patterns for names nobody listed.
_PATTERN_RULES: tuple[tuple[re.Pattern, str], ...] = (
    (re.compile(
        r"(?:^|[^a-z0-9])(?:ocr|nlp|llms?|genai|gen ai|computer vision|vision|"
        r"speech|neural|transformers?|diffusion|embeddings?|rag|mlops|llmops|"
        r"ml|ai|machine learning|deep learning)(?:[^a-z0-9]|$)"
    ), AI_ML),
    (re.compile(
        r"^[a-z0-9]+(?:db|sql)$|database|(?:^|\s)vector\s+(?:store|db|index|search)"
    ), DATABASES),
    (re.compile(r"(?:\.js|\bjs)$|\s(?:ui|framework|library)$"), FRAMEWORKS),
    (re.compile(r"^(?:aws|azure|gcp|google cloud|amazon web services)\b"), CLOUD),
)

_COMPOUND_SPLIT_RE = re.compile(r"\s*/\s*|\s+&\s+|\s+and\s+", re.IGNORECASE)


def _confident_lookup(norm: str, allow_family: bool = True) -> str | None:
    """Category from the known vocabulary, trying every name the skill goes by.

    allow_family=False skips the product-family prefix match, so a compound
    like "Docker & Kubernetes" is split before its first word can claim it.
    """
    if not norm:
        return None
    candidates = [norm]
    m = _PARENTHETICAL_RE.match(norm)
    if m:
        candidates += [m.group(1).strip(), m.group(2).strip()]
    for base in list(candidates):
        candidates.append(canonical_skill_key(base))
        candidates += [base[len(p):] for p in _VENDOR_PREFIXES if base.startswith(p)]
    for base in list(candidates):
        candidates.append(_SUFFIX_NOISE_RE.sub("", base).strip())
        candidates.append(_VERSION_RE.sub("", base).strip())

    seen: set[str] = set()
    for candidate in candidates:
        if candidate and candidate not in seen:
            seen.add(candidate)
            category = TERM_INDEX.get(candidate)
            if category:
                return category

    if not allow_family:
        return None
    words = norm.split()
    for k in range(len(words) - 1, 0, -1):
        prefix = " ".join(words[:k])
        if prefix in _FAMILY_PREFIXES and prefix in TERM_INDEX:
            return TERM_INDEX[prefix]
    return None


def _heuristic_lookup(norm: str) -> str | None:
    """Typo-tolerant and pattern-based guesses, for names nobody listed."""
    if len(norm) >= _FUZZY_MIN_LENGTH:
        match = difflib.get_close_matches(norm, _FUZZY_TERMS, n=1, cutoff=_FUZZY_CUTOFF)
        if match:
            return TERM_INDEX[match[0]]
    if _AI_MODEL_RE.search(norm):
        return AI_ML
    for pattern, category in _PATTERN_RULES:
        if pattern.search(norm):
            return category
    return None


# De-duplication identity: "React", "React.js" and "ReactJS", or "Pinecone" and
# "PineconeDB", are one skill. Deliberately narrower than the lookup cascade -
# vendor prefixes and " server" are NOT stripped, because "MS SQL" and "SQL
# Server" are not "SQL"; and a version only goes when it follows a letter
# directly, so "GPT-4o", "EC2" and "K8s" keep theirs.
_IDENTITY_SUFFIX_RE = re.compile(r"(?:\.?\s?js|\s+db|\s+database|(?<=[a-z]{3})db)$")
_IDENTITY_VERSION_RE = re.compile(r"(?<=[a-z])\s*v?\d+(?:\.\d+)*\+?$")


def skill_identity(value: str) -> str:
    """Key under which two spellings of one skill compare equal."""
    key = canonical_skill_key(value)
    stripped = _IDENTITY_SUFFIX_RE.sub("", key).strip()
    if len(stripped) >= 2:
        key = stripped
    unversioned = _IDENTITY_VERSION_RE.sub("", key).strip()
    if len(unversioned) >= 3:
        key = unversioned
    return key


def _clean_display(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip(" \t\"'`,;:•*|-")


def classify_skill(item: str) -> list[tuple[str, str | None, bool]]:
    """Classify one skills-list item.

    Returns [(display_text, category, confident)] - usually one entry, several
    when a compound such as "HTML/CSS" splits into known skills. `category` is
    None when nothing matched; `confident` is False for typo/pattern guesses,
    which callers should drop if the text reads as a generic phrase.
    """
    text = _clean_display(item)
    if not text:
        return []
    norm = _normalize(text)

    category = _confident_lookup(norm, allow_family=False)
    if category:
        return [(text, category, True)]

    # Split "HTML/CSS", "Docker & Kubernetes", "Pandas and NumPy" - but only
    # when every part is a known skill, so "CI/CD", "TCP/IP", "A/B Testing"
    # (known whole) and "R&D" (unknown parts) are never broken apart.
    parts = [p for p in (_clean_display(x) for x in _COMPOUND_SPLIT_RE.split(text)) if p]
    if len(parts) > 1:
        resolved = [(part, _confident_lookup(_normalize(part))) for part in parts]
        if all(cat for _, cat in resolved):
            return [(part, cat, True) for part, cat in resolved]

    category = _confident_lookup(norm)
    if category:
        return [(text, category, True)]
    return [(text, _heuristic_lookup(norm), False)]
