# Resume rendering — what keeps the templates from breaking

Written before merging Shubham's editor design over this branch. His design is
the one we want; his branch has a rendering bug that breaks templates. **This
file records why ours renders correctly, so the logic below can be re-applied
on top of his UI after the pull.**

Everything here is verified by measurement (WeasyPrint geometry probes), not by
eye.

---

## 0. The one rule

`_render_resume_html()` → WeasyPrint is the ONLY renderer. The preview and the
PDF are produced from the same HTML and the same CSS. Any design setting that
the browser applies but the server does not will drift, and the PDF will stop
matching the preview.

`main.py:12060  _render_resume_html()`
`main.py:12129  _render_resume_pdf_sync()`

---

## 1. Templates 7–22 load NO shared stylesheet

```python
if template_id == 6:        style_filename = "style3.css"
elif template_id < 7:       style_filename = f"style{style_id}.css"
else:                       style_filename = ""      # <-- self-contained
```

Templates 1–6 share `css/style1..4.css`. **Templates 7–22 each carry their own
inline `<style>` and load nothing shared.** This is the single most important
fact about this codebase's rendering.

Consequence: a fix written into `style1..4.css` reaches six templates and
silently misses sixteen. That is why the same bugs "kept coming back" on 7–12
and 13–19 after being fixed for 1–6.

**Therefore: shared fixes must be injected at render time, not written into a
stylesheet.**

---

## 2. The corrective sheet (`_RESUME_NORMALIZE_CSS`)

Defined at `main.py:~975`, injected LAST in `_render_resume_html()`:

```python
_fixes = _RESUME_NORMALIZE_CSS + _sidebar_page_css(html_content)
html_content = html_content.replace('</head>', f'<style>{_fixes}</style></head>')
```

Injected last so it wins on equal specificity over each template's own
`<style>`. It is corrective only — it fixes the bug classes below and restyles
nothing else, so every template keeps its own look.

### 2a. Right-edge clipping  (MEASURED: overflow 19px → 0)

Every template declared:

```css
@page { size: A4; margin: 8mm 0 0; }   /* zero LEFT and RIGHT margin */
.resume { width: 210mm; }              /* full paper width */
```

Content therefore ran edge to edge: measured `left=0.0, right_edge=793.7` on a
794px page. The left only *looked* right because a sidebar or padding happened
to inset the text.

Fix: put the horizontal margin on `@page` (so it applies to every page,
including pages created after a break) and release the root container from the
fixed 210mm so it fills the printable width instead of the paper width.

```css
@page { margin-left: var(--tcv-margin-x, 10mm) !important;
        margin-right: var(--tcv-margin-x, 10mm) !important; }
.resume, .resume-wrap, .page, .layout {
    width: 100% !important; max-width: 100% !important;
    margin-left: 0 !important; margin-right: 0 !important;
}
```

Verified: right margin 0 → 37.8px (≈10mm) on templates 7–19; template 10's
19px overflow eliminated; no `CLIPPED` on any page.

### 2b. Near-blank trailing pages

```css
.resume, .resume-wrap, .page, .layout {
    min-height: 0 !important; height: auto !important; overflow: visible !important;
}
.resume, .resume-wrap, .page { box-shadow: none !important; border-radius: 0 !important; }
```

`min-height: 297mm` + `overflow: hidden` on the root made WeasyPrint reserve a
whole page even when three lines remained, and clipped content past page 1
outright. Decorations (shadow, radius) cannot survive a page split.

### 2c. Numbered contacts / skills / certifications

The List Style setting must reach experience, project and education bullets and
**nothing else**. Contacts, skills, certs, awards, languages and chip rows are
semantic `<ul>`s too, so they are explicitly cleared — `list-style: none` AND
`::marker { content: "" }`, because clearing `list-style` alone is not enough
once a parent has set `list-style-type`.

### 2d. Sidebar chrome on later pages (`_sidebar_page_css`)

A sidebar drawn as a grid cell ends where its content ends, so page 2 lost it
entirely (MEASURED: page 1 sidebar `y=10→1123` reaches bottom; page 2 none).

Fix: paint the column as an `@page` background so it exists on every page, and
make the column itself transparent so the two cannot disagree.

Two traps, both hit once already:
- **CSS variables do not resolve inside `@page`.** The variable must be
  dereferenced to its literal hex before being written into the rule.
- **Class names differ per template.** The real ones are `.sidebar`,
  `.name-card`, `.name-block`, `.contact-card`, `.contact-strip`,
  `.contact-bar`, `.top`, `.identity`, `.header`. **`.banner` and
  `.header-band` do not exist in any template** — selectors guessing at those
  match nothing.

