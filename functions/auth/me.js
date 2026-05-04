import { authConfig, parseCookies, verifySession } from "../_shared/cognito.js";

export async function onRequestGet({ request }) {
  const cookies = parseCookies(request);
  const claims = await verifySession(cookies[authConfig.sessionCookie]).catch(() => null);
  if (!claims) return Response.json({ authenticated: false }, { status: 401 });
  return Response.json({
    authenticated: true,
    user: {
      sub: claims.sub,
      email: claims.email,
      name: claims.name || claims.email || claims["cognito:username"],
      groups: claims["cognito:groups"] || [],
    },
  });
}
