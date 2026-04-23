(function () {
    const STORAGE_KEY = "atsAnalysisPayload";

    const FALLBACK_DATA = {
        score: 0,
        jobTitle: "Target Role",
        company: "Target Company",
        date: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        breakdown: [],
        matchedKeywords: [],
        missingKeywords: [],
        resumeStats: { wordCount: 0, pages: 1, bulletPoints: 0, metricsUsed: 0 },
        tips: [{ priority: "medium", text: "Run ATS analysis from Solutions.", reason: "No score payload was found on this device yet." }],
    };

    function parsePayload() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return FALLBACK_DATA;
            const parsed = JSON.parse(raw);
            return { ...FALLBACK_DATA, ...parsed };
        } catch (err) {
            return FALLBACK_DATA;
        }
    }

    function scoreColor(score) {
        if (score >= 80) return { fill: "#1D9E75", bg: "#EAF3DE", label: "Strong match", rank: "Top 20% of applicants for this role" };
        if (score >= 60) return { fill: "#EF9F27", bg: "#FAEEDA", label: "Good match", rank: "Top 30% of applicants for this role" };
        return { fill: "#E24B4A", bg: "#FCEBEB", label: "Needs work", rank: "Below benchmark for this role" };
    }

    function barColor(value) {
        if (value > 70) return "#1D9E75";
        if (value >= 50) return "#EF9F27";
        return "#E24B4A";
    }

    function createPill(text, kind) {
        const span = document.createElement("span");
        span.className = `pill ${kind}`;
        span.textContent = text;
        return span;
    }

    function tipVisual(priority) {
        if (priority === "high") return { icon: "!", fill: "#E24B4A", bg: "#FCEBEB", label: "High impact" };
        if (priority === "medium") return { icon: "~", fill: "#EF9F27", bg: "#FAEEDA", label: "Medium impact" };
        return { icon: "↓", fill: "#1D9E75", bg: "#EAF3DE", label: "Low impact" };
    }

    function render() {
        const payload = parsePayload();
        const score = Math.max(0, Math.min(100, Number(payload.score || 0)));
        const scoreStyle = scoreColor(score);

        const analysisMeta = document.getElementById("analysis-meta");
        analysisMeta.textContent = `Analyzed for ${payload.jobTitle} · ${payload.company} · ${payload.date}`;

        const scoreValue = document.getElementById("score-value");
        scoreValue.textContent = String(score);

        const matchBadge = document.getElementById("match-badge");
        matchBadge.textContent = scoreStyle.label;
        matchBadge.style.color = scoreStyle.fill;
        matchBadge.style.background = scoreStyle.bg;

        document.getElementById("score-rank-text").textContent = payload.scoreRankText || scoreStyle.rank;

        const ring = document.getElementById("score-ring-progress");
        const circumference = 2 * Math.PI * 50;
        ring.style.stroke = scoreStyle.fill;
        ring.style.strokeDasharray = `${circumference}`;
        ring.style.strokeDashoffset = `${circumference - (score / 100) * circumference}`;

        const breakdownList = document.getElementById("breakdown-list");
        breakdownList.innerHTML = "";
        (payload.breakdown || []).forEach((item) => {
            const row = document.createElement("div");
            row.className = "breakdown-item";

            const top = document.createElement("div");
            top.className = "breakdown-head";
            const left = document.createElement("span");
            left.textContent = item.category || "Category";
            const right = document.createElement("span");

            if (item.score === null || item.score === undefined || item.score === "none") {
                right.textContent = "none";
                right.className = "none-tag";
                top.appendChild(left);
                top.appendChild(right);
                row.appendChild(top);
            } else {
                const v = Math.max(0, Math.min(100, Number(item.score)));
                right.textContent = `${v}%`;
                top.appendChild(left);
                top.appendChild(right);
                row.appendChild(top);
                const track = document.createElement("div");
                track.className = "progress-track";
                const fill = document.createElement("div");
                fill.className = "progress-fill";
                fill.style.width = `${v}%`;
                fill.style.background = barColor(v);
                track.appendChild(fill);
                row.appendChild(track);
            }

            breakdownList.appendChild(row);
        });

        const matched = payload.matchedKeywords || [];
        const missing = payload.missingKeywords || [];
        const matchedContainers = [
            document.getElementById("matched-keywords"),
            document.getElementById("keywords-tab-matched"),
            document.getElementById("side-matched"),
        ];
        const missingContainers = [
            document.getElementById("missing-keywords"),
            document.getElementById("keywords-tab-missing"),
            document.getElementById("side-missing"),
        ];

        matchedContainers.forEach((el) => {
            el.innerHTML = "";
            if (!matched.length) el.appendChild(createPill("No matched keywords yet", "matched"));
            matched.forEach((k) => el.appendChild(createPill(k, "matched")));
        });
        missingContainers.forEach((el) => {
            el.innerHTML = "";
            if (!missing.length) el.appendChild(createPill("No missing keywords detected", "missing"));
            missing.forEach((k) => el.appendChild(createPill(k, "missing")));
        });

        document.getElementById("matched-label").textContent = `Matched (${matched.length})`;
        document.getElementById("missing-label").textContent = `Missing (${missing.length})`;
        document.getElementById("keywords-tab-matched-label").textContent = `Matched (${matched.length})`;
        document.getElementById("keywords-tab-missing-label").textContent = `Missing (${missing.length})`;

        const stats = payload.resumeStats || {};
        const statConfig = [
            { name: "Word count", key: "wordCount", ideal: "Ideal: 400-700", min: 400, max: 700 },
            { name: "Pages", key: "pages", ideal: "Ideal: 1-2", min: 1, max: 2 },
            { name: "Bullet points", key: "bulletPoints", ideal: "Ideal: 12-24", min: 12, max: 24 },
            { name: "Metrics used", key: "metricsUsed", ideal: "Ideal: 5+", min: 5, max: 1000 },
        ];
        const statsGrid = document.getElementById("stats-grid");
        statsGrid.innerHTML = "";
        statConfig.forEach((cfg) => {
            const val = Number(stats[cfg.key] || 0);
            const outOfRange = val < cfg.min || val > cfg.max;
            const card = document.createElement("div");
            card.className = "metric-card";
            card.innerHTML = `
                <div class="metric-name">${cfg.name}</div>
                <div class="metric-value ${outOfRange ? "outside" : ""}">${val}</div>
                <div class="metric-benchmark">${cfg.ideal}</div>
            `;
            statsGrid.appendChild(card);
        });

        const tips = payload.tips || [];
        const tipsTargets = [document.getElementById("tips-list"), document.getElementById("tips-tab-list")];
        tipsTargets.forEach((target) => {
            target.innerHTML = "";
            tips.forEach((tip) => {
                const visual = tipVisual(tip.priority);
                const row = document.createElement("div");
                row.className = "tip-row";
                row.innerHTML = `
                    <div class="tip-icon" style="color:${visual.fill}">${visual.icon}</div>
                    <div>
                        <div class="tip-badge" style="color:${visual.fill}; background:${visual.bg}">${visual.label}</div>
                        <p class="tip-text">${tip.text}</p>
                        <div class="tip-reason">${tip.reason}</div>
                    </div>
                `;
                target.appendChild(row);
            });
        });
    }

    function wireTabs() {
        const tabs = document.querySelectorAll(".tab-btn");
        tabs.forEach((btn) => {
            btn.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                tabs.forEach((b) => b.classList.remove("active"));
                document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
                btn.classList.add("active");
                const tabName = btn.getAttribute("data-tab");
                const panel = document.getElementById(`tab-${tabName}`);
                if (panel) panel.classList.add("active");
            });
        });
    }

    function wireActions() {
        document.getElementById("back-to-resume-btn").addEventListener("click", () => {
            window.location.href = "/solutions";
        });

        document.getElementById("download-report-btn").addEventListener("click", () => {
            const payload = parsePayload();
            const report = JSON.stringify(payload, null, 2);
            const blob = new Blob([report], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "ats-analysis-report.json";
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        });
    }

    wireTabs();
    wireActions();
    render();
})();
