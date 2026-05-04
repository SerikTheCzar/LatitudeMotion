import { authConfig, clearCookieHeader, logoutUrl } from "../_shared/cognito.js";

export function onRequestGet({ request }) {
  const secure = new URL(request.url).protocol === "https:";
  const response = Response.redirect(logoutUrl(request), 302);
  response.headers.append("Set-Cookie", clearCookieHeader(authConfig.sessionCookie, secure));
  return response;
}
