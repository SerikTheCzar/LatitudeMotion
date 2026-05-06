import { assignedSession, appendSessionEvent, currentJunoContext, json, listForSession } from "../../../../_shared/juno.js";
import { getById, putRecord } from "../../../../_shared/aws.js";

export async function onRequestGet({ env, params, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const lookup = await assignedSession(env, context.user, params.id);
  if (lookup.error) return lookup.error;
  const notes = (await listForSession(env, "session_notes", lookup.session.id)).filter((note) => !note.deleted_at);
  return json({ notes });
}

export async function onRequestPost({ env, params, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const lookup = await assignedSession(env, context.user, params.id);
  if (lookup.error) return lookup.error;
  const body = await request.json().catch(() => ({}));
  const text = String(body.body || body.chart_note || body.free_text || "").trim();
  if (!text) return json({ detail: "Note body is required." }, { status: 400 });
  const now = new Date().toISOString();
  const note = await putRecord(env, "session_notes", {
    id: `note_${crypto.randomUUID()}`,
    juno_session_id: lookup.session.id,
    author_user_id: context.user.id,
    note_type: String(body.note_type || body.noteType || "pt"),
    body: text.slice(0, 5000),
    free_text: String(body.free_text || body.freeText || "").slice(0, 5000),
    chart_note: String(body.chart_note || body.chartNote || text).slice(0, 5000),
    source: String(body.source || "viewer"),
    client_note_id: String(body.client_note_id || body.clientNoteId || ""),
    anchor: body.anchor || {},
    workout: body.workout || {},
    rep: body.rep || {},
    metric: body.metric || {},
    chartability: body.chartability || {},
    dose: body.dose || {},
    comparison: body.comparison || {},
    side_to_side: body.side_to_side || body.sideToSide || {},
    associated_movement: body.associated_movement || body.associatedMovement || {},
    set_drift: body.set_drift || body.setDrift || {},
    deep_link: String(body.deep_link || body.deepLink || ""),
    exported_at: body.exported_at || body.exportedAt || null,
    created_at: now,
  });
  await appendSessionEvent(env, lookup.session.id, "note_created", {
    note_id: note.id,
    author_user_id: context.user.id,
    note_type: note.note_type,
    anchor: note.anchor,
    chartability: note.chartability?.status || "",
  });
  return json({ note }, { status: 201 });
}

export async function onRequestDelete({ env, params, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const lookup = await assignedSession(env, context.user, params.id);
  if (lookup.error) return lookup.error;
  const body = await request.json().catch(() => ({}));
  const noteId = String(body.id || new URL(request.url).searchParams.get("id") || "").trim();
  if (!noteId) return json({ detail: "Note id is required." }, { status: 400 });
  const note = await getById(env, "session_notes", noteId);
  if (!note || note.juno_session_id !== lookup.session.id) return json({ detail: "Note not found." }, { status: 404 });
  if (note.author_user_id !== context.user.id) return json({ detail: "Only the author can delete this note." }, { status: 403 });
  await putRecord(env, "session_notes", {
    ...note,
    deleted_at: new Date().toISOString(),
    deleted_by_user_id: context.user.id,
  });
  await appendSessionEvent(env, lookup.session.id, "note_deleted", { note_id: noteId, author_user_id: context.user.id });
  return json({ ok: true });
}
