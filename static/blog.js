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
      const match = (h.textContent || "").trim().match(/^(?:Step\s+)?(\d+)\s*[:.\-\u2013\u2014)]\s*/i);
      if (!match || h.closest(".faq-box")) return;

      for (const node of h.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent || "")) {
          node.textContent = node.textContent.replace(/^\s*(?:Step\s+)?\d+\s*[:.\-\u2013\u2014)]\s*/i, "");
          break;
        }
      }

      h.classList.add("step-card-head");
      if (!h.querySelector(".step-card-num")) {
        const badge = document.createElement("span");
        badge.className = "step-card-num";
        badge.textContent = match[1];
        h.prepend(badge);
      }

      const card = document.createElement("section");
      card.className = "step-card";
      card.classList.add(`step-tone-${Math.min(Number(match[1]) || 1, 5)}`);
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

  const enhanceArticleCtas = () => {
    const content = document.querySelector(".post-content");
    if (!content || content.querySelector(".article-cta-strip")) return;

    const profiles = [
      {
        test: (href, text) => href.includes("/cover-letter") || text.includes("cover letter"),
        title: "Your cover letter should sound specific, not generic.",
        text: "Match the role, reuse the right evidence from your resume, and send a sharper application.",
        label: "Write a cover letter",
        fallback: "/cover-letter",
      },
      {
        test: (href, text) => href.includes("/templates") || text.includes("template"),
        title: "Start with a resume layout recruiters can read fast.",
        text: "Choose a clean template, keep the structure simple, and make every section easier to scan.",
        label: "Browse resume templates",
        fallback: "/templates",
      },
      {
        test: (href, text) => href.includes("/portfolio") || text.includes("portfolio"),
        title: "Turn your resume story into a portfolio recruiters can explore.",
        text: "Show projects, proof, and results in a polished page that supports your application.",
        label: "Build your portfolio",
        fallback: "/portfolio",
      },
      {
        test: (href, text) => href.includes("/mock-interview") || text.includes("interview"),
        title: "Practice before the real interview starts.",
        text: "Turn your resume into realistic questions, rehearse stronger answers, and walk in prepared.",
        label: "Practice an interview",
        fallback: "/mock-interview",
      },
      {
        test: (href, text) => href.includes("/modify-cv") || text.includes("resume builder"),
        title: "Build a cleaner resume without fighting the formatting.",
        text: "Create a structured, ATS-friendly resume that is easy for both software and recruiters to read.",
        label: "Open resume builder",
        fallback: "/modify-cv",
      },
      {
        test: (href, text) => href.includes("/extension") || text.includes("chrome extension"),
        title: "Tailor faster while you browse jobs.",
        text: "Use TailorCV on job pages, check fit quickly, and adapt your resume without breaking your flow.",
        label: "Get the extension",
        fallback: "/extension",
      },
    ];

    const preferredAnchor = Array.from(content.querySelectorAll("a")).find((a) => {
      const href = a.getAttribute("href") || "";
      const text = normalizeText(a);
      return href.includes("/solutions") ||
        href.includes("/modify-cv") ||
        href.includes("/cover-letter") ||
        href.includes("/templates") ||
        href.includes("/portfolio") ||
        href.includes("/mock-interview") ||
        href.includes("/extension") ||
        text.includes("resume scanner") ||
        text.includes("resume optimizer") ||
        text.includes("resume builder") ||
        text.includes("cover letter") ||
        text.includes("template") ||
        text.includes("portfolio") ||
        text.includes("interview") ||
        text.includes("chrome extension");
    });
    const preferredHref = preferredAnchor ? preferredAnchor.getAttribute("href") || "" : "";
    const preferredText = preferredAnchor ? normalizeText(preferredAnchor) : "";
    const profile = profiles.find((item) => item.test(preferredHref, preferredText)) || {
      title: "Your resume should be easy to read and easy to rank.",
      text: "Check the match before you send it, then tune the words, sections, and formatting for the role.",
      label: "Try a free resume scan",
      fallback: "/solutions",
    };
    const ctaHref = preferredAnchor ? preferredAnchor.href : profile.fallback;

    const cta = document.createElement("aside");
    cta.className = "article-cta-strip full-bleed";
    cta.innerHTML = `
      <div class="article-cta-visual" aria-hidden="true">
        <svg viewBox="0 0 360 170" role="img" focusable="false">
          <defs>
            <linearGradient id="tcxCtaDoc" x1="64" y1="32" x2="254" y2="136" gradientUnits="userSpaceOnUse">
              <stop stop-color="#ffffff"/>
              <stop offset="1" stop-color="#eef6ff"/>
            </linearGradient>
            <linearGradient id="tcxCtaBlue" x1="166" y1="66" x2="265" y2="97" gradientUnits="userSpaceOnUse">
              <stop stop-color="#38bdf8"/>
              <stop offset="1" stop-color="#0878df"/>
            </linearGradient>
            <linearGradient id="tcxCtaPencil" x1="256" y1="82" x2="315" y2="140" gradientUnits="userSpaceOnUse">
              <stop stop-color="#fbbf24"/>
              <stop offset="1" stop-color="#fb7185"/>
            </linearGradient>
            <filter id="tcxCtaShadow" x="0" y="0" width="360" height="170" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
              <feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#075985" flood-opacity=".16"/>
            </filter>
          </defs>
          <rect x="20" y="18" width="320" height="134" rx="8" fill="#ffffff" opacity=".1"/>
          <rect x="20.5" y="18.5" width="319" height="133" rx="7.5" fill="none" stroke="#ffffff" stroke-opacity=".32"/>

          <g filter="url(#tcxCtaShadow)">
            <rect x="84" y="43" width="190" height="93" rx="14" fill="url(#tcxCtaDoc)"/>
            <rect x="84" y="43" width="190" height="25" rx="14" fill="#e6eefb"/>
            <rect x="84" y="63" width="190" height="5" fill="#c9d7f0"/>
            <circle cx="103" cy="55.5" r="4.5" fill="#f8b545"/>
            <circle cx="120" cy="55.5" r="4.5" fill="#70c95d"/>
            <circle cx="137" cy="55.5" r="4.5" fill="#42a5f5"/>

            <rect x="167" y="83" width="92" height="24" rx="5" fill="url(#tcxCtaBlue)"/>
            <rect x="167" y="117" width="78" height="8" rx="4" fill="#d7e6f5"/>
            <rect x="167" y="131" width="62" height="7" rx="3.5" fill="#e3edf8"/>
          </g>

          <g filter="url(#tcxCtaShadow)">
            <circle cx="92" cy="103" r="42" fill="#ffffff"/>
            <circle cx="92" cy="103" r="34" fill="none" stroke="#dbeafe" stroke-width="9"/>
            <path d="M92 69a34 34 0 1 1-30 50" fill="none" stroke="#7bd444" stroke-width="9" stroke-linecap="round"/>
            <path d="M62 119a34 34 0 0 1 10-38" fill="none" stroke="#38bdf8" stroke-width="9" stroke-linecap="round"/>
            <text x="74" y="111" fill="#55b72e" font-size="18" font-weight="850">87%</text>
          </g>

          <g>
            <circle cx="143" cy="107" r="12" fill="#0878df"/>
            <path d="m137.5 107 3.8 3.8 8.4-9.4" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="143" cy="130" r="12" fill="#0878df"/>
            <path d="m137.5 130 3.8 3.8 8.4-9.4" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
          </g>

          <g>
            <path d="M263 124l39-64 15 9-39 64-19 11 4-20Z" fill="url(#tcxCtaPencil)"/>
            <path d="M302 60l15 9" stroke="#ffffff" stroke-width="3" stroke-linecap="round" opacity=".75"/>
            <rect x="240" y="108" width="76" height="38" rx="7" fill="#ffffff" stroke="#d6e4f2" stroke-width="3"/>
            <path d="M253 127l5 5 11-13" fill="none" stroke="#22c55e" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
            <text x="272" y="134" fill="#0878df" font-size="18" font-weight="850">Aa</text>
            <rect x="240" y="141" width="76" height="5" rx="2.5" fill="#a855f7" opacity=".58"/>
          </g>

          <circle cx="287" cy="52" r="20" fill="#ffffff"/>
          <path d="M287 39v26M274 52h26" stroke="#0878df" stroke-width="5" stroke-linecap="round"/>
          <circle cx="317" cy="79" r="7" fill="#90e05c"/>
          <circle cx="327" cy="54" r="6" fill="#fbbf24"/>
        </svg>
      </div>
      <div class="article-cta-copy">
        <p class="article-cta-title">${profile.title}</p>
        <p class="article-cta-text">${profile.text}</p>
        <a class="article-cta-button" href="${ctaHref}">${profile.label}</a>
      </div>
    `;

    const keyBox = content.querySelector(".key-takeaways-box");
    if (keyBox && keyBox.nextElementSibling) {
      keyBox.nextElementSibling.before(cta);
      return;
    }

    const secondHeading = content.querySelectorAll("h2")[1];
    if (secondHeading) secondHeading.before(cta);
  };

  const enhanceBottomLine = () => {
    document.querySelectorAll(".post-content h2").forEach((h2) => {
      if (!/^(final thoughts|bottom line|the bottom line|conclusion)$/.test(normalizeText(h2))) return;
      if (h2.closest(".article-bottomline")) return;
      const nodes = collectUntilNextHeading(h2, ["H2"]);
      const box = document.createElement("section");
      box.className = "article-bottomline";
      h2.before(box);
      box.appendChild(h2);
      nodes.forEach((node) => box.appendChild(node));
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
    enhanceArticleCtas();
    enhanceBottomLine();
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
