/* ============================================================================
   Shared resume + JD store — "upload once, reuse everywhere".

   When a user picks a resume PDF (or types a job description) on ANY feature
   page, it is saved to localStorage. On every other feature page that needs a
   resume / JD, it is automatically restored into the matching field, so the
   user never has to upload the same resume again.

   - Resume PDF  -> localStorage["tcv_resume_v1"]  ({name,type,data:dataURL,ts})
   - Job desc.   -> localStorage["tcv_jd_v1"]       (plain text)

   Pages just include this script; wiring is automatic by field type:
     • any <input type="file"> whose accept includes "pdf"
     • job-description <textarea> (#jd-text, #jd-input, #jobDesc, #ns-jd,
       or name="job_description")

   Opt-outs (set on the element):
     • data-restore-silent  -> restore the file but do NOT fire "change"
       (use on pages where "change" kicks off an expensive parse/upload).
     • data-no-store        -> ignore this field entirely.
   ============================================================================ */
(function () {
    'use strict';

    var RESUME_KEY = 'tcv_resume_v1';
    var JD_KEY = 'tcv_jd_v1';

    function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { } }

    // ── Resume ──────────────────────────────────────────────────────────────
    function saveResume(file) {
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
            lsSet(RESUME_KEY, JSON.stringify({
                name: file.name,
                type: file.type || 'application/pdf',
                data: reader.result,           // data URL (base64)
                ts: Date.now()
            }));
        };
        reader.readAsDataURL(file);
    }

    function getResume() {
        var raw = lsGet(RESUME_KEY);
        if (!raw) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
    }

    function recordToFile(rec) {
        var parts = rec.data.split(',');
        var bin = atob(parts[1]);
        var n = bin.length, u8 = new Uint8Array(n);
        while (n--) u8[n] = bin.charCodeAt(n);
        return new File([u8], rec.name || 'resume.pdf', { type: rec.type || 'application/pdf' });
    }

    // Put the saved resume into a file input. Returns true on success.
    function applyResumeTo(input, fireChange) {
        var rec = getResume();
        if (!rec || !rec.data || !input) return false;
        try {
            var dt = new DataTransfer();
            dt.items.add(recordToFile(rec));
            input.files = dt.files;
            if (fireChange) input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        } catch (e) {
            return false; // older browsers without DataTransfer file support
        }
    }

    function isPdfInput(inp) {
        return (inp.getAttribute('accept') || '').toLowerCase().indexOf('pdf') !== -1;
    }

    // ── Job description ─────────────────────────────────────────────────────
    var JD_SELECTORS = [
        'textarea#jd-text', 'textarea#jd-input', 'textarea#jobDesc',
        'textarea#ns-jd', 'textarea[name="job_description"]'
    ].join(', ');

    // ── Auto-wire on load ───────────────────────────────────────────────────
    function wire() {
        // Resume file inputs
        var fileInputs = document.querySelectorAll('input[type="file"]');
        Array.prototype.forEach.call(fileInputs, function (inp) {
            if (!isPdfInput(inp) || inp.hasAttribute('data-no-store')) return;

            // Save whenever the user chooses a new resume.
            inp.addEventListener('change', function () {
                if (inp.files && inp.files[0]) saveResume(inp.files[0]);
            });

            // Restore the saved resume if the field is still empty.
            if (!inp.files || !inp.files.length) {
                var silent = inp.hasAttribute('data-restore-silent');
                applyResumeTo(inp, !silent);
            }
        });

        // Job-description textareas
        var jdFields = document.querySelectorAll(JD_SELECTORS);
        Array.prototype.forEach.call(jdFields, function (ta) {
            if (ta.hasAttribute('data-no-store')) return;
            if (!ta.value) {
                var saved = lsGet(JD_KEY);
                if (saved) {
                    ta.value = saved;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                }
            }
            ta.addEventListener('input', function () { lsSet(JD_KEY, ta.value); });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wire);
    } else {
        wire();
    }

    // Public API (for manual use / a "clear my data" button later).
    window.TCVResume = {
        saveResume: saveResume,
        getResume: getResume,
        applyResumeTo: applyResumeTo,
        saveJD: function (t) { lsSet(JD_KEY, t || ''); },
        getJD: function () { return lsGet(JD_KEY) || ''; },
        clear: function () { lsDel(RESUME_KEY); lsDel(JD_KEY); }
    };
})();
