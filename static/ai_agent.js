/* ── Site-wide AI assistant "Tailor" ──────────────────────────────────────────
   Floating orb → chat panel. On first open it greets with a short, page-aware
   feature description (spoken, since the open click is a real gesture) and,
   for guests, nudges signup. Chat posts to /api/agent/chat. Voice via /api/tts.
   Namespaced tcv-agent-* / _tcvA* so nothing collides with page code. */
(function () {
  if (window.__tcvAgentInit) return;
  window.__tcvAgentInit = true;

  var root = document.getElementById('tcv-agent');
  if (!root) return;

  var isLoggedIn = root.getAttribute('data-logged-in') === 'true';
  var path = (location.pathname || '/').replace(/\/+$/, '') || '/';

  var orb    = root.querySelector('.tcv-agent-orb');
  var panel  = root.querySelector('.tcv-agent-panel');
  var msgsEl = root.querySelector('.tcv-agent-msgs');
  var input  = root.querySelector('.tcv-agent-input');
  var sendBtn= root.querySelector('.tcv-agent-send');
  var closeBtn = root.querySelector('.tcv-agent-close-btn');
  var voiceBtn = root.querySelector('.tcv-agent-voice-btn');

  var history = [];         // {role, content} rolling context
  var greeted = false;
  var busy = false;
  var voiceOn = true;
  var audioUnlocked = false;

  function csrf() {
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  // Page-aware opening line. Feature pages get a specific description; everything
  // else gets a friendly generic hello.
  var GREETINGS = {
    '/solutions':      "Hi! This is the ATS Score checker — drop in your resume and a job description, and I'll show how well they match and exactly what's missing.",
    '/optimize':       "Hi! This is AI Optimize — I rewrite your resume to match a specific job so it sails through ATS filters.",
    '/modify-cv':      "Hi! This is the Resume Builder — fill in guided sections, pick a template, and preview your resume live before you download it.",
    '/cover-letter':   "Hi! This is the AI Cover Letter generator — give me your resume and a job description and I'll write a tailored cover letter in seconds.",
    '/portfolio':      "Hi! This is the Portfolio Website builder — turn your resume into a live, shareable portfolio site with no coding.",
    '/templates':      "Hi! These are our resume templates — all clean, ATS-safe, and ready to use.",
    '/interview-prep': "Hi! This is Interview Prep — I generate the questions you're most likely to be asked, based on your resume and target role.",
    '/mock-interview': "Hi! This is the AI Mock Interview — practice with Zara, who asks about YOUR projects and gives real feedback.",
    '/extension':      "Hi! This is our Chrome Extension — tailor your resume and check your ATS score right on any job posting.",
    '/my-resumes':     "Hi! This is your resume library — every resume you optimize is saved here with its ATS score, ready to re-download.",
    '/pricing':        "Hi! Here's our pricing — you can start free, and Pro unlocks unlimited tailoring."
  };

  function greeting() {
    var base = GREETINGS[path] || "Hi, I'm Tailor — your AI assistant. Ask me anything about your resume, cover letter, interviews, or how theTailorCV can help.";
    if (!isLoggedIn) {
      base += " Create a free account and I can save your work and unlock all the tools.";
    }
    return base;
  }

  function esc(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  // Turn plain text into clickable links: full URLs, emails, our own
  // multi-segment /paths (e.g. /blog/some-slug), and bare social domains.
  function fmt(s) {
    var out = esc(s);
    // Full http(s) URLs → new tab
    out = out.replace(/(https?:\/\/[^\s<)]+)/g,
      '<a href="$1" target="_blank" rel="noopener">$1</a>');
    // Emails → mailto
    out = out.replace(/([a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,})/gi,
      '<a href="mailto:$1">$1</a>');
    // Bare social/company domains → new tab
    out = out.replace(/(^|[\s(])((?:www\.)?(?:linkedin\.com|x\.com|twitter\.com|instagram\.com|youtube\.com)\/[a-z0-9._\-\/]+)/gi,
      '$1<a href="https://$2" target="_blank" rel="noopener">$2</a>');
    // Internal multi-segment paths (/solutions, /blog/some-slug) → same tab
    out = out.replace(/(^|[\s(])(\/[a-z0-9\-]+(?:\/[a-z0-9\-]+)*)/g,
      '$1<a href="$2">$2</a>');
    return out;
  }

  function addMsg(role, text) {
    var el = document.createElement('div');
    el.className = 'tcv-agent-msg ' + (role === 'user' ? 'user' : 'bot');
    el.innerHTML = fmt(text);
    msgsEl.appendChild(el);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return el;
  }

  function addSignupCta() {
    if (isLoggedIn) return;
    var a = document.createElement('a');
    a.className = 'tcv-agent-cta';
    a.href = '/signup?next=' + encodeURIComponent(location.pathname);
    a.textContent = 'Create free account →';
    msgsEl.appendChild(a);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function showTyping() {
    var t = document.createElement('div');
    t.className = 'tcv-agent-typing';
    t.innerHTML = '<i></i><i></i><i></i>';
    msgsEl.appendChild(t);
    msgsEl.scrollTop = msgsEl.scrollHeight;
    return t;
  }

  // ── Voice ──────────────────────────────────────────────────────────────────
  var SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
  function unlockAudio() {
    if (audioUnlocked) return;
    audioUnlocked = true;
    try { var a = new Audio(SILENT); a.volume = 0; a.play().catch(function(){}); } catch (e) {}
  }
  function speak(text) {
    if (!voiceOn) return;
    fetch('/api/tts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
      body: JSON.stringify({ text: text.slice(0, 600) })
    })
      .then(function (r) { return r.ok ? r.blob() : Promise.reject(); })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = new Audio(url);
        a.onended = function () { URL.revokeObjectURL(url); };
        a.play().catch(function () { URL.revokeObjectURL(url); });
      })
      .catch(function () { /* voice is best-effort */ });
  }

  // ── Chat ────────────────────────────────────────────────────────────────────
  function send(text) {
    if (busy) return;
    text = (text || '').trim();
    if (!text) return;
    busy = true; sendBtn.disabled = true;
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    input.value = ''; autoGrow();
    var typing = showTyping();

    fetch('/api/agent/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
      body: JSON.stringify({ message: text, history: history.slice(-8), page: path })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        typing.remove();
        var reply = (res.d && res.d.reply) || "Sorry, something went wrong — please try again.";
        addMsg('bot', reply);
        history.push({ role: 'assistant', content: reply });
        if (res.d && res.d.signup) addSignupCta();
        speak(reply);
      })
      .catch(function () {
        typing.remove();
        addMsg('bot', "I'm having trouble connecting right now. Please try again in a moment.");
      })
      .finally(function () { busy = false; sendBtn.disabled = false; input.focus(); });
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  }

  // ── Open / close ─────────────────────────────────────────────────────────────
  function open() {
    root.setAttribute('data-open', 'true');
    root.setAttribute('data-seen', 'true');
    unlockAudio();
    if (!greeted) {
      greeted = true;
      var g = greeting();
      addMsg('bot', g);
      history.push({ role: 'assistant', content: g });
      addSignupCta();
      speak(g);
    }
    setTimeout(function () { input.focus(); }, 250);
  }
  function close() { root.setAttribute('data-open', 'false'); }
  function toggle() { root.getAttribute('data-open') === 'true' ? close() : open(); }

  orb.addEventListener('click', toggle);
  if (closeBtn) closeBtn.addEventListener('click', close);
  sendBtn.addEventListener('click', function () { send(input.value); });
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  if (voiceBtn) {
    voiceBtn.addEventListener('click', function () {
      voiceOn = !voiceOn;
      voiceBtn.classList.toggle('is-off', !voiceOn);
      voiceBtn.setAttribute('aria-label', voiceOn ? 'Mute voice' : 'Unmute voice');
    });
  }
})();
