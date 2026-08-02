/* Inline ATS scanner for ATS-topic blog posts.

   Talks to POST /get-ats-score, which already enforces the one-free-scan
   guest quota server-side and returns 429 once it is used. On success we
   hand the payload to /ats-analysis through the same storage keys the
   landing widget uses, so the reader lands on the full report.

   Kept out of blog.js: only ATS posts embed this, so there is no reason
   to ship it with every article. */
(() => {
  const root = document.getElementById("blog-ats-scanner");
  if (!root) return;

  const ATS_PAYLOAD_KEY = "atsAnalysisPayload";
  const ATS_PAYLOAD_LOCAL_KEY = "tailorcv_ats_payload_guest";
  const MAX_BYTES = 2 * 1024 * 1024;

  const drop = document.getElementById("blog-ats-drop");
  const fileEl = document.getElementById("blog-ats-file");
  const nameEl = document.getElementById("blog-ats-file-name");
  const jdEl = document.getElementById("blog-ats-jd");
  const goEl = document.getElementById("blog-ats-go");
  const outEl = document.getElementById("blog-ats-out");

  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const setOut = (html, cls) => {
    outEl.className = "blog-ats-out" + (cls ? " " + cls : "");
    outEl.innerHTML = html;
  };

  const showFile = (f) => {
    if (!f) return;
    nameEl.hidden = false;
    nameEl.textContent = f.name;
    drop.classList.add("has-file");
  };

  const acceptFile = (f) => {
    if (!f) return false;
    const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    if (!isPdf) {
      setOut("Please upload a PDF resume.", "is-error");
      return false;
    }
    if (f.size > MAX_BYTES) {
      setOut("That file is over 2 MB. Please upload a smaller PDF.", "is-error");
      return false;
    }
    setOut("");
    showFile(f);
    return true;
  };

  drop.addEventListener("click", () => fileEl.click());
  drop.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileEl.click(); }
  });
  fileEl.addEventListener("change", () => acceptFile(fileEl.files && fileEl.files[0]));

  ["dragenter", "dragover"].forEach((evt) =>
    drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((evt) =>
    drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && acceptFile(f)) {
      // Assign to the input so the same FormData path is used either way.
      try { fileEl.files = e.dataTransfer.files; } catch (_) {}
    }
  });

  const reset = () => {
    goEl.disabled = false;
    goEl.querySelector(".tcx-btn-label").textContent = "Get my free ATS score";
  };

  goEl.addEventListener("click", () => {
    const f = fileEl.files && fileEl.files[0];
    const jd = (jdEl.value || "").trim();
    if (!f) { setOut("Add your resume as a PDF first.", "is-error"); return; }
    if (jd.length < 40) { setOut("Paste the job description you are targeting (a bit more detail needed).", "is-error"); return; }

    goEl.disabled = true;
    goEl.querySelector(".tcx-btn-label").textContent = "Scoring your resume…";
    setOut('<div class="blog-ats-spin" aria-hidden="true"></div><p>Reading your resume and matching it to the job…</p>', "is-busy");

    const fd = new FormData();
    fd.append("file", f);

    fetch("/get-ats-score?jd_string=" + encodeURIComponent(jd), { method: "POST", body: fd })
      .then((res) =>
        res.json().catch(() => ({})).then((body) => {
          if (!res.ok) {
            const err = new Error(body.detail || body.error || "That scan did not go through. Please try again.");
            err.status = res.status;
            throw err;
          }
          return body;
        }))
      .then((data) => {
        const payload = JSON.stringify(data);
        try { sessionStorage.setItem(ATS_PAYLOAD_KEY, payload); } catch (_) {}
        try { localStorage.setItem(ATS_PAYLOAD_LOCAL_KEY, payload); } catch (_) {}
        setOut('<div class="blog-ats-spin" aria-hidden="true"></div><p>Score ready. Opening your full report…</p>', "is-busy");
        window.location.href = "/ats-analysis";
      })
      .catch((e) => {
        // 429 means the free guest scan is already spent -> push to signup.
        const signup = e.status === 429
          ? '<a class="blog-ats-signup" href="/signup?next=/solutions">Create my free account</a>'
          : "";
        setOut("<p>" + esc(e.message) + "</p>" + signup, "is-error");
        reset();
      });
  });
})();
