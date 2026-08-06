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
      let nodes = collectUntilNextHeading(h2, ["H2"]);
      if (!nodes.length) return;
      // The box is the bullet summary and nothing else. Since Key Takeaways
      // now leads every post, the article's intro paragraphs sit directly
      // after it - without this they were pulled inside and the "clean list"
      // became a wall of prose.
      const firstList = nodes.find((n) => /^(UL|OL)$/.test(n.tagName));
      if (firstList) nodes = [firstList];

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
      // A bare dash must have spaces around it. Without that, compound titles
      // like "8-Week Prep Plan" or "30-Day Reset" were read as "Step 8" and
      // lost their leading number to the badge.
      const STEP = /^\s*(?:Step\s+)?(\d+)\s*(?::|\.|\)|\s+[-\u2013\u2014]\s+)\s*/i;
      const text = (h.textContent || "").trim();
      const match = text.match(STEP);
      // A numbered question is an FAQ entry, not a step. The FAQ box is built
      // later, so closest('.faq-box') is still null at this point and the
      // questions were being turned into blue step cards.
      if (!match || h.closest(".faq-box") || text.endsWith("?")) return;

      for (const node of h.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && /\S/.test(node.textContent || "")) {
          node.textContent = node.textContent.replace(STEP, "");
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
      // Stop only at a heading of equal or higher rank. An H2 step owns its
      // H3 subsections - stopping at any heading left them stranded between
      // one step card and the next.
      const stopAt = h.tagName === "H2" ? ["H2"] : ["H2", "H3"];
      let next = card.nextElementSibling;
      while (next && !stopAt.includes(next.tagName)) {
        const current = next;
        next = next.nextElementSibling;
        card.appendChild(current);
      }
    });
  };

  /* Shared chrome for every CTA illustration: soft drop shadow + the two
     decorative rings that sit behind the artwork on the gradient. Keeping one
     visual system means the art changes per topic but still looks like one
     product. All art uses the same 300x210 canvas. */
  const ART_DEFS = `
    <defs>
      <linearGradient id="tcxArtHead" x1="42" y1="14" x2="258" y2="58" gradientUnits="userSpaceOnUse">
        <stop stop-color="#AF40FF"/><stop offset="1" stop-color="#5B42F3"/>
      </linearGradient>
      <filter id="tcxArtShadow" x="-20%" y="-20%" width="150%" height="150%" color-interpolation-filters="sRGB">
        <feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#20074d" flood-opacity=".28"/>
      </filter>
    </defs>
    <g fill="none" stroke="#ffffff" stroke-opacity=".16" stroke-width="7">
      <circle cx="24" cy="150" r="19"/><circle cx="279" cy="120" r="12"/>
    </g>`;

  const ART = {
    /* Resume / ATS scan: a full resume page with an ATS score badge. */
    resume: `
      <g filter="url(#tcxArtShadow)">
        <rect x="42" y="14" width="216" height="182" rx="7" fill="#ffffff"/>
        <path d="M49 14h202a7 7 0 0 1 7 7v37H42V21a7 7 0 0 1 7-7Z" fill="url(#tcxArtHead)"/>
        <circle cx="68" cy="36" r="14" fill="#ffffff" fill-opacity=".28"/>
        <circle cx="68" cy="31.5" r="4.6" fill="#ffffff" fill-opacity=".92"/>
        <path d="M59.5 45a8.5 8.5 0 0 1 17 0Z" fill="#ffffff" fill-opacity=".92"/>
        <rect x="92" y="27" width="80" height="7" rx="3.5" fill="#ffffff" fill-opacity=".95"/>
        <rect x="92" y="39" width="52" height="5" rx="2.5" fill="#ffffff" fill-opacity=".62"/>
        <path d="M118 66v124" stroke="#efecf9" stroke-width="1.5"/>
        <rect x="52" y="70" width="38" height="5" rx="2.5" fill="#5B42F3"/>
        <g fill="#ded8f4">
          <circle cx="55" cy="84" r="2.6"/><rect x="62" y="81.6" width="42" height="4.2" rx="2.1"/>
          <circle cx="55" cy="95" r="2.6"/><rect x="62" y="92.6" width="36" height="4.2" rx="2.1"/>
          <circle cx="55" cy="106" r="2.6"/><rect x="62" y="103.6" width="40" height="4.2" rx="2.1"/>
        </g>
        <rect x="52" y="122" width="44" height="5" rx="2.5" fill="#5B42F3"/>
        <g fill="#e7e3f7">
          <rect x="52" y="135" width="52" height="4.2" rx="2.1"/>
          <rect x="52" y="144" width="38" height="4.2" rx="2.1"/>
        </g>
        <rect x="52" y="158" width="32" height="5" rx="2.5" fill="#5B42F3"/>
        <rect x="52" y="170" width="52" height="4.6" rx="2.3" fill="#efecf9"/>
        <rect x="52" y="170" width="42" height="4.6" rx="2.3" fill="#5B42F3"/>
        <rect x="52" y="179" width="52" height="4.6" rx="2.3" fill="#efecf9"/>
        <rect x="52" y="179" width="34" height="4.6" rx="2.3" fill="#AF40FF"/>
        <rect x="52" y="188" width="52" height="4.6" rx="2.3" fill="#efecf9"/>
        <rect x="52" y="188" width="26" height="4.6" rx="2.3" fill="#00DDEB"/>
        <rect x="128" y="70" width="74" height="5" rx="2.5" fill="#5B42F3"/>
        <g fill="#e7e3f7">
          <rect x="128" y="83" width="118" height="4.2" rx="2.1"/>
          <rect x="128" y="92" width="118" height="4.2" rx="2.1"/>
          <rect x="128" y="101" width="84" height="4.2" rx="2.1"/>
        </g>
        <rect x="128" y="118" width="64" height="5" rx="2.5" fill="#5B42F3"/>
        <rect x="128" y="131" width="62" height="5" rx="2.5" fill="#4b3a86"/>
        <rect x="216" y="131" width="30" height="5" rx="2.5" fill="#ded8f4"/>
        <g fill="#eeeaf8">
          <rect x="128" y="142" width="118" height="3.8" rx="1.9"/>
          <rect x="128" y="150" width="98" height="3.8" rx="1.9"/>
        </g>
        <rect x="128" y="163" width="56" height="5" rx="2.5" fill="#4b3a86"/>
        <rect x="216" y="163" width="30" height="5" rx="2.5" fill="#ded8f4"/>
        <g fill="#eeeaf8">
          <rect x="128" y="174" width="118" height="3.8" rx="1.9"/>
          <rect x="128" y="182" width="92" height="3.8" rx="1.9"/>
        </g>
      </g>
      <g filter="url(#tcxArtShadow)">
        <circle cx="252" cy="30" r="25" fill="#ffffff"/>
        <circle cx="252" cy="30" r="18" fill="none" stroke="#efecf9" stroke-width="6"/>
        <path d="M252 12a18 18 0 1 1-16 26" fill="none" stroke="#7bd444" stroke-width="6" stroke-linecap="round"/>
        <path d="M236 38a18 18 0 0 1 6-21" fill="none" stroke="#00DDEB" stroke-width="6" stroke-linecap="round"/>
        <text x="240" y="35" fill="#4b1fa8" font-size="13" font-weight="850">87%</text>
      </g>
      <g filter="url(#tcxArtShadow)">
        <circle cx="250" cy="182" r="17" fill="#5B42F3"/>
        <path d="m242.5 182 5 5 11-12" fill="none" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      </g>`,

    /* Cover letter: a letter sheet with an envelope badge. */
    letter: `
      <g filter="url(#tcxArtShadow)">
        <rect x="58" y="16" width="184" height="178" rx="7" fill="#ffffff"/>
        <rect x="78" y="38" width="72" height="7" rx="3.5" fill="#4b3a86"/>
        <rect x="78" y="53" width="48" height="5" rx="2.5" fill="#ded8f4"/>
        <rect x="78" y="76" width="144" height="5" rx="2.5" fill="#5B42F3"/>
        <g fill="#e7e3f7">
          <rect x="78" y="92" width="144" height="4.4" rx="2.2"/>
          <rect x="78" y="102" width="144" height="4.4" rx="2.2"/>
          <rect x="78" y="112" width="116" height="4.4" rx="2.2"/>
          <rect x="78" y="126" width="144" height="4.4" rx="2.2"/>
          <rect x="78" y="136" width="144" height="4.4" rx="2.2"/>
          <rect x="78" y="146" width="92" height="4.4" rx="2.2"/>
        </g>
        <path d="M78 170h44" stroke="#AF40FF" stroke-width="3" stroke-linecap="round"/>
        <rect x="78" y="178" width="34" height="4" rx="2" fill="#ded8f4"/>
      </g>
      <g filter="url(#tcxArtShadow)">
        <rect x="186" y="128" width="76" height="54" rx="8" fill="url(#tcxArtHead)"/>
        <path d="M194 138l30 22 30-22" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      </g>`,

    /* Templates: a fanned stack of resume cards. */
    templates: `
      <g filter="url(#tcxArtShadow)">
        <rect x="44" y="42" width="120" height="150" rx="8" fill="#ffffff" opacity=".55" transform="rotate(-8 104 117)"/>
      </g>
      <g filter="url(#tcxArtShadow)">
        <rect x="76" y="30" width="128" height="162" rx="8" fill="#ffffff" opacity=".8"/>
      </g>
      <g filter="url(#tcxArtShadow)">
        <rect x="112" y="18" width="140" height="176" rx="8" fill="#ffffff"/>
        <path d="M119 18h126a7 7 0 0 1 7 7v27H112V25a7 7 0 0 1 7-7Z" fill="url(#tcxArtHead)"/>
        <rect x="126" y="28" width="62" height="6" rx="3" fill="#ffffff" fill-opacity=".95"/>
        <rect x="126" y="39" width="40" height="4" rx="2" fill="#ffffff" fill-opacity=".6"/>
        <rect x="126" y="66" width="44" height="5" rx="2.5" fill="#5B42F3"/>
        <g fill="#e7e3f7">
          <rect x="126" y="80" width="112" height="4.4" rx="2.2"/>
          <rect x="126" y="90" width="112" height="4.4" rx="2.2"/>
          <rect x="126" y="100" width="80" height="4.4" rx="2.2"/>
        </g>
        <rect x="126" y="118" width="52" height="5" rx="2.5" fill="#5B42F3"/>
        <g fill="#e7e3f7">
          <rect x="126" y="132" width="112" height="4.4" rx="2.2"/>
          <rect x="126" y="142" width="96" height="4.4" rx="2.2"/>
          <rect x="126" y="152" width="112" height="4.4" rx="2.2"/>
          <rect x="126" y="162" width="70" height="4.4" rx="2.2"/>
        </g>
        <rect x="126" y="176" width="36" height="5" rx="2.5" fill="#00DDEB"/>
      </g>`,

    /* Portfolio: a browser window with a project grid. */
    portfolio: `
      <g filter="url(#tcxArtShadow)">
        <rect x="34" y="26" width="232" height="158" rx="9" fill="#ffffff"/>
        <path d="M43 26h214a9 9 0 0 1 9 9v17H34V35a9 9 0 0 1 9-9Z" fill="url(#tcxArtHead)"/>
        <circle cx="50" cy="39" r="4" fill="#ffffff" fill-opacity=".9"/>
        <circle cx="63" cy="39" r="4" fill="#ffffff" fill-opacity=".65"/>
        <circle cx="76" cy="39" r="4" fill="#ffffff" fill-opacity=".45"/>
        <rect x="94" y="34" width="150" height="10" rx="5" fill="#ffffff" fill-opacity=".28"/>
        <circle cx="62" cy="80" r="16" fill="#efe9fd"/>
        <circle cx="62" cy="75.5" r="5.4" fill="#5B42F3"/>
        <path d="M52 90a10 10 0 0 1 20 0Z" fill="#5B42F3"/>
        <rect x="88" y="70" width="86" height="6" rx="3" fill="#4b3a86"/>
        <rect x="88" y="82" width="60" height="5" rx="2.5" fill="#ded8f4"/>
        <g>
          <rect x="46" y="112" width="62" height="46" rx="6" fill="#f2eefe"/>
          <rect x="54" y="120" width="46" height="18" rx="4" fill="#AF40FF" opacity=".85"/>
          <rect x="54" y="144" width="36" height="5" rx="2.5" fill="#ded8f4"/>
          <rect x="119" y="112" width="62" height="46" rx="6" fill="#f2eefe"/>
          <rect x="127" y="120" width="46" height="18" rx="4" fill="#5B42F3" opacity=".85"/>
          <rect x="127" y="144" width="36" height="5" rx="2.5" fill="#ded8f4"/>
          <rect x="192" y="112" width="62" height="46" rx="6" fill="#f2eefe"/>
          <rect x="200" y="120" width="46" height="18" rx="4" fill="#00DDEB" opacity=".85"/>
          <rect x="200" y="144" width="36" height="5" rx="2.5" fill="#ded8f4"/>
        </g>
      </g>`,

    /* Interview: two chat bubbles with a mic badge. */
    interview: `
      <g filter="url(#tcxArtShadow)">
        <path d="M46 34h150a10 10 0 0 1 10 10v52a10 10 0 0 1-10 10H92l-24 20v-20H46a10 10 0 0 1-10-10V44a10 10 0 0 1 10-10Z" fill="#ffffff"/>
        <g fill="#e7e3f7">
          <rect x="56" y="52" width="122" height="5.4" rx="2.7"/>
          <rect x="56" y="65" width="122" height="5.4" rx="2.7"/>
          <rect x="56" y="78" width="80" height="5.4" rx="2.7"/>
        </g>
      </g>
      <g filter="url(#tcxArtShadow)">
        <path d="M118 118h128a10 10 0 0 1 10 10v42a10 10 0 0 1-10 10H162l-20 18v-18h-24a10 10 0 0 1-10-10v-42a10 10 0 0 1 10-10Z" fill="url(#tcxArtHead)"/>
        <g fill="#ffffff" fill-opacity=".9">
          <rect x="130" y="134" width="104" height="5.4" rx="2.7"/>
          <rect x="130" y="147" width="104" height="5.4" rx="2.7"/>
          <rect x="130" y="160" width="66" height="5.4" rx="2.7"/>
        </g>
      </g>
      <g filter="url(#tcxArtShadow)">
        <circle cx="66" cy="150" r="24" fill="#ffffff"/>
        <rect x="59" y="136" width="14" height="22" rx="7" fill="#5B42F3"/>
        <path d="M53 152a13 13 0 0 0 26 0" fill="none" stroke="#5B42F3" stroke-width="3.4" stroke-linecap="round"/>
        <path d="M66 165v6" stroke="#5B42F3" stroke-width="3.4" stroke-linecap="round"/>
      </g>`,

    /* Extension: a browser bar with a job card and the tailor badge. */
    extension: `
      <g filter="url(#tcxArtShadow)">
        <rect x="34" y="30" width="232" height="150" rx="9" fill="#ffffff"/>
        <path d="M43 30h214a9 9 0 0 1 9 9v19H34V39a9 9 0 0 1 9-9Z" fill="url(#tcxArtHead)"/>
        <rect x="48" y="38" width="132" height="12" rx="6" fill="#ffffff" fill-opacity=".28"/>
        <rect x="196" y="37" width="26" height="14" rx="5" fill="#ffffff" fill-opacity=".92"/>
        <path d="M203 44h12M209 40v8" stroke="#5B42F3" stroke-width="2.6" stroke-linecap="round"/>
        <rect x="50" y="74" width="88" height="6" rx="3" fill="#4b3a86"/>
        <rect x="50" y="88" width="58" height="5" rx="2.5" fill="#ded8f4"/>
        <g fill="#e7e3f7">
          <rect x="50" y="108" width="164" height="4.6" rx="2.3"/>
          <rect x="50" y="119" width="164" height="4.6" rx="2.3"/>
          <rect x="50" y="130" width="120" height="4.6" rx="2.3"/>
        </g>
        <rect x="50" y="150" width="74" height="16" rx="6" fill="#5B42F3"/>
        <rect x="132" y="150" width="52" height="16" rx="6" fill="#efe9fd"/>
      </g>
      <g filter="url(#tcxArtShadow)">
        <circle cx="242" cy="150" r="26" fill="#ffffff"/>
        <circle cx="242" cy="150" r="18" fill="none" stroke="#efecf9" stroke-width="6"/>
        <path d="M242 132a18 18 0 1 1-16 26" fill="none" stroke="#7bd444" stroke-width="6" stroke-linecap="round"/>
        <path d="M234 150l5 5 11-12" fill="none" stroke="#5B42F3" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
      </g>`,
  };

  const buildArt = (name) =>
    `<svg viewBox="0 0 300 210" role="img" focusable="false">${ART_DEFS}${ART[name] || ART.resume}</svg>`;

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
        art: "letter",
      },
      {
        test: (href, text) => href.includes("/templates") || text.includes("template"),
        title: "Start with a resume layout recruiters can read fast.",
        text: "Choose a clean template, keep the structure simple, and make every section easier to scan.",
        label: "Browse resume templates",
        fallback: "/templates",
        art: "templates",
      },
      {
        test: (href, text) => href.includes("/portfolio") || text.includes("portfolio"),
        title: "Turn your resume story into a portfolio recruiters can explore.",
        text: "Show projects, proof, and results in a polished page that supports your application.",
        label: "Build your portfolio",
        fallback: "/portfolio",
        art: "portfolio",
      },
      {
        test: (href, text) => href.includes("/mock-interview") || text.includes("interview"),
        title: "Practice before the real interview starts.",
        text: "Turn your resume into realistic questions, rehearse stronger answers, and walk in prepared.",
        label: "Practice an interview",
        fallback: "/mock-interview",
        art: "interview",
      },
      {
        test: (href, text) => href.includes("/modify-cv") || text.includes("resume builder"),
        title: "Build a cleaner resume without fighting the formatting.",
        text: "Create a structured, ATS-friendly resume that is easy for both software and recruiters to read.",
        label: "Open resume builder",
        fallback: "/modify-cv",
        art: "resume",
      },
      {
        test: (href, text) => href.includes("/extension") || text.includes("chrome extension"),
        title: "Tailor faster while you browse jobs.",
        text: "Use TailorCV on job pages, check fit quickly, and adapt your resume without breaking your flow.",
        label: "Get the extension",
        fallback: "/extension",
        art: "extension",
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
    const DEFAULT_PROFILE = {
      title: "Your resume should be easy to read and easy to rank.",
      text: "Check the match before you send it, then tune the words, sections, and formatting for the role.",
      label: "Try a free resume scan",
      fallback: "/solutions",
      art: "resume",
    };
    let profile = profiles.find((item) => item.test(preferredHref, preferredText)) || DEFAULT_PROFILE;
    // Same reasoning: the server already matched this post to a tool, so send
    // the reader there rather than to whichever product link appeared first.
    const serverUrl = content.dataset.ctaUrl || "";
    const serverLabel = content.dataset.ctaLabel || "";
    // The button's destination is the server's decision, so the artwork and
    // the copy have to be chosen from THAT - not from whichever product link
    // happened to appear first in the body. The two were disagreeing: an
    // envelope illustration sat above a "Try a Free AI Mock Interview" button.
    if (serverUrl || serverLabel) {
      // Once the server has chosen the destination, the body link no longer
      // gets a vote. If the server CTA matches no topic profile (e.g. a plain
      // "Tailor Your Resume" pointing at /solutions), fall back to the generic
      // resume profile - NOT to whatever the first body link happened to be.
      // Keeping the old profile is what left an envelope illustration and
      // cover-letter headline above a "Tailor Your Resume" button.
      profile = profiles.find((item) => item.test(serverUrl, serverLabel.toLowerCase())) || DEFAULT_PROFILE;
    }
    const ctaHref = serverUrl || (preferredAnchor ? preferredAnchor.href : profile.fallback);
    if (serverLabel) profile = Object.assign({}, profile, { label: serverLabel });

    const cta = document.createElement("aside");
    cta.className = "article-cta-strip";
    cta.innerHTML = `
      <div class="article-cta-visual" aria-hidden="true">
        ${buildArt(profile.art)}
      </div>
      <div class="article-cta-copy">
        <p class="article-cta-title">${profile.title}</p>
        <p class="article-cta-text">${profile.text}</p>
        <a class="article-cta-button" href="${ctaHref}"><span class="tcx-btn-label">${profile.label}</span></a>
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

  /* Enhancv-style closing card: the last thing in the article body, centred,
     with the same topic-aware destination the mid-article strip uses. */
  const addEndOfArticleCta = () => {
    const content = document.querySelector(".post-content");
    if (!content || content.querySelector(".end-cta")) return;

    // Use the CTA the SERVER picked from the post's topic (blog_cta in
    // main.py) - the same one the hero and sidebar show. Reading it off the
    // mid-article strip instead meant a tailoring guide that happened to link
    // to the portfolio builder ended with "Build your portfolio", contradicting
    // its own sidebar.
    const strip = content.querySelector(".article-cta-strip");
    const stripLink = strip ? strip.querySelector(".article-cta-button") : null;
    const href = content.dataset.ctaUrl ||
                 (stripLink ? stripLink.getAttribute("href") : "/solutions");
    const label = content.dataset.ctaLabel ||
                  (stripLink ? (stripLink.textContent || "").trim() : "Try a free resume scan");

    const box = document.createElement("aside");
    box.className = "end-cta";
    box.innerHTML = `
      <svg class="end-cta-arc" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M-40 250C160 120 340 300 520 170 700 40 860 150 1040 60"
              fill="none" stroke="#ffffff" stroke-opacity=".22" stroke-width="2"/>
        <path d="M-40 300C180 190 320 340 540 230 760 120 880 210 1040 130"
              fill="none" stroke="#ffffff" stroke-opacity=".14" stroke-width="2"/>
      </svg>
      <svg class="end-cta-swirl end-cta-swirl-l" viewBox="0 0 120 90" aria-hidden="true" focusable="false">
        <path d="M6 78c26 10 44-4 40-22C42 40 24 42 24 58c0 18 24 26 46 18 20-7 30-24 26-44"
              fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      <svg class="end-cta-swirl end-cta-swirl-r" viewBox="0 0 120 90" aria-hidden="true" focusable="false">
        <path d="M114 12c-26-10-44 4-40 22 4 16 22 14 22-2 0-18-24-26-46-18C30 21 20 38 24 58"
              fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="2.5" stroke-linecap="round"/>
      </svg>

      <svg class="end-cta-face end-cta-face-l" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <defs><clipPath id="tcxFaceA"><circle cx="60" cy="60" r="58"/></clipPath></defs>
        <circle cx="60" cy="60" r="58" fill="#F7C860"/>
        <g clip-path="url(#tcxFaceA)">
          <path d="M14 122c0-24 20-36 46-36s46 12 46 36z" fill="#ffffff"/>
          <path d="M50 76h20v16H50z" fill="#EFC09A"/>
          <ellipse cx="60" cy="57" rx="23" ry="26" fill="#F8D2AE"/>
          <path d="M36 54c0-17 11-28 24-28s24 11 24 28c0-7-6-11-13-12-8-1-14 2-22 1-7-1-13 4-13 11z" fill="#6E3A5C"/>
          <circle cx="50" cy="59" r="8.4" fill="#ffffff" fill-opacity=".55" stroke="#33283f" stroke-width="2.4"/>
          <circle cx="70" cy="59" r="8.4" fill="#ffffff" fill-opacity=".55" stroke="#33283f" stroke-width="2.4"/>
          <path d="M58.4 59h3.2" stroke="#33283f" stroke-width="2.4"/>
          <path d="M54 73q6 5 12 0" fill="none" stroke="#9a6242" stroke-width="2.2" stroke-linecap="round"/>
        </g>
      </svg>

      <svg class="end-cta-face end-cta-face-r" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <defs><clipPath id="tcxFaceB"><circle cx="60" cy="60" r="58"/></clipPath></defs>
        <circle cx="60" cy="60" r="58" fill="#8E7CF0"/>
        <g clip-path="url(#tcxFaceB)">
          <path d="M14 122c0-24 20-36 46-36s46 12 46 36z" fill="#5B42F3"/>
          <path d="M52 76h16v16H52z" fill="#C2865E"/>
          <ellipse cx="60" cy="57" rx="22" ry="25" fill="#D69A70"/>
          <circle cx="60" cy="25" r="10" fill="#5C3049"/>
          <path d="M38 55c0-17 10-28 22-28s22 11 22 28c0-8-8-12-22-12s-22 4-22 12z" fill="#5C3049"/>
          <circle cx="51" cy="56" r="2.7" fill="#33283f"/>
          <circle cx="69" cy="56" r="2.7" fill="#33283f"/>
          <path d="M53 67q7 9 14 0z" fill="#ffffff" stroke="#33283f" stroke-width="1.5" stroke-linejoin="round"/>
          <circle cx="44" cy="64" r="3.6" fill="#E9A184" opacity=".65"/>
          <circle cx="76" cy="64" r="3.6" fill="#E9A184" opacity=".65"/>
        </g>
      </svg>

      <p class="end-cta-title">Make your move.</p>
      <p class="end-cta-text">Your resume is an extension of yourself. Make one that is truly you.</p>
      <a class="end-cta-btn" href="${href}"><span class="tcx-btn-label">${label}</span></a>
    `;
    content.appendChild(box);
  };

  /* The ATS scanner and template gallery are rendered at the end of
     .post-content (that is the only place the template can inject them), but
     they convert far better partway through the read. Move them onto H2
     boundaries at roughly 45% and 72% of the article.

     Only top-level H2s count - headings already swallowed into a step card,
     FAQ or takeaways box are skipped, so a block never lands inside another
     card. Short articles keep them at the end rather than crowding the intro. */
  const placeInlineBlocks = () => {
    const content = document.querySelector(".post-content");
    if (!content) return;

    const headings = Array.from(content.children).filter((el) => el.tagName === "H2");
    const move = (sel, ratio) => {
      const block = content.querySelector(sel);
      if (!block || headings.length < 5) return;
      const target = headings[Math.floor(headings.length * ratio)];
      // Never place it directly against another promo block.
      if (!target || target.previousElementSibling === block) return;
      if (target.previousElementSibling &&
          target.previousElementSibling.matches(".article-cta-strip, .blog-ats, .blog-tpl")) return;
      target.before(block);
    };

    move("#blog-ats-scanner", 0.45);
    move("#blog-template-showcase", 0.72);
  };

  /* Reveal the CTA cards when they scroll into view. The CSS holds them at
     opacity 0 only under prefers-reduced-motion: no-preference, so if motion
     is reduced (or IntersectionObserver is missing) they are already visible
     and this is a no-op - the cards can never end up permanently hidden. */
  const initCtaReveal = () => {
    const cards = document.querySelectorAll(".article-cta-strip, .end-cta");
    if (!cards.length) return;
    if (!("IntersectionObserver" in window)) {
      cards.forEach((c) => c.classList.add("tcx-cta-in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("tcx-cta-in");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
    cards.forEach((c) => io.observe(c));
    // Safety net: never leave a card faded out if the observer never fires.
    setTimeout(() => cards.forEach((c) => c.classList.add("tcx-cta-in")), 2500);
  };

  const enhanceBottomLine = () => {
    document.querySelectorAll(".post-content h2").forEach((h2) => {
      if (!/^(final thoughts|bottom line|the bottom line|conclusion)$/.test(normalizeText(h2))) return;
      if (h2.closest(".article-bottomline")) return;

      // The bottom-line box reads as "the article ends here". Only style it
      // that way when nothing substantive follows - an FAQ or a links roundup
      // conventionally sits after a conclusion, but a real content section
      // after it means this heading is mid-article and boxing it is wrong.
      const TRAILING_OK = /^(frequently asked questions|faqs?|common questions|related guides?|related articles?|make this practical|sources?|references?)$/;
      const laterHeadings = Array.from(document.querySelectorAll(".post-content h2"))
        .filter((h) => h !== h2 && h2.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (laterHeadings.some((h) => !TRAILING_OK.test(normalizeText(h)))) return;
      // Stop at already-boxed blocks too. A "Conclusion" that sits before the
      // FAQ would otherwise swallow the whole .faq-box (its H2 is no longer a
      // sibling once wrapped), nesting one card inside another.
      const nodes = collectUntilNextHeading(h2, ["H2"]).filter((n, i, all) => {
        const stopAt = all.findIndex((x) =>
          x.matches && x.matches(".faq-box, .key-takeaways-box, .step-card, .article-cta-strip, .end-cta"));
        return stopAt === -1 || i < stopAt;
      });
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
    placeInlineBlocks();
    addEndOfArticleCta();
    // Rating goes last, after the closing CTA - it is the final thing we ask
    // of the reader, not something that interrupts the sign-off.
    const rateBox = document.getElementById("blog-rate");
    const contentEl = document.querySelector(".post-content");
    if (rateBox && contentEl) contentEl.appendChild(rateBox);
    initCtaReveal();
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

/* Article star rating. Posts to /api/blog/<slug>/rate; the server upserts on
   (slug, voter_hash), so re-rating replaces the previous vote rather than
   adding a second one. Remembers locally only to show the chosen state. */
(() => {
  const box = document.getElementById("blog-rate");
  if (!box) return;
  const stars = Array.from(box.querySelectorAll(".blog-rate-star"));
  const sub = document.getElementById("blog-rate-sub");
  const slug = box.dataset.slug;
  const KEY = "tcx_blog_rating_" + slug;

  const paint = (n) => stars.forEach((s, i) => {
    s.classList.toggle("is-on", i < n);
    s.setAttribute("aria-checked", String(i + 1 === n));
  });

  const summarise = (a, c) => {
    avg = Number(a); count = Number(c);
    if (!count) { sub.textContent = "Be the first to rate it."; return; }
    sub.innerHTML = "Average <strong>" + avg.toFixed(2) + "</strong> / 5.00 &middot; " +
      count + " rating" + (count === 1 ? "" : "s");
  };

  // What the stars show when nobody is hovering: your own rating if you have
  // one, otherwise the community average rounded to the nearest star. Without
  // this a post with a 4.00 average showed five empty stars to every new
  // reader, which reads as "unrated" and contradicts the text beside it.
  let avg = parseFloat(box.dataset.average || "0") || 0;
  let count = parseInt(box.dataset.count || "0", 10) || 0;
  let mine = 0;
  try { mine = parseInt(localStorage.getItem(KEY) || "0", 10) || 0; } catch (_) {}

  const resting = () => mine || (count ? Math.round(avg) : 0);
  paint(resting());
  if (mine) box.classList.add("is-done");
  else if (count) box.classList.add("is-avg");

  stars.forEach((star) => {
    star.addEventListener("mouseenter", () => { if (!box.classList.contains("is-done")) paint(Number(star.dataset.value)); });
    star.addEventListener("click", () => {
      const value = Number(star.dataset.value);
      mine = value;                     // keep, or mouseleave repaints back to 0
      paint(value);
      box.classList.remove("is-avg");
      box.classList.add("is-done");
      try { localStorage.setItem(KEY, String(value)); } catch (_) {}
      // Double-submit CSRF: the cookie is set on every response, and the
      // matching header has to go with any JSON POST or the middleware 403s.
      const csrf = (document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/) || [])[1];
      fetch("/api/blog/" + encodeURIComponent(slug) + "/rate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrf ? decodeURIComponent(csrf) : "",
        },
        body: JSON.stringify({ rating: value }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("rate failed"))))
        .then((d) => { summarise(d.average, d.count); sub.textContent += " \u2014 thanks!"; })
        .catch(() => {
          sub.textContent = "Could not save that rating. Please try again.";
          box.classList.remove("is-done");
          mine = 0;
          paint(resting());
          try { localStorage.removeItem(KEY); } catch (_) {}
        });
    });
  });

  box.querySelector(".blog-rate-stars").addEventListener("mouseleave", () => paint(resting()));
})();

/* Turn percentage cells in article tables into data bars.
   Purely a visual read of numbers already printed in the cell - nothing is
   computed or invented. Only runs when a column is mostly percentages and has
   at least 3 of them, so a stray "40%" in prose never gets a bar. */
(() => {
  const content = document.querySelector(".post-content");
  if (!content) return;
  const PCT = /^\s*(\d{1,3})(?:\s*[-\u2013]\s*(\d{1,3}))?\s*%\s*$/;

  content.querySelectorAll("table").forEach((table) => {
    const rows = Array.from(table.querySelectorAll("tbody tr"));
    if (rows.length < 3) return;
    const cols = rows[0] ? rows[0].children.length : 0;

    for (let c = 0; c < cols; c++) {
      const cells = rows.map((r) => r.children[c]).filter(Boolean);
      const parsed = cells.map((cell) => PCT.exec((cell.textContent || "").trim()));
      const hits = parsed.filter(Boolean).length;
      // the column must be predominantly percentages, not just contain one
      if (hits < 3 || hits < cells.length * 0.8) continue;

      cells.forEach((cell, i) => {
        const m = parsed[i];
        if (!m || cell.querySelector(".tcx-bar")) return;
        // for a range like 30-40%, size the bar on the upper bound
        const value = Math.min(100, Number(m[2] || m[1]));
        const label = (cell.textContent || "").trim();
        cell.classList.add("tcx-bar-cell");
        cell.innerHTML =
          '<span class="tcx-bar-val">' + label + "</span>" +
          '<span class="tcx-bar" aria-hidden="true"><span class="tcx-bar-fill" style="width:' + value + '%"></span></span>';
      });
      break;   // one bar column per table is enough
    }
  });
})();

/* Highlighted sections: red for "common mistakes", green for examples.
   Mirrors the reference layouts - a coloured rule, an icon, and a tinted
   panel - so the reader can tell at a glance whether a block is a warning
   or a worked example. Runs after the other enhancers so it never grabs a
   heading already inside a step card, FAQ or takeaways box. */
(() => {
  const content = document.querySelector(".post-content");
  if (!content) return;

  // "Mistake 3: Using Tables..." is the dominant form in the corpus, so match a
  // leading "Mistake" as well as the phrase variants.
  const MISTAKE = /^mistakes?\b|common mistakes|mistakes to avoid|what not to do|avoid these|red flags?|pitfalls/i;
  // Only short, self-contained example headings - not "20 Resume Summary
  // Examples", which is a whole section and would become a wall of green.
  const EXAMPLE = /^(good |better |strong |weak |bad )?(worked )?examples?\b|\bexample\b\s*[:—-]/i;
  const INSIDE = ".step-card, .faq-box, .key-takeaways-box, .article-bottomline, .blog-ats, .blog-tpl, .end-cta";

  const ICON = {
    mistake: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6" stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
    example: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12.5l2.6 2.6L16 9.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>',
  };

  const wrap = (heading, kind) => {
    if (heading.closest(INSIDE) || heading.closest(".callout-box")) return;
    const nodes = [];
    let next = heading.nextElementSibling;
    while (next) {
      // Stop at ANY heading. Continuing past a lower-rank one swallowed the
      // image sections ("### What the finished letter looks like") that sit
      // under a "## Common Mistakes" card.
      if (/^H[1-6]$/.test(next.tagName)) break;
      if (next.matches && next.matches(INSIDE)) break;
      // never absorb a screenshot panel into a text callout
      if (next.tagName === "P" && next.querySelector("img")) break;
      nodes.push(next);
      next = next.nextElementSibling;
    }
    if (!nodes.length) return;

    const box = document.createElement("section");
    box.className = "callout-box callout-" + kind;
    heading.before(box);
    const head = document.createElement("div");
    head.className = "callout-head";
    head.innerHTML = '<span class="callout-ico">' + ICON[kind] + "</span>";
    box.appendChild(head);
    head.appendChild(heading);
    nodes.forEach((n) => box.appendChild(n));
  };

  // Before/after pairs: the corpus writes these as "Weak Bullet Points" then
  // "Strong Bullet Points". Require the keyword to START the heading and the
  // heading to be short, so questions ("How do I know if the final version is
  // strong enough?") and section titles are not caught.
  const WEAK = /^(weak|before|bad|poor|generic|wrong)/i;
  const STRONG = /^(strong|after|better|good|improved|fixed)/i;

  Array.from(content.querySelectorAll("h2, h3")).forEach((h) => {
    const text = (h.textContent || "").replace("#", "").trim();
    if (MISTAKE.test(text)) wrap(h, "mistake");
    else if (h.tagName === "H3" && EXAMPLE.test(text) && text.length < 60) wrap(h, "example");

  });

  /* Most "Common Mistakes" sections are one heading + a single numbered list,
     which wrap() above boxes as ONE card - unlike the ~37 posts that already
     write each mistake as its own "### Mistake N: ..." heading (and so
     already get individual cards). Split the list inside each mistake box
     into the same individual-card treatment, auto-numbered, so every
     mistakes section reads the same way regardless of how the post wrote it.
     Purely a DOM restructure of text already on the page - invents nothing. */
  content.querySelectorAll(".callout-mistake").forEach((box) => {
    const list = box.querySelector(":scope > ol, :scope > ul");
    if (!list) return;
    const items = Array.from(list.children).filter((n) => n.tagName === "LI");
    if (items.length < 2) return;

    const grid = document.createElement("div");
    grid.className = "mistake-grid";
    list.before(grid);

    items.forEach((li, i) => {
      const card = document.createElement("section");
      card.className = "callout-box callout-mistake mistake-grid-item";
      const head = document.createElement("div");
      head.className = "callout-head";
      head.innerHTML = '<span class="callout-ico">' + ICON.mistake + "</span>";
      const h3 = document.createElement("h3");

      // if the item leads with **Bold text**, use it as the card's own
      // title and drop it (plus a following ": ") from the body so it is
      // not shown twice.
      const firstP = li.querySelector(":scope > p:first-child") || li;
      const lead = firstP.querySelector(":scope > strong:first-child, :scope > b:first-child");
      let title = "Mistake " + (i + 1);
      if (lead && firstP.firstChild === lead) {
        title += ": " + (lead.textContent || "").replace(/:\s*$/, "");
        lead.remove();
        if (firstP.firstChild && firstP.firstChild.nodeType === Node.TEXT_NODE) {
          firstP.firstChild.textContent = firstP.firstChild.textContent.replace(/^\s*:\s*/, "");
        }
      }
      h3.textContent = title;
      head.appendChild(h3);
      card.appendChild(head);
      Array.from(li.childNodes).forEach((n) => card.appendChild(n));
      grid.appendChild(card);
    });
    list.remove();
  });

  /* "Before (generic resume)" / "After (Matched Resume)" followed by a code
     block. These are the strongest proof in the article but rendered as two
     identical grey boxes, so the contrast was invisible. Pair the label with
     its block and colour them. */
  Array.from(content.querySelectorAll("p")).forEach((p) => {
    const lead = p.querySelector("strong, b");
    if (!lead) return;
    const m = /^(before|after)/i.exec((lead.textContent || "").trim());
    if (!m) return;
    const block = p.nextElementSibling;
    if (!block || !/^(PRE|DIV|TABLE|UL|OL)$/.test(block.tagName)) return;
    if (p.closest(".ba-block")) return;

    const kind = m[1].toLowerCase() === "before" ? "before" : "after";
    const box = document.createElement("section");
    box.className = "ba-block ba-" + kind;
    p.before(box);
    p.classList.add("ba-label");
    box.appendChild(p);
    box.appendChild(block);
  });

  // Short lead-in labels that carry the point of the paragraph.
  const LABEL = /^(pro tip|tip|note|important|remember|why it works|why this works|bottom line|key point|takeaway)\s*[:—-]/i;
  content.querySelectorAll("p").forEach((p) => {
    if (p.closest(".callout-box, .step-card, .faq-box, .key-takeaways-box, .blog-ats, .blog-tpl")) return;
    const lead = p.querySelector("strong, b");
    if (!lead) return;
    if (!LABEL.test(((lead.textContent || "") + ":").trim())) return;
    p.classList.add("callout-note-inline");
  });
})();

/* Do / Don't pairs rendered side by side, like the reference layouts.
   The corpus writes these as "### Do's:" immediately followed by "### Don'ts:".
   Pairing them into two columns makes the contrast readable at a glance
   instead of asking the reader to hold the first list in their head. */
/* Deferred to a tick after DOMContentLoaded so it runs AFTER init()'s
   enhancers have finished restructuring .post-content - pairing headings
   while step cards and FAQ boxes are still being moved gave inconsistent
   results. */
const tcxRunPairs = () => {
  const content = document.querySelector(".post-content");
  if (!content) return;
  const DO = /^(do'?s?|dos)\s*:?\s*$/i;
  const DONT = /^(don'?ts?|donts)\s*:?\s*$/i;
  const clean = (h) => (h.textContent || "").replace("#", "").trim();

  const ICON = {
    do: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#16a34a"/><path d="M8 12.5l2.6 2.6L16 9.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dont: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#ef4444"/><path d="M15 9l-6 6M9 9l6 6" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
    strong: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#16a34a"/><path d="M8 12.5l2.6 2.6L16 9.5" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    weak: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#d97706"/><path d="M15 9l-6 6M9 9l6 6" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>',
  };

  const BOXED = ".faq-box, .key-takeaways-box, .article-bottomline, .blog-ats, .blog-tpl, " +
                ".end-cta, .article-cta-strip, .blog-rate, .callout-box, .step-card, .dd-grid";
  const take = (heading) => {
    const nodes = [];
    let n = heading.nextElementSibling;
    let seenList = false;
    while (n && !/^H[1-6]$/.test(n.tagName)) {
      // Stop at anything an earlier enhancer already boxed up - otherwise the
      // FAQ, the template gallery or a screenshot ends up inside a Don't column.
      if (n.matches && n.matches(BOXED)) break;
      if (n.tagName === "P" && n.querySelector("img")) break;
      // Prose AFTER the list is the section's sign-off, not another item -
      // it was being pulled into the column and unbalancing the pair.
      if (seenList && n.tagName === "P") break;
      if (n.tagName === "UL" || n.tagName === "OL") seenList = true;
      nodes.push(n);
      n = n.nextElementSibling;
    }
    return nodes;
  };

  // Weak/Strong pairs - same grid, different labels + icons. The corpus
  // writes "### Weak Bullet Points" then "### Strong Bullet Points" (or the
  // reverse order in a few posts), one right after the other.
  const startsWith = (word) => (h) => clean(h).toLowerCase().startsWith(word);
  const WEAK_H = startsWith("weak"), STRONG_H = startsWith("strong");
  const pairUp = (firstTest, firstKind, secondTest, secondKind) => {
    Array.from(content.querySelectorAll("h3")).forEach((h1) => {
      if (!firstTest(h1) || h1.closest(".dd-grid")) return;
      const n1 = take(h1);
      const h2 = n1.length ? n1[n1.length - 1].nextElementSibling : h1.nextElementSibling;
      if (!h2 || h2.tagName !== "H3" || !secondTest(h2)) return;
      const n2 = take(h2);
      if (!n1.length || !n2.length) return;

      const grid = document.createElement("div");
      grid.className = "dd-grid";
      h1.before(grid);
      [[firstKind, h1, n1], [secondKind, h2, n2]].forEach(([kind, h, nodes]) => {
        const col = document.createElement("section");
        col.className = "dd-col dd-" + kind;
        const head = document.createElement("div");
        head.className = "dd-head";
        head.innerHTML = '<span class="dd-ico">' + ICON[kind] + "</span>";
        col.appendChild(head);
        head.appendChild(h);
        nodes.forEach((n) => col.appendChild(n));
        grid.appendChild(col);
      });
    });
  };
  pairUp(WEAK_H, "weak", STRONG_H, "strong");
  pairUp(STRONG_H, "strong", WEAK_H, "weak");

  Array.from(content.querySelectorAll("h3")).forEach((doH) => {
    if (!DO.test(clean(doH)) || doH.closest(".dd-grid")) return;
    const doNodes = take(doH);
    const dontH = doNodes.length ? doNodes[doNodes.length - 1].nextElementSibling : doH.nextElementSibling;
    if (!dontH || dontH.tagName !== "H3" || !DONT.test(clean(dontH))) return;
    const dontNodes = take(dontH);
    if (!doNodes.length || !dontNodes.length) return;

    const grid = document.createElement("div");
    grid.className = "dd-grid";
    doH.before(grid);

    [["do", doH, doNodes], ["dont", dontH, dontNodes]].forEach(([kind, h, nodes]) => {
      const col = document.createElement("section");
      col.className = "dd-col dd-" + kind;
      const head = document.createElement("div");
      head.className = "dd-head";
      head.innerHTML = '<span class="dd-ico">' + ICON[kind] + "</span>";
      col.appendChild(head);
      // normalise the label so one column never reads "Do's:" and the other "Don'ts"
      h.textContent = kind === "do" ? "Do" : "Don't";
      head.appendChild(h);
      nodes.forEach((n) => col.appendChild(n));
      grid.appendChild(col);
    });
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(tcxRunPairs, 0));
} else {
  setTimeout(tcxRunPairs, 0);
}

/* Copy-ready template blocks ("Full Template", "Template 2: ...", sample
   letters and email scripts) get an amber card. They are the thing readers
   actually take away from these posts, so they should not look like ordinary
   body copy. Runs after the other enhancers so it never re-wraps a section
   already inside a callout, FAQ or step card. */
const tcxTemplateBlocks = () => {
  const content = document.querySelector(".post-content");
  if (!content) return;
  const RE = /^(full template|template\b|the template|sample (letter|email|message|script)|email (template|script)|message template|letter template)/i;
  const INSIDE = ".callout-box, .faq-box, .key-takeaways-box, .step-card, .dd-grid, .blog-ats, .blog-tpl, .end-cta, .tpl-block";

  Array.from(content.querySelectorAll("h2, h3")).forEach((h) => {
    const text = (h.textContent || "").replace("#", "").trim();
    if (!RE.test(text) || h.closest(INSIDE)) return;

    const nodes = [];
    let n = h.nextElementSibling;
    while (n && !/^H[1-6]$/.test(n.tagName)) {
      if (n.matches && n.matches(INSIDE)) break;
      if (n.tagName === "P" && n.querySelector("img")) break;
      nodes.push(n);
      n = n.nextElementSibling;
    }
    if (!nodes.length) return;

    const box = document.createElement("section");
    box.className = "tpl-block";
    h.before(box);
    const head = document.createElement("div");
    head.className = "tpl-head";
    head.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" ' +
      'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<path d="M5 7v12a2 2 0 0 0 2 2h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    box.appendChild(head);
    head.appendChild(h);
    nodes.forEach((x) => box.appendChild(x));
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(tcxTemplateBlocks, 0));
} else {
  setTimeout(tcxTemplateBlocks, 0);
}

/* Runs of "**The core.** ..." / "**The formal adjustment.** ..." paragraphs
   render as an undifferentiated wall of text even though the author already
   labelled each point. Give every paragraph in such a run its own light card
   so the labels read as separate points. Pure restyling - the wording, order
   and markup content are untouched. */
const tcxLeadRuns = () => {
  const content = document.querySelector(".post-content");
  if (!content) return;
  const BOXED =
    ".faq-box, .key-takeaways-box, .article-bottomline, .blog-ats, .blog-tpl, .tpl-block, " +
    ".end-cta, .article-cta-strip, .blog-rate, .callout-box, .step-card, .dd-grid, .ba-block, .lead-run";

  // A lead paragraph is "<strong>Short label.</strong> then real prose" - not a
  // fully bolded line, and not a long bolded sentence acting as a heading.
  const isLead = (p) => {
    if (p.tagName !== "P") return false;
    if (p.closest(BOXED)) return false;
    if (p.querySelector("img")) return false;
    const lead = p.firstElementChild;
    if (!lead || !/^(STRONG|B)$/.test(lead.tagName) || p.firstChild !== lead) return false;
    const label = (lead.textContent || "").trim();
    if (!label || label.length > 80) return false;
    const rest = (p.textContent || "").slice(label.length).trim();
    return rest.length > 20;
  };

  const kids = Array.from(content.children);
  let i = 0;
  while (i < kids.length) {
    if (!isLead(kids[i])) { i++; continue; }
    let j = i;
    while (j < kids.length && isLead(kids[j])) j++;
    if (j - i >= 3) {
      const run = document.createElement("div");
      run.className = "lead-run";
      kids[i].before(run);
      for (let k = i; k < j; k++) {
        kids[k].classList.add("lead-item");
        run.appendChild(kids[k]);
      }
    }
    i = j;
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(tcxLeadRuns, 0));
} else {
  setTimeout(tcxLeadRuns, 0);
}

/* Two more "wall of plain text" shapes the corpus uses constantly:
     1. a run of "### Short heading" each followed by one or two paragraphs
     2. a list whose items each open with a **bold lead**
   Both already carry the author's own structure - it just isn't visible. Give
   each unit a light card so the page reads as points, not prose. Restyling
   only: no text is added, removed or reordered. */
const tcxPointCards = () => {
  const content = document.querySelector(".post-content");
  if (!content) return;
  const BOXED =
    ".faq-box, .key-takeaways-box, .article-bottomline, .blog-ats, .blog-tpl, .tpl-block, " +
    ".end-cta, .article-cta-strip, .blog-rate, .callout-box, .step-card, .dd-grid, .ba-block, " +
    ".lead-run, .point-run";

  /* 1. h3 + short prose runs. Only when the body is one or two plain
     paragraphs - a section with a list, image or code block is already
     structured and must not be boxed. */
  const kids = Array.from(content.children);
  const unit = (i) => {
    if (kids[i].tagName !== "H3" || kids[i].closest(BOXED)) return null;
    const body = [];
    let j = i + 1;
    while (j < kids.length && kids[j].tagName === "P") {
      if (kids[j].querySelector("img")) return null;
      body.push(kids[j]);
      j++;
    }
    if (!body.length || body.length > 2) return null;
    if (body.reduce((n, p) => n + p.textContent.length, 0) > 700) return null;
    return { end: j, nodes: [kids[i]].concat(body) };
  };

  let i = 0;
  while (i < kids.length) {
    const units = [];
    let j = i;
    for (;;) {
      const u = unit(j);
      if (!u) break;
      units.push(u);
      j = u.end;
    }
    if (units.length >= 3) {
      const run = document.createElement("div");
      run.className = "point-run";
      units[0].nodes[0].before(run);
      units.forEach((u) => {
        const card = document.createElement("section");
        card.className = "point-card";
        run.appendChild(card);
        u.nodes.forEach((n) => card.appendChild(n));
      });
      i = j;
    } else {
      i = units.length ? j : i + 1;
    }
  }

  /* 2. Lists where most items open with a bold lead. */
  content.querySelectorAll("ul, ol").forEach((list) => {
    if (list.closest(BOXED) || list.closest("li")) return;
    const items = Array.from(list.children).filter((n) => n.tagName === "LI");
    // Two is enough: a 2-item bold-lead list sitting next to a 3-item one
    // looked like a rendering bug when only the longer list got cards.
    if (items.length < 2) return;
    const led = items.filter((li) => {
      const first = li.firstElementChild;
      const host = first && first.tagName === "P" ? first : li;
      // Checklist items open with the checkbox markers, so look past those.
      const lead = Array.from(host.children).find((n) => !n.matches(".sr-only, .task-box"));
      return lead && /^(STRONG|B)$/.test(lead.tagName);
    });
    if (led.length < Math.ceil(items.length * 0.6)) return;
    list.classList.add("lead-list");
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(tcxPointCards, 0));
} else {
  setTimeout(tcxPointCards, 0);
}

/* Day plans, schedules and label lists are written as single-newline lines
   inside one markdown paragraph ("**Monday:** ... \n **Tuesday:** ..."), which
   markdown collapses into one run-on block. Split the paragraph back into one
   row per label. Nothing is reworded - only the line breaks the author already
   typed are restored. */
const tcxSplitLabelRows = () => {
  const content = document.querySelector(".post-content");
  if (!content) return;

  Array.from(content.querySelectorAll("p")).forEach((p) => {
    const labels = Array.from(p.children).filter(
      (n) => /^(STRONG|B)$/.test(n.tagName) && /:\s*$/.test(n.textContent || "")
    );
    if (labels.length < 3) return;
    const firstReal = Array.from(p.childNodes).find(
      (n) => n.nodeType !== Node.TEXT_NODE || n.textContent.trim()
    );
    if (firstReal !== labels[0]) return;

    const rows = [];
    let row = null;
    Array.from(p.childNodes).forEach((n) => {
      if (labels.includes(n)) {
        row = document.createElement("p");
        row.className = "row-line";
        rows.push(row);
      }
      if (row) row.appendChild(n);
    });
    if (rows.length < 3) return;

    rows.forEach((r) => {
      while (r.lastChild && r.lastChild.nodeType === Node.TEXT_NODE && !r.lastChild.textContent.trim()) {
        r.removeChild(r.lastChild);
      }
    });

    const wrap = document.createElement("div");
    wrap.className = "row-lines";
    p.before(wrap);
    rows.forEach((r) => wrap.appendChild(r));
    p.remove();
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(tcxSplitLabelRows, 0));
} else {
  setTimeout(tcxSplitLabelRows, 0);
}

/* The inline ATS scanner is appended at the very end of the article, but most
   posts explicitly tell the reader to "run your resume through the free ATS
   score checker" somewhere earlier. Move the widget to that sentence so the
   tool is right where the reader is told to use it. */
const tcxPlaceAtsWidget = () => {
  const content = document.querySelector(".post-content");
  const widget = content && content.querySelector(".blog-ats");
  if (!widget) return;

  // Drop the preview shot if the post already embeds the same screenshot.
  const shot = widget.querySelector(".blog-ats-preview img");
  if (shot) {
    const src = shot.getAttribute("src");
    const dupe = Array.from(content.querySelectorAll("img")).some(
      (i) => i !== shot && (i.getAttribute("src") || "").endsWith(src.split("/").pop())
    );
    if (dupe) shot.closest(".blog-ats-preview").remove();
  }

  const CUE = /(free )?ats (score )?(checker|scanner)|check your ats score|scan your resume/i;

  // A whole section about the score checker ("Why Use The TailorCV ATS Score
  // Checker") is the best possible home for it: drop the widget at the end of
  // that section so the reader finishes the pitch and lands on the tool.
  const CARD = ".step-card, .callout-box, .dd-grid, .tpl-block, .point-run, .lead-run, .ba-split";
  const section = Array.from(content.querySelectorAll("h2, h3")).find(
    (h) => !h.closest(".blog-ats, .faq-box") && CUE.test(h.textContent || "")
  );
  if (section) {
    // Never drop the widget inside a card - it would inherit that card's
    // colour scheme (white text on the widget's own light panel) and the copy
    // becomes invisible. Attach after the whole card instead.
    const card = section.closest(CARD);
    if (card) {
      card.after(widget);
      return;
    }
    const rank = section.tagName;
    let last = section;
    let n = section.nextElementSibling;
    while (n && !(/^H[1-6]$/.test(n.tagName) && n.tagName <= rank)) {
      if (n === widget) { n = n.nextElementSibling; continue; }
      last = n;
      n = n.nextElementSibling;
    }
    last.after(widget);
    return;
  }

  const anchor = Array.from(content.querySelectorAll("p")).find(
    (p) => !p.closest(".blog-ats, .end-cta, .article-cta-strip, .blog-rate") && CUE.test(p.textContent || "")
  );
  if (!anchor) return;

  // Keep it out of the middle of a boxed section - attach after the box.
  const host = anchor.closest(CARD + ", .faq-box") || anchor;
  host.after(widget);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(tcxPlaceAtsWidget, 0));
} else {
  setTimeout(tcxPlaceAtsWidget, 0);
}

/* Two more raw shapes the markdown leaves behind:
     1. a code block whose lines are "Before: ..." / "After: ..." - the single
        most persuasive comparison in a tailoring post, rendered as grey code
     2. a dash list typed on one line ("The after version: - uses ... - shows
        ...") which markdown collapses into a run-on sentence
   Both are re-presented using structure the author already implied. */
const tcxBeforeAfterBlocks = () => {
  const content = document.querySelector(".post-content");
  if (!content) return;

  /* A bullet list that was fenced as a code block: the highlighter bolds
     random words like "and" and the block scrolls sideways instead of
     wrapping. It is a list, so render it as one. */
  content.querySelectorAll("pre").forEach((pre) => {
    const raw = (pre.textContent || "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (raw.length < 2) return;
    if (!raw.every((l) => /^[-*•]\s+\S/.test(l))) return;
    const ul = document.createElement("ul");
    ul.className = "pre-list";
    raw.forEach((l) => {
      const li = document.createElement("li");
      li.textContent = l.replace(/^[-*•]\s+/, "");
      ul.appendChild(li);
    });
    pre.replaceWith(ul);
  });

  content.querySelectorAll("pre").forEach((pre) => {
    if (pre.closest(".ba-split")) return;
    const lines = (pre.textContent || "").split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return;
    const parsed = lines.map((l) => /^(before|after)\s*:\s*(.+)$/i.exec(l));
    if (parsed.some((m) => !m)) return;
    if (!parsed.some((m) => /before/i.test(m[1])) || !parsed.some((m) => /after/i.test(m[1]))) return;

    const split = document.createElement("div");
    split.className = "ba-split";
    parsed.forEach((m) => {
      const kind = m[1].toLowerCase() === "before" ? "before" : "after";
      const panel = document.createElement("section");
      panel.className = "ba-panel ba-" + kind;
      const label = document.createElement("p");
      label.className = "ba-panel-label";
      label.textContent = kind === "before" ? "Before" : "After";
      const body = document.createElement("p");
      body.className = "ba-panel-text";
      body.textContent = m[2];
      panel.append(label, body);
      split.appendChild(panel);
    });
    pre.replaceWith(split);
  });

  // "Lead-in: - item - item - item" typed on a single markdown line.
  const DASH = /\s[-\u2013\u2014]\s/g;
  Array.from(content.querySelectorAll("p")).forEach((p) => {
    if (p.closest(".ba-split, .row-lines, .lead-list")) return;
    if (p.children.length && p.querySelector("img, br")) return;
    const text = p.textContent || "";
    const parts = text.split(DASH);
    if (parts.length < 4) return;
    if (!/:\s*$/.test(parts[0].trim())) return;
    // Only when the whole paragraph is plain text or links - rebuilding it
    // would otherwise drop nested markup.
    if (Array.from(p.children).some((n) => !/^(A|EM|STRONG|B|CODE)$/.test(n.tagName))) return;

    const wrap = document.createElement("div");
    wrap.className = "dash-list-wrap";
    const lead = document.createElement("p");
    lead.className = "dash-list-lead";
    lead.textContent = parts[0].trim();
    const ul = document.createElement("ul");
    ul.className = "dash-list";
    parts.slice(1).forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t.trim();
      ul.appendChild(li);
    });
    wrap.append(lead, ul);
    p.replaceWith(wrap);
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(tcxBeforeAfterBlocks, 0));
} else {
  setTimeout(tcxBeforeAfterBlocks, 0);
}

/* A Do/Don't pair reads as a comparison, so both columns have to look alike.
   The corpus sometimes writes one side as a bullet list and the other as a
   two-column table, which then overflows inside the narrow column. Flatten
   any table in a Do/Don't column into the same bullet shape as its partner -
   the cells keep their exact text and links. */
const tcxNormalizeDdColumns = () => {
  document.querySelectorAll(".post-content .dd-col table").forEach((table) => {
    const rows = Array.from(table.querySelectorAll("tr")).filter(
      (tr) => !tr.querySelector("th") && tr.children.length >= 2
    );
    if (!rows.length) return;

    const ul = document.createElement("ul");
    rows.forEach((tr) => {
      const cells = Array.from(tr.children);
      const li = document.createElement("li");
      const lead = document.createElement("strong");
      lead.append(...cells[0].childNodes);
      if (!lead.textContent.trim()) return;
      li.appendChild(lead);
      cells.slice(1).forEach((cell, i) => {
        if (!cell.textContent.trim()) return;
        li.appendChild(document.createTextNode(i === 0 ? ": " : " - "));
        li.append(...cell.childNodes);
      });
      ul.appendChild(li);
    });
    if (ul.children.length) table.replaceWith(ul);
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => setTimeout(tcxNormalizeDdColumns, 0));
} else {
  setTimeout(tcxNormalizeDdColumns, 0);
}
