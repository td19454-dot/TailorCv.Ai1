/* "See what changed" — the tailored resume with every edit marked inline, plus
   the list of changes beside it.

   Shared by the optimized editor (static/optimized_editor.js) and the Chrome
   extension, whose build copies this file in (chrome-extension/package.json
   "build"). One implementation, so the two never show different diffs.

   Usage: window.TCVChangesModal.open(payload, html, { onClose })
     payload  the editor payload: { resume_data: { changes, summary, skills,
              experience, projects, ... }, skill_match_before, skill_match_after }
     html     the rendered resume HTML shown in the right-hand pane
     onClose  optional; called after the modal is dismissed
     applyLabel optional; text for the main button (default "Apply All and Continue")
*/
(function () {
    "use strict";

    let modalHtml = "";
    let modalOnClose = null;

    /* ─────────────────────────────────────────────────────────────────────────
       "SEE WHAT CHANGED" MODAL
    ───────────────────────────────────────────────────────────────────────── */
    /* Word-level LCS diff, split on whitespace so word tokens and the spaces
       between them are both diffed (keeps reconstructed spacing exact). Bullets
       are short (a sentence or two) so an O(n*m) DP table is fine. */
    function wordDiff(before, after) {
        const a = String(before || "").split(/(\s+)/).filter(Boolean);
        const b = String(after  || "").split(/(\s+)/).filter(Boolean);
        const n = a.length, m = b.length;
        const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const beforeParts = [], afterParts = [];
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (a[i] === b[j]) {
                beforeParts.push({ text: a[i], same: true });
                afterParts.push({ text: b[j], same: true });
                i++; j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                beforeParts.push({ text: a[i], same: false });
                i++;
            } else {
                afterParts.push({ text: b[j], same: false });
                j++;
            }
        }
        while (i < n) { beforeParts.push({ text: a[i], same: false }); i++; }
        while (j < m) { afterParts.push({ text: b[j], same: false }); j++; }
        return { beforeParts, afterParts };
    }

    /* Builds diffed text as DOM nodes — every word is placed via textContent,
       never interpolated into innerHTML, so resume/JD text can never be parsed
       as markup (same rule showSkillPanel follows in the extension). */
    function renderDiffLine(parts, changedClass) {
        const frag = document.createDocumentFragment();
        parts.forEach(p => {
            if (p.same) {
                frag.appendChild(document.createTextNode(p.text));
            } else {
                const span = document.createElement("span");
                span.className = changedClass;
                span.textContent = p.text;
                frag.appendChild(span);
            }
        });
        return frag;
    }

    function injectChangesModalStyles() {
        if (document.getElementById("tc-chg-styles")) return;
        const st = document.createElement("style");
        st.id = "tc-chg-styles";
        st.textContent = `
#tc-chg-overlay {
    position: fixed; inset: 0; z-index: 2147483000;
    display: flex; align-items: center; justify-content: center; padding: 20px;
}
/* Third-party support widgets mount themselves fixed in the bottom-right at a
   very high z-index, landing squarely on "Apply All and Continue". They are
   injected at runtime under names we do not control, so hide by POSITION while
   the modal is open rather than by chasing each vendor's class name. */
body.tc-chg-open iframe[src*="chat"],
body.tc-chg-open iframe[title*="hat"],
body.tc-chg-open iframe[id*="chat"],
body.tc-chg-open [class*="chat-widget"],
body.tc-chg-open [class*="chat-bubble"],
body.tc-chg-open [id*="chat-widget"],
body.tc-chg-open [id*="launcher"],
body.tc-chg-open .tcx-help-fab,
body.tc-chg-open #tcx-chat,
body.tc-chg-open #tawkchat-container,
body.tc-chg-open .crisp-client,
body.tc-chg-open #intercom-container { display: none !important; }
.tc-chg-backdrop {
    position: absolute; inset: 0; background: rgba(15,23,42,.45);
    animation: tc-chg-bgin .25s ease both;
}
@keyframes tc-chg-bgin { from { opacity: 0 } to { opacity: 1 } }
.tc-chg-modal {
    position: relative; z-index: 2; display: flex; flex-direction: column;
    background: #fff; border-radius: 12px; overflow: hidden;
    width: min(1400px, 96vw); height: min(900px, 94vh);
    box-shadow: 0 24px 64px rgba(15,23,42,.28);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
    animation: tc-chg-in .28s cubic-bezier(.34,1.3,.64,1) both;
}
@keyframes tc-chg-in {
    from { opacity: 0; transform: scale(.97) translateY(12px) }
    to   { opacity: 1; transform: none }
}
.tc-chg-panes { flex: 1; display: grid; grid-template-columns: 40% 60%; min-height: 0; }
.tc-chg-rail {
    min-height: 0; overflow-y: auto; padding: 32px;
    border-right: 1px solid #e5e7eb;
}
.tc-chg-close {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; padding: 0;
    background: none; border: 0; border-radius: 6px; cursor: pointer;
    color: #6b7280; font-size: 1.35rem; line-height: 1;
    transition: background .15s ease, color .15s ease;
}
.tc-chg-close:hover { background: #f3f4f6; color: #111827; }
/* ── A. Hero heading ── */
.tc-chg-hero {
    margin: 0 0 28px; font-size: 40px; line-height: 1.15;
    font-weight: 700; color: #0f172a; letter-spacing: -.02em;
}
/* ── B/C. Score rows ── */
.tc-chg-scorerow { display: flex; align-items: flex-start; gap: 24px; padding: 4px 0 22px; }
.tc-chg-scorerow + .tc-chg-scorerow { border-top: 1px solid #e5e7eb; padding-top: 22px; }
.tc-chg-ring-wrap { flex: 0 0 auto; width: 100px; text-align: center; }
.tc-chg-ring { position: relative; width: 100px; height: 100px; }
.tc-chg-ring svg { width: 100px; height: 100px; transform: rotate(-90deg); }
.tc-chg-ring-track { fill: none; stroke: #e8eaed; stroke-width: 8; }
.tc-chg-ring-fill  { fill: none; stroke: #16a34a; stroke-width: 8; stroke-linecap: round; }
.tc-chg-ring-num {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 1.3rem; font-weight: 600; color: #0f172a;
}
.tc-chg-improved {
    display: flex; align-items: flex-start; justify-content: center; gap: 4px;
    margin-top: 8px; color: #16a34a; font-size: .78rem; line-height: 1.3; text-align: left;
}
.tc-chg-improved svg { width: 13px; height: 13px; flex: 0 0 auto; margin-top: 1px; }
.tc-chg-scoretext { flex: 1; min-width: 0; padding-top: 6px; }
.tc-chg-scoretitle { font-size: 28px; font-weight: 400; color: #0f172a; margin: 0 0 8px; letter-spacing: -.01em; }
.tc-chg-scoredesc { font-size: .92rem; line-height: 1.55; color: #6b7280; margin: 0; }
/* ── D/E/F. Keyword cards ── */
.tc-chg-kwcard {
    border: 1px solid #e5e7eb; border-radius: 8px; background: #f8fafc;
    margin-top: 14px; overflow: hidden;
}
.tc-chg-kwcard.added { background: #f0fdf4; border-color: #bbf7d0; }
.tc-chg-kwhead {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 13px 15px; background: none; border: 0; cursor: pointer;
    font-family: inherit; text-align: left;
}
.tc-chg-kwtitle { flex: 1; font-size: .94rem; font-weight: 500; color: #111827; }
.tc-chg-kwcard.added .tc-chg-kwtitle { font-size: 1.05rem; }
.tc-chg-help {
    display: inline-flex; align-items: center; justify-content: center;
    width: 15px; height: 15px; border: 1px solid #9ca3af; border-radius: 50%;
    color: #6b7280; font-size: .6rem; flex: 0 0 auto;
}
.tc-chg-kwbody { padding: 0 15px 14px; display: flex; flex-wrap: wrap; gap: 7px; }
.tc-chg-chip {
    display: inline-flex; align-items: center; padding: 5px 11px;
    border-radius: 999px; font-size: .8rem; line-height: 1.2;
    background: #dcfce7; color: #14532d;
}
.tc-chg-chip.miss { background: #fee2e2; color: #7f1d1d; }
.tc-chg-ico { flex: 0 0 auto; width: 17px; height: 17px; }
/* Chevron: up = open, down = closed. */
.tc-chg-chev {
    flex: 0 0 auto; width: 9px; height: 9px; margin-left: 2px;
    border-right: 2px solid #6b7280; border-bottom: 2px solid #6b7280;
    transform: rotate(-135deg); transition: transform .2s ease;
}
[aria-expanded="false"] > .tc-chg-chev { transform: rotate(45deg); }
/* ── G. Nested change cards ── */
.tc-chg-sec {
    border: 1px solid #e5e7eb; border-radius: 8px; background: #fff;
    margin-top: 14px; overflow: hidden;
}
.tc-chg-sechead {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 15px 16px; background: none; border: 0; cursor: pointer;
    font-family: inherit; text-align: left;
}
.tc-chg-sectitle { flex: 1; font-size: 1.02rem; font-weight: 500; color: #111827; }
/* Level 1 chevron sits in a small square button, per the reference. */
.tc-chg-chevbox {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; flex: 0 0 auto;
    border: 1px solid #bfdbfe; border-radius: 6px; background: #eff6ff;
}
.tc-chg-chevbox .tc-chg-chev { border-color: #2563eb; margin: 0; }
.tc-chg-secbody { padding: 0 16px 14px; }
.tc-chg-entry { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; margin-top: 10px; overflow: hidden; }
.tc-chg-entryhead {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 13px 14px; background: none; border: 0; cursor: pointer;
    font-family: inherit; text-align: left;
}
.tc-chg-entrytitle { flex: 1; font-size: .95rem; font-weight: 500; color: #111827; }
.tc-chg-entrybody { padding: 0 14px 12px; }
.tc-chg-item { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; margin-top: 10px; overflow: hidden; }
.tc-chg-itemhead {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 12px 14px; background: none; border: 0; cursor: pointer;
    font-family: inherit; text-align: left;
}
.tc-chg-itemnum { flex: 1; font-size: .92rem; font-weight: 500; color: #111827; }
.tc-chg-provenance {
    margin-top: 10px; font-size: .78rem; line-height: 1.5; color: #6b7280;
}
.tc-chg-newtag {
    flex: 0 0 auto; padding: 2px 8px; border-radius: 999px;
    background: #dcfce7; color: #14532d; font-size: .7rem; font-weight: 600;
}
.tc-chg-itembody { padding: 0 14px 14px; }
.tc-chg-itembody-inner { border-top: 1px solid #e5e7eb; padding-top: 13px; }
.tc-chg-afterlabel { font-size: .95rem; font-weight: 500; color: #111827; margin-bottom: 7px; }
.tc-chg-aftertext { font-size: .88rem; line-height: 1.65; color: #4b5563; }
.tc-chg-compare-link {
    display: inline-block; margin-top: 12px; padding: 0;
    background: none; border: 0; cursor: pointer; font-family: inherit;
    font-size: .88rem; color: #2563eb;
}
.tc-chg-compare-link:hover { text-decoration: underline; }
.tc-chg-ba { margin-top: 12px; font-size: .86rem; line-height: 1.6; }
.tc-chg-ba-label {
    font-size: .72rem; font-weight: 600; text-transform: uppercase;
    letter-spacing: .05em; color: #9ca3af; margin-bottom: 3px;
}
.tc-chg-ba-before { color: #6b7280; margin-bottom: 9px; }
.tc-chg-ba-after { color: #111827; }
.tc-chg-empty { font-size: .9rem; color: #6b7280; padding: 16px 0; line-height: 1.6; }
/* ── Right pane: document viewer ──
   Header holds the X on its own row, canvas is the ONLY scroller, and the
   page floats on grey with space above, left and right. Previously the page
   sat flush against the top and right edges with two nested scrollbars. */
.tc-chg-preview {
    position: relative;
    display: flex; flex-direction: column; height: 100%; min-height: 0;
    background: #F1F3F6;
}
/* The header overlays rather than occupying a row - as a flex child it pushed
   the page down and stacked its own padding on top of the canvas padding. */
.tc-chg-preview-header {
    position: absolute; top: 8px; right: 12px; z-index: 5;
    display: flex; justify-content: flex-end;
}
.tc-chg-preview-canvas {
    flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 24px 24px 32px;
}
/* Inner padding so the document reads as a printed page. Without it the
   resume text ran flush to both edges of the white sheet and looked cropped. */
.tc-chg-page {
    width: 100%; max-width: 794px; margin: 0 auto; background: #fff;
    box-shadow: 0 2px 12px rgba(0,0,0,.08); overflow: visible;
    padding: 40px 56px 48px; box-sizing: border-box;
}
/* Height is set from the mirrored document's own scrollHeight on load - a
   fixed A4 ratio cropped every resume that ran past one page. */
.tc-chg-mirror { display: block; width: 100%; min-height: 700px; border: 0; background: #fff; }
/* ── Sticky footer ── */
.tc-chg-footer {
    flex: 0 0 auto; display: flex; align-items: center;
    padding: 14px 24px; background: #fff; border-top: 1px solid #e5e7eb;
}
.tc-chg-sugg { margin-left: 40%; display: flex; align-items: center; gap: 8px; font-size: .9rem; color: #6b7280; }
.tc-chg-suggnum {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 24px; height: 22px; padding: 0 7px; border-radius: 999px;
    background: #dbeafe; color: #1d4ed8; font-size: .8rem; font-weight: 500;
}
.tc-chg-apply {
    margin-left: auto; padding: 10px 20px; border: 0; border-radius: 6px;
    background: #2563eb; color: #fff; cursor: pointer;
    font-family: inherit; font-size: .9rem; font-weight: 500;
    transition: background .15s ease;
}
.tc-chg-apply:hover { background: #1d4ed8; }
@media (max-width: 1024px) {
    .tc-chg-panes { grid-template-columns: 1fr; }
    .tc-chg-preview { display: none; }
    .tc-chg-rail { border-right: 0; padding: 24px 18px; }
    .tc-chg-hero { font-size: 28px; }
    .tc-chg-scoretitle { font-size: 21px; }
    .tc-chg-sugg { margin-left: 0; }
}
`;
        document.head.appendChild(st);
    }

    /* Merge change islands separated by only a word or two of survivor.

       Word-level LCS treats every shared token as a match, so a rewritten
       sentence keeps incidental words - "and", "to", "data" - and the diff
       fragments into eight separate red/green flickers across one bullet. The
       reader cannot see what was actually replaced.

       A short bridge between two changes is noise: absorb it into the change so
       the bullet shows a few clean chunks instead. Longer runs of unchanged
       text are real and stay untouched. */
    function coalesceDiff(beforeParts, afterParts, bridgeWords) {
        const LIMIT = bridgeWords == null ? 2 : bridgeWords;
        const runLen = (parts, i) => {
            let n = 0, k = i;
            while (k < parts.length && parts[k].same) {
                if (parts[k].text.trim()) n++;
                k++;
            }
            return { words: n, end: k };
        };
        const merge = parts => {
            const out = parts.map(p => ({ ...p }));
            let i = 0, seenChange = false;
            while (i < out.length) {
                if (!out[i].same) { seenChange = true; i++; continue; }
                const { words, end } = runLen(out, i);
                if (seenChange && end < out.length && words > 0 && words <= LIMIT) {
                    for (let k = i; k < end; k++) out[k].same = false;
                }
                i = end;
            }
            return out;
        };
        return { beforeParts: merge(beforeParts), afterParts: merge(afterParts) };
    }

    /* Draw the diff onto the mirrored resume itself.
       The rail says WHAT changed; without this the resume beside it is a clean
       copy and the reader has to find every edit by eye. Each changed bullet is
       located by its rewritten text and re-rendered with removed words struck
       through in red and added ones in green, using the same wordDiff the rail
       uses so the panes can never disagree.
       Returns "entry:bullet" -> element so a card can scroll to its change. */
    /* Text-identity index over the ORIGINAL resume.

       The server decides "new" by looking up an entry in the original document
       by a single identifier field, so a section the template renamed, or an
       entry whose role/company pair is written differently, fails the lookup
       and every bullet under it is reported as new. That is how four unchanged
       Leadership bullets came back fully green.

       Green has to mean "this text is not in the original", so the final say
       belongs to the text itself rather than to any name or id. */
    function buildOriginalIndex(originalText) {
        const exact = new Set();
        const lines = [];
        String(originalText || "").split(/\r?\n+/).forEach(raw => {
            const line = normaliseForCompare(raw);
            if (line.length < 12) return;       // headings, dates, stray tokens
            exact.add(line);
            lines.push(line);
        });
        return { exact, lines };
    }

    /* Lowercase, collapse whitespace, strip bullet glyphs and trailing
       punctuation, and flatten quote/dash variants - a template that swaps a
       hyphen for an en dash has not changed the candidate's words. */
    function normaliseForCompare(s) {
        return String(s || "")
            .replace(/[‘’‛]/g, "'")
            .replace(/[“”]/g, '"')
            .replace(/[‐-―−]/g, "-")
            .replace(/^[\s•·\-\*●▪]+/, "")
            .toLowerCase()
            .replace(/\s+/g, " ")
            .replace(/[.,;:!?]+$/, "")
            .trim();
    }

    function wordOverlap(a, b) {
        const A = new Set(normaliseForCompare(a).split(" ").filter(w => w.length > 2));
        const B = new Set(normaliseForCompare(b).split(" ").filter(w => w.length > 2));
        if (!A.size || !B.size) return 0;
        let hit = 0;
        A.forEach(w => { if (B.has(w)) hit++; });
        return hit / Math.max(A.size, B.size);
    }

    /* Re-decide a bullet's status against the original text.
       Returns null when the text is unchanged, so the caller can skip it
       entirely - no highlight, no change card, no suggestion counted. */
    function reconcileStatus(b, idx) {
        if (!idx || !b || !b.after) return b;
        const after = normaliseForCompare(b.after);
        if (!after) return b;

        // Present verbatim somewhere in the original: unchanged, whatever the
        // server called it and whichever section it now sits under.
        if (idx.exact.has(after)) return null;

        if (b.status === "reworded" && b.before) {
            return normaliseForCompare(b.before) === after ? null : b;
        }

        // Reported as new. Look for the original line it most resembles.
        let best = null, bestScore = 0;
        for (const line of idx.lines) {
            const score = wordOverlap(after, line);
            if (score > bestScore) { bestScore = score; best = line; }
        }
        if (bestScore >= 0.92) return null;                       // same words
        if (bestScore >= 0.5) return { ...b, status: "reworded", before: best };
        return b;                                                  // genuinely new
    }

    function markChangesInPreview(doc, entries, extras) {
        const index = new Map();
        if (!doc) return index;
        entries = Array.isArray(entries) ? entries : [];
        const origIdx = (extras && extras.originalIndex) || null;

        const norm = t => String(t || "").replace(/\s+/g, " ").trim();
        // Leaf blocks only: re-rendering a container would destroy its children.
        const blocks = Array.from(doc.querySelectorAll("li, p, div, td"))
            .filter(el => !el.querySelector("li, p, div, td"));

        // The summary and the skills lines are changed just as often as the
        // bullets, and the left panel reports them - but they live outside
        // `entries`, so they were rendering as plain text while every bullet
        // around them was highlighted. Treat them as ordinary change records.
        const synthetic = [];
        if (extras && extras.summary && extras.summary.status
            && extras.summary.status !== "unchanged" && extras.summary.after) {
            synthetic.push({ bullets: [{
                status: extras.summary.status,
                before: extras.summary.before,
                after:  extras.summary.after,
            }]});
        }
        if (extras && Array.isArray(extras.skillLines)) {
            extras.skillLines.forEach(line => synthetic.push({ bullets: [line] }));
        }
        const allEntries = entries.concat(synthetic);

        allEntries.forEach((entry, ei) => {
            (entry.bullets || []).forEach((change, bi) => {
                const b = reconcileStatus(change, origIdx);
                if (!b || b.status === "unchanged" || !b.after) return;
                const target = norm(b.after);
                if (!target) return;

                const el = blocks.find(x => !x.dataset.tcvMarked && norm(x.textContent) === target)
                        || blocks.find(x => !x.dataset.tcvMarked && norm(x.textContent).includes(target));
                if (!el) return;
                el.dataset.tcvMarked = "1";

                const key = ei + ":" + bi;
                el.setAttribute("data-tcv-change", key);
                index.set(key, el);

                // A skills line is a list, so diff it item by item: wrap only
                // the skill names that are new and leave the commas plain. A
                // word diff here marks punctuation and splits "Node.js".
                if (b._addedSkills && b._addedSkills.length) {
                    const addedKeys = new Set(b._addedSkills.map(skillKey));
                    el.textContent = "";
                    b.after.split(",").forEach((item, n) => {
                        const text = item.trim();
                        if (n) el.appendChild(doc.createTextNode(", "));
                        if (text && addedKeys.has(skillKey(text))) {
                            const tag = doc.createElement("ins");
                            tag.className = "tcv-mark-add";
                            tag.textContent = text;
                            el.appendChild(tag);
                        } else {
                            el.appendChild(doc.createTextNode(text));
                        }
                    });
                    el.style.textAlign = "left";
                    return;
                }

                // A new bullet has no "before" - the whole line reads as added.
                if (b.status !== "reworded" || !b.before) {
                    const t = el.textContent;
                    el.textContent = "";
                    const tag = doc.createElement("ins");
                    tag.className = "tcv-mark-add";
                    tag.textContent = t;
                    el.appendChild(tag);
                    el.style.textAlign = "left";
                    return;
                }

                const diff = wordDiff(b.before, b.after);
                const { beforeParts, afterParts } = coalesceDiff(diff.beforeParts, diff.afterParts);
                el.textContent = "";

                // Build ONE run per contiguous stretch of the same type, then
                // emit one element for it. Emitting a span per token put every
                // whitespace token inside its own coloured box, so the text
                // rendered as "potential - data - imbalances" with each word
                // boxed separately and the gaps stretched by justification.
                const runs = [];
                const pushRun = (kind, text) => {
                    if (!text) return;
                    const last = runs[runs.length - 1];
                    if (last && last.kind === kind) last.text += text;
                    else runs.push({ kind, text });
                };

                let bi2 = 0, ai = 0;
                while (bi2 < beforeParts.length || ai < afterParts.length) {
                    while (bi2 < beforeParts.length && !beforeParts[bi2].same) {
                        pushRun("del", beforeParts[bi2].text); bi2++;
                    }
                    while (ai < afterParts.length && !afterParts[ai].same) {
                        pushRun("add", afterParts[ai].text); ai++;
                    }
                    if (bi2 < beforeParts.length && ai < afterParts.length) {
                        pushRun("same", afterParts[ai].text); bi2++; ai++;
                    } else {
                        while (ai < afterParts.length) {
                            pushRun(afterParts[ai].same ? "same" : "add", afterParts[ai].text); ai++;
                        }
                        while (bi2 < beforeParts.length) {
                            if (!beforeParts[bi2].same) pushRun("del", beforeParts[bi2].text);
                            bi2++;
                        }
                    }
                }

                // Trim each highlighted run so the pink/green box hugs the
                // words and the surrounding spaces stay plain text.
                runs.forEach(r => {
                    if (r.kind === "same") { el.appendChild(doc.createTextNode(r.text)); return; }
                    const lead = r.text.match(/^\s*/)[0];
                    const tail = r.text.match(/\s*$/)[0];
                    const core = r.text.slice(lead.length, r.text.length - tail.length);
                    if (lead) el.appendChild(doc.createTextNode(lead));
                    if (core) {
                        const tag = doc.createElement(r.kind === "del" ? "del" : "ins");
                        tag.className = r.kind === "del" ? "tcv-mark-del" : "tcv-mark-add";
                        tag.textContent = core;
                        el.appendChild(tag);
                    }
                    if (tail) el.appendChild(doc.createTextNode(tail));
                });

                // Justified text stretches the spaces around the highlights
                // into visible gaps - force left alignment on marked bullets.
                el.style.textAlign = "left";
            });
        });
        return index;
    }

    /* Scores come from the ATS analysis the user already ran - reading its
       stored payload rather than re-scoring, because two runs on the same input
       disagree and the editor would contradict the score page. */
    /* Canonical form for comparing a skill written two ways.
       "Node.js", "nodejs" and "Node JS" are one skill; so are "CI/CD" and
       "CICD", "Postgres" and "PostgreSQL". Without this the missing-keywords
       list reported skills that were sitting in the resume in a different
       spelling. */
    const SKILL_ALIASES = {
        nodejs: "node", node: "node", nodejs2: "node",
        postgres: "postgresql", postgre: "postgresql", postgressql: "postgresql",
        cicd: "cicd", continuousintegration: "cicd",
        googlecloudplatform: "gcp", gcp: "gcp",
        amazonwebservices: "aws", aws: "aws",
        k8s: "kubernetes", kubernetes: "kubernetes",
        js: "javascript", javascript: "javascript",
        ts: "typescript", typescript: "typescript",
        golang: "go", go: "go",
        githubactions: "githubactions",
        restapis: "rest", restapi: "rest", rest: "rest",
        ms: "microsoft", googleanalytics4: "ga4", ga4: "ga4",
    };
    function skillKey(s) {
        const k = String(s || "").toLowerCase().replace(/[^a-z0-9+#]/g, "");
        return SKILL_ALIASES[k] || k;
    }

    /* Which of the JD's skills the FINAL resume actually contains.
       The stored ATS analysis scored the ORIGINAL document, so its "missing"
       list still names everything the optimiser has since added - which is why
       the panel listed Java, Go, Docker and Kubernetes as missing while they
       sat in the rendered Technical Skills line. Re-checking against the full
       text of the new resume is a string comparison, not a second opinion, so
       it cannot contradict the score the way a re-scan would. */
    function partitionKeywords(candidates, resumeText, addedList) {
        const haystack = new Set();
        String(resumeText || "")
            .split(/[^A-Za-z0-9+#.]+/)
            .forEach(tok => { if (tok) haystack.add(skillKey(tok)); });
        // Multi-word skills never survive tokenising, so also keep a
        // whitespace-stripped blob to test them against.
        const blob = String(resumeText || "").toLowerCase().replace(/[^a-z0-9+#]/g, "");
        const addedKeys = new Set((addedList || []).map(skillKey));

        const present = [], missing = [], added = [];
        (candidates || []).forEach(c => {
            const key = skillKey(c);
            if (!key) return;
            const found = haystack.has(key) || (key.length >= 3 && blob.includes(key));
            if (addedKeys.has(key)) added.push(c);
            else if (found) present.push(c);
            else missing.push(c);
        });
        return { present, missing, added };
    }

    /* The ATS analysis the user already ran, wherever it was stored.
       main_new.js writes "atsAnalysisPayload" on every scan and mirrors it to
       localStorage for guests; ats_analysis.js reads the same key. Checking
       both storages for each name matters because a guest's session copy is
       cleared while the local one survives. Re-scoring here instead would
       produce a second opinion that contradicts the score page. */
    function readAtsPayload() {
        const keys = [
            "atsAnalysisPayload",
            "tailorcv_ats_payload_guest",
            "tailorcv_ats_payload_local",
        ];
        for (const k of keys) {
            for (const store of [sessionStorage, localStorage]) {
                try {
                    const raw = store.getItem(k);
                    if (!raw) continue;
                    const d = JSON.parse(raw);
                    if (d && typeof d === "object") return d;
                } catch (e) {}
            }
        }
        return null;
    }

    function showChangesModal(payload) {
        if (document.getElementById("tc-chg-overlay")) return;
        injectChangesModalStyles();

        const changes = (payload && payload.resume_data && payload.resume_data.changes) || {};
        const skillsAdded = Array.isArray(changes.skills_added) ? changes.skills_added : [];
        const skillGaps   = Array.isArray(changes.skill_gaps)   ? changes.skill_gaps   : [];
        const entries     = Array.isArray(changes.entries)      ? changes.entries      : [];
        const summary     = changes.summary || null;

        const ats  = readAtsPayload() || {};
        const skillsBlock = ats.skills || (ats.data && ats.data.skills)
            || (ats.result && ats.result.skills) || {};
        const hard = skillsBlock.hard_skills || {};
        const rawMatched = Array.isArray(hard.matched) ? hard.matched : [];
        const rawMissing = Array.isArray(hard.missing) ? hard.missing : [];

        // Re-partition every JD skill against the FINAL resume text. The stored
        // analysis judged the original document, so its lists are stale the
        // moment the optimiser adds a skill.
        const finalText = [
            String((payload && payload.resume_data && payload.resume_data.summary) || ""),
            ((payload && payload.resume_data && payload.resume_data.skills) || []).join(" "),
            String(modalHtml || "").replace(/<[^>]*>/g, " "),
        ].join(" ");
        const part = partitionKeywords(
            rawMatched.concat(rawMissing), finalText, skillsAdded);
        const matchedKw = part.present;
        const missingKw = part.missing;

        const clampPct = v => Math.round(Math.max(0, Math.min(100, Number(v || 0))));
        // The score the user's own analysis produced. match_rate is what the ATS
        // page renders, so the editor cannot contradict the number they saw.
        // Several shapes reach this page depending on the route taken, so take
        // the first that carries a real number rather than assuming one.
        const firstNum = (...vals) => {
            for (const v of vals) {
                const n = Number(v);
                if (v != null && Number.isFinite(n) && n > 0) return n;
            }
            return 0;
        };
        const atsScore = clampPct(firstNum(
            ats.match_rate,
            ats.ats_score,
            ats.score,
            ats.data && ats.data.match_rate,
            ats.result && ats.result.match_rate,
            payload && payload.match_rate,
            payload && payload.ats_score,
            payload && payload.resume_data && payload.resume_data.ats_score
        ));

        // "Improved by" needs a genuine before-score. The extension flow stores
        // one (skill_match_before/after); the web flow has never had one, and
        // inventing a delta would tell the user their resume improved by a
        // number nobody measured. Absent or non-positive -> the line is hidden.
        const beforeScore =
            payload && payload.skill_match_before != null ? Number(payload.skill_match_before)
          : ats.skill_match_before != null ? Number(ats.skill_match_before)
          : ats.previous_score != null ? Number(ats.previous_score)
          : null;
        const afterScore =
            payload && payload.skill_match_after != null ? Number(payload.skill_match_after)
          : null;
        let improvedBy = null;
        if (beforeScore != null && Number.isFinite(beforeScore)) {
            const resolvedAfter =
                afterScore != null && Number.isFinite(afterScore) ? afterScore : atsScore;
            const delta = Math.round(resolvedAfter - beforeScore);
            if (delta > 0) improvedBy = delta;
        }

        // Built from the candidate's own text so every "new" claim can be
        // checked against it. Without this, a renamed section made untouched
        // bullets render fully green and inflated the suggestion count.
        const origIdx = buildOriginalIndex(
            (Array.isArray(changes.original_lines) ? changes.original_lines : []).join("\n"));

        // Reconcile once, here, so the preview, the change cards and the count
        // all describe the same set of changes.
        entries.forEach(e => {
            e.bullets = (e.bullets || [])
                .map(b => reconcileStatus(b, origIdx))
                .filter(Boolean);
        });

        const changedBullets = entries.reduce(
            (n, e) => n + (e.bullets || []).filter(b => b.status !== "unchanged").length, 0);
        const summaryChange = summary && summary.status && summary.status !== "unchanged"
            ? reconcileStatus(summary, origIdx) : null;
        const suggestionCount = changedBullets + skillsAdded.length +
            (summaryChange ? 1 : 0);

        const ICON = {
            trend:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>',
            check:   '<svg class="tc-chg-ico" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 12 6 17 15 8"/><polyline points="9 12 14 17 23 8"/></svg>',
            warn:    '<svg class="tc-chg-ico" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20L12 3z"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        };

        const overlay = document.createElement("div");
        overlay.id = "tc-chg-overlay";
        overlay.innerHTML = `
            <div class="tc-chg-backdrop"></div>
            <div class="tc-chg-modal" role="dialog" aria-modal="true" aria-labelledby="tc-chg-title">
                <div class="tc-chg-panes">
                    <div class="tc-chg-rail">
                        <h2 class="tc-chg-hero" id="tc-chg-title">Your new ATS-friendly resume is ready!</h2>
                        <div class="tc-chg-scores"></div>
                        <div class="tc-chg-body"></div>
                        <div class="tc-chg-keywords"></div>
                    </div>
                    <div class="tc-chg-preview">
                        <div class="tc-chg-preview-header">
                            <button type="button" class="tc-chg-close" aria-label="Close">&times;</button>
                        </div>
                        <div class="tc-chg-preview-canvas">
                            <div class="tc-chg-page"></div>
                        </div>
                    </div>
                </div>
                <div class="tc-chg-footer">
                    <span class="tc-chg-sugg">Suggestions
                        <span class="tc-chg-suggnum">${suggestionCount}</span></span>
                    <button type="button" class="tc-chg-apply">Apply All and Continue</button>
                </div>
            </div>`;

        const rail     = overlay.querySelector(".tc-chg-rail");
        const scoresEl = overlay.querySelector(".tc-chg-scores");
        const kwEl     = overlay.querySelector(".tc-chg-keywords");
        const body     = overlay.querySelector(".tc-chg-body");
        let markIndex  = new Map();

        /* ── Resume Analysis Results: one ring, driven by the real score ── */
        function ringColor(pct) {
            if (pct >= 75) return "#16a34a";   // green  - strong
            if (pct >= 50) return "#f59e0b";   // orange - middling
            return "#dc2626";                   // red    - weak
        }

        function addScoreRow(pct, improved, title, desc) {
            const C = 2 * Math.PI * 44;
            const row = document.createElement("div");
            row.className = "tc-chg-scorerow";
            row.innerHTML = `
                <div class="tc-chg-ring-wrap">
                    <div class="tc-chg-ring">
                        <svg viewBox="0 0 100 100">
                            <circle class="tc-chg-ring-track" cx="50" cy="50" r="44"/>
                            <circle class="tc-chg-ring-fill" cx="50" cy="50" r="44"
                                stroke="${ringColor(pct)}"
                                stroke-dasharray="${C}" stroke-dashoffset="${C}"/>
                        </svg>
                        <div class="tc-chg-ring-num">0%</div>
                    </div>
                    ${improved != null ? `<div class="tc-chg-improved" style="color:${ringColor(pct)}">${ICON.trend}
                        <span>Improved<br>by ${improved}%</span></div>` : ""}
                </div>
                <div class="tc-chg-scoretext">
                    <div class="tc-chg-scoretitle"></div>
                    <p class="tc-chg-scoredesc"></p>
                </div>`;
            row.querySelector(".tc-chg-scoretitle").textContent = title;
            row.querySelector(".tc-chg-scoredesc").textContent = desc;
            scoresEl.appendChild(row);

            // Fill the ring and count the number up to the real value.
            const fill = row.querySelector(".tc-chg-ring-fill");
            const num  = row.querySelector(".tc-chg-ring-num");
            const reduce = window.matchMedia
                && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (reduce) {
                fill.style.strokeDashoffset = String(C - (pct / 100) * C);
                num.textContent = pct + "%";
                return;
            }
            requestAnimationFrame(() => {
                fill.style.transition = "stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)";
                fill.style.strokeDashoffset = String(C - (pct / 100) * C);
            });
            const t0 = performance.now(), DUR = 1000;
            (function step(now) {
                const k = Math.min(1, (now - t0) / DUR);
                num.textContent = Math.round(pct * (1 - Math.pow(1 - k, 3))) + "%";
                if (k < 1) requestAnimationFrame(step);
            })(t0);
        }

        // The section renders whenever a score exists. When the user reached the
        // editor without running an analysis there is genuinely nothing to show,
        // and inventing a number would be worse than omitting the block.
        if (atsScore > 0) {
            addScoreRow(atsScore, improvedBy, "Resume Analysis Results",
                "We also analyzed your resume's content, based on the industry best practices for your role and experience level.");
        } else {
            // Says WHY the block is absent, so a missing score is diagnosable
            // from the console instead of looking like broken rendering.
            console.info(
                "[TailorCV] Resume Analysis Results hidden: no ATS score found.",
                { atsPayloadFound: !!readAtsPayload(), keysChecked:
                    ["atsAnalysisPayload", "tailorcv_ats_payload_guest", "tailorcv_ats_payload_local"] }
            );
        }

        /* ── D/E/F. Keyword cards ── */
        function addKeywordCard(icon, title, chips, chipClass, extraClass) {
            if (!chips.length) return;
            const card = document.createElement("div");
            card.className = "tc-chg-kwcard" + (extraClass ? " " + extraClass : "");
            const head = document.createElement("button");
            head.type = "button";
            head.className = "tc-chg-kwhead";
            head.setAttribute("aria-expanded", "true");
            head.innerHTML = `${icon}<span class="tc-chg-kwtitle"></span>
                <span class="tc-chg-help">?</span><span class="tc-chg-chev"></span>`;
            head.querySelector(".tc-chg-kwtitle").textContent = title;
            const bodyEl = document.createElement("div");
            bodyEl.className = "tc-chg-kwbody";
            chips.forEach(c => {
                const chip = document.createElement("span");
                chip.className = "tc-chg-chip" + (chipClass ? " " + chipClass : "");
                chip.textContent = c;
                bodyEl.appendChild(chip);
            });
            head.addEventListener("click", () => {
                const open = !bodyEl.hidden;
                bodyEl.hidden = open;
                head.setAttribute("aria-expanded", String(!open));
            });
            card.append(head, bodyEl);
            kwEl.appendChild(card);
        }

        // addKeywordCard already returns early on an empty list, so a card with
        // nothing to show never renders.
        addKeywordCard(ICON.check, "Strong match", matchedKw, "");
        // Everything the optimiser put on the skills line, whether it came from
        // the JD or was surfaced from the candidate's own projects.
        const skillDiffForCard = buildSkillLineDiffs();
        const allAdded = skillsAdded.slice();
        const seenAdd = new Set(allAdded.map(skillKey));
        (skillDiffForCard[0]?._addedSkills || []).forEach(s => {
            const k = skillKey(s);
            if (k && !seenAdd.has(k)) { seenAdd.add(k); allAdded.push(s); }
        });
        addKeywordCard(ICON.check, "Added Skills", allAdded, "", "added");
        // Gaps the optimiser withheld are genuinely absent from the new resume,
        // so they belong in the same Missing Keywords card rather than a second
        // list with a different name saying the same thing.
        const stillMissing = missingKw.concat(
            partitionKeywords(skillGaps, finalText, skillsAdded).missing);
        const seenMiss = new Set();
        const missingFinal = stillMissing.filter(k => {
            const key = skillKey(k);
            if (!key || seenMiss.has(key)) return false;
            seenMiss.add(key);
            return true;
        });
        addKeywordCard(ICON.warn, "Missing Keywords", missingFinal, "miss");

        /* ── G. Nested change cards: Section > Entry > Change #N ── */
        function collapsible(headEl, panelEl, openByDefault) {
            headEl.setAttribute("aria-expanded", openByDefault ? "true" : "false");
            if (!openByDefault) panelEl.hidden = true;
            headEl.addEventListener("click", ev => {
                if (ev.target.closest(".tc-chg-compare-link")) return;
                const open = !panelEl.hidden;
                panelEl.hidden = open;
                headEl.setAttribute("aria-expanded", String(!open));
            });
        }

        // Group entries by their resume section so each gets one Level-1 card.
        const SECTION_LABEL = {
            experience: "Work Experience", projects: "Projects",
            extracurricular: "Leadership & Activities", education: "Education",
        };
        const bySection = new Map();
        entries.forEach((entry, idx) => {
            const key = entry.section || "experience";
            if (!bySection.has(key)) bySection.set(key, []);
            bySection.get(key).push({ entry, idx });
        });

        // The summary is a change like any other - one card, not a dumped paragraph.
        if (summaryChange) {
            bySection.set("summary", [{
                entry: { label: "Professional Summary",
                         bullets: [{ status: summaryChange.status,
                                     before: summaryChange.before,
                                     after:  summaryChange.after }] },
                idx: -1,
            }]);
        }

        // Technical Skills gets its own section card. The additions are real
        // changes to the document and were previously reported nowhere.
        const skillDiff = buildSkillLineDiffs();
        if (skillDiff.length && skillDiff[0]._addedSkills.length) {
            const addedSkills = skillDiff[0]._addedSkills;
            const fromBody = skillsFoundInBody(addedSkills);
            bySection.set("skills", [{
                entry: {
                    label: "Technical Skills",
                    _chips: { added: addedSkills, fromBody: fromBody },
                    bullets: [],
                },
                idx: -1,
            }]);
        }

        let sectionNo = 0;
        bySection.forEach((list, sectionKey) => {
            const sec = document.createElement("div");
            sec.className = "tc-chg-sec";
            const secHead = document.createElement("button");
            secHead.type = "button";
            secHead.className = "tc-chg-sechead";
            secHead.innerHTML = `<span class="tc-chg-sectitle"></span>
                <span class="tc-chg-chevbox"><span class="tc-chg-chev"></span></span>`;
            secHead.querySelector(".tc-chg-sectitle").textContent =
                SECTION_LABEL[sectionKey] || (sectionKey === "summary" ? "Summary" : sectionKey);
            const secBody = document.createElement("div");
            secBody.className = "tc-chg-secbody";

            list.forEach(({ entry, idx }) => {
                const changed = (entry.bullets || []).filter(b => b.status !== "unchanged");
                // A chips-only entry (Technical Skills) has no bullets but is
                // still a real change worth showing.
                if (!changed.length && !entry._chips) return;

                const ent = document.createElement("div");
                ent.className = "tc-chg-entry";
                const entHead = document.createElement("button");
                entHead.type = "button";
                entHead.className = "tc-chg-entryhead";
                entHead.innerHTML = `<span class="tc-chg-entrytitle"></span><span class="tc-chg-chev"></span>`;
                entHead.querySelector(".tc-chg-entrytitle").textContent =
                    entry.label || entry.section || "";
                const entBody = document.createElement("div");
                entBody.className = "tc-chg-entrybody";

                if (entry._chips) {
                    const wrap = document.createElement("div");
                    wrap.className = "tc-chg-item";
                    const inner = document.createElement("div");
                    inner.className = "tc-chg-itembody-inner";
                    inner.style.borderTop = "0";
                    inner.style.paddingTop = "0";

                    const lbl = document.createElement("div");
                    lbl.className = "tc-chg-afterlabel";
                    lbl.textContent = "Added";
                    inner.appendChild(lbl);

                    const chips = document.createElement("div");
                    chips.className = "tc-chg-kwbody";
                    chips.style.padding = "0";
                    entry._chips.added.forEach(sk => {
                        const c = document.createElement("span");
                        c.className = "tc-chg-chip";
                        c.textContent = sk;
                        chips.appendChild(c);
                    });
                    inner.appendChild(chips);

                    // Says where the skill came from, so the addition reads as
                    // surfacing the candidate's own work rather than invention.
                    if (entry._chips.fromBody && entry._chips.fromBody.length) {
                        const note = document.createElement("div");
                        note.className = "tc-chg-provenance";
                        note.textContent = "Found in your Projects / Experience: "
                            + entry._chips.fromBody.join(", ");
                        inner.appendChild(note);
                    }

                    wrap.appendChild(inner);
                    entBody.appendChild(wrap);
                }

                (entry.bullets || []).forEach((b, i) => {
                    if (b.status === "unchanged") return;
                    const item = document.createElement("div");
                    item.className = "tc-chg-item";
                    const itemHead = document.createElement("button");
                    itemHead.type = "button";
                    itemHead.className = "tc-chg-itemhead";
                    itemHead.innerHTML = `<span class="tc-chg-itemnum"></span>` +
                        `<span class="tc-chg-newtag" hidden>New</span>` +
                        `<span class="tc-chg-chev"></span>`;
                    itemHead.querySelector(".tc-chg-itemnum").textContent = "#" + (i + 1);
                    // Content with no "before" is new rather than reworded, and
                    // saying so stops the reader hunting for what it replaced.
                    if (b.status !== "reworded" || !b.before) {
                        itemHead.querySelector(".tc-chg-newtag").hidden = false;
                    }

                    const itemBody = document.createElement("div");
                    itemBody.className = "tc-chg-itembody";
                    const inner = document.createElement("div");
                    inner.className = "tc-chg-itembody-inner";

                    const lbl = document.createElement("div");
                    lbl.className = "tc-chg-afterlabel";
                    lbl.textContent = "After";
                    const txt = document.createElement("div");
                    txt.className = "tc-chg-aftertext";
                    txt.textContent = b.after || "";
                    inner.append(lbl, txt);

                    if (b.status === "reworded" && b.before) {
                        const link = document.createElement("button");
                        link.type = "button";
                        link.className = "tc-chg-compare-link";
                        link.textContent = "Compare Before and After";
                        const ba = document.createElement("div");
                        ba.className = "tc-chg-ba";
                        ba.hidden = true;
                        const bl = document.createElement("div");
                        bl.className = "tc-chg-ba-label";
                        bl.textContent = "Before";
                        const bt = document.createElement("div");
                        bt.className = "tc-chg-ba-before";
                        bt.textContent = b.before;
                        const al = document.createElement("div");
                        al.className = "tc-chg-ba-label";
                        al.textContent = "After";
                        const at = document.createElement("div");
                        at.className = "tc-chg-ba-after";
                        at.textContent = b.after;
                        ba.append(bl, bt, al, at);
                        link.addEventListener("click", ev => {
                            ev.stopPropagation();
                            const open = !ba.hidden;
                            ba.hidden = open;
                            link.textContent = open ? "Compare Before and After" : "Hide comparison";
                        });
                        inner.append(link, ba);
                    }

                    itemBody.appendChild(inner);
                    collapsible(itemHead, itemBody, true);
                    item.append(itemHead, itemBody);

                    // Clicking a change scrolls the preview to the bullet it describes.
                    if (idx >= 0) {
                        itemHead.addEventListener("click", () => {
                            const el = markIndex.get(idx + ":" + i);
                            if (!el) return;
                            el.scrollIntoView({ behavior: "smooth", block: "center" });
                            el.classList.add("tcv-mark-focus");
                            setTimeout(() => el.classList.remove("tcv-mark-focus"), 1600);
                        });
                    }
                    entBody.appendChild(item);
                });

                collapsible(entHead, entBody, true);
                ent.append(entHead, entBody);
                secBody.appendChild(ent);
            });

            if (!secBody.children.length) return;
            collapsible(secHead, secBody, sectionNo === 0);
            sectionNo++;
            sec.append(secHead, secBody);
            body.appendChild(sec);
        });

        if (!scoresEl.children.length && !kwEl.children.length && !body.children.length) {
            const empty = document.createElement("div");
            empty.className = "tc-chg-empty";
            empty.textContent = "No meaningful changes were detected — your resume came through largely as written.";
            body.appendChild(empty);
        }

        /* ── Right pane ── */
        const previewEl = overlay.querySelector(".tc-chg-preview");
        const pageEl    = overlay.querySelector(".tc-chg-page");
        // Assigned below, read inside buildMirror's load handler. Declared here
        // so the handler can never hit it in the temporal dead zone.
        let previewExtras = { summary: null, skillLines: [] };

        const MARK_CSS =
            ".tcv-edit-controls,.tcv-add-btn,.tcv-del-btn,[data-tcv-control]{display:none!important}" +
            "body{cursor:default!important}" +
            "del.tcv-mark-del{background:#FDE2E2;color:#D93025;text-decoration:line-through;" +
            "padding:0 2px;border-radius:2px;}" +
            "ins.tcv-mark-add{background:#B7F5B0;color:inherit;text-decoration:none;" +
            "padding:0 2px;border-radius:2px;}" +
            // inline, never inline-block: a block box would break the line flow
            // and reintroduce the stretched gaps between highlighted words.
            "del.tcv-mark-del,ins.tcv-mark-add{display:inline;white-space:normal;" +
            "letter-spacing:normal;word-spacing:normal;}" +
            ".tcv-mark-focus{outline:2px solid #2563eb;outline-offset:2px;border-radius:3px;}";

        function buildMirror(target, html, marked) {
            const f = document.createElement("iframe");
            f.className = "tc-chg-mirror";
            f.setAttribute("title", "Resume preview");
            f.srcdoc = html;
            f.addEventListener("load", () => {
                try {
                    const d = f.contentDocument;
                    if (!d) return;
                    d.querySelectorAll("[contenteditable]").forEach(el => el.removeAttribute("contenteditable"));
                    const s = d.createElement("style");
                    s.textContent = MARK_CSS;
                    d.head && d.head.appendChild(s);
                    if (marked) markIndex = markChangesInPreview(d, entries, previewExtras);
                    // Grow the frame to the document's real height so a
                    // multi-page resume is scrolled, never cut off. Measured
                    // after marking, which can reflow the text.
                    const fit = () => {
                        const h = Math.max(
                            d.body ? d.body.scrollHeight : 0,
                            d.documentElement ? d.documentElement.scrollHeight : 0);
                        if (h > 0) f.style.height = h + "px";
                    };
                    fit();
                    setTimeout(fit, 120);
                } catch (e) {}
            });
            target.appendChild(f);
            return f;
        }

        /* Skills lines change on nearly every run - the optimiser adds JD
           skills the resume evidences - and they were the one visible part of
           the document with no highlighting at all. There is no server-side
           diff for them, so reconstruct one: the skills the resume ENDED with,
           minus the ones the optimiser reports adding, is what it started with. */
        function buildSkillLineDiffs() {
            const rd = (payload && payload.resume_data) || {};
            const finalSkills = Array.isArray(rd.skills) ? rd.skills.filter(Boolean) : [];
            if (!finalSkills.length) return [];

            // What the candidate listed before. Prefer the server's parse of
            // their own skills section; fall back to "final minus added" when
            // it is unavailable.
            let beforeList = Array.isArray(changes.original_skills)
                ? changes.original_skills.filter(Boolean) : [];
            if (!beforeList.length) {
                const addedKeys = new Set(skillsAdded.map(skillKey));
                beforeList = finalSkills.filter(s => !addedKeys.has(skillKey(s)));
            }

            const beforeKeys = new Set(beforeList.map(skillKey));
            // Item-by-item, not word-by-word: a word diff over a comma list
            // splits "Node.js" from its own punctuation and marks commas.
            // Normalised keys mean PostgreSQL/Postgres is not a change.
            const added = finalSkills.filter(s => !beforeKeys.has(skillKey(s)));
            if (!added.length) return [];

            return [{
                status: "reworded",
                before: beforeList.join(", "),
                after:  finalSkills.join(", "),
                _addedSkills: added,
            }];
        }

        /* Skills the optimiser lifted out of the candidate's own Projects and
           Experience - present in the document already, just never listed. */
        function skillsFoundInBody(added) {
            const rd = (payload && payload.resume_data) || {};
            const body = []
                .concat((rd.experience || []).flatMap(e => e.bullets || []))
                .concat((rd.projects   || []).flatMap(e => e.bullets || []))
                .join(" ")
                .toLowerCase();
            const blob = body.replace(/[^a-z0-9+#]/g, "");
            return (added || []).filter(s => {
                const k = skillKey(s);
                return k.length >= 3 && blob.includes(k);
            });
        }

        previewExtras = {
            summary: summaryChange,
            skillLines: buildSkillLineDiffs(),
            originalIndex: origIdx,
        };

        if (modalHtml) buildMirror(pageEl, modalHtml, true);


        // Belt and braces for the support widget: the CSS above catches the
        // vendors we can name, this catches anything else pinned to the bottom
        // right, which is where every one of them sits.
        document.body.classList.add("tc-chg-open");
        const hidden = [];
        try {
            const vh = window.innerHeight, vw = window.innerWidth;
            document.querySelectorAll("body > *").forEach(node => {
                if (node === overlay || node.nodeType !== 1) return;
                const cs = getComputedStyle(node);
                if (cs.position !== "fixed" || cs.display === "none") return;
                const r = node.getBoundingClientRect();
                if (!r.width || !r.height) return;
                if (r.bottom > vh - 160 && r.right > vw - 160 && r.width < 420) {
                    hidden.push([node, node.style.display]);
                    node.style.display = "none";
                }
            });
        } catch (e) {}

        function close() {
            overlay.remove();
            if (typeof modalOnClose === "function") {
                try { modalOnClose(); } catch (e) {}
            }
            document.body.classList.remove("tc-chg-open");
            hidden.forEach(([node, prev]) => { node.style.display = prev; });
            document.removeEventListener("keydown", onEsc);
        }
        function onEsc(e) { if (e.key === "Escape") close(); }

        overlay.querySelector(".tc-chg-close").addEventListener("click", close);
        overlay.querySelector(".tc-chg-backdrop").addEventListener("click", close);
        overlay.querySelector(".tc-chg-apply").addEventListener("click", close);
        document.addEventListener("keydown", onEsc);

        document.body.appendChild(overlay);
    }

    window.TCVChangesModal = {
        open(payload, html, opts) {
            modalHtml = String(html || "");
            modalOnClose = (opts && opts.onClose) || null;
            showChangesModal(payload);
            const overlay = document.getElementById("tc-chg-overlay");
            // The extension has already downloaded the PDF: nothing to apply.
            const apply = overlay && overlay.querySelector(".tc-chg-apply");
            if (apply && opts && opts.applyLabel) apply.textContent = opts.applyLabel;
            return !!overlay;
        },
    };
})();
