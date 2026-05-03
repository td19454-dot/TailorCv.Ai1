
    {% if google_client_id %}
    window.TAILORCV_GOOGLE_CLIENT_ID = '{{ google_client_id }}';
    {% endif %}

    let codeRequested = false;
    let codeRequestedForEmail = '';

    function apiErrorDetail(data) {
      const d = data && data.detail;
      if (typeof d === 'string') return d;
      if (Array.isArray(d) && d.length) {
        return d.map(function (e) { return (e && e.msg) ? e.msg : ''; }).filter(Boolean).join(' ') || 'Request failed';
      }
      return 'Request failed';
    }

    function validateSignupFields() {
      const name = document.getElementById('name').value.trim();
      const email = document.getElementById('email').value.trim();
      const password = document.getElementById('password').value;
      const nameError = document.getElementById('nameError');
      const emailError = document.getElementById('emailError');
      const passwordError = document.getElementById('passwordError');

      nameError.style.display = name.length >= 2 ? 'none' : 'block';
      emailError.style.display = email.includes('@') ? 'none' : 'block';
      passwordError.style.display = password.length >= 6 ? 'none' : 'block';

      return {
        name,
        email,
        password,
        valid: name.length >= 2 && email.includes('@') && password.length >= 6,
        invalidField: name.length < 2 ? 'name' : (email.includes('@') ? (password.length >= 6 ? '' : 'password') : 'email'),
      };
    }

    async function sendSignupCode() {
      const statusMessage = document.getElementById('statusMessage');
      const sendCodeBtn = document.getElementById('sendCodeBtn');
      const codeGroup = document.getElementById('codeGroup');
      const emailInput = document.getElementById('email');
      const email = emailInput.value.trim();
      const emailError = document.getElementById('emailError');

      emailError.style.display = email.includes('@') ? 'none' : 'block';
      if (!email.includes('@')) {
        statusMessage.textContent = 'Please enter a valid email address to receive the verification code.';
        statusMessage.className = 'status error';
        emailInput.focus();
        return;
      }

      statusMessage.className = 'status';
      statusMessage.style.display = 'none';
      sendCodeBtn.disabled = true;
      sendCodeBtn.textContent = 'Sending code...';

      try {
        const response = await fetch('/api/signup/request-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });

        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; }
        catch { data = { detail: raw || 'Unexpected server response' }; }

        if (!response.ok) throw new Error(apiErrorDetail(data) || 'Could not send verification code');

        codeRequested = true;
        codeRequestedForEmail = email.toLowerCase();
        codeGroup.style.display = 'block';
        statusMessage.textContent = data.message || 'Verification code sent. Check your email.';
        statusMessage.className = 'status success';
      } catch (error) {
        statusMessage.textContent = error.message;
        statusMessage.className = 'status error';
      } finally {
        sendCodeBtn.disabled = false;
        sendCodeBtn.textContent = codeRequested ? 'Resend Verification Code' : 'Send Verification Code';
      }
    }

    async function signup() {
      const { name, email, password, valid, invalidField } = validateSignupFields();
      const code = document.getElementById('signupCode').value.trim();
      const codeError = document.getElementById('codeError');
      const statusMessage = document.getElementById('statusMessage');
      const signupBtn = document.getElementById('signupBtn');

      if (!valid) {
        statusMessage.textContent = 'Please fix the highlighted fields before signing up.';
        statusMessage.className = 'status error';
        if (invalidField) {
          const firstInvalid = document.getElementById(invalidField);
          if (firstInvalid) firstInvalid.focus();
        }
        return;
      }

      if (!codeRequested) {
        statusMessage.textContent = 'Click "Send Verification Code" first.';
        statusMessage.className = 'status error';
        return;
      }

      if (codeRequestedForEmail && codeRequestedForEmail !== email.toLowerCase()) {
        statusMessage.textContent = 'Email changed after code request. Please request a new verification code.';
        statusMessage.className = 'status error';
        return;
      }

      codeError.style.display = code ? 'none' : 'block';
      if (!code) return;

      statusMessage.className = 'status';
      statusMessage.style.display = 'none';
      signupBtn.disabled = true;
      signupBtn.textContent = 'Verifying...';

      try {
        const response = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, password, code })
        });

        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; }
        catch { data = { detail: raw || 'Unexpected server response' }; }

        if (!response.ok) throw new Error(apiErrorDetail(data) || 'Signup failed');

        statusMessage.textContent = 'Account created successfully. Redirecting to login...';
        statusMessage.className = 'status success';
        setTimeout(() => { window.location.href = '/login'; }, 1400);
      } catch (error) {
        statusMessage.textContent = error.message;
        statusMessage.className = 'status error';
      } finally {
        signupBtn.disabled = false;
        signupBtn.textContent = 'Verify Email & Sign Up';
      }
    }

    function tailorCvInitGoogleSignUp() {
      if (!window.TAILORCV_GOOGLE_CLIENT_ID || !window.google?.accounts?.id) return;
      const mount = document.getElementById('google-signin-mount');
      const stack = document.getElementById('googleBtnStack');
      if (!mount || mount.dataset.rendered === '1') return;
      if (window.__tailorCvGsiInitOnce) return;

      try {
        window.__tailorCvGsiInitOnce = true;
        google.accounts.id.initialize({
          client_id: window.TAILORCV_GOOGLE_CLIENT_ID,
          callback: handleGoogleCredential,
          ux_mode: 'popup',
          auto_select: false,
        });

        const w = stack ? Math.min(Math.max(stack.offsetWidth, 280), 400) : 360;
        google.accounts.id.renderButton(mount, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'rectangular',
          text: 'continue_with',
          logo_alignment: 'left',
          width: w,
        });
        mount.dataset.rendered = '1';
      } catch (e) {
        window.__tailorCvGsiInitOnce = false;
      }
    }

    async function handleGoogleCredential(response) {
      const statusMessage = document.getElementById('statusMessage');
      statusMessage.textContent = 'Verifying Google account...';
      statusMessage.className = 'status success';

      try {
        const res = await fetch('/api/login/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: response.credential })
        });

        const raw = await res.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; }
        catch { data = { detail: raw || 'Unexpected server response' }; }

        if (!res.ok) throw new Error(apiErrorDetail(data) || 'Google signup failed');
        if (!data.user) throw new Error(data.message || 'Signup succeeded but user details were missing.');

        if (window.TailorCVAuth) window.TailorCVAuth.saveUser(data.user);

        statusMessage.textContent = `Welcome, ${data.user.name}! Redirecting...`;
        statusMessage.className = 'status success';
        setTimeout(() => { window.location.href = '/solutions'; }, 700);
      } catch (error) {
        statusMessage.textContent = error.message;
        statusMessage.className = 'status error';
      }
    }

    window.addEventListener('load', function () {
      tailorCvInitGoogleSignUp();
      const emailInput = document.getElementById('email');
      if (emailInput) {
        emailInput.addEventListener('input', function () {
          codeRequested = false;
          codeRequestedForEmail = '';
          const codeGroup = document.getElementById('codeGroup');
          if (codeGroup) codeGroup.style.display = 'none';
          const codeInput = document.getElementById('signupCode');
          if (codeInput) codeInput.value = '';
          const sendCodeBtn = document.getElementById('sendCodeBtn');
          if (sendCodeBtn) sendCodeBtn.textContent = 'Send Verification Code';
        });
      }
    });

    (function tailorCvPollGsi() {
      if (!window.TAILORCV_GOOGLE_CLIENT_ID || !document.getElementById('google-signin-mount')) return;
      var left = 200;
      var t = setInterval(function () {
        left--;
        if (window.google && window.google.accounts && window.google.accounts.id) {
          clearInterval(t);
          tailorCvInitGoogleSignUp();
        } else if (left <= 0) clearInterval(t);
      }, 75);
    })();
  
