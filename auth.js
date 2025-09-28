;(function authBootstrap() {
  const AUTH_USER_KEY = 'auth_user_v1';
  const POST_LOGIN_REDIRECT_KEY = 'post_login_redirect_v1';
  const LAST_MATERIAL_KEY = 'selected_material_v1';
  const OAUTH_NONCE_KEY = 'oauth_nonce_v1';

  // Configura estos valores cuando tengas las credenciales reales de Google
  window.GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || '44432976099-rhvil13l9qgtjfq3u4ivh6btt1o1nfgg.apps.googleusercontent.com';
  window.GOOGLE_REDIRECT_URI = window.GOOGLE_REDIRECT_URI || `${window.location.origin}/auth-callback.html`;

  function storeAuthUser(user) {
  try { sessionStorage.removeItem('cortes_theme_v1'); } catch (_) {}
  try { localStorage.removeItem('cortes_theme_v1'); } catch (_) {}
  try { localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user)); } catch (_) {}
  }

  function getAuthUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null');
  } catch (_) {
    return null;
  }
  }

  function clearAuthUser() {
  try {
    localStorage.removeItem(AUTH_USER_KEY);
  } catch (_) {}
  }

  function ensureAuthenticated() {
  const user = getAuthUser();
  if (!user) {
    try {
      localStorage.setItem(POST_LOGIN_REDIRECT_KEY, window.location.href);
    } catch (_) {}
    if (!window.location.pathname.endsWith('login.html')) {
      window.location.replace('login.html');
    }
    return null;
  }
  window.__authUser = user;
  return user;
  }

  function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const json = decodeURIComponent(decoded.split('').map(c => `%${('00' + c.charCodeAt(0).toString(16)).slice(-2)}`).join(''));
    return JSON.parse(json);
  } catch (_) {
    return null;
  }
  }

  function startGoogleOAuth(mode = 'signin') {
  if (!window.GOOGLE_CLIENT_ID) {
    alert('Configura tu GOOGLE_CLIENT_ID en auth.js antes de intentar iniciar sesión.');
    return;
  }
  const cryptoApi = (typeof window !== 'undefined' && window.crypto) ? window.crypto : null;
  const nonce = cryptoApi && typeof cryptoApi.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Date.now()}`;
  try {
    localStorage.setItem(OAUTH_NONCE_KEY, nonce);
  } catch (_) {}
  const state = btoa(JSON.stringify({ mode, ts: Date.now() }));
  const params = new URLSearchParams({
    client_id: window.GOOGLE_CLIENT_ID,
    redirect_uri: window.GOOGLE_REDIRECT_URI,
    response_type: 'token id_token',
    scope: 'openid email profile https://www.googleapis.com/auth/gmail.send',
    include_granted_scopes: 'true',
    prompt: 'select_account',
    state,
    nonce
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  function signOut() {
  clearAuthUser();
  try { localStorage.removeItem(LAST_MATERIAL_KEY); } catch (_) {}
  try { sessionStorage.removeItem('cortes_theme_v1'); } catch (_) {}
  try { localStorage.removeItem('cortes_theme_v1'); } catch (_) {}
  window.location.replace('login.html');
  }

  function applyLoginRedirect() {
  if (document.body.classList.contains('login-page')) {
    const user = getAuthUser();
    if (user) {
      const redirect = localStorage.getItem(POST_LOGIN_REDIRECT_KEY);
      if (redirect) {
        localStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
        window.location.replace(redirect);
      } else {
        window.location.replace('index.html');
      }
    }
  }
  }

  document.addEventListener('DOMContentLoaded', () => {
  applyLoginRedirect();
  document.querySelectorAll('[data-google-login]').forEach((btn) => {
    btn.addEventListener('click', () => {
      startGoogleOAuth(btn.dataset.mode || 'signin');
    });
  });
  document.querySelectorAll('[data-google-logout]').forEach((btn) => {
    btn.addEventListener('click', () => signOut());
  });
  });

  window.Auth = {
    storeAuthUser,
    getAuthUser,
    ensureAuthenticated,
    clearAuthUser,
    startGoogleOAuth,
    signOut,
    decodeJwt,
    OAUTH_NONCE_KEY
  };

  window.ensureAuthenticated = ensureAuthenticated;
  window.startGoogleOAuth = startGoogleOAuth;
})();
