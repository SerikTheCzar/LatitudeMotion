import {
  authConfig,
  clearCookieHeader,
  cookieHeader,
  parseCookies,
  redirectUri,
  unpackOAuthState,
  verifySession,
} from "../_shared/cognito.js";

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const secure = url.protocol === "https:";
    const cookies = parseCookies(request);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const packedState = unpackOAuthState(state);
    const expectedState = cookies[authConfig.stateCookie];
    const verifier = cookies[authConfig.verifierCookie] || packedState?.v;
    const stateNonce = packedState?.n || state;

    if (!code || !stateNonce || !verifier || (expectedState && stateNonce !== expectedState)) {
      return new Response("Invalid Cognito callback state. Please start login again from clinic.latitudemotion.com.", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
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
      return new Response(`Cognito token exchange failed: ${tokens.error_description || tokens.error || "invalid token"}`, {
        status: 401,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      });
    }

    const returnTo = cookies[authConfig.returnCookie] || packedState?.r || "/";
    const response = new Response(null, {
      status: 302,
      headers: { Location: new URL(returnTo, url.origin).toString() },
    });
    response.headers.append("Set-Cookie", cookieHeader(authConfig.sessionCookie, tokens.id_token, { maxAge: 3600, secure }));
    response.headers.append("Set-Cookie", clearCookieHeader(authConfig.verifierCookie, secure));
    response.headers.append("Set-Cookie", clearCookieHeader(authConfig.stateCookie, secure));
    response.headers.append("Set-Cookie", clearCookieHeader(authConfig.returnCookie, secure));
    return response;
  } catch (error) {
    return new Response(`Latitude auth callback failed: ${error?.message || String(error)}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
