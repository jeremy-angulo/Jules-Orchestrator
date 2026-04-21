const form = document.querySelector('#authForm');
const submitBtn = document.querySelector('#submitBtn');
const feedback = document.querySelector('#feedback');
const modeLabel = document.querySelector('#modeLabel');

const emailInput = document.querySelector('#email');
const passwordInput = document.querySelector('#password');
const mfaCodeInput = document.querySelector('#mfaCode');

function isSetupMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get('setup') === '1';
}

async function getMe() {
  const res = await fetch('/auth/me', { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) {
    return { authenticated: false, setupDone: true };
  }
  return res.json();
}

async function submitAuth(payload, setupMode) {
  const endpoint = setupMode ? '/auth/bootstrap-admin' : '/auth/login';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || 'Echec d\'authentification');
  }
  return json;
}

async function initMode() {
  const me = await getMe();
  if (me.authenticated) {
    window.location.replace('/dashboard');
    return;
  }

  const setupMode = isSetupMode() || me.setupDone === false;
  submitBtn.textContent = setupMode ? 'Creer le compte admin' : 'Se connecter';
  modeLabel.textContent = setupMode
    ? 'Aucun utilisateur detecte. Cree le premier compte admin.'
    : 'Connecte-toi avec ton compte.';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    feedback.textContent = '';
    submitBtn.disabled = true;

    try {
      await submitAuth(
        {
          email: emailInput.value.trim(),
          password: passwordInput.value,
          mfaCode: mfaCodeInput.value.trim()
        },
        setupMode
      );
      window.location.replace('/dashboard');
    } catch (error) {
      feedback.textContent = error.message;
      submitBtn.disabled = false;
    }
  });
}

initMode();
