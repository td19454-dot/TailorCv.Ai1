// Switch to 'https://thetailorcv.com' for production
const BASE = 'http://127.0.0.1:8005';

function sendMessage(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, res => resolve(res || {})));
}

async function checkBaseResume() {
  const el = document.getElementById('base-resume-status');
  const res = await sendMessage({ type: 'GET_BASE_RESUME' });
  if (res.error || !res.data) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  if (res.data.has_base_resume) {
    el.className = 'base-status ok';
    el.textContent = `✓ Base resume: ${res.data.filename} · Template ${res.data.template_id}`;
  } else {
    el.className = 'base-status unset';
    el.innerHTML = `No base resume set. <a href="${BASE}/my-resumes" target="_blank" style="color:inherit;">Set one up →</a>`;
  }
}

async function checkLogin() {
  const statusEl     = document.getElementById('status');
  const userInfoEl   = document.getElementById('user-info');
  const loginFormEl  = document.getElementById('login-form');
  const baseStatusEl = document.getElementById('base-resume-status');

  try {
    const res = await fetch(`${BASE}/api/extension/profile`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      statusEl.className = 'status ok';
      statusEl.textContent = '✓ Connected to TailorCV';
      userInfoEl.style.display = 'block';
      userInfoEl.textContent = `${data.name}  ·  ${data.email}`;
      loginFormEl.style.display = 'none';
      await checkBaseResume();
    } else {
      statusEl.className = 'status error';
      statusEl.textContent = '✗ Not logged in to TailorCV';
      userInfoEl.style.display = 'none';
      baseStatusEl.style.display = 'none';
      loginFormEl.style.display = 'flex';
    }
  } catch {
    statusEl.className = 'status error';
    statusEl.textContent = '✗ Cannot reach TailorCV server';
    userInfoEl.style.display = 'none';
    baseStatusEl.style.display = 'none';
    loginFormEl.style.display = 'flex';
  }
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const submitBtn = document.getElementById('login-submit');
  const errorEl = document.getElementById('login-error');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Logging in…';
  errorEl.textContent = '';

  const res = await sendMessage({ type: 'LOGIN', email, password });

  submitBtn.disabled = false;
  submitBtn.textContent = 'Log in';

  if (res.error) {
    errorEl.textContent = res.error;
    return;
  }
  await checkLogin();
});

checkLogin();
