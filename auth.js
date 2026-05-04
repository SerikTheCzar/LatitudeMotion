(function () {
  "use strict";

  const config = window.LATITUDE_AUTH_CONFIG;
  const tokenKey = "latitude.clinic.auth.tokens";
  const verifierKey = "latitude.clinic.auth.pkce.verifier";
  const stateKey = "latitude.clinic.auth.pkce.state";
  const returnToKey = "latitude.clinic.auth.returnTo";

  function base64Url(bytes) {
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomUrlString(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function sha256Url(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return base64Url(new Uint8Array(digest));
  }

  function redirectUri() {
    return `${window.location.origin}/`;
  }

  function tokenEndpoint() {
    return `${config.domain}/oauth2/token`;
  }

  function authorizeEndpoint() {
    return `${config.domain}/oauth2/authorize`;
  }

  function logoutEndpoint() {
    return `${config.domain}/logout`;
  }

  function parseJwt(token) {
    try {
      const [, payload] = token.split(".");
      const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
      return JSON.parse(atob(padded));
    } catch {
      return null;
    }
  }

  function getStoredTokens() {
    try {
      return JSON.parse(sessionStorage.getItem(tokenKey) || "null");
    } catch {
      return null;
    }
  }

  function storeTokens(tokens) {
    const claims = parseJwt(tokens.id_token);
    if (!claims?.exp) throw new Error("Cognito did not return a usable ID token.");
    sessionStorage.setItem(tokenKey, JSON.stringify({ ...tokens, claims, storedAt: Date.now() }));
    return { ...tokens, claims };
  }

  function clearTokens() {
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(verifierKey);
    sessionStorage.removeItem(stateKey);
    sessionStorage.removeItem(returnToKey);
  }

  async function serverSession() {
    if (["localhost", "127.0.0.1"].includes(window.location.hostname)) return null;
    const response = await fetch("/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).catch(() => null);
    if (!response?.ok) return null;
    const payload = await response.json();
    if (!payload?.authenticated || !payload?.user) return null;
    return {
      claims: {
        email: payload.user.email,
        name: payload.user.name,
        sub: payload.user.sub,
        "cognito:groups": payload.user.groups || [],
        exp: Math.floor(Date.now() / 1000) + 300,
      },
      serverManaged: true,
    };
  }

  function hasValidSession(tokens) {
    const expiresAt = Number(tokens?.claims?.exp || 0) * 1000;
    return Boolean(tokens?.id_token && expiresAt > Date.now() + 30000);
  }

  async function startLogin() {
    const verifier = randomUrlString(64);
    const state = randomUrlString(32);
    const challenge = await sha256Url(verifier);
    sessionStorage.setItem(verifierKey, verifier);
    sessionStorage.setItem(stateKey, state);
    sessionStorage.setItem(returnToKey, `${window.location.pathname}${window.location.search}${window.location.hash}`);

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: "code",
      scope: config.scopes.join(" "),
      redirect_uri: redirectUri(),
      code_challenge_method: "S256",
      code_challenge: challenge,
      state,
    });
    window.location.assign(`${authorizeEndpoint()}?${params.toString()}`);
    return new Promise(() => {});
  }

  async function exchangeCode(code, state) {
    const expectedState = sessionStorage.getItem(stateKey);
    const verifier = sessionStorage.getItem(verifierKey);
    if (!expectedState || !verifier || state !== expectedState) {
      clearTokens();
      throw new Error("Login state could not be verified. Please sign in again.");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
    });
    const response = await fetch(tokenEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error_description || payload.error || "Cognito token exchange failed.");

    sessionStorage.removeItem(verifierKey);
    sessionStorage.removeItem(stateKey);
    const tokens = storeTokens(payload);
    const returnTo = sessionStorage.getItem(returnToKey) || "/";
    sessionStorage.removeItem(returnToKey);
    window.history.replaceState({}, document.title, returnTo);
    return tokens;
  }

  function displayName(claims) {
    return claims?.name || claims?.email || claims?.["cognito:username"] || "PT";
  }

  function updateHeader(claims) {
    const welcome = document.getElementById("authWelcome");
    if (welcome) welcome.textContent = `Welcome ${displayName(claims)}`;
    const signOut = document.getElementById("authSignOut");
    if (signOut) signOut.hidden = false;
  }

  function showAuthError(error) {
    document.body.classList.add("motion-ready");
    const message = error?.message || String(error);
    const overlay = document.createElement("main");
    overlay.className = "auth-error-shell";
    overlay.innerHTML = `
      <section class="auth-error-card">
        <p class="eyebrow">Latitude Clinic</p>
        <h1>Sign-in needs attention</h1>
        <p>${message}</p>
        <button id="authRetryButton" class="button">Sign in again</button>
      </section>
    `;
    document.body.replaceChildren(overlay);
    document.getElementById("authRetryButton")?.addEventListener("click", () => {
      clearTokens();
      startLogin();
    });
  }

  async function ensureAuthenticated() {
    if (!config?.domain || !config?.clientId) throw new Error("Latitude auth is not configured.");
    const managedSession = await serverSession();
    if (managedSession) return managedSession;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code) return exchangeCode(code, state);

    const tokens = getStoredTokens();
    if (hasValidSession(tokens)) return tokens;
    return startLogin();
  }

  function signOut() {
    clearTokens();
    if (window.location.protocol !== "file:" && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
      window.location.assign("/auth/logout");
      return;
    }
    const params = new URLSearchParams({
      client_id: config.clientId,
      logout_uri: redirectUri(),
    });
    window.location.assign(`${logoutEndpoint()}?${params.toString()}`);
  }

  const ready = ensureAuthenticated()
    .then((tokens) => {
      window.LATITUDE_CURRENT_USER = tokens.claims;
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => updateHeader(tokens.claims), { once: true });
      } else {
        updateHeader(tokens.claims);
      }
      return tokens.claims;
    })
    .catch((error) => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => showAuthError(error), { once: true });
      } else {
        showAuthError(error);
      }
      throw error;
    });

  window.latitudeAuth = {
    ready,
    signOut,
    get user() {
      return window.LATITUDE_CURRENT_USER || null;
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("authSignOut")?.addEventListener("click", signOut);
  });
})();
