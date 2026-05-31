// Switch to 'https://thetailorcv.com' for production
const BASE = 'http://127.0.0.1:8005';

async function checkLogin() {
  const statusEl   = document.getElementById('status');
  const userInfoEl = document.getElementById('user-info');
  const loginLink  = document.getElementById('login-link');

  try {
    const res = await fetch(`${BASE}/api/extension/profile`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      statusEl.className = 'status ok';
      statusEl.textContent = '✓ Connected to TailorCV';
      userInfoEl.style.display = 'block';
      userInfoEl.textContent = `${data.name}  ·  ${data.email}`;
    } else {
      statusEl.className = 'status error';
      statusEl.textContent = '✗ Not logged in to TailorCV';
      loginLink.style.display = 'block';
      loginLink.href = `${BASE}/login`;
    }
  } catch {
    statusEl.className = 'status error';
    statusEl.textContent = '✗ Cannot reach TailorCV server';
    loginLink.style.display = 'block';
    loginLink.href = `${BASE}/login`;
  }
}

checkLogin();
