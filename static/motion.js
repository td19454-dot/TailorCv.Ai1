/* ============================================================================
   motion.js — TailorCV shared motion layer. Pairs with motion.css.

   Does three things, all reduced-motion-safe and no-JS-safe:
     1. Scroll reveal  — fade + rise common sections/cards as they enter view.
     2. Count-up       — animate [data-countup] numbers (e.g. "84%", "2x").
     3. Meter fill     — sweep .tc-meter bars from 0 on reveal.

   Progressive enhancement: start states (hidden reveal, zeroed meter, "0"
   counter) are applied HERE, never in CSS — so if this script never runs,
   users just see the finished content. A 2.5s safety net force-finishes
   everything in case the observer misbehaves.

   Exposes window.tcMotionReplay() to re-trigger everything (used by the
   preview page for QA; harmless in production).
   ========================================================================== */
(function () {
  if (window.__tcMotion) return;
  window.__tcMotion = true;

  var reduce = window.matchMedia &&
               window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Elements auto-revealed site-wide. Bespoke hero animations are left alone.
  var REVEAL_SELECTORS = [
    "[data-reveal]",
    ".section-title", ".section-header",
    ".result-card", ".founder-card", ".mock-card", ".career-item",
    ".feature-showcase-item", ".feature-showcase-title",
    ".pricing-preview-card"
  ];

  // Module-level state so tcMotionReplay() can reach the collected elements.
  var state = { revealEls: [], counters: [], meters: [] };

  // ── count-up helpers ──────────────────────────────────────────────────────
  // Parse "1,240+" -> {pre:"", numStr:"1,240", post:"+", val:1240, dec, comma}.
  function parseNum(raw) {
    var m = String(raw).match(/^(\D*)([\d,]*\.?\d+)(.*)$/);
    if (!m) return null;
    return {
      pre: m[1] || "",
      post: m[3] || "",
      val: parseFloat(m[2].replace(/,/g, "")),
      dec: m[2].indexOf(".") > -1 ? 1 : 0,
      comma: m[2].indexOf(",") > -1
    };
  }
  function fmtNum(v, p) {
    var s = p.dec ? v.toFixed(1) : String(Math.round(v));
    if (p.comma) s = Number(s).toLocaleString("en-US");
    return p.pre + s + p.post;
  }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function runCount(el) {
    if (el.__tcCounted) return;
    el.__tcCounted = true;
    var p = el.__tcParsed;
    if (!p) return;
    var dur = 1100, start = null;
    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min((ts - start) / dur, 1);
      el.textContent = fmtNum(p.val * easeOutCubic(t), p);
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = fmtNum(p.val, p);
    }
    requestAnimationFrame(step);
  }

  function fillMeter(meter) {
    var bar = meter.querySelector("i");
    if (bar) bar.style.transform = "scaleX(1)";
  }

  function activate(t) {
    t.classList.add("tc-in");
    if (t.hasAttribute("data-countup")) runCount(t);
    if (t.classList.contains("tc-meter")) fillMeter(t);
  }

  // Re-trigger every animation from its start state (QA / preview helper).
  function replayAll() {
    state.revealEls.forEach(function (el) { el.classList.remove("tc-in"); });
    state.meters.forEach(function (m) {
      var b = m.querySelector("i");
      if (b) b.style.transform = "scaleX(0)";
    });
    state.counters.forEach(function (el) {
      el.__tcCounted = false;
      if (el.__tcParsed) el.textContent = fmtNum(0, el.__tcParsed);
    });
    void document.body.offsetWidth; // force reflow so removals take effect
    requestAnimationFrame(function () {
      state.revealEls.forEach(function (el) { el.classList.add("tc-in"); });
      state.meters.forEach(fillMeter);
      state.counters.forEach(runCount);
    });
  }
  window.tcMotionReplay = replayAll;

  document.addEventListener("DOMContentLoaded", function () {
    state.counters = [].slice.call(document.querySelectorAll("[data-countup]"));
    state.meters = [].slice.call(document.querySelectorAll(".tc-meter"));

    // Set count-up start state ("0"), remembering the final target.
    state.counters.forEach(function (el) {
      var raw = (el.getAttribute("data-countup") || el.textContent || "").trim();
      el.__tcParsed = parseNum(raw);
      if (!reduce && el.__tcParsed) el.textContent = fmtNum(0, el.__tcParsed);
    });

    // Zero the meters (start collapsed).
    if (!reduce) {
      state.meters.forEach(function (m) {
        var bar = m.querySelector("i");
        if (bar) bar.style.transform = "scaleX(0)";
      });
    }

    // Reduced motion or no observer support: finish immediately, no animation.
    if (reduce || !("IntersectionObserver" in window)) {
      state.counters.forEach(function (el) {
        if (el.__tcParsed) el.textContent = fmtNum(el.__tcParsed.val, el.__tcParsed);
      });
      return;
    }

    // Collect + arm reveal elements.
    document.querySelectorAll(REVEAL_SELECTORS.join(",")).forEach(function (el) {
      if (el.closest(".hero")) return;               // hero has its own motion
      if (el.classList.contains("tc-reveal")) return; // don't double-arm
      el.classList.add("tc-reveal");
      state.revealEls.push(el);
    });

    // Gentle stagger for siblings sharing a row.
    state.revealEls.forEach(function (el) {
      if (!el.parentElement) return;
      var sibs = [].filter.call(el.parentElement.children, function (c) {
        return c.classList && c.classList.contains("tc-reveal");
      });
      var idx = sibs.indexOf(el);
      if (idx > 0) el.style.transitionDelay = (idx * 0.08) + "s";
    });

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { activate(e.target); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

    state.revealEls.forEach(function (el) { io.observe(el); });
    state.counters.forEach(function (el) { io.observe(el); });
    state.meters.forEach(function (m) { io.observe(m); });

    // Safety net: never leave anything stuck in its start state.
    setTimeout(function () {
      state.revealEls.forEach(function (el) { el.classList.add("tc-in"); });
      state.counters.forEach(runCount);
      state.meters.forEach(fillMeter);
    }, 2500);
  });
})();