Templates 9 and 11 use `.side` (not `.sidebar`), put the column on the RIGHT
(`grid-template-columns: 67% 33%`), and have **no coloured panel at all** —
returning empty for them is correct, not a failure.

---

## 3. Bullets must be escaped (`_strip_inline_markup`)

`main.py:2162`, called from `normalize_list_of_strings()`.

Templates render through `Jinja2Template(template_content)` — **autoescape is
OFF** (verified: `t.environment.autoescape is False`). Any inline HTML the model
writes inside a bullet renders as LIVE markup. That is why words like "GitHub",
"Razorpay", "Playwright" and "50+" appeared underlined or link-coloured in the
middle of ordinary sentences.

Real links live in structured fields (`projects[].url`, `contact.*`), never in
bullet prose, so stripping tags from bullet text loses nothing legitimate.

Do NOT "fix" this by turning autoescape on globally — the templates rely on
unescaped rendering elsewhere.

---

## 4. Contrast: never paint the accent onto an accent background

The Design tab applied `color: ${accent} !important` to `h1, .name, h2`. When
the user picked blue, template 7's name card became blue-on-blue and the summary
banner heading vanished.

Rules that must survive:
- Compute the ink from the element's MEASURED background, not from class names.
- Mid-tone surfaces clear 4.5:1 against neither white nor `#1f2937` (template 8's
  teal `#2f9b95` sits at 4.36) — push the ink further until it passes, and deepen
  the surface if even pure white falls short (template 7's card: 4.47).
- Chips are FILLED with the accent (`.chip-list li { background: var(--accent) }`)
  while hardcoding white text — a pale accent gives white-on-pale.

Guarded by `test_contrast.py` (5 tests, all passing).

---

## 5. Inline `!important` beats stylesheet `!important`

`applyFontScale()` / `applyLineSpacing()` write `font-size` and `line-height`
**inline on every element** with `!important`. A stylesheet rule — even with
`!important` — cannot override that.

Any new Font Size / Line Height control must drive those functions, not emit CSS:

```js
currentZoom        = clamp(v / 11,  0.6, 1.8);   // 11pt  is neutral (scale 1.0)
currentLineSpacing = clamp(v / 1.2, 0.7, 1.5);   // 1.2   is neutral (scale 1.0)
```

This is why sliders that "looked right but did nothing" were dead: the value
changed, the CSS was written, and the inline styles won.

---

## 6. Preview pagination must not invent pages

`static/editor_v2.js  layoutPages()`

- The measuring sheet carries `min-height: <full page>`. Measure with that
  removed (`.edv2-measuring { min-height: 0 }`) or every block looks like it
  overflows and lands on its own sheet — an 8-page preview for a 2-page resume.
- Descend into any block taller than a page, or a template whose body is one
  `.layout` element puts the whole resume on page 2 and leaves page 1 empty.
- **Never split a `display: grid` / `flex` container** — its children are the
  columns; splitting them puts the sidebar on one page and the main column on
  another.
- The page COUNT shown to the user comes from WeasyPrint
  (`/api/estimate-html-pages`), never from the DOM split. The JS split only
  decides where to draw sheet boundaries.

Verified: 17/22 templates' preview split matches the PDF exactly; the remaining
5 (8, 9, 11, 13, 18) have few tall blocks and draw one sheet more, but display
the correct count.

---

## 7. Known-good measurements (re-run after the merge)

Fixture: 3 jobs × 6 bullets, 2 projects, 16 skills → 2 pages on most templates.

| Check | Expected |
|---|---|
| Right margin, templates 7–19 | 37.8px both sides, no clipping |
| Template 10 overflow | 0px (was 19px past the edge) |
| Templates 20/21/22 preview | 1 page (was 8) |
| Preview vs PDF page count | 17/22 exact; all 22 show the correct number |
| `test_contrast.py` | 5/5 |

Probe scripts live in the session scratchpad: `probe_templates.py`,
`probe_edges.py`, `probe_text_edges.py`, `probe_preview_split.py`,
`check_surfaces.py`. `test_contrast.py` is committed at the repo root.

---

## 8. Merge order

1. Branch first: `git checkout -b backup/main-before-shubham-design`.
2. Pull Shubham's editor UI (`templates/optimized_editor.html`, the editor CSS/JS
   — the design, not the render path).
3. Re-apply, in this order: §2 corrective sheet, §3 bullet escaping,
   §4 contrast, §5 slider wiring, §6 pagination.
4. Re-run §7. Any regression means a piece of §2–§6 did not come across.

`main.py` has no `--reload`: **restart the server after any Python change**, or
the fix is on disk and not in the process.
