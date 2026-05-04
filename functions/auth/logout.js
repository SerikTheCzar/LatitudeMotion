import { authConfig, clearCookieHeader, logoutUrl } from "../_shared/cognito.js";

export function onRequestGet({ request }) {
  try {
    const secure = new URL(request.url).protocol === "https:";
    const response = new Response(null, {
      status: 302,
      headers: { Location: logoutUrl(request) },
    });
    response.headers.append("Set-Cookie", clearCookieHeader(authConfig.sessionCookie, secure));
    return response;
  } catch (error) {
    return new Response(`Latitude logout failed: ${error?.message || String(error)}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
