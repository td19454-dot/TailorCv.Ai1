(() => {
  // sidebar.css
  var sidebar_default = `/* TailorCV Auto Apply \u2014 Injected Sidebar Styles */\r
\r
#tailorcv-sidebar {\r
  position: fixed !important;\r
  top: 80px !important;\r
  right: 0 !important;\r
  width: 340px !important;\r
  background: linear-gradient(160deg, #0f1629, #0e1a2e) !important;\r
  border: 1px solid rgba(79, 127, 255, 0.3) !important;\r
  border-right: none !important;\r
  border-radius: 14px 0 0 14px !important;\r
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.45) !important;\r
  z-index: 2147483647 !important;\r
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;\r
  font-size: 15px !important;\r
  color: #f1f5f9 !important;\r
  padding: 20px !important;\r
  transition: transform 0.25s ease !important;\r
}\r
\r
#tailorcv-sidebar.tcv-collapsed {\r
  /* 120% of the panel's own width guarantees it clears fully off-screen\r
     (including box-shadow) instead of leaving a text sliver visible. */\r
  transform: translateX(120%) !important;\r
}\r
\r
/* Small icon-only launcher shown in place of the panel while collapsed. */\r
#tailorcv-launcher {\r
  position: fixed !important;\r
  top: 80px !important;\r
  right: 0 !important;\r
  width: 56px !important;\r
  height: 56px !important;\r
  display: none !important;\r
  align-items: center !important;\r
  justify-content: center !important;\r
  background: linear-gradient(160deg, #0f1629, #0e1a2e) !important;\r
  border: 1px solid rgba(79, 127, 255, 0.3) !important;\r
  border-right: none !important;\r
  border-radius: 12px 0 0 12px !important;\r
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.45) !important;\r
  z-index: 2147483647 !important;\r
  cursor: pointer !important;\r
  padding: 0 !important;\r
}\r
\r
#tailorcv-launcher.tcv-visible {\r
  display: flex !important;\r
}\r
\r
#tailorcv-launcher img {\r
  width: 34px !important;\r
  height: 34px !important;\r
  border-radius: 8px !important;\r
  pointer-events: none !important;\r
}\r
\r
#tailorcv-sidebar * {\r
  box-sizing: border-box !important;\r
  font-family: inherit !important;\r
  line-height: 1.4 !important;\r
}\r
\r
.tcv-header {\r
  position: relative !important;\r
  display: flex !important;\r
  align-items: center !important;\r
  justify-content: space-between !important;\r
  margin-bottom: 16px !important;\r
}\r
\r
.tcv-header-actions {\r
  display: flex !important;\r
  align-items: center !important;\r
  gap: 4px !important;\r
}\r
\r
.tcv-brand {\r
  display: flex !important;\r
  align-items: center !important;\r
  gap: 8px !important;\r
}\r
\r
.tcv-logo-icon {\r
  width: 22px !important;\r
  height: 22px !important;\r
  border-radius: 6px !important;\r
  display: block !important;\r
}\r
\r
.tcv-logo {\r
  font-size: 18px !important;\r
  font-weight: 700 !important;\r
  background: linear-gradient(135deg, #4f7fff, #c9b8ff) !important;\r
  -webkit-background-clip: text !important;\r
  -webkit-text-fill-color: transparent !important;\r
  background-clip: text !important;\r
}\r
\r
.tcv-toggle {\r
  cursor: pointer !important;\r
  color: #64748b !important;\r
  font-size: 18px !important;\r
  background: none !important;\r
  border: none !important;\r
  padding: 4px 6px !important;\r
  border-radius: 6px !important;\r
  line-height: 1 !important;\r
}\r
.tcv-toggle:hover { background: rgba(255,255,255,0.08) !important; }\r
\r
/* Account menu: only shown once GET_PROFILE confirms a logged-in session.\r
   The trigger is a round avatar carrying the user's initial, so it reads as\r
   an account icon rather than another toolbar action. */\r
.tcv-account-btn {\r
  display: none !important;\r
  align-items: center !important;\r
  justify-content: center !important;\r
  width: 24px !important;\r
  height: 24px !important;\r
  cursor: pointer !important;\r
  color: #fff !important;\r
  font-size: 12px !important;\r
  font-weight: 700 !important;\r
  text-transform: uppercase !important;\r
  background: linear-gradient(135deg, #4f7fff, #7c3aed) !important;\r
  border: none !important;\r
  border-radius: 50% !important;\r
  padding: 0 !important;\r
  line-height: 1 !important;\r
}\r
.tcv-account-btn.tcv-visible { display: inline-flex !important; }\r
.tcv-account-btn:hover { opacity: 0.85 !important; }\r
\r
.tcv-account-menu {\r
  display: none !important;\r
  position: absolute !important;\r
  top: 100% !important;\r
  right: 0 !important;\r
  margin-top: 8px !important;\r
  width: 210px !important;\r
  background: #101a30 !important;\r
  border: 1px solid rgba(255,255,255,0.14) !important;\r
  border-radius: 10px !important;\r
  box-shadow: 0 8px 24px rgba(0,0,0,0.4) !important;\r
  padding: 8px !important;\r
  z-index: 10 !important;\r
}\r
.tcv-account-menu.tcv-visible { display: block !important; }\r
\r
.tcv-account-email {\r
  font-size: 12px !important;\r
  color: #8da3c6 !important;\r
  padding: 4px 8px 8px !important;\r
  margin-bottom: 4px !important;\r
  border-bottom: 1px solid rgba(255,255,255,0.08) !important;\r
  word-break: break-all !important;\r
}\r
\r
.tcv-account-item {\r
  display: block !important;\r
  width: 100% !important;\r
  text-align: left !important;\r
  background: none !important;\r
  border: none !important;\r
  color: #eaf1ff !important;\r
  font-size: 13px !important;\r
  font-weight: 400 !important;\r
  text-decoration: none !important;\r
  padding: 8px !important;\r
  border-radius: 6px !important;\r
  cursor: pointer !important;\r
}\r
.tcv-account-item:hover:not(:disabled) { background: rgba(255,255,255,0.08) !important; }\r
\r
.tcv-account-logout {\r
  color: #fca5a5 !important;\r
}\r
.tcv-account-logout:disabled { opacity: 0.6 !important; cursor: not-allowed !important; }\r
\r
.tcv-stats {\r
  display: flex !important;\r
  gap: 8px !important;\r
  margin-bottom: 16px !important;\r
}\r
\r
.tcv-stat {\r
  flex: 1 !important;\r
  text-align: center !important;\r
  padding: 10px 6px !important;\r
  border-radius: 10px !important;\r
  background: rgba(255,255,255,0.05) !important;\r
}\r
\r
.tcv-stat-num {\r
  font-size: 22px !important;\r
  font-weight: 700 !important;\r
  display: block !important;\r
}\r
.tcv-stat-num.tcv-blue  { color: #60a5fa !important; }\r
.tcv-stat-num.tcv-green { color: #4ade80 !important; }\r
.tcv-stat-num.tcv-red   { color: #f87171 !important; }\r
\r
.tcv-stat-label {\r
  font-size: 10px !important;\r
  color: #64748b !important;\r
  text-transform: uppercase !important;\r
  letter-spacing: 0.06em !important;\r
}\r
\r
.tcv-btn {\r
  width: 100% !important;\r
  padding: 13px 16px !important;\r
  border: none !important;\r
  border-radius: 10px !important;\r
  font-size: 15px !important;\r
  font-weight: 600 !important;\r
  cursor: pointer !important;\r
  margin-bottom: 8px !important;\r
  transition: opacity 0.2s !important;\r
}\r
.tcv-btn:disabled { opacity: 0.45 !important; cursor: not-allowed !important; }\r
\r
.tcv-btn-start {\r
  background: linear-gradient(135deg, #4f7fff, #7c3aed) !important;\r
  color: #fff !important;\r
}\r
.tcv-btn-start:hover:not(:disabled) { opacity: 0.88 !important; }\r
\r
.tcv-btn-stop {\r
  background: rgba(239,68,68,0.18) !important;\r
  color: #f87171 !important;\r
  border: 1px solid rgba(239,68,68,0.35) !important;\r
}\r
.tcv-btn-stop:hover { background: rgba(239,68,68,0.28) !important; }\r
\r
.tcv-btn-outline {\r
  background: rgba(255,255,255,0.04) !important;\r
  color: #eaf1ff !important;\r
  border: 1px solid rgba(255,255,255,0.18) !important;\r
}\r
.tcv-btn-outline:hover { background: rgba(255,255,255,0.09) !important; }\r
\r
.tcv-divider {\r
  display: flex !important;\r
  align-items: center !important;\r
  gap: 10px !important;\r
  margin: 14px 0 !important;\r
  color: #64748b !important;\r
  font-size: 11px !important;\r
  text-transform: uppercase !important;\r
  letter-spacing: 0.06em !important;\r
}\r
.tcv-divider::before, .tcv-divider::after {\r
  content: '' !important;\r
  flex: 1 !important;\r
  height: 1px !important;\r
  background: rgba(255,255,255,0.08) !important;\r
}\r
\r
.tcv-login-links {\r
  display: flex !important;\r
  justify-content: space-between !important;\r
  margin-top: 10px !important;\r
  gap: 10px !important;\r
}\r
.tcv-login-links .tcv-link { font-size: 13px !important; }\r
\r
.tcv-status-text {\r
  font-size: 13px !important;\r
  color: #64748b !important;\r
  text-align: center !important;\r
  margin: 6px 0 10px !important;\r
  min-height: 18px !important;\r
}\r
.tcv-status-text.tcv-ok    { color: #86efac !important; }\r
.tcv-status-text.tcv-error { color: #fca5a5 !important; }\r
\r
.tcv-loading-anim {\r
  display: flex !important;\r
  align-items: center !important;\r
  justify-content: center !important;\r
  padding: 28px 0 4px !important;\r
}\r
.tcv-loading-anim svg,\r
.tcv-loading-anim img {\r
  width: 84px !important;\r
  height: 84px !important;\r
  display: block !important;\r
}\r
\r
.tcv-loading-label {\r
  text-align: center !important;\r
  font-size: 13px !important;\r
  font-weight: 600 !important;\r
  color: #4ade80 !important;\r
  padding-bottom: 24px !important;\r
}\r
\r
.tcv-progress-wrap {\r
  display: none !important;\r
  align-items: center !important;\r
  justify-content: center !important;\r
  margin: 14px 0 4px !important;\r
}\r
.tcv-progress-wrap.tcv-visible {\r
  display: flex !important;\r
}\r
\r
.tcv-progress-circle {\r
  position: relative !important;\r
  width: 88px !important;\r
  height: 88px !important;\r
}\r
\r
.tcv-progress-ring {\r
  transform: rotate(-90deg) !important;\r
}\r
\r
.tcv-progress-track {\r
  fill: none !important;\r
  stroke: rgba(255,255,255,0.08) !important;\r
  stroke-width: 6 !important;\r
}\r
\r
.tcv-progress-bar {\r
  fill: none !important;\r
  stroke: url(#tcvProgressGradient) !important;\r
  stroke-width: 6 !important;\r
  stroke-linecap: round !important;\r
}\r
\r
.tcv-progress-pct {\r
  position: absolute !important;\r
  inset: 0 !important;\r
  display: flex !important;\r
  align-items: center !important;\r
  justify-content: center !important;\r
  font-size: 18px !important;\r
  font-weight: 700 !important;\r
  color: #eaf1ff !important;\r
  transition: opacity 0.25s ease !important;\r
}\r
.tcv-success-tick {\r
  display: none !important;\r
  align-items: center !important;\r
  justify-content: center !important;\r
  width: 100% !important;\r
  height: 170px !important;\r
}\r
.tcv-success-tick.tcv-visible {\r
  display: flex !important;\r
}\r
.tcv-success-tick svg,\r
.tcv-success-tick img {\r
  width: 170px !important;\r
  height: 170px !important;\r
  display: block !important;\r
}\r
\r
.tcv-score-card {\r
  display: none !important;\r
  align-items: center !important;\r
  justify-content: center !important;\r
  gap: 16px !important;\r
  padding: 16px 12px !important;\r
  margin: 4px 0 !important;\r
  border-radius: 12px !important;\r
  background: linear-gradient(160deg, rgba(79,127,255,0.12), rgba(74,222,128,0.12)) !important;\r
  border: 1px solid rgba(74,222,128,0.3) !important;\r
}\r
.tcv-score-card.tcv-visible {\r
  display: flex !important;\r
}\r
\r
/* Skills the job asked for that the resume evidences nowhere. Deliberately\r
   quieter than the score card next to it: this is information, not a result. */\r
.tcv-skill-gaps {\r
  padding: 12px !important;\r
  margin: 4px 0 !important;\r
  border-radius: 12px !important;\r
  background: rgba(255,255,255,0.03) !important;\r
  border: 1px solid rgba(148,163,184,0.18) !important;\r
}\r
.tcv-skill-gaps-title {\r
  font-size: 11px !important;\r
  font-weight: 700 !important;\r
  letter-spacing: .04em !important;\r
  text-transform: uppercase !important;\r
  color: #94a3b8 !important;\r
  margin-bottom: 8px !important;\r
}\r
.tcv-skill-gaps-pills {\r
  display: flex !important;\r
  flex-wrap: wrap !important;\r
  gap: 6px !important;\r
}\r
.tcv-skill-gap-pill {\r
  display: inline-block !important;\r
  padding: 3px 9px !important;\r
  border-radius: 999px !important;\r
  font-size: 11px !important;\r
  font-weight: 600 !important;\r
  color: #cbd5e1 !important;\r
  background: rgba(79,127,255,0.14) !important;\r
  border: 1px solid rgba(79,127,255,0.28) !important;\r
}\r
.tcv-skill-gap-pill.added {\r
  color: #6ee7b7 !important;\r
  background: rgba(16,185,129,0.16) !important;\r
  border: 1px solid rgba(16,185,129,0.35) !important;\r
}\r
.tcv-skill-gaps-note {\r
  margin-top: 8px !important;\r
  font-size: 10.5px !important;\r
  line-height: 1.45 !important;\r
  color: #7e8ba3 !important;\r
}\r
.tcv-skill-gaps-note.tcv-error { color: #fca5a5 !important; }\r
\r
/* Post-tailor skills pop-up: the download waits on this, so it is the loudest\r
   thing in the panel while it is up. */\r
.tcv-skill-prompt {\r
  padding: 14px !important;\r
  margin: 6px 0 !important;\r
  border-radius: 12px !important;\r
  background: rgba(79,127,255,0.08) !important;\r
  border: 1px solid rgba(79,127,255,0.35) !important;\r
}\r
.tcv-skill-prompt-title {\r
  font-size: 13px !important;\r
  font-weight: 700 !important;\r
  line-height: 1.35 !important;\r
  color: #eaf1ff !important;\r
}\r
.tcv-skill-prompt-sub {\r
  margin: 4px 0 10px !important;\r
  font-size: 11.5px !important;\r
  line-height: 1.45 !important;\r
  color: #a5b4cf !important;\r
}\r
.tcv-skill-prompt-pills {\r
  display: flex !important;\r
  flex-wrap: wrap !important;\r
  gap: 6px !important;\r
  margin-bottom: 12px !important;\r
}\r
.tcv-skill-prompt-pill {\r
  padding: 4px 10px !important;\r
  border-radius: 999px !important;\r
  font-size: 11.5px !important;\r
  font-weight: 600 !important;\r
  cursor: pointer !important;\r
  color: #cbd5e1 !important;\r
  background: rgba(255,255,255,0.04) !important;\r
  border: 1px solid rgba(148,163,184,0.35) !important;\r
}\r
.tcv-skill-prompt-pill[aria-pressed="true"] {\r
  color: #6ee7b7 !important;\r
  background: rgba(16,185,129,0.16) !important;\r
  border-color: rgba(16,185,129,0.5) !important;\r
}\r
.tcv-skill-prompt-pill[aria-pressed="true"]::before { content: "\u2713 " !important; }\r
.tcv-skill-prompt-actions {\r
  display: flex !important;\r
  flex-direction: column !important;\r
  gap: 6px !important;\r
}\r
.tcv-skill-btn {\r
  width: 100% !important;\r
  padding: 8px 10px !important;\r
  border-radius: 8px !important;\r
  font-size: 12.5px !important;\r
  font-weight: 600 !important;\r
  cursor: pointer !important;\r
  color: #eaf1ff !important;\r
  background: rgba(255,255,255,0.06) !important;\r
  border: 1px solid rgba(255,255,255,0.16) !important;\r
}\r
.tcv-skill-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12) !important; }\r
.tcv-skill-btn-primary {\r
  background: linear-gradient(135deg, #4f7fff, #7c3aed) !important;\r
  border-color: transparent !important;\r
}\r
.tcv-skill-btn-primary:hover:not(:disabled) { opacity: 0.9 !important; background: linear-gradient(135deg, #4f7fff, #7c3aed) !important; }\r
.tcv-skill-btn:disabled { opacity: 0.5 !important; cursor: not-allowed !important; }\r
.tcv-skill-notnow {\r
  display: block !important;\r
  margin: 8px auto 0 !important;\r
  background: none !important;\r
  border: none !important;\r
  font-size: 11px !important;\r
  color: #8da3c6 !important;\r
  text-decoration: underline !important;\r
  cursor: pointer !important;\r
}\r
.tcv-skill-notnow:disabled { opacity: 0.5 !important; cursor: not-allowed !important; }\r
\r
/* Account-menu switch for "Add missing skills automatically". */\r
.tcv-account-switch {\r
  display: flex !important;\r
  align-items: center !important;\r
  justify-content: space-between !important;\r
  gap: 8px !important;\r
  line-height: 1.3 !important;\r
}\r
.tcv-account-switch input {\r
  position: absolute !important;\r
  opacity: 0 !important;\r
  width: 0 !important;\r
  height: 0 !important;\r
}\r
.tcv-switch-track {\r
  position: relative !important;\r
  flex: 0 0 30px !important;\r
  width: 30px !important;\r
  height: 17px !important;\r
  border-radius: 999px !important;\r
  background: rgba(255,255,255,0.18) !important;\r
  transition: background .15s !important;\r
}\r
.tcv-switch-track::after {\r
  content: "" !important;\r
  position: absolute !important;\r
  top: 2px !important;\r
  left: 2px !important;\r
  width: 13px !important;\r
  height: 13px !important;\r
  border-radius: 50% !important;\r
  background: #fff !important;\r
  transition: transform .15s !important;\r
}\r
.tcv-account-switch input:checked + .tcv-switch-track { background: #10b981 !important; }\r
.tcv-account-switch input:checked + .tcv-switch-track::after { transform: translateX(13px) !important; }\r
.tcv-account-switch input:disabled + .tcv-switch-track { opacity: 0.5 !important; }\r
\r
.tcv-changes-panel {\r
  padding: 0 !important;\r
  margin: 4px 0 !important;\r
  border-radius: 12px !important;\r
  background: rgba(255,255,255,0.03) !important;\r
  border: 1px solid rgba(148,163,184,0.18) !important;\r
  overflow: hidden !important;\r
}\r
.tcv-changes-toggle {\r
  display: flex !important;\r
  align-items: center !important;\r
  justify-content: space-between !important;\r
  width: 100% !important;\r
  padding: 12px !important;\r
  background: none !important;\r
  border: none !important;\r
  cursor: pointer !important;\r
  font-size: 11px !important;\r
  font-weight: 700 !important;\r
  letter-spacing: .04em !important;\r
  text-transform: uppercase !important;\r
  color: #94a3b8 !important;\r
}\r
.tcv-changes-toggle .tcv-changes-chevron {\r
  transition: transform 0.2s ease !important;\r
  font-size: 10px !important;\r
}\r
.tcv-changes-panel.tcv-changes-open .tcv-changes-chevron {\r
  transform: rotate(180deg) !important;\r
}\r
.tcv-changes-body {\r
  display: none !important;\r
  padding: 0 12px 12px !important;\r
}\r
.tcv-changes-panel.tcv-changes-open .tcv-changes-body {\r
  display: block !important;\r
}\r
.tcv-changes-entry-label {\r
  font-size: 10.5px !important;\r
  font-weight: 700 !important;\r
  color: #cbd5e1 !important;\r
  margin: 8px 0 4px !important;\r
}\r
.tcv-changes-bullet {\r
  font-size: 10.5px !important;\r
  line-height: 1.5 !important;\r
  margin: 6px 0 !important;\r
}\r
.tcv-changes-before {\r
  color: #7e8ba3 !important;\r
  text-decoration: line-through !important;\r
}\r
.tcv-changes-after {\r
  color: #e2e8f0 !important;\r
  margin-top: 2px !important;\r
}\r
.tcv-changes-tag {\r
  display: inline-block !important;\r
  font-size: 9px !important;\r
  font-weight: 700 !important;\r
  letter-spacing: .03em !important;\r
  text-transform: uppercase !important;\r
  padding: 1px 6px !important;\r
  border-radius: 5px !important;\r
  margin-right: 5px !important;\r
  background: rgba(79,127,255,0.18) !important;\r
  color: #93b4ff !important;\r
}\r
.tcv-changes-empty {\r
  font-size: 10.5px !important;\r
  color: #7e8ba3 !important;\r
}\r
\r
.tcv-score-item {\r
  display: flex !important;\r
  flex-direction: column !important;\r
  align-items: center !important;\r
  gap: 2px !important;\r
}\r
\r
.tcv-score-num {\r
  font-size: 26px !important;\r
  font-weight: 800 !important;\r
  color: #cbd5e1 !important;\r
  line-height: 1 !important;\r
}\r
.tcv-score-num.tcv-score-after {\r
  color: #4ade80 !important;\r
}\r
\r
.tcv-score-label {\r
  font-size: 10px !important;\r
  font-weight: 600 !important;\r
  color: #64748b !important;\r
  text-transform: uppercase !important;\r
  letter-spacing: 0.05em !important;\r
}\r
\r
.tcv-score-arrow {\r
  font-size: 20px !important;\r
  color: #4f7fff !important;\r
  font-weight: 700 !important;\r
}\r
\r
.tcv-log {\r
  max-height: 220px !important;\r
  overflow-y: auto !important;\r
  border-top: 1px solid rgba(255,255,255,0.07) !important;\r
  padding-top: 10px !important;\r
  scrollbar-width: thin !important;\r
  scrollbar-color: rgba(255,255,255,0.1) transparent !important;\r
}\r
\r
.tcv-log-item {\r
  font-size: 12px !important;\r
  padding: 4px 0 !important;\r
  border-bottom: 1px solid rgba(255,255,255,0.04) !important;\r
  word-break: break-word !important;\r
}\r
.tcv-log-item.tcv-success { color: #86efac !important; }\r
.tcv-log-item.tcv-fail    { color: #fca5a5 !important; }\r
.tcv-log-item.tcv-info    { color: #94a3b8 !important; }\r
\r
.tcv-msg {\r
  font-size: 14px !important;\r
  line-height: 1.5 !important;\r
  color: #94a3b8 !important;\r
  margin-bottom: 14px !important;\r
}\r
\r
.tcv-empty-msg {\r
  font-size: 17px !important;\r
  font-weight: 600 !important;\r
  color: #ffffff !important;\r
  text-align: center !important;\r
}\r
\r
/* Empty base-resume state: a document that shakes to grab attention, then\r
   settles while its "?" badge pulses, on an endless 3.2s loop. */\r
.tcv-empty-state {\r
  display: flex !important;\r
  justify-content: center !important;\r
  padding: 10px 0 6px !important;\r
}\r
\r
.tcv-doc-wrap {\r
  display: inline-block !important;\r
  transform-origin: 50% 60% !important;\r
  animation: tcvDocCycle 3.2s ease-in-out infinite !important;\r
}\r
\r
.tcv-doc-badge {\r
  animation: tcvBadgeCycle 3.2s ease-in-out infinite !important;\r
}\r
\r
@keyframes tcvDocCycle {\r
  0%     { transform: rotate(0deg) translateY(0px); }\r
  2.8%   { transform: rotate(-6deg) translateY(-3px); }\r
  5.6%   { transform: rotate(5deg) translateY(-5px); }\r
  8.4%   { transform: rotate(-4deg) translateY(-3px); }\r
  11.25% { transform: rotate(3deg) translateY(-1px); }\r
  14.1%  { transform: rotate(-2deg) translateY(0px); }\r
  18.75% { transform: rotate(0deg) translateY(0px); }\r
  43.75% { transform: rotate(0deg) translateY(0px); }\r
  71.9%  { transform: rotate(0deg) translateY(-6px); }\r
  100%   { transform: rotate(0deg) translateY(0px); }\r
}\r
\r
@keyframes tcvBadgeCycle {\r
  0%     { transform: scale(1); opacity: 1; }\r
  18.75% { transform: scale(1); opacity: 1; }\r
  28.75% { transform: scale(1.18); opacity: 0.85; }\r
  36.25% { transform: scale(0.94); opacity: 1; }\r
  43.75% { transform: scale(1); opacity: 1; }\r
  100%   { transform: scale(1); opacity: 1; }\r
}\r
\r
.tcv-field-label {\r
  display: block !important;\r
  font-size: 11px !important;\r
  font-weight: 600 !important;\r
  color: #8da3c6 !important;\r
  text-transform: uppercase !important;\r
  letter-spacing: 0.04em !important;\r
  margin: 0 0 5px !important;\r
}\r
\r
.tcv-input {\r
  width: 100% !important;\r
  background: rgba(255,255,255,0.06) !important;\r
  border: 1px solid rgba(255,255,255,0.12) !important;\r
  color: #f1f5f9 !important;\r
  border-radius: 8px !important;\r
  padding: 11px 13px !important;\r
  font-size: 14px !important;\r
  margin-bottom: 10px !important;\r
}\r
.tcv-input:focus { outline: none !important; border-color: #4f7fff !important; }\r
\r
.tcv-error {\r
  font-size: 12px !important;\r
  color: #f87171 !important;\r
  min-height: 15px !important;\r
  margin-top: 6px !important;\r
}\r
\r
.tcv-link {\r
  display: inline-block !important;\r
  color: #93c5fd !important;\r
  text-decoration: underline !important;\r
  font-size: 13px !important;\r
  cursor: pointer !important;\r
}\r
\r
.tcv-job-info {\r
  font-size: 19px !important;\r
  color: #94a3b8 !important;\r
  margin-bottom: 14px !important;\r
  line-height: 1.4 !important;\r
}\r
.tcv-job-info b {\r
  color: #eaf1ff !important;\r
}\r
\r
/* \u2500\u2500 Skill match: a meter, not a line of text \u2500\u2500\r
   The bar's colour carries the verdict so the number doesn't have to. This is the\r
   before-tailor browsing signal; the animated success tick + score card handle the\r
   after-tailor moment. */\r
.tcv-match {\r
  padding: 12px 14px !important;\r
  margin-bottom: 14px !important;\r
  border-radius: 12px !important;\r
  background: rgba(255,255,255,0.04) !important;\r
  border: 1px solid rgba(255,255,255,0.07) !important;\r
}\r
.tcv-match-head {\r
  display: flex !important;\r
  align-items: baseline !important;\r
  justify-content: space-between !important;\r
  margin-bottom: 9px !important;\r
}\r
.tcv-match-label {\r
  font-size: 10px !important;\r
  font-weight: 600 !important;\r
  text-transform: uppercase !important;\r
  letter-spacing: 0.09em !important;\r
  color: #7c8aa5 !important;\r
}\r
.tcv-match-value {\r
  font-size: 20px !important;\r
  font-weight: 750 !important;\r
  color: #eaf1ff !important;\r
  font-variant-numeric: tabular-nums !important;\r
  line-height: 1 !important;\r
}\r
.tcv-match-bar {\r
  position: relative !important;\r
  height: 6px !important;\r
  border-radius: 99px !important;\r
  background: rgba(255,255,255,0.08) !important;\r
  overflow: hidden !important;\r
}\r
.tcv-match-fill {\r
  display: block !important;\r
  height: 100% !important;\r
  width: 0;   /* not !important \u2014 paintMatch() sets the real width via inline style */\r
  border-radius: 99px !important;\r
  background: linear-gradient(90deg, #4f7fff, #c9b8ff) !important;\r
  transition: width 0.7s cubic-bezier(.22,.61,.36,1), background 0.4s ease !important;\r
}\r
.tcv-match.tcv-low  .tcv-match-fill  { background: linear-gradient(90deg, #f87171, #fb923c) !important; }\r
.tcv-match.tcv-mid  .tcv-match-fill  { background: linear-gradient(90deg, #fbbf24, #facc15) !important; }\r
.tcv-match.tcv-high .tcv-match-fill  { background: linear-gradient(90deg, #34d399, #4ade80) !important; }\r
.tcv-match.tcv-low  .tcv-match-value { color: #fca5a5 !important; }\r
.tcv-match.tcv-mid  .tcv-match-value { color: #fcd34d !important; }\r
.tcv-match.tcv-high .tcv-match-value { color: #86efac !important; }\r
/* No named skills in the JD \u2014 nothing to score, so explain rather than show a blank bar. */\r
.tcv-match.tcv-na .tcv-match-value { font-size: 15px !important; color: #94a3b8 !important; }\r
.tcv-match-note {\r
  font-size: 11px !important;\r
  line-height: 1.45 !important;\r
  color: #8a93a6 !important;\r
}\r
\r
.tcv-upgrade-box {\r
  text-align: center !important;\r
  padding: 18px 14px !important;\r
  border-radius: 12px !important;\r
  background: linear-gradient(160deg, rgba(79,127,255,0.14), rgba(124,58,237,0.14)) !important;\r
  border: 1px solid rgba(79,127,255,0.35) !important;\r
}\r
.tcv-upgrade-box .tcv-msg { margin-bottom: 14px !important; }\r
\r
.tcv-btn-link {\r
  display: block !important;\r
  text-align: center !important;\r
  text-decoration: none !important;\r
  box-sizing: border-box !important;\r
}\r
\r
.tcv-retry-link {\r
  display: block !important;\r
  text-align: center !important;\r
  margin-top: 12px !important;\r
  font-size: 12px !important;\r
}\r
\r
/* Where the job description came from, and the way back out of a bad guess. */\r
.tcv-source {\r
  font-size: 10px !important;\r
  color: #64748b !important;\r
  margin: -4px 0 10px !important;\r
}\r
.tcv-source a {\r
  color: #93c5fd !important;\r
  text-decoration: underline !important;\r
  cursor: pointer !important;\r
}\r
\r
/* Manual fallback: the user hands us the job description themselves. */\r
.tcv-textarea {\r
  width: 100% !important;\r
  background: rgba(255,255,255,0.06) !important;\r
  border: 1px solid rgba(255,255,255,0.12) !important;\r
  color: #f1f5f9 !important;\r
  border-radius: 6px !important;\r
  padding: 8px 10px !important;\r
  font-size: 12px !important;\r
  line-height: 1.45 !important;\r
  font-family: inherit !important;\r
  resize: vertical !important;\r
  margin-bottom: 8px !important;\r
  box-sizing: border-box !important;\r
}\r
.tcv-textarea:focus { outline: none !important; border-color: #4f7fff !important; }\r
\r
.tcv-btn-ghost {\r
  background: rgba(255,255,255,0.06) !important;\r
  color: #cbd5e1 !important;\r
  border: 1px solid rgba(255,255,255,0.14) !important;\r
}\r
.tcv-btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,0.11) !important; }\r
`;

  // src/styles.js
  window.__tcvSidebarCss = sidebar_default;
})();
