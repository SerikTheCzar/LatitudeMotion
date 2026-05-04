import {
  authConfig,
  authorizeUrl,
  clearCookieHeader,
  cookieHeader,
  packOAuthState,
  parseCookies,
  pkceChallenge,
  randomUrlString,
  verifySession,
} from "./_shared/cognito.js";

const passthroughPrefixes = ["/auth/"];

export async function onRequest(context) {
  try {
    const { request, next } = context;
    const url = new URL(request.url);
    if (passthroughPrefixes.some((prefix) => url.pathname.startsWith(prefix))) return next();

    const secure = url.protocol === "https:";
    const cookies = parseCookies(request);
    const claims = await verifySession(cookies[authConfig.sessionCookie]).catch(() => null);
    if (claims) return next();

    const verifier = randomUrlString(64);
    const stateNonce = randomUrlString(32);
    const returnTo = `${url.pathname}${url.search}${url.hash}`;
    const state = packOAuthState({ n: stateNonce, v: verifier, r: returnTo });
    const challenge = await pkceChallenge(verifier);
    const response = new Response(null, {
      status: 302,
      headers: { Location: authorizeUrl(request, state, challenge) },
    });
    response.headers.append("Set-Cookie", cookieHeader(authConfig.verifierCookie, verifier, { maxAge: 600, secure }));
    response.headers.append("Set-Cookie", cookieHeader(authConfig.stateCookie, stateNonce, { maxAge: 600, secure }));
    response.headers.append("Set-Cookie", cookieHeader(authConfig.returnCookie, returnTo, { maxAge: 600, secure }));
    response.headers.append("Set-Cookie", clearCookieHeader(authConfig.sessionCookie, secure));
    return response;
  } catch (error) {
    return new Response(`Latitude auth middleware failed: ${error?.message || String(error)}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
