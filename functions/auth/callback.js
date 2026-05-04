import {
  authConfig,
  clearCookieHeader,
  cookieHeader,
  parseCookies,
  redirectUri,
  verifySession,
} from "../_shared/cognito.js";

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";
  const cookies = parseCookies(request);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = cookies[authConfig.stateCookie];
  const verifier = cookies[authConfig.verifierCookie];

  if (!code || !state || !expectedState || !verifier || state !== expectedState) {
    return new Response("Invalid Cognito callback state.", { status: 400 });
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: authConfig.clientId,
    code,
    redirect_uri: redirectUri(request),
    code_verifier: verifier,
  });
  const tokenResponse = await fetch(`${authConfig.domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokens = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !(await verifySession(tokens.id_token))) {
    return new Response("Cognito token exchange failed.", { status: 401 });
  }

  const returnTo = cookies[authConfig.returnCookie] || "/";
  const response = Response.redirect(new URL(returnTo, url.origin).toString(), 302);
  response.headers.append("Set-Cookie", cookieHeader(authConfig.sessionCookie, tokens.id_token, { maxAge: 3600, secure }));
  response.headers.append("Set-Cookie", clearCookieHeader(authConfig.verifierCookie, secure));
  response.headers.append("Set-Cookie", clearCookieHeader(authConfig.stateCookie, secure));
  response.headers.append("Set-Cookie", clearCookieHeader(authConfig.returnCookie, secure));
  return response;
}
