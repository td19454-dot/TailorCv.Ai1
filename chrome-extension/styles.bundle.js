(() => {
  // sidebar.css
  var sidebar_default = `/* TailorCV Auto Apply \u2014 Injected Sidebar Styles */

#tailorcv-sidebar {
  position: fixed !important;
  top: 0 !important;
  right: 0 !important;
  width: 380px !important;
  max-width: calc(100vw - 16px) !important;
  height: 100vh !important;
  display: flex !important;
  flex-direction: column !important;
  background: linear-gradient(160deg, #0f1629, #0e1a2e) !important;
  border: none !important;
  border-left: 1px solid rgba(79, 127, 255, 0.3) !important;
  border-radius: 0 !important;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.45) !important;
  z-index: 2147483647 !important;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  font-size: 15px !important;
  color: #f1f5f9 !important;
  padding: 0 !important;
  transition: transform 0.25s ease !important;
  overflow: hidden !important;
}

/* Header and tabs stay put; only this part scrolls. */
.tcv-scroll {
  flex: 1 1 auto !important;
  min-height: 0 !important;
  overflow-y: auto !important;
  overscroll-behavior: contain !important;
  padding: 4px 16px 20px !important;
  scrollbar-width: thin !important;
  scrollbar-color: rgba(255,255,255,0.12) transparent !important;
}

#tailorcv-sidebar.tcv-collapsed {
  /* 120% of the panel's own width guarantees it clears fully off-screen
     (including box-shadow) instead of leaving a text sliver visible. */
  transform: translateX(120%) !important;
}

/* Small icon-only launcher shown in place of the panel while collapsed. */
#tailorcv-launcher {
  position: fixed !important;
  top: 80px !important;
  right: 0 !important;
  width: 56px !important;
  height: 56px !important;
  display: none !important;
  align-items: center !important;
  justify-content: center !important;
  background: linear-gradient(160deg, #0f1629, #0e1a2e) !important;
  border: 1px solid rgba(79, 127, 255, 0.3) !important;
  border-right: none !important;
  border-radius: 12px 0 0 12px !important;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.45) !important;
  z-index: 2147483647 !important;
  cursor: pointer !important;
  padding: 0 !important;
}

#tailorcv-launcher.tcv-visible {
  display: flex !important;
}

#tailorcv-launcher img {
  width: 34px !important;
  height: 34px !important;
  border-radius: 8px !important;
  pointer-events: none !important;
}

#tailorcv-sidebar * {
  box-sizing: border-box !important;
  font-family: inherit !important;
  line-height: 1.4 !important;
}

.tcv-header {
  position: relative !important;
  flex: 0 0 auto !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  padding: 16px 16px 12px !important;
}

/* Segmented tab bar under the header. */
.tcv-tabs {
  flex: 0 0 auto !important;
  display: flex !important;
  gap: 4px !important;
  margin: 0 16px 14px !important;
  padding: 4px !important;
  border-radius: 12px !important;
  background: rgba(255,255,255,0.04) !important;
  border: 1px solid rgba(255,255,255,0.07) !important;
}
.tcv-tabs.tcv-hidden { display: none !important; }
.tcv-tab {
  flex: 1 1 0 !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 6px !important;
  padding: 9px 6px !important;
  border: none !important;
  border-radius: 9px !important;
  background: none !important;
  color: #8da3c6 !important;
  font-size: 13.5px !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  transition: background 0.15s, color 0.15s !important;
}
.tcv-tab svg { flex: 0 0 auto !important; }
.tcv-tab:hover:not(:disabled):not(.tcv-active) { color: #eaf1ff !important; background: rgba(255,255,255,0.04) !important; }
.tcv-tab.tcv-active {
  background: rgba(79,127,255,0.16) !important;
  color: #93b4ff !important;
  box-shadow: inset 0 0 0 1px rgba(79,127,255,0.3) !important;
}
.tcv-tab:disabled { opacity: 0.4 !important; cursor: not-allowed !important; }

/* \u2500\u2500 Cards (job view) \u2500\u2500 */
.tcv-card {
  display: block !important;
  width: 100% !important;
  margin: 0 0 12px !important;
  border-radius: 12px !important;
  background: rgba(255,255,255,0.04) !important;
  border: 1px solid rgba(255,255,255,0.08) !important;
  color: #eaf1ff !important;
  text-align: left !important;
}

.tcv-job-main {
  display: flex !important;
  align-items: flex-start !important;
  gap: 12px !important;
  padding: 14px !important;
}
.tcv-job-avatar {
  flex: 0 0 44px !important;
  width: 44px !important;
  height: 44px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  border-radius: 10px !important;
  background: rgba(79,127,255,0.14) !important;
  color: #93b4ff !important;
  font-size: 18px !important;
  font-weight: 700 !important;
}
/* The employer's logo in the avatar tile, on white like most logos expect. */
.tcv-job-avatar.tcv-has-logo {
  background: #ffffff !important;
  padding: 4px !important;
  overflow: hidden !important;
}
.tcv-job-avatar img {
  width: 100% !important;
  height: 100% !important;
  object-fit: contain !important;
  border-radius: 6px !important;
  display: block !important;
}
.tcv-job-text { min-width: 0 !important; }
.tcv-job-title {
  font-size: 17px !important;
  font-weight: 700 !important;
  color: #f1f5f9 !important;
  line-height: 1.3 !important;
  overflow-wrap: anywhere !important;
}
.tcv-job-meta {
  margin-top: 3px !important;
  font-size: 12.5px !important;
  color: #7e8ba3 !important;
}
.tcv-job-foot {
  padding: 10px 14px !important;
  border-top: 1px solid rgba(255,255,255,0.07) !important;
  font-size: 12.5px !important;
  color: #7e8ba3 !important;
}
.tcv-job-foot a {
  color: #93c5fd !important;
  text-decoration: none !important;
  font-weight: 600 !important;
  cursor: pointer !important;
}
.tcv-job-foot a:hover { text-decoration: underline !important; }

/* The one loud button in the view. */
.tcv-btn.tcv-btn-cta {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 8px !important;
  min-height: 52px !important;
  margin-bottom: 12px !important;
  font-size: 17px !important;
  font-weight: 700 !important;
  border-radius: 12px !important;
  box-shadow: 0 6px 18px rgba(79,127,255,0.28) !important;
}
.tcv-btn-cta span { font-size: 13px !important; }

.tcv-btn-outline-accent {
  background: rgba(79,127,255,0.08) !important;
  color: #93b4ff !important;
  border: 1px solid rgba(79,127,255,0.55) !important;
  margin-bottom: 0 !important;
}
.tcv-btn-outline-accent:hover:not(:disabled) { background: rgba(79,127,255,0.16) !important; }
.tcv-af-panel .tcv-btn-outline-accent { margin-bottom: 8px !important; }

.tcv-resume-card { padding: 14px !important; }
.tcv-card-head {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
  margin-bottom: 12px !important;
  font-size: 15px !important;
  font-weight: 700 !important;
  color: #eaf1ff !important;
}
.tcv-card-head svg { color: #8da3c6 !important; }
.tcv-resume-file {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 8px !important;
  padding: 11px 12px !important;
  margin-bottom: 14px !important;
  border-radius: 10px !important;
  background: rgba(255,255,255,0.03) !important;
  border: 1px solid rgba(255,255,255,0.1) !important;
  text-decoration: none !important;
  color: #eaf1ff !important;
}
.tcv-resume-file:hover { border-color: rgba(79,127,255,0.45) !important; }
.tcv-resume-name {
  font-size: 13.5px !important;
  font-weight: 600 !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}
.tcv-chev {
  color: #7e8ba3 !important;
  font-size: 18px !important;
  line-height: 1 !important;
}

.tcv-row-card {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  padding: 14px !important;
  cursor: pointer !important;
  font-size: 15px !important;
  transition: border-color 0.15s !important;
}
.tcv-row-card svg { color: #8da3c6 !important; flex: 0 0 auto !important; }
.tcv-row-card:hover:not(:disabled) { border-color: rgba(79,127,255,0.45) !important; }
.tcv-row-card:disabled { opacity: 0.45 !important; cursor: not-allowed !important; }
.tcv-row-title { flex: 1 1 auto !important; font-weight: 700 !important; }
.tcv-row-meta {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
  font-size: 13px !important;
  color: #7e8ba3 !important;
}

.tcv-header-actions {
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
}

.tcv-brand {
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
}

.tcv-logo-icon {
  width: 26px !important;
  height: 26px !important;
  border-radius: 6px !important;
  display: block !important;
}

.tcv-logo {
  font-size: 20px !important;
  font-weight: 700 !important;
  background: linear-gradient(135deg, #4f7fff, #c9b8ff) !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  background-clip: text !important;
}

.tcv-toggle {
  cursor: pointer !important;
  color: #64748b !important;
  font-size: 18px !important;
  background: none !important;
  border: none !important;
  padding: 4px !important;
  border-radius: 6px !important;
  line-height: 1 !important;
  display: inline-flex !important;
  align-items: center !important;
}
.tcv-toggle:hover { background: rgba(255,255,255,0.08) !important; }

/* Dev builds only: the delayed page-structure capture. Dashed amber so it is
   never mistaken for a product control. */
.tcv-dev-capture {
  cursor: pointer !important;
  font: 600 11px/1 inherit !important;
  color: #fcd34d !important;
  background: rgba(245,158,11,0.10) !important;
  border: 1px dashed rgba(245,158,11,0.55) !important;
  border-radius: 6px !important;
  padding: 5px 7px !important;
  margin-right: 4px !important;
  white-space: nowrap !important;
}
.tcv-dev-capture:hover { background: rgba(245,158,11,0.2) !important; }

/* Account menu: only shown once GET_PROFILE confirms a logged-in session.
   The trigger is a round avatar carrying the user's initial, so it reads as
   an account icon rather than another toolbar action. */
.tcv-account-btn {
  display: none !important;
  align-items: center !important;
  justify-content: center !important;
  width: 24px !important;
  height: 24px !important;
  cursor: pointer !important;
  color: #fff !important;
  font-size: 12px !important;
  font-weight: 700 !important;
  text-transform: uppercase !important;
  background: linear-gradient(135deg, #4f7fff, #7c3aed) !important;
  border: none !important;
  border-radius: 50% !important;
  padding: 0 !important;
  line-height: 1 !important;
}
.tcv-account-btn.tcv-visible { display: inline-flex !important; }
.tcv-account-btn:hover { opacity: 0.85 !important; }

.tcv-account-menu {
  display: none !important;
  position: absolute !important;
  top: 100% !important;
  right: 0 !important;
  margin-top: 8px !important;
  width: 210px !important;
  background: #101a30 !important;
  border: 1px solid rgba(255,255,255,0.14) !important;
  border-radius: 10px !important;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4) !important;
  padding: 8px !important;
  z-index: 10 !important;
}
.tcv-account-menu.tcv-visible { display: block !important; }

.tcv-account-email {
  font-size: 12px !important;
  color: #8da3c6 !important;
  padding: 4px 8px 8px !important;
  margin-bottom: 4px !important;
  border-bottom: 1px solid rgba(255,255,255,0.08) !important;
  word-break: break-all !important;
}

.tcv-account-item {
  display: block !important;
  width: 100% !important;
  text-align: left !important;
  background: none !important;
  border: none !important;
  color: #eaf1ff !important;
  font-size: 13px !important;
  font-weight: 400 !important;
  text-decoration: none !important;
  padding: 8px !important;
  border-radius: 6px !important;
  cursor: pointer !important;
}
.tcv-account-item:hover:not(:disabled) { background: rgba(255,255,255,0.08) !important; }

.tcv-account-logout {
  color: #fca5a5 !important;
}
.tcv-account-logout:disabled { opacity: 0.6 !important; cursor: not-allowed !important; }

.tcv-stats {
  display: flex !important;
  gap: 8px !important;
  margin-bottom: 16px !important;
}

.tcv-stat {
  flex: 1 !important;
  text-align: center !important;
  padding: 10px 6px !important;
  border-radius: 10px !important;
  background: rgba(255,255,255,0.05) !important;
}

.tcv-stat-num {
  font-size: 22px !important;
  font-weight: 700 !important;
  display: block !important;
}
.tcv-stat-num.tcv-blue  { color: #60a5fa !important; }
.tcv-stat-num.tcv-green { color: #4ade80 !important; }
.tcv-stat-num.tcv-red   { color: #f87171 !important; }

.tcv-stat-label {
  font-size: 10px !important;
  color: #64748b !important;
  text-transform: uppercase !important;
  letter-spacing: 0.06em !important;
}

.tcv-btn {
  width: 100% !important;
  padding: 13px 16px !important;
  border: none !important;
  border-radius: 10px !important;
  font-size: 15px !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  margin-bottom: 8px !important;
  transition: opacity 0.2s !important;
}
.tcv-btn:disabled { opacity: 0.45 !important; cursor: not-allowed !important; }

.tcv-btn-start {
  background: linear-gradient(135deg, #4f7fff, #7c3aed) !important;
  color: #fff !important;
}
.tcv-btn-start:hover:not(:disabled) { opacity: 0.88 !important; }

.tcv-btn-stop {
  background: rgba(239,68,68,0.18) !important;
  color: #f87171 !important;
  border: 1px solid rgba(239,68,68,0.35) !important;
}
.tcv-btn-stop:hover { background: rgba(239,68,68,0.28) !important; }

.tcv-btn-outline {
  background: rgba(255,255,255,0.04) !important;
  color: #eaf1ff !important;
  border: 1px solid rgba(255,255,255,0.18) !important;
}
.tcv-btn-outline:hover { background: rgba(255,255,255,0.09) !important; }

.tcv-divider {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  margin: 14px 0 !important;
  color: #64748b !important;
  font-size: 11px !important;
  text-transform: uppercase !important;
  letter-spacing: 0.06em !important;
}
.tcv-divider::before, .tcv-divider::after {
  content: '' !important;
  flex: 1 !important;
  height: 1px !important;
  background: rgba(255,255,255,0.08) !important;
}

.tcv-login-links {
  display: flex !important;
  justify-content: space-between !important;
  margin-top: 10px !important;
  gap: 10px !important;
}
.tcv-login-links .tcv-link { font-size: 13px !important; }

.tcv-status-text {
  font-size: 13px !important;
  color: #64748b !important;
  text-align: center !important;
  margin: 6px 0 10px !important;
  min-height: 18px !important;
}
.tcv-status-text.tcv-ok    { color: #86efac !important; }
.tcv-status-text.tcv-error { color: #fca5a5 !important; }

.tcv-loading-anim {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 28px 0 4px !important;
}
.tcv-loading-anim svg,
.tcv-loading-anim img {
  width: 84px !important;
  height: 84px !important;
  display: block !important;
}

.tcv-loading-label {
  text-align: center !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  color: #4ade80 !important;
  padding-bottom: 24px !important;
}

.tcv-progress-wrap {
  display: none !important;
  align-items: center !important;
  justify-content: center !important;
  margin: 14px 0 4px !important;
}
.tcv-progress-wrap.tcv-visible {
  display: flex !important;
}

.tcv-progress-circle {
  position: relative !important;
  width: 88px !important;
  height: 88px !important;
}

.tcv-progress-ring {
  transform: rotate(-90deg) !important;
}

.tcv-progress-track {
  fill: none !important;
  stroke: rgba(255,255,255,0.08) !important;
  stroke-width: 6 !important;
}

.tcv-progress-bar {
  fill: none !important;
  stroke: url(#tcvProgressGradient) !important;
  stroke-width: 6 !important;
  stroke-linecap: round !important;
}

.tcv-progress-pct {
  position: absolute !important;
  inset: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 18px !important;
  font-weight: 700 !important;
  color: #eaf1ff !important;
  transition: opacity 0.25s ease !important;
}
.tcv-success-tick {
  display: none !important;
  align-items: center !important;
  justify-content: center !important;
  width: 100% !important;
  height: 170px !important;
}
.tcv-success-tick.tcv-visible {
  display: flex !important;
}
.tcv-success-tick svg,
.tcv-success-tick img {
  width: 170px !important;
  height: 170px !important;
  display: block !important;
}

.tcv-score-card {
  display: none !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 16px !important;
  padding: 16px 12px !important;
  margin: 4px 0 !important;
  border-radius: 12px !important;
  background: linear-gradient(160deg, rgba(79,127,255,0.12), rgba(74,222,128,0.12)) !important;
  border: 1px solid rgba(74,222,128,0.3) !important;
}
.tcv-score-card.tcv-visible {
  display: flex !important;
}

/* Skills the job asked for that the resume evidences nowhere. Deliberately
   quieter than the score card next to it: this is information, not a result. */
.tcv-skill-gaps {
  padding: 12px !important;
  margin: 4px 0 !important;
  border-radius: 12px !important;
  background: rgba(255,255,255,0.03) !important;
  border: 1px solid rgba(148,163,184,0.18) !important;
}
.tcv-skill-gaps-title {
  font-size: 11px !important;
  font-weight: 700 !important;
  letter-spacing: .04em !important;
  text-transform: uppercase !important;
  color: #94a3b8 !important;
  margin-bottom: 8px !important;
}
.tcv-skill-gaps-pills {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 6px !important;
}
.tcv-skill-gap-pill {
  display: inline-block !important;
  padding: 3px 9px !important;
  border-radius: 999px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  color: #cbd5e1 !important;
  background: rgba(79,127,255,0.14) !important;
  border: 1px solid rgba(79,127,255,0.28) !important;
}
.tcv-skill-gap-pill.added {
  color: #6ee7b7 !important;
  background: rgba(16,185,129,0.16) !important;
  border: 1px solid rgba(16,185,129,0.35) !important;
}
.tcv-skill-gaps-note {
  margin-top: 8px !important;
  font-size: 10.5px !important;
  line-height: 1.45 !important;
  color: #7e8ba3 !important;
}
.tcv-skill-gaps-note.tcv-error { color: #fca5a5 !important; }

/* Post-tailor skills pop-up: the download waits on this, so it is the loudest
   thing in the panel while it is up. */
.tcv-skill-prompt {
  padding: 14px !important;
  margin: 6px 0 !important;
  border-radius: 12px !important;
  background: rgba(79,127,255,0.08) !important;
  border: 1px solid rgba(79,127,255,0.35) !important;
}
.tcv-skill-prompt-title {
  font-size: 13px !important;
  font-weight: 700 !important;
  line-height: 1.35 !important;
  color: #eaf1ff !important;
}
.tcv-skill-prompt-sub {
  margin: 4px 0 10px !important;
  font-size: 11.5px !important;
  line-height: 1.45 !important;
  color: #a5b4cf !important;
}
.tcv-skill-prompt-pills {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 6px !important;
  margin-bottom: 12px !important;
}
.tcv-skill-prompt-pill {
  padding: 4px 10px !important;
  border-radius: 999px !important;
  font-size: 11.5px !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  color: #cbd5e1 !important;
  background: rgba(255,255,255,0.04) !important;
  border: 1px solid rgba(148,163,184,0.35) !important;
}
.tcv-skill-prompt-pill[aria-pressed="true"] {
  color: #6ee7b7 !important;
  background: rgba(16,185,129,0.16) !important;
  border-color: rgba(16,185,129,0.5) !important;
}
.tcv-skill-prompt-pill[aria-pressed="true"]::before { content: "\u2713 " !important; }
.tcv-skill-prompt-actions {
  display: flex !important;
  flex-direction: column !important;
  gap: 6px !important;
}
.tcv-skill-btn {
  width: 100% !important;
  padding: 8px 10px !important;
  border-radius: 8px !important;
  font-size: 12.5px !important;
  font-weight: 600 !important;
  cursor: pointer !important;
  color: #eaf1ff !important;
  background: rgba(255,255,255,0.06) !important;
  border: 1px solid rgba(255,255,255,0.16) !important;
}
.tcv-skill-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12) !important; }
.tcv-skill-btn-primary {
  background: linear-gradient(135deg, #4f7fff, #7c3aed) !important;
  border-color: transparent !important;
}
.tcv-skill-btn-primary:hover:not(:disabled) { opacity: 0.9 !important; background: linear-gradient(135deg, #4f7fff, #7c3aed) !important; }
.tcv-skill-btn:disabled { opacity: 0.5 !important; cursor: not-allowed !important; }
.tcv-skill-notnow {
  display: block !important;
  margin: 8px auto 0 !important;
  background: none !important;
  border: none !important;
  font-size: 11px !important;
  color: #8da3c6 !important;
  text-decoration: underline !important;
  cursor: pointer !important;
}
.tcv-skill-notnow:disabled { opacity: 0.5 !important; cursor: not-allowed !important; }

/* Account-menu switch for "Add missing skills automatically". */
.tcv-account-switch {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 8px !important;
  line-height: 1.3 !important;
}
.tcv-account-switch input {
  position: absolute !important;
  opacity: 0 !important;
  width: 0 !important;
  height: 0 !important;
}
.tcv-switch-track {
  position: relative !important;
  flex: 0 0 30px !important;
  width: 30px !important;
  height: 17px !important;
  border-radius: 999px !important;
  background: rgba(255,255,255,0.18) !important;
  transition: background .15s !important;
}
.tcv-switch-track::after {
  content: "" !important;
  position: absolute !important;
  top: 2px !important;
  left: 2px !important;
  width: 13px !important;
  height: 13px !important;
  border-radius: 50% !important;
  background: #fff !important;
  transition: transform .15s !important;
}
.tcv-account-switch input:checked + .tcv-switch-track { background: #10b981 !important; }
.tcv-account-switch input:checked + .tcv-switch-track::after { transform: translateX(13px) !important; }
.tcv-account-switch input:disabled + .tcv-switch-track { opacity: 0.5 !important; }

.tcv-changes-panel {
  padding: 0 !important;
  margin: 4px 0 !important;
  border-radius: 12px !important;
  background: rgba(255,255,255,0.03) !important;
  border: 1px solid rgba(148,163,184,0.18) !important;
  overflow: hidden !important;
}
.tcv-changes-toggle {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  width: 100% !important;
  padding: 12px !important;
  background: none !important;
  border: none !important;
  cursor: pointer !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  letter-spacing: .04em !important;
  text-transform: uppercase !important;
  color: #94a3b8 !important;
}
.tcv-changes-toggle .tcv-changes-chevron {
  transition: transform 0.2s ease !important;
  font-size: 10px !important;
}
.tcv-changes-panel.tcv-changes-open .tcv-changes-chevron {
  transform: rotate(180deg) !important;
}
.tcv-changes-body {
  display: none !important;
  padding: 0 12px 12px !important;
}
.tcv-changes-panel.tcv-changes-open .tcv-changes-body {
  display: block !important;
}
.tcv-changes-entry-label {
  font-size: 10.5px !important;
  font-weight: 700 !important;
  color: #cbd5e1 !important;
  margin: 8px 0 4px !important;
}
.tcv-changes-bullet {
  font-size: 10.5px !important;
  line-height: 1.5 !important;
  margin: 6px 0 !important;
}
.tcv-changes-before {
  color: #7e8ba3 !important;
  text-decoration: line-through !important;
}
.tcv-changes-after {
  color: #e2e8f0 !important;
  margin-top: 2px !important;
}
.tcv-changes-tag {
  display: inline-block !important;
  font-size: 9px !important;
  font-weight: 700 !important;
  letter-spacing: .03em !important;
  text-transform: uppercase !important;
  padding: 1px 6px !important;
  border-radius: 5px !important;
  margin-right: 5px !important;
  background: rgba(79,127,255,0.18) !important;
  color: #93b4ff !important;
}
.tcv-changes-empty {
  font-size: 10.5px !important;
  color: #7e8ba3 !important;
}

.tcv-score-item {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  gap: 2px !important;
}

.tcv-score-num {
  font-size: 26px !important;
  font-weight: 800 !important;
  color: #cbd5e1 !important;
  line-height: 1 !important;
}
.tcv-score-num.tcv-score-after {
  color: #4ade80 !important;
}

.tcv-score-label {
  font-size: 10px !important;
  font-weight: 600 !important;
  color: #64748b !important;
  text-transform: uppercase !important;
  letter-spacing: 0.05em !important;
}

.tcv-score-arrow {
  font-size: 20px !important;
  color: #4f7fff !important;
  font-weight: 700 !important;
}

.tcv-log {
  max-height: 220px !important;
  overflow-y: auto !important;
  border-top: 1px solid rgba(255,255,255,0.07) !important;
  padding-top: 10px !important;
  scrollbar-width: thin !important;
  scrollbar-color: rgba(255,255,255,0.1) transparent !important;
}

.tcv-log-item {
  font-size: 12px !important;
  padding: 4px 0 !important;
  border-bottom: 1px solid rgba(255,255,255,0.04) !important;
  word-break: break-word !important;
}
.tcv-log-item.tcv-success { color: #86efac !important; }
.tcv-log-item.tcv-fail    { color: #fca5a5 !important; }
.tcv-log-item.tcv-info    { color: #94a3b8 !important; }

.tcv-msg {
  font-size: 14px !important;
  line-height: 1.5 !important;
  color: #94a3b8 !important;
  margin-bottom: 14px !important;
}

.tcv-empty-msg {
  font-size: 17px !important;
  font-weight: 600 !important;
  color: #ffffff !important;
  text-align: center !important;
}

/* Empty base-resume state: a document that shakes to grab attention, then
   settles while its "?" badge pulses, on an endless 3.2s loop. */
.tcv-empty-state {
  display: flex !important;
  justify-content: center !important;
  padding: 10px 0 6px !important;
}

.tcv-doc-wrap {
  display: inline-block !important;
  transform-origin: 50% 60% !important;
  animation: tcvDocCycle 3.2s ease-in-out infinite !important;
}

.tcv-doc-badge {
  animation: tcvBadgeCycle 3.2s ease-in-out infinite !important;
}

@keyframes tcvDocCycle {
  0%     { transform: rotate(0deg) translateY(0px); }
  2.8%   { transform: rotate(-6deg) translateY(-3px); }
  5.6%   { transform: rotate(5deg) translateY(-5px); }
  8.4%   { transform: rotate(-4deg) translateY(-3px); }
  11.25% { transform: rotate(3deg) translateY(-1px); }
  14.1%  { transform: rotate(-2deg) translateY(0px); }
  18.75% { transform: rotate(0deg) translateY(0px); }
  43.75% { transform: rotate(0deg) translateY(0px); }
  71.9%  { transform: rotate(0deg) translateY(-6px); }
  100%   { transform: rotate(0deg) translateY(0px); }
}

@keyframes tcvBadgeCycle {
  0%     { transform: scale(1); opacity: 1; }
  18.75% { transform: scale(1); opacity: 1; }
  28.75% { transform: scale(1.18); opacity: 0.85; }
  36.25% { transform: scale(0.94); opacity: 1; }
  43.75% { transform: scale(1); opacity: 1; }
  100%   { transform: scale(1); opacity: 1; }
}

.tcv-field-label {
  display: block !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  color: #8da3c6 !important;
  text-transform: uppercase !important;
  letter-spacing: 0.04em !important;
  margin: 0 0 5px !important;
}

.tcv-input {
  width: 100% !important;
  background: rgba(255,255,255,0.06) !important;
  border: 1px solid rgba(255,255,255,0.12) !important;
  color: #f1f5f9 !important;
  border-radius: 8px !important;
  padding: 11px 13px !important;
  font-size: 14px !important;
  margin-bottom: 10px !important;
}
.tcv-input:focus { outline: none !important; border-color: #4f7fff !important; }

.tcv-error {
  font-size: 12px !important;
  color: #f87171 !important;
  min-height: 15px !important;
  margin-top: 6px !important;
}

.tcv-link {
  display: inline-block !important;
  color: #93c5fd !important;
  text-decoration: underline !important;
  font-size: 13px !important;
  cursor: pointer !important;
}

.tcv-job-info {
  font-size: 19px !important;
  color: #94a3b8 !important;
  margin-bottom: 14px !important;
  line-height: 1.4 !important;
}
.tcv-job-info b {
  color: #eaf1ff !important;
}

/* \u2500\u2500 Skill match: a meter, not a line of text \u2500\u2500
   The bar's colour carries the verdict so the number doesn't have to. This is the
   before-tailor browsing signal; the animated success tick + score card handle the
   after-tailor moment. */
.tcv-match {
  display: flex !important;
  align-items: center !important;
  gap: 14px !important;
  margin-bottom: 14px !important;
}
.tcv-ring-wrap {
  position: relative !important;
  flex: 0 0 64px !important;
  width: 64px !important;
  height: 64px !important;
}
.tcv-ring { transform: rotate(-90deg) !important; display: block !important; }
.tcv-ring-track {
  fill: none !important;
  stroke: rgba(255,255,255,0.08) !important;
  stroke-width: 6 !important;
}
.tcv-ring-bar {
  fill: none !important;
  stroke: url(#tcvMatchGradient) !important;
  stroke-width: 6 !important;
  stroke-linecap: round !important;
  /* dashoffset is not !important \u2014 paintMatch() animates it via inline style */
  transition: stroke-dashoffset 0.8s cubic-bezier(.22,.61,.36,1), stroke 0.4s ease !important;
}
.tcv-match-value {
  position: absolute !important;
  inset: 0 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 19px !important;
  font-weight: 750 !important;
  color: #eaf1ff !important;
  font-variant-numeric: tabular-nums !important;
  line-height: 1 !important;
}
.tcv-match-text { min-width: 0 !important; }
.tcv-match-verdict {
  font-size: 15px !important;
  font-weight: 700 !important;
  color: #eaf1ff !important;
}
.tcv-match-sub {
  margin-top: 2px !important;
  font-size: 12.5px !important;
  color: #7e8ba3 !important;
}
/* The ring's colour carries the verdict, so the number does not have to. */
.tcv-match.tcv-low  .tcv-ring-bar { stroke: #f87171 !important; }
.tcv-match.tcv-mid  .tcv-ring-bar { stroke: #fbbf24 !important; }
.tcv-match.tcv-high .tcv-ring-bar { stroke: #34d399 !important; }
.tcv-match.tcv-low  .tcv-match-value { color: #fca5a5 !important; }
.tcv-match.tcv-mid  .tcv-match-value { color: #fcd34d !important; }
.tcv-match.tcv-high .tcv-match-value { color: #86efac !important; }
.tcv-match.tcv-na   .tcv-match-value { color: #94a3b8 !important; }

.tcv-upgrade-box {
  text-align: center !important;
  padding: 18px 14px !important;
  border-radius: 12px !important;
  background: linear-gradient(160deg, rgba(79,127,255,0.14), rgba(124,58,237,0.14)) !important;
  border: 1px solid rgba(79,127,255,0.35) !important;
}
.tcv-upgrade-box .tcv-msg { margin-bottom: 14px !important; }

.tcv-btn-link {
  display: block !important;
  text-align: center !important;
  text-decoration: none !important;
  box-sizing: border-box !important;
}

.tcv-retry-link {
  display: block !important;
  text-align: center !important;
  margin-top: 12px !important;
  font-size: 12px !important;
}

/* Where the job description came from, and the way back out of a bad guess. */
.tcv-source {
  font-size: 10px !important;
  color: #64748b !important;
  margin: -4px 0 10px !important;
}
.tcv-source a {
  color: #93c5fd !important;
  text-decoration: underline !important;
  cursor: pointer !important;
}

/* Manual fallback: the user hands us the job description themselves. */
.tcv-textarea {
  width: 100% !important;
  background: rgba(255,255,255,0.06) !important;
  border: 1px solid rgba(255,255,255,0.12) !important;
  color: #f1f5f9 !important;
  border-radius: 6px !important;
  padding: 8px 10px !important;
  font-size: 12px !important;
  line-height: 1.45 !important;
  font-family: inherit !important;
  resize: vertical !important;
  margin-bottom: 8px !important;
  box-sizing: border-box !important;
}
.tcv-textarea:focus { outline: none !important; border-color: #4f7fff !important; }

.tcv-btn-ghost {
  background: rgba(255,255,255,0.06) !important;
  color: #cbd5e1 !important;
  border: 1px solid rgba(255,255,255,0.14) !important;
}
.tcv-btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.11) !important; }

/* \u2500\u2500 Application autofill \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
   Same conventions as everything above: flat .tcv- classes, !important on
   every declaration (host pages on LinkedIn and Indeed reset aggressively),
   and the same colour set \u2014 #86efac for good, #fcd34d for review, #60a5fa
   for needs-you, #64748b for quiet. */

.tcv-af-panel { }

.tcv-af-summary {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 6px !important;
  margin-bottom: 12px !important;
}
.tcv-af-summary-pill {
  font-size: 12px !important;
  font-weight: 600 !important;
  padding: 4px 10px !important;
  border-radius: 99px !important;
  background: rgba(255,255,255,0.06) !important;
  border: 1px solid rgba(255,255,255,0.10) !important;
  white-space: nowrap !important;
}
.tcv-af-summary-pill.tcv-af-ok { color: #86efac !important; border-color: rgba(134,239,172,0.3) !important; }
.tcv-af-summary-pill.tcv-af-review { color: #fcd34d !important; border-color: rgba(252,211,77,0.3) !important; }
.tcv-af-summary-pill.tcv-af-ask { color: #60a5fa !important; border-color: rgba(96,165,250,0.3) !important; }

.tcv-af-group { margin-bottom: 14px !important; }
.tcv-af-group-title {
  font-size: 11px !important;
  font-weight: 700 !important;
  letter-spacing: 0.06em !important;
  text-transform: uppercase !important;
  color: #8da3c6 !important;
  margin-bottom: 6px !important;
}

.tcv-af-row {
  padding: 9px 11px !important;
  margin-bottom: 6px !important;
  border-radius: 10px !important;
  background: rgba(255,255,255,0.04) !important;
  border: 1px solid rgba(255,255,255,0.07) !important;
}
.tcv-af-row-head {
  display: flex !important;
  align-items: center !important;
  gap: 7px !important;
}
.tcv-af-badge {
  flex: 0 0 auto !important;
  width: 16px !important;
  height: 16px !important;
  border-radius: 50% !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 10px !important;
  font-weight: 700 !important;
  line-height: 1 !important;
}
.tcv-af-badge.tcv-af-ok { background: rgba(134,239,172,0.18) !important; color: #86efac !important; }
.tcv-af-badge.tcv-af-review { background: rgba(252,211,77,0.18) !important; color: #fcd34d !important; }
.tcv-af-badge.tcv-af-ask { background: rgba(96,165,250,0.18) !important; color: #60a5fa !important; }
.tcv-af-badge.tcv-af-unknown { background: rgba(100,116,139,0.20) !important; color: #94a3b8 !important; }

.tcv-af-row-label {
  flex: 1 1 auto !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  color: #eaf1ff !important;
  overflow-wrap: anywhere !important;
}
.tcv-af-jump {
  flex: 0 0 auto !important;
  font-size: 11px !important;
  color: #93c5fd !important;
  text-decoration: underline !important;
  cursor: pointer !important;
}
.tcv-af-row-value {
  font-size: 12px !important;
  color: #cbd5e1 !important;
  margin: 4px 0 0 23px !important;
  overflow-wrap: anywhere !important;
}
.tcv-af-row-src {
  font-size: 11px !important;
  color: #64748b !important;
  margin: 3px 0 0 23px !important;
  overflow-wrap: anywhere !important;
}

.tcv-af-ask-form { margin: 8px 0 0 23px !important; }
.tcv-af-ask-input, .tcv-af-ask-select {
  width: 100% !important;
  padding: 8px 10px !important;
  font-size: 13px !important;
  font-family: inherit !important;
  color: #f1f5f9 !important;
  background: rgba(255,255,255,0.06) !important;
  border: 1px solid rgba(255,255,255,0.12) !important;
  border-radius: 8px !important;
  box-sizing: border-box !important;
  margin-bottom: 6px !important;
}
.tcv-af-ask-input:focus, .tcv-af-ask-select:focus {
  outline: none !important;
  border-color: #4f7fff !important;
}
.tcv-af-ask-select option { background: #101a30 !important; color: #f1f5f9 !important; }
.tcv-af-remember {
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  font-size: 11px !important;
  color: #94a3b8 !important;
  margin-bottom: 7px !important;
  cursor: pointer !important;
}
.tcv-af-remember input { accent-color: #4f7fff !important; margin: 0 !important; }
.tcv-af-ask-save {
  width: auto !important;
  padding: 7px 14px !important;
  font-size: 12px !important;
  margin-bottom: 0 !important;
}

.tcv-af-note {
  font-size: 12px !important;
  color: #cbd5e1 !important;
  background: rgba(79,127,255,0.10) !important;
  border: 1px solid rgba(79,127,255,0.22) !important;
  border-radius: 10px !important;
  padding: 9px 11px !important;
  margin-bottom: 10px !important;
  line-height: 1.45 !important;
}
.tcv-af-note a { color: #93c5fd !important; text-decoration: underline !important; }
.tcv-af-note.tcv-af-note-quiet {
  background: transparent !important;
  border: none !important;
  color: #64748b !important;
  padding: 4px 0 0 !important;
  font-size: 11px !important;
}

/* \u2500\u2500 Auto-apply banner (running / paused / stopped / done) \u2500\u2500 */
.tcv-af-auto {
  font-size: 12px !important;
  color: #e2e8f0 !important;
  background: rgba(79,127,255,0.10) !important;
  border: 1px solid rgba(79,127,255,0.30) !important;
  border-radius: 10px !important;
  padding: 10px 12px !important;
  margin-bottom: 10px !important;
  line-height: 1.45 !important;
}
.tcv-af-auto-paused { background: rgba(245,158,11,0.10) !important; border-color: rgba(245,158,11,0.35) !important; }
.tcv-af-auto-done { background: rgba(34,197,94,0.10) !important; border-color: rgba(34,197,94,0.35) !important; }
.tcv-af-auto-title { font-weight: 700 !important; font-size: 13px !important; margin-bottom: 4px !important; }
.tcv-af-auto-msg { color: #cbd5e1 !important; margin-bottom: 6px !important; }
.tcv-af-auto-list { margin: 4px 0 8px 16px !important; padding: 0 !important; color: #cbd5e1 !important; }
.tcv-af-auto-list li { margin: 2px 0 !important; }
.tcv-af-auto-list a { color: #93c5fd !important; text-decoration: underline !important; }
.tcv-af-auto-actions { display: flex !important; gap: 8px !important; flex-wrap: wrap !important; }
.tcv-af-auto-actions .tcv-btn { flex: 1 1 auto !important; margin-bottom: 0 !important; }

/* \u2500\u2500 Job review form (Tailor tab on a page that only holds the application) \u2500\u2500 */
.tcv-review-banner {
  padding: 12px 14px !important;
  margin: 0 0 16px !important;
  border-radius: 12px !important;
  text-align: center !important;
  font-size: 13.5px !important;
  color: #86efac !important;
  background: rgba(52,211,153,0.12) !important;
  border: 1px solid rgba(52,211,153,0.28) !important;
}
.tcv-review-banner.tcv-review-warn {
  color: #fcd34d !important;
  background: rgba(251,191,36,0.10) !important;
  border-color: rgba(251,191,36,0.3) !important;
}
.tcv-review-company {
  position: relative !important;
}
.tcv-review-company img {
  position: absolute !important;
  left: 10px !important;
  top: 9px !important;
  width: 24px !important;
  height: 24px !important;
  border-radius: 5px !important;
  object-fit: contain !important;
  background: #fff !important;
}
.tcv-review-company img + .tcv-input {
  padding-left: 42px !important;
}
.tcv-textarea.tcv-review-jd {
  min-height: 180px !important;
  font-size: 13px !important;
  margin-bottom: 4px !important;
}

/* AI scanning view: sparkle + sliding bar while autofill / auto-apply runs */
.tcv-af-scan {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  text-align: center !important;
  padding: 48px 12px 28px !important;
}
.tcv-af-scan-icon {
  width: 64px !important;
  height: 64px !important;
  margin-bottom: 26px !important;
  filter: drop-shadow(0 0 14px rgba(99,102,241,0.55)) !important;
}
.tcv-af-scan-icon svg { width: 64px !important; height: 64px !important; display: block !important; overflow: visible !important; }
.tcv-af-scan-big { transform-origin: 34px 36px; animation: tcvScanPulse 1.6s ease-in-out infinite; }
.tcv-af-scan-small { transform-origin: 13px 12px; animation: tcvScanPulse 1.6s ease-in-out 0.5s infinite; }
@keyframes tcvScanPulse {
  0%, 100% { transform: scale(0.82) rotate(0deg); opacity: 0.75; }
  50% { transform: scale(1.06) rotate(12deg); opacity: 1; }
}
.tcv-af-scan-bar {
  position: relative !important;
  width: 78% !important;
  max-width: 300px !important;
  height: 4px !important;
  border-radius: 4px !important;
  background: rgba(148,163,184,0.18) !important;
  overflow: hidden !important;
  margin-bottom: 26px !important;
}
.tcv-af-scan-bar::after {
  content: "" !important;
  position: absolute !important;
  top: 0 !important;
  bottom: 0 !important;
  left: 0 !important;
  width: 45% !important;
  border-radius: 4px !important;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6) !important;
  animation: tcvScanSlide 1.5s ease-in-out infinite;
}
@keyframes tcvScanSlide {
  0% { transform: translateX(-105%); }
  100% { transform: translateX(230%); }
}
.tcv-af-scan-title {
  font-size: 17px !important;
  font-weight: 700 !important;
  color: #f1f5f9 !important;
  margin-bottom: 6px !important;
}
.tcv-af-scan-sub {
  font-size: 13px !important;
  line-height: 1.45 !important;
  color: #94a3b8 !important;
  max-width: 280px !important;
  margin-bottom: 22px !important;
}
.tcv-af-scan .tcv-btn { width: auto !important; min-width: 180px !important; }
@media (prefers-reduced-motion: reduce) {
  .tcv-af-scan-big, .tcv-af-scan-small, .tcv-af-scan-bar::after { animation: none !important; }
  .tcv-af-scan-bar::after { width: 100% !important; opacity: 0.6 !important; }
}

/* ── Results, clean list: one rounded list per group, thin dividers, no box per row ── */
.tcv-af-summary {
  display: block !important;
  padding: 12px 14px !important;
  margin-bottom: 12px !important;
  border-radius: 14px !important;
  background: rgba(255,255,255,0.035) !important;
  border: 1px solid rgba(148,163,184,0.12) !important;
}
.tcv-af-sum-line {
  display: flex !important;
  justify-content: space-between !important;
  align-items: baseline !important;
  font-size: 13px !important;
  color: #94a3b8 !important;
}
.tcv-af-sum-line b { color: #f1f5f9 !important; font-weight: 700 !important; }
.tcv-af-sum-pct { font-size: 15px !important; font-weight: 700 !important; color: #f1f5f9 !important; }
.tcv-af-sum-bar {
  height: 6px !important;
  border-radius: 6px !important;
  background: rgba(148,163,184,0.16) !important;
  overflow: hidden !important;
  margin-top: 8px !important;
}
.tcv-af-sum-bar span {
  display: block !important;
  height: 100% !important;
  border-radius: 6px !important;
  background: linear-gradient(90deg, #3b82f6, #8b5cf6) !important;
  transition: width 0.5s ease !important;
}
.tcv-af-sum-rest { display: flex !important; flex-wrap: wrap !important; gap: 4px 12px !important; margin-top: 9px !important; }
.tcv-af-sum-rest .tcv-af-summary-pill {
  background: none !important;
  border: none !important;
  padding: 0 !important;
  font-size: 11.5px !important;
  font-weight: 600 !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 5px !important;
}
.tcv-af-sum-rest .tcv-af-summary-pill::before {
  content: "" !important;
  width: 6px !important;
  height: 6px !important;
  border-radius: 50% !important;
  background: currentColor !important;
}

/* Autofill again: a quiet secondary action once the page is filled */
.tcv-af-panel #tcvAfRerun {
  background: transparent !important;
  border: 1px solid rgba(148,163,184,0.2) !important;
  color: #cbd5e1 !important;
  box-shadow: none !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  padding: 9px 12px !important;
  margin-bottom: 14px !important;
}
.tcv-af-panel #tcvAfRerun:hover { border-color: rgba(129,140,248,0.5) !important; color: #fff !important; }

.tcv-af-group {
  margin-bottom: 12px !important;
  border-radius: 14px !important;
  background: rgba(255,255,255,0.035) !important;
  border: 1px solid rgba(148,163,184,0.12) !important;
  overflow: hidden !important;
}
.tcv-af-group-title {
  padding: 10px 14px 8px !important;
  margin: 0 !important;
  font-size: 11px !important;
  color: #7c8db0 !important;
}
.tcv-af-row {
  padding: 9px 14px !important;
  margin: 0 !important;
  border: none !important;
  border-top: 1px solid rgba(148,163,184,0.09) !important;
  border-radius: 0 !important;
  background: transparent !important;
  transition: background 0.15s ease !important;
}
.tcv-af-row:hover { background: rgba(255,255,255,0.03) !important; }
.tcv-af-row-head { gap: 9px !important; }
.tcv-af-row-label { font-size: 12px !important; font-weight: 500 !important; color: #94a3b8 !important; }
.tcv-af-row-value {
  font-size: 13px !important;
  font-weight: 600 !important;
  color: #f1f5f9 !important;
  margin: 2px 0 0 25px !important;
}
.tcv-af-row-src { margin-left: 25px !important; color: #64748b !important; }
.tcv-af-ask-form { margin-left: 25px !important; }
/* Filled rows: where the value came from is noise; only Change / Forget stays */
.tcv-af-group-ok .tcv-af-row-src:not(.tcv-af-saved):not(.tcv-af-aside) { display: none !important; }
.tcv-af-saved { margin-top: 4px !important; }
.tcv-af-saved a, .tcv-af-aside a, .tcv-af-change, .tcv-af-forget {
  color: #8ab4ff !important;
  text-decoration: none !important;
  font-weight: 600 !important;
  font-size: 11px !important;
}
.tcv-af-saved a:hover, .tcv-af-aside a:hover { text-decoration: underline !important; }
.tcv-af-jump {
  opacity: 0 !important;
  text-decoration: none !important;
  font-weight: 600 !important;
  color: #8ab4ff !important;
  transition: opacity 0.15s ease !important;
}
.tcv-af-row:hover .tcv-af-jump, .tcv-af-jump:focus { opacity: 1 !important; }
.tcv-af-badge { width: 16px !important; height: 16px !important; font-size: 9px !important; }

/* Continue to the next page: pinned to the bottom of the panel */
.tcv-af-next-bar {
  position: sticky !important;
  bottom: 0 !important;
  padding: 12px 0 4px !important;
  margin-top: 4px !important;
  background: linear-gradient(180deg, rgba(15,23,42,0), #0f172a 35%) !important;
  z-index: 2 !important;
}
.tcv-af-next-bar .tcv-btn { margin-bottom: 0 !important; }

/* ── Calmer palette + plane-style main button (same look as the site's "Upload Existing CV") ── */
.tcv-btn.tcv-btn-cta {
  position: relative !important;
  background: linear-gradient(180deg, #3b82f6, #1d4ed8) !important;
  color: #fff !important;
  border: 2px solid rgba(0,0,0,0.38) !important;
  border-radius: 14px !important;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.14), inset 0 1px 0 rgba(255,255,255,0.22), 0 6px 16px rgba(29,78,216,0.28) !important;
  text-shadow: 0 1px 1px rgba(0,0,0,0.3) !important;
  font-size: 15px !important;
  font-weight: 650 !important;
  min-height: 50px !important;
  gap: 10px !important;
  transition: transform 0.2s ease, box-shadow 0.2s ease !important;
}
.tcv-btn.tcv-btn-cta:hover:not(:disabled) {
  opacity: 1 !important;
  transform: translateY(-1px) !important;
  box-shadow: 0 0 0 2px rgba(255,255,255,0.22), inset 0 1px 0 rgba(255,255,255,0.3), 0 10px 22px rgba(29,78,216,0.4) !important;
}
.tcv-btn.tcv-btn-cta:active:not(:disabled) { transform: none !important; }
.tcv-btn.tcv-btn-cta:disabled { opacity: 0.7 !important; }
.tcv-btn.tcv-btn-cta::before {
  content: "" !important;
  width: 18px !important;
  height: 18px !important;
  flex: 0 0 18px !important;
  background: currentColor !important;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 2 11 13'/%3E%3Cpath d='M22 2 15 22 11 13 2 9z'/%3E%3C/svg%3E") center / contain no-repeat !important;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 2 11 13'/%3E%3Cpath d='M22 2 15 22 11 13 2 9z'/%3E%3C/svg%3E") center / contain no-repeat !important;
  transform: rotate(-12deg) !important;
  transition: transform 0.3s ease !important;
}
.tcv-btn.tcv-btn-cta:hover:not(:disabled)::before { transform: rotate(30deg) translateX(1px) !important; }
.tcv-btn.tcv-btn-cta > span[aria-hidden="true"] { display: none !important; }

/* Neutral everywhere else: one accent (the button), greys for the rest */
.tcv-af-summary, .tcv-af-group {
  background: rgba(255,255,255,0.025) !important;
  border-color: rgba(255,255,255,0.07) !important;
}
.tcv-af-sum-bar span { background: #3b82f6 !important; }
.tcv-af-sum-rest .tcv-af-summary-pill,
.tcv-af-sum-rest .tcv-af-summary-pill.tcv-af-review,
.tcv-af-sum-rest .tcv-af-summary-pill.tcv-af-ask { color: #94a3b8 !important; font-weight: 500 !important; }
.tcv-af-sum-rest .tcv-af-summary-pill.tcv-af-review::before { background: #d4a72c !important; }
.tcv-af-sum-rest .tcv-af-summary-pill.tcv-af-ask::before { background: #64748b !important; }
.tcv-af-badge.tcv-af-ok { background: transparent !important; color: #3b82f6 !important; font-size: 11px !important; }
.tcv-af-badge.tcv-af-review { background: transparent !important; color: #d4a72c !important; }
.tcv-af-badge.tcv-af-ask, .tcv-af-badge.tcv-af-unknown { background: transparent !important; color: #94a3b8 !important; }
.tcv-af-saved a, .tcv-af-aside a, .tcv-af-change, .tcv-af-forget, .tcv-af-jump { color: #94a3b8 !important; }
.tcv-af-saved a:hover, .tcv-af-aside a:hover, .tcv-af-jump:hover { color: #e2e8f0 !important; }
.tcv-af-panel #tcvAfRerun { border-color: rgba(255,255,255,0.1) !important; color: #94a3b8 !important; }
.tcv-af-panel #tcvAfRerun:hover { border-color: rgba(255,255,255,0.22) !important; color: #e2e8f0 !important; }
.tcv-af-next-bar { background: linear-gradient(180deg, rgba(11,17,32,0), #0b1120 40%) !important; }
/* Scanning view in the same single accent */
.tcv-af-scan-bar::after { background: #3b82f6 !important; }
.tcv-af-scan-icon { filter: none !important; }

/* ── Flat: no frames around the summary, the re-run action or the groups ── */
.tcv-af-summary {
  background: none !important;
  border: none !important;
  border-radius: 0 !important;
  padding: 2px 2px 0 !important;
  margin-bottom: 6px !important;
}
.tcv-af-panel #tcvAfRerun {
  display: block !important;
  width: auto !important;
  min-height: 0 !important;
  margin: 0 0 10px auto !important;
  padding: 4px 2px !important;
  background: none !important;
  border: none !important;
  box-shadow: none !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  color: #94a3b8 !important;
}
.tcv-af-panel #tcvAfRerun:hover { color: #e2e8f0 !important; background: none !important; }
.tcv-af-group {
  background: none !important;
  border: none !important;
  border-radius: 0 !important;
  margin-bottom: 14px !important;
}
.tcv-af-group-title { padding: 6px 2px 6px !important; }
.tcv-af-row { padding: 9px 2px !important; border-top: 1px solid rgba(255,255,255,0.06) !important; }
.tcv-af-row:hover { background: none !important; }

/* ── Tabs: flat, underline style ── */
.tcv-tabs {
  gap: 0 !important;
  padding: 0 !important;
  margin: 0 16px 16px !important;
  border: none !important;
  border-radius: 0 !important;
  background: none !important;
  border-bottom: 1px solid rgba(255,255,255,0.08) !important;
}
.tcv-tab {
  position: relative !important;
  padding: 11px 6px 12px !important;
  border-radius: 0 !important;
  background: none !important;
  box-shadow: none !important;
  color: #7f8ba3 !important;
  font-size: 13.5px !important;
  font-weight: 600 !important;
  transition: color 0.2s ease !important;
}
.tcv-tab svg { opacity: 0.75 !important; transition: opacity 0.2s ease !important; }
.tcv-tab::after {
  content: "" !important;
  position: absolute !important;
  left: 18% !important;
  right: 18% !important;
  bottom: -1px !important;
  height: 2px !important;
  border-radius: 2px 2px 0 0 !important;
  background: #3b82f6 !important;
  transform: scaleX(0) !important;
  transition: transform 0.25s ease !important;
}
.tcv-tab:hover:not(:disabled):not(.tcv-active) { background: none !important; color: #cbd5e1 !important; }
.tcv-tab.tcv-active {
  background: none !important;
  box-shadow: none !important;
  color: #f8fafc !important;
}
.tcv-tab.tcv-active svg { opacity: 1 !important; color: #3b82f6 !important; }
.tcv-tab.tcv-active::after { transform: scaleX(1) !important; }

/* ── Flat cards: sections divided by hairlines, not boxed ── */
.tcv-card {
  background: none !important;
  border: none !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  margin: 0 0 4px !important;
}
.tcv-job-card { padding: 2px 0 0 !important; }
.tcv-job-card .tcv-job-main { padding: 4px 0 10px !important; }
.tcv-job-foot { border-top: none !important; padding: 0 0 14px !important; font-size: 12px !important; }
.tcv-job-foot a { color: #60a5fa !important; }
.tcv-resume-card, .tcv-row-card {
  padding: 16px 0 !important;
  border-top: 1px solid rgba(255,255,255,0.07) !important;
  margin-top: 6px !important;
}
.tcv-row-card { width: 100% !important; }
.tcv-row-card:hover:not(:disabled) { border-color: rgba(255,255,255,0.07) !important; }
.tcv-row-card:hover:not(:disabled) .tcv-row-title { color: #fff !important; }
.tcv-card-head { margin-bottom: 8px !important; font-size: 14px !important; }
.tcv-resume-file {
  padding: 8px 0 !important;
  margin-bottom: 10px !important;
  border: none !important;
  border-radius: 0 !important;
  background: none !important;
  color: #cbd5e1 !important;
}
.tcv-resume-file:hover { border: none !important; color: #fff !important; }
.tcv-resume-file:hover .tcv-chev { color: #e2e8f0 !important; }
.tcv-job-avatar { box-shadow: none !important; }

/* Match ring: keep the SVG at its own size (page CSS was shrinking it) */
.tcv-ring-wrap { width: 56px !important; height: 56px !important; flex: 0 0 56px !important; }
.tcv-ring { width: 56px !important; height: 56px !important; max-width: none !important; }
.tcv-match-value { font-size: 16px !important; }
.tcv-match { margin-bottom: 12px !important; }

/* Secondary actions: text buttons, no box */
.tcv-btn.tcv-btn-outline-accent {
  background: none !important;
  border: none !important;
  box-shadow: none !important;
  color: #60a5fa !important;
  font-size: 13.5px !important;
  font-weight: 600 !important;
  padding: 8px 4px !important;
  min-height: 0 !important;
}
.tcv-btn.tcv-btn-outline-accent:hover:not(:disabled) { background: rgba(96,165,250,0.08) !important; color: #93c5fd !important; opacity: 1 !important; }

/* ── Header in the same blue as the rest ── */
.tcv-logo-icon { filter: hue-rotate(-42deg) saturate(1.1) !important; }
.tcv-logo {
  background: linear-gradient(135deg, #93c5fd, #3b82f6) !important;
  -webkit-background-clip: text !important;
  background-clip: text !important;
}
.tcv-account-btn { background: linear-gradient(180deg, #3b82f6, #1d4ed8) !important; }
/* Line icons inside text buttons */
.tcv-ico { width: 15px !important; height: 15px !important; flex: 0 0 15px !important; vertical-align: -2px !important; margin-right: 6px !important; display: inline-block !important; }
.tcv-btn .tcv-ico { stroke: currentColor !important; fill: none !important; }

/* Launcher tab: stretches out on hover, drags up/down the right edge */
#tailorcv-launcher {
  touch-action: none !important;
  user-select: none !important;
  cursor: grab !important;
  transition: width 0.18s ease, box-shadow 0.18s ease !important;
  justify-content: flex-start !important;
  padding-left: 11px !important;
  overflow: hidden !important;
}
#tailorcv-launcher:hover {
  width: 70px !important;
  box-shadow: -6px 0 28px rgba(29, 78, 216, 0.35) !important;
}
#tailorcv-launcher::after {
  content: "" !important;
  position: absolute !important;
  left: 4px !important;
  top: 50% !important;
  width: 3px !important;
  height: 18px !important;
  margin-top: -9px !important;
  border-radius: 2px !important;
  background: rgba(147, 197, 253, 0.45) !important;
  opacity: 0 !important;
  transition: opacity 0.18s ease !important;
}
#tailorcv-launcher:hover::after,
#tailorcv-launcher.tcv-dragging::after {
  opacity: 1 !important;
}
#tailorcv-launcher.tcv-dragging {
  cursor: grabbing !important;
  width: 70px !important;
  transition: none !important;
}

/* AI scanning view: a page with a blue line sweeping down it */
.tcv-af-doc {
  position: relative !important;
  display: flex !important;
  flex-direction: column !important;
  width: 104px !important;
  height: 136px !important;
  box-sizing: border-box !important;
  padding: 16px 12px 12px !important;
  margin-bottom: 26px !important;
  background: #ffffff !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 6px !important;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.35) !important;
  overflow: hidden !important;
}
.tcv-af-doc i {
  display: block !important;
  height: 4px !important;
  border-radius: 2px !important;
  background: #e5e7eb !important;
  margin-bottom: 4px !important;
}
.tcv-af-doc .tcv-af-doc-h { width: 42% !important; height: 7px !important; margin-bottom: 10px !important; background: #dbe3ef !important; }
.tcv-af-doc .tcv-af-doc-s { width: 46% !important; margin-bottom: 12px !important; }
.tcv-af-doc .tcv-af-doc-f { height: 6px !important; margin-bottom: 7px !important; background: #eef1f5 !important; }
.tcv-af-doc .tcv-af-doc-b { width: 38% !important; height: 8px !important; margin: auto 0 0 auto !important; background: #e2e8f0 !important; }
.tcv-af-doc-scan {
  position: absolute !important;
  left: 0 !important;
  right: 0 !important;
  top: 0 !important;
  height: 2px !important;
  background: #3b82f6 !important;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.8) !important;
  animation: tcvDocScan 2.2s ease-in-out infinite alternate;
}
/* The glow trails the line: above it on the way down, below on the way up. */
.tcv-af-doc-scan::before {
  content: "" !important;
  position: absolute !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 2px !important;
  height: 26px !important;
  background: linear-gradient(to top, rgba(59, 130, 246, 0.22), rgba(59, 130, 246, 0)) !important;
  animation: tcvDocGlow 2.2s ease-in-out infinite alternate;
}
@keyframes tcvDocScan {
  0% { transform: translateY(0); }
  100% { transform: translateY(132px); }
}
@keyframes tcvDocGlow {
  0%, 8% { opacity: 0; }
  20%, 100% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .tcv-af-doc-scan, .tcv-af-doc-scan::before { animation: none !important; }
  .tcv-af-doc-scan { transform: translateY(54px) !important; }
}

/* Launcher: just the icon on the page edge, no dark tab behind it */
#tailorcv-launcher,
#tailorcv-launcher:hover,
#tailorcv-launcher.tcv-dragging {
  width: 52px !important;
  height: 52px !important;
  right: 6px !important;
  padding: 0 !important;
  justify-content: center !important;
  background: transparent !important;
  border: none !important;
  border-radius: 12px !important;
  box-shadow: none !important;
  overflow: visible !important;
}
#tailorcv-launcher::after { display: none !important; }
#tailorcv-launcher img {
  width: 40px !important;
  height: 40px !important;
  border-radius: 10px !important;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.28) !important;
  transition: transform 0.18s ease, box-shadow 0.18s ease !important;
}
#tailorcv-launcher:hover img,
#tailorcv-launcher.tcv-dragging img {
  transform: translateX(-4px) scale(1.08) !important;
  box-shadow: 0 6px 20px rgba(29, 78, 216, 0.4) !important;
}
#tailorcv-launcher:focus-visible { outline: 2px solid #3b82f6 !important; outline-offset: 2px !important; }
`;

  // src/styles.js
  window.__tcvSidebarCss = sidebar_default;
})();
