import { assignedSession, appendSessionEvent, currentJunoContext, json, listForSession } from "../../../../_shared/juno.js";
import { putRecord } from "../../../../_shared/aws.js";

export async function onRequestGet({ env, params, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const lookup = await assignedSession(env, context.user, params.id);
  if (lookup.error) return lookup.error;
  return json({ feedback: await listForSession(env, "session_feedback", lookup.session.id) });
}

export async function onRequestPost({ env, params, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const lookup = await assignedSession(env, context.user, params.id);
  if (lookup.error) return lookup.error;
  const body = await request.json().catch(() => ({}));
  const text = String(body.body || "").trim();
  if (!text) return json({ detail: "Feedback body is required." }, { status: 400 });
  const now = new Date().toISOString();
  const feedback = await putRecord(env, "session_feedback", {
    id: `feedback_${crypto.randomUUID()}`,
    juno_session_id: lookup.session.id,
    author_user_id: context.user.id,
    feedback_type: String(body.feedback_type || "response"),
    body: text.slice(0, 5000),
    created_at: now,
  });
  await appendSessionEvent(env, lookup.session.id, "feedback_created", { feedback_id: feedback.id, author_user_id: context.user.id });
  return json({ feedback }, { status: 201 });
}
