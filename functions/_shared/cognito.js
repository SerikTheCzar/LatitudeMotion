export const authConfig = {
  region: "us-east-1",
  userPoolId: "us-east-1_rhnd7bfvu",
  clientId: "4kdgcm77hagtr3kmdm49k2s6lh",
  domain: "https://latitude-clinic-557690582398.auth.us-east-1.amazoncognito.com",
  scopes: ["openid", "email", "profile"],
  sessionCookie: "latitude_session",
  verifierCookie: "latitude_pkce_verifier",
  stateCookie: "latitude_oauth_state",
  returnCookie: "latitude_return_to",
};

const encoder = new TextEncoder();
let cachedJwks = null;

export function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function randomUrlString(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export function packOAuthState(payload) {
  return base64Url(encoder.encode(JSON.stringify(payload)));
}

export function unpackOAuthState(value) {
  if (!value) return null;
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
  } catch {
    return null;
  }
}

export async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (!rawName) continue;
    cookies[rawName] = decodeURIComponent(rest.join("=") || "");
  }
  return cookies;
}

export function cookieHeader(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.secure !== false) parts.push("Secure");
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

export function clearCookieHeader(name, secure = true) {
  return cookieHeader(name, "", { maxAge: 0, secure });
}

export function redirectUri(request) {
  return `${new URL(request.url).origin}/auth/callback`;
}

export function signOutUri(request) {
  return `${new URL(request.url).origin}/`;
}

export function claimsFromJwt(token) {
  const [, payload] = String(token || "").split(".");
  if (!payload) return null;
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
}

async function jwks() {
  if (cachedJwks) return cachedJwks;
  const url = `https://cognito-idp.${authConfig.region}.amazonaws.com/${authConfig.userPoolId}/.well-known/jwks.json`;
  const response = await fetch(url, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!response.ok) throw new Error("Unable to load Cognito signing keys.");
  cachedJwks = await response.json();
  return cachedJwks;
}

export async function verifySession(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedHeader)));
  const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload)));
  const issuer = `https://cognito-idp.${authConfig.region}.amazonaws.com/${authConfig.userPoolId}`;
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== issuer || claims.aud !== authConfig.clientId || claims.token_use !== "id" || claims.exp <= now) return null;

  const keys = await jwks();
  const jwk = keys.keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(encodedSignature),
    encoder.encode(`${encodedHeader}.${encodedPayload}`),
  );
  return valid ? claims : null;
}

export function authorizeUrl(request, state, challenge) {
  const params = new URLSearchParams({
    client_id: authConfig.clientId,
    response_type: "code",
    scope: authConfig.scopes.join(" "),
    redirect_uri: redirectUri(request),
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });
  return `${authConfig.domain}/oauth2/authorize?${params.toString()}`;
}

export function logoutUrl(request) {
  const params = new URLSearchParams({
    client_id: authConfig.clientId,
    logout_uri: signOutUri(request),
  });
  return `${authConfig.domain}/logout?${params.toString()}`;
}
