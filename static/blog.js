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

  const initTocSpy = () => {
    const links = Array.from(
      document.querySelectorAll('.post-layout .toc a[href^="#"]')
    );
    if (!links.length) return;
    const map = links
      .map((a) => {
        let id = "";
        try { id = decodeURIComponent(a.getAttribute("href").slice(1)); } catch (_) {}
        return { a, el: id ? document.getElementById(id) : null };
      })
      .filter((x) => x.el);
    if (!map.length) return;

    const scroller = links[0].closest(".toc");
    let lastActive = null;
    const keepVisible = (a) => {
      if (!scroller || a === lastActive) return;
      lastActive = a;
      const c = a.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      // Only nudge the sidebar's own scroll, never the page.
      if (c.top < s.top) scroller.scrollTop -= s.top - c.top + 12;
      else if (c.bottom > s.bottom) scroller.scrollTop += c.bottom - s.bottom + 12;
    };

    const onScroll = () => {
      let current = map[0].a;
      for (const { a, el } of map) {
        if (el.getBoundingClientRect().top <= 140) current = a;
      }
      links.forEach((a) => a.classList.toggle("active", a === current));
      keepVisible(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  };

  const initHeadingAnchors = () => {
    document
      .querySelectorAll(".post-content h2[id], .post-content h3[id]")
      .forEach((h) => {
        if (h.querySelector(".anchor-link")) return;
        const a = document.createElement("a");
        a.className = "anchor-link";
        a.href = "#" + h.id;
        a.setAttribute("aria-label", "Link to this section");
        a.textContent = "#";
        h.prepend(a);
      });
  };

  const normalizeText = (el) =>
    (el && el.textContent ? el.textContent : "")
      .replace("#", "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

  const collectUntilNextHeading = (heading, stopTags) => {
    const nodes = [];
    let next = heading.nextElementSibling;
    while (next && !stopTags.includes(next.tagName)) {
      nodes.push(next);
      next = next.nextElementSibling;
    }
    return nodes;
  };

  const enhanceCallouts = () => {
    const rules = [
      { re: /^(warning|important|caution)\b/i, cls: "callout-warning" },
      { re: /^(tip|pro tip|recommendation)\b/i, cls: "callout-tip" },
      { re: /^(note|short answer)\b/i, cls: "callout-note" },
    ];

    document.querySelectorAll(".post-content blockquote").forEach((bq) => {
      const lead = bq.querySelector("strong, b");
      const text = (lead ? lead.textContent : bq.textContent || "").trim();
      const match = rules.find(({ re }) => re.test(text));
      if (match) bq.classList.add(match.cls);
    });

    document.querySelectorAll(".post-content p").forEach((p) => {
      const text = (p.textContent || "").trim();
      if (/^short answer\s*:/i.test(text)) p.classList.add("answer-box");
    });
  };

  const enhanceKeyTakeaways = () => {
    document.querySelectorAll(".post-content h2").forEach((h2) => {
      if (!/^(key takeaways|quick takeaways|summary)$/.test(normalizeText(h2))) return;
      if (h2.closest(".key-takeaways-box")) return;
      const nodes = collectUntilNextHeading(h2, ["H2"]);
      if (!nodes.length) return;

      const box = document.createElement("aside");
      box.className = "key-takeaways-box";
      const head = document.createElement("div");
      head.className = "key-takeaways-head";
      h2.before(box);
      box.appendChild(head);
      head.appendChild(h2);
      nodes.forEach((node) => box.appendChild(node));
    });
  };

  const enhanceStepCards = () => {
    document.querySelectorAll(".post-content h2, .post-content h3").forEach((h) => {
      const match = (h.textContent || "").trim().match(/^Step\s+(\d+)\s*[:.\-–]?\s*/i);
      if (!match || h.closest(".faq-box")) return;

      h.classList.add("step-card-head");
      if (!h.querySelector(".step-card-num")) {
        const badge = document.createElement("span");
        badge.className = "step-card-num";
        badge.textContent = match[1];
        h.prepend(badge);
      }

      const card = document.createElement("section");
      card.className = "step-card";
      h.before(card);
      card.appendChild(h);
      let next = card.nextElementSibling;
      while (next && !["H2", "H3"].includes(next.tagName)) {
        const current = next;
        next = next.nextElementSibling;
        card.appendChild(current);
      }
    });
  };

  const enhanceFaqSection = () => {
    document.querySelectorAll(".post-content h2").forEach((h2) => {
      if (!/^(frequently asked questions|faqs?|common questions)$/.test(normalizeText(h2))) return;
      if (h2.closest(".faq-box")) return;
      const nodes = collectUntilNextHeading(h2, ["H2"]);
      if (!nodes.length) return;

      const box = document.createElement("section");
      box.className = "faq-box";
      h2.before(box);
      box.appendChild(h2);

      let currentItem = null;
      nodes.forEach((node) => {
        if (node.tagName === "H3") {
          currentItem = document.createElement("div");
          currentItem.className = "faq-item";
          box.appendChild(currentItem);
          currentItem.appendChild(node);
        } else if (currentItem) {
          currentItem.appendChild(node);
        } else {
          box.appendChild(node);
        }
      });
    });
  };

  const enhanceTables = () => {
    document.querySelectorAll(".post-content table").forEach((table) => {
      if (table.closest(".table-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "table-wrap";
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  };

  const initBackToTop = () => {
    const btn = document.getElementById("backToTop");
    if (!btn) return;
    window.addEventListener(
      "scroll",
      () => btn.classList.toggle("show", window.scrollY > 600),
      { passive: true }
    );
    btn.addEventListener("click", () =>
      window.scrollTo({ top: 0, behavior: "smooth" })
    );
  };

  const init = () => {
    buildToc();
    setTimeout(buildToc, 180);
    initTocPinning();
    setTimeout(initTocSpy, 220);
    enhanceCallouts();
    enhanceKeyTakeaways();
    enhanceStepCards();
    enhanceFaqSection();
    enhanceTables();
    initHeadingAnchors();
    initBackToTop();

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

  // Smooth reveal of in-article images + section headings on scroll.
  (function initContentReveal() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!('IntersectionObserver' in window)) return;
    const content = document.querySelector('.post-content');
    if (!content) return;
    const els = [].slice.call(content.querySelectorAll('img, h2'));
    if (!els.length) return;
    els.forEach((el) => el.classList.add('tcx-art-reveal'));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('tcx-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });
    els.forEach((el) => io.observe(el));
    setTimeout(() => els.forEach((el) => el.classList.add('tcx-in')), 2500);
  })();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
