// Runs inside changes.html, the full-viewport frame content.js opens for
// "See what changed". The sidebar posts the preview in; closing the modal
// posts back so the frame is removed.

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return;
  const msg = e.data;
  if (!msg || msg.type !== 'tcv-changes-open' || !msg.preview) return;

  const preview = msg.preview;
  const payload = {
    resume_data: preview.resumeData || {},
    skill_match_before: preview.before,
    skill_match_after: preview.after,
    // The score block reads ats_score; the extension's score is the skill match.
    ats_score: preview.after,
  };
  const closed = () => window.parent.postMessage({ type: 'tcv-changes-closed' }, '*');
  const opened = window.TCVChangesModal
    && window.TCVChangesModal.open(payload, preview.html || '', { onClose: closed, applyLabel: 'Done' });
  if (!opened) closed();   // never leave an invisible frame over the page
});
