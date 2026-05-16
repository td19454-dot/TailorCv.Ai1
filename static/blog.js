(() => {
  const slugify = (value) =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");

  const buildToc = () => {
    const toc = document.querySelector(".post-layout .toc");
    const content = document.querySelector(".post-content");
    if (!toc || !content) return false;

    const title = toc.querySelector("h2") || document.createElement("h2");
    if (!title.textContent) title.textContent = "Table of contents";

    // If server TOC exists, keep only top-level items (##) and remove nested levels (### and deeper).
    const existingTopLinks = toc.querySelectorAll(":scope > ul > li > a");
    if (existingTopLinks.length > 0) {
      toc.querySelectorAll("ul ul").forEach((nested) => nested.remove());
      return true;
    }

    // Fallback: generate TOC from markdown ## rendered as h2.
    const h2s = Array.from(content.querySelectorAll("h2"));
    toc.innerHTML = "";
    toc.appendChild(title);

    if (!h2s.length) {
      const empty = document.createElement("p");
      empty.className = "toc-empty";
      empty.textContent = "No sections found.";
      toc.appendChild(empty);
      return false;
    }

    const list = document.createElement("ul");
    h2s.forEach((h2, index) => {
      const text = (h2.textContent || "").trim();
      if (!text) return;
      if (!h2.id) h2.id = `${slugify(text) || "section"}-${index + 1}`;
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = `#${h2.id}`;
      a.textContent = text;
      li.appendChild(a);
      list.appendChild(li);
    });
    toc.appendChild(list);
    return true;
  };

  const initTocPinning = () => {
    const toc = document.querySelector(".post-layout .toc");
    const layout = document.querySelector(".post-layout");
    const navbar = document.querySelector("header.navbar");
    if (!toc || !layout) return;

    const syncTocPin = () => {
      if (window.innerWidth <= 900) {
        toc.classList.remove("toc-fixed");
        toc.style.removeProperty("--toc-left");
        toc.style.removeProperty("--toc-top");
        return;
      }

      const navHeight = navbar ? navbar.offsetHeight : 100;
      const topOffset = navHeight + 20;

      const layoutLeft = layout.getBoundingClientRect().left;
      toc.style.setProperty("--toc-left", `${Math.max(0, layoutLeft)}px`);
      toc.style.setProperty("--toc-top", `${topOffset}px`);
      toc.classList.add("toc-fixed");
    };

    window.addEventListener("scroll", syncTocPin, { passive: true });
    window.addEventListener("resize", syncTocPin);
    syncTocPin();
  };

  const init = () => {
    buildToc();
    setTimeout(buildToc, 180);
    initTocPinning();

  const progress = document.getElementById('readingProgress');
  if (progress) {
    const setProgress = () => {
      const top = window.scrollY;
      const height = document.documentElement.scrollHeight - window.innerHeight;
      const pct = height > 0 ? (top / height) * 100 : 0;
      progress.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    };
    window.addEventListener('scroll', setProgress, { passive: true });
    setProgress();
  }

  const copyBtn = document.getElementById('copyLinkBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy link'; }, 1400);
      } catch (_) {
        copyBtn.textContent = 'Copy failed';
      }
    });
  }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
