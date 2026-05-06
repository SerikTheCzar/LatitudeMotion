import { assignedSession, appendSessionEvent, currentJunoContext, json } from "../../../../_shared/juno.js";
import { putRecord } from "../../../../_shared/aws.js";

export async function onRequestPost({ env, params, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const lookup = await assignedSession(env, context.user, params.id);
  if (lookup.error) return lookup.error;

  const body = await request.json().catch(() => ({}));
  const rating = String(body.rating || "").trim();
  const comparisonId = String(body.comparison_id || "").trim();
  if (!rating || !comparisonId) return json({ detail: "comparison_id and rating are required." }, { status: 400 });

  const now = new Date().toISOString();
  const feedback = await putRecord(env, "session_feedback", {
    id: `feedback_${crypto.randomUUID()}`,
    juno_session_id: lookup.session.id,
    author_user_id: context.user.id,
    feedback_type: "comparison_feedback",
    body: String(body.note || rating).slice(0, 5000),
    comparison_id: comparisonId,
    rating,
    workout_label: String(body.workout_label || ""),
    metadata_json: JSON.stringify({
      comparison_id: comparisonId,
      rating,
      workout_label: body.workout_label || "",
      reference_session_id: body.reference_session_id || "",
    }),
    created_at: now,
  });

  await appendSessionEvent(env, lookup.session.id, "comparison_feedback_created", {
    feedback_id: feedback.id,
    comparison_id: comparisonId,
    rating,
  });

  return json({ feedback }, { status: 201 });
}
