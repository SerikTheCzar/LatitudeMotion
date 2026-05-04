import { assignedSession, appendSessionEvent, currentJunoContext, json, listForSession } from "../../../../_shared/juno.js";
import { putRecord } from "../../../../_shared/aws.js";

export async function onRequestGet({ env, params, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const lookup = await assignedSession(env, context.user, params.id);
  if (lookup.error) return lookup.error;
  return json({ notes: await listForSession(env, "session_notes", lookup.session.id) });
}

export async function onRequestPost({ env, params, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const lookup = await assignedSession(env, context.user, params.id);
  if (lookup.error) return lookup.error;
  const body = await request.json().catch(() => ({}));
  const text = String(body.body || "").trim();
  if (!text) return json({ detail: "Note body is required." }, { status: 400 });
  const now = new Date().toISOString();
  const note = await putRecord(env, "session_notes", {
    id: `note_${crypto.randomUUID()}`,
    juno_session_id: lookup.session.id,
    author_user_id: context.user.id,
    note_type: String(body.note_type || "pt"),
    body: text.slice(0, 5000),
    created_at: now,
  });
  await appendSessionEvent(env, lookup.session.id, "note_created", { note_id: note.id, author_user_id: context.user.id });
  return json({ note }, { status: 201 });
}
