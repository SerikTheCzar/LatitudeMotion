import { assignedSession, currentJunoContext, json, publicSession } from "../../../_shared/juno.js";

export async function onRequestGet({ env, params, request }) {
  const context = await currentJunoContext(env, request);
  if (context.error) return context.error;
  const lookup = await assignedSession(env, context.user, params.id);
  if (lookup.error) return lookup.error;
  return json({ session: publicSession(lookup.session) });
}
