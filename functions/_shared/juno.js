import { authConfig, parseCookies, verifySession } from "./cognito.js";
import { getById, putRecord, queryByIndex, scanRecords } from "./aws.js";

export function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) },
  });
}

export async function currentClaims(request) {
  const cookies = parseCookies(request);
  return verifySession(cookies[authConfig.sessionCookie]).catch(() => null);
}

export async function currentJunoContext(env, request) {
  const claims = await currentClaims(request);
  if (!claims) return { error: json({ detail: "Authentication required." }, { status: 401 }) };
  const users = await queryByIndex(env, "users", "auth-subject-index", "auth_subject", claims.sub);
  const user = users[0];
  if (!user || user.status !== "active") return { error: json({ detail: "No active Juno profile is linked to this Cognito user." }, { status: 403 }) };
  const memberships = (await scanRecords(env, "memberships")).filter((item) => item.user_id === user.id);
  const sites = await scanRecords(env, "sites");
  return {
    claims,
    user,
    memberships,
    sites: sites.filter((site) => memberships.some((membership) => membership.site_id === site.id)),
  };
}

export async function assignedSession(env, user, id) {
  const session = await getById(env, "juno_sessions", id);
  if (!session) return { error: json({ detail: "Session not found." }, { status: 404 }) };
  if (session.pt_user_id !== user.id) return { error: json({ detail: "Session is not assigned to this PT." }, { status: 403 }) };
  return { session };
}

export async function listAssignedSessions(env, user) {
  return (await scanRecords(env, "juno_sessions"))
    .filter((session) => session.pt_user_id === user.id)
    .sort((a, b) => String(b.started_at || b.created_at || "").localeCompare(String(a.started_at || a.created_at || "")));
}

export async function listForSession(env, logicalName, sessionId) {
  return (await scanRecords(env, logicalName))
    .filter((item) => item.juno_session_id === sessionId)
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export async function appendSessionEvent(env, sessionId, eventType, payload = {}, severity = "info") {
  const now = new Date().toISOString();
  return putRecord(env, "session_events", {
    id: `event_${crypto.randomUUID()}`,
    juno_session_id: sessionId,
    event_type: eventType,
    severity,
    payload_json: JSON.stringify(payload),
    created_at: now,
  });
}

export function publicSession(session) {
  return {
    id: session.id,
    existing_session_id: session.existing_session_id,
    title: session.title,
    state: session.state,
    mode: session.mode,
    session_source: session.session_source,
    client_label: session.client_label,
    started_at: session.started_at,
    duration_sec: session.duration_sec,
    frame_count: session.frame_count,
    total_rep_count: session.total_rep_count,
    workout_count: session.workout_count,
    workout_labels: session.workout_labels,
    run_id: session.run_id,
  };
}
